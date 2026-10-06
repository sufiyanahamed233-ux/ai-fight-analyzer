"""Temporal pose sequence processing for video files.

Reads frames sequentially using OpenCV and runs PoseDetector on each frame,
producing a time-ordered PoseSequence.

Timestamp resolution strategy
------------------------------
When a ``*_timestamps.json`` manifest produced by the camera recorder sits
next to the video file, per-frame wall-clock timestamps from that manifest
are used (first timestamp normalised to 0.0).  The ``PoseSequence``
``timestamp_source`` field is set to ``"manifest"`` in this case.

If the manifest is absent, unreadable, malformed, or has a mismatched frame
count the analyser falls back to ``frame_index / source_fps`` and sets
``timestamp_source`` to ``"video_fps_fallback"``.
"""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import List, Optional, Tuple

import cv2

from app.analysis.models import PoseFrame, PoseSequence
from app.pose.pose_detector import PoseDetector

logger = logging.getLogger(__name__)

# Literal sentinel values so callers can compare without magic strings.
TS_SOURCE_MANIFEST = "manifest"
TS_SOURCE_FPS = "video_fps_fallback"


def _load_timestamps(video_path: str) -> Tuple[Optional[List[float]], str]:
    """Attempt to load a per-frame timestamp list from a ``*_timestamps.json``
    manifest that lives alongside *video_path*.

    Manifest naming convention produced by the camera recorder::

        <role>_<date>T<time>.avi         → video
        <role>_<date>T<time>_timestamps.json → manifest

    The manifest must be a JSON object with a ``"timestamps_s"`` key whose
    value is a non-empty list of numbers.

    Returns
    -------
    (timestamps, source)
        *timestamps* is ``None`` when loading failed; *source* is one of
        :data:`TS_SOURCE_MANIFEST` or :data:`TS_SOURCE_FPS`.
    """
    video_stem = Path(video_path).stem  # e.g. "front_20261006T182132"
    ts_candidate = Path(video_path).with_name(f"{video_stem}_timestamps.json")

    if not ts_candidate.exists():
        logger.debug("No timestamp manifest found for %s (looked for %s)", video_path, ts_candidate)
        return None, TS_SOURCE_FPS

    try:
        data = json.loads(ts_candidate.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Could not read timestamp manifest %s: %s", ts_candidate, exc)
        return None, TS_SOURCE_FPS

    raw = data.get("timestamps_s")
    if not isinstance(raw, list) or len(raw) == 0:
        logger.warning("Manifest %s has empty or missing 'timestamps_s'", ts_candidate)
        return None, TS_SOURCE_FPS

    # Validate every entry is a finite number.
    try:
        timestamps = [float(t) for t in raw]
    except (TypeError, ValueError) as exc:
        logger.warning("Manifest %s contains non-numeric timestamps: %s", ts_candidate, exc)
        return None, TS_SOURCE_FPS

    if any(t != t for t in timestamps):  # NaN check
        logger.warning("Manifest %s contains NaN timestamps", ts_candidate)
        return None, TS_SOURCE_FPS

    logger.info("Loaded %d timestamps from manifest %s", len(timestamps), ts_candidate)
    return timestamps, TS_SOURCE_MANIFEST


class PoseSequenceAnalyzer:
    """Processes video files sequentially to extract temporal pose sequences."""

    def __init__(
        self,
        detector: Optional[PoseDetector] = None,
        **detector_kwargs,
    ):
        """Initialize analyzer with an existing or new PoseDetector.

        Args:
            detector: Optional pre-loaded PoseDetector instance.
            **detector_kwargs: Keyword arguments passed to PoseDetector if instantiated.
        """
        if detector is not None:
            self.detector = detector
        else:
            self.detector = PoseDetector(**detector_kwargs)

    def process_video(
        self,
        video_path: str | Path,
        max_frames: Optional[int] = None,
    ) -> PoseSequence:
        """Process a video file sequentially and extract a PoseSequence.

        Timestamps for each frame are resolved as follows:

        1. **Manifest** – if a ``*_timestamps.json`` file exists next to the
           video, its ``timestamps_s`` list is used.  The first timestamp is
           normalised to ``0.0`` so sequences always start at the origin.
           ``PoseSequence.timestamp_source`` is set to ``"manifest"``.

        2. **FPS fallback** – when no valid manifest is found,
           ``frame_index / source_fps`` is used instead and
           ``timestamp_source`` is set to ``"video_fps_fallback"``.

        Args:
            video_path: Path to video file.
            max_frames: Optional cap on the number of frames to process.

        Returns:
            PoseSequence containing metadata and per-frame PoseFrame objects.

        Raises:
            FileNotFoundError: If the video file does not exist.
            ValueError: If the video cannot be opened by OpenCV.
        """
        video_path_str = str(video_path)
        if not os.path.exists(video_path_str):
            raise FileNotFoundError(f"Video file not found: {video_path_str}")

        cap = cv2.VideoCapture(video_path_str)
        if not cap.isOpened():
            raise ValueError(f"Failed to open video file with OpenCV: {video_path_str}")

        frames: List[PoseFrame] = []
        try:
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            source_fps = float(cap.get(cv2.CAP_PROP_FPS))
            if source_fps <= 0.0 or source_fps != source_fps:  # <= 0 or NaN
                source_fps = 30.0

            # ------------------------------------------------------------------
            # Resolve timestamp source
            # ------------------------------------------------------------------
            manifest_timestamps, timestamp_source = _load_timestamps(video_path_str)

            frame_idx = 0
            while True:
                if max_frames is not None and frame_idx >= max_frames:
                    break

                ret, frame = cap.read()
                if not ret or frame is None:
                    break

                # ----------------------------------------------------------
                # Compute per-frame timestamp
                # ----------------------------------------------------------
                if manifest_timestamps is not None:
                    if frame_idx < len(manifest_timestamps):
                        # Normalise to 0.0 origin using the first manifest timestamp
                        timestamp = manifest_timestamps[frame_idx] - manifest_timestamps[0]
                    else:
                        # Frame index exceeds manifest length → fall back for this frame
                        logger.debug(
                            "Frame %d exceeds manifest length (%d); using FPS fallback",
                            frame_idx,
                            len(manifest_timestamps),
                        )
                        timestamp = frame_idx / source_fps
                else:
                    timestamp = frame_idx / source_fps

                det_result = self.detector.detect(frame)

                if det_result.persons_detected > 0 and det_result.primary is not None:
                    primary = det_result.primary
                    pose_frame = PoseFrame(
                        frame_index=frame_idx,
                        timestamp=timestamp,
                        detection_present=True,
                        keypoints=primary.keypoints,
                        bbox_xyxy=primary.bbox_xyxy,
                        person_confidence=primary.confidence,
                    )
                else:
                    pose_frame = PoseFrame(
                        frame_index=frame_idx,
                        timestamp=timestamp,
                        detection_present=False,
                        keypoints=[],
                        bbox_xyxy=None,
                        person_confidence=0.0,
                    )

                frames.append(pose_frame)
                frame_idx += 1

            # ------------------------------------------------------------------
            # Resolve overall sequence duration
            # ------------------------------------------------------------------
            frame_count = len(frames)

            if manifest_timestamps is not None and frame_count > 0:
                # Duration = span of the manifest timestamps that were actually used.
                last_used_idx = min(frame_count - 1, len(manifest_timestamps) - 1)
                duration = (
                    manifest_timestamps[last_used_idx] - manifest_timestamps[0]
                )
            else:
                duration = (frame_count / source_fps) if source_fps > 0 else 0.0

            return PoseSequence(
                video_path=video_path_str,
                width=width,
                height=height,
                source_fps=source_fps,
                frame_count=frame_count,
                duration=duration,
                frames=frames,
                timestamp_source=timestamp_source,
            )

        finally:
            cap.release()
