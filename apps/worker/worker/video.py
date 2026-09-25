from __future__ import annotations

import mimetypes
import subprocess
import time
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote, urlparse

import requests
from billiard.exceptions import SoftTimeLimitExceeded

from .config import Settings
from .errors import SafeTaskError, VideoSubmissionUncertainError, VideoTaskAcceptedError, VideoRecoveryPendingError, VideoReferenceError, safe_message
from .db import JobStore
from .generation_failover import MEDIA_REQUEST_TIMEOUT_SECONDS
from .provider import (
    close_multipart_files,
    ensure_job_dir,
    provider_auth_headers,
    provider_error_message,
    provider_has_remote,
    provider_request_url,
    provider_retry_after_seconds,
)
from .staged_inputs import INPUT_STORAGE_KEY_FIELD, open_staged_input, resolve_legacy_asset_path, resolve_output_dir, validate_staged_input
from .video_h3 import h3_provider, h3_request_body, is_h3_reference_model
from .video_references import native_video_references, release_checkpoint_references
from .video_checkpoint import VIDEO_CHECKPOINT_PAYLOAD_KEY, VideoCheckpoint, recovery_error
from .http_security import HTTPPolicyError, provider_request, public_media_get, submission_redirected, trusted_media_origins


ProgressFn = Callable[[int], None]

VIDEO_CREATE_PROGRESS = 15
VIDEO_POLL_PROGRESS_MIN = 20
VIDEO_POLL_PROGRESS_MAX = 85
VIDEO_DOWNLOAD_PROGRESS = 90
VIDEO_COMPLETE_PROGRESS = 95
VIDEO_POLL_INTERVAL_SECONDS = 2.5
VIDEO_REQUEST_TIMEOUT_SECONDS = float(MEDIA_REQUEST_TIMEOUT_SECONDS)
VIDEO_DOWNLOAD_CHUNK_BYTES = 1024 * 1024
# Cancellation is best effort and must not hold a worker slot for minutes.
VIDEO_CANCEL_TIMEOUT_SECONDS = 10
# Retry transfers of an already generated video without submitting another task.
VIDEO_DOWNLOAD_ATTEMPTS = 3
VIDEO_DOWNLOAD_RETRY_SECONDS = 1
# Preserve the previous native endpoint download and response traversal limits.
NATIVE_VIDEO_MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024
NATIVE_VIDEO_RESPONSE_MAX_DEPTH = 16
VIDEO_SUCCESS_STATUSES = {"completed", "succeeded", "success", "done"}
VIDEO_FAILURE_STATUSES = {"failed", "failure", "cancelled", "canceled", "expired", "rejected"}
VIDEO_REQUEST_FIELDS = ("model", "prompt", "seconds", "size", "resolution_name", "preset")
# Native request allowlist excludes job bookkeeping and supplier credentials.
NATIVE_VIDEO_REQUEST_FIELDS = ("model", "prompt", "content", "ratio", "resolution", "duration", "generate_audio", "watermark", "seed", "camera_fixed", "return_last_frame", "service_tier", "execution_expires_after", "draft")


def generate_video(job_id: str, payload: dict[str, Any], settings: Settings, progress: ProgressFn) -> dict[str, Any]:
    checkpoint = checkpoint_for_video(job_id, payload, settings)
    checkpoint.assert_recoverable()
    cached = checkpoint.cached_result()
    if cached is not None:
        release_checkpoint_references(job_id, checkpoint)
        return cached
    provider = payload.get("provider")
    if not checkpoint.task_id and isinstance(provider, dict) and provider.get("video_protocol") == "seedance":
        body = provider.get("video_request_body") or {key: payload[key] for key in NATIVE_VIDEO_REQUEST_FIELDS if key in payload}
        with native_video_references(job_id, body, payload, settings, checkpoint=checkpoint) as prepared:
            return _generate_video(job_id, {**payload, "provider": {**provider, "video_request_body": prepared}}, settings, progress, checkpoint)
    return _generate_video(job_id, payload, settings, progress, checkpoint)


def checkpoint_for_video(job_id: str, payload: dict[str, Any], settings: Settings) -> VideoCheckpoint:
    checkpoint = payload.get(VIDEO_CHECKPOINT_PAYLOAD_KEY)
    if isinstance(checkpoint, VideoCheckpoint):
        return checkpoint
    return VideoCheckpoint(JobStore(settings.database_url), job_id, payload.get("provider") or {})


def _generate_video(job_id: str, payload: dict[str, Any], settings: Settings, progress: ProgressFn, checkpoint: VideoCheckpoint) -> dict[str, Any]:
    provider = payload.get("provider")
    if not provider_has_remote(provider):
        raise SafeTaskError("video provider is not configured", code="provider_not_configured", retryable=False)

    assert isinstance(provider, dict)
    h3 = is_h3_reference_model(str(provider.get("model") or ""))
    if h3:
        provider = h3_provider(provider)
    base_url = str(provider.get("base_url") or "").rstrip("/") + "/"
    create_endpoint = str(provider.get("endpoint") or "v1/videos").strip()
    create_url = provider_request_url(base_url, create_endpoint, provider)
    headers = provider_auth_headers(provider)
    # A terminal upstream failure needs a fresh task; redelivery of one attempt
    # retains its key so a worker restart does not create a duplicate.
    attempt = provider.get("generation_attempt")
    headers.setdefault("Idempotency-Key", job_id if attempt is None else f"{job_id}-{attempt}")
    create_headers = dict(headers)
    if provider.get("provider_type") == "aliyun_yike":
        create_headers["X-DashScope-Async"] = "enable"
    timeout = video_request_timeout(provider, settings)
    native = provider.get("video_protocol") == "seedance"
    if provider.get("video_request_error"):
        raise SafeTaskError("video reference mode unsupported", code="provider_bad_request", retryable=False)
    if checkpoint.task_id:
        task_id = checkpoint.task_id
        task = {"id": task_id, "status": "queued"}
        resumed = True
    else:
        resumed = False
        task = create_video_task(job_id, payload, provider, settings, progress, checkpoint, h3=h3, native=native,
                                 create_url=create_url, create_headers=create_headers, timeout=timeout)
        task_id = video_task_id(task)

    try:
        task = wait_for_video_task(task_id, task, provider, base_url, headers, timeout, settings, progress)
        output = download_completed_video(job_id, task_id, task, provider, base_url, headers, timeout, settings, progress)
        result = {"mode": "openai_compatible", "operation": "generate", "provider_task_id": task_id,
                  "provider_status": video_status(task), "outputs": [output]}
        checkpoint.downloaded(result)
        if resumed:
            release_checkpoint_references(job_id, checkpoint)
        progress(VIDEO_COMPLETE_PROGRESS)
        return result
    except SafeTaskError as exc:
        if exc.code == "job_canceled":
            cancel_provider_video_task(task_id, provider, base_url, headers, timeout)
            if resumed:
                release_checkpoint_references(job_id, checkpoint)
            raise
        if exc.code == "provider_video_failed" or isinstance(exc, VideoReferenceError):
            checkpoint.terminal_failure()
            if resumed:
                release_checkpoint_references(job_id, checkpoint)
            raise
        # Keep the accepted task alive: a later delivery polls/downloads it.
        if isinstance(exc, VideoRecoveryPendingError):
            raise
        raise VideoRecoveryPendingError(exc.message, code="video_recovery_pending", retryable=True) from exc
    except Exception as exc:
        raise recovery_error() from exc


def create_video_task(job_id, payload, provider, settings, progress, checkpoint, *, h3, native, create_url, create_headers, timeout):
    body = h3_request_body(payload, provider, settings) if h3 else None
    parts = [] if native or h3 else video_request_parts(payload, provider, settings)

    try:
        progress(VIDEO_CREATE_PROGRESS)
        checkpoint.begin()
        if h3:
            response = provider_request("POST", create_url, headers=create_headers, json=body, timeout=timeout)
        elif native:
            body = provider.get("video_request_body") or {key: payload[key] for key in NATIVE_VIDEO_REQUEST_FIELDS if key in payload}
            body = {**body, "model": provider.get("model")}
            response = provider_request("POST", create_url, headers=create_headers, json=body, timeout=timeout)
        else:
            response = provider_request("POST", create_url, headers=create_headers, files=parts, timeout=timeout)
    except requests.ConnectTimeout as exc:
        # ConnectTimeout is safe to retry: no connection to the supplier formed.
        checkpoint.rejected()
        raise SafeTaskError("video provider request failed", code="provider_request_failed", retryable=True) from None
    except (requests.RequestException, HTTPPolicyError, SoftTimeLimitExceeded) as exc:
        raise VideoSubmissionUncertainError("视频提交结果待确认，请勿重复提交，请联系管理员核查", code="video_submission_uncertain", retryable=False) from None
    finally:
        close_multipart_files(parts)
    if response.status_code >= 500 or (submission_redirected(response) and response.status_code >= 400):
        response.close()
        raise VideoSubmissionUncertainError("视频提交结果待确认，请勿重复提交，请联系管理员核查", code="video_submission_uncertain", retryable=False)
    if 400 <= response.status_code < 500 and response.status_code != 408:
        checkpoint.rejected()
    if response.status_code == 408:
        response.close()
        raise VideoSubmissionUncertainError("视频提交结果待确认，请勿重复提交，请联系管理员核查", code="video_submission_uncertain", retryable=False)
    ensure_video_response(response, "video provider create")
    try:
        task = video_response_json(response, "video provider returned invalid create response")
    except SafeTaskError as exc:
        raise VideoSubmissionUncertainError("视频提交响应不完整，请勿重复提交，请联系管理员核查", code="video_submission_uncertain", retryable=False) from exc
    task_id = video_task_id(task)
    if not task_id:
        raise VideoSubmissionUncertainError("视频提交响应缺少任务编号，请勿重复提交，请联系管理员核查", code="video_submission_uncertain", retryable=False)
    try:
        checkpoint.accepted(task_id)
    except SafeTaskError as exc:
        if exc.code == "job_canceled":
            cancel_provider_video_task(task_id, provider, str(provider.get("base_url") or "").rstrip("/") + "/", provider_auth_headers(provider), timeout)
        raise
    return task


def wait_for_video_task(
    task_id: str,
    initial: dict[str, Any],
    provider: dict[str, Any],
    base_url: str,
    headers: dict[str, str],
    timeout: float,
    settings: Settings,
    progress: ProgressFn,
) -> dict[str, Any]:
    task = initial
    deadline = time.monotonic() + timeout
    while True:
        status = video_status(task)
        if status in VIDEO_SUCCESS_STATUSES:
            return task
        if status in VIDEO_FAILURE_STATUSES:
            message = video_task_error(task, status)
            if "timeout" in message.lower() and "processing video for content[" in message.lower():
                raise VideoReferenceError(message, code="video_reference_timeout", retryable=False)
            raise SafeTaskError(message, code="provider_video_failed", retryable=False)

        progress(video_progress(task))
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise SafeTaskError("video provider task timed out", code="provider_timeout", retryable=False)
        time.sleep(min(VIDEO_POLL_INTERVAL_SECONDS, remaining))
        progress(video_progress(task))
        fallback = "contents/generations/tasks/{id}" if provider.get("video_protocol") == "seedance" else "videos/{id}"
        endpoint = video_endpoint(provider, "video_get", fallback, task_id)
        url = provider_request_url(base_url, endpoint, provider)
        try:
            response = provider_request("GET", url, headers=headers, timeout=min(timeout, max(1.0, remaining)))
        except HTTPPolicyError:
            raise recovery_error() from None
        except requests.RequestException:
            # Keep polling the accepted task within its budget instead of creating
            # duplicate videos after a temporary transport error.
            continue
        if response.status_code == 429 or response.status_code >= 500:
            response.close()
            continue
        ensure_video_response(response, "video provider status", retryable=False)
        task = video_response_json(response, "video provider returned invalid status response")


def download_video_result(
    job_id: str,
    task_id: str,
    task: dict[str, Any],
    provider: dict[str, Any],
    base_url: str,
    headers: dict[str, str],
    timeout: float,
    settings: Settings,
    progress: ProgressFn,
) -> dict[str, Any]:
    endpoint = video_endpoint(provider, "video_content", "videos/{id}/content", task_id)
    url = provider_request_url(base_url, endpoint, provider)
    download_headers = headers
    if provider.get("video_protocol") == "seedance":
        url = native_video_url(task)
        parsed = urlparse(url)
        if not url or parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username is not None:
            raise SafeTaskError("video provider returned no video URL", code="provider_invalid_response", retryable=False)
        # Signed storage links are independent of supplier API authentication.
        download_headers = {}
    progress(VIDEO_DOWNLOAD_PROGRESS)
    try:
        if provider.get("video_protocol") == "seedance":
            response = public_media_get(url, stream=True, timeout=max(timeout, 1.0), trusted_origins=trusted_media_origins(provider))
        else:
            response = provider_request("GET", url, headers=download_headers, stream=True, timeout=max(timeout, 1.0),
                                        allow_public_redirect=True, trusted_origins=trusted_media_origins(provider),
                                        credential_values=(str(provider.get("api_key") or ""),))
    except HTTPPolicyError:
        raise recovery_error() from None
    except requests.RequestException as exc:
        raise SafeTaskError("video provider content request failed", code="provider_request_failed", retryable=False) from None
    try:
        ensure_video_response(response, "video provider content", retryable=False)
    except Exception:
        response.close()
        raise

    content_type = str(response.headers.get("Content-Type") or video_content_type(task) or "video/mp4").split(";", 1)[0].strip().lower()
    if provider.get("video_protocol") in {"seedance", "zizi_h3"} and not content_type.startswith("video/") and content_type != "application/octet-stream":
        response.close()
        raise SafeTaskError("video provider returned invalid content", code="provider_invalid_response", retryable=False)
    output_dir = ensure_job_dir(settings.asset_storage_dir, job_id)
    output_path = output_dir / f"provider_0.{video_extension(content_type)}"
    try:
        with output_path.open("wb") as stream:
            chunks = getattr(response, "iter_content", None)
            if callable(chunks):
                for chunk in chunks(chunk_size=VIDEO_DOWNLOAD_CHUNK_BYTES):
                    if chunk:
                        if provider.get("video_protocol") in {"seedance", "zizi_h3"} and stream.tell() + len(chunk) > NATIVE_VIDEO_MAX_DOWNLOAD_BYTES:
                            raise SafeTaskError("video provider output too large", code="provider_output_too_large", retryable=False)
                        stream.write(chunk)
                        progress(VIDEO_DOWNLOAD_PROGRESS)
            else:
                stream.write(bytes(getattr(response, "content", b"")))
    except requests.RequestException as exc:
        output_path.unlink(missing_ok=True)
        raise SafeTaskError("video content download failed", code="provider_request_failed", retryable=True) from None
    except Exception:
        output_path.unlink(missing_ok=True)
        raise
    finally:
        close = getattr(response, "close", None)
        if callable(close):
            close()
    if not output_path.exists() or output_path.stat().st_size == 0:
        output_path.unlink(missing_ok=True)
        raise SafeTaskError("video provider returned empty content", code="provider_empty_output", retryable=False)
    return {
        "path": str(output_path),
        "content_type": content_type,
        "size": output_path.stat().st_size,
        "file_name": output_path.name,
    }


def download_completed_video(
    job_id: str,
    task_id: str,
    task: dict[str, Any],
    provider: dict[str, Any],
    base_url: str,
    headers: dict[str, str],
    timeout: float,
    settings: Settings,
    progress: ProgressFn,
) -> dict[str, Any]:
    for attempt in range(VIDEO_DOWNLOAD_ATTEMPTS):
        try:
            return download_video_result(job_id, task_id, task, provider, base_url, headers, timeout, settings, progress)
        except SafeTaskError as exc:
            if exc.code not in {"provider_request_failed", "provider_rate_limited", "provider_temporary_failure"} or attempt + 1 >= VIDEO_DOWNLOAD_ATTEMPTS:
                raise
            # Check local cancellation while waiting to retry only this GET.
            progress(VIDEO_DOWNLOAD_PROGRESS)
            time.sleep(VIDEO_DOWNLOAD_RETRY_SECONDS)
    raise AssertionError("unreachable download retry state")


def video_request_parts(
    payload: dict[str, Any],
    provider: dict[str, Any],
    settings: Settings,
) -> list[tuple[str, tuple[str | None, Any, str | None]]]:
    parts: list[tuple[str, tuple[str | None, Any, str | None]]] = []
    for key in VIDEO_REQUEST_FIELDS:
        value = provider.get("model") if key == "model" else payload.get(key)
        if value not in (None, ""):
            parts.append((key, (None, str(value), None)))

    raw_files = payload.get("files")
    try:
        for index, item in enumerate(raw_files if isinstance(raw_files, list) else []):
            if not isinstance(item, dict):
                continue
            field_name = str(item.get("field_name") or "input_reference[]").strip() or "input_reference[]"
            filename = str(item.get("filename") or f"reference_{index}").strip() or f"reference_{index}"
            content_type = str(item.get("content_type") or "application/octet-stream").strip() or "application/octet-stream"
            parts.append((field_name, (filename, open_staged_input(item, payload, settings), content_type)))
    except Exception:
        close_multipart_files(parts)
        raise
    return parts


def ensure_video_response(response: requests.Response, operation: str, *, retryable: bool = True) -> None:
    if response.status_code == 429:
        raise SafeTaskError(
            provider_error_message(f"{operation} rate limited", response),
            code="provider_rate_limited",
            retryable=retryable,
            retry_after_seconds=provider_retry_after_seconds(response),
        )
    if response.status_code >= 500:
        raise SafeTaskError(provider_error_message(f"{operation} failed", response), code="provider_temporary_failure", retryable=retryable)
    if response.status_code >= 400:
        raise SafeTaskError(provider_error_message(f"{operation} rejected", response), code="provider_bad_request", retryable=False)


def video_response_json(response: requests.Response, message: str) -> dict[str, Any]:
    try:
        value = response.json()
    except ValueError as exc:
        raise SafeTaskError(message, code="provider_invalid_json", retryable=False) from exc
    if not isinstance(value, dict):
        raise SafeTaskError(message, code="provider_invalid_json", retryable=False)
    return value


def video_task_id(task: dict[str, Any]) -> str:
    for container in video_task_containers(task):
        for key in ("id", "task_id", "taskId"):
            value = container.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return ""


def video_status(task: dict[str, Any]) -> str:
    for container in video_task_containers(task):
        for key in ("status", "state", "task_status"):
            value = container.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip().lower()
    if any(container.get("error") or container.get("error_message") or container.get("code") not in (None, "", 0, "0", "Success") for container in video_task_containers(task)):
        return "failed"
    return "queued"


def video_progress(task: dict[str, Any]) -> int:
    for container in video_task_containers(task):
        value = container.get("progress")
        try:
            remote = max(0.0, min(100.0, float(value)))
            return round(VIDEO_POLL_PROGRESS_MIN + remote * (VIDEO_POLL_PROGRESS_MAX - VIDEO_POLL_PROGRESS_MIN) / 100)
        except (TypeError, ValueError):
            continue
    return VIDEO_POLL_PROGRESS_MIN


def video_task_containers(task: dict[str, Any]) -> list[dict[str, Any]]:
    containers = [task]
    for key in ("data", "output", "result", "task"):
        value = task.get(key)
        if isinstance(value, dict):
            containers.append(value)
    return containers


def video_task_error(task: dict[str, Any], status: str) -> str:
    for container in video_task_containers(task):
        error = container.get("error")
        if isinstance(error, dict):
            for key in ("message", "detail", "code"):
                value = error.get(key)
                if isinstance(value, str) and value.strip():
                    return safe_message(value)
        for key in ("message", "detail", "error_message"):
            value = container.get(key)
            if isinstance(value, str) and value.strip():
                return safe_message(value)
    return f"video provider task {status}"


def video_endpoint(provider: dict[str, Any], key: str, fallback: str, task_id: str) -> str:
    overrides = provider.get("endpoint_overrides")
    template = str(overrides.get(key) or fallback) if isinstance(overrides, dict) else fallback
    escaped_id = quote(task_id, safe="")
    if "{id}" not in template and "{task_id}" not in template:
        return template.rstrip("/") + "/" + escaped_id
    return template.replace("{id}", escaped_id).replace("{task_id}", escaped_id).lstrip("/")


def video_request_timeout(provider: dict[str, Any], settings: Settings) -> float:
    try:
        configured = float(provider.get("timeout_ms") or 0) / 1000
    except (TypeError, ValueError):
        configured = 0
    if configured <= 0:
        configured = VIDEO_REQUEST_TIMEOUT_SECONDS
    return max(configured, VIDEO_REQUEST_TIMEOUT_SECONDS)


def native_video_url(task: Any, depth: int = 0) -> str:
    if depth >= NATIVE_VIDEO_RESPONSE_MAX_DEPTH:
        return ""
    if isinstance(task, list):
        for item in task:
            value = native_video_url(item, depth + 1)
            if value:
                return value
    if isinstance(task, dict):
        content = native_video_url(task.get("content"), depth + 1)
        if content:
            return content
        for key in ("video_url", "videoUrl", "output_url", "outputUrl", "download_url", "downloadUrl", "url"):
            value = task.get(key)
            if isinstance(value, str) and urlparse(value.strip()).scheme in {"http", "https"}:
                return value.strip()
        for key in ("data", "result", "results", "output", "outputs", "items"):
            value = native_video_url(task.get(key), depth + 1)
            if value:
                return value
    return ""


def video_content_type(task: dict[str, Any]) -> str:
    for container in video_task_containers(task):
        for key in ("content_type", "mime_type", "mimeType"):
            value = container.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return ""


def video_extension(content_type: str) -> str:
    return {
        "video/webm": "webm",
        "video/quicktime": "mov",
        "video/x-matroska": "mkv",
    }.get(content_type, "mp4")


def cancel_provider_video_task(task_id: str, provider: dict[str, Any], base_url: str, headers: dict[str, str], timeout: float) -> None:
    if provider.get("video_protocol") == "zizi_h3":
        # This API does not document cancellation; never POST to a guessed path.
        return
    timeout = min(timeout, VIDEO_CANCEL_TIMEOUT_SECONDS)
    endpoint = video_endpoint(provider, "video_cancel", "videos/{id}/cancel", task_id)
    url = provider_request_url(base_url, endpoint, provider)
    try:
        if provider.get("video_protocol") == "seedance" and not (provider.get("endpoint_overrides") or {}).get("video_cancel"):
            endpoint = video_endpoint(provider, "video_get", "contents/generations/tasks/{id}", task_id)
            response = provider_request("DELETE", provider_request_url(base_url, endpoint, provider), headers=headers, timeout=timeout)
        else:
            response = provider_request("POST", url, headers=headers, timeout=timeout)
        response.close()
    except (requests.RequestException, HTTPPolicyError):
        return


def transcode_video(job_id: str, payload: dict[str, Any], settings: Settings, progress: ProgressFn) -> dict[str, Any]:
    input_path = video_input_path(payload, settings)

    output_format = str(payload.get("output_format") or "mp4").strip().lstrip(".") or "mp4"
    output_dir = resolve_output_dir(payload.get("output_dir"), job_id, settings)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"transcoded.{output_format}"

    video_codec = str(payload.get("video_codec") or "libx264")
    audio_codec = str(payload.get("audio_codec") or "aac")
    preset = str(payload.get("preset") or "veryfast")

    cmd = [
        settings.ffmpeg_bin,
        "-y",
        "-i",
        str(input_path),
        "-c:v",
        video_codec,
        "-preset",
        preset,
        "-c:a",
        audio_codec,
        str(output_path),
    ]
    progress(30)
    try:
        completed = subprocess.run(
            cmd,
            check=False,
            capture_output=True,
            text=True,
            timeout=settings.job_default_timeout_seconds,
        )
    except FileNotFoundError as exc:
        raise SafeTaskError("ffmpeg binary is not available", code="ffmpeg_not_found", retryable=False) from exc
    except subprocess.TimeoutExpired as exc:
        raise SafeTaskError("ffmpeg transcode timed out", code="ffmpeg_timeout", retryable=True) from exc

    if completed.returncode != 0:
        detail = safe_message(completed.stderr or completed.stdout or "ffmpeg transcode failed")
        raise SafeTaskError(detail, code="ffmpeg_failed", retryable=False)

    progress(95)
    content_type = mimetypes.guess_type(output_path.name)[0] or "application/octet-stream"
    return {
        "mode": "ffmpeg",
        "operation": "transcode",
        "input_path": str(input_path),
        "outputs": [
            {
                "path": str(output_path),
                "content_type": content_type,
                "size": output_path.stat().st_size,
            }
        ],
    }


def video_input_path(payload: dict[str, Any], settings: Settings) -> Path:
    storage_key = str(payload.get(INPUT_STORAGE_KEY_FIELD) or "").strip()
    raw_files = payload.get("files")
    if storage_key or isinstance(raw_files, list):
        if not isinstance(raw_files, list):
            raise SafeTaskError("video staged input metadata is required", code="invalid_staged_input", retryable=False)
        for item in raw_files:
            if not isinstance(item, dict):
                continue
            item_storage_key = str(item.get("storage_key") or "").strip()
            if item_storage_key and (not storage_key or item_storage_key == storage_key):
                return validate_staged_input(item, payload, settings)
        if storage_key:
            raise SafeTaskError("video staged input metadata was not found", code="invalid_staged_input", retryable=False)

    source = str(payload.get("input_path") or payload.get("source_path") or "").strip()
    return resolve_legacy_asset_path(source, settings)
