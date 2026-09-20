"""Small, private video posters shared with the Go API through the asset volume."""
from __future__ import annotations

import hashlib
import os
import subprocess
import logging
import tempfile
import time
from pathlib import Path

POSTER_WIDTH = 640
POSTER_TIMEOUT_SECONDS = 15
POSTER_MAX_BYTES = 2 * 1024 * 1024
# One sequential scan also covers uploads and SD-video bridge results.
POSTER_SCAN_SECONDS = 30
POSTER_SCAN_BATCH = 100
POSTER_RETRY_SECONDS = 300
POSTER_WORK_PER_SCAN = 10


def create_video_poster(root: Path, source: Path, asset_id: str, content_hash: str) -> bool:
    # Content-addressed filenames must match handler/asset_video_poster.go.
    name = hashlib.sha256((asset_id + "/" + content_hash).encode()).hexdigest() + ".jpg"
    folder = root / ".video-posters"
    target = folder / name
    try:
        if target.is_file():
            return True
        folder.mkdir(parents=True, exist_ok=True)
        result = subprocess.run(
            ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-threads", "1",
             "-protocol_whitelist", "file,pipe", "-i", str(source), "-frames:v", "1", "-vf", f"scale='min({POSTER_WIDTH},iw)':-2",
             "-threads", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=POSTER_TIMEOUT_SECONDS,
            check=True,
        )
        if not result.stdout.startswith(b"\xff\xd8") or len(result.stdout) > POSTER_MAX_BYTES:
            return False
        # A failed optional preview must never fail a completed paid generation.
        temporary = target.with_suffix(f".{os.getpid()}.tmp")
        temporary.write_bytes(result.stdout)
        temporary.replace(target)
        return True
    except (OSError, subprocess.SubprocessError):
        return False


def run_poster_worker(stop, settings):
    """Best-effort derived previews; never create jobs or contact a model Provider."""
    if not settings.database_url:
        return
    import psycopg
    from psycopg.rows import dict_row
    from .assets import asset_storage_key, extension_for_output
    from . import object_storage
    logger = logging.getLogger(__name__)
    deferred = {}
    while not stop.is_set():
        try:
            with psycopg.connect(settings.database_url, row_factory=dict_row) as connection:
                connection.execute("SET TRANSACTION READ ONLY")
                rows = connection.execute(
                    "SELECT id,workspace_id,content_type,content_sha256 FROM assets "
                    "WHERE type='video' AND trashed_at IS NULL ORDER BY created_at DESC LIMIT %s",
                    (POSTER_SCAN_BATCH,),
                ).fetchall()
            deferred = {key: until for key, until in deferred.items() if until > time.monotonic()}
            attempted = 0
            for row in rows:
                if stop.is_set():
                    return
                digest = str(row.get("content_sha256") or "")
                name = hashlib.sha256((row["id"] + "/" + digest).encode()).hexdigest() + ".jpg"
                if (settings.asset_storage_dir / ".video-posters" / name).is_file():
                    continue
                if name in deferred:
                    continue
                if attempted >= POSTER_WORK_PER_SCAN:
                    break
                attempted += 1
                deferred[name] = time.monotonic() + POSTER_RETRY_SECONDS
                extension = extension_for_output(Path("source"), row["content_type"], "video")
                key = asset_storage_key(row["workspace_id"], row["id"], extension)
                source = settings.asset_storage_dir / key
                try:
                    if source.is_file():
                        create_video_poster(settings.asset_storage_dir, source, row["id"], digest)
                    elif object_storage.enabled():
                        with tempfile.TemporaryDirectory(prefix="studio-poster-") as temporary:
                            downloaded = Path(temporary) / ("source" + extension)
                            object_storage.download(key.as_posix(), downloaded)
                            create_video_poster(settings.asset_storage_dir, downloaded, row["id"], digest)
                except Exception:
                    # Do not log signed URLs, paths, or Storage credentials.
                    logger.warning("video poster deferred")
        except Exception:
            logger.warning("video poster scan deferred")
        stop.wait(POSTER_SCAN_SECONDS)
