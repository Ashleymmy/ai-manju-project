"""Native video providers fetch media URLs; inline bytes exceed some URL limits."""
from __future__ import annotations

import base64
import binascii
import copy
import hashlib
import logging
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import urlsplit

from . import object_storage
from .config import Settings
from .errors import SafeTaskError, VideoTaskAcceptedError, VideoSubmissionUncertainError
from .db import JobStore
from .owned_reference_urls import refresh_owned_reference
from .staged_inputs import JOB_WORKSPACE_FIELD, workspace_prefix_parts
from .video_reference_transfer import prepare_reference_transfer

# Match the supported reference upload budgets; never treat arbitrary data as media.
REFERENCE_MAX_BYTES = {"image_url": 30 * 1024 * 1024, "video_url": 50 * 1024 * 1024, "audio_url": 15 * 1024 * 1024}
REFERENCE_URL_MAX_LENGTH = 4000
logger = logging.getLogger(__name__)


@contextmanager
def native_video_references(job_id: str, body: dict[str, Any], payload: dict[str, Any], settings: Settings, *, checkpoint=None) -> Iterator[dict[str, Any]]:
    """Keep private reference objects alive through submission, polling and download.

    Keys are stable across redelivery, scoped to the job's workspace. Registered
    asset references and external HTTP URLs pass through. Owned Studio assets
    receive a fresh signature after an independent workspace/asset check.
    Local-only deployments retain their existing inline-media behavior.
    """
    content = body.get("content")
    if not isinstance(content, list) or not object_storage.enabled():
        yield body
        return
    prepared = copy.deepcopy(body)
    uploaded: list[str] = []
    keep_references = False
    canceled = False
    try:
        for index, item in enumerate(prepared["content"]):
            if not isinstance(item, dict):
                continue
            kind = item.get("type")
            if kind not in REFERENCE_MAX_BYTES:
                continue
            reference = item.get(kind)
            raw = reference.get("url") if isinstance(reference, dict) else None
            if not isinstance(raw, str):
                continue
            if not raw.lower().startswith("data:"):
                reference["url"] = refresh_owned_reference(raw, kind, str(payload.get(JOB_WORKSPACE_FIELD) or ""), checkpoint.store if checkpoint is not None else JobStore(settings.database_url))
                continue
            header, separator, encoded = raw.partition(",")
            media_type = header[5:].removesuffix(";base64").lower()
            if not separator or not header.endswith(";base64") or not media_type.startswith(kind.removesuffix("_url") + "/"):
                raise invalid_reference()
            limit = REFERENCE_MAX_BYTES[kind]
            if len(encoded) > 4 * ((limit + 2) // 3):
                raise invalid_reference()
            try:
                data = base64.b64decode(encoded, validate=True)
            except (ValueError, binascii.Error):
                raise invalid_reference() from None
            if not data or len(data) > limit:
                raise invalid_reference()
            scope = "/".join(workspace_prefix_parts(str(payload.get(JOB_WORKSPACE_FIELD) or "")))
            job_key = hashlib.sha256(job_id.encode()).hexdigest()[:32]
            settings.worker_tmp_dir.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(prefix="video-reference-", dir=settings.worker_tmp_dir) as tmp:
                path = Path(tmp) / "reference"
                path.write_bytes(data)
                transfer = prepare_reference_transfer(path, media_type, settings)
                digest = hashlib.sha256(transfer.read_bytes()).hexdigest()
                key = f"jobs/inputs/{scope}/native-{job_key}/{index}-{digest}"
                uploaded.append(key)
                if checkpoint is not None and key not in checkpoint.references:
                    checkpoint.references.append(key)
                object_storage.upload(key, transfer, "video/mp4" if transfer != path else media_type)
            signed = object_storage.signed_reference_url(key)
            parsed = urlsplit(signed or "")
            if not signed or len(signed) > REFERENCE_URL_MAX_LENGTH or parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username is not None:
                raise SafeTaskError("reference download URL unavailable", code="storage_configuration", retryable=False)
            reference["url"] = signed
        yield prepared
    except (VideoTaskAcceptedError, VideoSubmissionUncertainError):
        # The supplier may still be reading these URLs. Retain only this job's
        # references for reconciliation rather than breaking an accepted task.
        keep_references = True
        raise
    except SafeTaskError as exc:
        canceled = exc.code == "job_canceled"
        raise
    finally:
        if not canceled and checkpoint is not None and checkpoint.state.get("phase") in {"submission_intent", "accepted"}:
            keep_references = True
        for key in ([] if keep_references else uploaded):
            try:
                object_storage.delete(key)
            except Exception:
                # Cleanup must not overwrite a successful video or expose signed URLs.
                logger.warning("native video temporary reference cleanup failed job_id=%s", job_id)


def release_checkpoint_references(job_id, checkpoint):
    """A resumed task has no upload context; clean only its recorded references."""
    for key in checkpoint.references:
        try:
            object_storage.delete(key)
        except Exception:
            logger.warning("native video temporary reference cleanup failed job_id=%s", job_id)


def invalid_reference() -> SafeTaskError:
    return SafeTaskError("视频参考媒体格式无效或超过大小限制，请重新上传", code="video_invalid_reference", retryable=False)
