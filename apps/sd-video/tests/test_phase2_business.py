import asyncio
import time
import uuid
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from api.main import app
from app.config import settings
from app.core.auth import ServicePrincipal, require_principal
from app.volcano_store import VolcanoStore
from app.safe_download import resolve_target
from worker.asset_worker import process_asset


def principal(name="owner"):
    return ServicePrincipal(name, "team", "member", frozenset({"*"}))


def test_local_storage_preserves_personal_workspace_keys(tmp_path):
    from app.storage.adapter import LocalStorageAdapter
    async def check():
        storage = LocalStorageAdapter(str(tmp_path))
        key = "inputs/default:owner/owner/image.png"
        assert await storage.put(key, b"image", "image/png") == key
        assert await storage.get(key) == b"image"
        await storage.delete(key)
        with pytest.raises(FileNotFoundError): await storage.get(key)
    asyncio.run(check())


def test_asset_register_poll_delete_and_owner_boundary():
    async def check():
        store = VolcanoStore()
        item = await store.create(principal(), dict(storage_key="inputs/team/owner/file", kind="image", name="reference", upstream_provider="fake", provider_namespace="namespace"))
        assert item["status"] == "queued" and item["provider_asset_id"] is None
        assert await store.list(principal("another")) == []
        assert await store.edit(principal("another"), item["id"], {"delete": True}) is None
        provider = AsyncMock()
        provider.namespace = "namespace"
        provider.configured = lambda: True
        provider.create_asset_group.return_value = {"id": "group"}
        provider.create_asset.return_value = {"id": "remote"}
        provider.get_asset.return_value = {"record": {"Status": "Active"}}
        storage = AsyncMock()
        storage.url.return_value = "https://media.invalid/signed"
        await process_asset(await store.claim(), store, storage, provider)
        assert store.items[item["id"]]["status"] == "processing"
        store.items[item["id"]]["next_poll_at"] = 0
        await process_asset(await store.claim(), store, storage, provider)
        assert await store.active_reference(principal(), "remote", "namespace")
        assert await store.active_reference(principal(), "remote", "changed") is None
        await store.edit(principal(), item["id"], {"delete": True})
        assert await store.active_reference(principal(), "remote") is None
        await process_asset(await store.claim(), store, storage, provider)
        provider.delete_asset.assert_awaited_once_with("remote")
        assert store.items[item["id"]]["status"] == "deleted"
    asyncio.run(check())


def test_uncertain_asset_submission_never_recreates():
    async def check():
        store = VolcanoStore()
        item = await store.create(principal(), dict(storage_key="inputs/team/owner/file", kind="image", name="reference", upstream_provider="fake", provider_namespace="namespace"))
        store.items[item["id"]]["submission_started_at"] = time.time()
        provider = AsyncMock()
        provider.namespace = "namespace"
        provider.configured = lambda: True
        await process_asset(await store.claim(), store, AsyncMock(), provider)
        provider.create_asset.assert_not_awaited()
        assert store.items[item["id"]]["error"]["code"] == "submission_uncertain"
    asyncio.run(check())


@pytest.mark.parametrize("address", ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "fe80::1"])
def test_provider_result_rejects_private_dns(monkeypatch, address):
    monkeypatch.setattr("socket.getaddrinfo", lambda *args, **kwargs: [(2, 1, 6, "", (address, 443))])
    with pytest.raises(ValueError): resolve_target("https://provider.invalid/result.mp4")


def test_conversation_versions_pagination_and_completed_inputs(monkeypatch, tmp_path):
    from app.storage.adapter import LocalStorageAdapter
    monkeypatch.setattr("app.standalone_api.local_storage", LocalStorageAdapter(str(tmp_path)))
    monkeypatch.setattr(settings, "EXECUTION_MODE", "mock")
    monkeypatch.setattr(settings, "SD_VIDEO_MODE", "active")
    app.dependency_overrides[require_principal] = lambda: principal()
    try:
        with TestClient(app) as client:
            conversation = client.post("/v1/conversations", json={"id": f"conv_{uuid.uuid4().hex}", "title": "draft"}).json()["data"]
            path = f"/v1/conversations/{conversation['id']}"
            assert client.patch(path, json={"title": "changed", "version": 1}).status_code == 200
            assert client.patch(path, json={"title": "stale", "version": 1}).status_code == 409
            for text in ("a", "b"):
                assert client.post("/v1/messages", json={"conversation_id": conversation["id"], "text": text}).status_code == 200
            messages = client.get(path + "/messages?page=2&pageSize=1").json()["data"]
            assert messages["total"] == 2 and messages["items"][0]["text"] == "b"
            assert client.post("/v1/messages", json={"conversation_id": conversation["id"], "text": "x", "task_id": "unowned"}).status_code == 404
            issued = client.post("/v1/inputs/presign", json={"name": "ref.png", "content_type": "image/png", "size_bytes": 3}).json()["data"]
            task = {"model": "seedance-2.0", "idempotency_key": uuid.uuid4().hex, "references": [{"kind": "image", "storage_token": issued["upload_token"]}]}
            assert client.post("/v1/tasks", json=task).status_code == 409
            assert client.put(issued["upload_url"], content=b"png").status_code == 200
            assert client.post("/v1/inputs/complete", json={"upload_token": issued["upload_token"]}).status_code == 200
            assert client.post("/v1/tasks", json=task).status_code == 202
            forged = dict(task, idempotency_key=uuid.uuid4().hex, references=[{"kind": "image", "asset_ref": "asset://not-owned"}])
            assert client.post("/v1/tasks", json=forged).status_code == 403
    finally:
        app.dependency_overrides.pop(require_principal, None)


def test_rollout_drain_requires_explicit_scope(monkeypatch, tmp_path):
    from app.storage.adapter import LocalStorageAdapter
    monkeypatch.setattr("app.standalone_api.local_storage", LocalStorageAdapter(str(tmp_path)))
    monkeypatch.setattr(settings, "EXECUTION_MODE", "mock")
    monkeypatch.setattr(settings, "SD_VIDEO_MODE", "disabled")
    app.dependency_overrides[require_principal] = lambda: principal()
    try:
        with TestClient(app) as client:
            request = {"model": "seedance-2.0", "idempotency_key": uuid.uuid4().hex}
            assert client.post("/v1/tasks", json=request).status_code == 503
            app.dependency_overrides[require_principal] = lambda: ServicePrincipal("owner", "team", "member", frozenset({"tasks:write", "tasks:drain"}))
            assert client.post("/v1/tasks", json=request).status_code == 202
    finally:
        app.dependency_overrides.pop(require_principal, None)


def test_asset_url_registration_rejects_private_targets(monkeypatch):
    monkeypatch.setattr(settings, "SD_VIDEO_MODE", "active")
    app.dependency_overrides[require_principal] = lambda: principal()
    try:
        with TestClient(app) as client:
            assert client.post("/v1/volcano/register-url", json={"source_url": "https://127.0.0.1/private", "kind": "image"}).status_code == 400
    finally:
        app.dependency_overrides.pop(require_principal, None)
