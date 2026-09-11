"""健康检查验证实际依赖；错误响应只给出组件名，不回传连接串。"""
import asyncio
import tempfile
import logging
import shutil
import uuid
from pathlib import Path

import psycopg
import redis.asyncio as redis

from app.config import settings

# 跨容器 PID 可重复，启动实例使用独立随机标识；指标不暴露实例凭证或路径。
HEARTBEAT_INSTANCE = uuid.uuid4().hex
TASK_STATES = ("queued", "running", "cancel_requested", "succeeded", "failed", "canceled")


async def probe_storage():
    from app.standalone_api import local_storage
    if settings.STORAGE_BACKEND == "local":
        def probe():
            with tempfile.TemporaryFile(dir=Path(settings.DATA_DIR)) as stream:
                stream.write(b"health")
                stream.flush()
        await asyncio.to_thread(probe)
    elif settings.STORAGE_BACKEND == "oss":
        for prefix in ("inputs", "results", "thumbnails", "volcano"):
            await asyncio.to_thread(local_storage._bucket(f"{prefix}/.health").object_exists, f"{prefix}/.health")
    elif settings.STORAGE_BACKEND == "s3":
        await asyncio.to_thread(local_storage._client().head_bucket, Bucket=settings.S3_BUCKET)
    elif settings.STORAGE_BACKEND == "supabase":
        await local_storage.probe()
    else:
        raise ValueError("storage readiness probe is not supported")


async def dependency_health():
    async def database():
        if not settings.DATABASE_URL:
            if settings.APP_ENV == "production": raise ValueError("database required")
            return
        async with await psycopg.AsyncConnection.connect(settings.DATABASE_URL) as connection:
            await connection.execute("select next_poll_at from tasks limit 1")

    async def queue():
        if not settings.REDIS_URL:
            if settings.APP_ENV == "production": raise ValueError("queue required")
            return
        async with redis.from_url(settings.REDIS_URL, socket_connect_timeout=2, socket_timeout=2) as client:
            await client.ping()

    async def bounded(name, fn):
        try:
            await asyncio.wait_for(fn(), 5)
            return name, True
        except Exception:
            return name, False
    return dict(await asyncio.gather(bounded("database", database), bounded("queue", queue), bounded("storage", probe_storage)))


async def worker_heartbeat(role):
    while True:
        if settings.REDIS_URL:
            try:
                async with redis.from_url(settings.REDIS_URL, socket_connect_timeout=2, socket_timeout=2) as client:
                    await client.set(f"sdvideo:heartbeat:{role}:{HEARTBEAT_INSTANCE}", "1", ex=20)
            except Exception as exc:
                logging.getLogger("sdvideo.health").warning("heartbeat unavailable role=%s category=%s", role, type(exc).__name__)
        await asyncio.sleep(5)


async def metrics_text():
    lines = ["# TYPE sdvideo_dependency_up gauge"]
    checks = await dependency_health()
    for name, healthy in checks.items(): lines.append(f'sdvideo_dependency_up{{dependency="{name}"}} {int(healthy)}')
    if settings.DATABASE_URL and checks["database"]:
        async with await psycopg.AsyncConnection.connect(settings.DATABASE_URL) as connection:
            cursor = await connection.execute("select status,count(*) from tasks group by status")
            counts = dict(await cursor.fetchall())
            for state in TASK_STATES:
                lines.append(f'sdvideo_tasks{{status="{state}"}} {counts.get(state, 0)}')
            cursor = await connection.execute("select coalesce(max(extract(epoch from now()-created_at)),0) from tasks where status='queued'")
            lines.append(f"sdvideo_oldest_queued_seconds {max(0, float((await cursor.fetchone())[0]))}")
            cursor = await connection.execute("select count(*) from tasks where status in ('running','cancel_requested') and lease_expires_at<now()")
            lines.append(f"sdvideo_expired_task_leases {int((await cursor.fetchone())[0])}")
            cursor = await connection.execute("select count(*) from tasks where error->>'code'='submission_uncertain'")
            lines.append(f"sdvideo_submission_uncertain {int((await cursor.fetchone())[0])}")
            cursor = await connection.execute("select count(*) from volcano_assets where status='failed' or error is not null")
            lines.append(f"sdvideo_asset_failures {int((await cursor.fetchone())[0])}")
            cursor = await connection.execute("select (select count(*) from media_library where thumbnail_error is not null)+(select count(*) from volcano_assets where thumbnail_error is not null and status not in ('deleted','delete_requested'))")
            lines.append(f"sdvideo_thumbnail_failures {int((await cursor.fetchone())[0])}")
    if settings.REDIS_URL and checks["queue"]:
        async with redis.from_url(settings.REDIS_URL, socket_connect_timeout=2, socket_timeout=2) as client:
            for role in ("task", "asset"):
                count = 0
                async for key in client.scan_iter(match=f"sdvideo:heartbeat:{role}:*", count=100): count += 1
                lines.append(f'sdvideo_worker_heartbeats{{role="{role}"}} {count}')
    for name, path in (("temporary", tempfile.gettempdir()), ("data", settings.DATA_DIR)):
        try:
            usage = shutil.disk_usage(path)
            lines.extend([f'sdvideo_disk_free_bytes{{volume="{name}"}} {usage.free}',
                          f'sdvideo_disk_size_bytes{{volume="{name}"}} {usage.total}',
                          f'sdvideo_disk_probe_up{{volume="{name}"}} 1'])
        except OSError:
            lines.append(f'sdvideo_disk_probe_up{{volume="{name}"}} 0')
    return "\n".join(lines) + "\n"
