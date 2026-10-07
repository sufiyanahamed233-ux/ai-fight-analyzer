"""
shared_capture.py
-----------------
Thread-safe singleton manager for the Phone 1 (127.0.0.1:4747/video) capture.

Guarantees that at most ONE cv2.VideoCapture handle owns Phone 1 at any time.
Shares incoming frames simultaneously between:
  1. The live browser MJPEG stream (GET /api/v1/stream/front)
  2. The 10-second fight recorder / VideoWriter (POST /api/v1/fight/analyze)

When the fight concludes, releases the capture cleanly so consecutive runs
can reopen Phone 1 without connection lockups.
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from pathlib import Path
from typing import AsyncGenerator, Optional, Union

import cv2
import numpy as np

from app.camera.recorder import (
    DEFAULT_FRONT_URL,
    DEFAULT_ROTATION,
    TARGET_FPS,
    TARGET_HEIGHT,
    TARGET_WIDTH,
    _FOURCC,
    CameraConfig,
    CameraResult,
    CameraRole,
    _open_capture,
    rotate_frame,
)

logger = logging.getLogger(__name__)


class SharedFrontCaptureManager:
    """Manages a single OpenCV VideoCapture for Phone 1."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._cap: Optional[cv2.VideoCapture] = None
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._source: Union[int, str] = DEFAULT_FRONT_URL
        self._rotation: int = DEFAULT_ROTATION
        self._width: int = TARGET_WIDTH
        self._height: int = TARGET_HEIGHT
        self._fps: float = TARGET_FPS

        self._raw_width: int = TARGET_WIDTH
        self._raw_height: int = TARGET_HEIGHT
        self._actual_fps: float = TARGET_FPS

        # Latest frame data for live stream
        self._latest_jpeg: Optional[bytes] = None
        self._latest_frame: Optional[np.ndarray] = None
        self._frame_seq: int = 0

        # Recording state
        self._is_recording = False
        self._record_writer: Optional[cv2.VideoWriter] = None
        self._record_timestamps: list[float] = []
        self._record_start_time: float = 0.0
        self._record_lock = threading.Lock()

    @property
    def is_running(self) -> bool:
        with self._lock:
            return self._cap is not None and self._cap.isOpened() and not self._stop_event.is_set()

    @property
    def source(self) -> Union[int, str]:
        with self._lock:
            return self._source

    def start(
        self,
        source: Union[int, str] = DEFAULT_FRONT_URL,
        rotation: int = DEFAULT_ROTATION,
        width: int = TARGET_WIDTH,
        height: int = TARGET_HEIGHT,
        fps: float = TARGET_FPS,
    ) -> bool:
        """Start the shared capture if not already running."""
        with self._lock:
            if self._cap is not None and self._cap.isOpened() and not self._stop_event.is_set():
                logger.debug("SharedFrontCapture already active on %s", self._source)
                return True

            self._source = source
            self._rotation = rotation
            self._width = width
            self._height = height
            self._fps = fps
            self._stop_event.clear()
            self._latest_jpeg = None
            self._latest_frame = None
            self._frame_seq = 0

            logger.info("Opening shared front camera capture on %s...", source)
            cap = _open_capture(source)
            if not cap.isOpened():
                logger.error("Failed to open shared front camera on %s", source)
                cap.release()
                self._cap = None
                return False

            cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
            cap.set(cv2.CAP_PROP_FPS, fps)

            self._raw_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or width
            self._raw_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or height
            meas_fps = cap.get(cv2.CAP_PROP_FPS)
            self._actual_fps = meas_fps if (meas_fps and meas_fps > 0) else fps

            self._cap = cap
            self._thread = threading.Thread(
                target=self._reader_loop,
                name="cam-front-shared-reader",
                daemon=True,
            )
            self._thread.start()
            logger.info("Shared front camera reader thread started on %s.", source)
            return True

    def _reader_loop(self) -> None:
        """Continuously read frames from the single capture."""
        while not self._stop_event.is_set():
            cap = self._cap
            if cap is None:
                break

            ret, frame = cap.read()
            if not ret or frame is None:
                time.sleep(0.01)
                continue

            processed_frame = rotate_frame(frame, self._rotation)

            # Encode JPEG for live browser stream (quality=70 for fast low-latency streaming)
            ret_enc, enc = cv2.imencode(
                ".jpg",
                processed_frame,
                [int(cv2.IMWRITE_JPEG_QUALITY), 70],
            )
            jpeg_bytes = enc.tobytes() if ret_enc else None

            with self._lock:
                self._latest_frame = processed_frame
                self._latest_jpeg = jpeg_bytes
                self._frame_seq += 1

            # If recording is active, write frame and timestamp
            with self._record_lock:
                if self._is_recording and self._record_writer is not None:
                    self._record_writer.write(processed_frame)
                    self._record_timestamps.append(time.monotonic() - self._record_start_time)

    def get_latest_jpeg(self) -> Optional[bytes]:
        with self._lock:
            return self._latest_jpeg

    async def get_stream_generator(self) -> AsyncGenerator[bytes, None]:
        """Yield multipart MJPEG frames for FastAPI StreamingResponse."""
        last_seq = -1
        try:
            while self.is_running:
                jpeg = None
                with self._lock:
                    if self._frame_seq != last_seq and self._latest_jpeg is not None:
                        jpeg = self._latest_jpeg
                        last_seq = self._frame_seq

                if jpeg is not None:
                    header = (
                        b"--frame\r\n"
                        b"Content-Type: image/jpeg\r\n"
                        b"Content-Length: " + str(len(jpeg)).encode("ascii") + b"\r\n\r\n"
                    )
                    yield header + jpeg + b"\r\n"
                await asyncio.sleep(1.0 / 30.0)
        except (asyncio.CancelledError, GeneratorExit):
            pass

    def start_recording(self, writer: cv2.VideoWriter) -> None:
        """Activate writing incoming frames to writer."""
        with self._record_lock:
            self._record_writer = writer
            self._record_timestamps = []
            self._record_start_time = time.monotonic()
            self._is_recording = True
        logger.info("Shared front camera recording activated.")

    def record_to_session(
        self,
        config: CameraConfig,
        stop_event: threading.Event,
        session_dir: Path,
        ts_prefix: str,
    ) -> CameraResult:
        """
        Record frames from this already-running shared capture to an AVI file
        until stop_event is set.
        """
        result = CameraResult(
            role=config.role,
            index=config.index if config.index is not None else config.source,
            source=config.source,
            rotation=config.rotation,
        )

        raw_w = self._raw_width or config.width
        raw_h = self._raw_height or config.height
        actual_fps = self._actual_fps or config.fps

        if config.rotation in (90, 270):
            writer_w, writer_h = raw_h, raw_w
        else:
            writer_w, writer_h = raw_w, raw_h

        result.actual_width = writer_w
        result.actual_height = writer_h
        result.actual_fps = actual_fps

        session_dir.mkdir(parents=True, exist_ok=True)
        video_path = session_dir / f"{config.role.value}_{ts_prefix}.avi"
        writer = cv2.VideoWriter(str(video_path), _FOURCC, config.fps, (writer_w, writer_h))

        self.start_recording(writer)

        # Wait until stop_event is set
        stop_event.wait()

        # Stop recording and extract result
        with self._record_lock:
            self._is_recording = False
            rec_writer = self._record_writer
            self._record_writer = None
            timestamps = list(self._record_timestamps)

        if rec_writer is not None:
            rec_writer.release()

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
        if not timestamps:
            result.error = "No frames recorded from shared front camera"

        logger.info(
            "Shared front camera recorded %d frames in session %s",
            len(timestamps),
            session_dir.name,
        )
        return result

    def stop(self) -> None:
        """Stop the reader thread and release the OpenCV capture cleanly."""
        with self._lock:
            self._stop_event.set()
            thread = self._thread
            cap = self._cap
            self._thread = None
            self._cap = None
            self._latest_jpeg = None
            self._latest_frame = None

        with self._record_lock:
            self._is_recording = False
            if self._record_writer is not None:
                self._record_writer.release()
                self._record_writer = None

        if thread is not None and thread.is_alive():
            thread.join(timeout=2.0)

        if cap is not None:
            try:
                cap.release()
                logger.info("Shared front camera capture released cleanly.")
            except Exception as exc:
                logger.warning("Error releasing shared front camera capture: %s", exc)


shared_front_camera = SharedFrontCaptureManager()
