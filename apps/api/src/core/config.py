from functools import lru_cache
from typing import Self

from pydantic import model_validator
from pydantic_core import InitErrorDetails, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    SUPABASE_URL: str = ""
    SUPABASE_ANON_KEY: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""
    SUPABASE_STORAGE_BUCKET: str = "drawings"

    ENVIRONMENT: str = "development"
    PROJECT_NAME: str = "Intelligent BIM API"

    CORS_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://intelligent-bim-web.vercel.app",
    ]
    CORS_ORIGIN_REGEX: str | None = None

    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @model_validator(mode="after")
    def validate_required_settings(self) -> Self:
        missing: list[str] = []
        if not self.SUPABASE_URL:
            missing.append("SUPABASE_URL")
        if not self.SUPABASE_SERVICE_ROLE_KEY:
            missing.append("SUPABASE_SERVICE_ROLE_KEY")
        if missing:
            raise ValidationError.from_exception_data(
                title=self.__class__.__name__,
                line_errors=[
                    InitErrorDetails(
                        type="missing",
                        loc=(field,),
                        input=None,
                    )
                    for field in missing
                ],
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
