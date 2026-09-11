"""同一组 HTTP 契约断言覆盖 Memory，以及显式启用的隔离 PostgreSQL。

SDVIDEO_CATALOG_TEST_POSTGRES=1 时只连接 compose.mock-deps 的固定测试端口，
创建本轮独占的空库；不读取项目配置或操作任何已有业务库。
"""
import asyncio
import os
from pathlib import Path
import subprocess
import sys
import uuid

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb
import pytest
from fastapi.testclient import TestClient

from api.main import app
from app import standalone_api as api
from app.catalog_queries import MAX_SQL_OFFSET, MediaFilter, Page, record_order
from app.core.auth import ServicePrincipal, require_principal
from app.persistence import PostgresCatalogStore, PostgresTaskStore


BACKENDS = ["memory", "postgres"] if os.getenv("SDVIDEO_CATALOG_TEST_POSTGRES") == "1" else ["memory"]


@pytest.fixture(scope="session")
def catalog_database():
    port = int(os.getenv("SDVIDEO_TEST_DB_PORT", "55439"))
    if port not in {55439, 55449}: raise ValueError("only dedicated loopback fixture ports are allowed")
    base = dict(host="127.0.0.1", port=port, user="sdvideo_test", password="disposable_test_only")
    database = "catalog_test_" + uuid.uuid4().hex
    with psycopg.connect(**base, dbname="sdvideo_test", autocommit=True) as connection:
        connection.execute(sql.SQL("create database {}").format(sql.Identifier(database)))
    url = f"postgresql://sdvideo_test:disposable_test_only@127.0.0.1:{port}/{database}"
    try:
        environment = {key: value for key, value in os.environ.items() if not key.endswith("_FILE")}
        environment.update(SDVIDEO_DATABASE_URL=url, SDVIDEO_LOAD_ENV_FILE="false")
        subprocess.run([sys.executable, "scripts/migrate.py"], cwd=Path(__file__).resolve().parents[1],
                       env=environment, check=True, timeout=60)
        yield url
    finally:
        # 只删除上面创建的随机测试库；标识符不来自外部输入。
        with psycopg.connect(**base, dbname="sdvideo_test", autocommit=True) as connection:
            connection.execute(sql.SQL("drop database {}").format(sql.Identifier(database)))


@pytest.fixture(params=BACKENDS)
def catalog(request, monkeypatch):
    database = request.getfixturevalue("catalog_database") if request.param == "postgres" else None
    subject = "owner_" + uuid.uuid4().hex
    actor = [ServicePrincipal(subject, "team", "member", frozenset({"*"}))]
    task_store = PostgresTaskStore(database) if database else api.InMemoryTaskStore()
    monkeypatch.setattr(api, "catalog_store", PostgresCatalogStore(database) if database else None)
    monkeypatch.setattr(api, "task_store", task_store)
    monkeypatch.setattr(api, "conversation_store", {})
    monkeypatch.setattr(api, "message_store", {})
    monkeypatch.setattr(api, "media_store", {})
    monkeypatch.setattr(api.settings, "EXECUTION_MODE", "provider")
    app.dependency_overrides[require_principal] = lambda: actor[0]
    try:
        with TestClient(app) as client:
            yield client, actor, database
    finally:
        app.dependency_overrides.pop(require_principal, None)


def seed_media(catalog, count=25):
    _, actor, database = catalog
    rows = []
    for index in range(count):
        row = dict(id=f"media_{actor[0].subject}_{index:03d}", owner_subject=actor[0].subject,
                   workspace_id=actor[0].workspace_id, name=f"Clip {index} 100%_done", kind="video",
                   storage_key=f"results/{index}.mp4", size_bytes=index + 1, created_at=100,
                   metadata={"tags": ["selected", "人物"], "category": "story", "prompt": "夜晚 Cat"})
        rows.append(row)
    # 另外两个作用域有完全相同的筛选字段，不能被统计或列出。
    rows.extend([{**rows[0], "id": rows[0]["id"] + "_owner", "owner_subject": "another"},
                 {**rows[0], "id": rows[0]["id"] + "_workspace", "workspace_id": "another"}])
    if database:
        with psycopg.connect(database) as connection:
            for row in rows:
                connection.execute("""insert into media_library
                    (id,owner_subject,workspace_id,name,kind,storage_key,size_bytes,created_at,metadata)
                    values (%s,%s,%s,%s,%s,%s,%s,to_timestamp(%s),%s)""",
                    [row[key] for key in ("id", "owner_subject", "workspace_id", "name", "kind", "storage_key", "size_bytes", "created_at")] + [Jsonb(row["metadata"])])
    else:
        api.media_store.update({row["id"]: row for row in rows})
    return rows[:count]


def body(response):
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["success"] and payload["request_id"] and payload["error"] is None
    return payload["data"]


def test_media_page_stats_and_mentions_share_filters(catalog):
    client, _, _ = catalog
    rows = seed_media(catalog)
    params = dict(keyword=" CAT ", kind="VIDEO", tag="selected", category="story", page=2, pageSize=10)
    page = body(client.get("/v1/media", params=params))
    expected = sorted(rows, key=record_order, reverse=True)
    assert [item["id"] for item in page["items"]] == [item["id"] for item in expected[10:20]]
    assert (page["total"], page["page"], page["pageSize"]) == (25, 2, 10)
    stats = body(client.get("/v1/media/stats", params=params))
    assert stats == dict(total=25, images=0, videos=25, audio=0, size_bytes=325)
    mentions = body(client.get("/v1/media/mentions", params={**params, "page": 1, "pageSize": 200}))
    assert len(mentions["items"]) == mentions["pageSize"] == 20 and mentions["total"] == 25
    last = body(client.get("/v1/media/mentions", params={**params, "page": 2, "pageSize": 200}))
    assert len(last["items"]) == 5
    assert set(item["id"] for item in mentions["items"]).isdisjoint(item["id"] for item in last["items"])
    empty = body(client.get("/v1/media", params={**params, "page": 10}))
    assert empty["items"] == [] and empty["total"] == 25


@pytest.mark.parametrize("filters, expected", [
    ({"keyword": "%_"}, 3), ({"keyword": "%' OR 1=1 --"}, 0),
    ({"tag": "select"}, 0), ({"category": "other"}, 0), ({"kind": "image"}, 0),
    ({"keyword": "夜晚", "tag": "人物", "kind": "all"}, 3),
])
def test_media_literal_search_and_exact_filters(catalog, filters, expected):
    client, _, _ = catalog
    seed_media(catalog, 3)
    assert body(client.get("/v1/media", params=filters))["total"] == expected
    assert body(client.get("/v1/media/stats", params=filters))["total"] == expected


def test_media_non_text_metadata_does_not_become_searchable_text(catalog):
    client, _, _ = catalog
    rows = seed_media(catalog, 1)
    body(client.patch(f"/v1/media/{rows[0]['id']}", json={"metadata": {"prompt": 123, "category": 123, "tags": "selected"}}))
    for filters in ({"keyword": "123"}, {"category": "123"}, {"tag": "selected"}):
        assert body(client.get("/v1/media", params=filters))["total"] == 0
        assert body(client.get("/v1/media/stats", params=filters))["total"] == 0


@pytest.mark.parametrize("path, query", [
    ("/v1/tasks", {"page": "oops"}), ("/v1/conversations", {"pageSize": "oops"}),
    ("/v1/media", {"page": str(MAX_SQL_OFFSET + 2)}),
    ("/v1/media/mentions", {"kind": "document"}), ("/v1/media/stats", {"tag": "a" * 201}),
    ("/v1/conversations", {"keyword": "x" * 201}),
])
def test_invalid_list_query_returns_envelope(catalog, path, query):
    response = catalog[0].get(path, params=query)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request"
    assert response.json()["request_id"]


def test_conversation_message_pagination_order_and_owner(catalog):
    client, actor, database = catalog
    conversations = [body(client.post("/v1/conversations", json={"title": f"Draft {index} %_"})) for index in range(3)]
    chosen = conversations[0]["id"]
    messages = [body(client.post("/v1/messages", json={"id": f"m_{actor[0].subject}_{index}", "conversation_id": chosen, "text": str(index)})) for index in (2, 0, 1)]
    if database:
        with psycopg.connect(database) as connection:
            connection.execute("update conversations set updated_at=to_timestamp(100) where owner_subject=%s", [actor[0].subject])
            connection.execute("update chat_messages set created_at=to_timestamp(100) where owner_subject=%s", [actor[0].subject])
    else:
        for item in api.conversation_store.values(): item["updated_at"] = 100
        for item in api.message_store[chosen]: item["created_at"] = 100
    page = body(client.get("/v1/conversations", params={"page": 2, "pageSize": 1, "keyword": "%_"}))
    assert page["total"] == 3 and page["items"][0]["id"] == sorted(item["id"] for item in conversations)[1]
    page = body(client.get(f"/v1/conversations/{chosen}/messages?page=2&pageSize=1"))
    assert page["total"] == 3 and page["items"][0]["id"] == sorted(item["id"] for item in messages)[1]
    assert body(client.get(f"/v1/conversations/{chosen}/messages?page=99"))["total"] == 3
    original = actor[0]
    for intruder in (ServicePrincipal("another", original.workspace_id, "member", original.scopes),
                     ServicePrincipal(original.subject, "another", "member", original.scopes)):
        actor[0] = intruder
        assert body(client.get("/v1/conversations"))["items"] == []
        assert client.get(f"/v1/conversations/{chosen}/messages").status_code == 404


def test_task_pagination_preserves_records_and_scope(catalog):
    client, actor, _ = catalog
    async def seed():
        own = []
        for index in range(3):
            item, _ = await api.task_store.create(actor[0], api.CreateTaskRequest(idempotency_key=str(index), model="mock"))
            own.append(item)
        for owner, workspace in (("another", "team"), (actor[0].subject, "another")):
            await api.task_store.create(ServicePrincipal(owner, workspace, "member", frozenset()), api.CreateTaskRequest(idempotency_key=uuid.uuid4().hex, model="mock"))
        return own
    own = asyncio.run(seed())
    page = body(client.get("/v1/tasks?page=2&pageSize=1"))
    assert page["total"] == 3 and page["items"][0]["task_id"] == own[1].id
    assert body(client.get("/v1/tasks?page=99"))["items"] == []


def test_page_clamps_legacy_bounds_and_rejects_overflow():
    assert Page.read({"page": "0", "pageSize": "-1"}) == Page(1, 1)
    assert Page.read({"pageSize": "99999"}) == Page(1, 200)
    assert Page.read({}) == Page(1, 50)
    with pytest.raises(ValueError): Page.read({"page": str(MAX_SQL_OFFSET + 2)})


def test_filter_binds_values_not_sql_fragments():
    value = "%' OR 1=1 --"
    fragment, values = MediaFilter(keyword=value, tag=value, category=value, kind="image").sql()
    assert value not in fragment and value in values
    assert "strpos" in fragment and " like " not in fragment
    assert not MediaFilter(tag="a").matches({"metadata": {"tags": "a"}})
