from __future__ import annotations

import hashlib
from typing import Any
from urllib.parse import urlencode

import httpx

from app.config import settings

from .base import (
    TOKENSPACE,
    SeedanceOperationNotSupported,
    SeedanceProvider,
    SeedanceProviderError,
    SeedanceProviderGatewayError,
    error_from_response,
    first_string,
    normalize_video_task,
    redact_urls,
    request_id_from,
)


class TokenSpaceProvider(SeedanceProvider):
    name = TOKENSPACE

    def __init__(
        self,
        base_url: str,
        api_key: str,
        model_id: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = (base_url or "").rstrip("/")
        self.api_key = (api_key or "").strip()
        self.model_id = (model_id or "").strip()
        self.transport = transport
        self.namespace = hashlib.sha256(self.api_key.encode("utf-8")).hexdigest()[:16] if self.api_key else "unconfigured"

    def configured(self) -> bool:
        return bool(self.base_url and self.api_key and self.model_id)

    def _headers(self) -> dict[str, str]:
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }

    async def _request(
        self,
        method: str,
        path: str,
        *,
        payload: dict[str, Any] | None = None,
        timeout: float = 60.0,
    ) -> tuple[dict[str, Any], httpx.Headers]:
        if not self.configured():
            raise SeedanceProviderError("tokenspace is not configured")
        try:
            async with httpx.AsyncClient(timeout=timeout, transport=self.transport) as client:
                response = await client.request(
                    method,
                    f"{self.base_url}{path}",
                    headers=self._headers(),
                    json=payload,
                )
        except httpx.RequestError as exc:
            raise SeedanceProviderGatewayError(f"tokenspace request failed: {exc}") from exc
        if response.status_code < 200 or response.status_code >= 300:
            raise error_from_response(response, f"tokenspace {method} {path}")
        if not response.content.strip():
            return {}, response.headers
        try:
            raw = response.json()
        except ValueError as exc:
            raise SeedanceProviderError("tokenspace returned invalid JSON") from exc
        if not isinstance(raw, dict):
            raw = {}
        self._raise_business_error(raw, response.headers)
        return raw, response.headers

    @staticmethod
    def _raise_business_error(raw: dict[str, Any], headers: httpx.Headers) -> None:
        containers = [raw]
        for key in ("Result", "result", "ResponseMetadata", "response_metadata"):
            value = raw.get(key)
            if isinstance(value, dict):
                containers.append(value)
        for container in containers:
            nested_error = container.get("Error") or container.get("error")
            if isinstance(nested_error, dict):
                code = first_string(nested_error, "Code", "code")
                message = first_string(nested_error, "Message", "message", "Detail", "detail") or code
                if message:
                    raise SeedanceProviderError(
                        f"tokenspace business error: {redact_urls(message)}",
                        error_code=code,
                        request_id=request_id_from(raw, headers),
                    )
            message = first_string(container, "ErrorMessage", "error_message")
            if message:
                raise SeedanceProviderError(
                    f"tokenspace business error: {redact_urls(message)}",
                    error_code=first_string(container, "ErrorCode", "error_code"),
                    request_id=request_id_from(raw, headers),
                )

    async def create_video_task(self, payload: dict[str, Any]) -> dict[str, Any]:
        upstream_payload = {**payload, "model": self.model_id}
        raw, headers = await self._request(
            "POST",
            "/api/v3/contents/generations/tasks",
            payload=upstream_payload,
            timeout=settings.MODEL_RETURN_WAIT_TIMEOUT_SECONDS,
        )
        task_id = first_string(raw, "id", "Id", "task_id", "TaskId")
        if not task_id:
            raise SeedanceProviderError("tokenspace video task response missing id")
        return {
            "id": task_id,
            "api_request_raw": upstream_payload,
            "api_response_raw": raw,
            "upstream_provider": self.name,
            "request_id": request_id_from(raw, headers),
        }

    async def get_video_task(self, task_id: str) -> dict[str, Any]:
        raw, headers = await self._request(
            "GET",
            f"/api/v3/contents/generations/tasks/{task_id}",
            timeout=settings.MODEL_RETURN_WAIT_TIMEOUT_SECONDS,
        )
        return normalize_video_task(raw, headers)

    async def cancel_video_task(self, task_id: str) -> dict[str, Any]:
        raise SeedanceOperationNotSupported(
            "TokenHub does not expose a video task cancellation endpoint; the task may continue and incur charges",
            error_code="CancelNotSupported",
            http_status=409,
        )

    async def _material(self, action: str, payload: dict[str, Any]) -> tuple[dict[str, Any], httpx.Headers]:
        query = urlencode({"Action": action})
        return await self._request("POST", f"/api/material?{query}", payload=payload)

    async def create_asset_group(self, name: str, description: str) -> dict[str, Any]:
        raw, headers = await self._material(
            "CreateAssetGroup",
            {"Name": name, "Description": description},
        )
        group_id = first_string(raw, "Id", "id", "GroupId", "GroupID", "group_id")
        if not group_id:
            raise SeedanceProviderError("tokenspace asset group response missing id")
        return {"id": group_id, "raw": raw, "request_id": request_id_from(raw, headers)}

    async def create_asset(
        self,
        group_id: str,
        url: str,
        name: str,
        asset_type: str,
    ) -> dict[str, Any]:
        raw, headers = await self._material(
            "CreateAsset",
            {"GroupId": group_id, "URL": url, "AssetType": asset_type, "Name": name},
        )
        asset_id = first_string(raw, "Id", "id", "AssetID", "AssetId", "asset_id")
        if not asset_id:
            raise SeedanceProviderError("tokenspace asset response missing id")
        return {
            "id": asset_id,
            "status": first_string(raw, "Status", "status") or "Processing",
            "url": first_string(raw, "URL", "url"),
            "raw": raw,
            "request_id": request_id_from(raw, headers),
        }

    async def get_asset(self, asset_id: str, group_id: str = "") -> dict[str, Any]:
        raw, headers = await self._material("GetAsset", {"Id": asset_id})
        record = raw.get("Result") if isinstance(raw.get("Result"), dict) else raw
        return {"raw": raw, "record": record, "request_id": request_id_from(raw, headers)}

    async def delete_asset(self, asset_id: str) -> dict[str, Any]:
        raw, headers = await self._material("DeleteAsset", {"Id": asset_id})
        return {"success": True, "raw": raw, "request_id": request_id_from(raw, headers)}
