"""
movement_features.py
--------------------
Biomechanics and kinematic feature extraction layer for AI Fight Analyzer.

Analyzes time-ordered PoseSequence instances using 17 COCO keypoints and per-frame
timestamps to produce comprehensive, explainable, and normalized MovementFeatures:
  - Detection coverage
  - Normalized stance width and stance consistency
  - Torso / hip movement stability and spine vertical inclination
  - Structural pose stability and anatomical keypoint jitter
  - Left / right wrist velocities and spatial movement ranges
  - Defensive hand guard-position ratios
  - Left / right arm extensions and elbow joint angles
  - Body displacement and movement velocities
  - Torso rotation, shoulder line angular speed, and shoulder-hip twist

Requirements adhered to:
  - Real timestamps from PoseSequence are used for all temporal derivations; never assumes fixed FPS.
  - Spatial measurements are normalized by body scale (median shoulder width / torso height).
  - Missing or low-confidence keypoints are strictly excluded without inventing synthetic values.
  - Calculations are deterministic, fully explainable, and numerically guarded against division by zero.
"""

from __future__ import annotations

import logging
import math
from typing import List, Optional, Tuple

import numpy as np

from app.analysis.models import (
    ArmExtensionFeatures,
    BodyDisplacementFeatures,
    DetectionCoverageFeatures,
    GuardFeatures,
    MovementFeatures,
    PoseFrame,
    PoseSequence,
    PoseStabilityFeatures,
    StanceFeatures,
    TorsoHipFeatures,
    TorsoRotationFeatures,
    WristFeatures,
)

logger = logging.getLogger(__name__)

# Default minimum confidence required to consider a keypoint valid
DEFAULT_MIN_KEYPOINT_CONFIDENCE = 0.5


def _dist_2d(p1: Tuple[float, float], p2: Tuple[float, float]) -> float:
    """Euclidean distance between two 2D points."""
    return math.hypot(p1[0] - p2[0], p1[1] - p2[1])


def _get_kp(frame: PoseFrame, name: str, min_conf: float) -> Optional[Tuple[float, float]]:
    """Return (x_px, y_px) if keypoint exists and confidence >= min_conf, else None."""
    kp = frame.get_keypoint(name)
    if kp is not None and kp.confidence >= min_conf:
        return (kp.x_px, kp.y_px)
    return None


class MovementFeaturesAnalyzer:
    """Analyzes a PoseSequence and computes normalized, explainable kinematic features."""

    def __init__(self, min_keypoint_confidence: float = DEFAULT_MIN_KEYPOINT_CONFIDENCE):
        """
        Initialize the movement feature analyzer.

        Args:
            min_keypoint_confidence: Threshold below which keypoints are ignored as missing.
        """
        self.min_keypoint_confidence = min_keypoint_confidence

    def analyze(self, sequence: PoseSequence) -> MovementFeatures:
        """
        Extract complete MovementFeatures from a PoseSequence.

        Args:
            sequence: The PoseSequence to analyze.

        Returns:
            MovementFeatures dataclass containing all computed biomechanical features.
        """
        frames = sequence.frames
        min_conf = self.min_keypoint_confidence

        # 1. Detection coverage
        coverage = self._compute_detection_coverage(sequence)

        # 2. Sequence-level body scale reference (in pixels)
        body_scale = self._compute_body_scale(frames, min_conf)

        # 3. Component features
        stance = self._compute_stance_features(frames, body_scale, min_conf)
        torso_hip = self._compute_torso_hip_features(frames, body_scale, min_conf)
        pose_stability = self._compute_pose_stability(frames, body_scale, min_conf)
        wrists = self._compute_wrist_features(frames, body_scale, min_conf)
        guard = self._compute_guard_features(frames, body_scale, min_conf)
        arm_extension = self._compute_arm_extension_features(frames, min_conf)
        body_displacement = self._compute_body_displacement(frames, body_scale, min_conf)
        torso_rotation = self._compute_torso_rotation(frames, min_conf)

        return MovementFeatures(
            coverage=coverage,
            stance=stance,
            torso_hip=torso_hip,
            pose_stability=pose_stability,
            wrists=wrists,
            guard=guard,
            arm_extension=arm_extension,
            body_displacement=body_displacement,
            torso_rotation=torso_rotation,
            body_scale=body_scale,
        )

    # -----------------------------------------------------------------------
    # 1. Body Scale Calculation
    # -----------------------------------------------------------------------

    def _compute_body_scale(
        self,
        frames: List[PoseFrame],
        min_conf: float,
    ) -> Optional[float]:
        """
        Compute an isotropic normalization scale (in pixels) for the sequence.
        Primary: median distance between left and right shoulder.
        Secondary fallback: median distance between mid-shoulder and mid-hip.
        Tertiary fallback: median bbox height * 0.25.
        """
        shoulder_dists: List[float] = []
        torso_dists: List[float] = []
        bbox_heights: List[float] = []

        for f in frames:
            if not f.detection_present:
                continue

            ls = _get_kp(f, "left_shoulder", min_conf)
            rs = _get_kp(f, "right_shoulder", min_conf)
            lh = _get_kp(f, "left_hip", min_conf)
            rh = _get_kp(f, "right_hip", min_conf)

            if ls and rs:
                d = _dist_2d(ls, rs)
                if d > 1.0:
                    shoulder_dists.append(d)

            if ls and rs and lh and rh:
                mid_s = ((ls[0] + rs[0]) / 2.0, (ls[1] + rs[1]) / 2.0)
                mid_h = ((lh[0] + rh[0]) / 2.0, (lh[1] + rh[1]) / 2.0)
                td = _dist_2d(mid_s, mid_h)
                if td > 1.0:
                    torso_dists.append(td)

            if f.bbox_xyxy is not None:
                h = abs(f.bbox_xyxy[3] - f.bbox_xyxy[1])
                if h > 1.0:
                    bbox_heights.append(h)

        if shoulder_dists:
            return float(np.median(shoulder_dists))

        if torso_dists:
            return float(np.median(torso_dists))

        if bbox_heights:
            return float(np.median(bbox_heights) * 0.25)

        return None

    # -----------------------------------------------------------------------
    # 2. Detection Coverage
    # -----------------------------------------------------------------------

    def _compute_detection_coverage(self, sequence: PoseSequence) -> DetectionCoverageFeatures:
        total = len(sequence.frames)
        detected = sequence.detected_frames_count
        ratio = (detected / total) if total > 0 else 0.0
        return DetectionCoverageFeatures(
            total_frames=total,
            detected_frames=detected,
            coverage_ratio=float(ratio),
        )

    # -----------------------------------------------------------------------
    # 3. Normalized Stance Width + Stance Consistency
    # -----------------------------------------------------------------------

    def _compute_stance_features(
        self,
        frames: List[PoseFrame],
        body_scale: Optional[float],
        min_conf: float,
    ) -> StanceFeatures:
        if body_scale is None or body_scale <= 0.0:
            return StanceFeatures(valid_frames=0)

        widths: List[float] = []
        for f in frames:
            if not f.detection_present:
                continue
            la = _get_kp(f, "left_ankle", min_conf)
            ra = _get_kp(f, "right_ankle", min_conf)
            if la and ra:
                w = _dist_2d(la, ra) / body_scale
                widths.append(w)

        if not widths:
            return StanceFeatures(valid_frames=0)

        mean_w = float(np.mean(widths))
        std_w = float(np.std(widths)) if len(widths) > 1 else 0.0

        if len(widths) == 1:
            consistency = 1.0
        else:
            cv = (std_w / mean_w) if mean_w > 1e-6 else 0.0
            consistency = float(np.clip(1.0 - cv, 0.0, 1.0))

        return StanceFeatures(
            mean_stance_width_norm=mean_w,
            stance_width_std_norm=std_w,
            stance_consistency=consistency,
            valid_frames=len(widths),
        )

    # -----------------------------------------------------------------------
    # 4. Torso / Hip Stability
    # -----------------------------------------------------------------------

    def _compute_torso_hip_features(
        self,
        frames: List[PoseFrame],
        body_scale: Optional[float],
        min_conf: float,
    ) -> TorsoHipFeatures:
        tilts: List[float] = []
        hip_points: List[Tuple[float, Tuple[float, float]]] = []  # (timestamp, mid_hip)

        for f in frames:
            if not f.detection_present:
                continue

            lh = _get_kp(f, "left_hip", min_conf)
            rh = _get_kp(f, "right_hip", min_conf)
            ls = _get_kp(f, "left_shoulder", min_conf)
            rs = _get_kp(f, "right_shoulder", min_conf)

            mid_h = ((lh[0] + rh[0]) / 2.0, (lh[1] + rh[1]) / 2.0) if (lh and rh) else None
            mid_s = ((ls[0] + rs[0]) / 2.0, (ls[1] + rs[1]) / 2.0) if (ls and rs) else None

            if mid_h is not None:
                hip_points.append((f.timestamp, mid_h))

            # Spine vector: mid_hip -> mid_shoulder
            if mid_h is not None and mid_s is not None:
                dx = mid_s[0] - mid_h[0]
                dy = mid_s[1] - mid_h[1]
                # In screen coordinates, y increases downward; straight up is (0, -1).
                tilt_deg = math.degrees(math.atan2(abs(dx), -dy))
                tilts.append(tilt_deg)

        # Hip velocities
        hip_speeds: List[float] = []
        if body_scale is not None and body_scale > 0.0 and len(hip_points) >= 2:
            for i in range(1, len(hip_points)):
                t_prev, p_prev = hip_points[i - 1]
                t_curr, p_curr = hip_points[i]
                dt = t_curr - t_prev
                if dt > 0.0:
                    speed = _dist_2d(p_curr, p_prev) / (dt * body_scale)
                    hip_speeds.append(speed)

        tilt_mean = float(np.mean(tilts)) if tilts else None
        tilt_std = float(np.std(tilts)) if len(tilts) > 1 else (0.0 if tilts else None)

        speed_mean = float(np.mean(hip_speeds)) if hip_speeds else None
        speed_std = float(np.std(hip_speeds)) if len(hip_speeds) > 1 else (0.0 if hip_speeds else None)

        score: Optional[float] = None
        if tilts or hip_speeds:
            s_pen = ((speed_mean or 0.0) * 0.5) + (speed_std or 0.0)
            t_pen = ((tilt_std or 0.0) / 30.0) + ((tilt_mean or 0.0) / 60.0)
            score = float(1.0 / (1.0 + s_pen + t_pen))

        valid_count = max(len(tilts), len(hip_points))

        return TorsoHipFeatures(
            hip_speed_mean_norm=speed_mean,
            hip_speed_std_norm=speed_std,
            torso_vertical_tilt_mean_deg=tilt_mean,
            torso_vertical_tilt_std_deg=tilt_std,
            torso_hip_stability_score=score,
            valid_frames=valid_count,
        )

    # -----------------------------------------------------------------------
    # 5. Pose Stability
    # -----------------------------------------------------------------------

    def _compute_pose_stability(
        self,
        frames: List[PoseFrame],
        body_scale: Optional[float],
        min_conf: float,
    ) -> PoseStabilityFeatures:
        if body_scale is None or body_scale <= 0.0 or len(frames) < 2:
            return PoseStabilityFeatures(valid_frames=len([f for f in frames if f.detection_present]))

        core_kps = ("left_shoulder", "right_shoulder", "left_hip", "right_hip")
        jitter_rates: List[float] = []

        valid_frames = [f for f in frames if f.detection_present]
        for i in range(1, len(valid_frames)):
            f_prev = valid_frames[i - 1]
            f_curr = valid_frames[i]
            dt = f_curr.timestamp - f_prev.timestamp
            if dt <= 0.0:
                continue

            shared_disps: List[float] = []
            for name in core_kps:
                p1 = _get_kp(f_prev, name, min_conf)
                p2 = _get_kp(f_curr, name, min_conf)
                if p1 and p2:
                    shared_disps.append(_dist_2d(p1, p2))

            if len(shared_disps) >= 2:
                mean_disp_norm = (sum(shared_disps) / len(shared_disps)) / body_scale
                jitter_rates.append(mean_disp_norm / dt)

        if not jitter_rates:
            return PoseStabilityFeatures(valid_frames=len(valid_frames))

        mean_jitter = float(np.mean(jitter_rates))
        stability_score = float(1.0 / (1.0 + mean_jitter))

        return PoseStabilityFeatures(
            pose_stability_score=stability_score,
            mean_keypoint_jitter_norm=mean_jitter,
            valid_frames=len(valid_frames),
        )

    # -----------------------------------------------------------------------
    # 6. Wrist / Hand Velocity and Movement Range
    # -----------------------------------------------------------------------

    def _compute_wrist_features(
        self,
        frames: List[PoseFrame],
        body_scale: Optional[float],
        min_conf: float,
    ) -> WristFeatures:
        left_samples: List[Tuple[float, Tuple[float, float]]] = []
        right_samples: List[Tuple[float, Tuple[float, float]]] = []

        for f in frames:
            if not f.detection_present:
                continue
            lw = _get_kp(f, "left_wrist", min_conf)
            rw = _get_kp(f, "right_wrist", min_conf)
            if lw:
                left_samples.append((f.timestamp, lw))
            if rw:
                right_samples.append((f.timestamp, rw))

        def _wrist_stats(
            samples: List[Tuple[float, Tuple[float, float]]],
        ) -> Tuple[
            Optional[float],
            Optional[float],
            Optional[float],
            Optional[float],
            Optional[float],
        ]:
            if not samples or body_scale is None or body_scale <= 0.0:
                return None, None, None, None, None

            xs = [p[1][0] for p in samples]
            ys = [p[1][1] for p in samples]
            rx = float((max(xs) - min(xs)) / body_scale)
            ry = float((max(ys) - min(ys)) / body_scale)
            rtotal = float(math.hypot(rx, ry))

            vels: List[float] = []
            for i in range(1, len(samples)):
                t_prev, p_prev = samples[i - 1]
                t_curr, p_curr = samples[i]
                dt = t_curr - t_prev
                if dt > 0.0:
                    v = _dist_2d(p_curr, p_prev) / (dt * body_scale)
                    vels.append(v)

            avg_v = float(np.mean(vels)) if vels else None
            peak_v = float(np.max(vels)) if vels else None
            return avg_v, peak_v, rx, ry, rtotal

        l_avg, l_peak, l_rx, l_ry, l_rt = _wrist_stats(left_samples)
        r_avg, r_peak, r_rx, r_ry, r_rt = _wrist_stats(right_samples)

        # Combined wrist metrics
        peaks = [p for p in (l_peak, r_peak) if p is not None]
        overall_peak = float(max(peaks)) if peaks else None

        avgs = [a for a in (l_avg, r_avg) if a is not None]
        overall_avg = float(np.mean(avgs)) if avgs else None

        valid_cnt = max(len(left_samples), len(right_samples))

        return WristFeatures(
            left_wrist_avg_velocity_norm=l_avg,
            left_wrist_peak_velocity_norm=l_peak,
            left_wrist_movement_range_x=l_rx,
            left_wrist_movement_range_y=l_ry,
            left_wrist_movement_range_total=l_rt,
            right_wrist_avg_velocity_norm=r_avg,
            right_wrist_peak_velocity_norm=r_peak,
            right_wrist_movement_range_x=r_rx,
            right_wrist_movement_range_y=r_ry,
            right_wrist_movement_range_total=r_rt,
            peak_wrist_velocity_norm=overall_peak,
            avg_wrist_velocity_norm=overall_avg,
            valid_frames=valid_cnt,
        )

    # -----------------------------------------------------------------------
    # 7. Guard-Position Ratio
    # -----------------------------------------------------------------------

    def _compute_guard_features(
        self,
        frames: List[PoseFrame],
        body_scale: Optional[float],
        min_conf: float,
    ) -> GuardFeatures:
        left_guard_flags: List[bool] = []
        right_guard_flags: List[bool] = []
        both_guard_flags: List[bool] = []

        scale = body_scale if (body_scale is not None and body_scale > 0.0) else None

        for f in frames:
            if not f.detection_present:
                continue

            ls = _get_kp(f, "left_shoulder", min_conf)
            rs = _get_kp(f, "right_shoulder", min_conf)
            shoulders = [s for s in (ls, rs) if s is not None]
            if not shoulders:
                continue

            # Upper body anchor: shoulder line y and horizontal center
            ref_y = min(s[1] for s in shoulders)
            ref_x = sum(s[0] for s in shoulders) / len(shoulders)

            # Defensive guard threshold: hands at or above chest/shoulder level
            # In image coordinates, y goes down, so y <= guard_y_max is higher on body.
            margin_y = 0.20 * scale if scale is not None else 20.0
            guard_y_max = ref_y + margin_y

            max_horiz_dist = 1.6 * scale if scale is not None else 300.0

            lw = _get_kp(f, "left_wrist", min_conf)
            rw = _get_kp(f, "right_wrist", min_conf)

            is_l = False
            if lw:
                is_l = (lw[1] <= guard_y_max) and (abs(lw[0] - ref_x) <= max_horiz_dist)
                left_guard_flags.append(is_l)

            is_r = False
            if rw:
                is_r = (rw[1] <= guard_y_max) and (abs(rw[0] - ref_x) <= max_horiz_dist)
                right_guard_flags.append(is_r)

            if lw and rw:
                both_guard_flags.append(is_l and is_r)

        if not left_guard_flags and not right_guard_flags:
            return GuardFeatures(valid_frames=0)

        l_ratio = float(np.mean(left_guard_flags)) if left_guard_flags else None
        r_ratio = float(np.mean(right_guard_flags)) if right_guard_flags else None
        b_ratio = float(np.mean(both_guard_flags)) if both_guard_flags else None

        available_ratios = [r for r in (l_ratio, r_ratio) if r is not None]
        overall_guard = float(np.mean(available_ratios)) if available_ratios else None

        valid_cnt = max(len(left_guard_flags), len(right_guard_flags))

        return GuardFeatures(
            left_guard_ratio=l_ratio,
            right_guard_ratio=r_ratio,
            both_guard_ratio=b_ratio,
            guard_position_ratio=overall_guard,
            valid_frames=valid_cnt,
        )

    # -----------------------------------------------------------------------
    # 8. Arm Extension
    # -----------------------------------------------------------------------

    def _compute_arm_extension_features(
        self,
        frames: List[PoseFrame],
        min_conf: float,
    ) -> ArmExtensionFeatures:
        def _arm_metrics(
            s_name: str, e_name: str, w_name: str
        ) -> Tuple[List[float], List[float]]:
            exts: List[float] = []
            angles: List[float] = []
            for f in frames:
                if not f.detection_present:
                    continue
                s = _get_kp(f, s_name, min_conf)
                e = _get_kp(f, e_name, min_conf)
                w = _get_kp(f, w_name, min_conf)
                if s and e and w:
                    l1 = _dist_2d(s, e)
                    l2 = _dist_2d(e, w)
                    reach = _dist_2d(s, w)
                    full_len = l1 + l2
                    if full_len > 1e-4:
                        exts.append(min(1.0, reach / full_len))

                    v1 = (s[0] - e[0], s[1] - e[1])
                    v2 = (w[0] - e[0], w[1] - e[1])
                    mag1 = math.hypot(v1[0], v1[1])
                    mag2 = math.hypot(v2[0], v2[1])
                    if mag1 > 1e-4 and mag2 > 1e-4:
                        dot = v1[0] * v2[0] + v1[1] * v2[1]
                        cos_val = np.clip(dot / (mag1 * mag2), -1.0, 1.0)
                        angle_deg = math.degrees(math.acos(cos_val))
                        angles.append(angle_deg)
            return exts, angles

        l_exts, l_angles = _arm_metrics("left_shoulder", "left_elbow", "left_wrist")
        r_exts, r_angles = _arm_metrics("right_shoulder", "right_elbow", "right_wrist")

        if not l_exts and not r_exts:
            return ArmExtensionFeatures(valid_frames=0)

        l_mean = float(np.mean(l_exts)) if l_exts else None
        l_max = float(np.max(l_exts)) if l_exts else None
        l_angle_mean = float(np.mean(l_angles)) if l_angles else None

        r_mean = float(np.mean(r_exts)) if r_exts else None
        r_max = float(np.max(r_exts)) if r_exts else None
        r_angle_mean = float(np.mean(r_angles)) if r_angles else None

        max_ext_candidates = [m for m in (l_max, r_max) if m is not None]
        overall_max_ext = float(max(max_ext_candidates)) if max_ext_candidates else None

        valid_cnt = max(len(l_exts), len(r_exts))

        return ArmExtensionFeatures(
            left_arm_extension_mean=l_mean,
            left_arm_extension_max=l_max,
            right_arm_extension_mean=r_mean,
            right_arm_extension_max=r_max,
            max_arm_extension=overall_max_ext,
            left_elbow_angle_mean_deg=l_angle_mean,
            right_elbow_angle_mean_deg=r_angle_mean,
            valid_frames=valid_cnt,
        )

    # -----------------------------------------------------------------------
    # 9. Body Displacement and Movement Velocity
    # -----------------------------------------------------------------------

    def _compute_body_displacement(
        self,
        frames: List[PoseFrame],
        body_scale: Optional[float],
        min_conf: float,
    ) -> BodyDisplacementFeatures:
        if body_scale is None or body_scale <= 0.0:
            return BodyDisplacementFeatures(valid_frames=0)

        centers: List[Tuple[float, Tuple[float, float]]] = []

        for f in frames:
            if not f.detection_present:
                continue

            # Prioritize mid-hip as anatomical center of mass
            lh = _get_kp(f, "left_hip", min_conf)
            rh = _get_kp(f, "right_hip", min_conf)
            if lh and rh:
                centers.append((f.timestamp, ((lh[0] + rh[0]) / 2.0, (lh[1] + rh[1]) / 2.0)))
                continue

            # Fallback to bbox center
            if f.bbox_xyxy is not None:
                cx = (f.bbox_xyxy[0] + f.bbox_xyxy[2]) / 2.0
                cy = (f.bbox_xyxy[1] + f.bbox_xyxy[3]) / 2.0
                centers.append((f.timestamp, (cx, cy)))
                continue

            # Fallback to mid-shoulder
            ls = _get_kp(f, "left_shoulder", min_conf)
            rs = _get_kp(f, "right_shoulder", min_conf)
            if ls and rs:
                centers.append((f.timestamp, ((ls[0] + rs[0]) / 2.0, (ls[1] + rs[1]) / 2.0)))

        if len(centers) < 2:
            return BodyDisplacementFeatures(valid_frames=len(centers))

        step_dists: List[float] = []
        step_vels: List[float] = []
        total_time = 0.0

        for i in range(1, len(centers)):
            t_prev, c_prev = centers[i - 1]
            t_curr, c_curr = centers[i]
            dt = t_curr - t_prev
            if dt > 0.0:
                step_norm = _dist_2d(c_curr, c_prev) / body_scale
                step_dists.append(step_norm)
                step_vels.append(step_norm / dt)
                total_time += dt

        if not step_dists:
            return BodyDisplacementFeatures(valid_frames=len(centers))

        total_disp = float(np.sum(step_dists))
        first_c = centers[0][1]
        last_c = centers[-1][1]
        net_disp = float(_dist_2d(last_c, first_c) / body_scale)

        avg_vel = float(total_disp / total_time) if total_time > 0.0 else None
        peak_vel = float(np.max(step_vels)) if step_vels else None

        return BodyDisplacementFeatures(
            total_displacement_norm=total_disp,
            net_displacement_norm=net_disp,
            avg_velocity_norm=avg_vel,
            peak_velocity_norm=peak_vel,
            valid_frames=len(centers),
        )

    # -----------------------------------------------------------------------
    # 10. Torso Rotation
    # -----------------------------------------------------------------------

    def _compute_torso_rotation(
        self,
        frames: List[PoseFrame],
        min_conf: float,
    ) -> TorsoRotationFeatures:
        shoulder_angles: List[Tuple[float, float]] = []  # (timestamp, angle_deg)
        twists: List[float] = []

        for f in frames:
            if not f.detection_present:
                continue

            ls = _get_kp(f, "left_shoulder", min_conf)
            rs = _get_kp(f, "right_shoulder", min_conf)
            lh = _get_kp(f, "left_hip", min_conf)
            rh = _get_kp(f, "right_hip", min_conf)

            s_angle: Optional[float] = None
            if ls and rs:
                # Angle of shoulder axis relative to horizontal
                s_angle = math.degrees(math.atan2(rs[1] - ls[1], rs[0] - ls[0]))
                shoulder_angles.append((f.timestamp, s_angle))

            if s_angle is not None and lh and rh:
                h_angle = math.degrees(math.atan2(rh[1] - lh[1], rh[0] - lh[0]))
                diff = abs(s_angle - h_angle)
                diff = min(diff, 360.0 - diff)
                twists.append(diff)

        if not shoulder_angles:
            return TorsoRotationFeatures(valid_frames=0)

        raw_angles = [a[1] for a in shoulder_angles]
        mean_ang = float(np.mean(raw_angles))
        ang_range = float(max(raw_angles) - min(raw_angles))

        rot_speeds: List[float] = []
        for i in range(1, len(shoulder_angles)):
            t_prev, a_prev = shoulder_angles[i - 1]
            t_curr, a_curr = shoulder_angles[i]
            dt = t_curr - t_prev
            if dt > 0.0:
                diff = abs(a_curr - a_prev)
                diff = min(diff, 360.0 - diff)
                rot_speeds.append(diff / dt)

        rot_mean = float(np.mean(rot_speeds)) if rot_speeds else None
        rot_max = float(np.max(rot_speeds)) if rot_speeds else None
        twist_mean = float(np.mean(twists)) if twists else None

        return TorsoRotationFeatures(
            mean_torso_angle_deg=mean_ang,
            torso_angle_range_deg=ang_range,
            torso_rotation_speed_mean_deg_s=rot_mean,
            torso_rotation_speed_max_deg_s=rot_max,
            shoulder_hip_twist_mean_deg=twist_mean,
            valid_frames=len(shoulder_angles),
        )
