"""
test_recorder.py
----------------
Unit tests for the dual-camera recorder.

All cv2.VideoCapture and cv2.VideoWriter calls are mocked so no physical
webcam is required. Tests verify:
  - both cameras open and produce frames
  - timestamps are generated and saved
  - recording stops after the configured duration
  - camera resources are always released
  - failure of one camera is handled gracefully
  - failure of both cameras is handled gracefully
"""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from unittest.mock import MagicMock, call, patch, PropertyMock

import pytest

from app.camera.recorder import (
    CameraRole,
    CameraResult,
    DualCameraRecorder,
    RecordingSession,
    _run_camera_worker,
)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _good_frame():
    """Return a fake numpy-like frame (MagicMock with .size > 0)."""
    frame = MagicMock()
    frame.size = 640 * 480 * 3
    return frame


def _make_cap(opened: bool = True, frame_ok: bool = True):
    """Build a mock VideoCapture that behaves correctly."""
    cap = MagicMock()
    cap.isOpened.return_value = opened
    cap.get.return_value = 640.0  # width / height / fps all return 640 for simplicity
    cap.getBackendName.return_value = "DSHOW"
    if frame_ok:
        cap.read.return_value = (True, _good_frame())
    else:
        cap.read.return_value = (False, None)
    return cap


def _make_writer():
    writer = MagicMock()
    return writer


# ---------------------------------------------------------------------------
# _run_camera_worker
# ---------------------------------------------------------------------------

class TestRunCameraWorker:
    """Tests for the inner camera thread worker function."""

    def _run_with_stop(self, config_role, cap_mock, writer_mock, duration=0.05):
        """Helper: run _run_camera_worker with a stop event that fires after *duration* s."""
        from app.camera.recorder import CameraConfig

        config = CameraConfig(index=0, role=config_role)
        stop_event = threading.Event()
        out: dict = {}

        with (
            patch("app.camera.recorder._open_capture", return_value=cap_mock),
            patch("app.camera.recorder.cv2.VideoWriter", return_value=writer_mock),
        ):
            def _stopper():
                time.sleep(duration)
                stop_event.set()

            t = threading.Thread(target=_stopper, daemon=True)
            t.start()
            _run_camera_worker(config, stop_event, Path("/tmp/session"), "20240101T000000", out)

        return out

    def test_successful_capture_stores_result(self, tmp_path):
        from app.camera.recorder import CameraConfig

        config = CameraConfig(index=0, role=CameraRole.FRONT)
        stop_event = threading.Event()
        out: dict = {}
        cap = _make_cap(opened=True, frame_ok=True)
        writer = _make_writer()

        # Stop after reading a few frames
        def _side_effect():
            time.sleep(0.05)
            stop_event.set()

        threading.Thread(target=_side_effect, daemon=True).start()

        with (
            patch("app.camera.recorder._open_capture", return_value=cap),
            patch("app.camera.recorder.cv2.VideoWriter", return_value=writer),
        ):
            _run_camera_worker(config, stop_event, tmp_path, "20240101T000000", out)

        assert CameraRole.FRONT in out
        result = out[CameraRole.FRONT]
        assert result.frame_count > 0
        assert result.error is None
        assert result.video_path is not None

    def test_timestamps_file_is_written(self, tmp_path):
        from app.camera.recorder import CameraConfig

        config = CameraConfig(index=0, role=CameraRole.FRONT)
        stop_event = threading.Event()
        out: dict = {}
        cap = _make_cap()
        writer = _make_writer()

        threading.Thread(target=lambda: (time.sleep(0.05), stop_event.set()), daemon=True).start()

        with (
            patch("app.camera.recorder._open_capture", return_value=cap),
            patch("app.camera.recorder.cv2.VideoWriter", return_value=writer),
        ):
            _run_camera_worker(config, stop_event, tmp_path, "20240101T000000", out)

        result = out[CameraRole.FRONT]
        assert result.timestamps_path is not None
        assert result.timestamps_path.exists()
        data = json.loads(result.timestamps_path.read_text())
        assert data["frame_count"] == result.frame_count
        assert len(data["timestamps_s"]) == result.frame_count

    def test_camera_release_always_called(self, tmp_path):
        from app.camera.recorder import CameraConfig

        config = CameraConfig(index=0, role=CameraRole.FRONT)
        stop_event = threading.Event()
        stop_event.set()  # stop immediately
        out: dict = {}
        cap = _make_cap()
        writer = _make_writer()

        with (
            patch("app.camera.recorder._open_capture", return_value=cap),
            patch("app.camera.recorder.cv2.VideoWriter", return_value=writer),
        ):
            _run_camera_worker(config, stop_event, tmp_path, "20240101T000000", out)

        cap.release.assert_called_once()
        writer.release.assert_called_once()

    def test_unavailable_camera_sets_error(self, tmp_path):
        from app.camera.recorder import CameraConfig

        config = CameraConfig(index=2, role=CameraRole.SIDE)
        stop_event = threading.Event()
        out: dict = {}
        cap = _make_cap(opened=False)

        with patch("app.camera.recorder._open_capture", return_value=cap):
            _run_camera_worker(config, stop_event, tmp_path, "20240101T000000", out)

        result = out[CameraRole.SIDE]
        assert result.error is not None
        assert result.frame_count == 0
        assert result.video_path is None

    def test_missed_frames_do_not_crash(self, tmp_path):
        """read() occasionally returns (False, None) — worker should continue."""
        from app.camera.recorder import CameraConfig

        config = CameraConfig(index=0, role=CameraRole.FRONT)
        stop_event = threading.Event()
        out: dict = {}
        cap = _make_cap()
        writer = _make_writer()

        # Alternate good/bad frames indefinitely using a stateful callable.
        _call_count = [0]

        def _alternating_read():
            _call_count[0] += 1
            if _call_count[0] % 2 == 1:
                return (True, _good_frame())
            return (False, None)

        cap.read.side_effect = _alternating_read

        threading.Thread(target=lambda: (time.sleep(0.05), stop_event.set()), daemon=True).start()

        with (
            patch("app.camera.recorder._open_capture", return_value=cap),
            patch("app.camera.recorder.cv2.VideoWriter", return_value=writer),
        ):
            _run_camera_worker(config, stop_event, tmp_path, "20240101T000000", out)

        assert CameraRole.FRONT in out
        # Only odd-numbered calls (good frames) should be counted
        total_calls = _call_count[0]
        expected_frames = (total_calls + 1) // 2
        assert out[CameraRole.FRONT].frame_count == expected_frames


# ---------------------------------------------------------------------------
# DualCameraRecorder.record()
# ---------------------------------------------------------------------------

class TestDualCameraRecorder:

    def _patch_worker(self, front_frames: int = 10, side_frames: int = 10,
                      front_error: str | None = None, side_error: str | None = None):
        """
        Return a context-manager patch for _run_camera_worker that immediately
        deposits synthetic CameraResult values, bypassing real camera I/O.
        """
        def _fake_worker(config, stop_event, session_dir, ts_prefix, out):
            # Simulate the worker finishing instantly.
            role = config.role
            if role == CameraRole.FRONT:
                err, fc = front_error, front_frames
            else:
                err, fc = side_error, side_frames

            out[role] = CameraResult(
                role=role,
                index=config.index,
                frame_count=0 if err else fc,
                video_path=None if err else session_dir / f"{role.value}_test.avi",
                timestamps_path=None if err else session_dir / f"{role.value}_ts.json",
                actual_width=640,
                actual_height=480,
                actual_fps=30.0,
                error=err,
            )

        return patch("app.camera.recorder._run_camera_worker", side_effect=_fake_worker)

    def test_both_cameras_succeed(self, tmp_path):
        recorder = DualCameraRecorder(duration=0.01, output_dir=tmp_path)
        with self._patch_worker(front_frames=150, side_frames=148):
            session = recorder.record()

        assert isinstance(session, RecordingSession)
        assert session.front.frame_count == 150
        assert session.side.frame_count == 148
        assert session.success is True
        assert session.error is None

    def test_recording_stops_after_duration(self, tmp_path):
        """Elapsed time should be >= duration (within a generous margin)."""
        recorder = DualCameraRecorder(duration=0.05, output_dir=tmp_path)
        with self._patch_worker():
            t0 = time.monotonic()
            recorder.record()
            elapsed = time.monotonic() - t0

        assert elapsed >= 0.05

    def test_front_camera_failure_is_reported(self, tmp_path):
        recorder = DualCameraRecorder(duration=0.01, output_dir=tmp_path)
        with self._patch_worker(front_error="Camera 0 unavailable", side_frames=145):
            session = recorder.record()

        assert session.front.success is False
        assert "Camera 0 unavailable" in (session.error or "")
        assert session.side.success is True

    def test_side_camera_failure_is_reported(self, tmp_path):
        recorder = DualCameraRecorder(duration=0.01, output_dir=tmp_path)
        with self._patch_worker(front_frames=145, side_error="Camera 1 unavailable"):
            session = recorder.record()

        assert session.side.success is False
        assert "Camera 1 unavailable" in (session.error or "")
        assert session.front.success is True

    def test_both_cameras_fail(self, tmp_path):
        recorder = DualCameraRecorder(duration=0.01, output_dir=tmp_path)
        with self._patch_worker(front_error="No cam 0", side_error="No cam 1"):
            session = recorder.record()

        assert session.success is False
        assert session.front.success is False
        assert session.side.success is False

    def test_session_dir_is_created(self, tmp_path):
        recorder = DualCameraRecorder(duration=0.01, output_dir=tmp_path)
        with self._patch_worker():
            session = recorder.record()

        assert session.output_dir.exists()
        assert session.output_dir.is_dir()

    def test_session_has_unique_id(self, tmp_path):
        recorder = DualCameraRecorder(duration=0.01, output_dir=tmp_path)
        with self._patch_worker():
            s1 = recorder.record()
        with self._patch_worker():
            s2 = recorder.record()

        assert s1.session_id != s2.session_id

    def test_started_at_is_iso8601(self, tmp_path):
        from datetime import datetime
        recorder = DualCameraRecorder(duration=0.01, output_dir=tmp_path)
        with self._patch_worker():
            session = recorder.record()

        # Should parse without raising
        datetime.fromisoformat(session.started_at.replace("Z", "+00:00"))

    def test_default_sources_and_rotation(self):
        from app.camera.recorder import DEFAULT_FRONT_URL, DEFAULT_SIDE_URL, DEFAULT_ROTATION

        recorder = DualCameraRecorder()
        assert recorder.front_config.source == DEFAULT_FRONT_URL
        assert recorder.side_config.source == DEFAULT_SIDE_URL
        assert recorder.front_config.rotation == DEFAULT_ROTATION
        assert recorder.side_config.rotation == DEFAULT_ROTATION
        assert recorder.front_config.width == 1280
        assert recorder.front_config.height == 720

    def test_custom_source_and_rotation_override(self):
        recorder = DualCameraRecorder(
            front_source="http://192.168.1.50:4747/video",
            side_source="http://192.168.1.51:4748/video",
            front_rotation=0,
            side_rotation=270,
        )
        assert recorder.front_config.source == "http://192.168.1.50:4747/video"
        assert recorder.side_config.source == "http://192.168.1.51:4748/video"
        assert recorder.front_config.rotation == 0
        assert recorder.side_config.rotation == 270


# ---------------------------------------------------------------------------
# Rotation and Stream Opening Tests
# ---------------------------------------------------------------------------

class TestRotationAndStream:
    def test_rotate_frame_numpy(self):
        import numpy as np
        from app.camera.recorder import rotate_frame

        # Create a 720x1280 dummy frame (height=720, width=1280)
        img = np.zeros((720, 1280, 3), dtype=np.uint8)

        # 90 degrees clockwise -> height=1280, width=720
        r90 = rotate_frame(img, 90)
        assert r90.shape == (1280, 720, 3)

        # 180 degrees -> preserves shape
        r180 = rotate_frame(img, 180)
        assert r180.shape == (720, 1280, 3)

        # 270 degrees -> height=1280, width=720
        r270 = rotate_frame(img, 270)
        assert r270.shape == (1280, 720, 3)

        # 0 degrees -> unchanged
        r0 = rotate_frame(img, 0)
        assert r0.shape == (720, 1280, 3)

    def test_rotate_frame_non_numpy(self):
        from app.camera.recorder import rotate_frame

        mock_obj = MagicMock()
        # Should return the mock object untouched without raising
        result = rotate_frame(mock_obj, 90)
        assert result is mock_obj

    def test_open_capture_url_calls_videocapture_without_backend(self):
        from app.camera.recorder import _open_capture

        with patch("app.camera.recorder.cv2.VideoCapture") as mock_vc:
            _open_capture("http://127.0.0.1:4747/video")
            mock_vc.assert_called_once_with("http://127.0.0.1:4747/video")

    def test_open_capture_numeric_uses_dshow_fallback(self):
        from app.camera.recorder import _open_capture
        import cv2

        with patch("app.camera.recorder.cv2.VideoCapture") as mock_vc:
            cap_instance = MagicMock()
            cap_instance.isOpened.return_value = True
            mock_vc.return_value = cap_instance

            _open_capture(0)
            mock_vc.assert_called_with(0, cv2.CAP_DSHOW)

