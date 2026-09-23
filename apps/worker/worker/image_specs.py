"""Translate canvas pixel budgets to Gemini's native image configuration."""
from __future__ import annotations

import re
from typing import Any

# Gemini has discrete aspect ratios and resolution tiers, not arbitrary pixels.
GEMINI_ASPECT_RATIOS = ("1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9")
IMAGE_RESOLUTION_BUDGETS = (("1K", 1024 * 1024), ("2K", 2048 * 2048), ("4K", 4096 * 4096))
IMAGE_BUDGET_ALIGNMENT_TOLERANCE = 1.05
GEMINI_OUTPUT_ALIGNMENT_PIXELS = 32
GEMINI_OUTPUT_ASPECT_TOLERANCE = 0.02


def gemini_image_config(payload: dict[str, Any]) -> dict[str, str]:
    size = str(payload.get("size") or "").strip().lower()
    match = re.fullmatch(r"(\d+)x(\d+)", size)
    if not match:
        return {"aspectRatio": size} if size in GEMINI_ASPECT_RATIOS else {}
    width, height = map(int, match.groups())
    if min(width, height) <= 0:
        return {}
    ratio = width / height
    aspect = min(GEMINI_ASPECT_RATIOS, key=lambda value: abs(ratio - int(value.split(":")[0]) / int(value.split(":")[1])))
    resolution = next((name for name, budget in IMAGE_RESOLUTION_BUDGETS if width * height <= budget * IMAGE_BUDGET_ALIGNMENT_TOLERANCE), "4K")
    return {"aspectRatio": aspect, "imageSize": resolution}


def is_gemini_image_model(payload: dict[str, Any]) -> bool:
    provider = payload.get("provider") or {}
    name = str(provider.get("model") or payload.get("model") or "").lower()
    return "gemini" in name or "banana" in name
