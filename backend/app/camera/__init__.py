# AI Fight Analyzer - Camera Package

from app.camera.camera_manager import (
    CameraInfo,
    DiscoveryResult,
    check_droidcam_port,
    discover_cameras,
    discover_droidcam_streams,
    probe_stream,
)
from app.camera.recorder import (
    DEFAULT_FRONT_URL,
    DEFAULT_ROTATION,
    DEFAULT_SIDE_URL,
    TARGET_FPS,
    TARGET_HEIGHT,
    TARGET_WIDTH,
    CameraConfig,
    CameraResult,
    CameraRole,
    DualCameraRecorder,
    RecordingSession,
    rotate_frame,
)

__all__ = [
    "CameraInfo",
    "DiscoveryResult",
    "check_droidcam_port",
    "discover_cameras",
    "discover_droidcam_streams",
    "probe_stream",
    "DEFAULT_FRONT_URL",
    "DEFAULT_SIDE_URL",
    "TARGET_WIDTH",
    "TARGET_HEIGHT",
    "TARGET_FPS",
    "DEFAULT_ROTATION",
    "CameraConfig",
    "CameraResult",
    "CameraRole",
    "DualCameraRecorder",
    "RecordingSession",
    "rotate_frame",
]
