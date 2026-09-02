from __future__ import annotations

from fastapi import FastAPI
from redis import Redis

from .config import load_settings, redact_url
from .db import JobStore


settings = load_settings()
app = FastAPI(title="AI-Manju Worker", version="0.1.0")


@app.get("/health")
def health() -> dict[str, object]:
    db_status = "disabled"
    if settings.database_url:
        try:
            JobStore(settings.database_url).count_by_status()
            db_status = "ok"
        except Exception:
            db_status = "error"
    return {
        "service": "AI-Manju Worker",
        "status": "ok" if db_status in {"ok", "disabled"} else "degraded",
        "queue": settings.celery_queue_name,
        "broker": redact_url(settings.celery_broker_url),
        "db": db_status,
        "worker_concurrency": settings.worker_concurrency,
        "provider_rate_limit": settings.provider_rate_limit,
    }


@app.get("/metrics")
def metrics() -> dict[str, object]:
    job_metrics: dict[str, object] = {}
    if settings.database_url:
        job_metrics = JobStore(settings.database_url).metrics()
    return {
        "jobs": job_metrics,
        "redis": {"queue_depth": queue_depth()},
        "queue": settings.celery_queue_name,
        "capacity": {
            "worker_concurrency": settings.worker_concurrency,
            "provider_rate_limit": settings.provider_rate_limit,
        },
    }


def queue_depth() -> int | None:
    try:
        client = Redis.from_url(settings.celery_broker_url, socket_connect_timeout=1, socket_timeout=1)
        try:
            return int(client.llen(settings.celery_queue_name))
        finally:
            client.close()
    except Exception:
        return None
