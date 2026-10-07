"""
test_camera_manager.py
----------------------
Unit tests for the camera discovery module.

All tests mock cv2.VideoCapture so no physical webcam is required.
"""

from __future__ import annotations

from unittest.mock import MagicMock, call, patch

import pytest

from app.camera.camera_manager import (
    CameraInfo,
    DiscoveryResult,
    _probe_index,
    discover_cameras,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_cap(opened: bool = True, read_ok: bool = True, width: float = 640.0, height: float = 480.0):
    """Return a MagicMock that mimics a cv2.VideoCapture instance."""
    cap = MagicMock()
    cap.isOpened.return_value = opened
    frame = MagicMock()
    frame.size = 640 * 480 * 3 if read_ok else 0
    cap.read.return_value = (read_ok, frame if read_ok else None)
    cap.get.side_effect = lambda prop: {
        0: width,   # CAP_PROP_FRAME_WIDTH  == 3
        1: height,  # CAP_PROP_FRAME_HEIGHT == 4
    }.get(prop % 2, 0.0)
    cap.getBackendName.return_value = "DSHOW"
    return cap


# ---------------------------------------------------------------------------
# _probe_index
# ---------------------------------------------------------------------------

class TestProbeIndex:
    def test_available_with_good_frame(self):
        """Camera that opens and returns a valid frame → available=True, frame_read=True."""
        cap = _make_cap(opened=True, read_ok=True)
        with patch("app.camera.camera_manager.cv2.VideoCapture", return_value=cap):
            info = _probe_index(0)

        assert info.available is True
        assert info.frame_read is True
        assert info.error is None
        cap.release.assert_called_once()

    def test_available_but_no_frame(self):
        """Camera opens but read fails → available=True, frame_read=False."""
        cap = _make_cap(opened=True, read_ok=False)
        with patch("app.camera.camera_manager.cv2.VideoCapture", return_value=cap):
            info = _probe_index(1)

        assert info.available is True
        assert info.frame_read is False
        assert info.error is not None
        cap.release.assert_called_once()

    def test_unavailable_camera(self):
        """Camera that never opens → available=False."""
        cap = _make_cap(opened=False)
        with patch("app.camera.camera_manager.cv2.VideoCapture", return_value=cap):
            info = _probe_index(2)

        assert info.available is False
        assert info.frame_read is False
        # release must still be called on every handle created
        assert cap.release.call_count >= 1

    def test_release_always_called(self):
        """Ensure release() is called even when the camera errors."""
        cap = _make_cap(opened=False)
        with patch("app.camera.camera_manager.cv2.VideoCapture", return_value=cap):
            _probe_index(3)

        assert cap.release.called


# ---------------------------------------------------------------------------
# discover_cameras
# ---------------------------------------------------------------------------

class TestDiscoverCameras:
    def _patched_probe(self, available_indexes: set[int]):
        """Return a side_effect function that mimics _probe_index results."""
        def _fake_probe(index: int, backend: int = 0) -> CameraInfo:
            available = index in available_indexes
            return CameraInfo(
                index=index,
                available=available,
                frame_read=available,
            )
        return _fake_probe

    def test_finds_available_cameras(self):
        """Cameras at indexes 0 and 1 are available; 2+ are not."""
        with patch(
            "app.camera.camera_manager._probe_index",
            side_effect=self._patched_probe({0, 1}),
        ):
            result = discover_cameras(max_index=8, consecutive_fail_limit=3)

        available_indexes = [c.index for c in result.available]
        assert 0 in available_indexes
        assert 1 in available_indexes

    def test_early_stop_on_consecutive_failures(self):
        """Discovery stops after consecutive_fail_limit consecutive failures."""
        with patch(
            "app.camera.camera_manager._probe_index",
            side_effect=self._patched_probe(set()),  # nothing available
        ) as mock_probe:
            result = discover_cameras(max_index=8, consecutive_fail_limit=3)

        # Should stop after 3 failures (indexes 0, 1, 2)
        assert mock_probe.call_count == 3
        assert len(result.available) == 0

    def test_no_cameras_available(self):
        """All cameras unavailable → DiscoveryResult.available is empty."""
        with patch(
            "app.camera.camera_manager._probe_index",
            side_effect=self._patched_probe(set()),
        ):
            result = discover_cameras(max_index=2, consecutive_fail_limit=10)

        assert result.available == []
        assert len(result.unavailable) > 0

    def test_discovery_result_properties(self):
        """DiscoveryResult.available and .unavailable are computed correctly."""
        result = DiscoveryResult(
            probed=[
                CameraInfo(index=0, available=True, frame_read=True),
                CameraInfo(index=1, available=False),
                CameraInfo(index=2, available=True, frame_read=True),
            ]
        )
        assert len(result.available) == 2
        assert len(result.unavailable) == 1

    def test_returns_discovery_result_type(self):
        with patch(
            "app.camera.camera_manager._probe_index",
            side_effect=self._patched_probe(set()),
        ):
            result = discover_cameras(max_index=2, consecutive_fail_limit=10)

        assert isinstance(result, DiscoveryResult)


# ---------------------------------------------------------------------------
# Stream and DroidCam Discovery Tests
# ---------------------------------------------------------------------------

class TestStreamDiscovery:
    def test_probe_stream_success(self):
        from app.camera.camera_manager import probe_stream

        cap = _make_cap(opened=True, read_ok=True)
        with patch("app.camera.camera_manager.cv2.VideoCapture", return_value=cap):
            info = probe_stream("http://127.0.0.1:4747/video")

        assert info.available is True
        assert info.frame_read is True
        assert info.source == "http://127.0.0.1:4747/video"
        cap.release.assert_called_once()

    def test_probe_stream_failure(self):
        from app.camera.camera_manager import probe_stream

        cap = _make_cap(opened=False)
        with patch("app.camera.camera_manager.cv2.VideoCapture", return_value=cap):
            info = probe_stream("http://127.0.0.1:4747/video")

        assert info.available is False
        assert info.frame_read is False
        assert "Could not open" in (info.error or "")

    def test_check_droidcam_port_success(self):
        from app.camera.camera_manager import check_droidcam_port

        with patch("socket.create_connection") as mock_conn:
            mock_conn.return_value.__enter__.return_value = MagicMock()
            assert check_droidcam_port("127.0.0.1", 4747) is True

    def test_check_droidcam_port_failure(self):
        from app.camera.camera_manager import check_droidcam_port

        with patch("socket.create_connection", side_effect=OSError("Connection refused")):
            assert check_droidcam_port("127.0.0.1", 4747) is False

    def test_discover_droidcam_streams(self):
        from app.camera.camera_manager import discover_droidcam_streams

        cap1 = _make_cap(opened=True, read_ok=True)
        cap2 = _make_cap(opened=True, read_ok=True)

        with patch("app.camera.camera_manager.cv2.VideoCapture", side_effect=[cap1, cap2]):
            streams = discover_droidcam_streams()

        assert "front" in streams
        assert "side" in streams
        assert streams["front"].available is True
        assert streams["side"].available is True

