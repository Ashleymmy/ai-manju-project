import asyncio
import time

import pytest
from fastapi import HTTPException

from app.core.auth import ServicePrincipal, _principal_from_claims, require_admin
from app.config import settings
from app.standalone_api import InMemoryTaskStore, CreateTaskRequest
from app.mock_media import MOCK_VIDEO


def test_idempotency_does_not_cross_owner(monkeypatch):
    monkeypatch.setattr(settings, "EXECUTION_MODE", "provider")
    async def check():
        store = InMemoryTaskStore()
        request = CreateTaskRequest(idempotency_key="same", model="mock")
        first, created = await store.create(ServicePrincipal("a", "team", "member", frozenset()), request)
        second, _ = await store.create(ServicePrincipal("b", "team", "member", frozenset()), request)
        duplicate, is_new = await store.create(ServicePrincipal("a", "team", "member", frozenset()), request)
        assert created and not is_new and duplicate.id == first.id and second.id != first.id
    asyncio.run(check())


def test_cancellation_wins_over_late_completion(monkeypatch):
    monkeypatch.setattr(settings, "EXECUTION_MODE", "provider")
    async def check():
        store = InMemoryTaskStore()
        record, _ = await store.create(ServicePrincipal("a", "p", "member", frozenset()), CreateTaskRequest(idempotency_key="cancel", model="mock"))
        await store.update(record.id, cancel_requested=True, status="cancel_requested")
        assert await store.update(record.id, status="succeeded", result={"asset_ref": "late"}) is None
        await store.update(record.id, status="canceled")
        assert await store.update(record.id, status="running") is None
        assert record.result is None
    asyncio.run(check())


def test_lost_lease_cannot_write(monkeypatch):
    monkeypatch.setattr(settings, "EXECUTION_MODE", "provider")
    async def check():
        store = InMemoryTaskStore()
        record, _ = await store.create(ServicePrincipal("a", "p", "member", frozenset()), CreateTaskRequest(idempotency_key="lease", model="mock"))
        await store.update(record.id, lease_owner="new", lease_expires_at=time.time()+60)
        assert await store.update(record.id, expected_lease="old", status="succeeded") is None
        assert await store.update(record.id, expected_lease="new", status="succeeded") is not None
    asyncio.run(check())


def test_jwt_lifetime_and_admin_require_both(monkeypatch):
    monkeypatch.setattr(settings, "LOCAL_DEMO_MODE", False)
    with pytest.raises(HTTPException):
        _principal_from_claims({"sub": "a", "workspace_id": "p", "iat": 1, "exp": 302, "jti": "x"})
    with pytest.raises(HTTPException):
        require_admin(ServicePrincipal("a", "p", "admin", frozenset()))
    with pytest.raises(HTTPException):
        require_admin(ServicePrincipal("a", "p", "member", frozenset({"admin"})))
    assert require_admin(ServicePrincipal("a", "p", "admin", frozenset({"admin"}))).subject == "a"


def test_mock_is_real_mp4():
    assert MOCK_VIDEO[4:8] == b"ftyp"
    assert b"moov" in MOCK_VIDEO and b"mdat" in MOCK_VIDEO
