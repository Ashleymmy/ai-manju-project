"""仅访问专属私有桶的 Storage API，不访问本地旧业务 Auth/数据库。"""
from __future__ import annotations

import base64
import hashlib
import json
import re
import ssl
import time
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlsplit

import httpx

from app.config import settings

STORAGE_ROLE = "sdvideo_storage_service"
TOKEN_MAX_LIFETIME = 300
RESPONSE_LIMIT = 64 * 1024
TRANSFER_CHUNK_BYTES = 1024 * 1024
REQUEST_TIMEOUT = 120


class StorageRequestError(RuntimeError):
    def __init__(self, status: int):
        self.status = status
        super().__init__(f"Storage request failed (HTTP {status})")


def _origin(value: str) -> str:
    origin = urlsplit(value)
    if (origin.scheme != "https" or not origin.hostname or origin.username is not None
            or origin.password is not None or origin.path not in {"", "/"} or origin.query or origin.fragment):
        raise ValueError("Storage endpoint must be an HTTPS origin")
    return value.rstrip("/")


def _secret(name: str) -> str:
    filename = getattr(settings, name + "_FILE")
    try:
        value = Path(filename).read_text(encoding="utf-8") if filename else getattr(settings, name)
    except OSError:
        raise ValueError("Storage credential file unavailable") from None
    value = value.strip()
    if len(value) > RESPONSE_LIMIT or "\n" in value or "\r" in value:
        raise ValueError("Invalid Storage credential")
    return value


def _claims(token: str) -> dict:
    try:
        parts = token.split(".")
        if len(parts) != 3 or not parts[2]:
            raise ValueError()
        header = json.loads(base64.urlsafe_b64decode(parts[0] + "=" * (-len(parts[0]) % 4)))
        value = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
        if not isinstance(header, dict) or header.get("alg") not in {"HS256", "RS256", "ES256", "EdDSA"} or not isinstance(value, dict):
            raise ValueError()
        return value
    except (ValueError, UnicodeError):
        raise ValueError("Invalid Storage JWT") from None


class SupabaseStorageAdapter:
    def __init__(self, transport=None):
        self.transport = transport

    def _target(self, key: str):
        parts = key.split("/")
        if not key or "\\" in key or any(ord(c) < 32 for c in key) or any(part in {"", ".", ".."} for part in parts):
            raise ValueError("invalid storage object key")
        buckets = {"inputs": settings.SUPABASE_INPUT_BUCKET, "results": settings.SUPABASE_RESULT_BUCKET,
                   "thumbnails": settings.SUPABASE_THUMBNAIL_BUCKET, "volcano": settings.SUPABASE_VOLCANO_BUCKET}
        if len(set(buckets.values())) != 4 or any(not re.fullmatch(r"studio-sdvideo-[a-z0-9][a-z0-9-]{1,45}", b) for b in buckets.values()):
            raise ValueError("SD-video requires four dedicated studio-sdvideo-* buckets")
        bucket = buckets.get(parts[0])
        if bucket is None:
            raise ValueError("unsupported Storage object namespace")
        _origin(settings.SUPABASE_URL)
        return bucket, quote(bucket, safe="") + "/" + quote(key, safe="/")

    def _headers(self, bucket: str):
        # 本地解码只防误配；真实签名、角色和 RLS 仍由 Storage 服务校验。
        token = _secret("SUPABASE_STORAGE_TOKEN")
        claims = _claims(token)
        issued, expires = claims.get("iat"), claims.get("exp")
        if (claims.get("role") != STORAGE_ROLE or not isinstance(claims.get("sub"), str) or not claims["sub"]
                or not isinstance(claims.get("storage_buckets"), list) or bucket not in claims["storage_buckets"]
                or type(issued) is not int or type(expires) is not int or issued <= 0
                or not 0 < expires - issued <= TOKEN_MAX_LIFETIME or issued > time.time() + 30 or expires <= time.time()):
            raise ValueError("Expired or unscoped Storage JWT")
        headers = {"Authorization": "Bearer " + token}
        key = _secret("SUPABASE_API_KEY")
        if key:
            if _claims(key).get("role") != "anon":
                raise ValueError("Privileged Storage API key forbidden")
            headers["apikey"] = key
        return headers

    def _client(self, bucket: str):
        return httpx.AsyncClient(transport=self.transport, headers=self._headers(bucket),
                                 verify=ssl.create_default_context(cafile=settings.SUPABASE_CA_FILE or None),
                                 timeout=REQUEST_TIMEOUT, follow_redirects=False, trust_env=False)

    @staticmethod
    def _check(response):
        if 200 <= response.status_code < 300:
            return
        status = response.status_code
        if status == 400:
            try:
                reported = int(response.json().get("statusCode", 0))
                if reported in {403, 404, 409}:
                    status = reported
            except (ValueError, TypeError, AttributeError, httpx.ResponseNotRead):
                pass
        if status == 404:
            raise FileNotFoundError("Storage object not found")
        if status == 409:
            raise FileExistsError("Storage object already exists")
        raise StorageRequestError(status)

    async def _request(self, bucket, method, path, **kwargs):
        try:
            async with self._client(bucket) as client:
                async with client.stream(method, _origin(settings.SUPABASE_URL) + "/storage/v1/" + path, **kwargs) as response:
                    body = bytearray()
                    async for chunk in response.aiter_bytes(RESPONSE_LIMIT):
                        body.extend(chunk)
                        if len(body) > RESPONSE_LIMIT:
                            raise ValueError("Storage response exceeds limit")
                    response = httpx.Response(response.status_code, headers=response.headers, content=bytes(body))
                    self._check(response)
                    return response
        except httpx.HTTPError:
            raise StorageRequestError(503) from None

    async def put(self, key: str, data: bytes, content_type: str) -> str:
        bucket, target = self._target(key)
        if len(data) > settings.MAX_INPUT_BYTES:
            raise ValueError("Storage object exceeds transfer limit")
        try:
            await self._request(bucket, "POST", "object/" + target, content=data,
                                headers={"Content-Type": content_type, "x-upsert": "false"})
        except FileExistsError:
            # 已写入但回执丢失时，只有内容一致才能视为幂等成功。
            existing = await self.get(key)
            if hashlib.sha256(existing).digest() != hashlib.sha256(data).digest():
                raise FileExistsError("Storage object conflicts with existing content") from None
        return key

    async def get(self, key: str) -> bytes:
        bucket, target = self._target(key)
        try:
            async with self._client(bucket) as client:
                async with client.stream("GET", _origin(settings.SUPABASE_URL) + "/storage/v1/object/authenticated/" + target,
                                         headers={"Accept-Encoding": "identity"}) as response:
                    self._check(response)
                    length = response.headers.get("content-length")
                    declared = int(length) if length else None
                    if declared is not None and (declared < 0 or declared > settings.MAX_INPUT_BYTES):
                        raise ValueError("Storage object exceeds transfer limit")
                    body = bytearray()
                    async for chunk in response.aiter_bytes(TRANSFER_CHUNK_BYTES):
                        body.extend(chunk)
                        if len(body) > settings.MAX_INPUT_BYTES:
                            raise ValueError("Storage object exceeds transfer limit")
                    if declared is not None and len(body) != declared:
                        raise StorageRequestError(503)
                    return bytes(body)
        except httpx.HTTPError:
            raise StorageRequestError(503) from None

    async def delete(self, key: str) -> None:
        bucket, _ = self._target(key)
        try:
            await self._request(bucket, "DELETE", "object/" + quote(bucket, safe=""), json={"prefixes": [key]})
        except FileNotFoundError:
            return

    async def url(self, key: str, expires_in: int = 900) -> str:
        bucket, target = self._target(key)
        origin = _origin(settings.SUPABASE_URL)
        public = _origin(settings.SUPABASE_PUBLIC_URL or origin)
        response = await self._request(bucket, "POST", "object/sign/" + target,
                                       json={"expiresIn": min(3600, max(60, expires_in))})
        signed = response.json().get("signedURL")
        if not isinstance(signed, str) or not signed:
            raise ValueError("Storage returned no signed URL")
        parsed = urlsplit(signed)
        if parsed.username is not None or parsed.fragment:
            raise ValueError("Invalid Storage signed URL")
        if (parsed.scheme or parsed.netloc) and parsed.scheme + "://" + parsed.netloc not in {origin, public}:
            raise ValueError("Storage returned an external signed URL")
        expected = "/storage/v1/object/sign/" + target
        tokens = parse_qs(parsed.query).get("token", [])
        if (unquote(parsed.path) not in {unquote(expected), unquote(expected.removeprefix("/storage/v1"))}
                or len(tokens) != 1 or not tokens[0]):
            raise ValueError("Storage signed URL does not match requested object")
        return public + expected + "?" + parsed.query

    async def probe(self):
        for kind in ("inputs", "results", "thumbnails", "volcano"):
            bucket, _ = self._target(kind + "/health")
            data = (await self._request(bucket, "GET", "bucket/" + quote(bucket, safe=""))).json()
            if data.get("id") != bucket or data.get("public") is not False:
                raise ValueError("Storage bucket must exist and be private")
