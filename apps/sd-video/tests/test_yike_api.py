import json
import unittest

import httpx
from PIL import Image
from io import BytesIO

from app import yike_api as module
from app.thumbnail_utils import ensure_min_image_size
from app.yike_api import YikeAPIError, YikeVideoAPI


class YikeVideoAPITests(unittest.IsolatedAsyncioTestCase):
    def make_api(self, handler):
        api = YikeVideoAPI()
        api.api_key = "test-key"
        api.api_host = "https://yike.test"
        api.workspace_id = "workspace-1"
        api.submit_path = "/api/v1/services/aigc/video-generation/video-synthesis"
        api.query_path = "/tasks/{task_id}"
        api._transport = httpx.MockTransport(handler)
        return api

    async def test_workspace_create_query_and_normalized_contract(self):
        seen = []

        async def handler(request):
            seen.append(request)
            if request.url.path.endswith("/video-synthesis"):
                body = json.loads(request.content)
                self.assertEqual(body["model"], "happyhorse-1.1")
                self.assertEqual(body["parameters"]["resolution"], "720P")
                self.assertEqual(body["parameters"]["ratio"], "16:9")
                return httpx.Response(200, json={"output": {"task_id": "job-1"}, "request_id": "req-1"})
            return httpx.Response(200, json={"output": {"task_status": "SUCCEEDED", "results": [{"video_url": "https://cdn.test/video.mp4"}]}, "request_id": "req-2"})

        api = self.make_api(handler)
        original = httpx.AsyncClient

        class ClientProxy(httpx.AsyncClient):
            def __init__(self, *args, **kwargs):
                kwargs["transport"] = api._transport
                super().__init__(*args, **kwargs)

        module.httpx.AsyncClient = ClientProxy
        try:
            created = await api.create_video_task("happyhorse-1.1", prompt="a test", ratio="16:9", duration=5)
            queried = await api.query_task(created["id"])
        finally:
            module.httpx.AsyncClient = original

        self.assertEqual(created["id"], "job-1")
        self.assertEqual(created["upstream_provider"], "yike")
        self.assertEqual(queried["status"], "succeeded")
        self.assertEqual(queried["content"]["video_url"], "https://cdn.test/video.mp4")
        self.assertEqual(seen[0].headers["X-DashScope-WorkSpace"], "workspace-1")
        self.assertEqual(seen[0].headers["X-DashScope-Async"], "enable")
        self.assertEqual(seen[0].headers["Authorization"], "Bearer test-key")
        self.assertEqual(seen[1].headers["X-DashScope-WorkSpace"], "workspace-1")
        self.assertNotIn("X-DashScope-Async", seen[1].headers)
        self.assertEqual(seen[1].headers["Authorization"], "Bearer test-key")

    async def test_query_exposes_upstream_failure_message(self):
        async def handler(_request):
            return httpx.Response(
                200,
                json={
                    "output": {
                        "task_id": "wan-job-1",
                        "task_status": "FAILED",
                        "code": "InvalidParameter",
                        "message": "resolution must be at most 8000x8000",
                    }
                },
            )

        api = self.make_api(handler)
        original = httpx.AsyncClient

        class ClientProxy(httpx.AsyncClient):
            def __init__(self, *args, **kwargs):
                kwargs["transport"] = api._transport
                super().__init__(*args, **kwargs)

        module.httpx.AsyncClient = ClientProxy
        try:
            result = await api.query_task("wan-job-1")
        finally:
            module.httpx.AsyncClient = original

        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["error_code"], "InvalidParameter")
        self.assertEqual(result["error_message"], "resolution must be at most 8000x8000")

    async def test_cancel_is_explicitly_unsupported(self):
        api = self.make_api(lambda _: httpx.Response(200, json={}))
        with self.assertRaises(YikeAPIError) as context:
            await api.cancel_task("job-1")
        self.assertEqual(context.exception.error_code, "CancelNotSupported")
        self.assertEqual(context.exception.http_status, 409)

    async def test_wan30_sends_reference_images_in_media(self):
        seen_body = None

        async def handler(request):
            nonlocal seen_body
            seen_body = json.loads(request.content)
            return httpx.Response(200, json={"output": {"task_id": "wan-job-1"}})

        api = self.make_api(handler)
        original = httpx.AsyncClient

        class ClientProxy(httpx.AsyncClient):
            def __init__(self, *args, **kwargs):
                kwargs["transport"] = api._transport
                super().__init__(*args, **kwargs)

        module.httpx.AsyncClient = ClientProxy
        try:
            await api.create_video_task(
                "wan3.0-video",
                prompt="让@图片1_character.png 挥手",
                reference_inputs=[
                    {"type": "reference_image", "url": "data:image/png;base64,AAAA"},
                ],
                ratio="adaptive",
                duration=5,
                resolution="480P",
            )
        finally:
            module.httpx.AsyncClient = original

        self.assertIsNotNone(seen_body)
        self.assertEqual(seen_body["input"]["prompt"], "让图片1 挥手")
        self.assertEqual(
            seen_body["input"]["media"],
            [{"type": "reference_image", "url": "data:image/png;base64,AAAA"}],
        )
        self.assertNotIn("img_url", seen_body["input"])
        self.assertNotIn("reference_urls", seen_body["input"])

    async def test_wan30_sends_video_and_audio_references_in_media(self):
        seen_body = None

        async def handler(request):
            nonlocal seen_body
            seen_body = json.loads(request.content)
            return httpx.Response(200, json={"output": {"task_id": "wan-job-2"}})

        api = self.make_api(handler)
        await api.create_video_task(
            "wan3.0-video",
            prompt="Follow the reference video and audio",
            reference_inputs=[
                {"type": "reference_video", "url": "https://cdn.test/reference.mp4"},
                {"type": "reference_audio", "url": "https://cdn.test/reference.mp3"},
            ],
            ratio="adaptive",
            duration=5,
            resolution="480P",
        )

        self.assertEqual(
            seen_body["input"]["media"],
            [
                {"type": "reference_video", "url": "https://cdn.test/reference.mp4"},
                {"type": "reference_audio", "url": "https://cdn.test/reference.mp3"},
            ],
        )

    async def test_wan30_prime_uses_wan_media_contract_and_global_timeout(self):
        seen_body = None
        seen_timeouts = []

        async def handler(request):
            nonlocal seen_body
            seen_body = json.loads(request.content)
            return httpx.Response(200, json={"output": {"task_id": "wan-prime-job-1"}})

        api = self.make_api(handler)
        original = httpx.AsyncClient

        class ClientProxy(httpx.AsyncClient):
            def __init__(self, *args, **kwargs):
                seen_timeouts.append(kwargs.get("timeout"))
                kwargs["transport"] = api._transport
                super().__init__(*args, **kwargs)

        module.httpx.AsyncClient = ClientProxy
        try:
            await api.create_video_task(
                "wan3.0-video-prime",
                prompt="让@图片1_character.png 配合参考音频",
                reference_inputs=[
                    {"type": "reference_image", "url": "https://cdn.test/reference.jpg"},
                    {"type": "reference_audio", "url": "https://cdn.test/reference.mp3"},
                ],
                ratio="adaptive",
                duration=30,
                resolution="1080P",
            )
        finally:
            module.httpx.AsyncClient = original

        self.assertEqual(seen_timeouts[0], module.settings.MODEL_RETURN_WAIT_TIMEOUT_SECONDS)
        self.assertEqual(seen_body["model"], "wan3.0-video-prime")
        self.assertEqual(seen_body["parameters"]["duration"], 30)
        self.assertEqual(seen_body["input"]["prompt"], "让图片1 配合参考音频")
        self.assertEqual(
            seen_body["input"]["media"],
            [
                {"type": "reference_image", "url": "https://cdn.test/reference.jpg"},
                {"type": "reference_audio", "url": "https://cdn.test/reference.mp3"},
            ],
        )

    def test_openapi_media_types_follow_yike_contract(self):
        medias = YikeVideoAPI._openapi_medias(
            "https://cdn.test/first.jpg",
            "https://cdn.test/last.jpg",
            [
                {"type": "reference_image", "url": "https://cdn.test/reference.jpg"},
                {"type": "reference_video", "url": "https://cdn.test/reference.mp4"},
                {"type": "reference_audio", "url": "https://cdn.test/reference.mp3"},
            ],
        )
        self.assertEqual(
            medias,
            [
                {"Type": "image", "Url": "https://cdn.test/first.jpg"},
                {"Type": "image", "Url": "https://cdn.test/last.jpg"},
                {"Type": "image", "Url": "https://cdn.test/reference.jpg"},
                {"Type": "video", "Url": "https://cdn.test/reference.mp4"},
                {"Type": "audio", "Url": "https://cdn.test/reference.mp3"},
            ],
        )
        self.assertEqual(
            YikeVideoAPI._job_type(
                None,
                None,
                [{"type": "reference_audio", "url": "https://cdn.test/reference.mp3"}],
            ),
            "reference_to_video",
        )

    async def test_wan30_sends_first_and_last_frames_in_media(self):
        input_obj = YikeVideoAPI._input(
            "wan3.0-video",
            "https://cdn.test/first.jpg",
            "https://cdn.test/last.jpg",
            "camera moves",
            [],
        )
        self.assertEqual(
            input_obj["media"],
            [
                {"type": "first_frame", "url": "https://cdn.test/first.jpg"},
                {"type": "last_frame", "url": "https://cdn.test/last.jpg"},
            ],
        )

    async def test_wan30_rejects_mixed_reference_modes(self):
        with self.assertRaises(YikeAPIError) as context:
            YikeVideoAPI._input(
                "wan3.0-video",
                "https://cdn.test/first.jpg",
                None,
                "test",
                [{"type": "reference_image", "url": "https://cdn.test/reference.jpg"}],
            )
        self.assertEqual(context.exception.error_code, "ConflictingReferenceModes")
        self.assertEqual(context.exception.http_status, 400)

    async def test_wan30_reference_image_is_reduced_to_upstream_limit(self):
        source = BytesIO()
        Image.new("RGB", (8001, 300), "white").save(source, format="JPEG")

        resized, width, height, changed = await ensure_min_image_size(
            source.getvalue(),
            min_width=300,
            min_height=300,
            max_width=8000,
            max_height=8000,
        )

        self.assertTrue(changed)
        self.assertLessEqual(width, 8000)
        self.assertLessEqual(height, 8000)
        with Image.open(BytesIO(resized)) as image:
            self.assertEqual(image.size, (width, height))

    async def test_http_errors_include_no_secret(self):
        async def handler(_request):
            return httpx.Response(401, json={"code": "Unauthorized", "message": "bad key"})

        api = self.make_api(handler)
        original = httpx.AsyncClient

        class ClientProxy(httpx.AsyncClient):
            def __init__(self, *args, **kwargs):
                kwargs["transport"] = api._transport
                super().__init__(*args, **kwargs)

        module.httpx.AsyncClient = ClientProxy
        try:
            with self.assertRaises(YikeAPIError) as context:
                await api.query_task("job-1")
        finally:
            module.httpx.AsyncClient = original
        self.assertNotIn("test-key", str(context.exception))
        self.assertEqual(context.exception.error_code, "Unauthorized")


if __name__ == "__main__":
    unittest.main()
