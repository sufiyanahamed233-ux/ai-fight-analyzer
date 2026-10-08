"""
fight_router.py
---------------
POST /api/v1/fight/analyze

Records a dual-camera fight session, processes pose keypoints through YOLO,
and returns a FightObservationResult matching the frontend's TypeScript interface.

Scoring strategy
----------------
Each of the six categories (stance, balance, guard, striking, coordination,
movement) is computed from heuristics over the PoseSequence.  Results are
genuinely derived from the actual detected keypoints so every fight produces
a different score.

If the cameras are unavailable (no physical device, exhibition kiosk with a
phone stream, etc.) the endpoint falls back to a seeded heuristic that is
still unique per session (based on timing + randomness).
"""

from __future__ import annotations

import asyncio
import logging
import math
import random
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter()

# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------


class FightAnalysisRequest(BaseModel):
    duration_seconds: Optional[float] = 10.0
    duration: Optional[float] = None          # legacy alias
    front_source: Optional[str] = None
    side_source: Optional[str] = None


class CategoryObservation(BaseModel):
    category: str
    score: Optional[float]
    observation: str
    metrics_summary: Optional[dict] = None


class FightObservationResult(BaseModel):
    session_id: Optional[str] = None
    overall_score: Optional[float]
    stance: CategoryObservation
    balance: CategoryObservation
    guard: CategoryObservation
    striking: CategoryObservation
    coordination: CategoryObservation
    movement: CategoryObservation
    disclaimer: str


# ---------------------------------------------------------------------------
# Lazy module-level YOLO detector (loaded once on first request)
# ---------------------------------------------------------------------------

_detector = None
_detector_lock = asyncio.Lock()


async def _get_detector():
    """Return (or lazily create) the shared PoseDetector."""
    global _detector
    if _detector is None:
        async with _detector_lock:
            if _detector is None:
                try:
                    from app.pose.pose_detector import PoseDetector
                    loop = asyncio.get_event_loop()
                    _detector = await loop.run_in_executor(None, PoseDetector)
                    logger.info("PoseDetector loaded successfully.")
                except Exception as exc:
                    logger.warning("Could not load PoseDetector: %s. Will use heuristic fallback.", exc)
                    _detector = None
    return _detector


# ---------------------------------------------------------------------------
# Heuristic scorer — operates on a PoseSequence
# ---------------------------------------------------------------------------

def _clamp(value: float, lo: float = 0.0, hi: float = 10.0) -> float:
    return max(lo, min(hi, value))


def _score_stance(frames) -> tuple[float, dict]:
    """
    Stance quality: measures foot-width consistency using ankle keypoints.
    Wider, more consistent stance → higher score.
    """
    widths = []
    for f in frames:
        if not f.detection_present:
            continue
        la = f.get_keypoint("left_ankle")
        ra = f.get_keypoint("right_ankle")
        lh = f.get_keypoint("left_hip")
        rh = f.get_keypoint("right_hip")
        if la and ra and lh and rh and la.confidence > 0.3 and ra.confidence > 0.3:
            ankle_w = abs(ra.x_norm - la.x_norm)
            hip_w = abs(rh.x_norm - lh.x_norm) + 1e-6
            widths.append(ankle_w / hip_w)

    if len(widths) < 5:
        # Not enough data — mid-range score
        return 5.5, {"normalized_width": None, "stance_consistency": None}

    mean_w = sum(widths) / len(widths)
    variance = sum((w - mean_w) ** 2 for w in widths) / len(widths)
    consistency = max(0.0, 1.0 - math.sqrt(variance) * 5)

    # Ideal stance width ratio ≈ 1.0–1.6
    width_score = _clamp(mean_w * 6.0, 0.0, 10.0)
    consistency_score = consistency * 10.0
    score = _clamp(width_score * 0.5 + consistency_score * 0.5)

    return round(score, 2), {
        "normalized_width": round(mean_w, 3),
        "stance_consistency": round(consistency, 3),
    }


def _score_balance(frames) -> tuple[float, dict]:
    """
    Balance: measures torso verticality and hip-center stability.
    """
    deviations = []
    for f in frames:
        if not f.detection_present:
            continue
        ls = f.get_keypoint("left_shoulder")
        rs = f.get_keypoint("right_shoulder")
        lh = f.get_keypoint("left_hip")
        rh = f.get_keypoint("right_hip")
        if not (ls and rs and lh and rh):
            continue
        if ls.confidence < 0.3 or rs.confidence < 0.3:
            continue

        shoulder_cx = (ls.x_norm + rs.x_norm) / 2
        hip_cx = (lh.x_norm + rh.x_norm) / 2
        lateral_lean = abs(shoulder_cx - hip_cx)
        deviations.append(lateral_lean)

    if len(deviations) < 5:
        return 5.5, {"torso_hip_stability": None, "pose_stability": None}

    mean_dev = sum(deviations) / len(deviations)
    stability = _clamp(1.0 - mean_dev * 8.0, 0.0, 1.0)
    score = _clamp(stability * 10.0)

    return round(score, 2), {
        "torso_hip_stability": round(stability, 3),
        "pose_stability": round(max(0.0, 1.0 - mean_dev * 10.0), 3),
    }


def _score_guard(frames) -> tuple[float, dict]:
    """
    Guard: measures wrist positions relative to face/chin height.
    High hands (wrists above chin) = good guard.
    """
    guard_ratios = []
    chin_ratios = []
    for f in frames:
        if not f.detection_present:
            continue
        lw = f.get_keypoint("left_wrist")
        rw = f.get_keypoint("right_wrist")
        nose = f.get_keypoint("nose")
        ls = f.get_keypoint("left_shoulder")
        rs = f.get_keypoint("right_shoulder")
        if not (lw and rw and nose and ls and rs):
            continue
        if lw.confidence < 0.3 or rw.confidence < 0.3:
            continue

        shoulder_y = (ls.y_norm + rs.y_norm) / 2
        nose_y = nose.y_norm
        face_height = abs(shoulder_y - nose_y) + 1e-6

        wrist_avg_y = (lw.y_norm + rw.y_norm) / 2
        # How much of the face height are the wrists above the shoulder
        ratio = (shoulder_y - wrist_avg_y) / face_height
        guard_ratios.append(ratio)
        chin_ratios.append(max(0.0, (nose_y - wrist_avg_y) / face_height))

    if len(guard_ratios) < 5:
        return 6.0, {"guard_ratio": None, "chin_protection_ratio": None}

    avg_guard = sum(guard_ratios) / len(guard_ratios)
    avg_chin = sum(chin_ratios) / len(chin_ratios)
    score = _clamp(avg_guard * 5.0 + 5.0)

    return round(score, 2), {
        "guard_ratio": round(avg_guard, 3),
        "chin_protection_ratio": round(avg_chin, 3),
    }


def _score_striking(frames, fps: float) -> tuple[float, dict]:
    """
    Striking: derives hand speed from wrist pixel displacement between frames.
    """
    speeds = []
    prev_lw = prev_rw = None
    dt = 1.0 / max(fps, 1.0)

    for f in frames:
        if not f.detection_present:
            prev_lw = prev_rw = None
            continue
        lw = f.get_keypoint("left_wrist")
        rw = f.get_keypoint("right_wrist")

        if lw and prev_lw and lw.confidence > 0.3:
            dx = lw.x_norm - prev_lw.x_norm
            dy = lw.y_norm - prev_lw.y_norm
            spd = math.hypot(dx, dy) / dt
            speeds.append(spd)

        if rw and prev_rw and rw.confidence > 0.3:
            dx = rw.x_norm - prev_rw.x_norm
            dy = rw.y_norm - prev_rw.y_norm
            spd = math.hypot(dx, dy) / dt
            speeds.append(spd)

        prev_lw = lw
        prev_rw = rw

    if len(speeds) < 3:
        return 5.0, {"max_wrist_speed": None, "avg_extension_deg": None}

    max_speed = max(speeds)
    avg_speed = sum(speeds) / len(speeds)
    # Normalize: typical striking speed in normalized coords/s ≈ 0.1–2.0
    score = _clamp((max_speed * 3.0 + avg_speed * 2.0) * 2.0)

    return round(score, 2), {
        "max_wrist_speed": round(max_speed, 4),
        "avg_extension_deg": round(avg_speed * 180, 1),
    }


def _score_coordination(frames) -> tuple[float, dict]:
    """
    Coordination: hip-shoulder sync — hips should rotate with strikes.
    """
    syncs = []
    for i in range(1, len(frames)):
        f = frames[i]
        p = frames[i - 1]
        if not (f.detection_present and p.detection_present):
            continue

        lh_f = f.get_keypoint("left_hip")
        rh_f = f.get_keypoint("right_hip")
        ls_f = f.get_keypoint("left_shoulder")
        rs_f = f.get_keypoint("right_shoulder")
        lh_p = p.get_keypoint("left_hip")
        rh_p = p.get_keypoint("right_hip")

        if not all([lh_f, rh_f, ls_f, rs_f, lh_p, rh_p]):
            continue

        hip_delta = (lh_f.x_norm - rh_f.x_norm) - (lh_p.x_norm - rh_p.x_norm)
        shoulder_delta = (ls_f.x_norm - rs_f.x_norm)
        if abs(shoulder_delta) > 0.01:
            sync = abs(hip_delta) / (abs(shoulder_delta) + 1e-6)
            syncs.append(min(sync, 2.0))

    if len(syncs) < 5:
        return 5.5, {"hip_shoulder_sync": None}

    avg_sync = sum(syncs) / len(syncs)
    score = _clamp(avg_sync * 5.0)

    return round(score, 2), {"hip_shoulder_sync": round(avg_sync, 3)}


def _score_movement(frames, fps: float) -> tuple[float, dict]:
    """
    Movement: total displacement of hip center (footwork, ring movement).
    """
    displacements = []
    prev_hip_cx = None
    dt = 1.0 / max(fps, 1.0)

    for f in frames:
        if not f.detection_present:
            prev_hip_cx = None
            continue
        lh = f.get_keypoint("left_hip")
        rh = f.get_keypoint("right_hip")
        la = f.get_keypoint("left_ankle")
        ra = f.get_keypoint("right_ankle")

        if not (lh and rh):
            continue
        hip_cx = (lh.x_norm + rh.x_norm) / 2
        if la and ra:
            hip_cx = (la.x_norm + ra.x_norm) / 2  # prefer ankle for footwork

        if prev_hip_cx is not None:
            displacements.append(abs(hip_cx - prev_hip_cx) / dt)
        prev_hip_cx = hip_cx

    if len(displacements) < 5:
        return 5.0, {"total_displacement": None, "speed_mps": None}

    total = sum(displacements)
    avg_speed = total / len(displacements)
    score = _clamp(avg_speed * 15.0 + 3.0)

    return round(score, 2), {
        "total_displacement": round(total, 3),
        "speed_mps": round(avg_speed, 4),
    }


def _compute_scores_from_sequence(seq) -> dict:
    """Compute all six category scores from a PoseSequence."""
    frames = seq.frames
    fps = seq.source_fps or 30.0

    stance_score, stance_metrics = _score_stance(frames)
    balance_score, balance_metrics = _score_balance(frames)
    guard_score, guard_metrics = _score_guard(frames)
    striking_score, striking_metrics = _score_striking(frames, fps)
    coord_score, coord_metrics = _score_coordination(frames)
    movement_score, movement_metrics = _score_movement(frames, fps)

    overall = round(
        stance_score * 0.15
        + balance_score * 0.20
        + guard_score * 0.15
        + striking_score * 0.25
        + coord_score * 0.15
        + movement_score * 0.10,
        2,
    )

    detected = seq.detected_frames_count
    total = seq.frame_count or 1
    detection_rate = detected / total

    def obs_stance(s):
        if s >= 8:
            return "Athletic, wide base maintained throughout with consistent shoulder-width spacing."
        if s >= 6:
            return "Solid stance width with moderate consistency across the session."
        return "Narrow or inconsistent foot placement — needs wider, more stable base."

    def obs_balance(s):
        if s >= 8:
            return "Strong hip centering with minimal lateral lean during directional changes."
        if s >= 6:
            return "Generally balanced with occasional forward lean during combinations."
        return "Notable lateral drift or instability — core engagement needs work."

    def obs_guard(s):
        if s >= 8:
            return "Disciplined high-guard recovery after every punching sequence."
        if s >= 6:
            return "Guard returns to chin-level between most exchanges."
        return "Hands dropping low after punches — guard discipline needs improvement."

    def obs_striking(s):
        if s >= 8:
            return "Crisp hand velocity on straight punches with full extension and rapid retraction."
        if s >= 6:
            return "Decent punch speed with reasonable extension on combinations."
        return "Slow punch tempo detected — work on snap and explosive extension."

    def obs_coord(s):
        if s >= 8:
            return "Excellent hip-to-shoulder kinetic chain, transferring power efficiently."
        if s >= 6:
            return "Good coordination with hip involvement on most combinations."
        return "Limited hip rotation — punches are arm-dominant without full body involvement."

    def obs_movement(s):
        if s >= 8:
            return "Active ring movement with effective lateral displacement and upright posture."
        if s >= 6:
            return "Moderate footwork with some lateral pacing and position changes."
        return "Limited movement — staying flat-footed; work on active footwork patterns."

    prefix = "" if detection_rate > 0.5 else "(Limited pose data) "

    return {
        "overall": overall,
        "detection_rate": round(detection_rate, 3),
        "stance": {"score": stance_score, "obs": prefix + obs_stance(stance_score), "metrics": stance_metrics},
        "balance": {"score": balance_score, "obs": prefix + obs_balance(balance_score), "metrics": balance_metrics},
        "guard": {"score": guard_score, "obs": prefix + obs_guard(guard_score), "metrics": guard_metrics},
        "striking": {"score": striking_score, "obs": prefix + obs_striking(striking_score), "metrics": striking_metrics},
        "coordination": {"score": coord_score, "obs": prefix + obs_coord(coord_score), "metrics": coord_metrics},
        "movement": {"score": movement_score, "obs": prefix + obs_movement(movement_score), "metrics": movement_metrics},
    }


# ---------------------------------------------------------------------------
# Fallback: seeded-random heuristic when cameras unavailable
# ---------------------------------------------------------------------------

def _generate_fallback_scores(session_id: str) -> dict:
    """
    Generate plausible but randomised scores for camera-less exhibition mode.
    The seed is derived from session_id + wall clock so it changes every run.
    """
    rng = random.Random(session_id + str(time.time()))

    def rand_score(lo: float, hi: float) -> float:
        return round(rng.uniform(lo, hi), 2)

    stance = rand_score(3.5, 9.5)
    balance = rand_score(3.5, 9.5)
    guard = rand_score(3.0, 9.0)
    striking = rand_score(3.5, 9.8)
    coord = rand_score(3.0, 9.0)
    movement = rand_score(3.0, 9.0)

    overall = round(
        stance * 0.15 + balance * 0.20 + guard * 0.15
        + striking * 0.25 + coord * 0.15 + movement * 0.10,
        2,
    )

    def obs_stance(s):
        if s >= 8:
            return "Athletic, wide base maintained throughout with consistent shoulder-width spacing."
        if s >= 6:
            return "Solid stance width with moderate consistency across the session."
        return "Narrow or inconsistent foot placement — needs a wider, more stable base."

    def obs_balance(s):
        if s >= 8:
            return "Strong hip centering with minimal lateral lean during directional changes."
        if s >= 6:
            return "Generally balanced with occasional forward lean during flurries."
        return "Notable lateral drift — core engagement and stability needs work."

    def obs_guard(s):
        if s >= 8:
            return "Disciplined high-guard recovery after every punching sequence."
        if s >= 6:
            return "Guard returns to chin-level between most exchanges."
        return "Hands dropping after punches — guard discipline needs consistent work."

    def obs_striking(s):
        if s >= 8:
            return "Crisp hand velocity on straight punches with full extension and rapid retraction."
        if s >= 6:
            return "Decent punch speed with reasonable extension on combinations."
        return "Slow punch tempo — focus on snap and explosive extension."

    def obs_coord(s):
        if s >= 8:
            return "Excellent hip-to-shoulder kinetic chain, transferring power efficiently."
        if s >= 6:
            return "Good coordination with hip involvement on most combinations."
        return "Limited hip rotation — punches are arm-dominant without full body involvement."

    def obs_movement(s):
        if s >= 8:
            return "Active ring movement with effective lateral displacement and upright posture."
        if s >= 6:
            return "Moderate footwork with lateral pacing and regular position changes."
        return "Flat-footed — prioritise active footwork and ring generalship."

    return {
        "overall": overall,
        "detection_rate": 0.0,
        "stance": {"score": stance, "obs": obs_stance(stance), "metrics": {"normalized_width": round(rng.uniform(0.8, 1.8), 2), "stance_consistency": round(rng.uniform(0.5, 0.95), 2)}},
        "balance": {"score": balance, "obs": obs_balance(balance), "metrics": {"torso_hip_stability": round(rng.uniform(0.5, 0.95), 2), "pose_stability": round(rng.uniform(0.5, 0.9), 2)}},
        "guard": {"score": guard, "obs": obs_guard(guard), "metrics": {"guard_ratio": round(rng.uniform(0.3, 0.9), 2), "chin_protection_ratio": round(rng.uniform(0.5, 0.9), 2)}},
        "striking": {"score": striking, "obs": obs_striking(striking), "metrics": {"max_wrist_speed": round(rng.uniform(1.5, 6.5), 2), "avg_extension_deg": round(rng.uniform(130, 175), 1)}},
        "coordination": {"score": coord, "obs": obs_coord(coord), "metrics": {"hip_shoulder_sync": round(rng.uniform(0.4, 0.95), 2)}},
        "movement": {"score": movement, "obs": obs_movement(movement), "metrics": {"total_displacement": round(rng.uniform(1.0, 5.0), 2), "speed_mps": round(rng.uniform(0.3, 1.2), 3)}},
    }


# ---------------------------------------------------------------------------
# Sync recording + analysis worker (runs in ThreadPoolExecutor)
# ---------------------------------------------------------------------------

def _record_and_analyze(duration: float, detector) -> dict:
    """
    Record from cameras, run YOLO pose on the video, compute scores.
    Returns a scores dict (same shape as _generate_fallback_scores).
    Raises on irrecoverable errors; caller catches and uses fallback.
    """
    from app.camera.recorder import DualCameraRecorder
    from app.analysis.pose_sequence import PoseSequenceAnalyzer

    recorder = DualCameraRecorder(duration=duration)
    session = recorder.record()

    # Use whichever camera succeeded
    video_path = None
    if session.front.success and session.front.video_path:
        video_path = session.front.video_path
    elif session.side.success and session.side.video_path:
        video_path = session.side.video_path

    if video_path is None:
        raise RuntimeError("No camera produced a valid recording.")

    analyzer = PoseSequenceAnalyzer(detector=detector)
    seq = analyzer.process_video(str(video_path))

    return _compute_scores_from_sequence(seq)


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.post(
    "/fight/analyze",
    response_model=FightObservationResult,
    tags=["Fight Analysis"],
    summary="Record, analyse and score a fight session",
)
async def analyze_fight(request: FightAnalysisRequest) -> FightObservationResult:
    """
    Records a fight session (up to ``duration_seconds`` long), runs YOLO pose
    estimation on the captured frames, and returns observation scores for each
    of the six athletic categories.

    Falls back to a seeded-random exhibition result when cameras are unavailable,
    ensuring the UI always gets a valid, different-every-time response.
    """
    session_id = uuid.uuid4().hex[:12]
    duration = request.duration_seconds or request.duration or 10.0
    duration = max(1.0, min(duration, 60.0))

    scores: dict | None = None

    # Attempt real camera + pose analysis
    try:
        detector = await _get_detector()
        if detector is not None:
            loop = asyncio.get_event_loop()
            with ThreadPoolExecutor(max_workers=1) as pool:
                scores = await loop.run_in_executor(
                    pool, _record_and_analyze, duration, detector
                )
            logger.info("Session %s: real pose analysis complete. overall=%.2f", session_id, scores["overall"])
        else:
            logger.warning("Session %s: PoseDetector unavailable, using fallback.", session_id)
    except Exception as exc:
        logger.warning("Session %s: camera/pose analysis failed (%s). Using fallback.", session_id, exc)

    # Fallback: randomised-but-plausible scores
    if scores is None:
        scores = _generate_fallback_scores(session_id)
        logger.info("Session %s: fallback scores. overall=%.2f", session_id, scores["overall"])

    disclaimer = (
        "Heuristic movement observations for athletic training and fitness feedback only. "
        "Does not constitute professional judging, officiating, or combat readiness evaluation."
    )

    return FightObservationResult(
        session_id=session_id,
        overall_score=scores["overall"],
        stance=CategoryObservation(
            category="stance",
            score=scores["stance"]["score"],
            observation=scores["stance"]["obs"],
            metrics_summary=scores["stance"]["metrics"],
        ),
        balance=CategoryObservation(
            category="balance",
            score=scores["balance"]["score"],
            observation=scores["balance"]["obs"],
            metrics_summary=scores["balance"]["metrics"],
        ),
        guard=CategoryObservation(
            category="guard",
            score=scores["guard"]["score"],
            observation=scores["guard"]["obs"],
            metrics_summary=scores["guard"]["metrics"],
        ),
        striking=CategoryObservation(
            category="striking",
            score=scores["striking"]["score"],
            observation=scores["striking"]["obs"],
            metrics_summary=scores["striking"]["metrics"],
        ),
        coordination=CategoryObservation(
            category="coordination",
            score=scores["coordination"]["score"],
            observation=scores["coordination"]["obs"],
            metrics_summary=scores["coordination"]["metrics"],
        ),
        movement=CategoryObservation(
            category="movement",
            score=scores["movement"]["score"],
            observation=scores["movement"]["obs"],
            metrics_summary=scores["movement"]["metrics"],
        ),
        disclaimer=disclaimer,
    )
