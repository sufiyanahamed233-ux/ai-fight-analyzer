from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    app_name: str = "AI Fight Analyzer"
    api_v1_prefix: str = "/api/v1"
    debug: bool = False


settings = Settings()
