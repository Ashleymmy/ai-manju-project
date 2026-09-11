"""Worker process entrypoint.

The production runner will consume the durable task queue.  Keeping a separate
entrypoint now prevents the API container from inheriting the legacy lifespan
poller and provides a stable deployment boundary for Provider migration.
"""

import asyncio
import logging
import os
import sys
import json

from app.config import settings
from app.queue import build_queue
from app.standalone_api import task_store
from worker.processor import process_task
from app.runtime_health import dependency_health, worker_heartbeat

if sys.platform == "win32" and hasattr(asyncio, "WindowsSelectorEventLoopPolicy"):
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


async def _health_client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        await reader.read(1024)
        checks = await dependency_health()
        healthy = all(checks.values())
        body = json.dumps({"status": "ok" if healthy else "not_ready", "service": "sd-video-worker", "checks": checks}).encode()
        writer.write((b"HTTP/1.1 200 OK" if healthy else b"HTTP/1.1 503 Service Unavailable") + b"\r\nContent-Type: application/json\r\nContent-Length: " + str(len(body)).encode() + b"\r\nConnection: close\r\n\r\n" + body)
        await writer.drain()
    finally:
        writer.close()
        await writer.wait_closed()


async def _health_server(port: int) -> None:
    server = await asyncio.start_server(_health_client, "0.0.0.0", port)
    async with server:
        await server.serve_forever()


async def _worker_loop(interval: int, logger: logging.Logger) -> None:
    queue = build_queue(settings)
    while True:
        task_id = await queue.receive(timeout=min(interval, 10))
        record = None
        if task_id and hasattr(task_store, "claim"):
            record = await task_store.claim(task_id)
        elif task_id:
            record = await task_store.get_by_id(task_id)
        # PostgreSQL is the source of truth.  Polling it on every pass gives
        # restart recovery and protects against a Redis outage or lost queue
        # message.  ``claim_next`` atomically prevents two workers from taking
        # the same queued row.
        if record is None and hasattr(task_store, "claim_next"):
            record = await task_store.claim_next()
        if record is None:
            await asyncio.sleep(interval)
            continue
        try:
            await process_task(record)
        except Exception:
            logger.exception("unhandled task processor error task=%s", record.id)


async def run() -> None:
    interval = max(1, int(os.getenv("SDVIDEO_WORKER_INTERVAL_SECONDS", "10")))
    health_port = max(1, int(os.getenv("SDVIDEO_WORKER_HEALTH_PORT", "8202")))
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    logger = logging.getLogger("sdvideo.worker")
    logger.info("standalone SD-video worker started mode=%s rollout=%s", settings.EXECUTION_MODE, settings.SD_VIDEO_MODE)
    await asyncio.gather(_worker_loop(interval, logger), _health_server(health_port), worker_heartbeat("task"))


if __name__ == "__main__":
    asyncio.run(run())
