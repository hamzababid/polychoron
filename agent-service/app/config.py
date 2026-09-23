"""Runtime configuration for agent-service, loaded from environment
variables (see .env.example). No secrets are hardcoded — the
FOUNDATION_API path fails closed if OPENAI_API_KEY is unset, per
the model inference router's fail-closed non-negotiable."""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://polychoron:polychoron_dev_only@localhost:5432/polychoron"
    temporal_address: str = "localhost:7233"
    temporal_namespace: str = "default"
    temporal_task_queue: str = "aml_detection-task-queue"

    openai_api_key: str | None = None
    openai_model: str = "gpt-4o"

    mock_bank_base_url: str = "http://localhost:8001"

    log_dir: str = "logs"
    # Differs per container (agent-service-api vs agent-service-worker
    # both run this same image) so their file logs don't collide —
    # set via docker-compose's LOG_FILE_NAME env var.
    log_file_name: str = "agent-service.log"
    log_level: str = "INFO"


settings = Settings()
