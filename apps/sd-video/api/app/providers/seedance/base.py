from __future__ import annotations

import re
from abc import ABC, abstractmethod
from collections.abc import Mapping
from typing import Any

import httpx


LEGACY_PROXY = "legacy_proxy"
TOKENSPACE = "tokenspace"


class SeedanceProviderError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        error_code: str = "",
        http_status: int = 0,
        request_id: str = "",
    ) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.http_status = http_status
        self.request_id = request_id


class SeedanceProviderGatewayError(SeedanceProviderError):
    pass


class SeedanceOperationNotSupported(SeedanceProviderError):
    pass


def _mapping(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, Mapping) else {}


def first_string(raw: Mapping[str, Any], *keys: str) -> str:
    for key in keys:
        value = raw.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    for container_key in ("Result", "result", "Data", "data"):
        nested = _mapping(raw.get(container_key))
        if nested:
            value = first_string(nested, *keys)
            if value:
                return value
    return ""


def request_id_from(raw: Mapping[str, Any], headers: Mapping[str, str] | None = None) -> str:
    request_id = first_string(raw, "request_id", "RequestId", "RequestID", "requestId")
    if not request_id:
        metadata = _mapping(raw.get("ResponseMetadata")) or _mapping(raw.get("response_metadata"))
        request_id = first_string(metadata, "request_id", "RequestId", "RequestID", "requestId")
    if request_id or not headers:
        return request_id
    for key in ("x-request-id", "x-oneapi-request-id", "x-tt-logid", "x-log-id"):
        value = headers.get(key) or headers.get(key.title())
        if value:
            return value.strip()
    return ""


def normalize_status(value: str) -> str:
    normalized = (value or "").strip().lower()
    aliases = {
        "pending": "queued",
        "processing": "running",
        "completed": "succeeded",
        "complete": "succeeded",
        "success": "succeeded",
        "error": "failed",
    }
    return aliases.get(normalized, normalized or "running")


def redact_urls(value: str) -> str:
    return re.sub(r"https?://[^\s\"'<>]+", "[url]", value or "")


def normalize_video_task(raw: Mapping[str, Any], headers: Mapping[str, str] | None = None) -> dict[str, Any]:
    result = dict(raw)
    content = _mapping(raw.get("content")) or _mapping(raw.get("Content"))
    video_url = first_string(content, "video_url", "VideoURL", "VideoUrl", "url", "URL")
    if not video_url:
        video_url = first_string(raw, "video_url", "VideoURL", "VideoUrl", "url", "URL")
    error = _mapping(raw.get("error")) or _mapping(raw.get("Error"))

    result["id"] = first_string(raw, "id", "Id", "task_id", "TaskId", "TaskID")
    result["status"] = normalize_status(first_string(raw, "status", "Status", "state", "State"))
    result["content"] = {**content, "video_url": video_url}
    result["error_code"] = first_string(error, "code", "Code") or first_string(raw, "error_code", "ErrorCode")
    result["error_message"] = (
        first_string(error, "message", "Message", "detail", "Detail")
        or first_string(raw, "error_message", "ErrorMessage", "message", "Message")
    )
    result["request_id"] = request_id_from(raw, headers)
    return result


def error_from_response(response: httpx.Response, operation: str) -> SeedanceProviderError:
    try:
        raw = response.json()
    except ValueError:
        raw = {}
    raw = _mapping(raw)
    error = _mapping(raw.get("error")) or _mapping(raw.get("Error"))
    error_code = first_string(error, "code", "Code") or first_string(raw, "error_code", "ErrorCode", "code", "Code")
    message = (
        first_string(error, "message", "Message", "detail", "Detail")
        or first_string(raw, "error_message", "ErrorMessage", "message", "Message")
        or response.reason_phrase
        or "upstream request failed"
    )
    message = redact_urls(message)
    request_id = request_id_from(raw, response.headers)
    rendered = f"{operation}: HTTP {response.status_code} {message}"
    if request_id:
        rendered += f" (request_id={request_id})"
    error_type = SeedanceProviderGatewayError if response.status_code in (502, 503, 504) else SeedanceProviderError
    return error_type(
        rendered,
        error_code=error_code,
        http_status=response.status_code,
        request_id=request_id,
    )


class SeedanceProvider(ABC):
    name: str
    namespace: str

    @abstractmethod
    def configured(self) -> bool:
        raise NotImplementedError

    @abstractmethod
    async def create_video_task(self, payload: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    async def get_video_task(self, task_id: str) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    async def cancel_video_task(self, task_id: str) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    async def create_asset_group(self, name: str, description: str) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    async def create_asset(
        self,
        group_id: str,
        url: str,
        name: str,
        asset_type: str,
    ) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    async def get_asset(self, asset_id: str, group_id: str = "") -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    async def delete_asset(self, asset_id: str) -> dict[str, Any]:
        raise NotImplementedError

    async def list_assets(
        self,
        group_ids: list[str],
        statuses: list[str] | None = None,
        page_number: int = 1,
        page_size: int = 100,
    ) -> dict[str, Any]:
        raise SeedanceOperationNotSupported(f"{self.name} does not expose an asset list endpoint")
