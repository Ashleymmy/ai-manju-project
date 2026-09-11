import json
import unittest

import httpx

from app.providers.seedance.base import SeedanceOperationNotSupported
from app.providers.seedance.legacy_proxy import LegacyProxyProvider
from app.providers.seedance.tokenspace import TokenSpaceProvider
from app.vidu_api import ViduVideoAPI


class TokenSpaceProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_create_requires_upstream_task_id(self):
        provider = TokenSpaceProvider(
            "https://api.tokenspace.test",
            "secret-key",
            "tokenhub-model",
            transport=httpx.MockTransport(lambda _request: httpx.Response(200, json={"status": "queued"})),
        )
        with self.assertRaisesRegex(Exception, "missing id"):
            await provider.create_video_task({"content": []})

    async def test_video_endpoints_auth_model_and_response_contract(self):
        requests = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            if request.method == "POST":
                body = json.loads(request.content)
                self.assertEqual(body["model"], "tokenhub-model")
                return httpx.Response(
                    200,
                    json={
                        "id": "task-1",
                        "status": "queued",
                        "ResponseMetadata": {"RequestId": "req-1"},
                    },
                )
            return httpx.Response(
                200,
                json={
                    "id": "task-1",
                    "status": "completed",
                    "content": {"video_url": "https://cdn.example/video.mp4"},
                },
                headers={"x-oneapi-request-id": "req-2"},
            )

        provider = TokenSpaceProvider(
            "https://api.tokenspace.test",
            "secret-key",
            "tokenhub-model",
            transport=httpx.MockTransport(handler),
        )
        created = await provider.create_video_task({"model": "legacy-model", "content": []})
        queried = await provider.get_video_task("task-1")

        self.assertEqual(created["id"], "task-1")
        self.assertEqual(created["upstream_provider"], "tokenspace")
        self.assertEqual(created["request_id"], "req-1")
        self.assertEqual(queried["status"], "succeeded")
        self.assertEqual(queried["content"]["video_url"], "https://cdn.example/video.mp4")
        self.assertEqual(queried["request_id"], "req-2")
        self.assertEqual(requests[0].url.path, "/api/v3/contents/generations/tasks")
        self.assertEqual(requests[1].url.path, "/api/v3/contents/generations/tasks/task-1")
        self.assertEqual(requests[0].headers["Authorization"], "Bearer secret-key")

    async def test_material_actions_keep_id_in_json_body(self):
        seen = []

        def handler(request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content)
            seen.append((request.url.params.get("Action"), dict(request.url.params), body))
            action = request.url.params.get("Action")
            if action == "CreateAssetGroup":
                return httpx.Response(200, json={"Result": {"Id": "group-1"}})
            if action == "CreateAsset":
                return httpx.Response(200, json={"Result": {"Id": "asset-1", "Status": "Processing"}})
            if action == "GetAsset":
                return httpx.Response(200, json={"Result": {"Id": "asset-1", "Status": "Active"}})
            return httpx.Response(200, json={"Result": {}})

        provider = TokenSpaceProvider(
            "https://api.tokenspace.test",
            "secret-key",
            "tokenhub-model",
            transport=httpx.MockTransport(handler),
        )
        group = await provider.create_asset_group("group", "description")
        asset = await provider.create_asset(group["id"], "https://example.test/a.jpg", "a", "Image")
        fetched = await provider.get_asset(asset["id"])
        await provider.delete_asset(asset["id"])

        self.assertEqual(group["id"], "group-1")
        self.assertEqual(asset["id"], "asset-1")
        self.assertEqual(fetched["record"]["Status"], "Active")
        for action, query, body in seen:
            self.assertEqual(set(query), {"Action"})
            if action in ("GetAsset", "DeleteAsset"):
                self.assertEqual(body, {"Id": "asset-1"})

    async def test_cancel_is_explicitly_unsupported(self):
        provider = TokenSpaceProvider("https://api.tokenspace.test", "secret-key", "tokenhub-model")
        with self.assertRaises(SeedanceOperationNotSupported) as context:
            await provider.cancel_video_task("task-1")
        self.assertEqual(context.exception.http_status, 409)
        self.assertEqual(context.exception.error_code, "CancelNotSupported")

    async def test_business_error_does_not_echo_url(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={"Result": {"Error": {"Code": "InvalidAsset", "Message": "failed https://private.test/a?token=x"}}},
            )

        provider = TokenSpaceProvider(
            "https://api.tokenspace.test",
            "secret-key",
            "tokenhub-model",
            transport=httpx.MockTransport(handler),
        )
        with self.assertRaises(Exception) as context:
            await provider.get_asset("asset-1")
        self.assertNotIn("secret-key", str(context.exception))
        self.assertNotIn("private.test", str(context.exception))
        self.assertIn("[url]", str(context.exception))

    async def test_response_metadata_business_error_is_detected(self):
        def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "ResponseMetadata": {
                        "RequestId": "metadata-request-id",
                        "Error": {"Code": "InvalidAsset", "Message": "asset rejected"},
                    }
                },
            )

        provider = TokenSpaceProvider(
            "https://api.tokenspace.test",
            "secret-key",
            "tokenhub-model",
            transport=httpx.MockTransport(handler),
        )
        with self.assertRaises(Exception) as context:
            await provider.get_asset("asset-1")
        self.assertEqual(context.exception.request_id, "metadata-request-id")
        self.assertEqual(context.exception.error_code, "InvalidAsset")


class LegacyProxyProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_legacy_video_paths_remain_unchanged(self):
        paths = []

        def handler(request: httpx.Request) -> httpx.Response:
            paths.append((request.method, request.url.path))
            if request.method == "POST":
                return httpx.Response(200, json={"id": "legacy-1"})
            return httpx.Response(200, json={"id": "legacy-1", "status": "running"})

        provider = LegacyProxyProvider(
            "https://legacy.example.test",
            "legacy-key",
            transport=httpx.MockTransport(handler),
        )
        await provider.create_video_task({"model": "legacy-model", "content": []})
        await provider.get_video_task("legacy-1")
        self.assertEqual(
            paths,
            [
                ("POST", "/v1/video/tasks"),
                ("GET", "/v1/video/tasks/legacy-1"),
            ],
        )


class ExistingProviderRegressionTests(unittest.TestCase):
    def test_vidu_log_summary_does_not_include_signed_urls(self):
        payload = {
            "prompt": "test",
            "images": ["https://storage.test/private?a=signature"],
            "subjects": [{"name": "subject1", "images": ["https://storage.test/private?a=signature"]}],
        }
        rendered = json.dumps(ViduVideoAPI._safe_payload_for_log(payload))
        self.assertNotIn("storage.test", rendered)
        self.assertNotIn("signature", rendered)


if __name__ == "__main__":
    unittest.main()
