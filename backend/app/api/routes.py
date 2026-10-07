import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse

from app.analysis import (
    FightObservationAnalyzer,
    MovementFeaturesAnalyzer,
    PoseSequenceAnalyzer,
    combine_multiview_features,
)
from app.camera.camera_manager import check_droidcam_port
from app.camera.recorder import (
    DEFAULT_DURATION,
    DEFAULT_FRONT_URL,
    DEFAULT_SIDE_URL,
    DualCameraRecorder,
)
from app.camera.shared_capture import shared_front_camera
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


@router.get(
    "/stream/front",
    tags=["Camera Stream"],
    summary="Local live MJPEG stream from the single shared front camera capture",
)
async def stream_front():
    """
    Exposes MJPEG stream of Phone 1 (127.0.0.1:4747/video) from the SINGLE
    backend OpenCV capture instance.
    Does NOT open a second cv2.VideoCapture.
    """
    if not shared_front_camera.is_running:
        started = shared_front_camera.start(DEFAULT_FRONT_URL)
        if not started:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Could not open camera {DEFAULT_FRONT_URL} (front)",
            )

    return StreamingResponse(
        shared_front_camera.get_stream_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


@router.get(
    "/stream/front/status",
    tags=["Camera Stream"],
    summary="Check availability of Phone 1 front camera stream",
)
async def stream_front_status():
    """
    Check availability of Phone 1 front camera stream and start shared capture
    if port 4747 is reachable.
    """
    if not shared_front_camera.is_running and check_droidcam_port("127.0.0.1", 4747):
        shared_front_camera.start(DEFAULT_FRONT_URL)

    is_running = shared_front_camera.is_running
    return {
        "available": is_running,
        "running": is_running,
        "source": str(shared_front_camera.source),
    }


@router.post(
    "/stream/front/stop",
    tags=["Camera Stream"],
    summary="Release the shared front camera capture and close stream",
)
async def stream_front_stop():
    """Cleanly stops the shared front camera capture handle."""
    shared_front_camera.stop()
    return {"status": "stopped"}


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
    finally:
        # Cleanly stop and release shared front camera capture when fight concludes
        shared_front_camera.stop()

    # 2. Check recording outcome - Camera 1 is mandatory for front pose analysis
    if not session.front.success or not session.front.video_path or not session.front.video_path.exists():
        err_msg = session.front.error or "Front camera (Camera 1) failed to record video."
        logger.error("Front camera capture failed: %s. Silently falling back to Camera 2 is forbidden.", err_msg)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Camera recording failed: Front camera recording failed: {err_msg}",
        )

    front_video = session.front.video_path
    side_video = (
        session.side.video_path
        if (session.side.success and session.side.video_path and session.side.video_path.exists())
        else None
    )

    # 3. Run PoseSequence processing for BOTH cameras
    logger.info("Running PoseSequence processing on Front (%s) and Side (%s)...", front_video, side_video)
    try:
        pose_analyzer = PoseSequenceAnalyzer()
        front_seq = await asyncio.to_thread(pose_analyzer.process_video, front_video)
    except Exception as exc:
        logger.error("Front pose sequence processing failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Pose analysis failed: {exc}",
        ) from exc

    side_seq = None
    if side_video is not None:
        try:
            logger.info("Running PoseSequence processing on Side video: %s", side_video)
            side_seq = await asyncio.to_thread(pose_analyzer.process_video, side_video)
        except Exception as exc:
            logger.warning("Side camera pose analysis encountered an error: %s", exc)
            side_seq = None

    # 4. Run MovementFeaturesAnalyzer
    logger.info(
        "Extracting MovementFeatures across frames (front=%d, side=%s)...",
        len(front_seq.frames),
        len(side_seq.frames) if side_seq else "N/A",
    )
    try:
        movement_analyzer = MovementFeaturesAnalyzer(min_tracking_duration=0.8)
        front_features = await asyncio.to_thread(movement_analyzer.analyze, front_seq)
        side_features = (
            await asyncio.to_thread(movement_analyzer.analyze, side_seq)
            if side_seq is not None
            else None
        )
        combined_features = combine_multiview_features(
            front_features,
            side_features,
            min_tracking_duration=0.8,
        )
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
        result = observation_analyzer.observe(combined_features, session_id=session.session_id)
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
