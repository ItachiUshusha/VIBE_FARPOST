from functools import lru_cache
from pathlib import Path

from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    mongodb_uri: str = "mongodb://127.0.0.1:27017"
    mongodb_database: str = "farpost_butterfly"
    dataset_version: str = "pervaya-rechka-v1"
    dataset_path: Path = Path(__file__).resolve().parents[1] / "data" / "pervaya-rechka-v1.json"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    auto_seed: bool = True
    public_origin: str = "http://localhost:3000"
    session_days: int = 7
    yandex_client_id: str = ""
    yandex_client_secret: SecretStr = SecretStr("")
    vk_client_id: str = ""
    metrica_counter_id: str = ""
    metrica_read_token: SecretStr = SecretStr("")
    metrica_registration_goal_id: str = ""
    metrica_login_goal_id: str = ""
    metrica_simulation_goal_id: str = ""
    analytics_utm_allowlist: str = '{"utm_source":["yandex","vk","google"],"utm_medium":["cpc","organic","social"],"utm_campaign":[]}'
    legal_published: bool = False
    legal_version: str = ""
    report_timezone: str = "Asia/Vladivostok"

    @field_validator("public_origin")
    @classmethod
    def validate_origin(cls, value):
        url = urlsplit(value)
        if url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in {"", "/"}:
            raise ValueError("PUBLIC_ORIGIN должен содержать только схему и домен с портом")
        if url.scheme != "https" and url.hostname not in {"localhost", "127.0.0.1", "[::1]", "::1"}:
            raise ValueError("Для публичного сервера необходим HTTPS")
        host = url.hostname.lower()
        host = f"[{host}]" if ":" in host else host.encode("idna").decode()
        port = f":{url.port}" if url.port is not None and url.port != (443 if url.scheme == "https" else 80) else ""
        return f"{url.scheme}://{host}{port}"

    @field_validator("session_days")
    @classmethod
    def validate_session_days(cls, value):
        if not 1 <= value <= 30:
            raise ValueError("SESSION_DAYS: от 1 до 30")
        return value

    @field_validator("report_timezone")
    @classmethod
    def validate_timezone(cls, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("REPORT_TIMEZONE должен содержать часовой пояс IANA")
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
