"""Private durable receipts for synchronous paid image requests.

Signed output URLs live only in mode-0600 files on the durable asset volume,
never in Job.result, Job.payload, public errors, or Celery result messages.
The database records a random receipt identity before POST; an atomic receipt
can therefore be found even if the worker dies before the next DB write.
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import secrets
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from .errors import ImageRecoveryPendingError, ImageResultRejectedError, ImageSubmissionUncertainError, job_canceled_error

IMAGE_CHECKPOINT_KEY = "_worker_image_checkpoint"
IMAGE_CHECKPOINT_PAYLOAD_KEY = "_image_checkpoint"
IMAGE_RECOVERY_DELAY_SECONDS = 30
# Bound private JSON reads while retaining multi-image inline responses.
IMAGE_RECEIPT_MAX_BYTES = 512 * 1024 * 1024


def recovery_error():
    return ImageRecoveryPendingError("图片结果正在恢复处理，请勿重复提交", code="image_recovery_pending", retryable=True)


def uncertain_error():
    return ImageSubmissionUncertainError("图片提交结果待确认，请勿重复提交，请联系管理员核查", code="image_submission_uncertain", retryable=False)


def provider_identity(provider):
    fields = {key: provider.get(key) for key in (
        "id", "model", "base_url", "endpoint", "protocol", "provider_type", "auth_type",
        "api_key", "custom_auth_header", "auth_query_param", "extra_headers", "endpoint_overrides",
    )}
    return hashlib.sha256(json.dumps(fields, sort_keys=True, default=str).encode()).hexdigest()


def atomic_write(path: Path, content: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=".receipt-", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        if os.name != "nt":
            directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)


def file_digest(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class ImageCheckpoint:
    def __init__(self, store, job_id, provider, settings):
        self.store, self.job_id, self.provider, self.settings = store, job_id, provider, settings
        try:
            record = store.get_image_checkpoint(job_id)
        except Exception as exc:
            raise recovery_error() from exc
        if record is None or record.get("status") == "canceled":
            raise job_canceled_error()
        self.state = copy.deepcopy(record.get("checkpoint") or {})
        if self.active and self.state.get("provider_identity") != provider_identity(provider):
            raise uncertain_error()

    @property
    def active(self):
        return self.state.get("phase") in {"submission_intent", "received", "downloaded"}

    def _save(self, **changes):
        revision = int(self.state.get("revision") or 0)
        value = {**self.state, **changes, "version": 1, "revision": revision + 1,
                 "updated_at": datetime.now(timezone.utc).isoformat()}
        try:
            stored = self.store.save_image_checkpoint(self.job_id, value, revision)
        except Exception as exc:
            raise recovery_error() from exc
        if stored is None:
            try:
                current = self.store.get_image_checkpoint(self.job_id)
            except Exception as exc:
                raise recovery_error() from exc
            if current is None or current.get("status") == "canceled":
                raise job_canceled_error()
            raise recovery_error()
        self.state = value

    def receipt_path(self):
        identity = str(self.state.get("receipt_id") or "")
        if not re.fullmatch(r"[a-f0-9]{32}", identity):
            raise uncertain_error()
        job_hash = hashlib.sha256(self.job_id.encode()).hexdigest()
        folder = self.settings.asset_storage_dir / ".image-checkpoints" / job_hash
        folder.mkdir(parents=True, exist_ok=True, mode=0o700)
        return folder / (identity + ".json")

    def pending_receipt(self):
        phase = self.state.get("phase")
        if phase == "terminal_failure":
            failure = self.state.get("error") or {}
            raise ImageResultRejectedError(failure.get("message") or "生成图片未通过校验", code=failure.get("code") or "image_output_unreadable", retryable=False)
        if not self.active:
            return None
        try:
            path = self.receipt_path()
            if not path.is_file():
                if phase == "submission_intent":
                    raise uncertain_error()
                raise recovery_error()
            if path.stat().st_size > IMAGE_RECEIPT_MAX_BYTES:
                raise recovery_error()
            data = json.loads(path.read_bytes())
            if data.get("receipt_id") != self.state["receipt_id"] or data.get("provider_identity") != self.state["provider_identity"]:
                raise recovery_error()
            if not isinstance(data.get("sources"), list) or not isinstance(data.get("metadata"), dict):
                raise recovery_error()
        except (ImageSubmissionUncertainError, ImageRecoveryPendingError):
            raise
        except Exception as exc:
            raise recovery_error() from exc
        if phase == "submission_intent":
            self._save(phase="received")
        return data

    def begin(self):
        if self.active:
            raise uncertain_error()
        if self.state.get("phase") == "terminal_failure":
            self.pending_receipt()
        self._save(phase="submission_intent", provider_identity=provider_identity(self.provider),
                   provider_id=str(self.provider.get("id") or ""), model=str(self.provider.get("model") or ""),
                   attempt=int(self.provider.get("generation_attempt") or 0), receipt_id=secrets.token_hex(16),
                   result=None, error=None, submitted_at=datetime.now(timezone.utc).isoformat())

    def rejected(self):
        self._save(phase="rejected", result=None)

    def received(self, sources, metadata):
        receipt = {"receipt_id": self.state["receipt_id"], "provider_identity": self.state["provider_identity"],
                   "sources": sources, "metadata": metadata}
        try:
            raw = json.dumps(receipt, ensure_ascii=True).encode()
            if len(raw) > IMAGE_RECEIPT_MAX_BYTES:
                raise recovery_error()
            atomic_write(self.receipt_path(), raw)
        except Exception as exc:
            raise recovery_error() from exc
        self._save(phase="received")
        return receipt

    def terminal_failure(self, exc):
        self._save(phase="terminal_failure", error={"code": exc.code, "message": exc.message}, result=None)

    def downloaded(self, result):
        safe = {key: result[key] for key in ("mode", "protocol", "operation", "provider_status") if key in result}
        safe["outputs"] = []
        for output in result.get("outputs", []):
            item = {key: output[key] for key in ("path", "content_type", "size", "file_name", "width", "height") if key in output}
            item["sha256"] = file_digest(item["path"])
            safe["outputs"].append(item)
        self._save(phase="downloaded", result=safe)

    def cached_result(self):
        result = self.state.get("result")
        if self.state.get("phase") != "downloaded" or not isinstance(result, dict) or not result.get("outputs"):
            return None
        try:
            for output in result["outputs"]:
                path = Path(output["path"]).resolve()
                if (not path.is_relative_to(self.settings.asset_storage_dir.resolve()) or not path.is_file()
                        or path.stat().st_size <= 0 or path.stat().st_size != int(output["size"])
                        or file_digest(path) != output["sha256"]):
                    return None
        except (KeyError, TypeError, ValueError, OSError):
            return None
        return copy.deepcopy(result)
