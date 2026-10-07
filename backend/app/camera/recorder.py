"""
recorder.py
-----------
Dual-camera software-synchronized capture for AI Fight Analyzer.

Responsibilities (this file only):
  - Connect to FRONT (http://127.0.0.1:4747/video) and SIDE (http://127.0.0.1:4748/video)
    MJPEG streams via OpenCV (or fallback camera indexes/devices)
  - Capture frames from both cameras concurrently using independent reader threads
  - Apply configurable per-camera rotation (default 90 degrees for portrait-mounted phones)
  - Attach a monotonic software timestamp to every frame
  - Write each camera stream to its own video file (AVI/XVID) with updated dimensions
  - Save per-camera timestamp manifests so the pose layer can align frames
  - Release both cameras cleanly under all failure conditions

Nothing here handles pose estimation, YOLO, fight scoring, streaming, or
WebSocket. The record() method is pure-sync and safe to call from a
ThreadPoolExecutor so it never blocks the FastAPI event loop.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Optional, Union

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants & Defaults
# ---------------------------------------------------------------------------

DEFAULT_FRONT_URL: str = os.getenv("DROIDCAM_FRONT_URL", "http://127.0.0.1:4747/video")
DEFAULT_SIDE_URL: str = os.getenv("DROIDCAM_SIDE_URL", "http://127.0.0.1:4748/video")

TARGET_WIDTH: int = 1280
TARGET_HEIGHT: int = 720
TARGET_FPS: float = 30.0
DEFAULT_ROTATION: int = 90  # 90 degrees clockwise (portrait phone mount)
DEFAULT_DURATION: float = 10.0
_FOURCC = cv2.VideoWriter_fourcc(*"XVID")  # type: ignore[attr-defined]

# How long (seconds) to wait for a camera thread to finish after stop signal.
_THREAD_JOIN_TIMEOUT: float = 5.0


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------


def rotate_frame(frame: Any, rotation: int) -> Any:
    """Rotate a frame by 0, 90, 180, or 270 degrees clockwise.

    Gracefully passes through non-numpy objects (such as test mocks) and rotation=0.
    """
    if not isinstance(frame, np.ndarray) or rotation == 0:
        return frame
    if rotation == 90:
        return cv2.rotate(frame, cv2.ROTATE_90_CLOCKWISE)
    elif rotation == 180:
        return cv2.rotate(frame, cv2.ROTATE_180)
    elif rotation == 270:
        return cv2.rotate(frame, cv2.ROTATE_90_COUNTERCLOCKWISE)
    return frame


# ---------------------------------------------------------------------------
# Public data types
# ---------------------------------------------------------------------------


class CameraRole(str, Enum):
    FRONT = "front"
    SIDE = "side"


@dataclass
class CameraConfig:
    """Configuration for one camera in a dual-capture session."""

    source: Union[int, str] = DEFAULT_FRONT_URL
    role: CameraRole = CameraRole.FRONT
    width: int = TARGET_WIDTH
    height: int = TARGET_HEIGHT
    fps: float = TARGET_FPS
    rotation: int = DEFAULT_ROTATION
    index: Optional[Union[int, str]] = None

    def __post_init__(self) -> None:
        # If legacy index was provided and source was left at default, use index as source
        if self.index is not None and (
            self.source == DEFAULT_FRONT_URL
            or self.source == 0
            or self.source is None
        ):
            self.source = self.index
        elif self.index is None:
            self.index = self.source


@dataclass
class CameraResult:
    """Outcome of recording from a single camera."""

    role: CameraRole
    index: Union[int, str] = 0
    source: Union[int, str] = 0
    frame_count: int = 0
    video_path: Optional[Path] = None
    timestamps_path: Optional[Path] = None  # JSON manifest of per-frame timestamps
    actual_width: int = 0
    actual_height: int = 0
    actual_fps: float = 0.0
    rotation: int = 0
    error: Optional[str] = None

    @property
    def success(self) -> bool:
        return self.error is None and self.frame_count > 0


@dataclass
class RecordingSession:
    """Complete result of a dual-camera recording session."""

    session_id: str
    output_dir: Path
    front: CameraResult
    side: CameraResult
    elapsed_seconds: float
    started_at: str  # ISO-8601 UTC

    @property
    def success(self) -> bool:
        return self.front.success and self.side.success

    @property
    def error(self) -> Optional[str]:
        errors = [r.error for r in (self.front, self.side) if r.error]
        return "; ".join(errors) if errors else None


# ---------------------------------------------------------------------------
# Internal worker
# ---------------------------------------------------------------------------


def _open_capture(source: Union[int, str]) -> cv2.VideoCapture:  # type: ignore[name-defined]
    """Open camera source: MJPEG HTTP URL or camera index with DirectShow fallback."""
    if isinstance(source, str) and (
        source.startswith("http://")
        or source.startswith("https://")
        or source.startswith("rtsp://")
    ):
        return cv2.VideoCapture(source)

    if isinstance(source, int) or (isinstance(source, str) and source.isdigit()):
        idx = int(source)
        cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
        if not cap.isOpened():
            cap.release()
            cap = cv2.VideoCapture(idx)
        return cap

    return cv2.VideoCapture(source)


def _run_camera_worker(
    config: CameraConfig,
    stop_event: threading.Event,
    session_dir: Path,
    ts_prefix: str,
    out: dict,  # mutable result bucket keyed by CameraRole
) -> None:
    """
    Thread target: continuously read frames from one camera until *stop_event*
    is set, apply rotation, write to a VideoWriter, and record per-frame timestamps.

    Results are deposited into *out[config.role]* as a :class:`CameraResult`.
    """
    result = CameraResult(
        role=config.role,
        index=config.index if config.index is not None else config.source,
        source=config.source,
        rotation=config.rotation,
    )
    cap = _open_capture(config.source)

    if not cap.isOpened():
        result.error = f"Could not open camera {config.source} ({config.role.value})"
        out[config.role] = result
        logger.error(result.error)
        return

    # Request target resolution / fps (best-effort — stream/driver may ignore it).
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, config.width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, config.height)
    cap.set(cv2.CAP_PROP_FPS, config.fps)

    raw_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or config.width
    raw_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or config.height
    actual_fps = cap.get(cv2.CAP_PROP_FPS) or config.fps

    # Swap output width and height when rotating by 90 or 270 degrees
    if config.rotation in (90, 270):
        writer_w, writer_h = raw_h, raw_w
    else:
        writer_w, writer_h = raw_w, raw_h

    result.actual_width = writer_w
    result.actual_height = writer_h
    result.actual_fps = actual_fps

    video_path = session_dir / f"{config.role.value}_{ts_prefix}.avi"
    writer = cv2.VideoWriter(str(video_path), _FOURCC, config.fps, (writer_w, writer_h))

    timestamps: list[float] = []  # monotonic seconds relative to session start

    t_start = time.monotonic()

    try:
        while not stop_event.is_set():
            ret, frame = cap.read()
            if not ret or frame is None:
                logger.debug("Camera %s (%s): missed frame", config.source, config.role.value)
                continue

            processed_frame = rotate_frame(frame, config.rotation)
            writer.write(processed_frame)
            timestamps.append(time.monotonic() - t_start)
    finally:
        cap.release()
        writer.release()

    # Save timestamp manifest so the pose layer can align frames across cameras.
    ts_path: Optional[Path] = None
    if timestamps:
        ts_path = session_dir / f"{config.role.value}_{ts_prefix}_timestamps.json"
        ts_path.write_text(
            json.dumps(
                {
                    "role": config.role.value,
                    "source": str(config.source),
                    "camera_index": config.index,
                    "rotation": config.rotation,
                    "frame_count": len(timestamps),
                    "timestamps_s": timestamps,
                }
            )
        )

    result.frame_count = len(timestamps)
    result.video_path = video_path if timestamps else None
    result.timestamps_path = ts_path
    out[config.role] = result

    logger.info(
        "Camera %s (%s): %d frames in %.2fs (rotation=%d°)",
        config.source,
        config.role.value,
        len(timestamps),
        timestamps[-1] if timestamps else 0.0,
        config.rotation,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


class DualCameraRecorder:
    """
    Software-synchronized dual-camera recorder.

    Supports both DroidCam MJPEG streams (defaulting to http://127.0.0.1:4747/video
    and http://127.0.0.1:4748/video) and local camera indexes.
    Each camera runs in an independent thread so network stalls in one stream
    cannot block or degrade the other.

    Usage (sync — safe to run in a thread pool from async FastAPI code)::

        recorder = DualCameraRecorder(duration=10.0)
        session = recorder.record()
        print(session.front.video_path)

    Async usage example (non-blocking)::

        import asyncio, concurrent.futures
        loop = asyncio.get_event_loop()
        with concurrent.futures.ThreadPoolExecutor() as pool:
            session = await loop.run_in_executor(pool, recorder.record)
    """

    def __init__(
        self,
        front_source: Union[int, str] = DEFAULT_FRONT_URL,
        side_source: Union[int, str] = DEFAULT_SIDE_URL,
        duration: float = DEFAULT_DURATION,
        width: int = TARGET_WIDTH,
        height: int = TARGET_HEIGHT,
        fps: float = TARGET_FPS,
        output_dir: Optional[Path] = None,
        front_rotation: int = DEFAULT_ROTATION,
        side_rotation: int = DEFAULT_ROTATION,
        front_index: Optional[Union[int, str]] = None,
        side_index: Optional[Union[int, str]] = None,
    ) -> None:
        actual_front = front_index if front_index is not None else front_source
        actual_side = side_index if side_index is not None else side_source

        self.front_config = CameraConfig(
            source=actual_front,
            role=CameraRole.FRONT,
            width=width,
            height=height,
            fps=fps,
            rotation=front_rotation,
            index=actual_front,
        )
        self.side_config = CameraConfig(
            source=actual_side,
            role=CameraRole.SIDE,
            width=width,
            height=height,
            fps=fps,
            rotation=side_rotation,
            index=actual_side,
        )
        self.duration = duration
        self._base_output_dir = output_dir or Path(tempfile.gettempdir()) / "ai_fight_sessions"

    def record(self) -> RecordingSession:
        """
        Run a dual-camera recording session synchronously.

        Opens both cameras in parallel threads, records for *self.duration*
        seconds, then signals both threads to stop and waits for clean shutdown.
        Both cameras are released even if one fails.

        Returns
        -------
        RecordingSession
            Contains per-camera results, file paths, frame counts, and timing.
        """
        session_id = uuid.uuid4().hex[:10]
        session_dir = self._base_output_dir / session_id
        session_dir.mkdir(parents=True, exist_ok=True)

        ts_prefix = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
        started_at = datetime.now(timezone.utc).isoformat()

        stop_event = threading.Event()
        out: dict[CameraRole, CameraResult] = {}

        front_thread = threading.Thread(
            target=_run_camera_worker,
            args=(self.front_config, stop_event, session_dir, ts_prefix, out),
            name="cam-front-reader",
            daemon=True,
        )
        side_thread = threading.Thread(
            target=_run_camera_worker,
            args=(self.side_config, stop_event, session_dir, ts_prefix, out),
            name="cam-side-reader",
            daemon=True,
        )

        t_start = time.monotonic()
        logger.info(
            "Recording session %s starting (%.1fs) [Front: %s, Side: %s]…",
            session_id,
            self.duration,
            self.front_config.source,
            self.side_config.source,
        )

        front_thread.start()
        side_thread.start()

        time.sleep(self.duration)
        stop_event.set()

        front_thread.join(timeout=_THREAD_JOIN_TIMEOUT)
        side_thread.join(timeout=_THREAD_JOIN_TIMEOUT)

        elapsed = time.monotonic() - t_start

        # Fill in a failure result for any camera that never reported back.
        _fallback_front = CameraResult(
            role=CameraRole.FRONT,
            index=self.front_config.index if self.front_config.index is not None else self.front_config.source,
            source=self.front_config.source,
            rotation=self.front_config.rotation,
            error="Camera thread did not report a result",
        )
        _fallback_side = CameraResult(
            role=CameraRole.SIDE,
            index=self.side_config.index if self.side_config.index is not None else self.side_config.source,
            source=self.side_config.source,
            rotation=self.side_config.rotation,
            error="Camera thread did not report a result",
        )

        session = RecordingSession(
            session_id=session_id,
            output_dir=session_dir,
            front=out.get(CameraRole.FRONT, _fallback_front),
            side=out.get(CameraRole.SIDE, _fallback_side),
            elapsed_seconds=elapsed,
            started_at=started_at,
        )

        logger.info(
            "Session %s done: front=%d frames, side=%d frames, elapsed=%.2fs",
            session_id,
            session.front.frame_count,
            session.side.frame_count,
            elapsed,
        )
        return session
