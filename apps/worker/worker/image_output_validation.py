"""Validate original image dimensions before a canvas task can succeed."""
from __future__ import annotations

import json
import re
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests

from .config import Settings
from .image_requirements import ImageParameterError

# Reading a local image header must not hold a worker slot indefinitely.
IMAGE_PROBE_TIMEOUT_SECONDS = 15
# Bound downloading signed provider URLs; never forward supplier credentials.
IMAGE_DOWNLOAD_TIMEOUT_SECONDS = 60
IMAGE_DOWNLOAD_CHUNK_BYTES = 64 * 1024
IMAGE_DOWNLOAD_MAX_BYTES = 50 * 1024 * 1024
# Providers may round the scaled short edge to an integer pixel.
IMAGE_ASPECT_ROUNDING_PIXELS = 1


class ImageOutputValidationError(ImageParameterError):
    """Safe user-facing errors that must survive the generic failover error mask."""


def validate_canvas_image_outputs(payload: dict[str, Any], result: dict[str, Any], settings: Settings) -> None:
    registration = payload.get("asset_registration")
    if not isinstance(registration, dict) or registration.get("source_type") != "canvas":
        return
    match = re.fullmatch(r"(\d+)x(\d+)", str(payload.get("size") or ""))
    if not match:
        return
    expected = tuple(map(int, match.groups()))
    if min(expected) <= 0:
        return
    outputs = result.get("outputs")
    if not isinstance(outputs, list) or not outputs:
        raise invalid_output()
    for output in outputs:
        if not isinstance(output, dict):
            raise invalid_output()
        if not output.get("path") and output.get("remote_url"):
            download_original_image(output, settings)
        if not output.get("path"):
            raise invalid_output()
        path = Path(str(output["path"])).resolve()
        if not path.is_relative_to(settings.asset_storage_dir.resolve()) or not path.is_file():
            raise invalid_output()
        width, height = read_image_dimensions(path, settings)
        if not meets_requested_dimensions(width, height, expected):
            # Do not resize/crop the file or automatically charge for another generation.
            raise ImageOutputValidationError(
                f"图片尺寸不符合所选参数：要求 {expected[0]}×{expected[1]} px，实际返回 {width}×{height} px。请更换模型或调整参数后重试。",
                code="image_output_size_mismatch", retryable=False,
            )
        output.update(width=width, height=height)


def meets_requested_dimensions(width: int, height: int, expected: tuple[int, int]) -> bool:
    expected_width, expected_height = expected
    if width < expected_width or height < expected_height:
        return False
    # Compare cross-products to avoid floating-point ratio errors. This permits
    # larger originals, with at most one pixel of rounding on the short edge.
    return abs(width * expected_height - height * expected_width) <= (
        IMAGE_ASPECT_ROUNDING_PIXELS * max(expected_width, expected_height)
    )


def invalid_output() -> ImageOutputValidationError:
    return ImageOutputValidationError("生成服务未返回可校验的原图，请更换模型后重试。", code="image_output_unreadable", retryable=False)


def download_original_image(output: dict[str, Any], settings: Settings) -> None:
    url = str(output["remote_url"])
    parsed = urlparse(url)
    if parsed.scheme not in {"https", "http"} or not parsed.hostname or parsed.username is not None:
        raise invalid_output()
    path: Path | None = None
    deadline = time.monotonic() + IMAGE_DOWNLOAD_TIMEOUT_SECONDS
    try:
        with requests.get(url, stream=True, timeout=IMAGE_PROBE_TIMEOUT_SECONDS) as response:
            response.raise_for_status()
            settings.asset_storage_dir.mkdir(parents=True, exist_ok=True)
            content_type = str(response.headers.get("Content-Type") or "image/png").split(";", 1)[0].strip().lower()
            with tempfile.NamedTemporaryFile(prefix="canvas-original-", dir=settings.asset_storage_dir, delete=False) as stream:
                path = Path(stream.name)
                for chunk in response.iter_content(chunk_size=IMAGE_DOWNLOAD_CHUNK_BYTES):
                    if time.monotonic() > deadline or stream.tell() + len(chunk) > IMAGE_DOWNLOAD_MAX_BYTES:
                        raise invalid_output()
                    stream.write(chunk)
            if not path.stat().st_size:
                raise invalid_output()
        output.update(path=str(path), content_type=content_type, size=path.stat().st_size)
    except (requests.RequestException, OSError, ImageOutputValidationError) as exc:
        if path is not None:
            path.unlink(missing_ok=True)
        raise invalid_output() from exc


def read_image_dimensions(path: Path, settings: Settings) -> tuple[int, int]:
    ffmpeg = Path(settings.ffmpeg_bin)
    ffprobe = str(ffmpeg.with_name("ffprobe.exe" if ffmpeg.suffix.lower() == ".exe" else "ffprobe"))
    try:
        completed = subprocess.run(
            [ffprobe, "-v", "error", "-protocol_whitelist", "file,pipe", "-select_streams", "v:0",
             "-show_entries", "stream=width,height", "-of", "json", str(path)],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=IMAGE_PROBE_TIMEOUT_SECONDS, check=True,
        )
        stream = json.loads(completed.stdout)["streams"][0]
        width, height = int(stream["width"]), int(stream["height"])
        if width > 0 and height > 0:
            return width, height
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, IndexError, TypeError):
        pass
    raise invalid_output()
