from __future__ import annotations

from fastapi import FastAPI, Response
from celery import Celery
from redis import Redis

from .config import load_settings, redact_url
from .db import JobStore
from .runtime import worker_name


settings = load_settings()
app = FastAPI(title="AI-Manju Worker", version="0.1.0")
CELERY_PROBE_TIMEOUT_SECONDS = 1


@app.get("/health")
def health(response: Response) -> dict[str, object]:
    db_status = "disabled"
    if settings.database_url:
        try:
            JobStore(settings.database_url).count_by_status()
            db_status = "ok"
        except Exception:
            db_status = "error"
    queue_status = queue_depth() is not None
    storage_status = True
    try:
        from . import object_storage
        object_storage.probe()
    except Exception:
        storage_status = False
    celery_status = celery_ready() if queue_status else False
    healthy = db_status in {"ok", "disabled"} and queue_status and storage_status and celery_status
    if not healthy: response.status_code = 503
    return {
        "service": "AI-Manju Worker",
        "status": "ok" if healthy else "degraded",
        "checks": {"queue": queue_status, "storage": storage_status, "celery": celery_status},
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


def celery_ready() -> bool:
    # 精确查询本容器，不让别的 Worker 的 pong 掩盖本实例失联。
    target = worker_name()
    try:
        with Celery("worker-health", broker=settings.celery_broker_url) as client:
            client.conf.update(broker_connection_timeout=CELERY_PROBE_TIMEOUT_SECONDS,
                               broker_connection_max_retries=0, task_publish_retry=False,
                               broker_transport_options={"socket_connect_timeout": 1, "socket_timeout": 1})
            replies = client.control.inspect(destination=[target], timeout=CELERY_PROBE_TIMEOUT_SECONDS).ping()
            return bool(replies and replies.get(target, {}).get("ok") == "pong")
    except Exception:
        return False
