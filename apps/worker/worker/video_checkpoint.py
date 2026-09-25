"""Private, compare-and-swap lifecycle checkpoint for paid native video jobs."""
from __future__ import annotations

import copy
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .errors import VideoRecoveryPendingError, VideoSubmissionUncertainError, job_canceled_error

# API serializers must remove this entire bridge_metadata entry from user output.
VIDEO_CHECKPOINT_KEY = "_worker_video_checkpoint"
VIDEO_CHECKPOINT_PAYLOAD_KEY = "_video_checkpoint"
VIDEO_RECOVERY_DELAY_SECONDS = 30


def recovery_error() -> VideoRecoveryPendingError:
    return VideoRecoveryPendingError("视频任务正在恢复处理，请勿重复提交", code="video_recovery_pending", retryable=True)


def provider_identity(provider: dict[str, Any]) -> str:
    # Includes credential identity without persisting credentials. A changed
    # account/endpoint must never be used to query or resubmit an old paid task.
    fields = {key: provider.get(key) for key in (
        "id", "model", "base_url", "endpoint", "video_protocol", "provider_type",
        "auth_type", "api_key", "custom_auth_header", "auth_query_param", "extra_headers", "endpoint_overrides",
    )}
    return hashlib.sha256(json.dumps(fields, sort_keys=True, default=str).encode()).hexdigest()


class VideoCheckpoint:
    def __init__(self, store, job_id: str, provider: dict[str, Any]):
        self.store, self.job_id, self.provider = store, job_id, provider
        try:
            record = store.get_video_checkpoint(job_id)
        except Exception as exc:
            raise recovery_error() from exc
        if record is None or record.get("status") == "canceled":
            raise job_canceled_error()
        self.state = copy.deepcopy(record.get("checkpoint") or {})
        self.references = list(self.state.get("reference_keys") or [])
        if self.state.get("phase") not in {None, "rejected", "terminal_failure"}:
            if self.state.get("provider_identity") != provider_identity(provider):
                raise VideoSubmissionUncertainError("视频任务通道配置已变化，请联系管理员核查，勿重复提交", code="video_checkpoint_provider_changed", retryable=False)

    @property
    def task_id(self) -> str:
        if self.state.get("phase") in {"rejected", "terminal_failure"}:
            return ""
        return str(self.state.get("provider_task_id") or "")

    @property
    def active(self) -> bool:
        return self.state.get("phase") in {"submission_intent", "accepted", "downloaded"}

    def _save(self, **changes):
        revision = int(self.state.get("revision") or 0)
        proposed = {**self.state, **changes, "version": 1, "revision": revision + 1, "updated_at": datetime.now(timezone.utc).isoformat()}
        try:
            stored = self.store.save_video_checkpoint(self.job_id, proposed, revision)
        except Exception as exc:
            raise recovery_error() from exc
        if stored is None:
            # A cancellation or another owner won the CAS. Never continue POST.
            try:
                current = self.store.get_video_checkpoint(self.job_id)
            except Exception as exc:
                raise recovery_error() from exc
            if current is None or current.get("status") == "canceled":
                raise job_canceled_error()
            raise recovery_error()
        self.state = proposed

    def assert_recoverable(self):
        if self.state.get("phase") == "submission_intent" and not self.task_id:
            raise VideoSubmissionUncertainError("视频提交结果待确认，请勿重复提交，请联系管理员核查", code="video_submission_uncertain", retryable=False)

    def begin(self):
        self.assert_recoverable()
        if self.task_id:
            raise recovery_error()
        self._save(phase="submission_intent", attempt=int(self.provider.get("generation_attempt") or 0),
                   provider_identity=provider_identity(self.provider), provider_id=str(self.provider.get("id") or ""),
                   model=str(self.provider.get("model") or ""), provider_task_id="", result=None,
                   reference_keys=list(self.references), submitted_at=datetime.now(timezone.utc).isoformat())

    def accepted(self, task_id: str):
        self._save(phase="accepted", provider_task_id=task_id)

    def rejected(self):
        self._save(phase="rejected", provider_task_id="", result=None)

    def terminal_failure(self):
        self._save(phase="terminal_failure", result=None)

    def downloaded(self, result: dict[str, Any]):
        # Persist local durable output metadata, never upstream signed URLs.
        safe = {key: result[key] for key in ("mode", "operation", "provider_task_id", "provider_status", "outputs") if key in result}
        self._save(phase="downloaded", result=safe)

    def cached_result(self):
        result = self.state.get("result")
        if self.state.get("phase") != "downloaded" or not isinstance(result, dict):
            return None
        outputs = result.get("outputs")
        if not outputs:
            return None
        for output in outputs:
            try:
                path = Path(output["path"])
                if not path.is_file() or path.stat().st_size <= 0 or path.stat().st_size != int(output["size"]):
                    return None
            except (KeyError, TypeError, ValueError, OSError):
                return None
        return copy.deepcopy(result)
