"""
fight_observer.py
-----------------
Deterministic Fight Observation and Scoring layer built on top of MovementFeatures.

Produces explainable heuristic scores from 0–10 across 6 core athletic categories:
  1. Stance: base width and foot spacing consistency
  2. Balance: torso/hip stability and postural control
  3. Guard: defensive hand positioning at head level
  4. Striking: reach extension and peak hand velocity snap
  5. Coordination: kinetic chain engagement, torso rotation, and bilateral limb balance
  6. Movement: controlled displacement and ring/mat mobility

Guarantees:
  - Uses only existing MovementFeatures extracted from PoseSequence.
  - Generates exactly one concise, human-readable observation per category.
  - Handles missing/None features safely without inventing values.
  - Does NOT claim professional fighting ability, judging, or officiating.
  - Completely deterministic, explainable, and does NOT use an LLM.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import numpy as np

from app.analysis.models import (
    ArmExtensionFeatures,
    BodyDisplacementFeatures,
    GuardFeatures,
    MovementFeatures,
    PoseStabilityFeatures,
    StanceFeatures,
    TorsoHipFeatures,
    TorsoRotationFeatures,
    WristFeatures,
)
from app.schemas.analysis import CategoryObservation, FightObservationResult

logger = logging.getLogger(__name__)

DISCLAIMER_TEXT = (
    "Heuristic movement observations for athletic training and fitness feedback only. "
    "Does not constitute professional judging, officiating, or combat readiness evaluation."
)


class FightObservationAnalyzer:
    """Analyzes MovementFeatures to generate deterministic category scores and observations."""

    def observe(
        self,
        features: MovementFeatures,
        session_id: Optional[str] = None,
    ) -> FightObservationResult:
        """
        Produce deterministic observations and 0-10 scores from MovementFeatures.

        Args:
            features: Calculated MovementFeatures from a PoseSequence.
            session_id: Optional unique identifier for the recording session.

        Returns:
            FightObservationResult containing all 6 categories, overall score, and disclaimer.
        """
        stance_obs = self._evaluate_stance(features.stance)
        balance_obs = self._evaluate_balance(features.torso_hip, features.pose_stability)
        guard_obs = self._evaluate_guard(features.guard)
        striking_obs = self._evaluate_striking(features.arm_extension, features.wrists)
        coordination_obs = self._evaluate_coordination(features.torso_rotation, features.wrists)
        movement_obs = self._evaluate_movement(features.body_displacement, features.torso_rotation)

        category_scores: List[float] = [
            c.score
            for c in (stance_obs, balance_obs, guard_obs, striking_obs, coordination_obs, movement_obs)
            if c.score is not None
        ]

        overall_score = (
            round(float(np.mean(category_scores)), 1)
            if category_scores
            else None
        )

        return FightObservationResult(
            session_id=session_id,
            overall_score=overall_score,
            stance=stance_obs,
            balance=balance_obs,
            guard=guard_obs,
            striking=striking_obs,
            coordination=coordination_obs,
            movement=movement_obs,
            disclaimer=DISCLAIMER_TEXT,
        )

    # Alias for API consistency
    analyze = observe

    # -----------------------------------------------------------------------
    # 1. Stance
    # -----------------------------------------------------------------------

    def _evaluate_stance(self, stance: StanceFeatures) -> CategoryObservation:
        """Evaluate base width and stance consistency."""
        if stance.valid_frames == 0 or stance.mean_stance_width_norm is None:
            return CategoryObservation(
                category="stance",
                score=None,
                observation="Lower-body keypoints were not sufficiently visible to evaluate stance.",
                metrics_summary={"valid_frames": 0},
            )

        mean_w = stance.mean_stance_width_norm
        consistency = stance.stance_consistency if stance.stance_consistency is not None else 0.0

        # Width component: ideal athletic base is 1.1x - 1.6x body scale
        if 1.1 <= mean_w <= 1.6:
            width_score = 10.0
        elif mean_w < 1.1:
            width_score = max(1.0, 10.0 - ((1.1 - mean_w) / 0.5) * 7.0)
        else:
            width_score = max(1.0, 10.0 - ((mean_w - 1.6) / 0.8) * 7.0)

        # Consistency component: [0.0, 1.0] -> 0 to 10
        consistency_score = consistency * 10.0

        combined = 0.5 * width_score + 0.5 * consistency_score
        score = round(min(10.0, max(0.0, combined)), 1)

        if score >= 8.0:
            obs = "Stable athletic stance maintained with consistent foot separation."
        elif score >= 5.0:
            obs = "Moderate base width maintained, with occasional stance narrowing or width fluctuation."
        else:
            obs = "Variable foot separation and inconsistent stance base observed."

        return CategoryObservation(
            category="stance",
            score=score,
            observation=obs,
            metrics_summary={
                "mean_stance_width_norm": round(mean_w, 2),
                "stance_consistency": round(consistency, 2),
                "valid_frames": stance.valid_frames,
            },
        )

    # -----------------------------------------------------------------------
    # 2. Balance
    # -----------------------------------------------------------------------

    def _evaluate_balance(
        self,
        torso_hip: TorsoHipFeatures,
        pose_stability: PoseStabilityFeatures,
    ) -> CategoryObservation:
        """Evaluate postural stability, torso vertical tilt, and center of gravity."""
        th_score = torso_hip.torso_hip_stability_score
        ps_score = pose_stability.pose_stability_score

        if th_score is None and ps_score is None:
            return CategoryObservation(
                category="balance",
                score=None,
                observation="Torso and hip keypoints were not sufficiently visible to evaluate balance.",
                metrics_summary={"valid_frames": 0},
            )

        if th_score is not None and ps_score is not None:
            raw = 0.6 * th_score + 0.4 * ps_score
        elif th_score is not None:
            raw = th_score
        else:
            raw = ps_score  # type: ignore[assignment]

        score = round(min(10.0, max(0.0, raw * 10.0)), 1)

        if score >= 8.0:
            obs = "Strong postural balance maintained with upright torso control and stable center of gravity."
        elif score >= 5.0:
            obs = "Fair overall balance with occasional torso tilt during movement."
        else:
            obs = "Noticeable torso sway and hip instability detected during movement."

        return CategoryObservation(
            category="balance",
            score=score,
            observation=obs,
            metrics_summary={
                "torso_hip_stability_score": round(th_score, 2) if th_score is not None else None,
                "pose_stability_score": round(ps_score, 2) if ps_score is not None else None,
                "torso_tilt_std_deg": round(torso_hip.torso_vertical_tilt_std_deg, 1)
                if torso_hip.torso_vertical_tilt_std_deg is not None
                else None,
            },
        )

    # -----------------------------------------------------------------------
    # 3. Guard
    # -----------------------------------------------------------------------

    def _evaluate_guard(self, guard: GuardFeatures) -> CategoryObservation:
        """Evaluate defensive hand positioning near head level."""
        if guard.valid_frames == 0 or guard.guard_position_ratio is None:
            return CategoryObservation(
                category="guard",
                score=None,
                observation="Hand and shoulder keypoints were not sufficiently visible to evaluate guard.",
                metrics_summary={"valid_frames": 0},
            )

        g_ratio = guard.guard_position_ratio
        both_ratio = guard.both_guard_ratio if guard.both_guard_ratio is not None else g_ratio

        raw = 0.7 * g_ratio + 0.3 * both_ratio
        score = round(min(10.0, max(0.0, raw * 10.0)), 1)

        if score >= 8.0:
            obs = "Hands remained disciplined in high defensive guard near head level."
        elif score >= 5.0:
            obs = "Hands held in mid-chest position with intermittent guard drops."
        else:
            obs = "Hands frequently dropped low away from defensive head position."

        return CategoryObservation(
            category="guard",
            score=score,
            observation=obs,
            metrics_summary={
                "guard_position_ratio": round(g_ratio, 2),
                "both_guard_ratio": round(both_ratio, 2),
                "left_guard_ratio": round(guard.left_guard_ratio, 2) if guard.left_guard_ratio is not None else None,
                "right_guard_ratio": round(guard.right_guard_ratio, 2) if guard.right_guard_ratio is not None else None,
            },
        )

    # -----------------------------------------------------------------------
    # 4. Striking
    # -----------------------------------------------------------------------

    def _evaluate_striking(
        self,
        arm_ext: ArmExtensionFeatures,
        wrists: WristFeatures,
    ) -> CategoryObservation:
        """Evaluate arm extension reach and peak hand velocity."""
        max_ext = arm_ext.max_arm_extension
        peak_v = wrists.peak_wrist_velocity_norm

        if max_ext is None and peak_v is None:
            return CategoryObservation(
                category="striking",
                score=None,
                observation="Arm and wrist keypoints were not sufficiently visible to evaluate striking.",
                metrics_summary={"valid_frames": 0},
            )

        ext_score: Optional[float] = None
        if max_ext is not None:
            if max_ext >= 0.90:
                ext_score = 10.0
            else:
                ext_score = max(1.0, (max_ext / 0.90) * 10.0)

        vel_score: Optional[float] = None
        if peak_v is not None:
            # 10.0 body_scales/sec is considered strong hand velocity
            vel_score = min(10.0, max(1.0, (peak_v / 10.0) * 10.0))

        if ext_score is not None and vel_score is not None:
            raw = 0.5 * ext_score + 0.5 * vel_score
        elif ext_score is not None:
            raw = ext_score
        else:
            raw = vel_score  # type: ignore[assignment]

        score = round(min(10.0, max(0.0, raw)), 1)

        if score >= 8.0:
            obs = "Crisp arm extension and high peak hand velocity observed on punches."
        elif score >= 5.0:
            obs = "Moderate punch extension with steady hand movement speed."
        else:
            obs = "Short arm reach and low hand acceleration detected during strikes."

        return CategoryObservation(
            category="striking",
            score=score,
            observation=obs,
            metrics_summary={
                "max_arm_extension": round(max_ext, 2) if max_ext is not None else None,
                "peak_wrist_velocity_norm": round(peak_v, 2) if peak_v is not None else None,
                "avg_wrist_velocity_norm": round(wrists.avg_wrist_velocity_norm, 2)
                if wrists.avg_wrist_velocity_norm is not None
                else None,
            },
        )

    # -----------------------------------------------------------------------
    # 5. Coordination
    # -----------------------------------------------------------------------

    def _evaluate_coordination(
        self,
        torso_rot: TorsoRotationFeatures,
        wrists: WristFeatures,
    ) -> CategoryObservation:
        """Evaluate kinetic chain rotation, bilateral limb engagement, and twist."""
        twist = torso_rot.shoulder_hip_twist_mean_deg
        l_vel = wrists.left_wrist_avg_velocity_norm
        r_vel = wrists.right_wrist_avg_velocity_norm
        rot_spd = torso_rot.torso_rotation_speed_mean_deg_s

        components: List[float] = []

        # 1. Rotational twist: ideal range 15 deg - 45 deg
        if twist is not None:
            if 15.0 <= twist <= 45.0:
                components.append(10.0)
            elif twist < 15.0:
                components.append(max(2.0, (twist / 15.0) * 10.0))
            else:
                components.append(max(3.0, 10.0 - ((twist - 45.0) / 45.0) * 5.0))

        # 2. Bilateral limb balance
        if l_vel is not None and r_vel is not None:
            denom = l_vel + r_vel
            if denom > 1e-4:
                diff = abs(l_vel - r_vel)
                sym = 1.0 - (diff / denom)
                components.append(4.0 + 6.0 * sym)

        # 3. Rotational speed
        if rot_spd is not None:
            components.append(min(10.0, max(2.0, (rot_spd / 120.0) * 10.0)))

        if not components:
            return CategoryObservation(
                category="coordination",
                score=None,
                observation="Kinetic and rotational markers were not sufficiently visible to evaluate coordination.",
                metrics_summary={"valid_frames": 0},
            )

        score = round(min(10.0, max(0.0, float(np.mean(components)))), 1)

        if score >= 8.0:
            obs = "Fluid kinetic chain engagement with coordinated shoulder-hip rotation."
        elif score >= 5.0:
            obs = "Moderate upper-body rotation and reasonable movement coordination."
        else:
            obs = "Limited torso rotation and stiff kinetic linking across limbs."

        return CategoryObservation(
            category="coordination",
            score=score,
            observation=obs,
            metrics_summary={
                "shoulder_hip_twist_deg": round(twist, 1) if twist is not None else None,
                "torso_rotation_speed_deg_s": round(rot_spd, 1) if rot_spd is not None else None,
            },
        )

    # -----------------------------------------------------------------------
    # 6. Movement
    # -----------------------------------------------------------------------

    def _evaluate_movement(
        self,
        disp: BodyDisplacementFeatures,
        torso_rot: TorsoRotationFeatures,
    ) -> CategoryObservation:
        """Evaluate whole-body translation, footwork mobility, and displacement speed."""
        total_d = disp.total_displacement_norm
        avg_v = disp.avg_velocity_norm

        if disp.valid_frames == 0 or total_d is None:
            return CategoryObservation(
                category="movement",
                score=None,
                observation="Body positioning markers were not sufficiently visible to evaluate footwork movement.",
                metrics_summary={"valid_frames": 0},
            )

        # Displacement score: active translation
        disp_score = min(10.0, max(2.0, (total_d / 1.5) * 8.0 + 2.0))

        # Velocity score: active, controlled footwork speed
        actual_v = avg_v if avg_v is not None else 0.0
        if actual_v <= 1.2:
            vel_score = min(10.0, max(2.0, (actual_v / 1.2) * 8.0 + 2.0))
        elif actual_v <= 4.0:
            vel_score = 10.0
        else:
            vel_score = max(3.0, 10.0 - ((actual_v - 4.0) / 4.0) * 5.0)

        raw = 0.5 * disp_score + 0.5 * vel_score
        score = round(min(10.0, max(0.0, raw)), 1)

        if score >= 8.0:
            obs = "Active and controlled footwork with steady mobility across the training area."
        elif score >= 5.0:
            obs = "Moderate movement mobility with occasional footwork adjustments."
        else:
            obs = "Mostly stationary positioning with limited footwork and floor movement."

        return CategoryObservation(
            category="movement",
            score=score,
            observation=obs,
            metrics_summary={
                "total_displacement_norm": round(total_d, 2),
                "avg_velocity_norm": round(actual_v, 2),
            },
        )
