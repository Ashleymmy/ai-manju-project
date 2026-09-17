"""Official protocol contract tests. All HTTP uses MockTransport; no paid calls."""
import asyncio
import json
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.core.auth import ServicePrincipal, require_principal
from app.model_store import public_model
from app.providers.seedance import ARK_OFFICIAL, LEGACY_PROXY, TOKENSPACE, SeedanceProviderError, seedance_provider_registry
from app.providers.seedance.ark_official import ArkOfficialProvider
from app.volcano_api import VolcanoVideoAPI
from app.volcano_store import VolcanoStore
from worker.asset_worker import process_asset


def provider(handler=None, **overrides):
    options = dict(base_url="https://ark.cn-beijing.volces.com/api/v3", api_key="test-api-key",
                   asset_base_url="https://ark.cn-beijing.volcengineapi.com", access_key_id="test-ak",
                   secret_access_key="test-sk", project_name="default", security_token="test-sts")
    options.update(overrides)
    return ArkOfficialProvider(**options, transport=httpx.MockTransport(handler) if handler else None)


def test_official_signing_matches_sdk_vector():
    # Expected Authorization generated independently by the official Python SDK
    # SignerV4 at a frozen time, using only these fake test credentials.
    headers = provider()._signed_headers(b'{"Id":"asset-test","ProjectName":"default"}',
                                        {"Action": "GetAsset", "Version": "2024-01-01"},
                                        now=datetime(2026, 9, 17, 1, 2, 3, tzinfo=timezone.utc))
    assert headers["authorization"] == (
        "HMAC-SHA256 Credential=test-ak/20260917/cn-beijing/ark/request, "
        "SignedHeaders=content-type;host;x-content-sha256;x-date;x-security-token, "
        "Signature=23d480213abf12404d7b3bcbf14829fc8de8063a0fc31fc0f46a048539fafa5b"
    )


def test_official_video_keeps_model_snapshot_and_supports_query_delete():
    seen = []
    def handler(request):
        seen.append(request)
        assert request.url.host == "ark.cn-beijing.volces.com"
        assert request.headers["Authorization"] == "Bearer test-api-key"
        assert "x-security-token" not in request.headers
        if request.method == "POST":
            assert json.loads(request.content)["model"] == "ep-custom-saved"
            return httpx.Response(200, json={"id": "task-1"}, headers={"x-request-id": "req-create"})
        if request.method == "DELETE": return httpx.Response(204)
        return httpx.Response(200, json={"id": "task-1", "status": "succeeded", "content": {"video_url": "https://cdn.test/out.mp4"}})
    async def check():
        adapter = provider(handler)
        created = await adapter.create_video_task({"model": "ep-custom-saved", "content": [{"type": "image_url", "image_url": {"url": "asset://owned"}, "role": "reference_image"}]})
        assert created["id"] == "task-1" and created["request_id"] == "req-create"
        assert (await adapter.get_video_task("task-1"))["status"] == "succeeded"
        assert (await adapter.cancel_video_task("task-1"))["success"]
    asyncio.run(check())
    assert [(r.method, r.url.path) for r in seen] == [
        ("POST", "/api/v3/contents/generations/tasks"),
        ("GET", "/api/v3/contents/generations/tasks/task-1"),
        ("DELETE", "/api/v3/contents/generations/tasks/task-1"),
    ]


def test_official_asset_register_poll_delete_lifecycle():
    seen = []
    def handler(request):
        assert request.url.host == "ark.cn-beijing.volcengineapi.com" and request.url.path == "/"
        assert request.url.params["Version"] == "2024-01-01" and request.method == "POST"
        assert request.headers["Authorization"].startswith("HMAC-SHA256 Credential=test-ak/")
        assert "test-api-key" not in str(request.headers)
        body = json.loads(request.content)
        assert body["ProjectName"] == "default"
        action = request.url.params["Action"]
        seen.append((action, body))
        result = {"CreateAssetGroup": {"Id": "group-1"}, "CreateAsset": {"Id": "asset-1"},
                  "GetAsset": {"Id": "asset-1", "Status": "Active"}, "DeleteAsset": {}}[action]
        return httpx.Response(200, json={"ResponseMetadata": {"RequestId": "req-1"}, "Result": result})
    async def check():
        store, adapter = VolcanoStore(), provider(handler, api_key="")
        principal = ServicePrincipal("owner", "team", "member", frozenset({"*"}))
        item = await store.create(principal, dict(storage_key="inputs/team/owner/a", kind="image", name="测" * 90,
                                                 upstream_provider=ARK_OFFICIAL, provider_namespace=adapter.namespace))
        storage = AsyncMock()
        storage.url.return_value = "https://studio.test/signed?token=temporary"
        await process_asset(await store.claim(), store, storage, adapter)
        assert store.items[item["id"]]["status"] == "processing"
        store.items[item["id"]]["next_poll_at"] = 0
        await process_asset(await store.claim(), store, storage, adapter)
        assert await store.active_reference(principal, "asset-1", adapter.namespace)
        assert await store.active_reference(principal, "asset-1", "legacy_default") is None
        await store.edit(principal, item["id"], {"delete": True})
        await process_asset(await store.claim(), store, storage, adapter)
        assert store.items[item["id"]]["status"] == "deleted"
    asyncio.run(check())
    assert [action for action, _ in seen] == ["CreateAssetGroup", "CreateAsset", "GetAsset", "DeleteAsset"]
    assert seen[0][1]["GroupType"] == "AIGC"
    assert seen[1][1]["GroupId"] == "group-1" and seen[1][1]["AssetType"] == "Image"
    assert len(seen[1][1]["Name"]) == 64
    assert seen[2][1] == {"Id": "asset-1", "ProjectName": "default"}


@pytest.mark.parametrize("status", [200, 403, 503])
def test_openapi_errors_preserve_codes_without_echoing_credentials(status):
    adapter = provider(lambda r: httpx.Response(status, json={"ResponseMetadata": {
        "RequestId": "req-error", "Error": {"Code": "AccessDenied", "Message": "test-ak test-sk test-api-key test-sts https://private.test/?token=hidden"}}}))
    async def check():
        with pytest.raises(SeedanceProviderError) as caught: await adapter.get_asset("asset-1")
        assert caught.value.error_code == "AccessDenied" and caught.value.request_id == "req-error"
        assert caught.value.http_status == status
        for text in ("test-ak", "test-sk", "test-api-key", "test-sts", "private.test", "hidden"):
            assert text not in str(caught.value)
    asyncio.run(check())


def test_failed_asset_is_terminal_state_not_transport_error():
    adapter = provider(lambda r: httpx.Response(200, json={"Result": {
        "Id": "asset-1", "Status": "Failed", "Error": {"Code": "FaceMismatch", "Message": "rejected"}}}))
    assert asyncio.run(adapter.get_asset("asset-1"))["record"]["Status"] == "Failed"


def test_readiness_and_namespaces_are_independent():
    assert provider(access_key_id="", secret_access_key="").configured()
    assert not provider(access_key_id="", secret_access_key="").assets_configured()
    assert provider(api_key="").assets_configured()
    assert not provider(api_key="").configured()
    original = provider().namespace
    assert original.startswith("ark_official:")
    for changes in ({"api_key": "rotated"}, {"access_key_id": "other"}, {"project_name": "other"}, {"region": "other"}):
        assert provider(**changes).namespace != original


def test_official_slot_is_independent_of_proxy_default(monkeypatch):
    monkeypatch.setattr(settings, "SEEDANCE20_PROVIDER", TOKENSPACE)
    monkeypatch.setattr(settings, "SEEDANCE_ASSET_PROVIDER", ARK_OFFICIAL)
    assert seedance_provider_registry.submission_provider("seedance-2.0-ark") == ARK_OFFICIAL
    assert seedance_provider_registry.submission_provider("seedance-2.0") == TOKENSPACE
    assert seedance_provider_registry.submission_provider("seedance-2.5") == TOKENSPACE
    assert seedance_provider_registry.asset_provider().name == ARK_OFFICIAL
    monkeypatch.setattr(settings, "EXECUTION_MODE", "provider")
    model = {"key": "seedance-2.0-ark", **settings.MODELS["seedance-2.0-ark"], "id": "ep-custom"}
    monkeypatch.setitem(seedance_provider_registry._providers, ARK_OFFICIAL, provider(api_key=""))
    assert public_model(model)["disabled_reason"] == "provider_credentials_missing"
    monkeypatch.setitem(seedance_provider_registry._providers, ARK_OFFICIAL, provider())
    assert public_model(model)["available"]


@pytest.mark.parametrize("configured,expected", [("", ARK_OFFICIAL), (ARK_OFFICIAL, ARK_OFFICIAL), (TOKENSPACE, TOKENSPACE), (LEGACY_PROXY, LEGACY_PROXY)])
def test_asset_default_is_official_with_explicit_proxy_overrides(monkeypatch, configured, expected):
    monkeypatch.setattr(settings, "SEEDANCE20_PROVIDER", TOKENSPACE)
    monkeypatch.setattr(settings, "SEEDANCE_ASSET_PROVIDER", configured)
    assert seedance_provider_registry.asset_provider().name == expected


def test_custom_model_uses_frozen_official_provider_for_all_operations(monkeypatch):
    seen = []
    def handler(request):
        seen.append(request)
        if request.method == "POST": return httpx.Response(200, json={"id": "task-1"})
        if request.method == "DELETE": return httpx.Response(204)
        return httpx.Response(200, json={"status": "running"})
    monkeypatch.setitem(seedance_provider_registry._providers, ARK_OFFICIAL, provider(handler))
    monkeypatch.setattr(settings, "SEEDANCE20_PROVIDER", TOKENSPACE)
    async def check():
        from worker import processor
        monkeypatch.setattr(processor, "volcano_api", VolcanoVideoAPI())
        record = SimpleNamespace(model="seedance-2.0-ark", provider="volcano", prompt="图片1走路", request={
            "upstream_provider": ARK_OFFICIAL, "seed": 0, "model_config": {"id": "ep-frozen", "provider": "volcano", "available": True}})
        assert await processor._provider_for(record) == ("volcano", "ep-frozen")
        await processor._create_upstream(record, "volcano", "ep-frozen", references=[])
        await processor._query_upstream(record, "volcano", "task-1", "ep-frozen")
        await processor._cancel_upstream(record, "volcano", "task-1", "ep-frozen")
    asyncio.run(check())
    assert [r.method for r in seen] == ["POST", "GET", "DELETE"]
    body = json.loads(seen[0].content)
    assert body["model"] == "ep-frozen" and body["seed"] == 0


def test_readiness_distinguishes_asset_credentials_and_does_not_probe_cloud(monkeypatch):
    from api.main import app
    from app import standalone_api as api
    monkeypatch.setattr(settings, "SEEDANCE_ASSET_PROVIDER", ARK_OFFICIAL)
    monkeypatch.setattr(settings, "EXECUTION_MODE", "provider")
    monkeypatch.setattr(settings, "SD_VIDEO_MODE", "active")
    monkeypatch.setitem(seedance_provider_registry._providers, ARK_OFFICIAL, provider(access_key_id="", secret_access_key=""))
    monkeypatch.setattr(api, "_completed_input", AsyncMock(return_value="inputs/team/admin/a"))
    create = AsyncMock()
    monkeypatch.setattr(api.volcano_store, "create", create)
    app.dependency_overrides[require_principal] = lambda: ServicePrincipal("admin", "team", "admin", frozenset({"*"}))
    try:
        with TestClient(app) as client:
            response = client.get("/v1/volcano/readiness")
            assert response.status_code == 200
            data = response.json()["data"]
            assert data["provider_id"] == ARK_OFFICIAL and data["video_provider_configured"]
            assert not data["provider_configured"] and not data["upload_registration_available"]
            assert "AK/SK" in data["provider_error"]
            assert "test-api-key" not in response.text
            registration = client.post("/v1/volcano/assets", json={"storage_token": "inputs/team/admin/a"})
            assert registration.status_code == 503
            create.assert_not_awaited()
    finally:
        app.dependency_overrides.clear()


def test_registration_and_task_creation_share_official_namespace(monkeypatch):
    from api.main import app
    from app import standalone_api as api
    adapter = provider()
    principal = ServicePrincipal("owner", "team", "member", frozenset({"*"}))
    monkeypatch.setattr(settings, "SEEDANCE_ASSET_PROVIDER", ARK_OFFICIAL)
    monkeypatch.setattr(settings, "SEEDANCE20_PROVIDER", TOKENSPACE)
    monkeypatch.setattr(settings, "EXECUTION_MODE", "provider")
    monkeypatch.setattr(settings, "SD_VIDEO_MODE", "active")
    monkeypatch.setitem(seedance_provider_registry._providers, ARK_OFFICIAL, adapter)
    store = VolcanoStore()
    monkeypatch.setattr(api, "volcano_store", store)
    monkeypatch.setattr(api, "task_store", api.InMemoryTaskStore())
    monkeypatch.setattr(api, "_completed_input", AsyncMock(return_value="inputs/team/owner/a"))
    monkeypatch.setattr(api.task_queue, "enqueue", AsyncMock())
    app.dependency_overrides[require_principal] = lambda: principal
    try:
        with TestClient(app) as client:
            created = client.post("/v1/volcano/assets", json={"storage_token": "inputs/team/owner/a", "name": "image"})
            assert created.status_code == 200
            asset = store.items[created.json()["data"]["id"]]
            assert asset["upstream_provider"] == ARK_OFFICIAL and asset["provider_namespace"] == adapter.namespace
            asset.update(status="active", provider_asset_id="remote-official")
            request = {"idempotency_key": "official-task", "model": "seedance-2.0-ark", "prompt": "image", "references": [{"kind": "image", "asset_ref": "asset://remote-official"}]}
            task = client.post("/v1/tasks", json=request)
            assert task.status_code == 202
            record = asyncio.run(api.task_store.get_by_id(task.json()["data"]["task_id"]))
            assert record.request["upstream_provider"] == ARK_OFFICIAL
            assert record.request["provider_namespace"] == adapter.namespace
            assert record.request["model_config"]["id"] == settings.ARK_OFFICIAL_MODEL_ID
            # A proxy model cannot use the same account-scoped official asset.
            assert client.post("/v1/tasks", json={**request, "idempotency_key": "proxy-task", "model": "seedance-2.0"}).status_code == 403
            asset["status"] = "processing"
            assert client.post("/v1/tasks", json={**request, "idempotency_key": "pending-task"}).status_code == 403
            assert len(asyncio.run(api.task_store.list(principal))) == 1
    finally:
        app.dependency_overrides.clear()


def test_existing_database_gets_official_slot_without_overwriting_config(monkeypatch):
    from app.model_store import ModelConfigStore
    original = {"id": "seedance-2.0", "model_id": "operator-model", "name": "operator name", "provider": "volcano",
                "enabled": False, "capabilities": {}, "config": {"concurrency_limit": 7}, "version": 9}
    official = {"id": "seedance-2.0-ark", "model_id": settings.ARK_OFFICIAL_MODEL_ID, "name": "official", "provider": "volcano",
                "enabled": True, "capabilities": {}, "config": {"upstream_provider": ARK_OFFICIAL}, "version": 1}
    cursor = AsyncMock()
    cursor.fetchall.side_effect = [[original], [original, official]]
    cursor.__aenter__.return_value = cursor
    connection = AsyncMock()
    connection.__aenter__.return_value = connection
    connection.cursor = MagicMock(return_value=cursor)
    monkeypatch.setattr("app.model_store.psycopg.AsyncConnection.connect", AsyncMock(return_value=connection))
    rows = asyncio.run(ModelConfigStore("postgresql://unused-mock").list())
    assert rows[0]["id"] == "operator-model" and rows[0]["version"] == 9
    assert rows[0]["enabled"] is False and rows[0]["concurrency_limit"] == 7
    inserts = [call for call in cursor.execute.await_args_list if call.args[0].startswith("insert")]
    assert len(inserts) == 1 and inserts[0].args[1][0] == "seedance-2.0-ark"
    assert rows[1]["upstream_provider"] == ARK_OFFICIAL
