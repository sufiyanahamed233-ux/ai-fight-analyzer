from fastapi import FastAPI
from app.core.config import settings
from app.api.routes import router

app = FastAPI(
    title=settings.app_name,
    description="Computer-vision backend for AI-powered fight analysis.",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.include_router(router, prefix=settings.api_v1_prefix)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
