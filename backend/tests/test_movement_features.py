"""
test_movement_features.py
-------------------------
Unit tests for the MovementFeatures model and MovementFeaturesAnalyzer.

Uses synthetic PoseSequence and PoseFrame data with known geometry and timestamps
to deterministically verify all biomechanical and kinematic calculations:
  - Normalized stance width and stance consistency
  - Torso / hip movement stability and vertical spine inclination
  - Structural pose stability and core keypoint jitter
  - Wrist velocity with irregular timestamps and spatial movement range
  - Defensive guard-position ratios (high guard vs. dropped hands)
  - Biomechanical arm extension and elbow joint angles (straight vs. 90-degree bent)
  - Whole-body displacement and movement velocity
  - Torso rotation angular velocity and shoulder-hip twist
  - Person detection coverage
  - Safe handling of low-confidence keypoints and missing data (never inventing values)
"""

from __future__ import annotations

import math
from typing import Dict, List, Optional, Tuple

import pytest

from app.analysis.models import (
    MovementFeatures,
    PoseFrame,
    PoseSequence,
)
from app.analysis.movement_features import (
    MovementFeaturesAnalyzer,
    combine_multiview_features,
)
from app.pose.pose_detector import COCO_KEYPOINT_NAMES, Keypoint


# ---------------------------------------------------------------------------
# Test Helpers & Synthetic Pose Generators
# ---------------------------------------------------------------------------


def make_keypoints(coords: Dict[str, Tuple[float, float, float]]) -> List[Keypoint]:
    """
    Build a full 17-keypoint list from a dictionary of {name: (x_px, y_px, confidence)}.
    Unspecified keypoints default to confidence=0.0.
    """
    keypoints: List[Keypoint] = []
    for idx, name in enumerate(COCO_KEYPOINT_NAMES):
        if name in coords:
            x, y, conf = coords[name]
            keypoints.append(
                Keypoint(
                    name=name,
                    index=idx,
                    x_px=float(x),
                    y_px=float(y),
                    x_norm=float(x) / 1000.0,
                    y_norm=float(y) / 1000.0,
                    confidence=float(conf),
                )
            )
        else:
            keypoints.append(
                Keypoint(
                    name=name,
                    index=idx,
                    x_px=0.0,
                    y_px=0.0,
                    x_norm=0.0,
                    y_norm=0.0,
                    confidence=0.0,
                )
            )
    return keypoints


def make_standard_fighter_frame(
    timestamp: float,
    frame_index: int = 0,
    shoulder_width: float = 100.0,
    torso_height: float = 150.0,
    center_x: float = 500.0,
    center_y: float = 400.0,
    ankle_spacing: float = 120.0,
    left_hand_up: bool = True,
    right_hand_up: bool = True,
    left_arm_straight: bool = False,
    right_arm_straight: bool = False,
    shoulder_angle_deg: float = 0.0,
    hip_angle_deg: float = 0.0,
    conf: float = 0.95,
) -> PoseFrame:
    """
    Construct a synthetic PoseFrame for a fighter with configurable geometry.
    Head is at ~ center_y - 180
    Shoulders at center_y - 120
    Hips at center_y + 30
    Ankles at center_y + 180
    """
    half_sw = shoulder_width / 2.0
    half_hw = (shoulder_width * 0.8) / 2.0

    # Shoulder rotation
    s_rad = math.radians(shoulder_angle_deg)
    ls_x = center_x - half_sw * math.cos(s_rad)
    ls_y = (center_y - 120.0) - half_sw * math.sin(s_rad)
    rs_x = center_x + half_sw * math.cos(s_rad)
    rs_y = (center_y - 120.0) + half_sw * math.sin(s_rad)

    # Hip rotation
    h_rad = math.radians(hip_angle_deg)
    lh_x = center_x - half_hw * math.cos(h_rad)
    lh_y = (center_y + 30.0) - half_hw * math.sin(h_rad)
    rh_x = center_x + half_hw * math.cos(h_rad)
    rh_y = (center_y + 30.0) + half_hw * math.sin(h_rad)

    # Hands: Guard (chin level ~ center_y - 150) vs Dropped (hip level ~ center_y + 40)
    # Left arm
    if left_arm_straight:
        # Straight punch extending forward/down
        le_x, le_y = ls_x - 40.0, ls_y
        lw_x, lw_y = ls_x - 80.0, ls_y
    elif left_hand_up:
        le_x, le_y = ls_x - 20.0, ls_y + 30.0
        lw_x, lw_y = ls_x - 10.0, ls_y - 30.0  # above shoulder level
    else:
        le_x, le_y = ls_x - 20.0, ls_y + 60.0
        lw_x, lw_y = ls_x - 20.0, center_y + 50.0  # dropped at hip

    # Right arm
    if right_arm_straight:
        re_x, re_y = rs_x + 40.0, rs_y
        rw_x, rw_y = rs_x + 80.0, rs_y
    elif right_hand_up:
        re_x, re_y = rs_x + 20.0, rs_y + 30.0
        rw_x, rw_y = rs_x + 10.0, rs_y - 30.0  # above shoulder level
    else:
        re_x, re_y = rs_x + 20.0, rs_y + 60.0
        rw_x, rw_y = rs_x + 20.0, center_y + 50.0  # dropped at hip

    # Ankles
    la_x = center_x - ankle_spacing / 2.0
    la_y = center_y + 180.0
    ra_x = center_x + ankle_spacing / 2.0
    ra_y = center_y + 180.0

    kps = make_keypoints({
        "nose": (center_x, center_y - 170.0, conf),
        "left_shoulder": (ls_x, ls_y, conf),
        "right_shoulder": (rs_x, rs_y, conf),
        "left_elbow": (le_x, le_y, conf),
        "right_elbow": (re_x, re_y, conf),
        "left_wrist": (lw_x, lw_y, conf),
        "right_wrist": (rw_x, rw_y, conf),
        "left_hip": (lh_x, lh_y, conf),
        "right_hip": (rh_x, rh_y, conf),
        "left_ankle": (la_x, la_y, conf),
        "right_ankle": (ra_x, ra_y, conf),
    })

    return PoseFrame(
        frame_index=frame_index,
        timestamp=timestamp,
        detection_present=True,
        keypoints=kps,
        bbox_xyxy=(center_x - 100.0, center_y - 200.0, center_x + 100.0, center_y + 200.0),
        person_confidence=conf,
    )


# ---------------------------------------------------------------------------
# Test Cases
# ---------------------------------------------------------------------------


class TestEmptyAndEdgeSequences:
    """Edge cases: empty sequence, zero detections, single frame."""

    def test_empty_sequence(self):
        analyzer = MovementFeaturesAnalyzer()
        seq = PoseSequence(
            video_path="test.mp4",
            width=1280,
            height=720,
            source_fps=30.0,
            frame_count=0,
            duration=0.0,
            frames=[],
        )
        features = analyzer.analyze(seq)

        assert features.coverage.total_frames == 0
        assert features.coverage.detected_frames == 0
        assert features.coverage.coverage_ratio == 0.0
        assert features.body_scale is None
        assert features.stance.mean_stance_width_norm is None
        assert features.stance.valid_frames == 0
        assert features.wrists.peak_wrist_velocity_norm is None
        assert features.guard.guard_position_ratio is None
        assert features.body_displacement.total_displacement_norm is None

    def test_zero_detections_sequence(self):
        analyzer = MovementFeaturesAnalyzer()
        frames = [
            PoseFrame(frame_index=i, timestamp=i * 0.033, detection_present=False)
            for i in range(5)
        ]
        seq = PoseSequence(
            video_path="test.mp4",
            width=1280,
            height=720,
            source_fps=30.0,
            frame_count=5,
            duration=5 * 0.033,
            frames=frames,
        )
        features = analyzer.analyze(seq)

        assert features.coverage.total_frames == 5
        assert features.coverage.detected_frames == 0
        assert features.coverage.coverage_ratio == 0.0
        assert features.body_scale is None
        assert features.stance.valid_frames == 0
        assert features.wrists.valid_frames == 0
        assert features.guard.guard_position_ratio is None

    def test_single_frame_sequence(self):
        analyzer = MovementFeaturesAnalyzer()
        f = make_standard_fighter_frame(timestamp=0.0, frame_index=0, shoulder_width=100.0, ankle_spacing=150.0)
        seq = PoseSequence(
            video_path="test.mp4",
            width=1280,
            height=720,
            source_fps=30.0,
            frame_count=1,
            duration=0.0,
            frames=[f],
        )
        features = analyzer.analyze(seq)

        assert features.coverage.total_frames == 1
        assert features.coverage.detected_frames == 1
        assert features.coverage.coverage_ratio == 1.0
        assert features.body_scale == pytest.approx(100.0, abs=1e-2)

        # Static features work for single frame
        assert features.stance.mean_stance_width_norm == pytest.approx(1.5, abs=1e-2)
        assert features.stance.stance_consistency == 1.0
        assert features.stance.valid_frames == 1

        # Guard works
        assert features.guard.guard_position_ratio == 1.0

        # Dynamic / velocity features require >= 2 frames, so remain None
        assert features.wrists.left_wrist_avg_velocity_norm is None
        assert features.body_displacement.total_displacement_norm is None


class TestDetectionCoverage:
    """Verifies person detection coverage ratio."""

    def test_partial_detection_coverage(self):
        analyzer = MovementFeaturesAnalyzer()
        frames = []
        for i in range(10):
            # 7 detected, 3 undetected
            if i in (2, 5, 8):
                frames.append(PoseFrame(frame_index=i, timestamp=i * 0.1, detection_present=False))
            else:
                frames.append(make_standard_fighter_frame(timestamp=i * 0.1, frame_index=i))

        seq = PoseSequence(
            video_path="test.mp4",
            width=1280,
            height=720,
            source_fps=10.0,
            frame_count=10,
            duration=1.0,
            frames=frames,
        )
        features = analyzer.analyze(seq)

        assert features.coverage.total_frames == 10
        assert features.coverage.detected_frames == 7
        assert features.coverage.coverage_ratio == pytest.approx(0.7, abs=1e-3)


class TestStanceFeatures:
    """Verifies normalized stance width and temporal stance consistency."""

    def test_constant_stance_width_has_perfect_consistency(self):
        analyzer = MovementFeaturesAnalyzer()
        # 5 frames with identical ankle spacing of 120 px and shoulder width 100 px (ratio 1.2)
        frames = [
            make_standard_fighter_frame(
                timestamp=i * 0.1,
                frame_index=i,
                shoulder_width=100.0,
                ankle_spacing=120.0,
            )
            for i in range(5)
        ]
        seq = PoseSequence(
            video_path="test.mp4",
            width=1280,
            height=720,
            source_fps=10.0,
            frame_count=5,
            duration=0.5,
            frames=frames,
        )
        features = analyzer.analyze(seq)

        assert features.stance.mean_stance_width_norm == pytest.approx(1.2, abs=1e-3)
        assert features.stance.stance_width_std_norm == pytest.approx(0.0, abs=1e-4)
        assert features.stance.stance_consistency == pytest.approx(1.0, abs=1e-3)
        assert features.stance.valid_frames == 5

    def test_varying_stance_width_reduces_consistency(self):
        analyzer = MovementFeaturesAnalyzer()
        # Spacing fluctuates: 100, 150, 100, 150, 100
        spacings = [100.0, 160.0, 100.0, 160.0, 100.0]
        frames = [
            make_standard_fighter_frame(
                timestamp=i * 0.1,
                frame_index=i,
                shoulder_width=100.0,
                ankle_spacing=spacings[i],
            )
            for i in range(5)
        ]
        seq = PoseSequence(
            video_path="test.mp4",
            width=1280,
            height=720,
            source_fps=10.0,
            frame_count=5,
            duration=0.5,
            frames=frames,
        )
        features = analyzer.analyze(seq)

        assert features.stance.mean_stance_width_norm == pytest.approx(1.24, abs=0.05)
        assert features.stance.stance_width_std_norm > 0.1
        assert features.stance.stance_consistency < 0.95
        assert features.stance.stance_consistency >= 0.0

    def test_missing_ankles_handled_safely(self):
        analyzer = MovementFeaturesAnalyzer()
        # Frames with shoulders but without ankles
        frames = []
        for i in range(3):
            kps = make_keypoints({
                "left_shoulder": (450.0, 200.0, 0.9),
                "right_shoulder": (550.0, 200.0, 0.9),
                # Ankles missing / 0 confidence
            })
            frames.append(PoseFrame(frame_index=i, timestamp=i * 0.1, detection_present=True, keypoints=kps))

        seq = PoseSequence(
            video_path="test.mp4",
            width=1280,
            height=720,
            source_fps=10.0,
            frame_count=3,
            duration=0.3,
            frames=frames,
        )
        features = analyzer.analyze(seq)

        assert features.stance.valid_frames == 0
        assert features.stance.mean_stance_width_norm is None
        assert features.stance.stance_consistency is None


class TestArmExtensionFeatures:
    """Verifies biomechanical arm extension and elbow joint angle calculations."""

    def test_fully_straight_arm(self):
        analyzer = MovementFeaturesAnalyzer()
        frames = [
            make_standard_fighter_frame(
                timestamp=i * 0.1,
                frame_index=i,
                left_arm_straight=True,
                right_arm_straight=False,
            )
            for i in range(3)
        ]
        seq = PoseSequence(
            video_path="test.mp4",
            width=1280,
            height=720,
            source_fps=10.0,
            frame_count=3,
            duration=0.3,
            frames=frames,
        )
        features = analyzer.analyze(seq)

        # Left arm is straight (extension ratio == 1.0, elbow angle == 180 degrees)
        assert features.arm_extension.left_arm_extension_mean == pytest.approx(1.0, abs=1e-2)
        assert features.arm_extension.left_arm_extension_max == pytest.approx(1.0, abs=1e-2)
        assert features.arm_extension.left_elbow_angle_mean_deg == pytest.approx(180.0, abs=1.0)

    def test_bent_elbow_90_degrees(self):
        analyzer = MovementFeaturesAnalyzer()
        # Create an exact 90-degree bent arm:
        # shoulder=(100, 100), elbow=(100, 150), wrist=(150, 150)
        # L1 = 50, L2 = 50, Reach = sqrt(50^2 + 50^2) = 70.71
        # extension = 70.71 / 100 = 0.7071
        kps = make_keypoints({
            "left_shoulder": (100.0, 100.0, 0.95),
            "left_elbow": (100.0, 150.0, 0.95),
            "left_wrist": (150.0, 150.0, 0.95),
            "right_shoulder": (200.0, 100.0, 0.95),
        })
        frame = PoseFrame(frame_index=0, timestamp=0.0, detection_present=True, keypoints=kps)
        seq = PoseSequence(
            video_path="test.mp4",
            width=1280,
            height=720,
            source_fps=10.0,
            frame_count=1,
            duration=0.1,
            frames=[frame],
        )
        features = analyzer.analyze(seq)

        assert features.arm_extension.left_arm_extension_mean == pytest.approx(0.7071, abs=1e-2)
        assert features.arm_extension.left_elbow_angle_mean_deg == pytest.approx(90.0, abs=1e-1)


class TestGuardFeatures:
    """Verifies defensive guard ratios for high guard vs dropped hands."""

    def test_full_high_guard(self):
        analyzer = MovementFeaturesAnalyzer()
        frames = [
            make_standard_fighter_frame(
                timestamp=i * 0.1,
                frame_index=i,
                left_hand_up=True,
                right_hand_up=True,
            )
            for i in range(4)
        ]
        seq = PoseSequence(
            video_path="test.mp4",
            width=1280,
            height=720,
            source_fps=10.0,
            frame_count=4,
            duration=0.4,
            frames=frames,
        )
        features = analyzer.analyze(seq)

        assert features.guard.left_guard_ratio == pytest.approx(1.0)
        assert features.guard.right_guard_ratio == pytest.approx(1.0)
        assert features.guard.both_guard_ratio == pytest.approx(1.0)
        assert features.guard.guard_position_ratio == pytest.approx(1.0)

    def test_dropped_guard(self):
        analyzer = MovementFeaturesAnalyzer()
        frames = [
            make_standard_fighter_frame(
                timestamp=i * 0.1,
                frame_index=i,
                left_hand_up=False,
                right_hand_up=False,
            )
            for i in range(4)
        ]
        seq = PoseSequence(
            video_path="test.mp4",
            width=1280,
            height=720,
            source_fps=10.0,
            frame_count=4,
            duration=0.4,
            frames=frames,
        )
        features = analyzer.analyze(seq)

        assert features.guard.left_guard_ratio == pytest.approx(0.0)
        assert features.guard.right_guard_ratio == pytest.approx(0.0)
        assert features.guard.both_guard_ratio == pytest.approx(0.0)
        assert features.guard.guard_position_ratio == pytest.approx(0.0)

    def test_one_hand_guard(self):
        analyzer = MovementFeaturesAnalyzer()
        frames = [
            make_standard_fighter_frame(
                timestamp=i * 0.1,
                frame_index=i,
                left_hand_up=True,
                right_hand_up=False,
            )
            for i in range(4)
        ]
        seq = PoseSequence(
            video_path="test.mp4",
            width=1280,
            height=720,
            source_fps=10.0,
            frame_count=4,
            duration=0.4,
            frames=frames,
        )
        features = analyzer.analyze(seq)

        assert features.guard.left_guard_ratio == pytest.approx(1.0)
        assert features.guard.right_guard_ratio == pytest.approx(0.0)
        assert features.guard.both_guard_ratio == pytest.approx(0.0)
        assert features.guard.guard_position_ratio == pytest.approx(0.5)


class TestWristKinematicsAndTimestamps:
    """Verifies that wrist velocities respect irregular timestamps, not fixed FPS."""

    def test_wrist_velocity_with_irregular_timestamps(self):
        analyzer = MovementFeaturesAnalyzer()
        # Shoulder width = 100 px (body scale = 100)
        # Left wrist moves 50 px in 0.05s -> velocity = (50/100) / 0.05 = 10.0 body_scales/sec
        # Then moves 50 px in 0.20s -> velocity = (50/100) / 0.20 = 2.5 body_scales/sec
        timestamps = [0.0, 0.05, 0.25]
        wrist_xs = [400.0, 450.0, 500.0]

        frames = []
        for i in range(3):
            kps = make_keypoints({
                "left_shoulder": (450.0, 200.0, 0.95),
                "right_shoulder": (550.0, 200.0, 0.95),
                "left_wrist": (wrist_xs[i], 200.0, 0.95),
            })
            frames.append(PoseFrame(frame_index=i, timestamp=timestamps[i], detection_present=True, keypoints=kps))

        seq = PoseSequence(
            video_path="test.mp4",
            width=1280,
            height=720,
            source_fps=30.0,  # Should NOT be used
            frame_count=3,
            duration=0.25,
            frames=frames,
        )
        features = analyzer.analyze(seq)

        assert features.wrists.left_wrist_peak_velocity_norm == pytest.approx(10.0, abs=1e-2)
        assert features.wrists.left_wrist_avg_velocity_norm == pytest.approx(6.25, abs=1e-2)

        # Movement range: min_x = 400, max_x = 500 -> 100 px / 100 body_scale = 1.0
        assert features.wrists.left_wrist_movement_range_x == pytest.approx(1.0, abs=1e-2)
        assert features.wrists.left_wrist_movement_range_y == pytest.approx(0.0, abs=1e-2)
        assert features.wrists.left_wrist_movement_range_total == pytest.approx(1.0, abs=1e-2)


class TestTorsoHipStability:
    """Verifies torso/hip stability score and spine vertical tilt."""

    def test_stationary_upright_torso_has_high_stability(self):
        analyzer = MovementFeaturesAnalyzer()
        # 5 frames where hips and shoulders remain in exact same position
        frames = [
            make_standard_fighter_frame(timestamp=i * 0.1, frame_index=i)
            for i in range(5)
        ]
        seq = PoseSequence(
            video_path="test.mp4",
            width=1280,
            height=720,
            source_fps=10.0,
            frame_count=5,
            duration=0.5,
            frames=frames,
        )
        features = analyzer.analyze(seq)

        assert features.torso_hip.hip_speed_mean_norm == pytest.approx(0.0, abs=1e-4)
        assert features.torso_hip.torso_vertical_tilt_std_deg == pytest.approx(0.0, abs=1e-4)
        assert features.torso_hip.torso_hip_stability_score == pytest.approx(1.0, abs=1e-2)

    def test_oscillating_hips_reduce_stability_score(self):
        analyzer = MovementFeaturesAnalyzer()
        # Hips jumping left and right
        frames = []
        for i in range(6):
            offset_x = 40.0 if (i % 2 == 1) else -40.0
            frames.append(
                make_standard_fighter_frame(
                    timestamp=i * 0.05,
                    frame_index=i,
                    center_x=500.0 + offset_x,
                )
            )

        seq = PoseSequence(
            video_path="test.mp4",
            width=1280,
            height=720,
            source_fps=20.0,
            frame_count=6,
            duration=0.3,
            frames=frames,
        )
        features = analyzer.analyze(seq)

        assert features.torso_hip.hip_speed_mean_norm > 5.0
        assert features.torso_hip.torso_hip_stability_score < 0.5


class TestTorsoRotationAndTwist:
    """Verifies shoulder line rotation speed and shoulder-hip twist."""

    def test_torso_rotation_speed(self):
        analyzer = MovementFeaturesAnalyzer()
        # Frame 0: shoulder horizontal (0 deg)
        # Frame 1 (t=0.1s): shoulder rotated 30 deg -> speed = 300 deg/s
        # Frame 2 (t=0.2s): shoulder rotated 60 deg -> speed = 300 deg/s
        frames = [
            make_standard_fighter_frame(
                timestamp=i * 0.1,
                frame_index=i,
                shoulder_angle_deg=float(i * 30.0),
                hip_angle_deg=0.0,
            )
            for i in range(3)
        ]
        seq = PoseSequence(
            video_path="test.mp4",
            width=1280,
            height=720,
            source_fps=10.0,
            frame_count=3,
            duration=0.3,
            frames=frames,
        )
        features = analyzer.analyze(seq)

        assert features.torso_rotation.torso_rotation_speed_mean_deg_s == pytest.approx(300.0, abs=1.0)
        assert features.torso_rotation.torso_angle_range_deg == pytest.approx(60.0, abs=1.0)
        assert features.torso_rotation.shoulder_hip_twist_mean_deg == pytest.approx(30.0, abs=1.0)


class TestBodyDisplacement:
    """Verifies whole body displacement and velocity."""

    def test_body_movement_tracking(self):
        analyzer = MovementFeaturesAnalyzer()
        # Shoulder width 100 px (scale 100)
        # Center moves 100 px horizontally over 1.0 second (t=0.0 to t=1.0 across 5 frames)
        frames = [
            make_standard_fighter_frame(
                timestamp=i * 0.25,
                frame_index=i,
                center_x=500.0 + (i * 25.0),
                shoulder_width=100.0,
            )
            for i in range(5)
        ]
        seq = PoseSequence(
            video_path="test.mp4",
            width=1280,
            height=720,
            source_fps=4.0,
            frame_count=5,
            duration=1.0,
            frames=frames,
        )
        features = analyzer.analyze(seq)

        # Total distance = 100 px / 100 = 1.0 body scale
        assert features.body_displacement.total_displacement_norm == pytest.approx(1.0, abs=1e-2)
        assert features.body_displacement.net_displacement_norm == pytest.approx(1.0, abs=1e-2)
        # Velocity = 1.0 body scale / 1.0s = 1.0 body_scale/s
        assert features.body_displacement.avg_velocity_norm == pytest.approx(1.0, abs=1e-2)


class TestConfidenceFilteringAndSerialization:
    """Verifies that low confidence keypoints are ignored and features serialize properly."""

    def test_low_confidence_keypoints_excluded(self):
        analyzer = MovementFeaturesAnalyzer(min_keypoint_confidence=0.7)
        # Shoulders have confidence 0.4 (below threshold 0.7)
        kps = make_keypoints({
            "left_shoulder": (450.0, 200.0, 0.4),
            "right_shoulder": (550.0, 200.0, 0.4),
            "left_ankle": (440.0, 500.0, 0.9),
            "right_ankle": (560.0, 500.0, 0.9),
        })
        frame = PoseFrame(frame_index=0, timestamp=0.0, detection_present=True, keypoints=kps)
        seq = PoseSequence(
            video_path="test.mp4",
            width=1280,
            height=720,
            source_fps=10.0,
            frame_count=1,
            duration=0.1,
            frames=[frame],
        )
        features = analyzer.analyze(seq)

        # Shoulders were below 0.7 confidence, so body_scale cannot be computed
        assert features.body_scale is None
        # Stance cannot be normalized without body scale
        assert features.stance.mean_stance_width_norm is None

    def test_to_dict_serialization(self):
        analyzer = MovementFeaturesAnalyzer()
        frames = [make_standard_fighter_frame(timestamp=0.1 * i, frame_index=i) for i in range(3)]
        seq = PoseSequence(
            video_path="test.mp4",
            width=1280,
            height=720,
            source_fps=10.0,
            frame_count=3,
            duration=0.3,
            frames=frames,
        )
        features = analyzer.analyze(seq)
        data = features.to_dict()

        assert isinstance(data, dict)
        assert "coverage" in data
        assert "stance" in data
        assert "wrists" in data
        assert "guard" in data
        assert "arm_extension" in data
        assert "torso_hip" in data
        assert "body_displacement" in data
        assert "torso_rotation" in data
        assert data["coverage"]["total_frames"] == 3


class TestCombineMultiviewFeatures:
    """Tests for multi-view feature combination and fusion."""

    def test_both_cameras_valid_fused(self):
        analyzer = MovementFeaturesAnalyzer()
        # Front sequence
        frames_front = [
            make_standard_fighter_frame(timestamp=0.1 * i, frame_index=i, ankle_spacing=120.0, left_arm_straight=False)
            for i in range(10)
        ]
        seq_front = PoseSequence("front.avi", 1280, 720, 10.0, 10, 1.0, frames_front)
        feat_front = analyzer.analyze(seq_front)

        # Side sequence with greater arm extension
        frames_side = [
            make_standard_fighter_frame(timestamp=0.1 * i, frame_index=i, ankle_spacing=140.0, left_arm_straight=True)
            for i in range(10)
        ]
        seq_side = PoseSequence("side.avi", 1280, 720, 10.0, 10, 1.0, frames_side)
        feat_side = analyzer.analyze(seq_side)

        fused = combine_multiview_features(feat_front, feat_side, min_tracking_duration=0.5)

        # Stance uses front primary
        assert fused.stance.mean_stance_width_norm == feat_front.stance.mean_stance_width_norm

        # Striking reach uses maximum extension between front and side
        assert fused.arm_extension.max_arm_extension is not None
        assert fused.arm_extension.max_arm_extension >= feat_front.arm_extension.max_arm_extension

        # Movement orthogonal multi-view displacement estimate
        d_f = feat_front.body_displacement.total_displacement_norm
        d_s = feat_side.body_displacement.total_displacement_norm
        if d_f is not None and d_s is not None:
            expected_disp = math.sqrt(d_f ** 2 + d_s ** 2)
            assert fused.body_displacement.total_displacement_norm == pytest.approx(expected_disp, abs=1e-3)

    def test_only_front_valid_fallback(self):
        analyzer = MovementFeaturesAnalyzer()
        frames_front = [make_standard_fighter_frame(timestamp=0.1 * i, frame_index=i) for i in range(10)]
        seq_front = PoseSequence("front.avi", 1280, 720, 10.0, 10, 1.0, frames_front)
        feat_front = analyzer.analyze(seq_front)

        frames_side = [PoseFrame(frame_index=i, timestamp=0.1 * i, detection_present=False) for i in range(10)]
        seq_side = PoseSequence("side.avi", 1280, 720, 10.0, 10, 1.0, frames_side)
        feat_side = analyzer.analyze(seq_side)

        fused = combine_multiview_features(feat_front, feat_side, min_tracking_duration=0.5)
        assert fused.body_scale == feat_front.body_scale
        assert fused.stance.valid_frames == feat_front.stance.valid_frames

    def test_only_side_valid_fallback(self):
        analyzer = MovementFeaturesAnalyzer()
        frames_front = [PoseFrame(frame_index=i, timestamp=0.1 * i, detection_present=False) for i in range(10)]
        seq_front = PoseSequence("front.avi", 1280, 720, 10.0, 10, 1.0, frames_front)
        feat_front = analyzer.analyze(seq_front)

        frames_side = [make_standard_fighter_frame(timestamp=0.1 * i, frame_index=i) for i in range(10)]
        seq_side = PoseSequence("side.avi", 1280, 720, 10.0, 10, 1.0, frames_side)
        feat_side = analyzer.analyze(seq_side)

        fused = combine_multiview_features(feat_front, feat_side, min_tracking_duration=0.5)
        assert fused.body_scale == feat_side.body_scale
        assert fused.stance.valid_frames == feat_side.stance.valid_frames

    def test_neither_valid_returns_empty_features(self):
        analyzer = MovementFeaturesAnalyzer()
        frames_front = [PoseFrame(frame_index=i, timestamp=0.1 * i, detection_present=False) for i in range(10)]
        seq_front = PoseSequence("front.avi", 1280, 720, 10.0, 10, 1.0, frames_front)
        feat_front = analyzer.analyze(seq_front)

        frames_side = [PoseFrame(frame_index=i, timestamp=0.1 * i, detection_present=False) for i in range(10)]
        seq_side = PoseSequence("side.avi", 1280, 720, 10.0, 10, 1.0, frames_side)
        feat_side = analyzer.analyze(seq_side)

        fused = combine_multiview_features(feat_front, feat_side, min_tracking_duration=0.5)
        assert fused.body_scale is None
        assert fused.coverage.detected_frames == 0
        assert fused.stance.valid_frames == 0
        assert fused.balance_score is None if hasattr(fused, "balance_score") else True
        assert fused.guard.valid_frames == 0
