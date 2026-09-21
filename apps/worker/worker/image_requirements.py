from __future__ import annotations

import re
from typing import Any
from .errors import SafeTaskError

# Shared marker with Studio outputRequirements.ts avoids appending twice on retries.
CANVAS_OUTPUT_REQUIREMENTS = "[Canvas output requirements]"
# These are the currently implemented adapters with a native detail-quality field.
DETAIL_QUALITY_PROTOCOLS = frozenset({"openai_images", "openai_responses"})


class ImageParameterError(SafeTaskError):
    """A precise, safe parameter error; do not obscure it with a failover message."""


def require_canvas_image_parameter_support(payload: dict[str, Any], protocol: str) -> None:
    registration = payload.get("asset_registration")
    if not isinstance(registration, dict) or registration.get("source_type") != "canvas":
        return
    quality = str(payload.get("quality") or "").strip().lower()
    if quality not in ("", "auto") and protocol not in DETAIL_QUALITY_PROTOCOLS:
        raise ImageParameterError(
            "当前图片模型通道不支持所选精细度，请更换支持精细度设置的图片模型。任务尚未发送到生成服务。",
            code="image_parameters_unsupported", retryable=False,
        )


def with_canvas_image_requirements(payload: dict[str, Any]) -> dict[str, Any]:
    registration = payload.get("asset_registration")
    if not isinstance(registration, dict) or registration.get("source_type") != "canvas":
        return payload
    prompt = str(payload.get("prompt") or "")
    dimensions = re.fullmatch(r"(\d+)x(\d+)", str(payload.get("size") or ""))
    if not dimensions or CANVAS_OUTPUT_REQUIREMENTS in prompt:
        return payload
    width, height = map(int, dimensions.groups())
    if width <= 0 or height <= 0:
        return payload
    return {**payload, "prompt": (
        f"{prompt}\n\n{CANVAS_OUTPUT_REQUIREMENTS}\n"
        f"最终输出图片尺寸必须为 {width}×{height} 像素（宽×高）。按此宽高比重新构图，"
        "不要沿用参考图的宽高比，不要添加边框或把这些规格文字画进图片。"
    )}
