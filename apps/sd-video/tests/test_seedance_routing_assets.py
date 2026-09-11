"""旧路由回归迁到独立服务：Provider 选择、快照与授权素材契约。"""
import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from app.config import settings
from app.core.auth import ServicePrincipal
from app.providers.seedance import LEGACY_PROXY, TOKENSPACE, seedance_provider_registry
from app.volcano_store import VolcanoStore
from worker import processor


@pytest.mark.parametrize("logical,expected", [("seedance-2.0", TOKENSPACE), ("seedance-2.5", LEGACY_PROXY), ("seedance-2.0-mini", LEGACY_PROXY), ("seedance-fast", LEGACY_PROXY)])
def test_new_tasks_route_by_logical_model(monkeypatch, logical, expected):
    monkeypatch.setattr(settings, "SEEDANCE20_PROVIDER", TOKENSPACE)
    assert seedance_provider_registry.submission_provider(logical) == expected


def test_existing_task_retains_provider_and_model_snapshot(monkeypatch):
    async def check():
        record = SimpleNamespace(model="seedance-2.0", provider="volcano", request={"upstream_provider": TOKENSPACE, "model_config": {"id": "saved-model", "provider": "volcano", "available": True}})
        assert await processor._provider_for(record) == ("volcano", "saved-model")
        query = AsyncMock(return_value={"status": "running"})
        monkeypatch.setattr(processor.volcano_api, "query_task", query)
        await processor._query_upstream(record, "volcano", "remote", "saved-model")
        query.assert_awaited_once_with("remote", model="saved-model", upstream_provider=TOKENSPACE)
    asyncio.run(check())


@pytest.mark.parametrize("owner,namespace,state,allowed", [("owner", "current", "active", True), ("other", "current", "active", False), ("owner", "rotated", "active", False), ("owner", "current", "processing", False)])
def test_asset_owner_namespace_and_active_status(owner, namespace, state, allowed):
    async def check():
        store = VolcanoStore()
        principal = ServicePrincipal("owner", "team", "member", frozenset())
        item = await store.create(principal, {"provider_namespace": "current", "upstream_provider": TOKENSPACE, "name": "ref", "kind": "image", "storage_key": "inputs/team/owner/ref"})
        store.items[item["id"]].update(status=state, provider_asset_id="remote")
        found = await store.active_reference(ServicePrincipal(owner, "team", "member", frozenset()), "remote", namespace)
        assert bool(found) == allowed
    asyncio.run(check())


def test_provider_asset_reference_is_not_double_prefixed(monkeypatch):
    async def check():
        import app.standalone_api as api
        store = VolcanoStore()
        principal = ServicePrincipal("owner", "team", "member", frozenset())
        item = await store.create(principal, {"provider_namespace": "current", "upstream_provider": TOKENSPACE, "name": "ref", "kind": "image", "storage_key": "inputs/team/owner/ref"})
        store.items[item["id"]].update(status="active", provider_asset_id="remote")
        monkeypatch.setattr(api, "volcano_store", store)
        record = SimpleNamespace(owner_subject="owner", workspace_id="team", request={"provider_namespace": "current", "references": [{"kind": "image", "asset_ref": "asset://remote"}]})
        assert (await processor._references(record))[0]["url"] == "asset://remote"
    asyncio.run(check())


def test_seedance25_metadata_keeps_duration_contract():
    model = settings.MODELS["seedance-2.5"]
    assert model["id"] == settings.SEEDANCE25_MODEL_ID
    assert model["durations"] == list(range(4, 31))
    assert max(settings.MODELS["seedance-2.0"]["durations"]) == 15


def test_wan_prime_keeps_reference_capabilities():
    wan, prime = settings.MODELS["yike-wan3.0-video"], settings.MODELS["yike-wan3.0-video-prime"]
    assert prime["id"] == settings.YIKE_WAN30_PRIME_MODEL and prime["provider"] == "yike"
    for field in ("supports", "ratios", "durations", "has_audio", "resolutions"):
        assert prime[field] == wan[field]
    assert max(wan["durations"]) == 30
    assert {"reference_image", "reference_video", "reference_audio"} <= set(wan["supports"])


def test_migrations_are_new_workspace_scoped_schema():
    sql = "\n".join(path.read_text(encoding="utf-8") for path in Path("migrations").glob("*.sql"))
    assert "unique (workspace_id, provider_namespace, provider_asset_id)" in sql
    assert "owner_subject" in sql and "auth.users" not in sql
