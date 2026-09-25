"""Refresh owned Studio media at dispatch time, never by trusting URL claims."""
from __future__ import annotations

import os
from pathlib import PurePosixPath
from urllib.parse import unquote, urlsplit

from . import object_storage
from .errors import SafeTaskError

ASSET_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mov", ".mp3", ".wav", ".m4a", ".ogg", ".bin"}
REFERENCE_URL_MAX_LENGTH = 4000


def _origin(value):
    try:
        parsed = urlsplit(value)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username is not None or parsed.password is not None:
            return None
        return parsed.scheme.lower(), parsed.hostname.lower(), parsed.port or (443 if parsed.scheme == "https" else 80)
    except (ValueError, TypeError):
        return None


def studio_object_key(raw):
    """Only administrator-configured origins/bucket can identify our objects.

    The key is an identifier, NOT proof of access. Every refresh requires an
    independent database check using the locked Job's real workspace.
    """
    if not isinstance(raw, str) or len(raw) > REFERENCE_URL_MAX_LENGTH:
        return None
    origin = _origin(raw)
    if origin is None:
        return None
    parsed = urlsplit(raw)
    if parsed.fragment:
        return None
    backend = os.getenv("ASSET_STORAGE_BACKEND", "local")
    key = None
    if backend == "supabase":
        origins = {_origin(os.getenv(name, "")) for name in ("STUDIO_SUPABASE_URL", "STUDIO_SUPABASE_PUBLIC_URL")}
        bucket = os.getenv("STUDIO_SUPABASE_BUCKET", "")
        prefix = "/storage/v1/object/sign/" + bucket + "/"
        if bucket and origin in origins and parsed.path.startswith(prefix):
            key = unquote(parsed.path[len(prefix):])
    elif backend == "oss":
        endpoint = urlsplit(os.getenv("STUDIO_OSS_ENDPOINT", ""))
        bucket = os.getenv("STUDIO_OSS_BUCKET", "")
        if endpoint.hostname and bucket:
            host = endpoint.hostname if endpoint.hostname.startswith(bucket + ".") else bucket + "." + endpoint.hostname
            bucket_origin = (endpoint.scheme, host.lower(), endpoint.port or (443 if endpoint.scheme == "https" else 80))
            if origin == bucket_origin or origin == _origin(os.getenv("ASSET_CDN_BASE_URL", "")):
                key = unquote(parsed.path.lstrip("/"))
    if key is None:
        return None
    # No alternate spellings, traversal, recursive unquoting or folder aliasing.
    if not key or "%" in key or "\\" in key or any(ord(c) < 32 for c in key) or any(part in {"", ".", ".."} for part in key.split("/")):
        raise unavailable_reference()
    return key


def refresh_owned_reference(raw, kind, workspace_id, store):
    key = studio_object_key(raw)
    if key is None:
        return raw
    if not key.startswith(("personal/", "team/")):
        # Staging/registered-library URLs have their own lifecycle and ACLs.
        return raw
    if workspace_id == "team:default":
        prefix = "team/default/"
    elif workspace_id.startswith("default:") and workspace_id != "default:":
        prefix = "personal/" + workspace_id.removeprefix("default:") + "/"
    else:
        raise unavailable_reference()
    if not key.startswith(prefix):
        # Cross-scope references may be legitimate (e.g. a team asset on a
        # personal canvas). Keep the existing signed capability, but never
        # mint fresh access without a separately authenticated scope grant.
        return raw
    filename = key[len(prefix):]
    if "/" in filename or PurePosixPath(filename).suffix.lower() not in ASSET_EXTENSIONS:
        raise unavailable_reference()
    asset_id = str(PurePosixPath(filename).with_suffix(""))
    try:
        allowed = store.owns_reference_asset(asset_id, workspace_id, kind.removesuffix("_url"))
    except Exception:
        raise SafeTaskError("参考素材权限暂时无法确认，请稍后重试", code="reference_authorization_unavailable", retryable=True) from None
    if not allowed:
        raise unavailable_reference()
    signed = object_storage.signed_reference_url(key)
    if not signed or len(signed) > REFERENCE_URL_MAX_LENGTH or _origin(signed) is None:
        raise SafeTaskError("参考素材下载链接暂时无法生成", code="storage_configuration", retryable=False)
    return signed


def unavailable_reference():
    return SafeTaskError("参考素材不存在或不属于当前工作区，请重新选择素材", code="video_reference_unavailable", retryable=False)
