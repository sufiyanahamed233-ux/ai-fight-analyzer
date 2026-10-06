"""Temporal pose sequence processing for video files.

Reads frames sequentially using OpenCV and runs PoseDetector on each frame,
producing a time-ordered PoseSequence.
"""

from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import Optional

import cv2

from app.analysis.models import PoseFrame, PoseSequence
from app.pose.pose_detector import PoseDetector

logger = logging.getLogger(__name__)


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

        frames = []
        try:
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            source_fps = float(cap.get(cv2.CAP_PROP_FPS))
            if source_fps <= 0.0 or source_fps != source_fps:  # Check <= 0 or NaN
                source_fps = 30.0

            frame_idx = 0
            while True:
                if max_frames is not None and frame_idx >= max_frames:
                    break

                ret, frame = cap.read()
                if not ret or frame is None:
                    break

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

            frame_count = len(frames)
            duration = (frame_count / source_fps) if source_fps > 0 else 0.0

            return PoseSequence(
                video_path=video_path_str,
                width=width,
                height=height,
                source_fps=source_fps,
                frame_count=frame_count,
                duration=duration,
                frames=frames,
            )

        finally:
            cap.release()
