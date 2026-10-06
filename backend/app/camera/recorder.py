"""
recorder.py
-----------
Dual-camera software-synchronized capture for AI Fight Analyzer.

Responsibilities (this file only):
  - Open Camera 0 (FRONT) and Camera 1 (SIDE) via OpenCV
  - Capture frames from both cameras concurrently using threads
  - Attach a monotonic software timestamp to every frame
  - Write each camera stream to its own video file (AVI/XVID)
  - Save per-camera timestamp manifests so the pose layer can align frames
  - Release both cameras cleanly under all failure conditions

Nothing here handles pose estimation, YOLO, fight scoring, streaming, or
WebSocket. The record() method is pure-sync and safe to call from a
ThreadPoolExecutor so it never blocks the FastAPI event loop.
"""

from __future__ import annotations

import json
import logging
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Optional

import cv2

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

TARGET_WIDTH: int = 640
TARGET_HEIGHT: int = 480
TARGET_FPS: float = 30.0
DEFAULT_DURATION: float = 10.0
_FOURCC = cv2.VideoWriter_fourcc(*"XVID")  # type: ignore[attr-defined]

# How long (seconds) to wait for a camera thread to finish after stop signal.
_THREAD_JOIN_TIMEOUT: float = 5.0


# ---------------------------------------------------------------------------
# Public data types
# ---------------------------------------------------------------------------


class CameraRole(str, Enum):
    FRONT = "front"
    SIDE = "side"


@dataclass
class CameraConfig:
    """Configuration for one camera in a dual-capture session."""

    index: int
    role: CameraRole
    width: int = TARGET_WIDTH
    height: int = TARGET_HEIGHT
    fps: float = TARGET_FPS


@dataclass
class CameraResult:
    """Outcome of recording from a single camera."""

    role: CameraRole
    index: int
    frame_count: int = 0
    video_path: Optional[Path] = None
    timestamps_path: Optional[Path] = None  # JSON manifest of per-frame timestamps
    actual_width: int = 0
    actual_height: int = 0
    actual_fps: float = 0.0
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


def _open_capture(index: int) -> cv2.VideoCapture:  # type: ignore[name-defined]
    """Try CAP_DSHOW first (Windows), fall back to default backend."""
    cap = cv2.VideoCapture(index, cv2.CAP_DSHOW)
    if not cap.isOpened():
        cap.release()
        cap = cv2.VideoCapture(index)
    return cap


def _run_camera_worker(
    config: CameraConfig,
    stop_event: threading.Event,
    session_dir: Path,
    ts_prefix: str,
    out: dict,  # mutable result bucket keyed by CameraRole
) -> None:
    """
    Thread target: continuously read frames from one camera until *stop_event*
    is set, write them to a VideoWriter, and record per-frame timestamps.

    Results are deposited into *out[config.role]* as a :class:`CameraResult`.
    """
    result = CameraResult(role=config.role, index=config.index)
    cap = _open_capture(config.index)

    if not cap.isOpened():
        result.error = f"Could not open camera {config.index} ({config.role.value})"
        out[config.role] = result
        logger.error(result.error)
        return

    # Request target resolution / fps (best-effort — camera may ignore it).
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, config.width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, config.height)
    cap.set(cv2.CAP_PROP_FPS, config.fps)

    actual_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    actual_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    actual_fps = cap.get(cv2.CAP_PROP_FPS) or config.fps

    result.actual_width = actual_w
    result.actual_height = actual_h
    result.actual_fps = actual_fps

    video_path = session_dir / f"{config.role.value}_{ts_prefix}.avi"
    writer = cv2.VideoWriter(str(video_path), _FOURCC, config.fps, (actual_w, actual_h))

    timestamps: list[float] = []  # monotonic seconds relative to session start

    t_start = time.monotonic()

    try:
        while not stop_event.is_set():
            ret, frame = cap.read()
            if not ret or frame is None:
                logger.debug("Camera %d (%s): missed frame", config.index, config.role.value)
                continue
            writer.write(frame)
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
                    "camera_index": config.index,
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
        "Camera %d (%s): %d frames in %.2fs",
        config.index,
        config.role.value,
        len(timestamps),
        timestamps[-1] if timestamps else 0.0,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


class DualCameraRecorder:
    """
    Software-synchronized dual-camera recorder.

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
        front_index: int = 0,
        side_index: int = 1,
        duration: float = DEFAULT_DURATION,
        width: int = TARGET_WIDTH,
        height: int = TARGET_HEIGHT,
        fps: float = TARGET_FPS,
        output_dir: Optional[Path] = None,
    ) -> None:
        self.front_config = CameraConfig(
            index=front_index, role=CameraRole.FRONT, width=width, height=height, fps=fps
        )
        self.side_config = CameraConfig(
            index=side_index, role=CameraRole.SIDE, width=width, height=height, fps=fps
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
            name="cam-front",
            daemon=True,
        )
        side_thread = threading.Thread(
            target=_run_camera_worker,
            args=(self.side_config, stop_event, session_dir, ts_prefix, out),
            name="cam-side",
            daemon=True,
        )

        t_start = time.monotonic()
        logger.info("Recording session %s starting (%.1fs)…", session_id, self.duration)

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
            index=self.front_config.index,
            error="Camera thread did not report a result",
        )
        _fallback_side = CameraResult(
            role=CameraRole.SIDE,
            index=self.side_config.index,
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
