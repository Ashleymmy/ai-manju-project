from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit


DEFAULT_QUEUE_NAME = "celery"
DEFAULT_BROKER_URL = "redis://localhost:6379/0"
DEFAULT_JOB_MAX_ATTEMPTS = 3
DEFAULT_JOB_TIMEOUT_SECONDS = 900
DEFAULT_ASSET_STORAGE_DIR = "./data/assets"
DEFAULT_WORKER_TMP_DIR = "./data/worker-tmp"
DEFAULT_WORKER_CONCURRENCY = 8
DEFAULT_PROVIDER_GATE_LEASE_SECONDS = 960


@dataclass(frozen=True)
class Settings:
    celery_broker_url: str
    celery_queue_name: str
    celery_result_backend: str | None
    database_url: str
    job_max_attempts: int
    job_default_timeout_seconds: int
    asset_storage_dir: Path
    worker_tmp_dir: Path
    ffmpeg_bin: str
    health_host: str
    health_port: int
    # Optional Celery rate such as "2/s"; it applies to remote media tasks.
    provider_rate_limit: str | None = None
    worker_concurrency: int = DEFAULT_WORKER_CONCURRENCY
    provider_gate_lease_seconds: int = DEFAULT_PROVIDER_GATE_LEASE_SECONDS


def load_settings() -> Settings:
    broker_url = first_non_empty(
        os.getenv("CELERY_BROKER_URL"),
        os.getenv("REDIS_URL"),
        DEFAULT_BROKER_URL,
    )
    return Settings(
        celery_broker_url=broker_url,
        celery_queue_name=first_non_empty(os.getenv("CELERY_QUEUE_NAME"), DEFAULT_QUEUE_NAME),
        celery_result_backend=blank_to_none(os.getenv("CELERY_RESULT_BACKEND")),
        database_url=build_database_url(),
        job_max_attempts=positive_int(os.getenv("JOB_MAX_ATTEMPTS"), DEFAULT_JOB_MAX_ATTEMPTS),
        job_default_timeout_seconds=positive_int(
            os.getenv("JOB_DEFAULT_TIMEOUT"),
            DEFAULT_JOB_TIMEOUT_SECONDS,
        ),
        asset_storage_dir=Path(first_non_empty(os.getenv("ASSET_STORAGE_DIR"), DEFAULT_ASSET_STORAGE_DIR)),
        worker_tmp_dir=Path(first_non_empty(os.getenv("WORKER_TMP_DIR"), DEFAULT_WORKER_TMP_DIR)),
        ffmpeg_bin=first_non_empty(os.getenv("FFMPEG_BIN"), "ffmpeg"),
        health_host=first_non_empty(os.getenv("WORKER_HEALTH_HOST"), "0.0.0.0"),
        health_port=positive_int(os.getenv("WORKER_HEALTH_PORT"), 8101),
        provider_rate_limit=blank_to_none(os.getenv("WORKER_PROVIDER_RATE_LIMIT")),
        worker_concurrency=positive_int(os.getenv("WORKER_CONCURRENCY"), DEFAULT_WORKER_CONCURRENCY),
        provider_gate_lease_seconds=positive_int(
            os.getenv("PROVIDER_GATE_LEASE_SECONDS"),
            max(DEFAULT_PROVIDER_GATE_LEASE_SECONDS, positive_int(os.getenv("JOB_DEFAULT_TIMEOUT"), DEFAULT_JOB_TIMEOUT_SECONDS) + 60),
        ),
    )


def build_database_url() -> str:
    explicit = os.getenv("DATABASE_URL")
    if explicit and explicit.strip():
        return explicit.strip()

    host = first_non_empty(os.getenv("DB_HOST"), "")
    if not host:
        return ""

    port = first_non_empty(os.getenv("DB_PORT"), "5432")
    user = first_non_empty(os.getenv("DB_USER"), "postgres")
    password = first_non_empty(os.getenv("DB_PASSWORD"), "")
    db_name = first_non_empty(os.getenv("DB_NAME"), "ai_manju")
    sslmode = first_non_empty(os.getenv("DB_SSLMODE"), "disable")

    parts = [
        f"host={host}",
        f"port={port}",
        f"user={user}",
        f"dbname={db_name}",
        f"sslmode={sslmode}",
    ]
    if password:
        parts.insert(3, f"password={password}")
    return " ".join(parts)


def redact_url(value: str) -> str:
    if not value:
        return ""
    parsed = urlsplit(value)
    if not parsed.password:
        return value
    username = parsed.username or ""
    hostname = parsed.hostname or ""
    port = f":{parsed.port}" if parsed.port else ""
    netloc = f"{username}:***@{hostname}{port}"
    return urlunsplit((parsed.scheme, netloc, parsed.path, parsed.query, parsed.fragment))


def first_non_empty(*values: str | None) -> str:
    for value in values:
        if value is not None and value.strip():
            return value.strip()
    return ""


def blank_to_none(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    return value.strip()


def positive_int(value: str | None, fallback: int) -> int:
    if value is None or not value.strip():
        return fallback
    try:
        parsed = int(value)
    except ValueError:
        return fallback
    return parsed if parsed > 0 else fallback
