"""分页、点查询及旧管理入口的共同仓储契约。"""
import asyncio

import psycopg
import pytest

from app import standalone_api as api
from app.core.auth import ServicePrincipal
from app.providers.seedance import seedance_provider_registry
from app.volcano_store import VolcanoStore
from test_catalog_queries import catalog, catalog_database, body


@pytest.fixture
def volcano(catalog, monkeypatch):
    client, actor, database = catalog
    store = VolcanoStore(database or "")
    monkeypatch.setattr(api, "volcano_store", store)
    monkeypatch.setattr(api, "volcano_tags_store", {})
    return client, actor, database, store


def seed(volcano, count=61):
    _, actor, database, store = volcano
    provider = seedance_provider_registry.get(api.settings.SEEDANCE20_PROVIDER)
    async def create():
        return [await store.create(actor[0], dict(name=f"Clip {index:03d} %_", kind="video", tags=[],
                provider_namespace=provider.namespace, upstream_provider=provider.name, storage_key=f"inputs/{index}")) for index in range(count)]
    rows = asyncio.run(create())
    if database:
        with psycopg.connect(database) as connection:
            connection.execute("update volcano_assets set status='active',provider_asset_id=id,created_at=to_timestamp(100) where owner_subject=%s", [actor[0].subject])
    else:
        for item in store.items.values(): item.update(status="active", provider_asset_id=item["id"], created_at=100)
    return sorted(rows, key=lambda item: item["id"], reverse=True)


def test_asset_offset_filters_detail_and_reference_beyond_first_page(volcano):
    client, actor, _, _ = volcano
    rows = seed(volcano)
    params = {"limit": 13, "offset": 17, "kind": "VIDEO", "keyword": "%_", "status": "active"}
    page = body(client.get("/v1/volcano/assets", params=params))
    assert [item["id"] for item in page["items"]] == [item["id"] for item in rows[17:30]]
    assert (page["total"], page["offset"], page["limit"]) == (61, 17, 13)
    last = rows[-1]["id"]
    assert body(client.get(f"/v1/volcano/assets/{last}"))["id"] == last
    assert body(client.post("/v1/volcano/ensure-active", json={"asset_ids": ["asset://" + last]}))["active"]
    assert body(client.get("/v1/volcano/assets?offset=500"))["total"] == 61
    for query in ({"keyword": "%' OR 1=1 --"}, {"kind": "image"}, {"tag": "missing"}, {"status": "pending"}):
        assert body(client.get("/v1/volcano/assets", params=query))["total"] == 0
    original = actor[0]
    for intruder in (ServicePrincipal("another", original.workspace_id, "member", original.scopes),
                     ServicePrincipal(original.subject, "other", "member", original.scopes)):
        actor[0] = intruder
        assert body(client.get("/v1/volcano/assets"))["total"] == 0
        assert client.get(f"/v1/volcano/assets/{last}").status_code == 404
        assert client.post("/v1/volcano/ensure-active", json={"asset_ids": [last]}).status_code == 409


def test_tag_pagination_does_not_break_validation_or_asset_hydration(volcano):
    client, actor, _, _ = volcano
    # 标签按 workspace 共享，素材仍按 owner 隔离。
    original = actor[0]
    actor[0] = ServicePrincipal(original.subject, original.subject + "_tags", "member", original.scopes)
    tags = [body(client.post("/v1/volcano/tags", json={"name": f"Tag {i:03d}", "color": "#112233"})) for i in range(53)]
    page = body(client.get("/v1/volcano/tags?page=2&pageSize=50"))
    assert page["total"] == 53 and len(page["items"]) == 3
    assert body(client.get("/v1/volcano/tags?keyword=Tag%20052"))["total"] == 1
    asset = seed(volcano, 1)[0]["id"]
    tag_id = tags[-1]["id"]
    changed = body(client.put(f"/v1/volcano/assets/{asset}", json={"tags": [tag_id]}))
    assert changed["tag_details"][0]["name"] == "Tag 052"
    assert body(client.get("/v1/volcano/assets", params={"tag": tag_id}))["total"] == 1
    for tag in tags[:2]:
        body(client.post(f"/v1/volcano/assets/{asset}/tags/{tag['id']}"))
    assert len(body(client.get(f"/v1/volcano/assets/{asset}"))["tags"]) == 3
    body(client.delete(f"/v1/volcano/assets/{asset}/tags/{tag_id}"))
    assert tag_id not in body(client.get(f"/v1/volcano/assets/{asset}"))["tags"]


def test_deleted_assets_do_not_resurrect_and_poll_preserves_lease(volcano):
    client, actor, database, store = volcano
    asset = seed(volcano, 1)[0]["id"]
    body(client.delete(f"/v1/volcano/assets/{asset}"))
    claimed = asyncio.run(store.claim())
    assert claimed["id"] == asset
    assert body(client.post("/v1/volcano/poll"))["scheduled"] == 1
    current = asyncio.run(store.get(actor[0], asset))
    assert current["lease_owner"] == claimed["lease_owner"]
    asyncio.run(store.save(claimed, status="deleted", release=True))
    assert client.get(f"/v1/volcano/assets/{asset}").status_code == 404
    assert client.put(f"/v1/volcano/assets/{asset}", json={"name": "revive"}).status_code == 404
    assert body(client.get("/v1/volcano/assets"))["total"] == 0


@pytest.mark.parametrize("path,query", [
    ("assets", {"offset": "oops"}), ("assets", {"status": "bogus"}),
    ("assets", {"offset": str(2**63)}), ("tags", {"page": "oops"}),
])
def test_invalid_query_is_rejected(volcano, path, query):
    assert volcano[0].get(f"/v1/volcano/{path}", params=query).status_code == 400
