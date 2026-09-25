"""HTTP test ingress must work without accepting arbitrary Provider input URLs."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
from urllib.parse import quote

import pytest

from app.config import settings
from app.core.auth import ServicePrincipal
from app.storage.reference_urls import validate_provider_reference_url
from app.volcano_store import VolcanoStore
from worker import asset_worker, processor


@pytest.fixture
def signed_input(monkeypatch):
    monkeypatch.setattr(settings, "STORAGE_BACKEND", "supabase")
    monkeypatch.setattr(settings, "SUPABASE_URL", "https://nas.example:18000")
    monkeypatch.setattr(settings, "SUPABASE_PUBLIC_URL", "http://studio.example")
    for kind in ("INPUT", "RESULT", "THUMBNAIL", "VOLCANO"):
        monkeypatch.setattr(settings, f"SUPABASE_{kind}_BUCKET", "studio-sdvideo-" + kind.lower())
    key = "inputs/default:owner/owner/image.png"
    url = "http://studio.example/storage/v1/object/sign/studio-sdvideo-input/" + quote(key, safe="/") + "?token=test-signature"
    return key, url


@pytest.mark.parametrize("change", [
    lambda url: url.replace("studio.example", "other.example"),
    lambda url: url.replace("studio.example", "127.0.0.1"),
    lambda url: url.replace("studio.example", "studio.example.evil.invalid"),
    lambda url: url.replace("studio.example", "studio.example:8080"),
    lambda url: url.replace("studio.example", "user@studio.example"),
    lambda url: url.replace("image.png", "other.png"),
    lambda url: url.split("?")[0],
    lambda url: url + "&token=another",
    lambda url: url + "#fragment",
])
def test_rejects_http_url_outside_exact_signed_object(signed_input, change):
    key, url = signed_input
    with pytest.raises(ValueError):
        validate_provider_reference_url(change(url), storage_key=key)


def test_only_storage_generated_http_is_allowed(signed_input, monkeypatch):
    key, url = signed_input
    validate_provider_reference_url(url, storage_key=key)
    with pytest.raises(ValueError):
        validate_provider_reference_url(url)
    monkeypatch.setattr(settings, "STORAGE_BACKEND", "local")
    with pytest.raises(ValueError):
        validate_provider_reference_url(url, storage_key=key)


def test_returning_to_https_rejects_old_http_origin(signed_input, monkeypatch):
    key, url = signed_input
    monkeypatch.setattr(settings, "SUPABASE_PUBLIC_URL", "https://studio.example")
    with pytest.raises(ValueError):
        validate_provider_reference_url(url, storage_key=key)
    validate_provider_reference_url(url.replace("http://", "https://"), storage_key=key)


def test_video_submission_uses_fresh_http_signature(signed_input, monkeypatch):
    key, url = signed_input
    storage = AsyncMock()
    storage.url.return_value = url
    monkeypatch.setattr(processor, "local_storage", storage)
    record = SimpleNamespace(id="task", request={"references": [{
        "kind": "image", "storage_token": key, "url": "http://old.example/expired",
    }]})
    assert asyncio.run(processor._references(record))[0]["url"] == url
    storage.url.assert_awaited_once_with(key, processor.reference_url_ttl_seconds())


def test_reference_ttl_covers_slow_provider_polling(monkeypatch):
    monkeypatch.setattr(settings, "RESULT_SIGNED_URL_TTL_SECONDS", 60)
    monkeypatch.setattr(settings, "MODEL_RETURN_WAIT_TIMEOUT_SECONDS", 3600)
    monkeypatch.setattr(settings, "TASK_POLL_INTERVAL_SECONDS", 10)
    # Storage caps signing at one hour, so the required 3670 seconds is
    # bounded while still covering the entire polling window.
    assert processor.reference_url_ttl_seconds() == 3600


def test_reference_ttl_keeps_explicit_longer_value(monkeypatch):
    monkeypatch.setattr(settings, "RESULT_SIGNED_URL_TTL_SECONDS", 1800)
    monkeypatch.setattr(settings, "MODEL_RETURN_WAIT_TIMEOUT_SECONDS", 300)
    monkeypatch.setattr(settings, "TASK_POLL_INTERVAL_SECONDS", 10)
    assert processor.reference_url_ttl_seconds() == 1800


@pytest.mark.parametrize("previous_failure", [False, True])
def test_asset_registration_and_preexisting_invalid_queue(signed_input, previous_failure):
    async def check():
        key, url = signed_input
        store = VolcanoStore()
        principal = ServicePrincipal("owner", "default:owner", "member", frozenset())
        item = await store.create(principal, dict(storage_key=key, kind="image", name="reference",
            upstream_provider="tokenspace", provider_namespace="account"))
        previous_error = {"code": "asset_operation_failed", "category": "ValueError"}
        if previous_failure:
            store.items[item["id"]]["error"] = previous_error
        provider, storage = AsyncMock(), AsyncMock()
        provider.namespace = "account"
        provider.assets_configured = lambda: True
        provider.create_asset_group.return_value = {"id": "group"}
        provider.create_asset.return_value = {"id": "remote"}
        storage.url.return_value = url
        await asset_worker.process_asset(await store.claim(), store, storage, provider)
        saved = store.items[item["id"]]
        if previous_failure:
            provider.create_asset_group.assert_not_awaited()
            provider.create_asset.assert_not_awaited()
            storage.url.assert_not_awaited()
            assert saved["status"] == "queued" and saved["error"] == previous_error
            assert not saved.get("submission_started_at") and not saved["provider_asset_id"]
        else:
            provider.create_asset.assert_awaited_once_with("group", url, "reference", "Image")
            assert saved["status"] == "processing" and saved["provider_asset_id"] == "remote"
    asyncio.run(check())
