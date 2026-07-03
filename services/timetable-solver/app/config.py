from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    service_name: str = "timetable-solver"
    solver_name: str = "ortools-cp-sat"
    internal_token: str = "dev-timetable-solver-token"
    default_time_limit_seconds: int = 20
    max_time_limit_seconds: int = 180
    max_alternatives: int = 3
    log_level: str = "INFO"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="TIMETABLE_SOLVER_",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()

