"""Measure finished local videos; never infer billable duration from a request."""
from __future__ import annotations

import json
import logging
import math
import subprocess
import tempfile
import time
from pathlib import Path

# Probe only local, completed media. Playlists and network protocols are excluded.
METRIC_TIMEOUT_SECONDS = 10
METRIC_MAX_JSON_BYTES = 64 * 1024
METRIC_MAX_DURATION_SECONDS = 24 * 60 * 60
METRIC_MAX_DIMENSION = 16384
METRIC_SCAN_SECONDS = 15
METRIC_SCAN_BATCH = 3
METRIC_RETRY_SECONDS = 300
logger = logging.getLogger(__name__)


def probe_video_metrics(source: Path, settings) -> dict | None:
    try:
        if not source.is_file() or source.stat().st_size <= 0:
            return None
        executable = Path(settings.ffmpeg_bin).with_name("ffprobe" + Path(settings.ffmpeg_bin).suffix)
        # A file bounds memory even if a malformed input makes ffprobe verbose.
        with tempfile.TemporaryFile() as output:
            subprocess.run(
                [str(executable), "-v", "error", "-protocol_whitelist", "file,pipe",
                 "-format_whitelist", "mov,matroska,webm,avi,ogg,mpegts,mpeg",
                 "-select_streams", "v:0", "-show_entries",
                 "stream=codec_type,duration,width,height:format=duration", "-of", "json", str(source.resolve())],
                stdout=output, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL,
                timeout=METRIC_TIMEOUT_SECONDS, check=True,
            )
            output.seek(0)
            raw = output.read(METRIC_MAX_JSON_BYTES + 1)
        if len(raw) > METRIC_MAX_JSON_BYTES:
            return None
        metadata = json.loads(raw)
        stream = next(s for s in metadata.get("streams", []) if s.get("codec_type") == "video")
        duration = stream.get("duration")
        if duration in (None, "N/A"):
            duration = metadata.get("format", {}).get("duration")
        duration = float(duration)
        width, height = int(stream["width"]), int(stream["height"])
        if (not math.isfinite(duration) or not 0 < duration <= METRIC_MAX_DURATION_SECONDS
                or not 0 < width <= METRIC_MAX_DIMENSION or not 0 < height <= METRIC_MAX_DIMENSION):
            return None
        return {"version": 1, "source": "ffprobe", "duration_seconds": duration, "width": width, "height": height}
    except (OSError, subprocess.SubprocessError, ValueError, TypeError, KeyError, StopIteration, AttributeError):
        return None


def backfill_video_metrics(connection, settings, after_id: str = "", deferred: dict | None = None) -> str:
    """Recover metrics for bridge results or a previously unavailable encoder.

    Keyset scans prevent one bad media file from starving later settlements.
    Only the generated asset belonging to this successful job may be measured.
    """
    from psycopg.types.json import Jsonb
    from . import object_storage
    from .assets import asset_storage_key, extension_for_output, file_sha256

    deferred = deferred if deferred is not None else {}
    rows = connection.execute(
        "SELECT c.id consumption_id,j.id job_id,a.id asset_id,a.workspace_id,a.content_type,a.content_sha256 "
        "FROM task_consumptions c JOIN jobs j ON j.id=c.job_id "
        "JOIN assets a ON a.id=COALESCE(j.result->>'asset_id',j.result->'outputs'->0->>'asset_id') "
        "AND a.source_job_id=j.id AND a.user_id=j.user_id AND a.workspace_id=j.workspace_id "
        "AND a.content_sha256=j.result->>'video_content_sha256' AND a.content_sha256<>'' "
        "WHERE c.status='reserved' AND c.params->>'billing_mode'='actual_video_duration' "
        "AND j.status='succeeded' AND j.type='video.generate' AND a.type='video' "
        "AND COALESCE(j.result->'video_metrics'->>'source','')<>'ffprobe' "
        "AND c.id>%s ORDER BY c.id LIMIT %s", (after_id, METRIC_SCAN_BATCH),
    ).fetchall()
    connection.commit()
    if not rows:
        return ""
    for row in rows:
        job_id = row["job_id"]
        if deferred.get(job_id, 0) > time.monotonic():
            continue
        deferred[job_id] = time.monotonic() + METRIC_RETRY_SECONDS
        try:
            extension = extension_for_output(Path("source"), row["content_type"], "video")
            key = asset_storage_key(row["workspace_id"], row["asset_id"], extension)
            source = settings.asset_storage_dir / key
            if source.is_file():
                metrics = probe_video_metrics(source, settings) if file_sha256(source) == row["content_sha256"] else None
            elif object_storage.enabled():
                with tempfile.TemporaryDirectory(prefix="studio-video-metrics-") as temporary:
                    local = Path(temporary) / ("source" + extension)
                    object_storage.download(key.as_posix(), local)
                    metrics = probe_video_metrics(local, settings) if file_sha256(local) == row["content_sha256"] else None
            else:
                metrics = None
            if metrics is None:
                continue
            connection.execute(
                "UPDATE jobs SET result=jsonb_set(COALESCE(result,'{}'::jsonb),'{video_metrics}',%s),updated_at=NOW() "
                "WHERE id=%s AND status='succeeded' "
                "AND COALESCE(result->>'asset_id',result->'outputs'->0->>'asset_id')=%s "
                "AND result->>'video_content_sha256'=%s "
                "AND COALESCE(result->'video_metrics'->>'source','')<>'ffprobe'",
                (Jsonb(metrics), job_id, row["asset_id"], row["content_sha256"]),
            )
            connection.commit()
        except Exception:
            connection.rollback()
            logger.warning("video metric recovery deferred job_id=%s", job_id)
    return rows[-1]["consumption_id"]


def run_video_metrics_worker(stop, settings):
    if not settings.database_url:
        return
    import psycopg
    from psycopg.rows import dict_row
    cursor, deferred = "", {}
    while not stop.is_set():
        try:
            deferred = {key: until for key, until in deferred.items() if until > time.monotonic()}
            with psycopg.connect(settings.database_url, row_factory=dict_row) as connection:
                cursor = backfill_video_metrics(connection, settings, cursor, deferred)
        except Exception:
            # Never expose database/storage credentials, paths or signed URLs.
            logger.warning("video metric recovery scan deferred")
        stop.wait(METRIC_SCAN_SECONDS)
