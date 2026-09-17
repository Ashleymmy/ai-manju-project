import asyncio
from copy import deepcopy
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.model_store import ModelConfigStore, public_model
from app.providers.seedance import seedance_provider_registry
from app.core.auth import ServicePrincipal, require_principal
from api.main import app


def fixtures(monkeypatch):
    values = {key: {"id": "same-upstream-id", "name": key, "provider": "volcano", "available": True, "version": version}
              for key, version in [("seedance-2.0", 3), ("seedance-2.0-mini", 7)]}
    monkeypatch.setattr(settings, "MODELS", deepcopy(values))
    updates = [{"key": key, "version": item["version"], "enabled": False, "name": item["name"], "model_id": item["id"], "concurrency_limit": 2}
               for key, item in values.items()]
    return updates


def test_batch_preserves_distinct_slots_and_updates_all(monkeypatch):
    updates = fixtures(monkeypatch)
    items = asyncio.run(ModelConfigStore("").update_many(updates))
    assert len(items) == 2
    assert [item["version"] for item in items] == [4, 8]
    assert all(not item["enabled"] for item in items)
    assert all(item["concurrency_limit"] == 2 for item in items)


@pytest.mark.parametrize("invalid", ["version", "duplicate", "unknown"])
def test_batch_invalid_selection_changes_nothing(monkeypatch, invalid):
    updates = fixtures(monkeypatch)
    before = deepcopy(settings.MODELS)
    if invalid == "version": updates[1]["version"] -= 1
    if invalid == "duplicate": updates[1] = dict(updates[0])
    if invalid == "unknown": updates[1]["key"] = "missing"
    with pytest.raises(ValueError):
        asyncio.run(ModelConfigStore("").update_many(updates))
    assert settings.MODELS == before


def test_concurrent_database_conflict_rolls_back_entire_batch(monkeypatch):
    updates = fixtures(monkeypatch)
    store = ModelConfigStore("postgresql://mock")
    monkeypatch.setattr(store, "list", AsyncMock(return_value=[{"key": key, **item} for key, item in settings.MODELS.items()]))
    cursor = AsyncMock()
    cursor.__aenter__.return_value = cursor
    cursor.fetchone.side_effect = [{"version": 4}, None]
    connection = AsyncMock()
    connection.__aenter__.return_value = connection
    connection.cursor = MagicMock(return_value=cursor)
    monkeypatch.setattr("app.model_store.psycopg.AsyncConnection.connect", AsyncMock(return_value=connection))
    with pytest.raises(ValueError, match="version conflict"):
        asyncio.run(store.update_many(updates))
    assert cursor.execute.await_count == 2
    assert connection.__aexit__.await_args.args[0] is ValueError
    connection.commit.assert_not_awaited()


def test_batch_requires_admin_and_reports_conflicts(monkeypatch):
    updates = fixtures(monkeypatch)
    from app import standalone_api
    monkeypatch.setattr(standalone_api, "model_store", ModelConfigStore(""))
    client = TestClient(app)
    app.dependency_overrides[require_principal] = lambda: ServicePrincipal("member", "default:member", "member", frozenset())
    try:
        assert client.put("/v1/admin/models", json={"items": updates}).status_code == 403
        app.dependency_overrides[require_principal] = lambda: ServicePrincipal("admin", "default:admin", "admin", frozenset({"admin"}))
        response = client.put("/v1/admin/models", json={"items": updates})
        assert response.status_code == 200
        assert len(response.json()["data"]["items"]) == 2
        assert client.put("/v1/admin/models", json={"items": updates}).status_code == 409
    finally:
        app.dependency_overrides.pop(require_principal, None)


def test_custom_fast_model_uses_proxy_readiness_not_ark_key(monkeypatch):
    monkeypatch.setattr(settings, "EXECUTION_MODE", "provider")
    monkeypatch.setattr(settings, "ARK_API_KEY", "")
    proxy = seedance_provider_registry.get("legacy_proxy")
    monkeypatch.setattr(proxy, "configured", lambda: True)
    item = public_model({"key": "seedance-fast", "id": "custom-fast-id", "provider": "volcano", "available": True})
    assert item["available"] is True
