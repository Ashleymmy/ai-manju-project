"""只解码本地受限临时文件，不允许 ffmpeg 根据媒体引用访问网络。"""
import asyncio
import hashlib
import io
import logging
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageOps

MAX_THUMBNAIL_SOURCE_BYTES = 128 * 1024 * 1024
MAX_THUMBNAIL_PIXELS = 40_000_000
THUMBNAIL_SIZE = (640, 360)
THUMBNAIL_PROCESS_SECONDS = 30


class UnsupportedMedia(ValueError):
    pass


def render_thumbnail(body, kind):
    if len(body) > MAX_THUMBNAIL_SOURCE_BYTES:
        raise UnsupportedMedia("thumbnail source exceeds size limit")
    if kind == "video":
        if b"ftyp" not in body[:32]: raise UnsupportedMedia("preview requires an MP4 container")
        with tempfile.TemporaryDirectory(prefix="sdvideo-thumbnail-") as directory:
            source, output = Path(directory) / "source.mp4", Path(directory) / "preview.jpg"
            source.write_bytes(body)
            command = ["ffmpeg", "-nostdin", "-v", "error", "-threads", "1", "-protocol_whitelist", "file",
                       "-max_alloc", "67108864", "-f", "mov", "-enable_drefs", "0", "-use_absolute_path", "0",
                       "-i", str(source), "-map", "0:v:0", "-frames:v", "1",
                       "-vf", "scale=640:360:force_original_aspect_ratio=decrease", "-threads", "1", "-y", str(output)]
            # stderr 可能含媒体元数据，仅丢弃，不进入日志或 HTTP 错误。
            result = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                    stderr=subprocess.DEVNULL, timeout=THUMBNAIL_PROCESS_SECONDS)
            if result.returncode != 0 or not output.exists(): raise UnsupportedMedia("video decode failed")
            body = output.read_bytes()
    elif kind != "image":
        raise UnsupportedMedia("unsupported thumbnail kind")
    try:
        with Image.open(io.BytesIO(body)) as image:
            if image.width * image.height > MAX_THUMBNAIL_PIXELS: raise UnsupportedMedia("image exceeds pixel limit")
            image = ImageOps.exif_transpose(image)
            image.thumbnail(THUMBNAIL_SIZE)
            output = io.BytesIO()
            image.convert("RGB").save(output, "JPEG", quality=85)
            return output.getvalue()
    except (OSError, Image.DecompressionBombError) as exc:
        raise UnsupportedMedia("image decode failed") from exc


async def process_thumbnail(store, storage, kind, item):
    key = None
    try:
        if int(item.get("size_bytes") or 0) > MAX_THUMBNAIL_SOURCE_BYTES: raise UnsupportedMedia("source too large")
        body = await asyncio.wait_for(storage.get(item["storage_key"]), 30)
        thumbnail = await asyncio.to_thread(render_thumbnail, body, item["kind"])
        # 每次租约拥有独立对象键，旧持有者清理孤儿时不会删掉新持有者的结果。
        suffix = hashlib.sha256(item["thumbnail_lease_owner"].encode()).hexdigest()[:24]
        key = f"thumbnails/{item['workspace_id']}/{item['owner_subject']}/{kind}-{item['id']}-{suffix}.jpg"
        await asyncio.wait_for(storage.put(key, thumbnail, "image/jpeg"), 20)
        if not await store.finish(kind, item, key=key):
            await storage.delete(key)
    except Exception as exc:
        error = "unsupported_media" if isinstance(exc, UnsupportedMedia) else "thumbnail_retry_pending"
        await store.finish(kind, item, error=error)
        logging.getLogger("sdvideo.thumbnails").warning("thumbnail deferred category=%s", type(exc).__name__)


async def thumbnail_loop():
    from app.thumbnail_store import build_thumbnail_store
    from app.standalone_api import local_storage
    store = build_thumbnail_store()
    while True:
        try:
            for kind in ("media", "volcano"):
                item = await store.claim(kind)
                if item: await process_thumbnail(store, local_storage, kind, item)
        except Exception as exc:
            logging.getLogger("sdvideo.thumbnails").warning("thumbnail worker unavailable category=%s", type(exc).__name__)
        await asyncio.sleep(5)
