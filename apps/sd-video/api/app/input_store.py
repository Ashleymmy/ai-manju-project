"""参考输入登记；仅已完成且同一身份的对象可被任务使用。"""
from app.volcano_store import VolcanoStore
import asyncio
from contextlib import asynccontextmanager


class InputStore(VolcanoStore):
    @asynccontextmanager
    async def transfer(self, key):
        # 上传与 complete 共用对象级锁，阻止 complete 后仍有迟到 PUT 覆盖对象。
        if not self.database_url:
            if not hasattr(self, "_transfer_locks"): self._transfer_locks = {}
            lock = self._transfer_locks.setdefault(key, asyncio.Lock())
            async with lock: yield
        else:
            async with self.connection() as connection:
                await connection.execute("set local lock_timeout = '15s'")
                await connection.execute("select pg_advisory_xact_lock(hashtextextended(%s,0))", ("input:" + key,))
                yield

    async def issue(self, principal, key, content_type, size):
        item = dict(storage_key=key, owner_subject=principal.subject, workspace_id=principal.workspace_id,
                    content_type=content_type, size_bytes=size, status="pending")
        if not self.database_url:
            self.items[key] = item
            return
        async with self.connection() as connection:
            await connection.execute("insert into input_objects(storage_key,owner_subject,workspace_id,content_type,size_bytes) values (%s,%s,%s,%s,%s)",
                                     (key, principal.subject, principal.workspace_id, content_type, size))

    async def get(self, principal, key):
        if not self.database_url:
            item = self.items.get(key)
            return dict(item) if item and self.owned(item, principal) else None
        async with self.connection() as connection:
            cursor = await connection.execute("select * from input_objects where storage_key=%s and owner_subject=%s and workspace_id=%s", (key, principal.subject, principal.workspace_id))
            row = await cursor.fetchone()
            return dict(row) if row else None

    async def complete(self, principal, key, size, digest):
        if not self.database_url:
            item = self.items.get(key)
            if not item or not self.owned(item, principal) or item["status"] not in {"pending", "complete"}: return False
            item.update(status="complete", size_bytes=size, sha256=digest)
            return True
        async with self.connection() as connection:
            cursor = await connection.execute("update input_objects set status='complete',size_bytes=%s,sha256=%s,completed_at=now() where storage_key=%s and owner_subject=%s and workspace_id=%s and status in ('pending','complete')", (size, digest, key, principal.subject, principal.workspace_id))
            return cursor.rowcount > 0
