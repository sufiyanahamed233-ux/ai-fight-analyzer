"""
camera_manager.py
-----------------
Discovers and tests physical camera hardware using OpenCV.

Responsibilities (this file only):
  - Enumerate candidate camera indexes
  - Attempt to open each camera via cv2.VideoCapture
  - Read one test frame to confirm the camera streams data
  - Release every capture handle cleanly

Nothing here handles pose estimation, recording, streaming, or fight analysis.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Optional

import cv2

logger = logging.getLogger(__name__)

# Maximum camera index to probe (0-based, inclusive).
# Probing stops early if N consecutive indexes fail, so a high ceiling is safe.
_MAX_PROBE_INDEX: int = 8
_CONSECUTIVE_FAIL_LIMIT: int = 3


@dataclass
class CameraInfo:
    """Result of probing a single camera index."""

    index: int
    available: bool
    frame_read: bool = False
    width: Optional[float] = None
    height: Optional[float] = None
    backend: Optional[str] = None
    error: Optional[str] = None


@dataclass
class DiscoveryResult:
    """Aggregated result of a full camera discovery pass."""

    probed: list[CameraInfo] = field(default_factory=list)

    @property
    def available(self) -> list[CameraInfo]:
        return [c for c in self.probed if c.available]

    @property
    def unavailable(self) -> list[CameraInfo]:
        return [c for c in self.probed if not c.available]


def _probe_index(index: int, backend: int = cv2.CAP_DSHOW) -> CameraInfo:
    """
    Open camera *index*, attempt to read one frame, then release.

    Parameters
    ----------
    index:
        OpenCV camera index (0, 1, 2, …).
    backend:
        VideoCapture backend flag. Defaults to CAP_DSHOW (Windows DirectShow)
        which is the most reliable option on Windows. Falls back to the default
        backend (CAP_ANY) if the first open attempt fails.

    Returns
    -------
    CameraInfo
        Populated with availability and frame data.
    """
    cap = cv2.VideoCapture(index, backend)

    # On some systems CAP_DSHOW fails to open; retry with default backend.
    if not cap.isOpened():
        cap.release()
        cap = cv2.VideoCapture(index)

    if not cap.isOpened():
        return CameraInfo(index=index, available=False, error="Could not open VideoCapture")

    # Attempt to read one frame.
    ret, frame = cap.read()
    frame_ok = ret and frame is not None and frame.size > 0

    info = CameraInfo(
        index=index,
        available=True,
        frame_read=frame_ok,
        width=cap.get(cv2.CAP_PROP_FRAME_WIDTH) or None,
        height=cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or None,
        backend=str(cap.getBackendName()),
        error=None if frame_ok else "Opened but could not read a frame",
    )

    cap.release()
    logger.debug("Camera %d: available=%s frame_read=%s", index, info.available, info.frame_read)
    return info


def discover_cameras(
    max_index: int = _MAX_PROBE_INDEX,
    consecutive_fail_limit: int = _CONSECUTIVE_FAIL_LIMIT,
) -> DiscoveryResult:
    """
    Probe camera indexes from 0 up to *max_index* (inclusive).

    Stops early once *consecutive_fail_limit* indexes in a row fail to open,
    preventing long hangs on machines with few cameras.

    Parameters
    ----------
    max_index:
        Highest index to probe (inclusive).
    consecutive_fail_limit:
        Stop scanning after this many consecutive failures.

    Returns
    -------
    DiscoveryResult
        Contains one :class:`CameraInfo` per probed index.
    """
    result = DiscoveryResult()
    consecutive_fails = 0

    for idx in range(max_index + 1):
        info = _probe_index(idx)
        result.probed.append(info)

        if info.available:
            consecutive_fails = 0
        else:
            consecutive_fails += 1
            if consecutive_fails >= consecutive_fail_limit:
                logger.debug(
                    "Stopping discovery after %d consecutive failures at index %d.",
                    consecutive_fails,
                    idx,
                )
                break

    return result
