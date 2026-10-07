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


# ---------------------------------------------------------------------------
# Fight Observation & Scoring
# ---------------------------------------------------------------------------

class CategoryObservation(BaseModel):
    """Observation and heuristic score for a single movement category."""

    category: str
    score: Optional[float] = None  # Heuristic score from 0.0 to 10.0 (None if missing)
    observation: str
    metrics_summary: Optional[dict] = None


class FightAnalysisRequest(BaseModel):
    """Configuration options for the fight recording and analysis pipeline."""

    duration: float = 10.0
    front_source: Optional[str] = None
    side_source: Optional[str] = None


class FightObservationResult(BaseModel):
    """Complete deterministic observation and scoring outcome across 6 categories."""

    session_id: Optional[str] = None
    overall_score: Optional[float] = None
    stance: CategoryObservation
    balance: CategoryObservation
    guard: CategoryObservation
    striking: CategoryObservation
    coordination: CategoryObservation
    movement: CategoryObservation
    disclaimer: str = (
        "Heuristic movement observations for athletic training and fitness feedback only. "
        "Does not constitute professional judging, officiating, or combat readiness evaluation."
    )

    @property
    def categories(self) -> dict[str, CategoryObservation]:
        """Dictionary mapping category name to CategoryObservation."""
        return {
            "stance": self.stance,
            "balance": self.balance,
            "guard": self.guard,
            "striking": self.striking,
            "coordination": self.coordination,
            "movement": self.movement,
        }
