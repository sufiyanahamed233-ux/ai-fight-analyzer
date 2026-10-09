"""
stream_router.py
----------------
Provides the shared front-camera MJPEG stream to the exhibition frontend.

Routes
------
GET /api/v1/stream/front/status   → JSON availability check (non-blocking)
GET /api/v1/stream/front          → MJPEG stream (multipart/x-mixed-replace)
GET /api/v1/stream/front/stop     → signal stream to stop

Source priority
---------------
1. DroidCam MJPEG stream at http://127.0.0.1:4747/video
2. OpenCV local camera index 0 (USB / built-in webcam)

The stream is served as MJPEG so the calibration <img> element and the
Live Fight <img> element can both consume it without WebRTC or getUserMedia.

SharedFrontCaptureManager
--------------------------
A module-level singleton opens the camera/stream once and shares it across
all connected HTTP clients.  This prevents multiple concurrent VideoCapture
opens from competing for the same device.
"""

from __future__ import annotations

import asyncio
import logging
import time
import threading
import uuid
from typing import AsyncGenerator, Optional

import cv2
import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse, StreamingResponse

logger = logging.getLogger(__name__)

router = APIRouter()

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DROIDCAM_URL = "http://127.0.0.1:4747/video"   # DroidCam MJPEG stream
DROIDCAM_STATUS_URL = "http://127.0.0.1:4747"  # Used for availability probe
LOCAL_CAM_INDEX = 1                              # Fallback: DroidCam camera index 1 (DroidCam Video)
JPEG_QUALITY = 80
TARGET_FPS = 30
_FRAME_SLEEP = 1.0 / TARGET_FPS


# ---------------------------------------------------------------------------
# SharedFrontCaptureManager
# ---------------------------------------------------------------------------

class SharedFrontCaptureManager:
    """
    Singleton that owns one camera/stream connection and distributes frames
    to all subscribers via a shared buffer.

    Thread-safety: all writes to _latest_frame are protected by _lock.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._latest_frame: Optional[bytes] = None    # latest JPEG bytes
        self._source: Optional[str] = None            # 'droidcam' | 'local'
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._cap: Optional[cv2.VideoCapture] = None  # local webcam capture
        self._stop_event = threading.Event()

    # ------------------------------------------------------------------ #
    # Public API                                                           #
    # ------------------------------------------------------------------ #

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def source(self) -> Optional[str]:
        return self._source

    def get_latest_frame(self) -> Optional[bytes]:
        with self._lock:
            return self._latest_frame

    def start(self) -> bool:
        """Start the capture loop. Returns True if started successfully."""
        if self._running:
            return True
        self._stop_event.clear()

        # Try DroidCam first, then local webcam
        if self._try_droidcam():
            self._source = "droidcam"
            self._thread = threading.Thread(
                target=self._droidcam_loop, daemon=True, name="stream-droidcam"
            )
        elif self._try_local_cam():
            self._source = "local"
            self._thread = threading.Thread(
                target=self._local_cam_loop, daemon=True, name="stream-localcam"
            )
        else:
            logger.warning("SharedFrontCaptureManager: no camera source available.")
            return False

        self._running = True
        self._thread.start()
        logger.info("SharedFrontCaptureManager started (source=%s)", self._source)
        return True

    def stop(self) -> None:
        """Signal the capture thread to stop."""
        self._stop_event.set()
        self._running = False
        if self._cap:
            try:
                self._cap.release()
            except Exception:
                pass
            self._cap = None
        with self._lock:
            self._latest_frame = None
        self._source = None
        logger.info("SharedFrontCaptureManager stopped.")

    # ------------------------------------------------------------------ #
    # Source probes                                                        #
    # ------------------------------------------------------------------ #

    def _try_droidcam(self) -> bool:
        """Returns True if DroidCam MJPEG stream responds within 2 seconds."""
        try:
            with httpx.Client(timeout=2.0) as client:
                r = client.get(DROIDCAM_STATUS_URL)
                return r.status_code < 500
        except Exception:
            return False

    def _try_local_cam(self) -> bool:
        """Returns True if local camera index 0 opens and can read a frame."""
        cap = cv2.VideoCapture(LOCAL_CAM_INDEX, cv2.CAP_DSHOW)
        if not cap.isOpened():
            cap.release()
            cap = cv2.VideoCapture(LOCAL_CAM_INDEX)
        if not cap.isOpened():
            return False
        ret, _ = cap.read()
        cap.release()
        return ret

    # ------------------------------------------------------------------ #
    # Capture loops (run in background threads)                            #
    # ------------------------------------------------------------------ #

    def _droidcam_loop(self) -> None:
        """Stream MJPEG from DroidCam over HTTP, decode frames, store JPEGs."""
        while not self._stop_event.is_set():
            try:
                cap = cv2.VideoCapture(DROIDCAM_URL)
                if not cap.isOpened():
                    logger.warning("DroidCam stream not openable — retrying in 2s")
                    time.sleep(2.0)
                    continue

                logger.info("DroidCam stream opened successfully.")
                while not self._stop_event.is_set():
                    ret, frame = cap.read()
                    if not ret or frame is None:
                        logger.warning("DroidCam frame read failed — reconnecting")
                        break
                    ok, buf = cv2.imencode(
                        ".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY]
                    )
                    if ok:
                        with self._lock:
                            self._latest_frame = buf.tobytes()
                    time.sleep(_FRAME_SLEEP)

                cap.release()
            except Exception as exc:
                logger.error("DroidCam loop error: %s — retrying in 2s", exc)
                time.sleep(2.0)

    def _local_cam_loop(self) -> None:
        """Read from local webcam, encode to JPEG, store in buffer."""
        while not self._stop_event.is_set():
            try:
                cap = cv2.VideoCapture(LOCAL_CAM_INDEX, cv2.CAP_DSHOW)
                if not cap.isOpened():
                    cap.release()
                    cap = cv2.VideoCapture(LOCAL_CAM_INDEX)
                if not cap.isOpened():
                    logger.warning("Local cam not available — retrying in 2s")
                    time.sleep(2.0)
                    continue

                cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
                cap.set(cv2.CAP_PROP_FPS, TARGET_FPS)

                self._cap = cap
                logger.info("Local webcam (index %d) opened.", LOCAL_CAM_INDEX)

                while not self._stop_event.is_set():
                    ret, frame = cap.read()
                    if not ret or frame is None:
                        logger.warning("Local cam frame read failed — reconnecting")
                        break
                    ok, buf = cv2.imencode(
                        ".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY]
                    )
                    if ok:
                        with self._lock:
                            self._latest_frame = buf.tobytes()
                    time.sleep(_FRAME_SLEEP)

                cap.release()
                self._cap = None
            except Exception as exc:
                logger.error("Local cam loop error: %s — retrying in 2s", exc)
                time.sleep(2.0)


# Module-level singleton
_manager = SharedFrontCaptureManager()


def _ensure_started() -> bool:
    """Start the manager if not already running. Returns availability."""
    if not _manager.is_running:
        return _manager.start()
    return True


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/stream/front/status", tags=["Camera Stream"])
async def front_stream_status() -> JSONResponse:
    """
    Non-blocking availability check for the front camera stream.

    Response shape (matches what the frontend camera.ts expects):
    {
        "available": bool,
        "source": "droidcam" | "local" | null,
        "running": bool
    }
    """
    # Run blocking probe in threadpool so we don't block the event loop
    loop = asyncio.get_event_loop()
    available = await loop.run_in_executor(None, _ensure_started)

    return JSONResponse({
        "available": available and _manager.get_latest_frame() is not None,
        "source": _manager.source,
        "running": _manager.is_running,
    })


async def _mjpeg_generator() -> AsyncGenerator[bytes, None]:
    """Async generator that yields MJPEG multipart frames."""
    boundary = b"--frameboundary"
    consecutive_empty = 0

    # Give the manager a moment to capture the first frame
    for _ in range(20):
        if _manager.get_latest_frame() is not None:
            break
        await asyncio.sleep(0.1)

    while True:
        frame_bytes = _manager.get_latest_frame()

        if frame_bytes is None:
            consecutive_empty += 1
            if consecutive_empty > 100:
                # Stream unavailable — send a tiny black placeholder JPEG
                break
            await asyncio.sleep(0.05)
            continue

        consecutive_empty = 0

        yield (
            boundary
            + b"\r\nContent-Type: image/jpeg\r\nContent-Length: "
            + str(len(frame_bytes)).encode()
            + b"\r\n\r\n"
            + frame_bytes
            + b"\r\n"
        )

        await asyncio.sleep(_FRAME_SLEEP)


@router.get("/stream/front", tags=["Camera Stream"])
async def front_stream() -> StreamingResponse:
    """
    MJPEG stream of the front camera.

    The calibration screen's <img src="/api/v1/stream/front"> and the
    Live Fight screen consume this endpoint directly.
    """
    _ensure_started()

    return StreamingResponse(
        _mjpeg_generator(),
        media_type="multipart/x-mixed-replace; boundary=frameboundary",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Access-Control-Allow-Origin": "*",
        },
    )


@router.get("/stream/front/stop", tags=["Camera Stream"])
async def front_stream_stop() -> JSONResponse:
    """Signal the shared capture manager to release the camera."""
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _manager.stop)
    return JSONResponse({"stopped": True})
