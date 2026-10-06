from typing import Optional
from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Calibration
# ---------------------------------------------------------------------------

class CalibrationStatus(BaseModel):
    """Reports whether the system is calibrated and ready for analysis."""
    ready: bool
    message: Optional[str] = None


# ---------------------------------------------------------------------------
# Wrist Coordinates
# ---------------------------------------------------------------------------

class WristCoordinates(BaseModel):
    """Pixel coordinates for a single wrist keypoint."""
    x: float
    y: float
    confidence: Optional[float] = None  # model confidence score [0, 1]


class WristData(BaseModel):
    """Left and right wrist coordinates for a single frame."""
    left: Optional[WristCoordinates] = None
    right: Optional[WristCoordinates] = None
    frame_index: Optional[int] = None
    timestamp_ms: Optional[float] = None


# ---------------------------------------------------------------------------
# Fight Analysis
# ---------------------------------------------------------------------------

class FightAnalysisResult(BaseModel):
    """Final analysis result returned after processing a fight session."""
    session_id: str
    total_punches: int = 0
    left_punches: int = 0
    right_punches: int = 0
    avg_speed_kmh: Optional[float] = None
    peak_speed_kmh: Optional[float] = None
    duration_seconds: Optional[float] = None
    summary: Optional[str] = None


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

class HealthResponse(BaseModel):
    status: str
    app: str
