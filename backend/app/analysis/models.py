"""Data models for temporal pose sequence analysis."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional, Tuple

from app.pose.pose_detector import Keypoint


@dataclass
class PoseFrame:
    """Pose observation for a single video frame."""

    frame_index: int
    timestamp: float  # seconds from video start
    detection_present: bool
    keypoints: List[Keypoint] = field(default_factory=list)
    bbox_xyxy: Optional[Tuple[float, float, float, float]] = None
    person_confidence: float = 0.0

    def get_keypoint(self, name: str) -> Optional[Keypoint]:
        """Look up a keypoint by standard COCO name."""
        for kp in self.keypoints:
            if kp.name == name:
                return kp
        return None


@dataclass
class PoseSequence:
    """Time-ordered sequence of pose observations extracted from a video."""

    video_path: str
    width: int
    height: int
    source_fps: float
    frame_count: int
    duration: float  # duration in seconds
    frames: List[PoseFrame] = field(default_factory=list)
    timestamp_source: str = "video_fps_fallback"  # "manifest" | "video_fps_fallback"

    @property
    def detected_frames_count(self) -> int:
        """Count of frames where a person was detected."""
        return sum(1 for f in self.frames if f.detection_present)

    @property
    def undetected_frames_count(self) -> int:
        """Count of frames where no person was detected."""
        return sum(1 for f in self.frames if not f.detection_present)
