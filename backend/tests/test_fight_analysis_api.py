"""
test_fight_analysis_api.py
--------------------------
API integration tests for the /api/v1/fight/analyze and /api/v1/analyze endpoints.

Mocks camera hardware and OpenCV/YOLO dependencies so no physical phones,
cameras, or GPU resources are required:
  - Successful fight recording and analysis pipeline with default request
  - Alternate alias endpoint (/api/v1/analyze)
  - Custom request parameters (duration, camera sources)
  - Camera recording failure reporting (503 Service Unavailable)
  - Recorder exception handling (503 Service Unavailable)
  - Side camera fallback when front camera fails
  - Pose analysis failure reporting (500 Internal Server Error)
  - Zero person detections handling (graceful 200 with missing-keypoint observations)
  - Disclaimer presence (no professional officiating/judging claim)
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.analysis.fight_observer import DISCLAIMER_TEXT
from app.analysis.models import PoseFrame, PoseSequence
from app.camera.recorder import CameraResult, CameraRole, RecordingSession
from app.main import app
from app.pose.pose_detector import COCO_KEYPOINT_NAMES, Keypoint


# ---------------------------------------------------------------------------
# Test Fixtures & Helpers
# ---------------------------------------------------------------------------


def make_dummy_keypoints(conf: float = 0.95) -> list[Keypoint]:
    """Generate basic valid COCO keypoints."""
    return [
        Keypoint(
            name=name,
            index=i,
            x_px=500.0 + (i * 10),
            y_px=300.0 + (i * 15),
            x_norm=0.5,
            y_norm=0.3,
            confidence=conf,
        )
        for i, name in enumerate(COCO_KEYPOINT_NAMES)
    ]


def make_dummy_pose_sequence(detected: bool = True, frame_count: int = 5) -> PoseSequence:
    """Build a synthetic PoseSequence."""
    frames = []
    for i in range(frame_count):
        kps = make_dummy_keypoints() if detected else []
        frames.append(
            PoseFrame(
                frame_index=i,
                timestamp=i * 0.1,
                detection_present=detected,
                keypoints=kps,
                bbox_xyxy=(400.0, 200.0, 600.0, 600.0) if detected else None,
                person_confidence=0.95 if detected else 0.0,
            )
        )

    return PoseSequence(
        video_path="mock_front.avi",
        width=1280,
        height=720,
        source_fps=10.0,
        frame_count=frame_count,
        duration=frame_count * 0.1,
        frames=frames,
    )


def make_mock_recording_session(
    tmp_path: Path,
    front_ok: bool = True,
    side_ok: bool = True,
    error: str | None = None,
) -> RecordingSession:
    """Create a mock RecordingSession with real temporary video files."""
    session_dir = tmp_path / "mock_session"
    session_dir.mkdir(parents=True, exist_ok=True)

    front_vid = session_dir / "front.avi"
    side_vid = session_dir / "side.avi"

    if front_ok:
        front_vid.touch()
    if side_ok:
        side_vid.touch()

    front_res = CameraResult(
        role=CameraRole.FRONT,
        index="front",
        source="front",
        frame_count=30 if front_ok else 0,
        video_path=front_vid if front_ok else None,
        error=None if front_ok else (error or "Front camera failed"),
    )

    side_res = CameraResult(
        role=CameraRole.SIDE,
        index="side",
        source="side",
        frame_count=30 if side_ok else 0,
        video_path=side_vid if side_ok else None,
        error=None if side_ok else (error or "Side camera failed"),
    )

    return RecordingSession(
        session_id="test_sess_123",
        output_dir=session_dir,
        front=front_res,
        side=side_res,
        elapsed_seconds=10.0,
        started_at="2026-10-07T12:00:00Z",
    )


# ---------------------------------------------------------------------------
# Test Cases
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestFightAnalysisApi:
    """Test suite for the FastAPI fight analysis endpoint."""

    async def test_fight_analyze_success_default_request(self, tmp_path):
        mock_session = make_mock_recording_session(tmp_path, front_ok=True, side_ok=True)
        mock_seq = make_dummy_pose_sequence(detected=True, frame_count=10)

        with (
            patch("app.api.routes.DualCameraRecorder.record", return_value=mock_session),
            patch("app.api.routes.PoseSequenceAnalyzer.process_video", return_value=mock_seq),
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                res = await client.post("/api/v1/fight/analyze")

        assert res.status_code == 200
        data = res.json()

        assert data["session_id"] == "test_sess_123"
        assert "overall_score" in data
        assert data["disclaimer"] == DISCLAIMER_TEXT

        # Check all 6 categories are present
        for cat in ("stance", "balance", "guard", "striking", "coordination", "movement"):
            assert cat in data
            assert "score" in data[cat]
            assert "observation" in data[cat]
            assert isinstance(data[cat]["observation"], str)
            assert len(data[cat]["observation"]) > 0

    async def test_fight_analyze_alias_endpoint(self, tmp_path):
        mock_session = make_mock_recording_session(tmp_path, front_ok=True, side_ok=True)
        mock_seq = make_dummy_pose_sequence(detected=True, frame_count=10)

        with (
            patch("app.api.routes.DualCameraRecorder.record", return_value=mock_session),
            patch("app.api.routes.PoseSequenceAnalyzer.process_video", return_value=mock_seq),
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                res = await client.post("/api/v1/analyze")

        assert res.status_code == 200
        data = res.json()
        assert data["session_id"] == "test_sess_123"
        assert "stance" in data

    async def test_fight_analyze_custom_request_parameters(self, tmp_path):
        mock_session = make_mock_recording_session(tmp_path, front_ok=True, side_ok=True)
        mock_seq = make_dummy_pose_sequence(detected=True, frame_count=10)

        with (
            patch("app.api.routes.DualCameraRecorder.__init__", return_value=None) as mock_init,
            patch("app.api.routes.DualCameraRecorder.record", return_value=mock_session),
            patch("app.api.routes.PoseSequenceAnalyzer.process_video", return_value=mock_seq),
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                res = await client.post(
                    "/api/v1/fight/analyze",
                    json={
                        "duration": 5.0,
                        "front_source": "http://192.168.1.10:4747/video",
                        "side_source": "http://192.168.1.11:4748/video",
                    },
                )

        assert res.status_code == 200
        mock_init.assert_called_once_with(
            duration=5.0,
            front_source="http://192.168.1.10:4747/video",
            side_source="http://192.168.1.11:4748/video",
        )

    async def test_fight_analyze_camera_recording_failure(self, tmp_path):
        mock_session = make_mock_recording_session(
            tmp_path,
            front_ok=False,
            side_ok=False,
            error="Connection refused on both cameras",
        )

        with patch("app.api.routes.DualCameraRecorder.record", return_value=mock_session):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                res = await client.post("/api/v1/fight/analyze")

        assert res.status_code == 503
        data = res.json()
        assert "Camera recording failed" in data["detail"]
        assert "Connection refused" in data["detail"]

    async def test_fight_analyze_recorder_exception_handling(self):
        with patch("app.api.routes.DualCameraRecorder.record", side_effect=RuntimeError("Device USB busy")):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                res = await client.post("/api/v1/fight/analyze")

        assert res.status_code == 503
        data = res.json()
        assert "Camera recording failed" in data["detail"]
        assert "Device USB busy" in data["detail"]

    async def test_fight_analyze_side_camera_fallback(self, tmp_path):
        # Front camera fails, side camera succeeds
        mock_session = make_mock_recording_session(tmp_path, front_ok=False, side_ok=True)
        mock_seq = make_dummy_pose_sequence(detected=True, frame_count=5)

        with (
            patch("app.api.routes.DualCameraRecorder.record", return_value=mock_session),
            patch("app.api.routes.PoseSequenceAnalyzer.process_video", return_value=mock_seq) as mock_process,
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                res = await client.post("/api/v1/fight/analyze")

        assert res.status_code == 200
        # Assert process_video was called with side camera video path
        mock_process.assert_called_once_with(mock_session.side.video_path)

    async def test_fight_analyze_pose_analysis_failure(self, tmp_path):
        mock_session = make_mock_recording_session(tmp_path, front_ok=True, side_ok=True)

        with (
            patch("app.api.routes.DualCameraRecorder.record", return_value=mock_session),
            patch("app.api.routes.PoseSequenceAnalyzer.process_video", side_effect=ValueError("Corrupt frames")),
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                res = await client.post("/api/v1/fight/analyze")

        assert res.status_code == 500
        data = res.json()
        assert "Pose analysis failed" in data["detail"]
        assert "Corrupt frames" in data["detail"]

    async def test_fight_analyze_zero_person_detections_graceful(self, tmp_path):
        # Video is recorded and processed, but 0 persons detected
        mock_session = make_mock_recording_session(tmp_path, front_ok=True, side_ok=True)
        mock_seq = make_dummy_pose_sequence(detected=False, frame_count=5)

        with (
            patch("app.api.routes.DualCameraRecorder.record", return_value=mock_session),
            patch("app.api.routes.PoseSequenceAnalyzer.process_video", return_value=mock_seq),
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                res = await client.post("/api/v1/fight/analyze")

        assert res.status_code == 200
        data = res.json()

        # Overall score is None when no person was detected
        assert data["overall_score"] is None

        # Categories report safe observations about insufficient visibility
        for cat in ("stance", "balance", "guard", "striking", "coordination", "movement"):
            assert data[cat]["score"] is None
            assert "insufficient" in data[cat]["observation"].lower() or "not sufficiently" in data[cat]["observation"].lower()
