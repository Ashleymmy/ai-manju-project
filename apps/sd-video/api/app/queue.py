"""Small Redis boundary shared by the API and Worker.

Redis is optional in local unit tests.  When unavailable, the durable Worker
falls back to polling PostgreSQL, so a transient queue outage cannot lose a
task created by the API.
"""

from __future__ import annotations

import json
from typing import Any


class RedisTaskQueue:
    def __init__(self, url: str, key: str = "sdvideo:tasks") -> None:
        self.url = url.strip()
        self.key = key

    async def enqueue(self, task_id: str) -> bool:
        if not self.url:
            return False
        try:
            import redis.asyncio as redis

            client = redis.from_url(self.url, decode_responses=True)
            try:
                await client.rpush(self.key, json.dumps({"task_id": task_id}))
            finally:
                await client.aclose()
            return True
        except Exception:
            return False

    async def receive(self, timeout: int = 5) -> str | None:
        if not self.url:
            return None
        try:
            import redis.asyncio as redis

            client = redis.from_url(self.url, decode_responses=True)
            try:
                item = await client.blpop(self.key, timeout=timeout)
            finally:
                await client.aclose()
            if not item:
                return None
            raw = item[1] if isinstance(item, (list, tuple)) else item
            try:
                payload: Any = json.loads(raw)
                return str(payload.get("task_id") or "") or None
            except (TypeError, ValueError):
                return str(raw) or None
        except Exception:
            return None


class NullTaskQueue(RedisTaskQueue):
    def __init__(self) -> None:
        super().__init__("")


def build_queue(settings: object) -> RedisTaskQueue:
    url = str(getattr(settings, "REDIS_URL", "") or "").strip()
    return RedisTaskQueue(url) if url else NullTaskQueue()
