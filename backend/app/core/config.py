from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "AI Fight Analyzer"
    api_v1_prefix: str = "/api/v1"
    debug: bool = False

    # DroidCam / ADB Configuration
    droidcam_adb_path: Optional[str] = None
    droidcam_front_serial: Optional[str] = None
    droidcam_side_serial: Optional[str] = None
    droidcam_front_port: int = 4747
    droidcam_side_port: int = 4748


settings = Settings()
