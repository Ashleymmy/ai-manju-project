from __future__ import annotations

import mimetypes
import re
import secrets
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from urllib.parse import urlparse

from PIL import Image, ImageOps, UnidentifiedImageError


ALLOWED_IMAGE_TYPES = {
    "image/bmp": ".bmp",
    "image/gif": ".gif",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/tiff": ".tiff",
    "image/webp": ".webp",
}
FORMAT_TO_CONTENT_TYPE = {
    "BMP": "image/bmp",
    "GIF": "image/gif",
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "TIFF": "image/tiff",
    "WEBP": "image/webp",
}
MAX_IMAGE_PIXELS = 40_000_000
ASSET_TOKEN_PATTERN = re.compile(r"[a-f0-9]{32}\.(?:bmp|gif|jpg|png|tiff|webp)")


class LocalPublicAssetError(RuntimeError):
    pass


@dataclass(frozen=True)
class PreparedImage:
    data: bytes
    content_type: str
    extension: str
    optimized: bool


@dataclass(frozen=True)
class LocalPublicAsset:
    token: str
    storage_path: str
    uploaded_bytes: int
    optimized: bool


def _encode_jpeg(image: Image.Image, target_bytes: int) -> bytes:
    if image.mode in {"RGBA", "LA"} or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        background = Image.new("RGBA", rgba.size, "white")
        background.alpha_composite(rgba)
        rgb = background.convert("RGB")
    else:
        rgb = image.convert("RGB")

    for max_edge in (2048, 1600, 1280, 1024, 768, 512):
        candidate = rgb.copy()
        candidate.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        for quality in (88, 82, 76, 70, 64, 58, 50):
            output = BytesIO()
            candidate.save(output, format="JPEG", quality=quality, optimize=True, progressive=True)
            encoded = output.getvalue()
            if len(encoded) <= target_bytes:
                return encoded
    raise LocalPublicAssetError("image cannot be reduced below the local public asset limit")


def prepare_image(
    file_data: bytes,
    *,
    max_bytes: int,
    target_bytes: int,
) -> PreparedImage:
    if not file_data:
        raise LocalPublicAssetError("image file is empty")
    if len(file_data) > max_bytes:
        raise LocalPublicAssetError(f"image exceeds local upload limit ({max_bytes} bytes)")

    try:
        with Image.open(BytesIO(file_data)) as source:
            actual_type = FORMAT_TO_CONTENT_TYPE.get(source.format or "")
            if actual_type not in ALLOWED_IMAGE_TYPES:
                raise LocalPublicAssetError("image format is unsupported")
            if source.width * source.height > MAX_IMAGE_PIXELS:
                raise LocalPublicAssetError("image dimensions exceed the local safety limit")
            source.load()
            if len(file_data) <= target_bytes:
                return PreparedImage(
                    data=file_data,
                    content_type=actual_type,
                    extension=ALLOWED_IMAGE_TYPES[actual_type],
                    optimized=False,
                )
            normalized = ImageOps.exif_transpose(source)
            encoded = _encode_jpeg(normalized, target_bytes)
    except LocalPublicAssetError:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise LocalPublicAssetError("image data is invalid or unsupported") from exc

    return PreparedImage(
        data=encoded,
        content_type="image/jpeg",
        extension=".jpg",
        optimized=True,
    )


def _asset_root(root_dir: str) -> Path:
    root = Path(root_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _asset_token(value: str) -> str:
    token = value or ""
    if not ASSET_TOKEN_PATTERN.fullmatch(token):
        raise LocalPublicAssetError("invalid local public asset token")
    return token


def store_local_public_image(
    file_data: bytes,
    *,
    root_dir: str,
    max_bytes: int,
    target_bytes: int,
) -> LocalPublicAsset:
    prepared = prepare_image(
        file_data,
        max_bytes=max_bytes,
        target_bytes=target_bytes,
    )
    root = _asset_root(root_dir)
    token = f"{secrets.token_hex(16)}{prepared.extension}"
    target = root / token
    target.write_bytes(prepared.data)
    return LocalPublicAsset(
        token=token,
        storage_path=f"local_public/{token}",
        uploaded_bytes=len(prepared.data),
        optimized=prepared.optimized,
    )


def resolve_local_public_asset(root_dir: str, token: str) -> Path:
    root = _asset_root(root_dir)
    target = (root / _asset_token(token)).resolve()
    if target.parent != root or not target.is_file():
        raise LocalPublicAssetError("local public asset does not exist")
    return target


def delete_local_public_asset(root_dir: str, storage_path: str) -> bool:
    match = re.fullmatch(r"local_public/(.+)", storage_path or "")
    if not match:
        raise LocalPublicAssetError("invalid local public asset storage path")
    root = _asset_root(root_dir)
    target = (root / _asset_token(match.group(1))).resolve()
    if target.parent != root:
        raise LocalPublicAssetError("invalid local public asset path")
    target.unlink(missing_ok=True)
    return True


def build_public_asset_url(base_url: str, token: str) -> str:
    parsed = urlparse((base_url or "").strip())
    if parsed.scheme != "https" or not parsed.hostname or parsed.query or parsed.fragment:
        raise LocalPublicAssetError("local public asset base URL must be an HTTPS origin")
    return f"{base_url.rstrip('/')}/api/local-assets/{_asset_token(token)}"


def content_type_for_asset(path: Path) -> str:
    return mimetypes.guess_type(path.name)[0] or "application/octet-stream"
