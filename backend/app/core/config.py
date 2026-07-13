from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    app_secret_key: str = "replace-with-random-64-char-secret"
    debug: bool = True

    database_url: str = "postgresql+psycopg://postgres:replace-with-db-password@127.0.0.1:5432/foodops_dev"
    redis_url: str = "redis://127.0.0.1:6379/0"

    jwt_algorithm: str = "RS256"
    jwt_access_token_expire_minutes: int = 1440
    jwt_refresh_token_expire_days: int = 30
    jwt_private_key_path: str = "./private.pem"
    jwt_public_key_path: str = "./public.pem"

    aes_encryption_key: str = "replace-with-random-32-byte-key"
    upload_dir: str = "./uploads"
    max_upload_size_mb: int = 10

    celery_broker_url: str = "redis://127.0.0.1:6379/1"
    celery_result_backend: str = "redis://127.0.0.1:6379/2"
    celery_timezone: str = "Asia/Shanghai"
    alert_scan_interval_minutes: int = 10
    task_overdue_scan_interval_minutes: int = 10
    notification_dispatch_interval_minutes: int = 5
    h5_base_url: str = "http://127.0.0.1:23000"
    cors_allow_origins: str = "http://localhost:23000,http://127.0.0.1:23000"

    init_admin_username: str = "admin"
    init_admin_password: str = "replace-with-strong-initial-admin-password"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
