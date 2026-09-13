from __future__ import annotations

import base64
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from worker import object_storage
from worker.errors import SafeTaskError
from worker.supabase_storage import SupabaseStorage


def token(**changes):
    payload = {"role": "studio_storage_service", "sub": "service", "iat": int(time.time()),
               "exp": int(time.time()) + 300, "storage_buckets": ["studio-test-assets"]}
    payload.update(changes)
    encode = lambda value: base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")
    return encode({"alg": "EdDSA"}) + "." + encode(payload) + ".mock-signature"


class SupabaseStorageTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {
            "ASSET_STORAGE_BACKEND": "supabase", "STUDIO_SUPABASE_URL": "https://storage.invalid",
            "STUDIO_SUPABASE_BUCKET": "studio-test-assets", "STUDIO_SUPABASE_STORAGE_TOKEN": token(),
            "STUDIO_SUPABASE_STORAGE_TOKEN_FILE": "", "STUDIO_SUPABASE_API_KEY": "",
            "STUDIO_SUPABASE_API_KEY_FILE": "", "STUDIO_SUPABASE_CA_FILE": ""})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def test_upload_download_delete_probe(self):
        seen = []
        def handle(request):
            seen.append(request)
            self.assertTrue(request.url.path.startswith("/storage/v1/"))
            self.assertEqual(request.headers["authorization"], "Bearer " + os.environ["STUDIO_SUPABASE_STORAGE_TOKEN"])
            if "/bucket/" in request.url.path: return httpx.Response(200, json={"id": "studio-test-assets", "public": False})
            if request.method == "POST":
                self.assertEqual(request.headers["x-upsert"], "false")
                self.assertEqual(request.content, b"video")
            return httpx.Response(200, content=b"video")
        storage = SupabaseStorage(httpx.MockTransport(handle))
        source = self.root / "input"
        source.write_bytes(b"video")
        storage.upload("personal/u/中文 #?.mp4", source, "video/mp4")
        target = self.root / "output"
        storage.download("personal/u/中文 #?.mp4", target, 10)
        self.assertEqual(target.read_bytes(), b"video")
        storage.delete("personal/u/中文 #?.mp4")
        self.assertEqual(json.loads(seen[-1].content), {"prefixes": ["personal/u/中文 #?.mp4"]})
        storage.probe()

    def test_conflict_checks_content(self):
        source = self.root / "input"
        source.write_bytes(b"same")
        for content in (b"same", b"different"):
            def handle(request):
                if request.method == "POST": return httpx.Response(400, json={"statusCode": "409"})
                return httpx.Response(200, content=content)
            storage = SupabaseStorage(httpx.MockTransport(handle))
            if content == b"same": storage.upload("jobs/output", source, "video/mp4")
            else:
                with self.assertRaises(SafeTaskError) as error: storage.upload("jobs/output", source, "video/mp4")
                self.assertEqual(error.exception.code, "storage_conflict")

    def test_size_limit_and_partial_transfer_preserve_existing_file(self):
        target = self.root / "existing"
        target.write_bytes(b"original")
        for response in (httpx.Response(200, content=b"excess"),
                         httpx.Response(200, headers={"content-length": "2"}, content=b"x"),
                         httpx.Response(200, headers={"content-length": "bad"}, content=b"x")):
            with self.subTest(headers=response.headers):
                storage = SupabaseStorage(httpx.MockTransport(lambda r: response))
                with self.assertRaises(SafeTaskError): storage.download("jobs/result", target, 3)
                self.assertEqual(target.read_bytes(), b"original")
                self.assertEqual(list(self.root.iterdir()), [target])

    def test_token_rotation_and_privilege_guard(self):
        storage = SupabaseStorage()
        for changes in ({"role": "service_role"}, {"storage_buckets": ["private"]}, {"exp": 1}, {"exp": 9999999999}, {"iat": True}):
            with patch.dict(os.environ, {"STUDIO_SUPABASE_STORAGE_TOKEN": token(**changes)}):
                with self.assertRaises(SafeTaskError): storage._headers()
        filename = self.root / "token"
        with patch.dict(os.environ, {"STUDIO_SUPABASE_STORAGE_TOKEN_FILE": str(filename)}):
            for jti in ("first", "rotated"):
                value = token(jti=jti)
                filename.write_text(value)
                self.assertEqual(storage._headers()["Authorization"], "Bearer " + value)
        with patch.dict(os.environ, {"STUDIO_SUPABASE_API_KEY": token(role="service_role")}):
            with self.assertRaises(SafeTaskError): storage._headers()

    def test_bucket_and_object_boundaries(self):
        for bucket in ("private", "studio-sdvideo-test-results"):
            with patch.dict(os.environ, {"STUDIO_SUPABASE_BUCKET": bucket}):
                with self.assertRaises(SafeTaskError): SupabaseStorage()
        for key in ("../x", "personal/../x", "personal\\x", "/x", "x//y"):
            with self.assertRaises(SafeTaskError): SupabaseStorage()._target(key)

    def test_redirect_failure_and_public_bucket_never_report_success(self):
        for status in (302, 403, 503):
            storage = SupabaseStorage(httpx.MockTransport(lambda r: httpx.Response(status, headers={"location": "https://external.invalid"}, text="secret")))
            with self.assertRaises(SafeTaskError) as error: storage.probe()
            self.assertNotIn("secret", str(error.exception))
        for public in (True, None):
            storage = SupabaseStorage(httpx.MockTransport(lambda r: httpx.Response(200, json={"id": "studio-test-assets", "public": public})))
            with self.assertRaises(SafeTaskError): storage.probe()

    def test_configured_dispatch_for_generation_and_inputs(self):
        self.assertTrue(object_storage.enabled())
        with patch("worker.supabase_storage.SupabaseStorage") as factory:
            object_storage.upload("jobs/u", self.root / "file", "video/mp4")
            object_storage.download("jobs/u", self.root / "file", 50)
            object_storage.delete("jobs/u")
            object_storage.probe()
            for method in ("upload", "download", "delete", "probe"):
                getattr(factory.return_value, method).assert_called_once()


if __name__ == "__main__":
    unittest.main()
