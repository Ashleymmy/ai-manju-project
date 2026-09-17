"""Official Ark inference (Bearer) and AIGC assets (Volcengine HMAC-SHA256).

Contract: volcengine.com/docs/82379/2318270, 2318271, 2318274, 2318278.
Signing follows volcengine-python-sdk/volcenginesdkcore/signv4.py.
"""
from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote, urlencode, urlsplit

import httpx

from app.config import settings
from .base import (
    ARK_OFFICIAL, SeedanceProvider, SeedanceProviderError,
    SeedanceProviderGatewayError, first_string, normalize_video_task,
    redact_urls, request_id_from,
)

# Public API constants and documented asset field limits.
ARK_ASSET_VERSION = "2024-01-01"
ARK_ASSET_SERVICE = "ark"
ARK_ASSET_GROUP_TYPE = "AIGC"
ARK_ASSET_NAME_LIMIT = 64
ARK_ASSET_DESCRIPTION_LIMIT = 300
ARK_ASSET_TIMEOUT_SECONDS = 60
ARK_NAMESPACE_HASH_LENGTH = 16
ARK_VIDEO_TASK_PATH = "/api/v3/contents/generations/tasks"


class ArkOfficialProvider(SeedanceProvider):
    name = ARK_OFFICIAL

    def __init__(self, base_url: str, api_key: str, asset_base_url: str,
                 access_key_id: str, secret_access_key: str, *,
                 region: str = "cn-beijing", project_name: str = "default",
                 security_token: str = "", transport: httpx.AsyncBaseTransport | None = None):
        self.base_url = base_url.rstrip("/").removesuffix("/api/v3")
        self.api_key = api_key.strip()
        self.asset_base_url = asset_base_url.rstrip("/")
        self.access_key_id = access_key_id.strip()
        self.secret_access_key = secret_access_key.strip()
        self.region = region.strip()
        self.project_name = project_name.strip()
        self.security_token = security_token.strip()
        self.transport = transport
        # Prefix prevents proxy collisions; credential/project changes fail closed.
        identity = json.dumps([self.base_url, self.api_key, self.asset_base_url,
                               self.access_key_id, self.region, self.project_name])
        self.namespace = ARK_OFFICIAL + ":" + hashlib.sha256(identity.encode()).hexdigest()[:ARK_NAMESPACE_HASH_LENGTH]

    @staticmethod
    def _valid_origin(value: str) -> bool:
        parsed = urlsplit(value)
        return bool(parsed.scheme == "https" and parsed.hostname and not (
            parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path.strip("/")))

    def configured(self) -> bool:
        return bool(self.api_key and self._valid_origin(self.base_url))

    def assets_configured(self) -> bool:
        return bool(self.access_key_id and self.secret_access_key and self.region
                    and self.project_name and self._valid_origin(self.asset_base_url))

    def _signed_headers(self, body: bytes, query: dict[str, str], *, now: datetime | None = None) -> dict[str, str]:
        timestamp = (now or datetime.now(timezone.utc)).strftime("%Y%m%dT%H%M%SZ")
        body_hash = hashlib.sha256(body).hexdigest()
        endpoint = urlsplit(self.asset_base_url)
        host = endpoint.hostname if endpoint.port in (None, 443) else endpoint.netloc
        headers = {"content-type": "application/json", "host": host,
                   "x-date": timestamp, "x-content-sha256": body_hash}
        if self.security_token:
            headers["x-security-token"] = self.security_token
        signed_names = ";".join(sorted(headers))
        canonical_headers = "".join(f"{key}:{headers[key]}\n" for key in sorted(headers))
        canonical_query = urlencode(sorted(query.items()), quote_via=quote, safe="-_.~")
        canonical = "\n".join(["POST", "/", canonical_query, canonical_headers, signed_names, body_hash])
        scope = f"{timestamp[:8]}/{self.region}/{ARK_ASSET_SERVICE}/request"
        to_sign = "\n".join(["HMAC-SHA256", timestamp, scope, hashlib.sha256(canonical.encode()).hexdigest()])
        signing_key = self.secret_access_key.encode()
        for part in (timestamp[:8], self.region, ARK_ASSET_SERVICE, "request"):
            signing_key = hmac.new(signing_key, part.encode(), hashlib.sha256).digest()
        signature = hmac.new(signing_key, to_sign.encode(), hashlib.sha256).hexdigest()
        headers["authorization"] = f"HMAC-SHA256 Credential={self.access_key_id}/{scope}, SignedHeaders={signed_names}, Signature={signature}"
        return headers

    def _safe_text(self, value: str) -> str:
        for secret in (self.api_key, self.access_key_id, self.secret_access_key, self.security_token):
            if secret:
                value = value.replace(secret, "[redacted]")
        return redact_urls(value)

    async def _request(self, method: str, url: str, headers: dict[str, str], *,
                       body: bytes | None = None, timeout: float = ARK_ASSET_TIMEOUT_SECONDS) -> tuple[dict[str, Any], httpx.Headers]:
        try:
            async with httpx.AsyncClient(transport=self.transport, timeout=timeout, follow_redirects=False) as client:
                response = await client.request(method, url, headers=headers, content=body)
        except httpx.RequestError as exc:
            # Request exception messages can contain credentials or signed media URLs.
            raise SeedanceProviderGatewayError(f"ark_official request failed ({type(exc).__name__})") from None
        try:
            raw = response.json() if response.content.strip() else {}
        except ValueError:
            raw = {}
            if response.is_success:
                raise SeedanceProviderError("ark_official returned invalid JSON") from None
        if not isinstance(raw, dict):
            raise SeedanceProviderError("ark_official returned an invalid response")
        metadata = raw.get("ResponseMetadata") or {}
        error = metadata.get("Error") if isinstance(metadata, dict) else None
        # Result.Error with Status=Failed is an asset lifecycle state, not an API error.
        if not error and "status" not in raw:
            error = raw.get("error") or raw.get("Error")
        if not response.is_success or error:
            error = error if isinstance(error, dict) else {}
            error_type = SeedanceProviderGatewayError if response.status_code in (502, 503, 504) else SeedanceProviderError
            raise error_type(
                self._safe_text(first_string(error, "Message", "message") or f"ark_official HTTP {response.status_code}"),
                error_code=self._safe_text(first_string(error, "Code", "code")),
                http_status=response.status_code,
                request_id=self._safe_text(request_id_from(raw, response.headers)),
            )
        return raw, response.headers

    async def _video(self, method: str, task_id: str = "", payload: dict[str, Any] | None = None):
        if not self.configured():
            raise SeedanceProviderError("ark_official inference API Key is not configured")
        path = ARK_VIDEO_TASK_PATH + ("/" + quote(task_id, safe="") if task_id else "")
        return await self._request(method, self.base_url + path,
                                   {"Content-Type": "application/json", "Authorization": f"Bearer {self.api_key}"},
                                   body=json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None,
                                   timeout=settings.MODEL_RETURN_WAIT_TIMEOUT_SECONDS)

    async def create_video_task(self, payload: dict[str, Any]) -> dict[str, Any]:
        # Use the task's frozen model ID, including custom endpoint IDs.
        raw, headers = await self._video("POST", payload=payload)
        task_id = first_string(raw, "id")
        if not task_id:
            raise SeedanceProviderError("ark_official video task response missing id")
        return {"id": task_id, "api_request_raw": payload, "api_response_raw": raw,
                "upstream_provider": self.name, "request_id": request_id_from(raw, headers)}

    async def get_video_task(self, task_id: str) -> dict[str, Any]:
        raw, headers = await self._video("GET", task_id)
        result = normalize_video_task(raw, headers)
        result["error_message"] = self._safe_text(result["error_message"])
        return result

    async def cancel_video_task(self, task_id: str) -> dict[str, Any]:
        raw, _ = await self._video("DELETE", task_id)
        return raw or {"success": True}

    async def _asset(self, action: str, payload: dict[str, Any]):
        if not self.assets_configured():
            raise SeedanceProviderError("ark_official asset AK/SK is not configured")
        body = json.dumps({**payload, "ProjectName": self.project_name}, ensure_ascii=False, separators=(",", ":")).encode()
        query = {"Action": action, "Version": ARK_ASSET_VERSION}
        return await self._request("POST", self.asset_base_url + "/?" + urlencode(query), self._signed_headers(body, query), body=body)

    async def create_asset_group(self, name: str, description: str) -> dict[str, Any]:
        raw, headers = await self._asset("CreateAssetGroup", {
            "Name": name[:ARK_ASSET_NAME_LIMIT], "Description": description[:ARK_ASSET_DESCRIPTION_LIMIT],
            "GroupType": ARK_ASSET_GROUP_TYPE,
        })
        group_id = first_string(raw, "Id")
        if not group_id:
            raise SeedanceProviderError("ark_official asset group response missing id")
        return {"id": group_id, "request_id": request_id_from(raw, headers)}

    async def create_asset(self, group_id: str, url: str, name: str, asset_type: str) -> dict[str, Any]:
        raw, headers = await self._asset("CreateAsset", {
            "GroupId": group_id, "URL": url, "Name": name[:ARK_ASSET_NAME_LIMIT], "AssetType": asset_type,
        })
        asset_id = first_string(raw, "Id")
        if not asset_id:
            raise SeedanceProviderError("ark_official asset response missing id")
        return {"id": asset_id, "status": "Processing", "request_id": request_id_from(raw, headers)}

    async def get_asset(self, asset_id: str, group_id: str = "") -> dict[str, Any]:
        raw, headers = await self._asset("GetAsset", {"Id": asset_id})
        record = raw.get("Result")
        if not isinstance(record, dict) or not first_string(record, "Status"):
            raise SeedanceProviderError("ark_official asset response missing status")
        return {"record": record, "request_id": request_id_from(raw, headers)}

    async def delete_asset(self, asset_id: str) -> dict[str, Any]:
        raw, headers = await self._asset("DeleteAsset", {"Id": asset_id})
        return {"success": True, "request_id": request_id_from(raw, headers)}
