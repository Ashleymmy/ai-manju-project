"""Zizi H3 multi-reference variants use the documented v8 JSON contract.

https://www.zizidonghua.com/api-docs/model/zzdh-minimax-h3-限时优惠
https://www.zizidonghua.com/api-docs/video-generation
"""
from __future__ import annotations

import base64
import re
from typing import Any
from urllib.parse import urlparse, urlunparse

from .config import Settings
from .errors import SafeTaskError
from . import object_storage
from .staged_inputs import open_staged_input


# These limits apply only to the documented multi-image promotional variants.
H3_MODEL = re.compile(r"zzdh-minimax-h3-限时优惠-多参考图生-(480p|768p)", re.IGNORECASE)
H3_MAX_IMAGES = 9
H3_MIN_SECONDS = 1
H3_MAX_SECONDS = 15
H3_DEFAULT_SECONDS = 5
H3_IMAGE_MAX_BYTES = 30 * 1024 * 1024


def is_h3_reference_model(model: str) -> bool:
    return H3_MODEL.fullmatch(model.strip()) is not None


def h3_provider(provider: dict[str, Any]) -> dict[str, Any]:
    # Retain the configured origin and credentials; v8 lives beside v1.
    parsed = urlparse(str(provider["base_url"]))
    return {
        **provider,
        "base_url": urlunparse(parsed._replace(path="/", query="", fragment="")),
        "endpoint": "v8/videos/generations",
        "video_protocol": "zizi_h3",
        "endpoint_overrides": {
            "video_get": "v8/videos/generations/{id}",
            "video_content": "v1/videos/{id}/content",
        },
    }


def h3_request_body(payload: dict[str, Any], provider: dict[str, Any], settings: Settings) -> dict[str, Any]:
    def invalid(message: str) -> SafeTaskError:
        return SafeTaskError(message, code="video_invalid_parameters", retryable=False)

    try:
        duration = int(str(payload.get("seconds") or H3_DEFAULT_SECONDS))
    except (TypeError, ValueError):
        raise invalid("H3 视频时长应为 1–15 秒整数") from None
    if not H3_MIN_SECONDS <= duration <= H3_MAX_SECONDS:
        raise invalid("H3 视频时长应为 1–15 秒整数")
    size = str(payload.get("size") or "1280x720")
    if size in {"horizontal", "16:9", "4:3"}:
        aspect = "horizontal"
    elif size in {"vertical", "9:16", "3:4"}:
        aspect = "vertical"
    else:
        match = re.fullmatch(r"([1-9]\d*)x([1-9]\d*)", size)
        if not match or match[1] == match[2]:
            raise invalid("H3 仅支持横屏或竖屏")
        aspect = "horizontal" if int(match[1]) > int(match[2]) else "vertical"
    files = payload.get("files")
    if not isinstance(files, list) or not 1 <= len(files) <= H3_MAX_IMAGES:
        raise invalid("H3 多参考图生需要 1–9 张参考图片")
    images = []
    for item in files:
        if not isinstance(item, dict) or not str(item.get("content_type") or "").startswith("image/"):
            raise invalid("H3 多参考图生仅支持参考图片")
        # Validate workspace/size/hash before signing. Cloud references use the
        # documented URL form to avoid the provider's failing base64 URL bridge.
        with open_staged_input(item, payload, settings) as stream:
            content = stream.read(H3_IMAGE_MAX_BYTES + 1)
        if not content or len(content) > H3_IMAGE_MAX_BYTES:
            raise invalid("H3 参考图片不能为空或超过 30MB")
        url = object_storage.signed_reference_url(str(item.get("storage_key") or ""))
        reference = {"url": url} if url else {"base64": base64.b64encode(content).decode("ascii")}
        images.append({**reference, "role": "reference_image"})
    return {
        "model": provider["model"], "prompt": str(payload.get("prompt") or ""),
        "duration": duration, "aspect_ratio": aspect, "mode": "ref2v",
        "reference_images": images,
    }
