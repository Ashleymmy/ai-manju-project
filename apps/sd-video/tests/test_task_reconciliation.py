import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock
import uuid

import pytest

from test_catalog_queries import catalog, catalog_database, body
from app import standalone_api as api
from app.core.auth import ServicePrincipal
from app.task_reconciliation import TaskReconciliationStore, ReconciliationRequest
from app.mock_media import MOCK_VIDEO
from worker import processor


@pytest.fixture
def review(catalog, monkeypatch):
    client, actor, _ = catalog
    owner = actor[0]
    async def seed():
        record, _ = await api.task_store.create(owner, dict(model="mock", provider="fake", idempotency_key=uuid.uuid4().hex))
        await api.task_store.update(record.id, status="failed", submission_started_at=datetime.now(timezone.utc),
                                    error={"code": "submission_uncertain", "message": "requires verification"})
        return record.id
    task_id = asyncio.run(seed())
    actor[0] = ServicePrincipal("operator", owner.workspace_id, "admin", frozenset({"admin"}))
    monkeypatch.setattr(api, "reconciliation_store", TaskReconciliationStore(api.task_store))
    monkeypatch.setattr(api, "task_queue", AsyncMock())
    monkeypatch.setattr(processor, "task_store", api.task_store)
    monkeypatch.setattr(processor, "catalog_store", None)
    monkeypatch.setattr(processor, "local_storage", AsyncMock())
    monkeypatch.setattr(processor, "_provider_for", AsyncMock(return_value=("fake", "mock")))
    monkeypatch.setattr(processor, "_query_upstream", AsyncMock(return_value={"status": "running"}))
    monkeypatch.setattr(processor, "_create_upstream", AsyncMock(side_effect=AssertionError("must not submit paid generation")))
    monkeypatch.setattr(processor, "_cancel_upstream", AsyncMock())
    path = f"/v1/admin/owners/{owner.subject}/tasks/{task_id}/reconciliation"
    payload = dict(decision="bind_existing", expected_attempt=1, evidence_ref="OPS_123", confirmed=True,
                   provider_task_id="upstream_" + uuid.uuid4().hex)
    return client, actor, owner, task_id, path, payload


def test_bind_existing_is_audited_idempotent_and_never_submits(review, monkeypatch):
    client, _, owner, task_id, path, payload = review
    assert body(client.get(path))["requires_reconciliation"]
    recovered = body(client.post(path, json=payload))
    assert recovered["status"] == "running" and recovered["provider_task_id"] == payload["provider_task_id"]
    assert body(client.post(path, json=payload))["task_id"] == task_id
    processor._query_upstream.assert_awaited_once()
    assert client.post(path, json={**payload, "evidence_ref": "another"}).status_code == 409
    audit = body(client.get(path))["audit"]
    assert audit["actor_subject"] == "operator" and audit["previous_error"]["code"] == "submission_uncertain"
    assert audit["request_id"] and audit["evidence_ref"] == "OPS_123"
    monkeypatch.setattr(processor, "_query_upstream", AsyncMock(return_value={"status": "succeeded", "content": {"video_url": "https://mock.invalid/result"}}))
    monkeypatch.setattr(processor, "_download", AsyncMock(return_value=MOCK_VIDEO))
    async def execute():
        record = await api.task_store.claim(task_id) if hasattr(api.task_store, "claim") else await api.task_store.get(owner, task_id)
        await processor.process_task(record)
        return await api.task_store.get(owner, task_id)
    result = asyncio.run(execute())
    assert result.status == "succeeded" and result.result["sha256"]
    processor._create_upstream.assert_not_awaited()
    assert body(client.post(path, json=payload))["status"] == "succeeded"


def test_confirm_absent_only_allows_explicit_new_attempt(review, monkeypatch):
    client, actor, owner, task_id, path, payload = review
    payload.pop("provider_task_id")
    payload["decision"] = "confirm_not_submitted"
    resolved = body(client.post(path, json=payload))
    assert resolved["status"] == "failed" and resolved["error"]["code"] == "submission_not_created_verified"
    processor._query_upstream.assert_not_awaited()
    processor._create_upstream.assert_not_awaited()
    api.task_queue.enqueue.assert_not_awaited()
    actor[0] = owner
    monkeypatch.setattr(api.settings, "SD_VIDEO_MODE", "active")
    response = client.post(f"/v1/tasks/{task_id}/retry")
    assert response.status_code == 202
    retry = response.json()["data"]
    assert retry["task_id"] != task_id and retry["attempt"] == 2 and retry["reconciliation"] is None
    assert client.post(f"/v1/tasks/{task_id}/retry").json()["data"]["task_id"] == retry["task_id"]


@pytest.mark.parametrize("role, scopes, workspace, expected", [
    ("member", {"admin"}, "team", 403), ("admin", {"tasks:write"}, "team", 403),
    ("admin", {"admin"}, "wrong", 404),
])
def test_reconciliation_role_scope_and_workspace_boundaries(review, role, scopes, workspace, expected):
    client, actor, _, _, path, payload = review
    actor[0] = ServicePrincipal("operator", workspace, role, frozenset(scopes))
    assert client.get(path).status_code == expected
    assert client.post(path, json=payload).status_code == expected
    processor._query_upstream.assert_not_awaited()


def test_reconciliation_owner_target_and_request_validation(review):
    client, _, owner, _, path, payload = review
    assert client.get(path.replace(owner.subject, "other_owner")).status_code == 404
    for changed in ({"owner_subject": "forged"}, {"confirmed": False}, {"provider_task_id": "../escape"}, {"decision": "retry"}):
        assert client.post(path, json={**payload, **changed}).status_code == 422
    assert client.post(path, json={**payload, "expected_attempt": 2}).status_code == 409
    processor._query_upstream.assert_not_awaited()


def test_failed_provider_probe_never_unlocks_retry_or_leaks_response(review, monkeypatch):
    client, _, _, _, path, payload = review
    monkeypatch.setattr(processor, "_query_upstream", AsyncMock(side_effect=RuntimeError("secret_upstream_key")))
    response = client.post(path, json=payload)
    assert response.status_code == 502 and "secret_upstream_key" not in response.text
    assert body(client.get(path))["requires_reconciliation"]
    assert body(client.get(path))["audit"] is None


def test_active_worker_lease_blocks_reconciliation(review):
    client, _, _, task_id, path, payload = review
    asyncio.run(api.task_store.update(task_id, lease_owner="active-worker", lease_expires_at=datetime.now(timezone.utc) + timedelta(minutes=1)))
    assert client.post(path, json=payload).status_code == 409
    processor._query_upstream.assert_not_awaited()


def test_cancellation_during_probe_prevents_recovery(review, monkeypatch):
    client, actor, owner, task_id, path, payload = review
    async def cancel_in_probe(*args):
        await api.task_store.update(task_id, expected_error_code="submission_uncertain", cancel_requested=True, status="canceled")
        return {"status": "succeeded"}
    monkeypatch.setattr(processor, "_query_upstream", AsyncMock(side_effect=cancel_in_probe))
    assert client.post(path, json=payload).status_code == 409
    assert body(client.get(path))["audit"] is None
    actor[0] = owner
    monkeypatch.setattr(api.settings, "SD_VIDEO_MODE", "active")
    assert client.post(f"/v1/tasks/{task_id}/retry").status_code == 409
    processor._create_upstream.assert_not_awaited()


def test_cancel_after_binding_uses_existing_provider_id(review):
    client, actor, owner, task_id, path, payload = review
    body(client.post(path, json=payload))
    actor[0] = owner
    assert body(client.post(f"/v1/tasks/{task_id}/cancel"))["status"] == "cancel_requested"
    async def execute():
        record = await api.task_store.claim(task_id) if hasattr(api.task_store, "claim") else await api.task_store.get(owner, task_id)
        await processor.process_task(record)
        return await api.task_store.get(owner, task_id)
    assert asyncio.run(execute()).status == "canceled"
    assert processor._cancel_upstream.await_args.args[2] == payload["provider_task_id"]
    processor._create_upstream.assert_not_awaited()
    processor.local_storage.put.assert_not_awaited()


def test_one_provider_task_cannot_be_bound_to_two_records(review):
    client, _, owner, _, path, payload = review
    body(client.post(path, json=payload))
    async def other():
        record, _ = await api.task_store.create(owner, dict(model="mock", provider="fake", idempotency_key=uuid.uuid4().hex))
        await api.task_store.update(record.id, status="failed", error={"code": "submission_uncertain"})
        return record.id
    other_id = asyncio.run(other())
    assert client.post(f"/v1/admin/owners/{owner.subject}/tasks/{other_id}/reconciliation", json=payload).status_code == 409


def test_concurrent_opposite_decisions_have_one_immutable_audit(review):
    _, actor, owner, task_id, _, payload = review
    async def race():
        store = api.reconciliation_store
        bind = ReconciliationRequest(**payload)
        absent = ReconciliationRequest(decision="confirm_not_submitted", expected_attempt=1, evidence_ref="OPS_absent", confirmed=True)
        values = await asyncio.gather(store.apply(owner, actor[0], task_id, bind, "req_a", "running"),
                                      store.apply(owner, actor[0], task_id, absent, "req_b", None), return_exceptions=True)
        assert sum(isinstance(value, ValueError) for value in values) == 1
        record, audit = await store.read(owner, task_id)
        assert audit["decision"] in {"bind_existing", "confirm_not_submitted"}
        assert (record.status == "running") == (audit["decision"] == "bind_existing")
    asyncio.run(race())
