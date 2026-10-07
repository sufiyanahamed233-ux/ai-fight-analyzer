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


# ---------------------------------------------------------------------------
# Movement Features Data Models
# ---------------------------------------------------------------------------


@dataclass
class DetectionCoverageFeatures:
    """Coverage of person detection across the video sequence."""

    total_frames: int = 0
    detected_frames: int = 0
    coverage_ratio: float = 0.0
    tracking_duration_s: float = 0.0


@dataclass
class StanceFeatures:
    """Normalized stance width and temporal consistency."""

    mean_stance_width_norm: Optional[float] = None
    stance_width_std_norm: Optional[float] = None
    stance_consistency: Optional[float] = None  # [0.0, 1.0]
    valid_frames: int = 0


@dataclass
class TorsoHipFeatures:
    """Core torso and hip movement stability and spine tilt."""

    hip_speed_mean_norm: Optional[float] = None
    hip_speed_std_norm: Optional[float] = None
    torso_vertical_tilt_mean_deg: Optional[float] = None
    torso_vertical_tilt_std_deg: Optional[float] = None
    torso_hip_stability_score: Optional[float] = None  # [0.0, 1.0]
    valid_frames: int = 0


@dataclass
class PoseStabilityFeatures:
    """Overall structural pose stability and keypoint jitter."""

    pose_stability_score: Optional[float] = None  # [0.0, 1.0]
    mean_keypoint_jitter_norm: Optional[float] = None
    valid_frames: int = 0


@dataclass
class WristFeatures:
    """Wrist and hand kinematics, velocity, and spatial movement range."""

    left_wrist_avg_velocity_norm: Optional[float] = None
    left_wrist_peak_velocity_norm: Optional[float] = None
    left_wrist_movement_range_x: Optional[float] = None
    left_wrist_movement_range_y: Optional[float] = None
    left_wrist_movement_range_total: Optional[float] = None

    right_wrist_avg_velocity_norm: Optional[float] = None
    right_wrist_peak_velocity_norm: Optional[float] = None
    right_wrist_movement_range_x: Optional[float] = None
    right_wrist_movement_range_y: Optional[float] = None
    right_wrist_movement_range_total: Optional[float] = None

    peak_wrist_velocity_norm: Optional[float] = None
    avg_wrist_velocity_norm: Optional[float] = None
    valid_frames: int = 0


@dataclass
class GuardFeatures:
    """Defensive hand guard position ratios."""

    left_guard_ratio: Optional[float] = None
    right_guard_ratio: Optional[float] = None
    both_guard_ratio: Optional[float] = None
    guard_position_ratio: Optional[float] = None  # [0.0, 1.0]
    valid_frames: int = 0


@dataclass
class ArmExtensionFeatures:
    """Biomechanical arm extension ratios and elbow joint angles."""

    left_arm_extension_mean: Optional[float] = None
    left_arm_extension_max: Optional[float] = None
    right_arm_extension_mean: Optional[float] = None
    right_arm_extension_max: Optional[float] = None
    max_arm_extension: Optional[float] = None
    left_elbow_angle_mean_deg: Optional[float] = None
    right_elbow_angle_mean_deg: Optional[float] = None
    valid_frames: int = 0


@dataclass
class BodyDisplacementFeatures:
    """Whole-body translation and movement velocity."""

    total_displacement_norm: Optional[float] = None
    net_displacement_norm: Optional[float] = None
    avg_velocity_norm: Optional[float] = None
    peak_velocity_norm: Optional[float] = None
    valid_frames: int = 0


@dataclass
class TorsoRotationFeatures:
    """Rotational dynamics of the shoulder line and torso twist."""

    mean_torso_angle_deg: Optional[float] = None
    torso_angle_range_deg: Optional[float] = None
    torso_rotation_speed_mean_deg_s: Optional[float] = None
    torso_rotation_speed_max_deg_s: Optional[float] = None
    shoulder_hip_twist_mean_deg: Optional[float] = None
    valid_frames: int = 0


@dataclass
class MovementFeatures:
    """Aggregated movement and kinematic feature representation of a fight sequence."""

    coverage: DetectionCoverageFeatures
    stance: StanceFeatures
    torso_hip: TorsoHipFeatures
    pose_stability: PoseStabilityFeatures
    wrists: WristFeatures
    guard: GuardFeatures
    arm_extension: ArmExtensionFeatures
    body_displacement: BodyDisplacementFeatures
    torso_rotation: TorsoRotationFeatures
    body_scale: Optional[float] = None  # Reference normalization length in pixels

    def to_dict(self) -> dict:
        """Convert features to a nested serializable dictionary."""
        from dataclasses import asdict

        return asdict(self)
