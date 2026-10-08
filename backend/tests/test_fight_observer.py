"""
test_fight_observer.py
-----------------------
Unit tests for the deterministic Fight Observation and Scoring layer.

Verifies the 6 categories (stance, balance, guard, striking, coordination, movement):
  - High performance profile (scores >= 8.0)
  - Medium performance profile (scores between 5.0 and 7.9)
  - Low performance profile (scores < 5.0)
  - Completely missing features profile (scores are None, clear missing observation)
  - Partially missing features profile (only valid categories scored, overall averages valid ones)
  - FastAPI Pydantic serialization and disclaimer presence
"""

from __future__ import annotations

import json
from typing import Optional

import pytest

from app.analysis.fight_observer import DISCLAIMER_TEXT, FightObservationAnalyzer
from app.analysis.models import (
    ArmExtensionFeatures,
    BodyDisplacementFeatures,
    DetectionCoverageFeatures,
    GuardFeatures,
    MovementFeatures,
    PoseStabilityFeatures,
    StanceFeatures,
    TorsoHipFeatures,
    TorsoRotationFeatures,
    WristFeatures,
)
from app.schemas.analysis import CategoryObservation, FightObservationResult


# ---------------------------------------------------------------------------
# Test Fixtures & Generators
# ---------------------------------------------------------------------------


def make_features(
    mean_stance_w: Optional[float] = None,
    stance_consistency: Optional[float] = None,
    stance_frames: int = 10,
    th_stability: Optional[float] = None,
    pose_stability: Optional[float] = None,
    guard_ratio: Optional[float] = None,
    both_guard_ratio: Optional[float] = None,
    guard_frames: int = 10,
    max_arm_ext: Optional[float] = None,
    peak_wrist_v: Optional[float] = None,
    avg_wrist_v: Optional[float] = None,
    arm_frames: int = 10,
    twist_deg: Optional[float] = None,
    l_wrist_v: Optional[float] = None,
    r_wrist_v: Optional[float] = None,
    rot_speed: Optional[float] = None,
    coord_frames: int = 10,
    total_disp: Optional[float] = None,
    avg_disp_v: Optional[float] = None,
    disp_frames: int = 10,
) -> MovementFeatures:
    """Construct MovementFeatures with specific feature values."""
    coverage = DetectionCoverageFeatures(
        total_frames=10,
        detected_frames=10 if stance_frames > 0 else 0,
        coverage_ratio=1.0 if stance_frames > 0 else 0.0,
    )

    stance = StanceFeatures(
        mean_stance_width_norm=mean_stance_w,
        stance_width_std_norm=0.05 if mean_stance_w is not None else None,
        stance_consistency=stance_consistency,
        valid_frames=stance_frames,
    )

    torso_hip = TorsoHipFeatures(
        hip_speed_mean_norm=0.5 if th_stability is not None else None,
        hip_speed_std_norm=0.2 if th_stability is not None else None,
        torso_vertical_tilt_mean_deg=5.0 if th_stability is not None else None,
        torso_vertical_tilt_std_deg=2.0 if th_stability is not None else None,
        torso_hip_stability_score=th_stability,
        valid_frames=stance_frames,
    )

    pose_stab = PoseStabilityFeatures(
        pose_stability_score=pose_stability,
        mean_keypoint_jitter_norm=0.2 if pose_stability is not None else None,
        valid_frames=stance_frames,
    )

    wrists = WristFeatures(
        left_wrist_avg_velocity_norm=l_wrist_v if l_wrist_v is not None else avg_wrist_v,
        left_wrist_peak_velocity_norm=peak_wrist_v,
        left_wrist_movement_range_x=1.0 if avg_wrist_v is not None else None,
        left_wrist_movement_range_y=1.0 if avg_wrist_v is not None else None,
        left_wrist_movement_range_total=1.4 if avg_wrist_v is not None else None,
        right_wrist_avg_velocity_norm=r_wrist_v if r_wrist_v is not None else avg_wrist_v,
        right_wrist_peak_velocity_norm=peak_wrist_v,
        right_wrist_movement_range_x=1.0 if avg_wrist_v is not None else None,
        right_wrist_movement_range_y=1.0 if avg_wrist_v is not None else None,
        right_wrist_movement_range_total=1.4 if avg_wrist_v is not None else None,
        peak_wrist_velocity_norm=peak_wrist_v,
        avg_wrist_velocity_norm=avg_wrist_v,
        valid_frames=arm_frames,
    )

    guard = GuardFeatures(
        left_guard_ratio=guard_ratio,
        right_guard_ratio=guard_ratio,
        both_guard_ratio=both_guard_ratio if both_guard_ratio is not None else guard_ratio,
        guard_position_ratio=guard_ratio,
        valid_frames=guard_frames,
    )

    arm_ext = ArmExtensionFeatures(
        left_arm_extension_mean=max_arm_ext,
        left_arm_extension_max=max_arm_ext,
        right_arm_extension_mean=max_arm_ext,
        right_arm_extension_max=max_arm_ext,
        max_arm_extension=max_arm_ext,
        left_elbow_angle_mean_deg=170.0 if max_arm_ext is not None else None,
        right_elbow_angle_mean_deg=170.0 if max_arm_ext is not None else None,
        valid_frames=arm_frames,
    )

    body_disp = BodyDisplacementFeatures(
        total_displacement_norm=total_disp,
        net_displacement_norm=total_disp * 0.7 if total_disp is not None else None,
        avg_velocity_norm=avg_disp_v,
        peak_velocity_norm=avg_disp_v * 1.5 if avg_disp_v is not None else None,
        valid_frames=disp_frames,
    )

    torso_rot = TorsoRotationFeatures(
        mean_torso_angle_deg=10.0 if twist_deg is not None else None,
        torso_angle_range_deg=30.0 if twist_deg is not None else None,
        torso_rotation_speed_mean_deg_s=rot_speed,
        torso_rotation_speed_max_deg_s=rot_speed * 1.5 if rot_speed is not None else None,
        shoulder_hip_twist_mean_deg=twist_deg,
        valid_frames=coord_frames,
    )

    return MovementFeatures(
        coverage=coverage,
        stance=stance,
        torso_hip=torso_hip,
        pose_stability=pose_stab,
        wrists=wrists,
        guard=guard,
        arm_extension=arm_ext,
        body_displacement=body_disp,
        torso_rotation=torso_rot,
        body_scale=100.0,
    )


# ---------------------------------------------------------------------------
# Test Cases
# ---------------------------------------------------------------------------


class TestHighScoringFeatures:
    """Verifies high performance evaluation (all scores >= 8.0)."""

    def test_high_performance_profile(self):
        analyzer = FightObservationAnalyzer()
        features = make_features(
            mean_stance_w=1.35,        # Ideal base (1.1 - 1.6)
            stance_consistency=0.95,   # High consistency
            th_stability=0.90,         # High torso/hip stability
            pose_stability=0.90,       # High pose stability
            guard_ratio=0.95,          # High guard
            both_guard_ratio=0.90,
            max_arm_ext=0.95,          # Full arm reach
            peak_wrist_v=12.0,         # High punch velocity
            avg_wrist_v=6.0,
            twist_deg=30.0,            # Fluid kinetic twist (15 - 45 deg)
            l_wrist_v=5.8,             # Bilateral symmetry
            r_wrist_v=6.0,
            rot_speed=140.0,           # Dynamic torso rotation
            total_disp=2.0,            # Active footwork mobility
            avg_disp_v=1.2,
        )

        res = analyzer.observe(features)

        assert isinstance(res, FightObservationResult)
        assert res.overall_score is not None
        assert res.overall_score >= 8.0
        assert res.overall_score <= 10.0

        # Verify each of the 6 categories individually
        assert res.stance.score >= 8.0
        assert "Stable athletic stance" in res.stance.observation

        assert res.balance.score >= 8.0
        assert "Strong postural balance" in res.balance.observation

        assert res.guard.score >= 8.0
        assert "high defensive guard" in res.guard.observation

        assert res.striking.score >= 8.0
        assert "Crisp arm extension" in res.striking.observation

        assert res.coordination.score >= 8.0
        assert "Fluid kinetic chain" in res.coordination.observation

        assert res.movement.score >= 8.0
        assert "Active and controlled footwork" in res.movement.observation


class TestMediumScoringFeatures:
    """Verifies medium performance evaluation (scores between 5.0 and 7.9)."""

    def test_medium_performance_profile(self):
        analyzer = FightObservationAnalyzer()
        features = make_features(
            mean_stance_w=0.95,        # Slightly narrow base
            stance_consistency=0.65,   # Moderate consistency
            th_stability=0.60,         # Moderate stability
            pose_stability=0.60,
            guard_ratio=0.60,          # Mid guard
            both_guard_ratio=0.50,
            max_arm_ext=0.65,          # Partial reach
            peak_wrist_v=6.0,          # Moderate punch speed
            avg_wrist_v=3.5,
            twist_deg=12.0,            # Modest twist
            l_wrist_v=3.0,
            r_wrist_v=4.0,
            rot_speed=70.0,            # Moderate rotation
            total_disp=0.9,            # Moderate movement
            avg_disp_v=0.5,
        )

        res = analyzer.observe(features)

        assert res.overall_score is not None
        assert 5.0 <= res.overall_score <= 7.9

        assert 5.0 <= res.stance.score <= 7.9
        assert "Moderate base width" in res.stance.observation

        assert 5.0 <= res.balance.score <= 7.9
        assert "Fair overall balance" in res.balance.observation

        assert 5.0 <= res.guard.score <= 7.9
        assert "mid-chest" in res.guard.observation

        assert 5.0 <= res.striking.score <= 7.9
        assert "Moderate punch extension" in res.striking.observation

        assert 5.0 <= res.coordination.score <= 7.9
        assert "Moderate upper-body rotation" in res.coordination.observation

        assert 5.0 <= res.movement.score <= 7.9
        assert "Moderate movement mobility" in res.movement.observation


class TestLowScoringFeatures:
    """Verifies low performance evaluation (scores < 5.0)."""

    def test_low_performance_profile(self):
        analyzer = FightObservationAnalyzer()
        features = make_features(
            mean_stance_w=0.5,         # Very narrow stance
            stance_consistency=0.2,    # Low consistency
            th_stability=0.20,         # Unstable hips/torso
            pose_stability=0.25,
            guard_ratio=0.15,          # Dropped guard
            both_guard_ratio=0.05,
            max_arm_ext=0.35,          # Very short reach
            peak_wrist_v=2.0,          # Low velocity
            avg_wrist_v=1.0,
            twist_deg=4.0,             # Stiff kinetic chain
            l_wrist_v=0.5,
            r_wrist_v=2.5,             # Asymmetric limb use
            rot_speed=15.0,            # Very slow rotation
            total_disp=0.15,           # Stationary
            avg_disp_v=0.05,
        )

        res = analyzer.observe(features)

        assert res.overall_score is not None
        assert res.overall_score < 5.0

        assert res.stance.score < 5.0
        assert "inconsistent stance base" in res.stance.observation

        assert res.balance.score < 5.0
        assert "torso sway" in res.balance.observation

        assert res.guard.score < 5.0
        assert "Hands frequently dropped low" in res.guard.observation

        assert res.striking.score < 5.0
        assert "Short arm reach" in res.striking.observation

        assert res.coordination.score < 5.0
        assert "stiff kinetic linking" in res.coordination.observation

        assert res.movement.score < 5.0
        assert "Mostly stationary" in res.movement.observation


class TestMissingFeatures:
    """Verifies safe handling of missing/None features."""

    def test_completely_empty_features(self):
        analyzer = FightObservationAnalyzer()
        # Empty features with 0 valid frames everywhere
        empty_features = MovementFeatures(
            coverage=DetectionCoverageFeatures(total_frames=0, detected_frames=0, coverage_ratio=0.0),
            stance=StanceFeatures(valid_frames=0),
            torso_hip=TorsoHipFeatures(valid_frames=0),
            pose_stability=PoseStabilityFeatures(valid_frames=0),
            wrists=WristFeatures(valid_frames=0),
            guard=GuardFeatures(valid_frames=0),
            arm_extension=ArmExtensionFeatures(valid_frames=0),
            body_displacement=BodyDisplacementFeatures(valid_frames=0),
            torso_rotation=TorsoRotationFeatures(valid_frames=0),
            body_scale=None,
        )

        res = analyzer.observe(empty_features)

        assert res.overall_score is None

        # All categories have score None and clear observation
        for cat_name, cat_obs in res.categories.items():
            assert cat_obs.score is None, f"{cat_name} score should be None"
            assert "insufficient" in cat_obs.observation.lower() or "not sufficiently" in cat_obs.observation.lower()

    def test_partial_missing_features(self):
        analyzer = FightObservationAnalyzer()
        # Stance and guard are valid, but striking, movement, and coordination are missing
        partial_features = MovementFeatures(
            coverage=DetectionCoverageFeatures(total_frames=10, detected_frames=10, coverage_ratio=1.0),
            stance=StanceFeatures(mean_stance_width_norm=1.3, stance_consistency=0.9, valid_frames=10),
            torso_hip=TorsoHipFeatures(valid_frames=0),
            pose_stability=PoseStabilityFeatures(valid_frames=0),
            wrists=WristFeatures(valid_frames=0),
            guard=GuardFeatures(guard_position_ratio=0.85, both_guard_ratio=0.8, valid_frames=10),
            arm_extension=ArmExtensionFeatures(valid_frames=0),
            body_displacement=BodyDisplacementFeatures(valid_frames=0),
            torso_rotation=TorsoRotationFeatures(valid_frames=0),
            body_scale=100.0,
        )

        res = analyzer.observe(partial_features)

        # Stance and guard should be scored
        assert res.stance.score is not None
        assert res.guard.score is not None

        # Missing categories should be None
        assert res.balance.score is None
        assert res.striking.score is None
        assert res.coordination.score is None
        assert res.movement.score is None

        # Overall score should be average of only the available categories (stance and guard)
        expected_avg = round((res.stance.score + res.guard.score) / 2.0, 1)
        assert res.overall_score == pytest.approx(expected_avg, abs=1e-2)


class TestFastApiSerializationAndCompliance:
    """Verifies Pydantic serialization for FastAPI responses and disclaimer compliance."""

    def test_model_dump_json_serializable(self):
        analyzer = FightObservationAnalyzer()
        features = make_features(
            mean_stance_w=1.2,
            stance_consistency=0.8,
            th_stability=0.75,
            pose_stability=0.8,
            guard_ratio=0.8,
            max_arm_ext=0.8,
            peak_wrist_v=7.0,
            avg_wrist_v=4.0,
            twist_deg=25.0,
            l_wrist_v=4.0,
            r_wrist_v=4.0,
            rot_speed=90.0,
            total_disp=1.2,
            avg_disp_v=0.8,
        )
        res = analyzer.observe(features)

        # Pydantic serialization
        dumped = res.model_dump()
        assert isinstance(dumped, dict)
        assert "stance" in dumped
        assert "balance" in dumped
        assert "guard" in dumped
        assert "striking" in dumped
        assert "coordination" in dumped
        assert "movement" in dumped
        assert "overall_score" in dumped
        assert "disclaimer" in dumped

        # JSON string serializability
        json_str = res.model_dump_json()
        parsed = json.loads(json_str)
        assert parsed["overall_score"] is not None

    def test_disclaimer_non_professional_statement(self):
        analyzer = FightObservationAnalyzer()
        features = make_features()
        res = analyzer.observe(features)

        assert res.disclaimer == DISCLAIMER_TEXT
        assert "Does not constitute professional judging" in res.disclaimer
