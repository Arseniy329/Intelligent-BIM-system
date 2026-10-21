from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration and environment variables."""

    SUPABASE_URL: str
    SUPABASE_SERVICE_ROLE_KEY: str

    ENVIRONMENT: str = "development"
    PROJECT_NAME: str = "Intelligent BIM API"

    CORS_ORIGINS: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]
    CORS_ORIGIN_REGEX: str | None = r"^https:\/\/.*\.vercel\.app$"

    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    """Dependency provider for cached application settings."""
    return Settings()  # type: ignore[call-arg]
