"""Administrator recovery restores a saved task/receipt and cannot create work."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from psycopg.types.json import Jsonb

from .errors import ImageSubmissionUncertainError, VideoSubmissionUncertainError

RECOVERY_ONLY_FIELD = "_recovery_only"
RECOVERY_TOKEN_FIELD = "_recovery_dispatch_token"
# Automatic delivery repair preserves the existing recovery window and budget.
RECOVERY_AUTOMATIC_FIELD = "_recovery_automatic"
RECOVERY_CONTROL_KEY = "_worker_recovery_control"
# Same observation interval as the API's retained encrypted-dispatch scan.
RECOVERY_OBSERVATION_SECONDS = 120
RECOVERY_JOB_TYPES = {"video.generate", "image.generate", "image.edit"}


def execution_recovery_fields(payload, kwargs):
    payload = {key: value for key, value in payload.items() if key not in {RECOVERY_ONLY_FIELD, RECOVERY_TOKEN_FIELD, RECOVERY_AUTOMATIC_FIELD}}
    if kwargs.get(RECOVERY_ONLY_FIELD) is True:
        payload[RECOVERY_ONLY_FIELD] = True
        payload[RECOVERY_TOKEN_FIELD] = str(kwargs.get(RECOVERY_TOKEN_FIELD) or "")
        if kwargs.get(RECOVERY_AUTOMATIC_FIELD) is True:
            payload[RECOVERY_AUTOMATIC_FIELD] = True
    return payload


def automatic_recovery_allowed(job, now=None):
    """Read-only guard under the Worker job lock; no administrator ACK/reset.

    Running is permitted after a Worker crash, once its advisory lock is free.
    The API can restore stale running deliveries as well as queued recovery.
    """
    if job.get("status") not in {"queued", "running"} or job.get("external_provider") or job.get("type") not in RECOVERY_JOB_TYPES:
        return False
    if job.get("dispatch_state") in {"recovery_pending", "recovery_published"}:
        return False
    kind = "video" if job["type"] == "video.generate" else "image"
    phases = {f"{kind}_recovery_pending", "waiting_provider_slot"}
    if job.get("status") == "running":
        phases.add("")
    if (job.get("queue_phase") or "") not in phases:
        return False
    metadata = job.get("bridge_metadata")
    if not isinstance(metadata, dict):
        return False
    if RECOVERY_CONTROL_KEY in metadata:
        control = metadata[RECOVERY_CONTROL_KEY]
        if not isinstance(control, dict) or control.get("acknowledged") is not True:
            return False
    key = f"_worker_{kind}_checkpoint"
    other = "_worker_image_checkpoint" if kind == "video" else "_worker_video_checkpoint"
    cp = metadata.get(key)
    if other in metadata or not isinstance(cp, dict):
        return False
    if type(cp.get("version")) is not int or cp["version"] != 1 or type(cp.get("revision")) is not int or not 0 < cp["revision"] <= 9223372036854775807:
        return False
    if not isinstance(cp.get("provider_identity"), str) or not cp["provider_identity"]:
        return False
    phases = {"accepted", "downloaded"} if kind == "video" else {"received", "downloaded"}
    receipt = cp.get("provider_task_id" if kind == "video" else "receipt_id")
    if cp.get("phase") not in phases or not isinstance(receipt, str) or not receipt:
        return False
    if cp.get("recovery") is not None and not isinstance(cp["recovery"], dict):
        return False
    attention = (cp.get("recovery") or {}).get("requires_attention")
    if attention is not None and attention is not False:
        return False
    # Stale duplicate deliveries must not accelerate a newer retry chain.
    deadline = job.get("worker_retry_at")
    if deadline:
        try:
            if isinstance(deadline, str):
                deadline = datetime.fromisoformat(deadline.replace("Z", "+00:00"))
            if deadline.tzinfo is None:
                deadline = deadline.replace(tzinfo=timezone.utc)
            if deadline > (now or datetime.now(timezone.utc)):
                return False
        except (TypeError, ValueError, AttributeError):
            return False
    return True


def acknowledge_recovery(store, job_id, token):
    """Called only under the worker's job advisory lock; returns fresh Job.

    A token can reset the bounded recovery window once. Stale deliveries cannot
    reset a newer administrator request, and retries cannot prolong it forever.
    """
    if not re.fullmatch(r"[a-f0-9]{32}", token):
        return None
    with store.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM jobs WHERE id=%s FOR UPDATE", (job_id,))
            row = cur.fetchone()
            if not row or row["status"] not in {"queued", "running"} or row.get("external_provider") or row.get("type") not in RECOVERY_JOB_TYPES:
                return None
            metadata = dict(row.get("bridge_metadata") or {})
            control = dict(metadata.get(RECOVERY_CONTROL_KEY) or {})
            if control.get("token") != token:
                return None
            if control.get("acknowledged"):
                return row
            key = "_worker_video_checkpoint" if row["type"] == "video.generate" else "_worker_image_checkpoint"
            checkpoint = dict(metadata.get(key) or {})
            kind = "video" if key == "_worker_video_checkpoint" else "image"
            # Do not change paid phase, task ID, receipt identity, or provider.
            checkpoint.pop("recovery", None)
            checkpoint["revision"] = int(checkpoint.get("revision") or 0) + 1
            metadata[key] = checkpoint
            control["acknowledged"] = True
            metadata[RECOVERY_CONTROL_KEY] = control
            cur.execute("""UPDATE jobs SET bridge_metadata=%s::jsonb,
                dispatch_state='observed', dispatch_next_attempt_at=timezone('utc',now())+(%s * interval '1 second'),
                queue_phase=%s, updated_at=timezone('utc',now())
                WHERE id=%s AND status IN ('queued','running') RETURNING *""",
                (Jsonb(metadata), RECOVERY_OBSERVATION_SECONDS, f"{kind}_recovery_pending", job_id))
            return cur.fetchone()


def assert_recovery_only(payload, video_checkpoint=None, image_checkpoint=None, *, kind="video"):
    if not payload.get(RECOVERY_ONLY_FIELD):
        return
    if video_checkpoint is not None:
        phase = video_checkpoint.state.get("phase")
        if phase in {"accepted", "downloaded"} and video_checkpoint.task_id:
            return
        if phase == "downloaded" and video_checkpoint.cached_result() is not None:
            return
        raise VideoSubmissionUncertainError("原视频任务记录不完整，需要管理员核查，不能重新生成", code="video_submission_uncertain", retryable=False)
    if image_checkpoint is not None:
        if image_checkpoint.cached_result() is not None:
            return
        if image_checkpoint.active and image_checkpoint.state.get("receipt_id"):
            return
        raise ImageSubmissionUncertainError("原图片响应记录不完整，需要管理员核查，不能重新生成", code="image_submission_uncertain", retryable=False)
    if kind == "image":
        raise ImageSubmissionUncertainError("任务缺少原始图片恢复记录，不能重新生成", code="image_submission_uncertain", retryable=False)
    raise VideoSubmissionUncertainError("任务缺少原始恢复记录，不能重新生成", code="video_submission_uncertain", retryable=False)
