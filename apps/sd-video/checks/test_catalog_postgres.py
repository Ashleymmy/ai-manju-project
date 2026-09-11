"""显式 PostgreSQL 集成入口：pytest tests/test_catalog_queries.py checks。

复用只连接本地 compose.mock-deps、创建随机空库的 fixture，不使用生产配置。
"""
import asyncio

from test_catalog_queries import catalog_database
from app.catalog_queries import MediaFilter, Page, select_page
from app.core.auth import ServicePrincipal
from app.persistence import PostgresCatalogStore, PostgresTaskStore


def test_completed_media_is_searchable_before_followup_and_keeps_user_tags(catalog_database):
    async def check():
        principal = ServicePrincipal("atomic", "team", "member", frozenset())
        tasks, media = PostgresTaskStore(catalog_database), PostgresCatalogStore(catalog_database)
        task, _ = await tasks.create(principal, {"model": "mock", "idempotency_key": "atomic", "prompt": "夜晚 Cat"})
        key = f"results/team/atomic/{task.id}.mp4"
        completed = await tasks.update(task.id, status="succeeded", result_storage_key=key,
                                       result={"file_name": "result.mp4", "size_bytes": 7})
        # 模拟 Worker 在事务提交后、后续登记前中断：提示词已经可以被检索。
        page = await media.media_page(principal, Page(), MediaFilter(keyword="cat"))
        assert page["total"] == 1 and page["items"][0]["size_bytes"] == 7
        item = page["items"][0]
        await media.update_media(principal, item["id"], {"metadata": {**item["metadata"], "tags": ["收藏"], "category": "story"}})
        await media.upsert_generated_media(completed, key, 7)
        page = await media.media_page(principal, Page(), MediaFilter(tag="收藏", category="story"))
        assert page["total"] == 1 and page["items"][0]["metadata"]["prompt"] == "夜晚 Cat"
    asyncio.run(check())


def test_count_and_items_share_snapshot_when_other_writer_commits(catalog_database):
    async def check():
        store = PostgresCatalogStore(catalog_database)
        principal = ServicePrincipal("snapshot", "team", "member", frozenset())
        first = await store.create_conversation(principal, "before", "snapshot_before")
        async with store._connection() as connection:
            class ConcurrentInsert:
                async def execute(self, statement, parameters=None):
                    cursor = await connection.execute(statement, parameters)
                    if statement.startswith("select count(*)"):
                        await store.create_conversation(principal, "after", "snapshot_after")
                    return cursor
            page = await select_page(ConcurrentInsert(), Page(1, 1), columns="id",
                source="from conversations where owner_subject=%s and workspace_id=%s",
                parameters=[principal.subject, principal.workspace_id], order="created_at desc,id desc")
        assert page["total"] == 1 and page["items"] == [{"id": first["id"]}]
        assert (await store.conversation_page(principal, Page()))["total"] == 2
    asyncio.run(check())
