"""
test_shared_capture.py
----------------------
Unit tests for the SharedFrontCaptureManager and its integration with
the dual camera recording pipeline.

Verifies:
  - Phone 1 is opened via cv2.VideoCapture exactly once.
  - Reader thread reads frames and maintains latest JPEG frame.
  - Recording to session captures video and timestamps without opening a second capture.
  - Stopping cleanly releases the OpenCV capture.
  - Two consecutive fight runs can open, record, stop, and reopen cleanly.
  - When shared front capture is running, _run_camera_worker taps into it.
"""

from __future__ import annotations

import threading
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from app.camera.recorder import CameraConfig, CameraRole, _run_camera_worker
from app.camera.shared_capture import SharedFrontCaptureManager


def _make_dummy_frame():
    return np.zeros((480, 640, 3), dtype=np.uint8)


def _make_cap_mock(opened: bool = True):
    cap = MagicMock()
    cap.isOpened.return_value = opened
    cap.get.return_value = 640.0
    cap.read.return_value = (True, _make_dummy_frame())
    return cap


class TestSharedFrontCaptureManager:

    def test_start_and_stop_lifecycle(self):
        manager = SharedFrontCaptureManager()
        cap_mock = _make_cap_mock(opened=True)

        with patch("app.camera.shared_capture._open_capture", return_value=cap_mock) as mock_open:
            started = manager.start("http://127.0.0.1:4747/video")
            assert started is True
            assert manager.is_running is True
            mock_open.assert_called_once_with("http://127.0.0.1:4747/video")

            # Let reader loop process at least one frame
            time.sleep(0.05)
            assert manager.get_latest_jpeg() is not None

            # Stop and release
            manager.stop()
            assert manager.is_running is False
            cap_mock.release.assert_called_once()

    def test_multiple_starts_do_not_open_second_capture(self):
        manager = SharedFrontCaptureManager()
        cap_mock = _make_cap_mock(opened=True)

        with patch("app.camera.shared_capture._open_capture", return_value=cap_mock) as mock_open:
            assert manager.start("http://127.0.0.1:4747/video") is True
            # Second call while already running
            assert manager.start("http://127.0.0.1:4747/video") is True
            assert mock_open.call_count == 1

            manager.stop()

    def test_start_failure_returns_false(self):
        manager = SharedFrontCaptureManager()
        cap_mock = _make_cap_mock(opened=False)

        with patch("app.camera.shared_capture._open_capture", return_value=cap_mock):
            started = manager.start("http://127.0.0.1:4747/video")
            assert started is False
            assert manager.is_running is False
            cap_mock.release.assert_called_once()

    def test_record_to_session(self, tmp_path):
        manager = SharedFrontCaptureManager()
        cap_mock = _make_cap_mock(opened=True)
        writer_mock = MagicMock()

        config = CameraConfig(
            source="http://127.0.0.1:4747/video",
            role=CameraRole.FRONT,
            index=0,
            fps=30.0,
            rotation=0,
        )
        stop_event = threading.Event()

        with (
            patch("app.camera.shared_capture._open_capture", return_value=cap_mock),
            patch("app.camera.shared_capture.cv2.VideoWriter", return_value=writer_mock),
        ):
            manager.start("http://127.0.0.1:4747/video")

            # Stop after brief recording
            threading.Thread(target=lambda: (time.sleep(0.05), stop_event.set()), daemon=True).start()

            result = manager.record_to_session(config, stop_event, tmp_path, "20261008T000000")

            manager.stop()

        assert result.role == CameraRole.FRONT
        assert result.frame_count > 0
        assert result.video_path is not None
        assert result.timestamps_path is not None
        assert result.error is None
        writer_mock.write.assert_called()
        writer_mock.release.assert_called_once()

    def test_two_consecutive_fight_runs_reopen_cleanly(self, tmp_path):
        manager = SharedFrontCaptureManager()
        writer_mock = MagicMock()

        config = CameraConfig(
            source="http://127.0.0.1:4747/video",
            role=CameraRole.FRONT,
            index=0,
            fps=30.0,
            rotation=0,
        )

        for run_idx in range(1, 3):
            cap_mock = _make_cap_mock(opened=True)
            stop_event = threading.Event()

            with (
                patch("app.camera.shared_capture._open_capture", return_value=cap_mock) as mock_open,
                patch("app.camera.shared_capture.cv2.VideoWriter", return_value=writer_mock),
            ):
                assert manager.start("http://127.0.0.1:4747/video") is True
                assert manager.is_running is True
                mock_open.assert_called_once()

                threading.Thread(target=lambda: (time.sleep(0.05), stop_event.set()), daemon=True).start()
                res = manager.record_to_session(config, stop_event, tmp_path / f"run_{run_idx}", f"prefix_{run_idx}")

                assert res.frame_count > 0
                assert res.error is None

                # Cleanly stop at end of fight
                manager.stop()
                assert manager.is_running is False
                cap_mock.release.assert_called_once()

    def test_run_camera_worker_uses_shared_capture_when_running(self, tmp_path):
        from app.camera import shared_capture
        cap_mock = _make_cap_mock(opened=True)
        writer_mock = MagicMock()

        config = CameraConfig(
            source="http://127.0.0.1:4747/video",
            role=CameraRole.FRONT,
            fps=30.0,
            rotation=0,
        )
        stop_event = threading.Event()
        out: dict = {}

        with (
            patch("app.camera.shared_capture._open_capture", return_value=cap_mock),
            patch("app.camera.shared_capture.cv2.VideoWriter", return_value=writer_mock),
            patch("app.camera.recorder._open_capture") as recorder_open_cap,
        ):
            # Start the global shared_front_camera
            shared_capture.shared_front_camera.start("http://127.0.0.1:4747/video")

            threading.Thread(target=lambda: (time.sleep(0.05), stop_event.set()), daemon=True).start()
            _run_camera_worker(config, stop_event, tmp_path, "20261008T000000", out)

            shared_capture.shared_front_camera.stop()

            # _run_camera_worker must NOT have called recorder's _open_capture
            recorder_open_cap.assert_not_called()
            assert CameraRole.FRONT in out
            assert out[CameraRole.FRONT].frame_count > 0

    @pytest.mark.asyncio
    async def test_stream_generator_multipart_format(self):
        import asyncio
        manager = SharedFrontCaptureManager()
        cap_mock = _make_cap_mock(opened=True)

        with patch("app.camera.shared_capture._open_capture", return_value=cap_mock):
            manager.start("http://127.0.0.1:4747/video")
            try:
                # Wait for reader thread to encode at least one frame
                await asyncio.sleep(0.05)
                gen = manager.get_stream_generator()
                chunk = await anext(gen)
                await gen.aclose()

                assert b"--frame\r\n" in chunk
                assert b"Content-Type: image/jpeg\r\n" in chunk
                assert b"Content-Length: " in chunk
                assert b"\xff\xd8" in chunk
            finally:
                manager.stop()

    def test_draw_pose_skeleton_draws_lines_and_keypoints(self):
        from app.camera.shared_capture import draw_pose_skeleton
        from app.pose.pose_detector import COCO_KEYPOINT_NAMES, Keypoint, PoseResult

        kps = [
            Keypoint(
                name=name,
                index=i,
                x_px=100.0 + i * 5,
                y_px=150.0 + i * 5,
                x_norm=0.2,
                y_norm=0.3,
                confidence=0.9,
            )
            for i, name in enumerate(COCO_KEYPOINT_NAMES)
        ]
        pose = PoseResult(
            person_index=0,
            bbox_xyxy=(50.0, 50.0, 250.0, 450.0),
            confidence=0.95,
            keypoints=kps,
            image_width=640,
            image_height=480,
        )

        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        assert np.all(frame == 0)

        draw_pose_skeleton(frame, pose)
        # Frame should now have drawn non-zero pixels
        assert np.any(frame > 0)

        # None pose should be safe no-op
        draw_pose_skeleton(frame, None)
