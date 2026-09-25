"""Administrator recovery restores a saved task/receipt and cannot create work."""
from __future__ import annotations

import re
from psycopg.types.json import Jsonb

from .errors import ImageSubmissionUncertainError, VideoSubmissionUncertainError

RECOVERY_ONLY_FIELD = "_recovery_only"
RECOVERY_TOKEN_FIELD = "_recovery_dispatch_token"
RECOVERY_CONTROL_KEY = "_worker_recovery_control"
# Same observation interval as the API's retained encrypted-dispatch scan.
RECOVERY_OBSERVATION_SECONDS = 120
RECOVERY_JOB_TYPES = {"video.generate", "image.generate", "image.edit"}


def execution_recovery_fields(payload, kwargs):
    payload = {key: value for key, value in payload.items() if key not in {RECOVERY_ONLY_FIELD, RECOVERY_TOKEN_FIELD}}
    if kwargs.get(RECOVERY_ONLY_FIELD) is True:
        payload[RECOVERY_ONLY_FIELD] = True
        payload[RECOVERY_TOKEN_FIELD] = str(kwargs.get(RECOVERY_TOKEN_FIELD) or "")
    return payload


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
