import asyncio
import json
import time
import uuid
from unittest.mock import AsyncMock

import httpx
import pytest

from test_catalog_queries import catalog, catalog_database, body
from app import standalone_api as api
from app.config import settings
from app.core.auth import ServicePrincipal
from app.providers.seedance.base import SeedanceProviderError
from app.providers.seedance.tokenspace import TokenSpaceProvider
from app.vidu_api import ViduAPIError
from app.volcano_api import VolcanoAPIError, VolcanoGatewayError
from app.yike_api import YikeAPIError
from app.mock_media import MOCK_VIDEO
from worker import processor
from worker.errors import MESSAGE_LIMIT, exception_details, safe_text


CREATE_UPSTREAM = processor._create_upstream


@pytest.fixture
def task(catalog, monkeypatch):
    client, actor, _ = catalog
    monkeypatch.setattr(settings, "SD_VIDEO_MODE", "active")
    monkeypatch.setattr(processor, "task_store", api.task_store)
    monkeypatch.setattr(processor, "catalog_store", None)
    monkeypatch.setattr(processor, "local_storage", AsyncMock())
    monkeypatch.setattr(processor, "_provider_for", AsyncMock(return_value=("volcano", settings.VM_SEEDANCE_20)))
    monkeypatch.setattr(processor, "_references", AsyncMock(return_value=[]))
    monkeypatch.setattr(processor, "_create_upstream", AsyncMock(return_value={"id": "upstream-1"}))
    monkeypatch.setattr(processor, "_query_upstream", AsyncMock(return_value={"status": "succeeded", "content": {"video_url": "https://example.invalid/video"}}))
    monkeypatch.setattr(processor, "_download", AsyncMock(return_value=MOCK_VIDEO))
    monkeypatch.setattr(processor, "_cancel_upstream", AsyncMock())
    monkeypatch.setattr(api, "task_queue", AsyncMock())

    async def seed():
        record, _ = await api.task_store.create(actor[0], dict(model="seedance-2.0", provider="volcano", prompt="a cat",
            upstream_provider="tokenspace", idempotency_key=uuid.uuid4().hex))
        return record.id
    return client, actor, asyncio.run(seed())


def execute(task):
    task_id = task[2]
    async def run():
        record = await api.task_store.claim(task_id) if hasattr(api.task_store, "claim") else await api.task_store.get_by_id(task_id)
        await processor.process_task(record)
        return await api.task_store.get_by_id(task_id)
    return asyncio.run(run())


@pytest.mark.parametrize("status", [400, 401, 403, 404, 405, 413, 415, 422, 429])
def test_definite_rejection_is_visible_and_only_retries_when_requested(task, status):
    client, _, task_id = task
    processor._create_upstream.side_effect = VolcanoAPIError("input image is invalid", error_code="InvalidImage", http_status=status, request_id="upstream-request-1")
    record = execute(task)
    assert record.status == "failed" and record.provider_task_id is None
    assert record.error == dict(code="provider_rejected", message="input image is invalid", phase="submit",
        exception_type="VolcanoAPIError", provider_code="InvalidImage", http_status=status, request_id="upstream-request-1")
    assert body(client.get(f"/v1/tasks/{task_id}"))["error"] == record.error
    api.task_queue.enqueue.assert_not_awaited()
    processor._create_upstream.assert_awaited_once()
    processor._references.assert_awaited_once()
    processor._query_upstream.assert_not_awaited()
    retried = client.post(f"/v1/tasks/{task_id}/retry").json()["data"]
    assert retried["task_id"] != task_id and retried["attempt"] == 2 and retried["error"] is None
    assert body(client.get(f"/v1/tasks/{task_id}"))["error"] == record.error
    assert client.post(f"/v1/tasks/{task_id}/retry").json()["data"]["task_id"] == retried["task_id"]
    processor._create_upstream.assert_awaited_once()


@pytest.mark.parametrize("failure", [
    VolcanoAPIError("request timed out", http_status=408),
    VolcanoAPIError("conflict", http_status=409),
    VolcanoGatewayError("upstream unavailable", http_status=500),
    VolcanoGatewayError("upstream unavailable", http_status=502),
    VolcanoGatewayError("upstream unavailable", http_status=503),
    VolcanoGatewayError("upstream unavailable", http_status=504),
    httpx.ReadTimeout(""), httpx.ConnectError("connection lost"),
    SeedanceProviderError("response missing id"),
    VolcanoAPIError("invalid JSON", http_status=200),
])
def test_ambiguous_submission_keeps_retry_locked(task, failure):
    client, _, task_id = task
    processor._create_upstream.side_effect = failure
    record = execute(task)
    assert record.error["code"] == "submission_uncertain" and record.error["message"]
    assert record.error["phase"] == "submit"
    assert client.post(f"/v1/tasks/{task_id}/retry").status_code == 409
    api.task_queue.enqueue.assert_not_awaited()
    # 模拟进程恢复，不得第二次调用创建接口。
    asyncio.run(processor.process_task(record))
    processor._create_upstream.assert_awaited_once()


@pytest.mark.parametrize("error_type", [SeedanceProviderError, ViduAPIError, YikeAPIError])
def test_other_provider_errors_follow_same_rejection_rules(task, error_type):
    processor._create_upstream.side_effect = error_type("invalid input", http_status=422, error_code="InvalidInput")
    assert execute(task).error["code"] == "provider_rejected"


def test_reference_preparation_failure_never_marks_submission_started(task):
    processor._references.side_effect = ValueError("private database password=do-not-leak")
    record = execute(task)
    assert record.error["phase"] == "references" and record.error["code"] == "invalid_configuration"
    assert getattr(record, "submission_started_at", None) is None
    assert "do-not-leak" not in json.dumps(record.error)
    processor._create_upstream.assert_not_awaited()


def test_missing_id_response_is_uncertain(task):
    processor._create_upstream.return_value = {"status": "queued"}
    assert execute(task).error["code"] == "submission_uncertain"


def test_real_adapter_400_reaches_task_and_logs_without_secrets(task, monkeypatch, caplog):
    key = "configured-provider-secret"
    monkeypatch.setattr(settings, "TOKENSPACE_API_KEY", key)
    requests = []
    def reject(request):
        requests.append(request)
        return httpx.Response(400, json={"error": {"code": "InvalidImage", "message":
            f"cannot read image https://media.invalid/a?token=private-token key={key} Bearer raw-access-token"}},
            headers={"x-request-id": "req-real-adapter"})
    provider = TokenSpaceProvider("https://tokenspace.invalid", key, "mock-model", transport=httpx.MockTransport(reject))
    monkeypatch.setattr(processor.seedance_provider_registry, "get", lambda _name: provider)
    monkeypatch.setattr(processor, "_create_upstream", AsyncMock(wraps=CREATE_UPSTREAM))
    record = execute(task)
    assert len(requests) == 1 and requests[0].method == "POST"
    assert record.error["code"] == "provider_rejected" and record.error["http_status"] == 400
    assert record.error["provider_code"] == "InvalidImage" and record.error["request_id"] == "req-real-adapter"
    assert "cannot read image" in record.error["message"]
    output = json.dumps(record.error) + caplog.text
    for secret in (key, "media.invalid", "private-token", "raw-access-token"):
        assert secret not in output
    assert "req-real-adapter" in caplog.text and '"http_status": 400' in caplog.text
    processor._references.assert_awaited_once()


def test_existing_provider_id_never_recreates_and_clears_transient_error(task):
    task_id = task[2]
    asyncio.run(api.task_store.update(task_id, provider_task_id="existing-id", status="running"))
    processor._query_upstream.side_effect = VolcanoAPIError("query refused", http_status=400, request_id="query-req")
    record = execute(task)
    assert record.status == "running" and record.provider_task_id == "existing-id"
    assert record.error["phase"] == "poll" and record.error["http_status"] == 400
    assert record.lease_owner is None
    processor._create_upstream.assert_not_awaited()
    processor._query_upstream.side_effect = None
    # 恢复同一任务，只查询与下载。
    record = asyncio.run(api.task_store.get_by_id(task_id))
    asyncio.run(processor.process_task(record))
    record = asyncio.run(api.task_store.get_by_id(task_id))
    assert record.status == "succeeded" and record.error is None
    processor._create_upstream.assert_not_awaited()


def test_terminal_provider_error_retains_safe_reason(task, caplog):
    processor._query_upstream.return_value = {"status": "failed", "error_code": "InputImageRejected",
        "error_message": "image rejected https://private.invalid/a?token=hidden", "request_id": "terminal-request"}
    record = execute(task)
    assert record.status == "failed" and record.error["code"] == "InputImageRejected"
    assert record.error["message"] == "image rejected [url]" and record.error["request_id"] == "terminal-request"
    assert "private.invalid" not in caplog.text
    processor.local_storage.put.assert_not_awaited()


def test_diagnostics_do_not_bypass_owner_scope(task):
    client, actor, task_id = task
    processor._create_upstream.side_effect = VolcanoAPIError("invalid image", http_status=400)
    execute(task)
    actor[0] = ServicePrincipal("different-owner", actor[0].workspace_id, "member", frozenset({"*"}))
    assert client.get(f"/v1/tasks/{task_id}").status_code == 404


def test_lost_lease_still_prevents_failure_write(task, monkeypatch):
    task_id = task[2]
    async def lose_lease(*args, **kwargs):
        await api.task_store.update(task_id, lease_owner="new-owner", lease_expires_at=time.time() + 60)
        raise VolcanoAPIError("invalid image", http_status=400)
    monkeypatch.setattr(processor, "_create_upstream", AsyncMock(side_effect=lose_lease))
    # 显式设置租约，以内存实现复现旧 Worker 的持有者校验。
    if not hasattr(api.task_store, "claim"):
        asyncio.run(api.task_store.update(task_id, lease_owner="old-owner", lease_expires_at=time.time() + 60))
    record = execute(task)
    assert record.error is None and record.lease_owner == "new-owner"


def test_safe_text_redacts_before_truncating(monkeypatch):
    monkeypatch.setattr(settings, "TOKENSPACE_API_KEY", "known-secret")
    source = ('known-secret Bearer bearer-value eyJheader.payload.signature '
        'https://example.invalid/?token=abc api_key="unknown-secret" '
        'data:image/png;base64,YWJjZA==\n-----BEGIN PRIVATE KEY-----\nprivate\n-----END PRIVATE KEY-----\n' + "x" * 3000)
    result = safe_text(source)
    assert len(result) == MESSAGE_LIMIT and "\n" not in result
    for secret in ("known-secret", "unknown-secret", "bearer-value", "eyJheader", "example.invalid", "YWJjZA==", "BEGIN PRIVATE"):
        assert secret not in result


def test_httpx_status_error_gets_structured_safe_details():
    response = httpx.Response(422, request=httpx.Request("POST", "https://provider.invalid/tasks"),
        json={"error": {"code": "InvalidInput", "message": "invalid reference"}}, headers={"x-request-id": "req-422"})
    with pytest.raises(httpx.HTTPStatusError) as failure:
        response.raise_for_status()
    result = exception_details(failure.value, code="provider_rejected", phase="submit")
    assert result["http_status"] == 422 and result["provider_code"] == "InvalidInput" and result["request_id"] == "req-422"
