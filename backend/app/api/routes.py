from fastapi import APIRouter
from app.schemas.analysis import HealthResponse

router = APIRouter()


@router.get("/health", response_model=HealthResponse, tags=["Health"])
async def health_check() -> HealthResponse:
    """Basic health check endpoint."""
    return HealthResponse(status="ok", app="AI Fight Analyzer")
