"""新素材库的作用域、认领和状态写入，不依赖旧 Supabase 服务。"""
import time
import uuid
from contextlib import asynccontextmanager

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from app.catalog_queries import Page, VolcanoFilter, record_order, select_page

LEASE_SECONDS = 180
POLL_SECONDS = 15


class VolcanoStore:
    def __init__(self, database_url=""):
        self.database_url = database_url
        self.items = {}

    @asynccontextmanager
    async def connection(self):
        async with await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row) as connection:
            yield connection

    async def create(self, principal, payload):
        item = dict(payload, id=f"sdva_{uuid.uuid4().hex}", owner_subject=principal.subject,
                    workspace_id=principal.workspace_id, status="queued", provider_asset_id=None,
                    created_at=time.time(), updated_at=time.time(), error=None)
        if not self.database_url:
            self.items[item["id"]] = item
            return dict(item)
        async with self.connection() as connection:
            cursor = await connection.execute(
                """insert into volcano_assets(id,owner_subject,workspace_id,provider_namespace,upstream_provider,
                   name,status,tags,storage_key,kind,description) values (%s,%s,%s,%s,%s,%s,'queued',%s,%s,%s,%s) returning *""",
                (item["id"], principal.subject, principal.workspace_id, item["provider_namespace"],
                 item["upstream_provider"], item["name"], Jsonb(item.get("tags", [])), item["storage_key"], item["kind"], item.get("description", "")))
            return dict(await cursor.fetchone())

    async def list(self, principal):
        if not self.database_url:
            return [dict(item) for item in self.items.values() if self.owned(item, principal) and item["status"] != "deleted"]
        async with self.connection() as connection:
            cursor = await connection.execute("select * from volcano_assets where owner_subject=%s and workspace_id=%s and status<>'deleted' order by created_at desc", (principal.subject, principal.workspace_id))
            return [dict(row) for row in await cursor.fetchall()]

    async def page(self, principal, page: Page, filters: VolcanoFilter):
        if not self.database_url:
            items = [dict(item) for item in self.items.values() if self.owned(item, principal) and filters.matches(item)]
            return page.slice(sorted(items, key=record_order, reverse=True))
        clause, values = filters.sql()
        async with self.connection() as connection:
            return await select_page(connection, page, columns="*",
                source="from volcano_assets where owner_subject=%s and workspace_id=%s" + clause,
                parameters=[principal.subject, principal.workspace_id, *values], order="created_at desc,id desc")

    async def get(self, principal, asset_id):
        if not self.database_url:
            item = self.items.get(asset_id)
            return dict(item) if item and self.owned(item, principal) and item["status"] != "deleted" else None
        async with self.connection() as connection:
            cursor = await connection.execute("select * from volcano_assets where id=%s and owner_subject=%s and workspace_id=%s and status<>'deleted'",
                                              (asset_id, principal.subject, principal.workspace_id))
            row = await cursor.fetchone()
            return dict(row) if row else None

    async def schedule_poll(self, principal):
        if not self.database_url:
            items = [item for item in self.items.values() if self.owned(item, principal) and item["status"] in {"queued", "processing", "delete_requested"}]
            for item in items:
                item.update(next_poll_at=0, updated_at=time.time())
            return len(items)
        async with self.connection() as connection:
            cursor = await connection.execute("update volcano_assets set next_poll_at=now(),updated_at=now() where owner_subject=%s and workspace_id=%s and status in ('queued','processing','delete_requested')",
                                              (principal.subject, principal.workspace_id))
            return cursor.rowcount

    @staticmethod
    def owned(item, principal):
        return item["owner_subject"] == principal.subject and item["workspace_id"] == principal.workspace_id

    async def edit(self, principal, asset_id, changes):
        allowed = {key: value for key, value in changes.items() if key in {"name", "tags", "description"}}
        if changes.get("delete"):
            # 保留正在注册的 Worker 租约，让其先记下远端 ID，再由删除补偿清理。
            allowed.update(status="delete_requested")
        if not self.database_url:
            item = self.items.get(asset_id)
            if item is None or not self.owned(item, principal) or item["status"] == "deleted": return None
            item.update(allowed, updated_at=time.time(), next_poll_at=0)
            return dict(item)
        async with self.connection() as connection:
            values = [Jsonb(value) if key == "tags" else value for key, value in allowed.items()]
            assignments = [f"{key}=%s" for key in allowed]
            cursor = await connection.execute(f"update volcano_assets set {','.join(assignments + ['updated_at=now()', 'next_poll_at=now()'])} where id=%s and owner_subject=%s and workspace_id=%s and status<>'deleted' returning *", (*values, asset_id, principal.subject, principal.workspace_id))
            row = await cursor.fetchone()
            return dict(row) if row else None

    async def claim(self):
        lease = uuid.uuid4().hex
        if not self.database_url:
            for item in self.items.values():
                if item["status"] not in {"queued", "processing", "delete_requested"}: continue
                if (item.get("lease_until") or 0) > time.time() or item.get("next_poll_at", 0) > time.time(): continue
                item.update(lease_owner=lease, lease_until=time.time() + LEASE_SECONDS)
                return dict(item)
            return None
        async with self.connection() as connection:
            cursor = await connection.execute("""update volcano_assets set lease_owner=%s,lease_until=now()+%s*interval '1 second'
                where id=(select id from volcano_assets where status in ('queued','processing','delete_requested')
                and next_poll_at<=now() and (lease_until is null or lease_until<=now()) order by next_poll_at
                for update skip locked limit 1) returning *""", (lease, LEASE_SECONDS))
            row = await cursor.fetchone()
            return dict(row) if row else None

    async def change_tag(self, principal, asset_id, tag_id, add):
        if not self.database_url:
            item = self.items.get(asset_id)
            if not item or not self.owned(item, principal) or item["status"] == "deleted": return None
            tags = [value for value in item.get("tags", []) if value != tag_id]
            if add: tags.append(tag_id)
            item.update(tags=tags, updated_at=time.time())
            return dict(item)
        async with self.connection() as connection:
            cursor = await connection.execute("update volcano_assets set tags=(tags-%s) || %s,updated_at=now() where id=%s and owner_subject=%s and workspace_id=%s and status<>'deleted' returning *",
                (tag_id, Jsonb([tag_id] if add else []), asset_id, principal.subject, principal.workspace_id))
            row = await cursor.fetchone()
            return dict(row) if row else None

    async def save(self, item, *, release=False, **changes):
        allowed = {"status", "provider_asset_id", "group_id", "submission_started_at", "error"}
        if not changes.keys() <= allowed: raise ValueError("invalid asset update")
        if not self.database_url:
            current = self.items[item["id"]]
            if current.get("lease_owner") != item["lease_owner"] or current["lease_until"] <= time.time(): return None
            if current["status"] == "delete_requested" and changes.get("status") != "deleted": changes.pop("status", None)
            current.update(changes, updated_at=time.time())
            if release: current.update(lease_owner=None, lease_until=None, next_poll_at=time.time() + POLL_SECONDS)
            return dict(current)
        assignments, values = [], []
        for key, value in changes.items():
            if key == "status" and value != "deleted": assignments.append("status=case when status='delete_requested' then status else %s end")
            else: assignments.append(f"{key}=to_timestamp(%s)" if key == "submission_started_at" else f"{key}=%s")
            values.append(Jsonb(value) if key == "error" else value)
        assignments += ["updated_at=now()"]
        if release: assignments += ["lease_owner=null", "lease_until=null", f"next_poll_at=now()+interval '{POLL_SECONDS} seconds'"]
        async with self.connection() as connection:
            cursor = await connection.execute(f"update volcano_assets set {','.join(assignments)} where id=%s and lease_owner=%s and lease_until>now() returning *", (*values, item["id"], item["lease_owner"]))
            row = await cursor.fetchone()
            return dict(row) if row else None

    async def active_reference(self, principal, provider_id, namespace=None):
        if not self.database_url:
            return next((dict(item) for item in self.items.values() if self.owned(item, principal)
                         and item.get("provider_asset_id") == provider_id and item["status"] == "active"
                         and (namespace is None or item["provider_namespace"] == namespace)), None)
        async with self.connection() as connection:
            cursor = await connection.execute("select * from volcano_assets where owner_subject=%s and workspace_id=%s and provider_asset_id=%s and status='active'"
                + (" and provider_namespace=%s" if namespace is not None else "") + " order by id limit 1",
                [principal.subject, principal.workspace_id, provider_id] + ([namespace] if namespace is not None else []))
            row = await cursor.fetchone()
            return dict(row) if row else None


def public_asset(item):
    return {key: item.get(key) for key in ("id", "name", "description", "kind", "status", "tags", "provider_asset_id",
            "provider_namespace", "upstream_provider", "created_at", "updated_at", "error")}
