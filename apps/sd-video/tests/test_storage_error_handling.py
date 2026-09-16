"""对象存储隔离与失败传播；不再导入旧 Supabase 数据库执行分支。"""
import asyncio
import base64
import json
import time
from pathlib import Path

import httpx
import pytest
from app.config import settings
from app.storage.adapter import SupabaseStorageAdapter
from app.storage.supabase import StorageRequestError


def token(**changes):
    payload = {"role": "sdvideo_storage_service", "sub": "service", "iat": int(time.time()),
               "exp": int(time.time()) + 300,
               "storage_buckets": ["studio-sdvideo-test-" + kind for kind in ("input", "result", "thumbnail", "volcano")]}
    payload.update(changes)
    encode = lambda value: base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")
    return encode({"alg": "EdDSA"}) + "." + encode(payload) + ".mock-signature"


@pytest.fixture
def configure(monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_URL", "https://new-storage.invalid")
    monkeypatch.setattr(settings, "SUPABASE_PUBLIC_URL", "https://media.invalid")
    monkeypatch.setattr(settings, "SUPABASE_STORAGE_TOKEN", token())
    for name in ("SUPABASE_STORAGE_TOKEN_FILE", "SUPABASE_API_KEY", "SUPABASE_API_KEY_FILE", "SUPABASE_CA_FILE"):
        monkeypatch.setattr(settings, name, "")
    for kind in ("INPUT", "RESULT", "THUMBNAIL", "VOLCANO"):
        monkeypatch.setattr(settings, f"SUPABASE_{kind}_BUCKET", "studio-sdvideo-test-" + kind.lower())


def test_storage_only_endpoints_and_signed_url(configure):
    seen = []
    def handler(request):
        seen.append(request)
        assert request.headers["authorization"] == "Bearer " + settings.SUPABASE_STORAGE_TOKEN
        assert "apikey" not in request.headers
        if "/object/sign/" in request.url.path:
            return httpx.Response(200, json={"signedURL": "/storage/v1/object/sign/studio-sdvideo-test-input/inputs/team/owner/file?token=test"})
        if request.method == "POST": assert request.headers["x-upsert"] == "false"
        return httpx.Response(200, content=b"video")
    async def check():
        storage = SupabaseStorageAdapter(httpx.MockTransport(handler))
        key = "inputs/team/owner/file"
        assert await storage.put(key, b"video", "video/mp4") == key
        assert await storage.get(key) == b"video"
        assert (await storage.url(key)).startswith("https://media.invalid/storage/v1/object/sign/")
        await storage.delete(key)
        assert json.loads(seen[-1].content) == {"prefixes": [key]}
        assert all(request.url.path.startswith("/storage/v1/") for request in seen)
    asyncio.run(check())


@pytest.mark.parametrize("scheme", ["http", "https"])
def test_public_protocol_switch_keeps_storage_credentials_on_https(configure, monkeypatch, scheme):
    monkeypatch.setattr(settings, "SUPABASE_PUBLIC_URL", scheme + "://media.invalid")

    def handler(request):
        assert request.url.scheme == "https"
        assert request.url.host == "new-storage.invalid"
        assert request.headers["authorization"].startswith("Bearer ")
        return httpx.Response(200, json={"signedURL": "/object/sign/studio-sdvideo-test-input/inputs/user/image.png?token=test"})

    storage = SupabaseStorageAdapter(httpx.MockTransport(handler))
    signed = asyncio.run(storage.url("inputs/user/image.png"))
    assert signed.startswith(scheme + "://media.invalid/storage/")
    monkeypatch.setattr(settings, "SUPABASE_URL", "http://new-storage.invalid")
    with pytest.raises(ValueError, match="HTTPS"):
        asyncio.run(storage.url("inputs/user/image.png"))


def test_personal_workspace_signature_downloads_through_public_origin(configure):
    signed_objects = {}
    image = b"\x89PNG\r\n\x1a\n" + b"image-data"
    prefix = "/storage/v1/object/sign/"

    def handler(request):
        if request.method == "POST":
            assert request.url.host == "new-storage.invalid"
            # 复现 NAS：签名绑定原始请求路径，下载时按已解码的对象路径验签。
            signed_objects["test-signature"] = request.url.raw_path.decode().removeprefix(prefix)
            return httpx.Response(200, json={"signedURL": "/object/sign/" + signed_objects["test-signature"] + "?token=test-signature"})
        assert request.method == "GET" and request.url.host == "media.invalid"
        assert "authorization" not in request.headers and "apikey" not in request.headers
        if signed_objects[request.url.params["token"]] != request.url.path.removeprefix(prefix):
            return httpx.Response(400, json={"error": "InvalidSignature"})
        assert request.headers["range"] == "bytes=0-7"
        return httpx.Response(206, content=image[:8], headers={"content-type": "image/png", "content-range": f"bytes 0-7/{len(image)}"})

    async def check():
        transport = httpx.MockTransport(handler)
        storage = SupabaseStorageAdapter(transport)
        url = await storage.url("inputs/default:user/user/image.png")
        assert url == "https://media.invalid/storage/v1/object/sign/studio-sdvideo-test-input/inputs/default%3Auser/user/image.png?token=test-signature"
        async with httpx.AsyncClient(transport=transport) as client:
            response = await client.get(url, headers={"Range": "bytes=0-7"})
        assert response.status_code == 206
        assert response.headers["content-type"] == "image/png"
        assert response.content == image[:8]
    asyncio.run(check())


@pytest.mark.parametrize("namespace", ["inputs", "results", "thumbnails", "volcano"])
def test_signing_preserves_other_object_key_escapes(configure, namespace):
    buckets = {"inputs": "input", "results": "result", "thumbnails": "thumbnail", "volcano": "volcano"}
    target = f"studio-sdvideo-test-{buckets[namespace]}/{namespace}/default:user/user/literal%253A%20%23%3F.png"

    def handler(request):
        assert request.url.raw_path.decode() == "/storage/v1/object/sign/" + target
        return httpx.Response(200, json={"signedURL": "/object/sign/" + target + "?token=test"})

    async def check():
        url = await SupabaseStorageAdapter(httpx.MockTransport(handler)).url(f"{namespace}/default:user/user/literal%3A #?.png")
        assert url == "https://media.invalid/storage/v1/object/sign/" + target.replace("default:user", "default%3Auser") + "?token=test"
    asyncio.run(check())


def test_storage_failure_is_not_reported_as_success(configure):
    async def check():
        storage = SupabaseStorageAdapter(httpx.MockTransport(lambda request: httpx.Response(503)))
        with pytest.raises(StorageRequestError, match="HTTP 503"): await storage.put("inputs/team/owner/file", b"video", "video/mp4")
    asyncio.run(check())


def test_storage_rejects_external_signing_redirect(configure):
    async def check():
        storage = SupabaseStorageAdapter(httpx.MockTransport(lambda request: httpx.Response(200, json={"signedURL": "https://unexpected.invalid/file"})))
        with pytest.raises(ValueError): await storage.url("inputs/team/owner/file")
    asyncio.run(check())


@pytest.mark.parametrize("key", ["../file", "inputs/../file", "inputs\\file", "/inputs/file"])
def test_storage_rejects_traversal(configure, key):
    with pytest.raises(ValueError): SupabaseStorageAdapter()._target(key)


def test_legacy_database_modules_are_absent():
    root = Path(__file__).resolve().parents[1] / "api" / "app"
    for name in ("supabase_client.py", "task_worker.py", "admin.py", "seedance_asset_service.py"):
        assert not (root / name).exists()


@pytest.mark.parametrize("changes", [{"role": "service_role"}, {"storage_buckets": ["private"]},
                                    {"sub": ""}, {"exp": 1}, {"exp": 9999999999}, {"iat": True}])
def test_unscoped_or_expired_token_rejected(configure, monkeypatch, changes):
    monkeypatch.setattr(settings, "SUPABASE_STORAGE_TOKEN", token(**changes))
    with pytest.raises(ValueError): SupabaseStorageAdapter()._headers("studio-sdvideo-test-input")


def test_rotating_token_file_and_public_gateway_key(configure, monkeypatch, tmp_path):
    filename = tmp_path / "token"
    monkeypatch.setattr(settings, "SUPABASE_STORAGE_TOKEN_FILE", str(filename))
    monkeypatch.setattr(settings, "SUPABASE_API_KEY", token(role="anon"))
    storage = SupabaseStorageAdapter()
    for jti in ("first", "rotated"):
        value = token(jti=jti)
        filename.write_text(value)
        assert storage._headers("studio-sdvideo-test-input")["Authorization"] == "Bearer " + value
    monkeypatch.setattr(settings, "SUPABASE_API_KEY", token(role="service_role"))
    with pytest.raises(ValueError): storage._headers("studio-sdvideo-test-input")


@pytest.mark.parametrize("status", [302, 307, 403, 429, 503])
def test_no_redirect_or_secret_error_body(configure, status):
    requests = []
    def handle(request):
        requests.append(request)
        return httpx.Response(status, headers={"location": "https://external.invalid"}, text="secret-provider-key")
    async def check():
        with pytest.raises(StorageRequestError) as error:
            await SupabaseStorageAdapter(httpx.MockTransport(handle)).put("inputs/u/file", b"x", "video/mp4")
        assert "secret" not in str(error.value)
        assert len(requests) == 1
    asyncio.run(check())


def test_conflict_requires_identical_content(configure):
    async def check():
        for existing in (b"same", b"different"):
            def handle(request):
                if request.method == "POST": return httpx.Response(400, json={"statusCode": "409"})
                return httpx.Response(200, content=existing)
            storage = SupabaseStorageAdapter(httpx.MockTransport(handle))
            if existing == b"same": assert await storage.put("results/u/file", b"same", "video/mp4") == "results/u/file"
            else:
                with pytest.raises(FileExistsError): await storage.put("results/u/file", b"same", "video/mp4")
    asyncio.run(check())


def test_bounded_download_and_private_probe(configure, monkeypatch):
    monkeypatch.setattr(settings, "MAX_INPUT_BYTES", 3)
    async def check():
        storage = SupabaseStorageAdapter(httpx.MockTransport(lambda r: httpx.Response(200, content=b"1234")))
        with pytest.raises(ValueError, match="limit"): await storage.get("inputs/u/file")
        for public in (True, False, None):
            storage = SupabaseStorageAdapter(httpx.MockTransport(lambda r: httpx.Response(200, json={"id": r.url.path.split("/")[-1], "public": public})))
            if public is False: await storage.probe()
            else:
                with pytest.raises(ValueError, match="private"): await storage.probe()
    asyncio.run(check())


@pytest.mark.parametrize("url", ["/object/sign/private/inputs/u/file?token=x",
                                "/object/sign/studio-sdvideo-test-input/inputs/u/other?token=x",
                                "/object/sign/studio-sdvideo-test-input/inputs/u/file?token=x&token=y"])
def test_signing_is_bound_to_exact_object(configure, url):
    async def check():
        storage = SupabaseStorageAdapter(httpx.MockTransport(lambda r: httpx.Response(200, json={"signedURL": url})))
        with pytest.raises(ValueError): await storage.url("inputs/u/file")
    asyncio.run(check())


def test_unicode_key_and_storage_roles_cannot_cross_buckets(configure, monkeypatch):
    storage = SupabaseStorageAdapter()
    bucket, target = storage._target("inputs/中文 #?.png")
    assert bucket == "studio-sdvideo-test-input" and "%23%3F.png" in target
    monkeypatch.setattr(settings, "SUPABASE_INPUT_BUCKET", "studio-test-assets")
    with pytest.raises(ValueError): storage._target("inputs/u/file")
