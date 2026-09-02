from __future__ import annotations

import base64
import binascii
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import json
import re
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse

import requests

from .config import Settings
from .errors import SafeTaskError, safe_message
from .staged_inputs import JOB_WORKSPACE_FIELD, INPUT_STORAGE_KEY_FIELD, STAGED_INPUT_KEYS_FIELD, open_staged_input


ProgressFn = Callable[[int], None]

# Cap upstream error excerpts stored in job.error so failures stay actionable
# without leaking full provider payloads.
MAX_PROVIDER_ERROR_DETAIL_CHARS = 240
UPLOAD_PAYLOAD_KEYS = {
    "files",
    "references",
    "provider",
    "asset_registration",
    STAGED_INPUT_KEYS_FIELD,
    INPUT_STORAGE_KEY_FIELD,
    JOB_WORKSPACE_FIELD,
}
GPT_IMAGE_2_EDIT_UNSUPPORTED_FIELDS = {"output_format", "response_format", "n"}
URL_PATTERN = re.compile(r"https?://[^\s\"'<>]+", re.IGNORECASE)
MARKDOWN_IMAGE_PATTERN = re.compile(r"!\[[^\]]*\]\((data:image/[^)]+|https?://[^)]+)\)", re.IGNORECASE)

# 1x1 PNG used for deterministic mock smoke runs.
MOCK_PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
)


def generate_image(job_id: str, payload: dict[str, Any], settings: Settings, progress: ProgressFn) -> dict[str, Any]:
    progress(15)
    if truthy(payload.get("force_error")) or truthy(payload.get("mock_error")):
        raise SafeTaskError("mock image provider failure", code="mock_provider_failure", retryable=True)

    provider = payload.get("provider")
    if provider_has_remote(provider):
        return call_openai_compatible_image(job_id, payload, provider, settings, progress, operation="generate")

    return write_mock_image(job_id, payload, settings, progress, operation="generate")


def edit_image(job_id: str, payload: dict[str, Any], settings: Settings, progress: ProgressFn) -> dict[str, Any]:
    progress(15)
    if truthy(payload.get("force_error")) or truthy(payload.get("mock_error")):
        raise SafeTaskError("mock image edit failure", code="mock_provider_failure", retryable=True)

    provider = payload.get("provider")
    if provider_has_remote(provider):
        return call_openai_compatible_image(job_id, payload, provider, settings, progress, operation="edit")

    return write_mock_image(job_id, payload, settings, progress, operation="edit")


def write_mock_image(
    job_id: str,
    payload: dict[str, Any],
    settings: Settings,
    progress: ProgressFn,
    operation: str,
) -> dict[str, Any]:
    progress(45)
    output_dir = ensure_job_dir(settings.asset_storage_dir, job_id)
    output_path = output_dir / f"{operation}.png"
    output_path.write_bytes(MOCK_PNG_BYTES)
    progress(90)
    return {
        "mode": "mock",
        "operation": operation,
        "prompt": str(payload.get("prompt", ""))[:500],
        "outputs": [
            {
                "path": str(output_path),
                "content_type": "image/png",
                "size": output_path.stat().st_size,
            }
        ],
    }


def call_openai_compatible_image(
    job_id: str,
    payload: dict[str, Any],
    provider: dict[str, Any],
    settings: Settings,
    progress: ProgressFn,
    operation: str,
) -> dict[str, Any]:
    base_url = str(provider.get("base_url", "")).rstrip("/") + "/"
    protocol = resolve_image_protocol(provider)
    endpoint = str(provider.get("endpoint") or default_image_endpoint(protocol, operation, provider, payload))
    url = provider_request_url(base_url, endpoint, provider)
    headers = provider_auth_headers(provider)
    progress(35)
    upload_files: list[tuple[str, tuple[str, Any, str]]] | None = None
    try:
        timeout_ms = int(provider.get("timeout_ms") or 300000)
        timeout_seconds = float(provider.get("timeout_seconds") or timeout_ms / 1000)
        if protocol == "gemini_generate_content":
            response = requests.post(
                url,
                headers={**headers, "Content-Type": "application/json"},
                json=gemini_image_generation_body(payload, provider, settings),
                timeout=timeout_seconds,
            )
        elif protocol == "openai_responses":
            response = requests.post(
                url,
                headers={**headers, "Content-Type": "application/json"},
                json=openai_responses_image_body(payload, provider, settings),
                timeout=timeout_seconds,
            )
        elif protocol == "openai_chat_completions":
            response = requests.post(
                url,
                headers={**headers, "Content-Type": "application/json"},
                json=openai_chat_image_body(payload, provider, settings),
                timeout=timeout_seconds,
            )
        elif protocol == "dashscope_multimodal":
            response = requests.post(
                url,
                headers={**headers, "Content-Type": "application/json"},
                json=dashscope_multimodal_image_body(payload, provider, settings),
                timeout=timeout_seconds,
            )
        elif protocol == "stability_image":
            upload_files = stability_image_files(payload, settings, operation)
            response = requests.post(
                url,
                headers={**headers, "Accept": "image/*"},
                data=stability_image_fields(payload, provider, operation),
                files=upload_files or {"none": ""},
                timeout=timeout_seconds,
            )
        elif operation == "edit":
            upload_files = multipart_files_for_image_edit(payload, settings)
            response = requests.post(
                url,
                headers=headers,
                data=multipart_fields_for_image_edit(payload, provider),
                files=upload_files,
                timeout=timeout_seconds,
            )
        else:
            response = requests.post(
                url,
                headers={**headers, "Content-Type": "application/json"},
                json=image_generation_body(payload, provider),
                timeout=timeout_seconds,
            )
    except requests.RequestException as exc:
        raise SafeTaskError("image provider request failed", code="provider_request_failed", retryable=True) from exc
    finally:
        close_multipart_files(upload_files)

    if response.status_code == 429:
        raise SafeTaskError(
            provider_error_message("image provider concurrency or rate limit exceeded", response),
            code="provider_rate_limited",
            retryable=True,
            retry_after_seconds=provider_retry_after_seconds(response),
        )
    if response.status_code >= 500:
        raise SafeTaskError(
            provider_error_message("image provider temporary failure", response),
            code="provider_temporary_failure",
            retryable=True,
        )
    if response.status_code >= 400:
        raise SafeTaskError(
            provider_error_message("image provider rejected request", response),
            code="provider_bad_request",
            retryable=False,
        )

    progress(75)
    content_type = str(response.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
    if content_type.startswith("image/"):
        outputs = persist_binary_image_output(job_id, bytes(getattr(response, "content", b"")), content_type, settings)
    else:
        try:
            data = response.json()
        except ValueError as exc:
            raise SafeTaskError("image provider returned invalid JSON", code="provider_invalid_json", retryable=True) from exc
        outputs = persist_provider_outputs(job_id, data, settings)
    progress(90)
    return {
        "mode": "openai_compatible" if protocol == "openai_images" else protocol,
        "protocol": protocol,
        "operation": operation,
        "provider_status": response.status_code,
        "outputs": outputs,
    }


def resolve_image_protocol(provider: dict[str, Any]) -> str:
    configured = str(provider.get("protocol") or "").strip().lower()
    supported = {
        "openai_images",
        "openai_responses",
        "openai_chat_completions",
        "gemini_generate_content",
        "dashscope_multimodal",
        "stability_image",
    }
    if configured in supported:
        return configured
    provider_type = str(provider.get("provider_type") or "").strip().lower()
    base_url = str(provider.get("base_url") or "").strip().lower()
    model_id = str(provider.get("model") or "").strip().lower()
    endpoint = str(provider.get("endpoint") or "").strip().lower()
    if "chat/completions" in endpoint:
        return "openai_chat_completions"
    if endpoint.rstrip("/").endswith("responses"):
        return "openai_responses"
    if provider_type == "gemini_media" or "generativelanguage.googleapis.com" in base_url:
        return "gemini_generate_content"
    if "dashscope.aliyuncs.com" in base_url or "dashscope-intl.aliyuncs.com" in base_url:
        return "dashscope_multimodal"
    if "api.stability.ai" in base_url:
        return "stability_image"
    if "gemini" in model_id or "banana" in model_id:
        return "openai_chat_completions"
    if model_id.startswith(("gpt-4", "gpt-5", "o3", "o4")) and "image" not in model_id:
        return "openai_responses"
    return "openai_images"


def default_image_endpoint(protocol: str, operation: str, provider: dict[str, Any], payload: dict[str, Any]) -> str:
    if protocol == "openai_responses":
        return "v1/responses"
    if protocol == "openai_chat_completions":
        return "v1/chat/completions"
    if protocol == "gemini_generate_content":
        model_id = str(provider.get("model") or payload.get("model") or "").strip().removeprefix("models/")
        return f"v1beta/models/{model_id}:generateContent"
    if protocol == "dashscope_multimodal":
        return "api/v1/services/aigc/multimodal-generation/generation"
    if protocol == "stability_image":
        return "v2beta/stable-image/generate/sd3"
    return "v1/images/edits" if operation == "edit" else "v1/images/generations"

def provider_auth_headers(provider: dict[str, Any]) -> dict[str, str]:
    auth_type = str(provider.get("auth_type") or "bearer").lower()
    api_key = str(provider.get("api_key") or "")
    headers: dict[str, str] = normalized_string_map(provider.get("extra_headers"))
    if auth_type in {"bearer", "auto_api_key"}:
        headers["Authorization"] = f"Bearer {api_key}"
    elif auth_type == "x_api_key":
        headers["X-API-Key"] = api_key
    elif auth_type == "x_goog_api_key":
        headers["x-goog-api-key"] = api_key
    elif auth_type == "custom_header":
        header = str(provider.get("custom_auth_header") or "").strip()
        if header:
            headers[header] = api_key
    return headers


def provider_has_remote(provider: Any) -> bool:
    if not isinstance(provider, dict):
        return False
    if not str(provider.get("base_url") or "").strip():
        return False
    auth_type = str(provider.get("auth_type") or "bearer").lower()
    return auth_type == "none" or bool(str(provider.get("api_key") or "").strip())


def provider_request_url(base_url: str, endpoint: str, provider: dict[str, Any]) -> str:
    url = urljoin(base_url, endpoint)
    auth_type = str(provider.get("auth_type") or "").lower()
    api_key = str(provider.get("api_key") or "")
    if auth_type != "query_param" or not api_key:
        return url
    query_name = str(provider.get("auth_query_param") or "key").strip() or "key"
    parsed = urlparse(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query[query_name] = api_key
    return urlunparse(parsed._replace(query=urlencode(query)))


def normalized_string_map(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    result: dict[str, str] = {}
    for key, item in value.items():
        key = str(key).strip()
        item = str(item).strip()
        if key and item:
            result[key] = item
    return result


def gemini_image_url(base_url: str, model: str) -> str:
    model = model.strip().removeprefix("models/")
    normalized = base_url.rstrip("/") + "/"
    if not normalized.rstrip("/").lower().endswith(("/v1", "/v1beta")):
        normalized = urljoin(normalized, "v1beta/")
    return urljoin(normalized, f"models/{model}:generateContent")


def gemini_image_generation_body(payload: dict[str, Any], provider: dict[str, Any], settings: Settings) -> dict[str, Any]:
    parts: list[dict[str, Any]] = [{"text": str(payload.get("prompt") or "")}]
    for data_url, content_type in image_input_data_urls(payload, settings):
        parts.append({"inlineData": {"mimeType": content_type, "data": strip_data_url_prefix(data_url)}})
    return {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]},
    }


def openai_responses_image_body(payload: dict[str, Any], provider: dict[str, Any], settings: Settings) -> dict[str, Any]:
    content: list[dict[str, Any]] = [{"type": "input_text", "text": str(payload.get("prompt") or "")}]
    content.extend({"type": "input_image", "image_url": data_url} for data_url, _ in image_input_data_urls(payload, settings))
    tool: dict[str, Any] = {"type": "image_generation"}
    for key in ("size", "quality", "output_format"):
        value = payload.get(key)
        if value not in (None, "", "auto"):
            tool[key] = value
    return {
        "model": provider.get("model") or payload.get("model"),
        "input": [{"role": "user", "content": content}],
        "tools": [tool],
        "tool_choice": {"type": "image_generation"},
        "stream": False,
    }


def openai_chat_image_body(payload: dict[str, Any], provider: dict[str, Any], settings: Settings) -> dict[str, Any]:
    content: list[dict[str, Any]] = [{"type": "text", "text": str(payload.get("prompt") or "")}]
    content.extend({"type": "image_url", "image_url": {"url": data_url}} for data_url, _ in image_input_data_urls(payload, settings))
    return {
        "model": provider.get("model") or payload.get("model"),
        "messages": [{"role": "user", "content": content}],
        "stream": False,
    }


def dashscope_multimodal_image_body(payload: dict[str, Any], provider: dict[str, Any], settings: Settings) -> dict[str, Any]:
    content: list[dict[str, Any]] = [{"text": str(payload.get("prompt") or "")}]
    content.extend({"image": data_url} for data_url, _ in image_input_data_urls(payload, settings))
    parameters: dict[str, Any] = {"result_format": "message"}
    if payload.get("size") not in (None, "", "auto"):
        parameters["size"] = payload.get("size")
    return {
        "model": provider.get("model") or payload.get("model"),
        "input": {"messages": [{"role": "user", "content": content}]},
        "parameters": parameters,
    }


def stability_image_fields(payload: dict[str, Any], provider: dict[str, Any], operation: str) -> dict[str, str]:
    fields = {
        "prompt": str(payload.get("prompt") or ""),
        "model": str(provider.get("model") or payload.get("model") or ""),
        "output_format": str(payload.get("output_format") or "png").removeprefix("image/"),
    }
    if operation == "edit":
        fields["mode"] = "image-to-image"
        fields["strength"] = str(payload.get("strength") or "0.65")
    if payload.get("seed") not in (None, ""):
        fields["seed"] = str(payload.get("seed"))
    return {key: value for key, value in fields.items() if value}


def stability_image_files(payload: dict[str, Any], settings: Settings, operation: str) -> list[tuple[str, tuple[str, Any, str]]]:
    if operation != "edit":
        return []
    files = multipart_files_for_image_edit(payload, settings)
    return [("image", item) for _, item in files[:1]]


def image_input_data_urls(payload: dict[str, Any], settings: Settings) -> list[tuple[str, str]]:
    raw_files = payload.get("files")
    if not isinstance(raw_files, list):
        return []
    images: list[tuple[str, str]] = []
    for item in raw_files:
        if not isinstance(item, dict):
            continue
        content_type = str(item.get("content_type") or "image/png").strip() or "image/png"
        stream: Any | None = None
        try:
            if str(item.get("storage_key") or "").strip():
                stream = open_staged_input(item, payload, settings)
                raw = stream.read()
            else:
                raw = decode_upload_b64(item.get("b64_json"))
        finally:
            close = getattr(stream, "close", None)
            if callable(close):
                close()
        images.append((f"data:{content_type};base64,{base64.b64encode(raw).decode('ascii')}", content_type))
    return images

def image_generation_body(payload: dict[str, Any], provider: dict[str, Any]) -> dict[str, Any]:
    body = {
        "model": provider.get("model") or payload.get("model"),
        "prompt": payload.get("prompt", ""),
        "size": payload.get("size", "1024x1024"),
        "n": int(payload.get("n") or 1),
    }
    return {key: value for key, value in body.items() if value not in (None, "")}


def multipart_fields_for_image_edit(payload: dict[str, Any], provider: dict[str, Any]) -> dict[str, str]:
    model = str(provider.get("model") or payload.get("model") or "").strip()
    strict_gpt_image_2 = is_gpt_image_2_model(model)
    fields: dict[str, str] = {}
    ordered_fields = ["model", "prompt", "size", "quality", "style", "response_format", "n"]

    for key in ordered_fields:
        if strict_gpt_image_2 and should_omit_gpt_image_2_edit_field(key):
            continue
        value = model if key == "model" else payload.get(key)
        if key == "n" and value in (None, "", 0, "0"):
            continue
        set_multipart_field(fields, key, value)

    for key, value in payload.items():
        if key in UPLOAD_PAYLOAD_KEYS or key in ordered_fields:
            continue
        if strict_gpt_image_2 and should_omit_gpt_image_2_edit_field(key):
            continue
        set_multipart_field(fields, key, value)

    return fields


def set_multipart_field(fields: dict[str, str], key: str, value: Any) -> None:
    key = str(key).strip()
    if not key or value in (None, ""):
        return
    if isinstance(value, (str, int, float, bool)):
        normalized = str(value).strip()
        if normalized:
            fields[key] = normalized


def multipart_files_for_image_edit(payload: dict[str, Any], settings: Settings) -> list[tuple[str, tuple[str, Any, str]]]:
    raw_files = payload.get("files")
    if not isinstance(raw_files, list) or not raw_files:
        raise SafeTaskError("image edit requires at least one uploaded image", code="invalid_job_payload", retryable=False)

    files: list[tuple[str, tuple[str, Any, str]]] = []
    try:
        for index, item in enumerate(raw_files):
            if not isinstance(item, dict):
                continue
            field_name = str(item.get("field_name") or "image").strip() or "image"
            filename = str(item.get("filename") or f"image_{index}.png").strip() or f"image_{index}.png"
            content_type = str(item.get("content_type") or "application/octet-stream").strip() or "application/octet-stream"
            if str(item.get("storage_key") or "").strip():
                data: Any = open_staged_input(item, payload, settings)
            else:
                data = decode_upload_b64(item.get("b64_json"))
            files.append((field_name, (filename, data, content_type)))
    except Exception:
        close_multipart_files(files)
        raise

    if not files:
        raise SafeTaskError("image edit payload did not contain valid image files", code="invalid_job_payload", retryable=False)
    return files


def close_multipart_files(files: list[tuple[str, tuple[str, Any, str]]] | None) -> None:
    for _, (_, value, _) in files or []:
        close = getattr(value, "close", None)
        if callable(close):
            close()


def decode_upload_b64(value: Any) -> bytes:
    if not isinstance(value, str) or not value.strip():
        raise SafeTaskError("image edit upload is missing b64_json", code="invalid_job_payload", retryable=False)
    raw = value.strip()
    if "," in raw and raw.lower().startswith("data:"):
        raw = raw.split(",", 1)[1]
    try:
        return base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise SafeTaskError("image edit upload b64_json is invalid", code="invalid_job_payload", retryable=False) from exc


def is_gpt_image_2_model(model_id: str) -> bool:
    raw = model_id.strip().lower()
    normalized = normalize_model_token(raw)
    compact = normalized.replace("-", "")
    return (
        normalized == "gpt-image-2"
        or normalized.startswith("gpt-image-2-")
        or normalized.endswith("-gpt-image-2")
        or "-gpt-image-2-" in normalized
        or compact == "gptimage2"
        or compact.startswith("gptimage2")
        or compact.endswith("gptimage2")
    )


def normalize_model_token(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value)
    return normalized.strip("-")


def should_omit_gpt_image_2_edit_field(key: str) -> bool:
    return str(key).strip().lower() in GPT_IMAGE_2_EDIT_UNSUPPORTED_FIELDS


def provider_error_message(prefix: str, response: requests.Response) -> str:
    detail = provider_error_detail(response)
    if not detail:
        return f"{prefix} (status {response.status_code})"
    return f"{prefix} (status {response.status_code}): {detail}"


def provider_retry_after_seconds(response: requests.Response) -> int:
    raw = str(response.headers.get("Retry-After") or "").strip()
    if raw:
        try:
            return max(1, min(300, int(float(raw))))
        except ValueError:
            try:
                retry_at = parsedate_to_datetime(raw)
                if retry_at.tzinfo is None:
                    retry_at = retry_at.replace(tzinfo=timezone.utc)
                seconds = int((retry_at - datetime.now(timezone.utc)).total_seconds())
                return max(1, min(300, seconds))
            except (TypeError, ValueError, OverflowError):
                pass
    return 2


def provider_error_detail(response: requests.Response) -> str:
    text = ""
    try:
        data = response.json()
    except ValueError:
        text = response.text or ""
    else:
        text = extract_provider_error_text(data)
    text = safe_message(text)
    text = URL_PATTERN.sub("[url]", text)
    return text[:MAX_PROVIDER_ERROR_DETAIL_CHARS].strip()


def extract_provider_error_text(data: Any) -> str:
    if isinstance(data, dict):
        error = data.get("error")
        if isinstance(error, dict):
            for key in ("message", "detail", "code"):
                value = error.get(key)
                if isinstance(value, str) and value.strip():
                    return value
        for key in ("message", "detail", "msg", "error"):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                return value
    try:
        return json.dumps(data, ensure_ascii=True)
    except (TypeError, ValueError):
        return str(data)


def persist_provider_outputs(job_id: str, data: dict[str, Any], settings: Settings) -> list[dict[str, Any]]:
    output_dir = ensure_job_dir(settings.asset_storage_dir, job_id)
    outputs: list[dict[str, Any]] = []
    for index, item in enumerate(extract_image_items(data)):
        if not isinstance(item, dict):
            continue
        b64_value = first_string(item, "b64_json", "base64", "image_base64", "data")
        url_value = first_string(item, "url", "image_url", "output_url", "result_url", "download_url", "fileUri", "file_uri")
        mime_type = first_string(item, "mime_type", "mimeType", "content_type") or data_url_mime_type(b64_value or url_value) or "image/png"
        if b64_value:
            outputs.append(write_base64_image_output(output_dir, index, b64_value, mime_type))
        elif url_value.lower().startswith("data:image/"):
            outputs.append(write_base64_image_output(output_dir, index, url_value, mime_type))
        elif url_value:
            outputs.append({"remote_url": url_value})
    if not outputs:
        raise SafeTaskError("image provider returned no outputs", code="provider_empty_output", retryable=True)
    return outputs


def persist_binary_image_output(job_id: str, content: bytes, content_type: str, settings: Settings) -> list[dict[str, Any]]:
    if not content:
        raise SafeTaskError("image provider returned an empty image", code="provider_empty_output", retryable=True)
    output_dir = ensure_job_dir(settings.asset_storage_dir, job_id)
    extension = image_extension(content_type)
    output_path = output_dir / f"provider_0.{extension}"
    output_path.write_bytes(content)
    return [{"path": str(output_path), "content_type": content_type or "image/png", "size": output_path.stat().st_size}]


def write_base64_image_output(output_dir: Path, index: int, value: str, content_type: str) -> dict[str, Any]:
    try:
        content = base64.b64decode(strip_data_url_prefix(value), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise SafeTaskError("image provider returned invalid base64", code="provider_invalid_output", retryable=True) from exc
    output_path = output_dir / f"provider_{index}.{image_extension(content_type)}"
    output_path.write_bytes(content)
    return {"path": str(output_path), "content_type": content_type or "image/png", "size": output_path.stat().st_size}


def extract_image_items(value: Any, depth: int = 0) -> list[dict[str, Any]]:
    if depth > 8 or value is None:
        return []
    if isinstance(value, str):
        text = value.strip()
        if text.lower().startswith("data:image/"):
            return [{"b64_json": text, "mime_type": data_url_mime_type(text)}]
        markdown_items = [{"url": match.group(1).strip()} for match in MARKDOWN_IMAGE_PATTERN.finditer(text)]
        if markdown_items:
            return markdown_items
        if text.lower().startswith(("http://", "https://")) and not any(character.isspace() for character in text):
            return [{"url": text}]
        return []
    if isinstance(value, list):
        items: list[dict[str, Any]] = []
        for item in value:
            items.extend(extract_image_items(item, depth + 1))
        return items
    if not isinstance(value, dict):
        return []

    if str(value.get("type") or "").lower() == "image_generation_call" and isinstance(value.get("result"), str):
        return [{"b64_json": value.get("result"), "mime_type": value.get("mime_type") or value.get("mimeType") or "image/png"}]

    inline_data = value.get("inlineData") or value.get("inline_data")
    if isinstance(inline_data, dict) and inline_data.get("data"):
        return [{"b64_json": inline_data.get("data"), "mime_type": inline_data.get("mimeType") or inline_data.get("mime_type")}]

    file_data = value.get("fileData") or value.get("file_data")
    if isinstance(file_data, dict) and (file_data.get("fileUri") or file_data.get("file_uri")):
        return [{"url": file_data.get("fileUri") or file_data.get("file_uri")}]

    image_url = value.get("image_url") or value.get("imageUrl")
    if isinstance(image_url, dict) and isinstance(image_url.get("url"), str):
        return [{"url": image_url.get("url")}]

    if first_string(value, "b64_json", "base64", "image_base64", "url", "image_url", "output_url", "result_url", "download_url"):
        return [value]

    items: list[dict[str, Any]] = []
    for key in ("data", "images", "image", "output", "outputs", "result", "results", "items", "files", "candidates", "content", "parts", "choices", "message"):
        if key in value:
            items.extend(extract_image_items(value[key], depth + 1))
    return items


def data_url_mime_type(value: str) -> str:
    match = re.match(r"^data:([^;,]+)", str(value or ""), re.IGNORECASE)
    return match.group(1).lower() if match else ""


def image_extension(content_type: str) -> str:
    normalized = str(content_type or "").split(";", 1)[0].strip().lower()
    return {"image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif"}.get(normalized, "png")

def first_string(value: dict[str, Any], *keys: str) -> str:
    for key in keys:
        item = value.get(key)
        if isinstance(item, str) and item.strip():
            return item.strip()
    return ""


def strip_data_url_prefix(value: str) -> str:
    value = value.strip()
    if value.lower().startswith("data:") and "," in value:
        return value.split(",", 1)[1]
    return value


def ensure_job_dir(root: Path, job_id: str) -> Path:
    path = root / "jobs" / job_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)
