import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, status

from app.analysis import (
    FightObservationAnalyzer,
    MovementFeaturesAnalyzer,
    PoseSequenceAnalyzer,
)
from app.camera.recorder import (
    DEFAULT_DURATION,
    DEFAULT_FRONT_URL,
    DEFAULT_SIDE_URL,
    DualCameraRecorder,
)
from app.schemas.analysis import (
    FightAnalysisRequest,
    FightObservationResult,
    HealthResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/health", response_model=HealthResponse, tags=["Health"])
async def health_check() -> HealthResponse:
    """Basic health check endpoint."""
    return HealthResponse(status="ok", app="AI Fight Analyzer")


@router.post(
    "/fight/analyze",
    response_model=FightObservationResult,
    tags=["Fight Analysis"],
    summary="Record dual-camera fight session and perform deterministic movement analysis",
)
@router.post(
    "/analyze",
    response_model=FightObservationResult,
    tags=["Fight Analysis"],
    include_in_schema=False,
)
async def analyze_fight(
    request: Optional[FightAnalysisRequest] = None,
) -> FightObservationResult:
    """
    Execute full fight-analysis pipeline:
    1. Start dual-camera recording for configured duration (default 10s).
    2. Record synchronized video from cameras.
    3. Run PoseSequence extraction across recorded frames.
    4. Compute MovementFeatures (kinematics, stance, guard, striking, etc.).
    5. Evaluate FightObservationAnalyzer across 6 categories.
    6. Return FightObservationResult as JSON.
    """
    req = request or FightAnalysisRequest()
    duration = req.duration if req.duration > 0 else DEFAULT_DURATION
    front_source = req.front_source or DEFAULT_FRONT_URL
    side_source = req.side_source or DEFAULT_SIDE_URL

    # 1. Start dual-camera recording (non-blocking thread)
    logger.info(
        "Starting dual-camera recording for %.1fs (front=%s, side=%s)...",
        duration,
        front_source,
        side_source,
    )
    try:
        recorder = DualCameraRecorder(
            duration=duration,
            front_source=front_source,
            side_source=side_source,
        )
        session = await asyncio.to_thread(recorder.record)
    except Exception as exc:
        logger.error("Dual-camera recording failed to start or execute: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Camera recording failed: {exc}",
        ) from exc

    # 2. Check recording outcome and resolve video to process
    primary_video = session.front.video_path if (session.front.success and session.front.video_path) else None
    if primary_video is None and session.side.success and session.side.video_path:
        primary_video = session.side.video_path
        logger.warning("Front camera capture failed; using side camera as fallback for pose analysis.")

    if primary_video is None or not primary_video.exists():
        err_msg = session.error or "No valid video frames captured by cameras."
        logger.error("Camera recording produced no usable video: %s", err_msg)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Camera recording failed: {err_msg}",
        )

    # 3. Run PoseSequence processing
    logger.info("Running PoseSequence processing on %s...", primary_video)
    try:
        pose_analyzer = PoseSequenceAnalyzer()
        pose_seq = await asyncio.to_thread(pose_analyzer.process_video, primary_video)
    except Exception as exc:
        logger.error("Pose sequence processing failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Pose analysis failed: {exc}",
        ) from exc

    # 4. Run MovementFeaturesAnalyzer
    logger.info("Extracting MovementFeatures across %d frames...", len(pose_seq.frames))
    try:
        movement_analyzer = MovementFeaturesAnalyzer()
        movement_features = await asyncio.to_thread(movement_analyzer.analyze, pose_seq)
    except Exception as exc:
        logger.error("Movement features analysis failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Movement features analysis failed: {exc}",
        ) from exc

    # 5. Run FightObservationAnalyzer
    logger.info("Computing FightObservationResult across 6 categories...")
    try:
        observation_analyzer = FightObservationAnalyzer()
        result = observation_analyzer.observe(movement_features, session_id=session.session_id)
    except Exception as exc:
        logger.error("Fight observation scoring failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Fight observation analysis failed: {exc}",
        ) from exc

    # 6. Return FightObservationResult as JSON
    logger.info(
        "Fight analysis completed successfully for session %s (overall_score=%s).",
        session.session_id,
        result.overall_score,
    )
    return result
