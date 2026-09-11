"""Studio Worker 与 Go API 共用 object key，远端存储为权威副本，本地仅作处理缓存。"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

from .errors import SafeTaskError

MAX_TRANSFER_BYTES = 512 * 1024 * 1024


def enabled() -> bool:
    backend = os.getenv("ASSET_STORAGE_BACKEND", "local")
    if backend not in {"local", "oss", "supabase"}:
        raise SafeTaskError("unsupported asset backend", code="storage_configuration", retryable=False)
    return backend != "local"


def _secret(name: str) -> str:
    filename = os.getenv(name + "_FILE", "")
    return Path(filename).read_text(encoding="utf-8").strip() if filename else os.getenv(name, "")


def _bucket():
    import oss2
    endpoint, bucket = os.getenv("STUDIO_OSS_ENDPOINT", ""), os.getenv("STUDIO_OSS_BUCKET", "")
    key, secret, token = (_secret("STUDIO_OSS_" + name) for name in ("ACCESS_KEY_ID", "ACCESS_KEY_SECRET", "SECURITY_TOKEN"))
    if not bucket or not key or not secret or urlsplit(endpoint).scheme != "https":
        raise SafeTaskError("Studio OSS configuration incomplete", code="storage_configuration", retryable=False)
    auth = oss2.StsAuth(key, secret, token) if token else oss2.Auth(key, secret)
    return oss2.Bucket(auth, endpoint, bucket, connect_timeout=30)


def _key(key: str) -> str:
    if not key or "\\" in key or any(part in {"", ".", ".."} for part in key.split("/")):
        raise SafeTaskError("invalid object key", code="invalid_storage_key", retryable=False)
    return key


def upload(key: str, path: Path, content_type: str) -> None:
    if os.getenv("ASSET_STORAGE_BACKEND") == "supabase":
        from .supabase_storage import SupabaseStorage
        return SupabaseStorage().upload(_key(key), path, content_type)
    with path.open("rb") as stream:
        _bucket().put_object(_key(key), stream, headers={"Content-Type": content_type})


def download(key: str, target: Path, limit: int = MAX_TRANSFER_BYTES) -> None:
    if os.getenv("ASSET_STORAGE_BACKEND") == "supabase":
        from .supabase_storage import SupabaseStorage
        return SupabaseStorage().download(_key(key), target, min(limit, MAX_TRANSFER_BYTES))
    target.parent.mkdir(parents=True, exist_ok=True)
    response = _bucket().get_object(_key(key))
    temporary = None
    try:
        total = 0
        with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".oss-", delete=False) as stream:
            temporary = Path(stream.name)
            for chunk in iter(lambda: response.read(1024 * 1024), b""):
                total += len(chunk)
                if total > min(limit, MAX_TRANSFER_BYTES):
                    raise SafeTaskError("object exceeds input limit", code="input_too_large", retryable=False)
                stream.write(chunk)
        os.replace(temporary, target)
    except Exception:
        if temporary: temporary.unlink(missing_ok=True)
        raise
    finally:
        response.close()


def delete(key: str) -> None:
    if os.getenv("ASSET_STORAGE_BACKEND") == "supabase":
        from .supabase_storage import SupabaseStorage
        return SupabaseStorage().delete(_key(key))
    _bucket().delete_object(_key(key))


def probe() -> None:
    if os.getenv("ASSET_STORAGE_BACKEND") == "supabase":
        from .supabase_storage import SupabaseStorage
        SupabaseStorage().probe()
    elif enabled():
        _bucket().object_exists("health/probe")
