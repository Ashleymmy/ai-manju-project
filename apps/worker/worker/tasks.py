from __future__ import annotations

import json
import logging
from time import monotonic
from datetime import datetime, timezone
from typing import Any, Callable

from celery import Celery, Task

from .assets import register_result_assets
from .config import load_settings
from .db import JOB_STATUS_CANCELED, JOB_STATUS_FAILED, JOB_STATUS_SUCCEEDED, TERMINAL_STATUSES, JobStore, json_compatible, RECOVERY_MAX_DELAY_SECONDS, recovery_budget_exhausted
from .errors import SafeTaskError, VideoTaskAcceptedError, VideoSubmissionUncertainError, VideoRecoveryPendingError, VideoReferenceError, error_payload, job_canceled_error
from .monitoring import attempt_event
from .generation_failover import PROVIDER_CANDIDATES_FIELD, generation_attempt, is_provider_failure, unavailable_error
from .image_output_validation import validate_canvas_image_outputs
from .image_requirements import ImageParameterError
from .provider import edit_image, generate_image, provider_has_remote
from .provider_gate import ProviderGate, provider_gate_from_payload
from .staged_inputs import JOB_WORKSPACE_FIELD, cleanup_staged_inputs
from .video import generate_video, transcode_video
from .video_checkpoint import VIDEO_CHECKPOINT_KEY, VIDEO_CHECKPOINT_PAYLOAD_KEY, VIDEO_RECOVERY_DELAY_SECONDS, VideoCheckpoint, recovery_error
from .image_checkpoint import IMAGE_CHECKPOINT_KEY, IMAGE_CHECKPOINT_PAYLOAD_KEY, IMAGE_RECOVERY_DELAY_SECONDS, ImageCheckpoint, recovery_error as image_recovery_error
from .errors import ImageRecoveryPendingError, ImageSubmissionUncertainError, ImageResultRejectedError, RECOVERY_ATTENTION_PHASES, ResultPersistencePendingError
from .recovery_dispatch import RECOVERY_ONLY_FIELD, RECOVERY_TOKEN_FIELD, RECOVERY_AUTOMATIC_FIELD, execution_recovery_fields, acknowledge_recovery, assert_recovery_only, automatic_recovery_allowed


settings = load_settings()
logger = logging.getLogger(__name__)
celery_app = Celery("ai_manju_worker", broker=settings.celery_broker_url, backend=settings.celery_result_backend)
# Generation jobs carry a per-delivery timelimit from the API. Keep the worker
# defaults above the longest media request as a safety net for brokers/workers
# that drop custom timelimit headers, while preserving the configured timeout
# for subprocess-based utility tasks such as transcoding.
DEFAULT_GENERATION_TASK_TIMEOUT_SECONDS = 60 * 60
# Rejected 429 requests do not consume generation attempts. Keep a bounded
# queue window so a permanently exhausted upstream quota cannot wait forever.
PROVIDER_THROTTLE_WAIT_SECONDS = 30 * 60
PROVIDER_THROTTLE_RETRY_SECONDS = 15
worker_task_timeout = max(settings.job_default_timeout_seconds, DEFAULT_GENERATION_TASK_TIMEOUT_SECONDS)
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
    task_time_limit=worker_task_timeout,
    task_soft_time_limit=max(1, worker_task_timeout - 5),
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
    raw_payload = {key: value for key, value in raw_payload.items() if key not in ("provider_candidates", PROVIDER_CANDIDATES_FIELD, VIDEO_CHECKPOINT_PAYLOAD_KEY, IMAGE_CHECKPOINT_PAYLOAD_KEY)}
    if isinstance(kwargs.get("provider"), dict):
        raw_payload = {**raw_payload, "provider": kwargs["provider"]}
    if isinstance(kwargs.get("provider_candidates"), list):
        raw_payload[PROVIDER_CANDIDATES_FIELD] = kwargs["provider_candidates"]
    return job_id, execution_recovery_fields(raw_payload, kwargs)


def execute_job(
    task: Task,
    job_id: str,
    payload: dict[str, Any],
    executor: Callable[[str, dict[str, Any], Any, Callable[[int], None]], dict[str, Any]],
    asset_type: str,
) -> dict[str, Any]:
    store = JobStore(settings.database_url)
    attempt_started = monotonic()
    with store.job_lock(job_id) as lock:
        if not lock.acquired:
            return {"job_id": job_id, "status": "already_locked"}

        job = store.get_job(job_id)
        if job is None:
            raise SafeTaskError("job not found", code="job_not_found", retryable=False)
        if payload.get(RECOVERY_ONLY_FIELD) is True and job["status"] not in TERMINAL_STATUSES:
            # API uses this same advisory lock. A token acknowledgement must
            # precede the attention guard, and may reset its window only once.
            try:
                if payload.get(RECOVERY_AUTOMATIC_FIELD) is True:
                    refreshed = job if automatic_recovery_allowed(job) else None
                else:
                    refreshed = acknowledge_recovery(store, job_id, str(payload.get(RECOVERY_TOKEN_FIELD) or ""))
            except Exception:
                raise task.retry(exc=SafeTaskError("recovery acknowledgement unavailable", code="recovery_state_unavailable"),
                                 countdown=RECOVERY_MAX_DELAY_SECONDS, max_retries=100000) from None
            if refreshed is None:
                # Stale/invalid dispatch cannot touch or execute a newer request.
                return {"job_id": job_id, "status": job["status"], "queue_phase": job.get("queue_phase", ""),
                        "skipped": True, "recovery_ignored": True}
            job = refreshed
        # A stale/reconfigured delivery cannot bypass an operator hold.
        attention_phase = recovery_attention_phase(job) if job["status"] not in TERMINAL_STATUSES else ""
        if attention_phase:
            if job.get("queue_phase") != attention_phase or job.get("status") != "queued":
                mark = store.mark_video_recovery if attention_phase.startswith("video_") else store.mark_image_recovery
                try:
                    restored = mark(job_id, attention=True)
                except Exception:
                    restored = None
                if restored is None:
                    raise task.retry(exc=SafeTaskError("recovery status unavailable", code="recovery_state_unavailable"),
                                     countdown=RECOVERY_MAX_DELAY_SECONDS, max_retries=100000)
            return {"job_id": job_id, "status": "queued", "queue_phase": attention_phase, "skipped": True}

        payload, generation_max_attempts = generation_attempt(payload, int(job.get("attempts") or 0))
        if job["status"] in (JOB_STATUS_SUCCEEDED, JOB_STATUS_FAILED):
            remove_provider_waiter(payload, job, job_id)
            cleanup_job_inputs(payload, job, job_id)
            log_job("job_skipped", job_id, status=job["status"])
            return {"job_id": job_id, "status": job["status"], "skipped": True}
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
                delay = retry_countdown(int(job.get("attempts") or 0))
                waiting = store.mark_waiting_provider(job_id, delay)
                if waiting is None:
                    current = store.get_job(job_id)
                    if isinstance(current, dict) and current.get("status") in TERMINAL_STATUSES:
                        remove_provider_waiter(payload, job, job_id)
                        cleanup_job_inputs(payload, job, job_id)
                        log_job("job_skipped", job_id, status=current["status"])
                        return {"job_id": job_id, "status": current["status"]}
                raise task.retry(
                    exc=gate_error,
                    countdown=delay,
                    max_retries=100000,
                ) from exc
            if not decision.acquired:
                waiting = store.mark_waiting_provider(job_id, decision.retry_after_seconds)
                if waiting is None:
                    current = store.get_job(job_id)
                    if isinstance(current, dict) and current.get("status") in TERMINAL_STATUSES:
                        remove_provider_waiter(payload, job, job_id)
                        cleanup_job_inputs(payload, job, job_id)
                        log_job("job_skipped", job_id, status=current["status"])
                        return {"job_id": job_id, "status": current["status"]}
                log_job("job_waiting_provider_slot", job_id, workspace_id=job.get("workspace_id"), retry_after=decision.retry_after_seconds)
                raise task.retry(
                    exc=SafeTaskError("waiting for provider concurrency slot", code="provider_gate_wait", retryable=True),
                    countdown=decision.retry_after_seconds,
                    max_retries=100000,
                )

        # Hold the slot through startup as well as execution: cancellation may
        # win the race between acquisition and marking the job as running.
        try:
            if gate is not None:
                gate.start_heartbeat(job_id)
            log_job("job_started", job_id, job_type=job.get("type"))
            running = store.mark_running(job_id, 5)
            if running is None:
                current = store.get_job(job_id)
                if isinstance(current, dict) and current.get("status") in TERMINAL_STATUSES:
                    cleanup_job_inputs(payload, job, job_id)
                    log_job("job_skipped", job_id, status=current["status"])
                    return {"job_id": job_id, "status": current["status"], "skipped": True}
                # Do not send paid work until startup is durably acknowledged.
                raise task.retry(exc=SafeTaskError("job startup not saved", code="job_start_pending"),
                                 countdown=RECOVERY_MAX_DELAY_SECONDS, max_retries=100000)
            generation_completed = False
            video_checkpoint = None
            image_checkpoint = None
            try:
                execution_payload = {**payload, JOB_WORKSPACE_FIELD: str(job.get("workspace_id") or "")}
                if job.get("type") == "video.generate" and not job.get("external_provider"):
                    video_checkpoint = VideoCheckpoint(store, job_id, payload.get("provider") or {})
                    video_checkpoint.recovery_only = payload.get(RECOVERY_ONLY_FIELD) is True
                    execution_payload[VIDEO_CHECKPOINT_PAYLOAD_KEY] = video_checkpoint
                if job.get("type") in {"image.generate", "image.edit"} and not job.get("external_provider") and provider_has_remote(payload.get("provider")):
                    image_checkpoint = ImageCheckpoint(store, job_id, payload.get("provider") or {}, settings)
                    image_checkpoint.recovery_only = payload.get(RECOVERY_ONLY_FIELD) is True
                    execution_payload[IMAGE_CHECKPOINT_PAYLOAD_KEY] = image_checkpoint
                assert_recovery_only(payload, video_checkpoint, image_checkpoint, kind=asset_type)
                # Recovery dispatch controls are execution metadata. Never send
                # them to a Provider or persist them in generated asset fields.
                execution_payload.pop(RECOVERY_ONLY_FIELD, None)
                execution_payload.pop(RECOVERY_TOKEN_FIELD, None)
                execution_payload.pop(RECOVERY_AUTOMATIC_FIELD, None)

                def update_progress(progress: int) -> None:
                    updated = store.update_progress(job_id, progress)
                    if updated is None:
                        current = store.get_job(job_id)
                        if isinstance(current, dict) and current.get("status") in TERMINAL_STATUSES:
                            if current["status"] == JOB_STATUS_CANCELED:
                                raise job_canceled_error()
                            raise SafeTaskError("job already finished", code="job_finished", retryable=False)

                update_progress(5)
                if generation_max_attempts and not provider_has_remote(payload.get("provider")):
                    raise SafeTaskError("generation provider is not configured", code="provider_not_configured", retryable=False)
                result = executor(job_id, execution_payload, settings, update_progress)
                generation_completed = True
                current = store.get_job(job_id)
                if isinstance(current, dict) and current.get("status") in TERMINAL_STATUSES:
                    cleanup_job_inputs(payload, job, job_id)
                    log_job("job_skipped", job_id, status=current["status"])
                    return {"job_id": job_id, "status": current["status"]}
                if asset_type == "image":
                    try:
                        validate_canvas_image_outputs(payload, result, settings)
                    except ImageParameterError as exc:
                        # Definite output rejection must fail, not recover forever.
                        if image_checkpoint is not None:
                            image_checkpoint.terminal_failure(exc)
                        raise
                result = register_result_assets(store, job, result, settings, asset_type)
                result = json_compatible(result)
                try:
                    stored = store.set_result(job_id, result)
                except Exception:
                    if (image_checkpoint is not None and image_checkpoint.active) or (video_checkpoint is not None and video_checkpoint.active):
                        raise
                    raise ResultPersistencePendingError("任务结果保存需要管理员核查，请勿重复提交", code="result_persistence_pending", retryable=False) from None
                if stored is None:
                    current = store.get_job(job_id)
                    if isinstance(current, dict) and current.get("status") in TERMINAL_STATUSES:
                        cleanup_job_inputs(payload, job, job_id)
                        log_job("job_skipped", job_id, status=current["status"])
                        return {"job_id": job_id, "status": current["status"]}
                    if image_checkpoint is not None and image_checkpoint.active:
                        raise image_recovery_error()
                    if video_checkpoint is not None and video_checkpoint.active:
                        raise recovery_error()
                    raise ResultPersistencePendingError("任务结果保存需要管理员核查，请勿重复提交", code="result_persistence_pending", retryable=False)
                cleanup_job_inputs(payload, job, job_id)
                log_job("job_succeeded", job_id, asset_type=asset_type)
                return {"job_id": job_id, "status": JOB_STATUS_SUCCEEDED, "result": result}
            except Exception as exc:
                if (isinstance(exc, (ImageRecoveryPendingError, ImageSubmissionUncertainError))
                        or (isinstance(exc, ResultPersistencePendingError) and asset_type == "image")
                        or (image_checkpoint is not None and image_checkpoint.active)):
                    try:
                        current = store.get_job(job_id)
                    except Exception:
                        current = None
                    if isinstance(current, dict) and current.get("status") in TERMINAL_STATUSES:
                        cleanup_job_inputs(payload, job, job_id)
                        return {"job_id": job_id, "status": current["status"], "skipped": True}
                    uncertain = isinstance(exc, ImageSubmissionUncertainError)
                    try:
                        waiting = store.mark_image_recovery(job_id, uncertain=uncertain, reason=getattr(exc, "code", ""),
                                                            attention=isinstance(exc, ResultPersistencePendingError),
                                                            recovered_result=result if isinstance(exc, ResultPersistencePendingError) else None)
                    except Exception:
                        waiting = None
                    if waiting is not None and waiting.get("queue_phase") in RECOVERY_ATTENTION_PHASES:
                        log_job("image_recovery_needs_attention", job_id)
                        return {"job_id": job_id, "status": "queued", "queue_phase": waiting["queue_phase"]}
                    if uncertain and waiting is not None:
                        log_job("image_submission_needs_reconciliation", job_id)
                        return {"job_id": job_id, "status": "queued", "queue_phase": "image_submission_uncertain"}
                    log_job("image_recovery_pending", job_id)
                    delay = waiting.get("recovery_retry_seconds", IMAGE_RECOVERY_DELAY_SECONDS) if waiting else RECOVERY_MAX_DELAY_SECONDS
                    raise task.retry(exc=image_recovery_error(), countdown=delay, max_retries=100000) from None
                if (isinstance(exc, VideoRecoveryPendingError)
                        or (isinstance(exc, ResultPersistencePendingError) and asset_type == "video")
                        or (isinstance(exc, VideoSubmissionUncertainError) and job.get("type") == "video.generate")
                        or (video_checkpoint is not None and (video_checkpoint.active or isinstance(exc, VideoSubmissionUncertainError)))):
                    # A paid task/result exists (or submit was uncertain). Keep
                    # its inputs/credits, and recover without creating again.
                    try:
                        current = store.get_job(job_id)
                    except Exception:
                        current = None
                    if isinstance(current, dict) and current.get("status") in TERMINAL_STATUSES:
                        return {"job_id": job_id, "status": current["status"], "skipped": True}
                    uncertain = isinstance(exc, VideoSubmissionUncertainError)
                    try:
                        waiting = store.mark_video_recovery(job_id, uncertain=uncertain, reason=getattr(exc, "code", ""),
                                                            attention=isinstance(exc, ResultPersistencePendingError),
                                                            recovered_result=result if isinstance(exc, ResultPersistencePendingError) else None)
                    except Exception:
                        waiting = None
                    if waiting is not None and waiting.get("queue_phase") in RECOVERY_ATTENTION_PHASES:
                        log_job("video_recovery_needs_attention", job_id)
                        return {"job_id": job_id, "status": "queued", "queue_phase": waiting["queue_phase"]}
                    if uncertain and waiting is not None:
                        log_job("video_submission_needs_reconciliation", job_id)
                        return {"job_id": job_id, "status": "queued", "queue_phase": "video_submission_uncertain"}
                    log_job("video_recovery_pending", job_id)
                    delay = waiting.get("recovery_retry_seconds", VIDEO_RECOVERY_DELAY_SECONDS) if waiting else RECOVERY_MAX_DELAY_SECONDS
                    raise task.retry(exc=recovery_error(), countdown=delay, max_retries=100000) from None
                current = store.get_job(job_id)
                if isinstance(current, dict) and current.get("status") in TERMINAL_STATUSES:
                    cleanup_job_inputs(payload, job, job_id)
                    log_job("job_skipped", job_id, status=current["status"])
                    return {"job_id": job_id, "status": current["status"]}
                payload_error = error_payload(exc)
                record_error = getattr(store, "record_monitoring_error", None)
                if callable(record_error):
                    try:
                        record_error(attempt_event(job, payload, {**payload_error, "message": str(exc)}, int((monotonic() - attempt_started) * 1000)))
                    except Exception:
                        # Diagnostics must never replace a generation outcome or retry.
                        log_job("monitoring_write_failed", job_id)
                if not generation_completed and isinstance(exc, SafeTaskError) and not isinstance(exc, (VideoTaskAcceptedError, VideoSubmissionUncertainError)) and exc.code == "provider_rate_limited" and provider_throttle_can_wait(job):
                    delay = max(PROVIDER_THROTTLE_RETRY_SECONDS, exc.retry_after_seconds or 0)
                    if gate is not None:
                        try:
                            gate.set_cooldown(delay)
                        except Exception:
                            pass
                    store.mark_waiting_provider(job_id, delay)
                    log_job("job_waiting_provider_rate_limit", job_id, retry_after=delay)
                    raise task.retry(exc=SafeTaskError("waiting for provider capacity", code="provider_gate_wait", retryable=True), countdown=delay, max_retries=100000)
                if gate is not None and isinstance(exc, SafeTaskError) and exc.code == "provider_rate_limited":
                    try:
                        gate.set_cooldown(exc.retry_after_seconds or retry_countdown(int(job.get("attempts") or 0)))
                    except Exception as cooldown_exc:
                        log_job("provider_gate_cooldown_failed", job_id, error=str(cooldown_exc)[:240])
                attempts = int(job.get("attempts") or 0)
                generation_retry = bool(generation_max_attempts and not generation_completed and is_provider_failure(exc))
                retry = (generation_retry and attempts < generation_max_attempts - 1) if generation_max_attempts else (not generation_completed and should_retry(job, exc))
                # A definitive failure of the original accepted task ends its
                # recovery. Recovery-only deliveries must never fall through to
                # paid-generation failover (nor queue an impossible retry).
                if payload.get(RECOVERY_ONLY_FIELD) is True:
                    retry = False
                if retry:
                    # Intermediate upstream errors and supplier identities are private.
                    payload_error = {} if generation_max_attempts else {**payload_error, "next_retry": attempts + 1}
                    delay = retry_after_seconds(exc, int(job.get("attempts") or 0))
                    stored = store.record_retry(job_id, payload_error, delay)
                    if stored is None:
                        current = store.get_job(job_id)
                        if isinstance(current, dict) and current.get("status") in TERMINAL_STATUSES:
                            cleanup_job_inputs(payload, job, job_id)
                            log_job("job_skipped", job_id, status=current["status"])
                            return {"job_id": job_id, "status": current["status"]}
                    log_job("job_retry", job_id, retry=attempts + 1)
                    raise task.retry(
                        exc=SafeTaskError("generation pending", code="generation_pending") if generation_max_attempts else exc,
                        countdown=delay,
                        max_retries=100000,
                    )
                if generation_max_attempts and not isinstance(exc, (ImageParameterError, ImageResultRejectedError, VideoTaskAcceptedError, VideoSubmissionUncertainError, VideoReferenceError)):
                    exc = unavailable_error() if generation_retry else SafeTaskError("任务处理失败，请稍后重试", code="generation_processing_failed", retryable=False)
                    payload_error = error_payload(exc)
                stored = store.set_error(job_id, payload_error)
                if stored is None:
                    current = store.get_job(job_id)
                    if isinstance(current, dict) and current.get("status") in TERMINAL_STATUSES:
                        cleanup_job_inputs(payload, job, job_id)
                        log_job("job_skipped", job_id, status=current["status"])
                        return {"job_id": job_id, "status": current["status"]}
                cleanup_job_inputs(payload, job, job_id)
                log_job("job_failed", job_id, error=payload_error.get("message"), code=payload_error.get("code"))
                raise exc
        finally:
            if gate is not None:
                try:
                    gate.release(job_id)
                except Exception as exc:
                    log_job("provider_gate_release_failed", job_id, error=str(exc)[:240])


def recovery_attention_phase(job):
    if job.get("queue_phase") in RECOVERY_ATTENTION_PHASES:
        return job["queue_phase"]
    metadata = job.get("bridge_metadata")
    if isinstance(metadata, dict):
        for kind, key in (("video", VIDEO_CHECKPOINT_KEY), ("image", IMAGE_CHECKPOINT_KEY)):
            checkpoint = metadata.get(key)
            if recovery_budget_exhausted(checkpoint):
                return f"{kind}_recovery_attention"
    return ""


def provider_throttle_can_wait(job: dict[str, Any]) -> bool:
    created = job.get("created_at")
    if isinstance(created, str):
        try:
            created = datetime.fromisoformat(created.replace("Z", "+00:00"))
        except ValueError:
            return False
    if not isinstance(created, datetime):
        return False
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - created).total_seconds() < PROVIDER_THROTTLE_WAIT_SECONDS


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
