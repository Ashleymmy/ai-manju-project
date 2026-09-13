"""只访问新 Studio 的 Storage 对象接口，不复用旧 Supabase Auth 或数据库。"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import ssl
import tempfile
import time
from pathlib import Path
from urllib.parse import quote, urlsplit

import httpx

from .errors import SafeTaskError

STORAGE_ROLE = "studio_storage_service"
TOKEN_MAX_LIFETIME = 300
TRANSFER_CHUNK_BYTES = 1024 * 1024
REQUEST_TIMEOUT = 120


def _secret(name: str) -> str:
    file = os.getenv(name + "_FILE", "")
    try:
        value = Path(file).read_text(encoding="utf-8") if file else os.getenv(name, "")
    except OSError:
        raise SafeTaskError("Storage credential file unavailable", code="storage_configuration", retryable=False) from None
    value = value.strip()
    if len(value) > 65536 or "\n" in value or "\r" in value:
        raise SafeTaskError("Invalid Storage credential", code="storage_configuration", retryable=False)
    return value


def _claims(token: str) -> dict:
    try:
        parts = token.split(".")
        if len(parts) != 3 or not parts[2]: raise ValueError()
        header = json.loads(base64.urlsafe_b64decode(parts[0] + "=" * (-len(parts[0]) % 4)))
        value = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
        if not isinstance(header, dict) or header.get("alg") not in {"HS256", "RS256", "ES256", "EdDSA"} or not isinstance(value, dict): raise ValueError()
        return value
    except (ValueError, UnicodeError):
        raise SafeTaskError("Invalid Storage JWT", code="storage_configuration", retryable=False) from None


class SupabaseStorage:
    def __init__(self, transport=None):
        self.origin = os.getenv("STUDIO_SUPABASE_URL", "").rstrip("/")
        self.bucket = os.getenv("STUDIO_SUPABASE_BUCKET", "")
        origin = urlsplit(self.origin)
        if (origin.scheme != "https" or not origin.hostname or origin.username or origin.password
                or origin.path or origin.query or origin.fragment
                or not re.fullmatch(r"studio-[a-z0-9][a-z0-9-]{1,60}", self.bucket)
                or self.bucket.startswith("studio-sdvideo-")):
            raise SafeTaskError("Dedicated Studio Storage configuration required", code="storage_configuration", retryable=False)
        self.transport = transport

    def _headers(self):
        # 只做误配防护，签名和 RLS 权限由 Storage 服务验证；文件每次重读支持轮换。
        token = _secret("STUDIO_SUPABASE_STORAGE_TOKEN")
        claims = _claims(token)
        issued, expires = claims.get("iat"), claims.get("exp")
        if (claims.get("role") != STORAGE_ROLE or not isinstance(claims.get("sub"), str) or not claims["sub"]
                or not isinstance(claims.get("storage_buckets"), list) or self.bucket not in claims["storage_buckets"]
                or type(issued) is not int or type(expires) is not int or issued <= 0
                or not 0 < expires - issued <= TOKEN_MAX_LIFETIME or issued > time.time() + 30
                or expires <= time.time()):
            raise SafeTaskError("Expired or unscoped Storage JWT", code="storage_configuration", retryable=False)
        headers = {"Authorization": "Bearer " + token}
        key = _secret("STUDIO_SUPABASE_API_KEY")
        if key:
            if _claims(key).get("role") != "anon":
                raise SafeTaskError("Privileged Storage API key forbidden", code="storage_configuration", retryable=False)
            headers["apikey"] = key
        return headers

    def _client(self):
        ca = os.getenv("STUDIO_SUPABASE_CA_FILE") or None
        return httpx.Client(transport=self.transport, headers=self._headers(),
                            verify=ssl.create_default_context(cafile=ca), timeout=REQUEST_TIMEOUT,
                            follow_redirects=False, trust_env=False)

    def _target(self, key):
        if (not key or "\\" in key or any(ord(c) < 32 for c in key)
                or any(part in {"", ".", ".."} for part in key.split("/"))):
            raise SafeTaskError("Invalid Storage object key", code="invalid_storage_key", retryable=False)
        return quote(self.bucket, safe="") + "/" + quote(key, safe="/")

    @staticmethod
    def _status(response):
        status = response.status_code
        if status == 400:
            try:
                reported = int(response.json().get("statusCode", 0))
                if reported in {403, 404, 409}: status = reported
            except (ValueError, TypeError, AttributeError, httpx.ResponseNotRead):
                pass
        return status

    @staticmethod
    def _check(response):
        if 200 <= response.status_code < 300: return
        status = SupabaseStorage._status(response)
        raise SafeTaskError(f"Storage request failed (HTTP {status})", code="storage_unavailable",
                            retryable=status in {408, 429} or status >= 500)

    def upload(self, key: str, path: Path, content_type: str):
        target = self._target(key)
        try:
            with self._client() as client, path.open("rb") as source:
                response = client.post(self.origin + "/storage/v1/object/" + target,
                                       content=iter(lambda: source.read(TRANSFER_CHUNK_BYTES), b""),
                                       headers={"Content-Type": content_type, "x-upsert": "false", "Content-Length": str(path.stat().st_size)})
                if self._status(response) == 409:
                    source.seek(0)
                    digest = hashlib.file_digest(source, "sha256").digest()
                    with client.stream("GET", self.origin + "/storage/v1/object/authenticated/" + target,
                                       headers={"Accept-Encoding": "identity"}) as existing:
                        self._check(existing)
                        actual = hashlib.sha256()
                        total = 0
                        for chunk in existing.iter_bytes(TRANSFER_CHUNK_BYTES):
                            total += len(chunk)
                            if total > path.stat().st_size:
                                raise SafeTaskError("Storage content conflict", code="storage_conflict", retryable=False)
                            actual.update(chunk)
                        if digest != actual.digest():
                            raise SafeTaskError("Storage content conflict", code="storage_conflict", retryable=False)
                else:
                    self._check(response)
        except httpx.HTTPError:
            raise SafeTaskError("Storage upload unavailable", code="storage_unavailable", retryable=True) from None

    def download(self, key: str, target: Path, limit: int):
        remote = self._target(key)
        temporary = None
        try:
            with self._client() as client, client.stream("GET", self.origin + "/storage/v1/object/authenticated/" + remote,
                                                        headers={"Accept-Encoding": "identity"}) as response:
                self._check(response)
                length = response.headers.get("content-length")
                try:
                    declared = int(length) if length else None
                except ValueError:
                    raise SafeTaskError("Invalid Storage content length", code="storage_unavailable", retryable=True) from None
                if declared is not None and (declared < 0 or declared > limit):
                    raise SafeTaskError("Storage object exceeds transfer limit", code="storage_size_limit", retryable=False)
                target.parent.mkdir(parents=True, exist_ok=True)
                total = 0
                with tempfile.NamedTemporaryFile(dir=target.parent, prefix=target.name + ".", delete=False) as output:
                    temporary = Path(output.name)
                    for chunk in response.iter_bytes(TRANSFER_CHUNK_BYTES):
                        total += len(chunk)
                        if total > limit:
                            raise SafeTaskError("Storage object exceeds transfer limit", code="storage_size_limit", retryable=False)
                        output.write(chunk)
                if declared is not None and total != declared:
                    raise SafeTaskError("Incomplete Storage download", code="storage_unavailable", retryable=True)
                os.replace(temporary, target)
                temporary = None
        except httpx.HTTPError:
            raise SafeTaskError("Storage download unavailable", code="storage_unavailable", retryable=True) from None
        finally:
            if temporary is not None: temporary.unlink(missing_ok=True)

    def delete(self, key: str):
        self._target(key)
        try:
            with self._client() as client:
                response = client.request("DELETE", self.origin + "/storage/v1/object/" + quote(self.bucket, safe=""), json={"prefixes": [key]})
                if self._status(response) != 404: self._check(response)
        except httpx.HTTPError:
            raise SafeTaskError("Storage delete unavailable", code="storage_unavailable", retryable=True) from None

    def probe(self):
        try:
            with self._client() as client:
                response = client.get(self.origin + "/storage/v1/bucket/" + quote(self.bucket, safe=""))
                self._check(response)
                data = response.json()
                if data.get("id") != self.bucket or data.get("public") is not False:
                    raise SafeTaskError("Storage bucket must exist and be private", code="storage_configuration", retryable=False)
        except httpx.HTTPError:
            raise SafeTaskError("Storage probe unavailable", code="storage_unavailable", retryable=True) from None
