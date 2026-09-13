"""缩略图独立补偿，不阻塞已成功的付费任务；租约和回写不复活删除记录。"""
import time
import uuid
from contextlib import asynccontextmanager

import psycopg
from psycopg.rows import dict_row

THUMBNAIL_LEASE_SECONDS = 120
THUMBNAIL_RETRY_SECONDS = 60
TABLES = {"media": "media_library", "volcano": "volcano_assets"}


class ThumbnailStore:
    def __init__(self, database_url="", memory=None):
        self.database_url, self.memory = database_url, memory or {}

    @asynccontextmanager
    async def connection(self):
        async with await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row) as connection:
            yield connection

    def visible(self, kind, item):
        return kind == "media" or item["status"] not in {"deleted", "delete_requested"}

    async def claim(self, kind):
        table = TABLES[kind]
        lease = uuid.uuid4().hex
        if not self.database_url:
            for item in self.memory.get(kind, {}).values():
                if not self.visible(kind, item) or item.get("kind") not in {"image", "video"} or item.get("thumbnail_key") or item.get("thumbnail_error") == "unsupported_media": continue
                if (item.get("thumbnail_lease_until") or 0) > time.time() or (item.get("thumbnail_next_attempt") or 0) > time.time(): continue
                item.update(thumbnail_lease_owner=lease, thumbnail_lease_until=time.time()+THUMBNAIL_LEASE_SECONDS)
                return dict(item)
            return None
        condition = " and status not in ('deleted','delete_requested')" if kind == "volcano" else ""
        async with self.connection() as connection:
            cursor = await connection.execute(f"""update {table} set thumbnail_lease_owner=%s,thumbnail_lease_until=now()+%s*interval '1 second'
                where id=(select id from {table} where kind in ('image','video') and thumbnail_key is null
                and coalesce(thumbnail_error,'')<>'unsupported_media' and thumbnail_next_attempt<=now()
                and (thumbnail_lease_until is null or thumbnail_lease_until<=now()){condition}
                order by thumbnail_next_attempt,id for update skip locked limit 1) returning *""", (lease, THUMBNAIL_LEASE_SECONDS))
            row = await cursor.fetchone()
            return dict(row) if row else None

    async def finish(self, kind, item, key=None, error=None):
        table = TABLES[kind]
        if not self.database_url:
            current = self.memory.get(kind, {}).get(item["id"])
            if not current or not self.visible(kind, current) or current.get("storage_key") != item["storage_key"] or current.get("thumbnail_lease_owner") != item["thumbnail_lease_owner"] or current.get("thumbnail_lease_until", 0) <= time.time(): return False
            current.update(thumbnail_key=key, thumbnail_error=error, thumbnail_lease_owner=None, thumbnail_lease_until=None,
                           thumbnail_next_attempt=time.time()+THUMBNAIL_RETRY_SECONDS)
            return True
        condition = " and status not in ('deleted','delete_requested')" if kind == "volcano" else ""
        async with self.connection() as connection:
            cursor = await connection.execute(f"""update {table} set thumbnail_key=%s,thumbnail_error=%s,
                thumbnail_lease_owner=null,thumbnail_lease_until=null,thumbnail_next_attempt=now()+%s*interval '1 second'
                where id=%s and owner_subject=%s and workspace_id=%s and storage_key=%s
                and thumbnail_lease_owner=%s and thumbnail_lease_until>now(){condition}""",
                (key, error, THUMBNAIL_RETRY_SECONDS, item["id"], item["owner_subject"], item["workspace_id"], item["storage_key"], item["thumbnail_lease_owner"]))
            return cursor.rowcount == 1

    async def get(self, principal, kind, item_id):
        table = TABLES[kind]
        if not self.database_url:
            item = self.memory.get(kind, {}).get(item_id)
            if item and self.visible(kind, item) and item["owner_subject"] == principal.subject and item["workspace_id"] == principal.workspace_id:
                return dict(item)
            return None
        condition = " and status not in ('deleted','delete_requested')" if kind == "volcano" else ""
        async with self.connection() as connection:
            cursor = await connection.execute(f"select id,kind,thumbnail_key,thumbnail_error from {table} where id=%s and owner_subject=%s and workspace_id=%s{condition}", (item_id, principal.subject, principal.workspace_id))
            row = await cursor.fetchone()
            return dict(row) if row else None


def build_thumbnail_store():
    from app import standalone_api as api
    from app.config import settings
    return ThumbnailStore(settings.DATABASE_URL, {"media": api.media_store, "volcano": api.volcano_store.items})
