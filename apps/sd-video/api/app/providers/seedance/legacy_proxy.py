from __future__ import annotations

from typing import Any

import httpx

from app.config import settings

from .base import (
    LEGACY_PROXY,
    SeedanceProvider,
    SeedanceProviderError,
    SeedanceProviderGatewayError,
    error_from_response,
    first_string,
    normalize_video_task,
    request_id_from,
)


class LegacyProxyProvider(SeedanceProvider):
    name = LEGACY_PROXY
    namespace = "legacy_default"

    def __init__(
        self,
        base_url: str,
        api_key: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = (base_url or "").rstrip("/")
        self.api_key = (api_key or "").strip()
        self.transport = transport

    def configured(self) -> bool:
        return bool(self.base_url and self.api_key)

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
        timeout: float = 30.0,
    ) -> tuple[dict[str, Any], httpx.Headers]:
        if not self.configured():
            raise SeedanceProviderError("legacy_proxy is not configured")
        try:
            async with httpx.AsyncClient(timeout=timeout, transport=self.transport) as client:
                response = await client.request(
                    method,
                    f"{self.base_url}{path}",
                    headers=self._headers(),
                    json=payload,
                )
        except httpx.RequestError as exc:
            raise SeedanceProviderGatewayError(f"legacy_proxy request failed: {exc}") from exc
        if response.status_code < 200 or response.status_code >= 300:
            raise error_from_response(response, f"legacy_proxy {method} {path}")
        if not response.content.strip():
            return {}, response.headers
        try:
            raw = response.json()
        except ValueError as exc:
            raise SeedanceProviderError("legacy_proxy returned invalid JSON") from exc
        return (raw if isinstance(raw, dict) else {}), response.headers

    async def create_video_task(self, payload: dict[str, Any]) -> dict[str, Any]:
        raw, headers = await self._request(
            "POST",
            "/v1/video/tasks",
            payload=payload,
            timeout=settings.MODEL_RETURN_WAIT_TIMEOUT_SECONDS,
        )
        task_id = first_string(raw, "id", "Id", "task_id", "TaskId")
        if not task_id:
            raise SeedanceProviderError("legacy_proxy video task response missing id")
        return {
            "id": task_id,
            "api_request_raw": payload,
            "api_response_raw": raw,
            "upstream_provider": self.name,
            "request_id": request_id_from(raw, headers),
        }

    async def get_video_task(self, task_id: str) -> dict[str, Any]:
        raw, headers = await self._request(
            "GET",
            f"/v1/video/tasks/{task_id}",
            timeout=settings.MODEL_RETURN_WAIT_TIMEOUT_SECONDS,
        )
        return normalize_video_task(raw, headers)

    async def cancel_video_task(self, task_id: str) -> dict[str, Any]:
        raw, _ = await self._request(
            "DELETE",
            f"/v1/video/tasks/{task_id}",
            timeout=settings.MODEL_RETURN_WAIT_TIMEOUT_SECONDS,
        )
        return raw or {"success": True}

    async def create_asset_group(self, name: str, description: str) -> dict[str, Any]:
        raw, _ = await self._request("GET", "/v1/asset/groups?limit=100&offset=0")
        for item in raw.get("items", []) or raw.get("Items", []):
            if isinstance(item, dict) and first_string(item, "name", "Name") == name:
                group_id = first_string(item, "group_id", "GroupId", "GroupID", "id", "Id")
                if group_id:
                    return {"id": group_id, "raw": item}
        payload = {
            "Name": name,
            "Description": description,
            "GroupType": "AIGC",
            "ProjectName": "default",
        }
        created, _ = await self._request("POST", "/v1/create/asset/group", payload=payload)
        group_id = first_string(created, "id", "Id", "group_id", "GroupId", "GroupID")
        if not group_id:
            raise SeedanceProviderError("legacy_proxy asset group response missing id")
        return {"id": group_id, "raw": created}

    async def create_asset(
        self,
        group_id: str,
        url: str,
        name: str,
        asset_type: str,
    ) -> dict[str, Any]:
        payload = {
            "GroupId": group_id,
            "URL": url,
            "AssetType": asset_type,
            "Name": name,
            "PollInterval": 3,
            "PollTimeout": 120,
        }
        raw, _ = await self._request("POST", "/v1/create/asset", payload=payload, timeout=150.0)
        return {
            "id": first_string(raw, "asset_id", "AssetID", "AssetId", "id", "Id"),
            "status": first_string(raw, "status", "Status") or "Processing",
            "url": first_string(raw, "url", "URL"),
            "raw": raw,
        }

    async def list_assets(
        self,
        group_ids: list[str],
        statuses: list[str] | None = None,
        page_number: int = 1,
        page_size: int = 100,
    ) -> dict[str, Any]:
        filters: dict[str, Any] = {"GroupIds": group_ids, "GroupType": "AIGC"}
        if statuses:
            filters["Statuses"] = statuses
        payload = {
            "Filter": filters,
            "PageNumber": page_number,
            "PageSize": page_size,
            "SortBy": "CreateTime",
            "SortOrder": "Desc",
            "ProjectName": "default",
        }
        raw, _ = await self._request("POST", "/v1/asset/list", payload=payload)
        return raw

    async def get_asset(self, asset_id: str, group_id: str = "") -> dict[str, Any]:
        if not group_id:
            raise SeedanceProviderError("legacy_proxy GetAsset requires group_id")
        raw = await self.list_assets(
            [group_id],
            ["Active", "Failed", "Processing", "Creating", "queued"],
            page_size=100,
        )
        items = raw.get("Items", []) or raw.get("items", [])
        for item in items:
            if isinstance(item, dict) and first_string(item, "Id", "id", "AssetID", "asset_id") == asset_id:
                return {"raw": item, "record": item}
        raise SeedanceProviderError(f"legacy_proxy asset not found: {asset_id}")

    async def delete_asset(self, asset_id: str) -> dict[str, Any]:
        raw, _ = await self._request(
            "POST",
            "/v1/delete/asset",
            payload={"Id": asset_id, "ProjectName": "default"},
        )
        return raw or {"success": True}
