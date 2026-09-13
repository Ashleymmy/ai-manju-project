"""Small storage boundary used by the standalone service.

所有适配只处理对象，不导入旧数据库、用户认证或页面模块。
"""

from pathlib import Path
from typing import Protocol
from urllib.parse import quote

from .supabase import SupabaseStorageAdapter


class StorageAdapter(Protocol):
    async def put(self, key: str, data: bytes, content_type: str) -> str: ...
    async def get(self, key: str) -> bytes: ...
    async def delete(self, key: str) -> None: ...
    async def url(self, key: str, expires_in: int = 900) -> str: ...


class LocalStorageAdapter:
    def __init__(self, root: str = "./data") -> None:
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        if not key or "\\" in key or any(part in {"", ".", ".."} for part in key.split("/")):
            raise ValueError("invalid local object key")
        # 对象键可含 workspace 的冒号，但 Windows 文件名不能含冒号。
        # 只转换磁盘路径，数据库和 API 的稳定 object key 保持原样。
        candidate = self.root.joinpath(*(quote(part, safe="-_.") for part in key.split("/"))).resolve()
        if self.root not in candidate.parents and candidate != self.root:
            raise ValueError("storage key escapes storage root")
        return candidate

    async def put(self, key: str, data: bytes, content_type: str) -> str:
        del content_type
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        import os
        import tempfile
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as output:
                temporary = output.name
                output.write(data)
            os.replace(temporary, path)
        finally:
            if temporary and os.path.exists(temporary):
                os.unlink(temporary)
        return key

    async def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    async def delete(self, key: str) -> None:
        path = self._path(key)
        if path.exists():
            path.unlink()

    async def url(self, key: str, expires_in: int = 900) -> str:
        del key, expires_in
        return ""


class OSSStorageAdapter:
    """Adapter for the new environment's dedicated OSS bucket."""

    def _bucket(self, key: str, *, public: bool = False):
        import oss2
        from app.config import settings
        from urllib.parse import urlsplit
        if not key or "\\" in key or any(part in {"", ".", ".."} for part in key.split("/")):
            raise ValueError("invalid OSS object key")
        buckets = {"inputs": settings.OSS_INPUT_BUCKET, "results": settings.OSS_BUCKET_NAME, "thumbnails": settings.OSS_THUMBNAIL_BUCKET, "volcano": settings.OSS_VOLCANO_BUCKET}
        bucket = buckets.get(key.split("/", 1)[0])
        endpoint = (settings.OSS_PUBLIC_ENDPOINT or settings.OSS_ENDPOINT) if public else settings.OSS_ENDPOINT
        if not bucket or not settings.OSS_KEY_ID or not settings.OSS_ACCESSKEY or urlsplit(endpoint).scheme != "https":
            raise ValueError("dedicated SD-video OSS configuration is incomplete")
        auth = oss2.StsAuth(settings.OSS_KEY_ID, settings.OSS_ACCESSKEY, settings.OSS_SECURITY_TOKEN) if settings.OSS_SECURITY_TOKEN else oss2.Auth(settings.OSS_KEY_ID, settings.OSS_ACCESSKEY)
        return oss2.Bucket(auth, endpoint, bucket, connect_timeout=30)

    async def put(self, key: str, data: bytes, content_type: str) -> str:
        import asyncio
        await asyncio.to_thread(self._bucket(key).put_object, key, data, headers={"Content-Type": content_type})
        return key

    async def get(self, key: str) -> bytes:
        import asyncio
        from app.config import settings
        def download():
            result = self._bucket(key).get_object(key)
            try:
                data = result.read(settings.MAX_INPUT_BYTES + 1)
                if len(data) > settings.MAX_INPUT_BYTES:
                    raise ValueError("OSS object exceeds transfer limit")
                return data
            finally:
                result.close()
        return await asyncio.to_thread(download)

    async def delete(self, key: str) -> None:
        import asyncio
        await asyncio.to_thread(self._bucket(key).delete_object, key)

    async def url(self, key: str, expires_in: int = 900) -> str:
        import asyncio
        return await asyncio.to_thread(self._bucket(key, public=True).sign_url, "GET", key, min(3600, max(60, expires_in)))


class S3StorageAdapter:
    """S3-compatible adapter with no credentials exposed to request payloads."""

    def __init__(self, settings: object) -> None:
        self.endpoint_url = str(getattr(settings, "S3_ENDPOINT_URL", "") or "") or None
        self.region = str(getattr(settings, "S3_REGION", "us-east-1") or "us-east-1")
        self.bucket = str(getattr(settings, "S3_BUCKET", "sdvideo-results") or "sdvideo-results")
        self.buckets = {
            "inputs": str(getattr(settings, "S3_INPUT_BUCKET", "sdvideo-inputs") or self.bucket),
            "results": str(getattr(settings, "S3_RESULT_BUCKET", self.bucket) or self.bucket),
            "thumbnails": str(getattr(settings, "S3_THUMBNAIL_BUCKET", "sdvideo-thumbnails") or self.bucket),
            "volcano": str(getattr(settings, "S3_VOLCANO_BUCKET", "sdvideo-volcano-assets") or self.bucket),
        }
        self.access_key = str(getattr(settings, "S3_ACCESS_KEY_ID", "") or "") or None
        self.secret_key = str(getattr(settings, "S3_SECRET_ACCESS_KEY", "") or "") or None

    def _client(self):
        import boto3

        return boto3.client(
            "s3",
            endpoint_url=self.endpoint_url,
            region_name=self.region,
            aws_access_key_id=self.access_key,
            aws_secret_access_key=self.secret_key,
        )

    def _bucket_for(self, key: str) -> str:
        prefix = key.split("/", 1)[0].lower()
        return self.buckets.get(prefix, self.bucket)

    async def put(self, key: str, data: bytes, content_type: str) -> str:
        import asyncio

        def upload() -> None:
            self._client().put_object(Bucket=self._bucket_for(key), Key=key, Body=data, ContentType=content_type)

        await asyncio.to_thread(upload)
        return key

    async def get(self, key: str) -> bytes:
        import asyncio

        def download() -> bytes:
            response = self._client().get_object(Bucket=self._bucket_for(key), Key=key)
            return response["Body"].read()

        return await asyncio.to_thread(download)

    async def delete(self, key: str) -> None:
        import asyncio

        await asyncio.to_thread(lambda: self._client().delete_object(Bucket=self._bucket_for(key), Key=key))

    async def url(self, key: str, expires_in: int = 900) -> str:
        import asyncio

        def sign() -> str:
            return str(self._client().generate_presigned_url(
                "get_object",
                Params={"Bucket": self._bucket_for(key), "Key": key},
                ExpiresIn=max(60, int(expires_in)),
            ))

        return await asyncio.to_thread(sign)


def build_storage_adapter(settings: object) -> StorageAdapter:
    backend = str(getattr(settings, "STORAGE_BACKEND", "local")).strip().lower()
    if backend == "local":
        return LocalStorageAdapter(str(getattr(settings, "DATA_DIR", "./data")))
    if backend == "oss":
        return OSSStorageAdapter()
    if backend == "supabase":
        return SupabaseStorageAdapter()
    if backend == "s3":
        return S3StorageAdapter(settings)
    raise RuntimeError(f"unsupported STORAGE_BACKEND: {backend}")
