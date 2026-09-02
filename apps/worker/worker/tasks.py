from __future__ import annotations

import json
import logging
from typing import Any, Callable

from celery import Celery, Task

from .assets import register_result_assets
from .config import load_settings
from .db import JOB_STATUS_CANCELED, JOB_STATUS_SUCCEEDED, JobStore, json_compatible
from .errors import SafeTaskError, error_payload, job_canceled_error
from .provider import edit_image, generate_image
from .provider_gate import ProviderGate, provider_gate_from_payload
from .staged_inputs import JOB_WORKSPACE_FIELD, cleanup_staged_inputs
from .video import generate_video, transcode_video


settings = load_settings()
logger = logging.getLogger(__name__)
celery_app = Celery("ai_manju_worker", broker=settings.celery_broker_url, backend=settings.celery_result_backend)
provider_task_annotations = {}
if settings.provider_rate_limit:
    provider_task_annotations = {
        "worker.image_generate": {"rate_limit": settings.provider_rate_limit},
        "worker.image_edit": {"rate_limit": settings.provider_rate_limit},
        "worker.video_generate": {"rate_limit": settings.provider_rate_limit},
    }
celery_app.conf.update(
    task_default_queue=settings.celery_queue_name,
    task_routes={
        "worker.image_generate": {"queue": settings.celery_queue_name},
        "worker.image_edit": {"queue": settings.celery_queue_name},
        "worker.video_generate": {"queue": settings.celery_queue_name},
        "worker.video_transcode": {"queue": settings.celery_queue_name},
    },
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    task_time_limit=settings.job_default_timeout_seconds,
    task_soft_time_limit=max(1, settings.job_default_timeout_seconds - 5),
    worker_prefetch_multiplier=1,
    task_annotations=provider_task_annotations,
)


def celery_retry_count() -> int:
    return max(0, settings.job_max_attempts - 1)


@celery_app.task(
    bind=True,
    name="worker.image_generate",
    max_retries=celery_retry_count(),
    acks_late=True,
    reject_on_worker_lost=True,
)
def image_generate(self: Task, *args: Any, **kwargs: Any) -> dict[str, Any]:
    job_id, payload = extract_request(args, kwargs)
    return execute_job(self, job_id, payload, generate_image, asset_type="image")


@celery_app.task(
    bind=True,
    name="worker.image_edit",
    max_retries=celery_retry_count(),
    acks_late=True,
    reject_on_worker_lost=True,
)
def image_edit(self: Task, *args: Any, **kwargs: Any) -> dict[str, Any]:
    job_id, payload = extract_request(args, kwargs)
    return execute_job(self, job_id, payload, edit_image, asset_type="image")


@celery_app.task(
    bind=True,
    name="worker.video_generate",
    max_retries=celery_retry_count(),
    acks_late=True,
    reject_on_worker_lost=True,
)
def video_generate(self: Task, *args: Any, **kwargs: Any) -> dict[str, Any]:
    job_id, payload = extract_request(args, kwargs)
    return execute_job(self, job_id, payload, generate_video, asset_type="video")


@celery_app.task(
    bind=True,
    name="worker.video_transcode",
    max_retries=celery_retry_count(),
    acks_late=True,
    reject_on_worker_lost=True,
)
def video_transcode(self: Task, *args: Any, **kwargs: Any) -> dict[str, Any]:
    job_id, payload = extract_request(args, kwargs)
    return execute_job(self, job_id, payload, transcode_video, asset_type="video")


def extract_request(args: tuple[Any, ...], kwargs: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    job_id = str(kwargs.get("job_id") or (args[0] if args else "")).strip()
    if not job_id:
        raise SafeTaskError("job_id is required", code="missing_job_id", retryable=False)

    raw_payload = kwargs.get("payload")
    if raw_payload is None and len(args) > 1:
        raw_payload = args[1]
    if raw_payload is None:
        raw_payload = {}
    if not isinstance(raw_payload, dict):
        raise SafeTaskError("payload must be a JSON object", code="invalid_payload", retryable=False)
    if isinstance(kwargs.get("provider"), dict) and "provider" not in raw_payload:
        raw_payload = {**raw_payload, "provider": kwargs["provider"]}
    return job_id, raw_payload


def execute_job(
    task: Task,
    job_id: str,
    payload: dict[str, Any],
    executor: Callable[[str, dict[str, Any], Any, Callable[[int], None]], dict[str, Any]],
    asset_type: str,
) -> dict[str, Any]:
    store = JobStore(settings.database_url)
    with store.job_lock(job_id) as lock:
        if not lock.acquired:
            return {"job_id": job_id, "status": "already_locked"}

        job = store.get_job(job_id)
        if job is None:
            raise SafeTaskError("job not found", code="job_not_found", retryable=False)
        if job["status"] == JOB_STATUS_SUCCEEDED:
            remove_provider_waiter(payload, job, job_id)
            cleanup_job_inputs(payload, job, job_id)
            log_job("job_skipped", job_id, status=JOB_STATUS_SUCCEEDED)
            return {"job_id": job_id, "status": JOB_STATUS_SUCCEEDED, "skipped": True}
        if job["status"] == JOB_STATUS_CANCELED:
            remove_provider_waiter(payload, job, job_id)
            cleanup_job_inputs(payload, job, job_id)
            log_job("job_skipped", job_id, status=JOB_STATUS_CANCELED)
            return {"job_id": job_id, "status": JOB_STATUS_CANCELED, "skipped": True}

        gate: ProviderGate | None = None
        gate_config = provider_gate_from_payload(payload, settings.celery_broker_url, settings.provider_gate_lease_seconds)
        if gate_config is not None:
            gate, max_concurrency = gate_config
            try:
                decision = gate.acquire(str(job.get("workspace_id") or ""), job_id, max_concurrency)
            except Exception as exc:
                gate_error = SafeTaskError("provider concurrency gate is unavailable", code="provider_gate_unavailable", retryable=True)
                # A Redis outage happens before any upstream Provider call. Keep
                # the Job queued and do not consume one of its real attempts.
                waiting = store.mark_waiting_provider(job_id)
                if waiting is None:
                    current = store.get_job(job_id)
                    if isinstance(current, dict) and current.get("status") == JOB_STATUS_CANCELED:
                        cleanup_job_inputs(payload, job, job_id)
                        log_job("job_canceled", job_id)
                        return {"job_id": job_id, "status": JOB_STATUS_CANCELED}
                raise task.retry(
                    exc=gate_error,
                    countdown=retry_countdown(int(job.get("attempts") or 0)),
                    max_retries=100000,
                ) from exc
            if not decision.acquired:
                waiting = store.mark_waiting_provider(job_id)
                if waiting is None:
                    current = store.get_job(job_id)
                    if isinstance(current, dict) and current.get("status") == JOB_STATUS_CANCELED:
                        cleanup_job_inputs(payload, job, job_id)
                        log_job("job_canceled", job_id)
                        return {"job_id": job_id, "status": JOB_STATUS_CANCELED}
                log_job("job_waiting_provider_slot", job_id, workspace_id=job.get("workspace_id"), retry_after=decision.retry_after_seconds)
                raise task.retry(
                    exc=SafeTaskError("waiting for provider concurrency slot", code="provider_gate_wait", retryable=True),
                    countdown=decision.retry_after_seconds,
                    max_retries=100000,
                )
            gate.start_heartbeat(job_id)

        log_job("job_started", job_id, job_type=job.get("type"))
        try:
            running = store.mark_running(job_id, 5)
            if running is None:
                current = store.get_job(job_id)
                if isinstance(current, dict) and current.get("status") == JOB_STATUS_CANCELED:
                    cleanup_job_inputs(payload, job, job_id)
                    log_job("job_canceled", job_id)
                    return {"job_id": job_id, "status": JOB_STATUS_CANCELED}
        except Exception:
            if gate is not None:
                gate.release(job_id)
                gate = None
            raise
        try:
            execution_payload = {**payload, JOB_WORKSPACE_FIELD: str(job.get("workspace_id") or "")}

            def update_progress(progress: int) -> None:
                updated = store.update_progress(job_id, progress)
                if updated is None:
                    current = store.get_job(job_id)
                    if isinstance(current, dict) and current.get("status") == JOB_STATUS_CANCELED:
                        raise job_canceled_error()

            result = executor(job_id, execution_payload, settings, update_progress)
            current = store.get_job(job_id)
            if isinstance(current, dict) and current.get("status") == JOB_STATUS_CANCELED:
                cleanup_job_inputs(payload, job, job_id)
                log_job("job_canceled", job_id)
                return {"job_id": job_id, "status": JOB_STATUS_CANCELED}
            result = register_result_assets(store, job, result, settings, asset_type)
            result = json_compatible(result)
            stored = store.set_result(job_id, result)
            if stored is None:
                current = store.get_job(job_id)
                if isinstance(current, dict) and current.get("status") == JOB_STATUS_CANCELED:
                    cleanup_job_inputs(payload, job, job_id)
                    log_job("job_canceled", job_id)
                    return {"job_id": job_id, "status": JOB_STATUS_CANCELED}
            cleanup_job_inputs(payload, job, job_id)
            log_job("job_succeeded", job_id, asset_type=asset_type)
            return {"job_id": job_id, "status": JOB_STATUS_SUCCEEDED, "result": result}
        except Exception as exc:
            current = store.get_job(job_id)
            if isinstance(exc, SafeTaskError) and exc.code == "job_canceled" and isinstance(current, dict) and current.get("status") == JOB_STATUS_CANCELED:
                cleanup_job_inputs(payload, job, job_id)
                log_job("job_canceled", job_id)
                return {"job_id": job_id, "status": JOB_STATUS_CANCELED}
            payload_error = error_payload(exc)
            if gate is not None and isinstance(exc, SafeTaskError) and exc.code == "provider_rate_limited":
                try:
                    gate.set_cooldown(exc.retry_after_seconds or retry_countdown(int(job.get("attempts") or 0)))
                except Exception as cooldown_exc:
                    log_job("provider_gate_cooldown_failed", job_id, error=str(cooldown_exc)[:240])
            if should_retry(job, exc):
                payload_error["next_retry"] = int(job.get("attempts") or 0) + 1
                stored = store.record_retry(job_id, payload_error)
                if stored is None:
                    current = store.get_job(job_id)
                    if isinstance(current, dict) and current.get("status") == JOB_STATUS_CANCELED:
                        cleanup_job_inputs(payload, job, job_id)
                        log_job("job_canceled", job_id)
                        return {"job_id": job_id, "status": JOB_STATUS_CANCELED}
                log_job("job_retry", job_id, error=payload_error.get("message"), retry=payload_error["next_retry"])
                raise task.retry(
                    exc=exc,
                    countdown=retry_after_seconds(exc, int(job.get("attempts") or 0)),
                    max_retries=100000,
                )
            stored = store.set_error(job_id, payload_error)
            if stored is None:
                current = store.get_job(job_id)
                if isinstance(current, dict) and current.get("status") == JOB_STATUS_CANCELED:
                    cleanup_job_inputs(payload, job, job_id)
                    log_job("job_canceled", job_id)
                    return {"job_id": job_id, "status": JOB_STATUS_CANCELED}
            cleanup_job_inputs(payload, job, job_id)
            log_job("job_failed", job_id, error=payload_error.get("message"), code=payload_error.get("code"))
            raise
        finally:
            if gate is not None:
                try:
                    gate.release(job_id)
                except Exception as exc:
                    log_job("provider_gate_release_failed", job_id, error=str(exc)[:240])


def cleanup_job_inputs(payload: dict[str, Any], job: dict[str, Any], job_id: str) -> None:
    try:
        errors = cleanup_staged_inputs(payload, str(job.get("workspace_id") or ""), settings)
    except Exception as exc:  # cleanup must never overwrite an established business terminal state
        errors = [str(exc)[:240]]
    if errors:
        log_job("staged_input_cleanup_failed", job_id, errors=errors[:3], error_count=len(errors))


def should_retry(job: dict[str, Any], exc: BaseException) -> bool:
    if isinstance(exc, SafeTaskError) and not exc.retryable:
        return False
    attempts = int(job.get("attempts") or 0)
    max_attempts = max(1, int(job.get("max_attempts") or settings.job_max_attempts))
    return attempts < max_attempts - 1


def retry_after_seconds(exc: BaseException, attempts: int) -> int:
    if isinstance(exc, SafeTaskError) and exc.retry_after_seconds is not None:
        return max(1, int(exc.retry_after_seconds))
    return retry_countdown(attempts)


def remove_provider_waiter(payload: dict[str, Any], job: dict[str, Any], job_id: str) -> None:
    gate_config = provider_gate_from_payload(payload, settings.celery_broker_url, settings.provider_gate_lease_seconds)
    if gate_config is None:
        return
    gate, _ = gate_config
    try:
        gate.remove_waiter(str(job.get("workspace_id") or ""), job_id)
    except Exception as exc:
        log_job("provider_gate_waiter_cleanup_failed", job_id, error=str(exc)[:240])


def retry_countdown(retries: int) -> int:
    return min(60, 2 ** max(0, retries))


def log_job(event: str, job_id: str, **fields: Any) -> None:
    logger.info(json.dumps({"event": event, "job_id": job_id, **fields}, sort_keys=True))
