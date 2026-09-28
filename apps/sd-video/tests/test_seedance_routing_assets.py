"""旧路由回归迁到独立服务：Provider 选择、快照与授权素材契约。"""
import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from app.config import settings
from app.core.auth import ServicePrincipal
from app.providers.seedance import LEGACY_PROXY, TOKENSPACE, seedance_provider_registry
from app.model_store import public_model
from app.volcano_store import VolcanoStore
from worker import processor


@pytest.mark.parametrize("logical,expected", [("seedance-2.0", TOKENSPACE), ("seedance-2.5", LEGACY_PROXY), ("seedance-2.0-mini", LEGACY_PROXY), ("seedance-fast", LEGACY_PROXY)])
def test_new_tasks_route_by_logical_model(monkeypatch, logical, expected):
    monkeypatch.setattr(settings, "SEEDANCE20_PROVIDER", TOKENSPACE)
    assert seedance_provider_registry.submission_provider(logical) == expected


def test_explicit_model_routes_are_reflected_in_public_catalog(monkeypatch):
    overrides = dict(settings.SEEDANCE_MODEL_PROVIDER_OVERRIDES)
    overrides.update({
        "seedance-2.0": TOKENSPACE,
        "seedance-2.5": LEGACY_PROXY,
        "seedance-2.0-mini": LEGACY_PROXY,
        "seedance-fast": LEGACY_PROXY,
    })
    monkeypatch.setattr(settings, "SEEDANCE_MODEL_PROVIDER_OVERRIDES", overrides)
    monkeypatch.setattr(settings, "EXECUTION_MODE", "mock")

    assert seedance_provider_registry.submission_provider("seedance-2.0") == TOKENSPACE
    # A stale database row must not make the public catalog advertise another
    # route than task submission uses.
    item = public_model({
        "key": "seedance-2.0",
        "id": "old-model-id",
        "provider": "volcano",
        "upstream_provider": LEGACY_PROXY,
        "available": True,
    })
    assert item["upstream_provider"] == TOKENSPACE


def test_legacy_task_without_route_snapshot_uses_model_mapping(monkeypatch):
    monkeypatch.setattr(settings, "SEEDANCE20_PROVIDER", TOKENSPACE)
    record = SimpleNamespace(model="seedance-2.0", request={})
    assert processor._seedance_upstream_provider(record, settings.SEEDANCE20_MODEL_ID) == TOKENSPACE


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


def test_provider_asset_reference_takes_precedence_over_stale_storage_token(monkeypatch):
    async def check():
        import app.standalone_api as api
        store = VolcanoStore()
        principal = ServicePrincipal("owner", "team", "member", frozenset())
        item = await store.create(principal, {"provider_namespace": "current", "upstream_provider": LEGACY_PROXY, "name": "ref", "kind": "image", "storage_key": "inputs/team/owner/ref"})
        store.items[item["id"]].update(status="active", provider_asset_id="remote-company")
        monkeypatch.setattr(api, "volcano_store", store)
        storage = AsyncMock()
        monkeypatch.setattr(processor, "local_storage", storage)
        record = SimpleNamespace(
            owner_subject="owner",
            workspace_id="team",
            request={
                "provider_namespace": "current",
                "references": [{
                    "kind": "image",
                    "asset_ref": "asset://remote-company",
                    "storage_token": "inputs/team/owner/stale",
                }],
            },
        )
        references = await processor._references(record)
        assert references[0]["url"] == "asset://remote-company"
        storage.url.assert_not_awaited()
    asyncio.run(check())


def test_storage_reference_refreshes_signed_url_instead_of_reusing_snapshot(monkeypatch):
    async def check():
        storage = AsyncMock()
        storage.url.return_value = "https://cdn.example.com/fresh?token=rotated"
        monkeypatch.setattr(processor, "local_storage", storage)
        record = SimpleNamespace(
            id="task-refresh",
            owner_subject="owner",
            workspace_id="team",
            request={
                "references": [{
                    "kind": "image",
                    "storage_token": "inputs/team/owner/ref.png",
                    "url": "https://old.example.com/expired?token=stale",
                }],
            },
        )
        references = await processor._references(record)
        assert references[0]["url"] == "https://cdn.example.com/fresh?token=rotated"
        storage.url.assert_awaited_once_with("inputs/team/owner/ref.png", processor.reference_url_ttl_seconds())
    asyncio.run(check())


def test_reference_snapshot_must_be_https_when_no_storage_token():
    async def check():
        record = SimpleNamespace(
            id="task-invalid-url",
            owner_subject="owner",
            workspace_id="team",
            request={"references": [{"kind": "image", "url": "http://127.0.0.1/ref.png"}]},
        )
        with pytest.raises(ValueError, match="public HTTPS"):
            await processor._references(record)
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
