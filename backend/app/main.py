from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.routes import router
from app.api.fight_router import router as fight_router
from app.api.stream_router import router as stream_router

app = FastAPI(
    title=settings.app_name,
    description="Computer-vision backend for AI-powered fight analysis.",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# Allow the Vite dev server (and any localhost origin) to call the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix=settings.api_v1_prefix)
app.include_router(fight_router, prefix=settings.api_v1_prefix)
app.include_router(stream_router, prefix=settings.api_v1_prefix)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
