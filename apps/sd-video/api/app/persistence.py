"""Durable stores for the standalone SD-video service.

The API deliberately keeps a small in-memory implementation for unit tests and
offline development.  Production containers select these stores whenever
``SDVIDEO_DATABASE_URL`` is configured.  The SQL is scoped by both workspace
and owner; callers never need to pass a user id from the request body.
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, AsyncIterator

import psycopg
from psycopg.rows import dict_row

from app.config import settings
from app.core.auth import ServicePrincipal
from app.catalog_queries import MediaFilter, Page, select_page


TERMINAL_STATUSES = {"succeeded", "failed", "canceled"}


def _now() -> float:
    return time.time()


def _as_timestamp(value: float | None) -> datetime | None:
    return datetime.fromtimestamp(value, tz=timezone.utc) if value is not None else None


def _as_float(value: Any) -> float:
    if isinstance(value, datetime):
        return value.timestamp()
    return float(value or 0)


@dataclass
class TaskRecord:
    id: str
    owner_subject: str
    workspace_id: str
    model: str
    prompt: str | None
    provider: str = ""
    status: str = "queued"
    progress: int = 0
    created_at: float = field(default_factory=_now)
    updated_at: float = field(default_factory=_now)
    attempt: int = 1
    request: dict[str, Any] = field(default_factory=dict)
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None
    provider_task_id: str | None = None
    result_storage_key: str | None = None
    lease_owner: str | None = None
    lease_expires_at: float | None = None
    cancel_requested: bool = False
    cancel_requested_at: float | None = None
    mock_ready_at: float | None = None
    submission_started_at: float | None = None
    retry_of: str | None = None


class PostgresTaskStore:
    """Async PostgreSQL task repository used by API and Worker processes."""

    def __init__(self, database_url: str):
        self.database_url = database_url

    @asynccontextmanager
    async def _connection(self) -> AsyncIterator[psycopg.AsyncConnection[Any]]:
        connection = await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row)
        try:
            yield connection
        finally:
            await connection.close()

    @staticmethod
    def _record(row: dict[str, Any]) -> TaskRecord:
        return TaskRecord(
            id=str(row["id"]), owner_subject=str(row["owner_subject"]), workspace_id=str(row["workspace_id"]),
            model=str(row["model"]), prompt=row.get("prompt"), provider=str(row.get("provider") or ""),
            status=str(row.get("status") or "queued"), progress=int(row.get("progress") or 0),
            created_at=_as_float(row.get("created_at")), updated_at=_as_float(row.get("updated_at")),
            attempt=int(row.get("attempt") or 1), request=row.get("request") or {}, result=row.get("result"),
            error=row.get("error"), provider_task_id=row.get("provider_task_id"), result_storage_key=row.get("result_storage_key"),
            cancel_requested=bool(row.get("cancel_requested_at")),
            cancel_requested_at=_as_float(row["cancel_requested_at"]) if row.get("cancel_requested_at") else None,
            lease_owner=row.get("lease_owner"),
            lease_expires_at=_as_float(row["lease_expires_at"]) if row.get("lease_expires_at") else None,
            submission_started_at=_as_float(row["submission_started_at"]) if row.get("submission_started_at") else None,
            retry_of=row.get("retry_of"),
        )

    async def create(self, principal: ServicePrincipal, request: Any) -> tuple[TaskRecord, bool]:
        payload = request.model_dump(mode="json") if hasattr(request, "model_dump") else dict(request)
        task_id = f"sdv_{uuid.uuid4().hex}"
        provider = str(payload.get("provider") or "")
        async with self._connection() as connection:
            async with connection.cursor() as cursor:
                for reference in payload.get("references") or []:
                    if not reference.get("storage_token"): continue
                    await cursor.execute("select status from input_objects where storage_key=%s and owner_subject=%s and workspace_id=%s for update", (reference["storage_token"], principal.subject, principal.workspace_id))
                    registered = await cursor.fetchone()
                    if not registered or registered["status"] != "complete": raise ValueError("input is not complete")
                await cursor.execute(
                    """
                    insert into tasks (id, owner_subject, workspace_id, idempotency_key, model, provider, prompt, status, progress, attempt, request, retry_of)
                    values (%s,%s,%s,%s,%s,%s,%s,'queued',0,%s,%s::jsonb,%s)
                    on conflict (workspace_id, owner_subject, idempotency_key) do nothing
                    returning *
                    """,
                    (task_id, principal.subject, principal.workspace_id, payload["idempotency_key"], payload["model"], provider, payload.get("prompt"), int(payload.get("attempt", 1)), json.dumps(payload), payload.get("retry_of")),
                )
                row = await cursor.fetchone()
                if row is None:
                    await cursor.execute(
                        "select * from tasks where workspace_id=%s and owner_subject=%s and idempotency_key=%s",
                        (principal.workspace_id, principal.subject, payload["idempotency_key"]),
                    )
                    row = await cursor.fetchone()
                    if row is None:
                        raise RuntimeError("task idempotency lookup failed")
                    await connection.commit()
                    return self._record(row), False
                await cursor.execute(
                    "insert into task_events(task_id,status,progress,payload) values (%s,'queued',0,%s::jsonb)",
                    (task_id, json.dumps({"attempt": int(payload.get("attempt", 1))})),
                )
            await connection.commit()
        return self._record(row), True

    async def get(self, principal: ServicePrincipal, task_id: str) -> TaskRecord | None:
        async with self._connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("select * from tasks where id=%s and workspace_id=%s and owner_subject=%s", (task_id, principal.workspace_id, principal.subject))
                row = await cursor.fetchone()
        return self._record(row) if row else None

    async def get_by_id(self, task_id: str) -> TaskRecord | None:
        async with self._connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("select * from tasks where id=%s", (task_id,))
                row = await cursor.fetchone()
        return self._record(row) if row else None

    async def list(self, principal: ServicePrincipal) -> list[TaskRecord]:
        async with self._connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("select * from tasks where workspace_id=%s and owner_subject=%s order by created_at desc", (principal.workspace_id, principal.subject))
                rows = await cursor.fetchall()
        return [self._record(row) for row in rows]

    async def page(self, principal: ServicePrincipal, page: Page) -> dict:
        async with self._connection() as connection:
            result = await select_page(connection, page, columns="*",
                source="from tasks where workspace_id=%s and owner_subject=%s",
                parameters=[principal.workspace_id, principal.subject], order="created_at desc,id desc")
        result["items"] = [self._record(row) for row in result["items"]]
        return result

    async def update(self, task_id: str, **changes: Any) -> TaskRecord | None:
        lease_owner = changes.pop("expected_lease", None)
        expected_error = changes.pop("expected_error_code", None)
        allowed = {"status", "progress", "result", "error", "provider", "provider_task_id", "result_storage_key", "attempt", "request", "lease_owner", "lease_expires_at", "submission_started_at", "next_poll_at"}
        values = {key: value for key, value in changes.items() if key in allowed}
        if "cancel_requested" in changes:
            values["cancel_requested_at"] = _as_timestamp(_now()) if changes["cancel_requested"] else None
        if not values:
            return await self.get_by_id(task_id)
        assignments: list[str] = []
        params: list[Any] = []
        for key, value in values.items():
            if key in {"result", "error", "request"}:
                assignments.append(f"{key}=%s::jsonb")
                params.append(json.dumps(value) if value is not None else None)
            else:
                assignments.append(f"{key}=%s")
                params.append(value)
        params.append(task_id)
        conditions = "id=%s"
        if expected_error is not None:
            conditions += " and error->>'code'=%s"
            params.append(expected_error)
        if lease_owner is not None:
            conditions += " and lease_owner=%s and lease_expires_at>now()"
            params.append(lease_owner)
        if "submission_started_at" in values:
            conditions += " and cancel_requested_at is null and status not in ('succeeded','failed','canceled')"
        # 终态不可被迟到的轮询或取消覆盖；取消请求优先于成功回填。
        if "status" in values:
            if values["status"] == "canceled" and changes.get("cancel_requested") is True:
                conditions += " and (status not in ('succeeded','failed','canceled') or (status='failed' and error->>'code'='submission_uncertain'))"
            else:
                conditions += " and status not in ('succeeded','failed','canceled')"
            if values["status"] in {"running", "succeeded"}:
                conditions += " and cancel_requested_at is null"
        async with self._connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(f"update tasks set {', '.join(assignments)}, updated_at=now() where {conditions} returning *", params)
                row = await cursor.fetchone()
                if row:
                    await cursor.execute("insert into task_events(task_id,status,progress,payload) values (%s,%s,%s,%s::jsonb)", (task_id, row["status"], row["progress"], json.dumps({"changes": list(values)})))
                    if row["status"] == "succeeded" and row.get("result_storage_key"):
                        result = row.get("result") or {}
                        await cursor.execute("""insert into media_library(id,owner_subject,workspace_id,name,kind,storage_key,content_type,size_bytes,metadata,task_id)
                            values (%s,%s,%s,%s,'video',%s,%s,%s,%s::jsonb,%s) on conflict(id) do nothing""",
                            (f"sdvm_{task_id}", row["owner_subject"], row["workspace_id"], result.get("file_name", f"{task_id}.mp4"),
                             row["result_storage_key"], result.get("content_type", "video/mp4"), result.get("size_bytes", 0),
                             json.dumps({"source_type": "sd_video", "source_task_id": task_id, "model": row["model"], "prompt": row["prompt"]}), task_id))
                        await cursor.execute("insert into usage_logs(task_id,owner_subject,workspace_id,model,provider) values (%s,%s,%s,%s,%s) on conflict(task_id) do nothing", (task_id,row["owner_subject"],row["workspace_id"],row["model"],row["provider"]))
            await connection.commit()
        return self._record(row) if row else None

    async def claim_next(self) -> TaskRecord | None:
        """Claim one queued task, or recover an expired running lease."""
        async with self._connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("select pg_advisory_xact_lock(hashtextextended('sdvideo:model-capacity',0))")
                await cursor.execute("""select t.* from tasks t where t.status in ('queued','running','cancel_requested')
                    and t.next_poll_at<=now() and (t.lease_owner is null or t.lease_expires_at<now())
                    and (t.status<>'queued' or (select count(*) from tasks active where active.model=t.model and active.status in ('running','cancel_requested'))
                      < coalesce((select greatest(1,(m.config->>'concurrency_limit')::int) from model_configs m where m.id=t.model),1))
                    order by t.updated_at for update skip locked limit 1""")
                row = await cursor.fetchone()
                if row is None:
                    await connection.commit()
                    return None
                await cursor.execute("update tasks set status=case when cancel_requested_at is null then 'running' else 'cancel_requested' end,progress=greatest(progress,5),lease_owner=%s,lease_expires_at=now() + (%s * interval '1 second'),updated_at=now() where id=%s returning *", (f"worker-{uuid.uuid4().hex}", int(settings.WORKER_LEASE_SECONDS), row["id"]))
                row = await cursor.fetchone()
                await cursor.execute("insert into task_events(task_id,status,progress,payload) values (%s,'running',5,'{}'::jsonb)", (row["id"],))
            await connection.commit()
        return self._record(row)

    async def claim(self, task_id: str) -> TaskRecord | None:
        """Atomically claim a specific Redis-delivered task."""
        async with self._connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("select pg_advisory_xact_lock(hashtextextended('sdvideo:model-capacity',0))")
                await cursor.execute("""select t.* from tasks t where t.id=%s and t.status in ('queued','running','cancel_requested')
                    and t.next_poll_at<=now() and (t.lease_owner is null or t.lease_expires_at<now())
                    and (t.status<>'queued' or (select count(*) from tasks active where active.model=t.model and active.status in ('running','cancel_requested'))
                      < coalesce((select greatest(1,(m.config->>'concurrency_limit')::int) from model_configs m where m.id=t.model),1))
                    for update skip locked""", (task_id,))
                row = await cursor.fetchone()
                if row is None:
                    await connection.commit()
                    return None
                await cursor.execute("update tasks set status=case when cancel_requested_at is null then 'running' else 'cancel_requested' end,progress=greatest(progress,5),lease_owner=%s,lease_expires_at=now() + (%s * interval '1 second'),updated_at=now() where id=%s returning *", (f"worker-{uuid.uuid4().hex}", int(settings.WORKER_LEASE_SECONDS), task_id))
                row = await cursor.fetchone()
                await cursor.execute("insert into task_events(task_id,status,progress,payload) values (%s,'running',%s,'{}'::jsonb)", (task_id, row["progress"]))
            await connection.commit()
        return self._record(row)

    async def active(self, limit: int = 50) -> list[TaskRecord]:
        async with self._connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("select * from tasks where status in ('queued','running','cancel_requested') order by updated_at limit %s", (limit,))
                rows = await cursor.fetchall()
        return [self._record(row) for row in rows]

    async def count(self) -> int:
        async with self._connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("select count(*) as count from tasks")
                row = await cursor.fetchone()
        return int((row or {}).get("count", 0))

    async def capacity(self) -> dict[str, int]:
        async with self._connection() as connection:
            cursor = await connection.execute("select model,count(*) n from tasks where status in ('running','cancel_requested') group by model")
            return {row["model"]: int(row["n"]) for row in await cursor.fetchall()}

    async def events(self, principal: ServicePrincipal, task_id: str) -> list[dict[str, Any]]:
        async with self._connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    "select e.id,e.status,e.progress,e.payload,e.created_at from task_events e join tasks t on t.id=e.task_id where e.task_id=%s and t.workspace_id=%s and t.owner_subject=%s order by e.id",
                    (task_id, principal.workspace_id, principal.subject),
                )
                rows = await cursor.fetchall()
        return [{"id": row["id"], "status": row["status"], "progress": row["progress"], "payload": row.get("payload") or {}, "created_at": _as_float(row.get("created_at"))} for row in rows]


class PostgresCatalogStore:
    """Durable CRUD for the small Studio-facing catalog surfaces."""

    def __init__(self, database_url: str):
        self.database_url = database_url

    @asynccontextmanager
    async def _connection(self) -> AsyncIterator[psycopg.AsyncConnection[Any]]:
        connection = await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row)
        try:
            yield connection
        finally:
            await connection.close()

    async def create_conversation(self, principal: ServicePrincipal, title: str, client_id: str | None = None) -> dict[str, Any]:
        item = {"id": client_id or f"sdvc_{uuid.uuid4().hex}", "owner_subject": principal.subject, "workspace_id": principal.workspace_id, "title": title, "created_at": _now(), "version": 1}
        async with self._connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("insert into conversations(id,owner_subject,workspace_id,title) values (%s,%s,%s,%s) on conflict(id) do nothing", (item["id"], principal.subject, principal.workspace_id, title))
            await connection.commit()
        record = await self.get_conversation(principal, item["id"])
        if record is None: raise ValueError("conversation id conflict")
        return record

    async def list_conversations(self, principal: ServicePrincipal) -> list[dict[str, Any]]:
        async with self._connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("select id,owner_subject,workspace_id,title,version,thumbnail_ref,extract(epoch from created_at) created_at,extract(epoch from updated_at) updated_at from conversations where workspace_id=%s and owner_subject=%s order by updated_at desc", (principal.workspace_id, principal.subject))
                rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def conversation_page(self, principal: ServicePrincipal, page: Page, search: str = "") -> dict:
        async with self._connection() as connection:
            return await select_page(connection, page,
                columns="id,owner_subject,workspace_id,title,version,thumbnail_ref,extract(epoch from created_at) created_at,extract(epoch from updated_at) updated_at",
                source="from conversations where workspace_id=%s and owner_subject=%s and strpos(lower(title),%s)>0",
                parameters=[principal.workspace_id, principal.subject, search], order="updated_at desc,id desc")

    async def get_conversation(self, principal: ServicePrincipal, conversation_id: str) -> dict[str, Any] | None:
        async with self._connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("select id,owner_subject,workspace_id,title,version,thumbnail_ref,extract(epoch from created_at) created_at,extract(epoch from updated_at) updated_at from conversations where id=%s and workspace_id=%s and owner_subject=%s", (conversation_id, principal.workspace_id, principal.subject))
                row = await cursor.fetchone()
        return dict(row) if row else None

    async def delete_conversation(self, principal: ServicePrincipal, conversation_id: str) -> bool:
        async with self._connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("delete from conversations where id=%s and workspace_id=%s and owner_subject=%s", (conversation_id, principal.workspace_id, principal.subject))
                deleted = cursor.rowcount > 0
            await connection.commit()
        return deleted

    async def update_conversation(self, principal: ServicePrincipal, conversation_id: str, title: str, version: int) -> dict[str, Any] | None:
        async with self._connection() as connection:
            cursor = await connection.execute("update conversations set title=%s,version=version+1,updated_at=now() where id=%s and workspace_id=%s and owner_subject=%s and version=%s returning *", (title, conversation_id, principal.workspace_id, principal.subject, version))
            row = await cursor.fetchone()
            await connection.commit()
        return dict(row) if row else None

    async def list_messages(self, principal: ServicePrincipal, conversation_id: str) -> list[dict[str, Any]] | None:
        conversation = await self.get_conversation(principal, conversation_id)
        if conversation is None:
            return None
        async with self._connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("select id,conversation_id,role,text,attachments,task_id,video_url,metadata,version,extract(epoch from created_at) created_at from chat_messages where conversation_id=%s and owner_subject=%s and workspace_id=%s order by created_at", (conversation_id,principal.subject,principal.workspace_id))
                rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def message_page(self, principal: ServicePrincipal, conversation_id: str, page: Page) -> dict | None:
        if await self.get_conversation(principal, conversation_id) is None:
            return None
        async with self._connection() as connection:
            return await select_page(connection, page,
                columns="id,conversation_id,role,text,attachments,task_id,video_url,metadata,version,extract(epoch from created_at) created_at",
                source="from chat_messages where conversation_id=%s and owner_subject=%s and workspace_id=%s",
                parameters=[conversation_id, principal.subject, principal.workspace_id], order="created_at,id")

    async def create_message(self, principal: ServicePrincipal, conversation_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
        if await self.get_conversation(principal, conversation_id) is None:
            return None
        message = {"id": payload.get("id") or f"sdvm_{uuid.uuid4().hex}", "conversation_id": conversation_id, "owner_subject": principal.subject, "workspace_id": principal.workspace_id, "role": payload.get("role") or "user", "text": str(payload.get("text") or ""), "attachments": payload.get("attachments") or [], "task_id": payload.get("task_id"), "video_url": payload.get("video_url"), "created_at": _now(), "metadata": payload.get("metadata") or {}, "version": 1}
        async with self._connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("insert into chat_messages(id,conversation_id,owner_subject,workspace_id,role,text,attachments,task_id,video_url,metadata) values (%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s::jsonb) on conflict(id) do nothing", (message["id"], conversation_id, principal.subject, principal.workspace_id, message["role"], message["text"], json.dumps(message["attachments"]), message["task_id"], message["video_url"], json.dumps(message["metadata"])))
                await cursor.execute("select * from chat_messages where id=%s and conversation_id=%s and owner_subject=%s and workspace_id=%s", (message["id"],conversation_id,principal.subject,principal.workspace_id))
                stored = await cursor.fetchone()
                if stored is None: raise ValueError("message id conflict")
            await connection.commit()
        return dict(stored)

    async def update_message(self, principal: ServicePrincipal, message_id: str, changes: dict[str, Any]) -> dict[str, Any] | None:
        async with self._connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("select * from chat_messages where id=%s and workspace_id=%s and owner_subject=%s for update", (message_id, principal.workspace_id, principal.subject))
                row = await cursor.fetchone()
                if row is None:
                    return None
                if int(changes.get("version", 1)) != int(row["version"]):
                    raise ValueError("message version conflict")
                allowed = {"text", "attachments", "task_id", "video_url", "role", "metadata"}
                values = {key: value for key, value in changes.items() if key in allowed}
                assignments = []
                params: list[Any] = []
                for key, value in values.items():
                    assignments.append(f"{key}=%s" + ("::jsonb" if key in {"attachments", "metadata"} else ""))
                    params.append(json.dumps(value) if key in {"attachments", "metadata"} else value)
                if assignments:
                    params.append(message_id)
                    await cursor.execute(f"update chat_messages set {', '.join(assignments)},version=version+1 where id=%s", params)
                    await cursor.execute("select * from chat_messages where id=%s", (message_id,))
                    row = await cursor.fetchone()
            await connection.commit()
        return dict(row) if row else None

    async def list_media(self, principal: ServicePrincipal) -> list[dict[str, Any]]:
        async with self._connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("select id,owner_subject,workspace_id,name,kind,storage_key,thumbnail_key,content_type,size_bytes,metadata,task_id,extract(epoch from created_at) created_at,extract(epoch from updated_at) updated_at from media_library where workspace_id=%s and owner_subject=%s order by created_at desc", (principal.workspace_id, principal.subject))
                rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def media_page(self, principal: ServicePrincipal, page: Page, filters: MediaFilter) -> dict:
        conditions, parameters = filters.sql()
        async with self._connection() as connection:
            return await select_page(connection, page,
                columns="id,owner_subject,workspace_id,name,kind,storage_key,thumbnail_key,content_type,size_bytes,metadata,task_id,extract(epoch from created_at) created_at,extract(epoch from updated_at) updated_at",
                source="from media_library where workspace_id=%s and owner_subject=%s" + conditions,
                parameters=[principal.workspace_id, principal.subject, *parameters], order="created_at desc,id desc")

    async def media_stats(self, principal: ServicePrincipal, filters: MediaFilter) -> dict:
        conditions, parameters = filters.sql()
        async with self._connection() as connection:
            cursor = await connection.execute("""select count(*) total,
                count(*) filter(where kind='image') images, count(*) filter(where kind='video') videos,
                count(*) filter(where kind='audio') audio, coalesce(sum(size_bytes),0) size_bytes
                from media_library where workspace_id=%s and owner_subject=%s""" + conditions,
                [principal.workspace_id, principal.subject, *parameters])
            return {key: int(value) for key, value in (await cursor.fetchone()).items()}

    async def update_media(self, principal: ServicePrincipal, media_id: str, changes: dict[str, Any]) -> dict[str, Any] | None:
        async with self._connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("update media_library set name=coalesce(%s,name),metadata=coalesce(%s::jsonb,metadata),updated_at=now() where id=%s and workspace_id=%s and owner_subject=%s returning *", (changes.get("name"), json.dumps(changes["metadata"]) if "metadata" in changes else None, media_id, principal.workspace_id, principal.subject))
                row = await cursor.fetchone()
            await connection.commit()
        return dict(row) if row else None

    async def delete_media(self, principal: ServicePrincipal, media_id: str) -> bool:
        async with self._connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("delete from media_library where id=%s and workspace_id=%s and owner_subject=%s", (media_id, principal.workspace_id, principal.subject))
                deleted = cursor.rowcount > 0
            await connection.commit()
        return deleted

    async def list_tags(self, principal: ServicePrincipal) -> list[dict[str, Any]]:
        async with self._connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("select id,name,color,workspace_id,extract(epoch from created_at) created_at from global_tags where workspace_id=%s order by name", (principal.workspace_id,))
                rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def page_tags(self, principal, page, search):
        async with self._connection() as connection:
            return await select_page(connection, page,
                columns="id,name,color,workspace_id,extract(epoch from created_at) created_at",
                source="from global_tags where workspace_id=%s and strpos(lower(name),%s)>0",
                parameters=[principal.workspace_id, search], order='name COLLATE "C",id')

    async def find_tags(self, principal, ids):
        if not ids:
            return []
        async with self._connection() as connection:
            cursor = await connection.execute("select id,name,color from global_tags where workspace_id=%s and id=any(%s) order by id", (principal.workspace_id, list(ids)))
            return [dict(row) for row in await cursor.fetchall()]

    async def create_tag(self, principal: ServicePrincipal, name: str, color: str = "") -> dict[str, Any]:
        tag = {"id": f"sdvt_{uuid.uuid4().hex}", "name": name, "workspace_id": principal.workspace_id, "created_at": _now()}
        async with self._connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("insert into global_tags(id,workspace_id,name,color) values (%s,%s,%s,%s) on conflict (workspace_id,name) do update set name=excluded.name returning id,name,color,workspace_id,extract(epoch from created_at) created_at", (tag["id"], principal.workspace_id, name, color))
                row = await cursor.fetchone()
            await connection.commit()
        return dict(row) if row else tag

    async def delete_tag(self, principal: ServicePrincipal, tag_id: str) -> bool:
        async with self._connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("delete from global_tags where id=%s and workspace_id=%s", (tag_id, principal.workspace_id))
                deleted = cursor.rowcount > 0
                if deleted:
                    await cursor.execute("update volcano_assets set tags=tags-%s,updated_at=now() where workspace_id=%s and tags ? %s", (tag_id, principal.workspace_id, tag_id))
            await connection.commit()
        return deleted

    async def list_volcano_assets(self, principal: ServicePrincipal) -> list[dict[str, Any]]:
        async with self._connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("select id,owner_subject,workspace_id,provider_namespace,provider_asset_id,name,status,tags,metadata,extract(epoch from created_at) created_at,extract(epoch from updated_at) updated_at from volcano_assets where workspace_id=%s and owner_subject=%s order by created_at desc", (principal.workspace_id, principal.subject))
                rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def create_volcano_asset(self, principal: ServicePrincipal, payload: dict[str, Any]) -> dict[str, Any]:
        item = {"id": f"sdva_{uuid.uuid4().hex}", "owner_subject": principal.subject, "workspace_id": principal.workspace_id, "provider_namespace": str(payload.get("provider_namespace") or "default"), "provider_asset_id": str(payload.get("provider_asset_id") or payload.get("asset_id") or ""), "name": str(payload.get("name") or payload.get("provider_asset_id") or ""), "status": str(payload.get("status") or "active"), "tags": payload.get("tags") or [], "metadata": payload.get("metadata") or {}, "created_at": _now(), "updated_at": _now()}
        async with self._connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("insert into volcano_assets(id,owner_subject,workspace_id,provider_namespace,provider_asset_id,name,status,tags,metadata) values (%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb) on conflict (workspace_id,provider_namespace,provider_asset_id) do update set name=excluded.name,status=excluded.status,tags=excluded.tags,metadata=excluded.metadata,updated_at=now() returning *", (item["id"], principal.subject, principal.workspace_id, item["provider_namespace"], item["provider_asset_id"], item["name"], item["status"], json.dumps(item["tags"]), json.dumps(item["metadata"])))
                row = await cursor.fetchone()
            await connection.commit()
        return dict(row) if row else item

    async def update_volcano_asset(self, principal: ServicePrincipal, asset_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
        async with self._connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("update volcano_assets set name=coalesce(%s,name),status=coalesce(%s,status),tags=coalesce(%s::jsonb,tags),metadata=coalesce(%s::jsonb,metadata),updated_at=now() where id=%s and workspace_id=%s and owner_subject=%s returning *", (payload.get("name"), payload.get("status"), json.dumps(payload["tags"]) if "tags" in payload else None, json.dumps(payload["metadata"]) if "metadata" in payload else None, asset_id, principal.workspace_id, principal.subject))
                row = await cursor.fetchone()
            await connection.commit()
        return dict(row) if row else None

    async def delete_volcano_asset(self, principal: ServicePrincipal, asset_id: str) -> bool:
        async with self._connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("delete from volcano_assets where id=%s and workspace_id=%s and owner_subject=%s", (asset_id, principal.workspace_id, principal.subject))
                deleted = cursor.rowcount > 0
            await connection.commit()
        return deleted

    async def counts(self) -> dict[str, int]:
        async with self._connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("select (select count(*) from conversations) conversations, (select count(*) from media_library) media")
                row = await cursor.fetchone()
        return {"conversations": int((row or {}).get("conversations", 0)), "media": int((row or {}).get("media", 0))}

    async def upsert_generated_media(self, record: TaskRecord, storage_key: str, size_bytes: int, content_type: str = "video/mp4") -> dict[str, Any]:
        media_id = f"sdvm_{record.id}"
        name = str((record.result or {}).get("file_name") or f"{record.id}.mp4")
        metadata = {"source_type": "sd_video", "source_task_id": record.id, "model": record.model, "prompt": record.prompt}
        async with self._connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    insert into media_library(id,owner_subject,workspace_id,name,kind,storage_key,content_type,size_bytes,metadata,task_id)
                    values (%s,%s,%s,%s,'video',%s,%s,%s,%s::jsonb,%s)
                    on conflict (id) do update set storage_key=excluded.storage_key,size_bytes=excluded.size_bytes,
                        metadata=(case when jsonb_typeof(media_library.metadata)='object' then media_library.metadata else '{}'::jsonb end)
                            || excluded.metadata,updated_at=now()
                    returning id,owner_subject,workspace_id,name,kind,storage_key,content_type,size_bytes,metadata,task_id
                    """,
                    (media_id, record.owner_subject, record.workspace_id, name, storage_key, content_type, size_bytes, json.dumps(metadata), record.id),
                )
                row = await cursor.fetchone()
            await connection.commit()
        return dict(row) if row else {"id": media_id, "name": name, "storage_key": storage_key}


def use_postgres() -> bool:
    return bool(str(getattr(settings, "DATABASE_URL", "") or "").strip())
