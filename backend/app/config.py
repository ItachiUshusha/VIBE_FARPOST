from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    mongodb_uri: str = "mongodb://127.0.0.1:27017"
    mongodb_database: str = "farpost_butterfly"
    dataset_version: str = "pervaya-rechka-v1"
    dataset_path: Path = Path(__file__).resolve().parents[1] / "data" / "pervaya-rechka-v1.json"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    auto_seed: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()
