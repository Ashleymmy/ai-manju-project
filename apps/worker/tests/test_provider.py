import base64
import hashlib
import tempfile
import sys
import unittest
from pathlib import Path
from typing import Any


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from worker.config import Settings
from worker.errors import SafeTaskError
from worker import provider as provider_module
from worker.provider import edit_image, generate_image


class FakeProviderResponse:
    def __init__(self, status_code: int = 200, body: dict[str, Any] | None = None, text: str = "", headers: dict[str, str] | None = None, content: bytes = b"") -> None:
        self.status_code = status_code
        self._body = body if body is not None else {"data": [{"b64_json": base64.b64encode(b"png").decode("ascii")}]}
        self.text = text
        self.headers = headers or {}
        self.content = content

    def json(self) -> dict[str, Any]:
        return self._body


def test_settings(tmp: str) -> Settings:
    return Settings(
        celery_broker_url="redis://localhost:6379/0",
        celery_queue_name="celery",
        celery_result_backend=None,
        database_url="",
        job_max_attempts=3,
        job_default_timeout_seconds=30,
        asset_storage_dir=Path(tmp),
        worker_tmp_dir=Path(tmp) / "tmp",
        ffmpeg_bin="ffmpeg",
        health_host="0.0.0.0",
        health_port=8101,
    )


class ProviderTest(unittest.TestCase):
    def test_mock_image_generation_writes_png(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            settings = test_settings(tmp)
            progress_values: list[int] = []
            result = generate_image("job_test", {"prompt": "hello"}, settings, progress_values.append)

            output = Path(result["outputs"][0]["path"])
            self.assertTrue(output.exists())
            self.assertEqual(output.suffix, ".png")
            self.assertIn(45, progress_values)
            self.assertIn(90, progress_values)

    def test_openai_compatible_edit_sends_multipart_images(self) -> None:
        captured: dict[str, Any] = {}
        original_post = provider_module.requests.post

        def fake_post(url: str, **kwargs: Any) -> FakeProviderResponse:
            captured["url"] = url
            captured.update(kwargs)
            return FakeProviderResponse()

        provider_module.requests.post = fake_post
        try:
            with tempfile.TemporaryDirectory() as tmp:
                settings = test_settings(tmp)
                result = edit_image(
                    "job_edit",
                    {
                        "model": "gpt-image-1",
                        "prompt": "edit this",
                        "size": "1024x1024",
                        "n": 2,
                        "asset_registration": {"folder_id": "internal-folder", "source_type": "comic_batch"},
                        "files": [
                            {
                                "field_name": "image",
                                "filename": "input.png",
                                "content_type": "image/png",
                                "b64_json": base64.b64encode(b"input-bytes").decode("ascii"),
                            }
                        ],
                        "provider": {
                            "base_url": "https://provider.example/v1",
                            "endpoint": "images/edits",
                            "api_key": "sk-test",
                            "auth_type": "bearer",
                            "model": "gpt-image-1",
                        },
                    },
                    settings,
                    lambda _: None,
                )
        finally:
            provider_module.requests.post = original_post

        self.assertEqual(captured["url"], "https://provider.example/v1/images/edits")
        self.assertNotIn("json", captured)
        self.assertNotIn("Content-Type", captured["headers"])
        self.assertEqual(captured["headers"]["Authorization"], "Bearer sk-test")
        self.assertEqual(captured["data"]["model"], "gpt-image-1")
        self.assertEqual(captured["data"]["prompt"], "edit this")
        self.assertEqual(captured["data"]["n"], "2")
        self.assertNotIn("asset_registration", captured["data"])
        self.assertEqual(captured["files"][0][0], "image")
        self.assertEqual(captured["files"][0][1], ("input.png", b"input-bytes", "image/png"))
        self.assertEqual(result["mode"], "openai_compatible")
        self.assertEqual(result["operation"], "edit")

    def test_openai_compatible_edit_reads_staged_storage_reference(self) -> None:
        captured: dict[str, Any] = {}
        original_post = provider_module.requests.post

        def fake_post(url: str, **kwargs: Any) -> FakeProviderResponse:
            _, (_, stream, _) = kwargs["files"][0]
            captured["bytes"] = stream.read()
            return FakeProviderResponse()

        provider_module.requests.post = fake_post
        try:
            with tempfile.TemporaryDirectory() as tmp:
                content = b"staged-input"
                key = "jobs/inputs/personal/user_123/batch/input.png"
                path = Path(tmp) / Path(key)
                path.parent.mkdir(parents=True)
                path.write_bytes(content)
                edit_image(
                    "job_staged_edit",
                    {
                        "_job_workspace_id": "default:user_123",
                        "prompt": "edit this",
                        "files": [
                            {
                                "filename": "input.png",
                                "content_type": "image/png",
                                "storage_key": key,
                                "size": len(content),
                                "sha256": hashlib.sha256(content).hexdigest(),
                            }
                        ],
                        "provider": {
                            "base_url": "https://provider.example",
                            "api_key": "sk-test",
                            "auth_type": "bearer",
                            "model": "gpt-image-1",
                        },
                    },
                    test_settings(tmp),
                    lambda _: None,
                )
        finally:
            provider_module.requests.post = original_post

        self.assertEqual(captured["bytes"], b"staged-input")

    def test_openai_compatible_edit_omits_gpt_image_2_unsupported_fields(self) -> None:
        captured: dict[str, Any] = {}
        original_post = provider_module.requests.post

        def fake_post(url: str, **kwargs: Any) -> FakeProviderResponse:
            captured.update(kwargs)
            return FakeProviderResponse()

        provider_module.requests.post = fake_post
        try:
            with tempfile.TemporaryDirectory() as tmp:
                edit_image(
                    "job_edit_gpt2",
                    {
                        "model": "gpt-image-2-codex",
                        "prompt": "edit this",
                        "n": 2,
                        "response_format": "b64_json",
                        "output_format": "png",
                        "files": [
                            {
                                "filename": "input.png",
                                "content_type": "image/png",
                                "b64_json": base64.b64encode(b"input").decode("ascii"),
                            }
                        ],
                        "provider": {
                            "base_url": "https://provider.example",
                            "api_key": "sk-test",
                            "auth_type": "bearer",
                            "model": "gpt-image-2-codex",
                        },
                    },
                    test_settings(tmp),
                    lambda _: None,
                )
        finally:
            provider_module.requests.post = original_post

        self.assertEqual(captured["data"]["model"], "gpt-image-2-codex")
        self.assertNotIn("n", captured["data"])
        self.assertNotIn("response_format", captured["data"])
        self.assertNotIn("output_format", captured["data"])

    def test_provider_bad_request_includes_sanitized_upstream_detail(self) -> None:
        original_post = provider_module.requests.post

        def fake_post(url: str, **kwargs: Any) -> FakeProviderResponse:
            return FakeProviderResponse(
                status_code=400,
                body={"error": {"message": "missing image at http://internal.local/upload?api_key=secret"}},
            )

        provider_module.requests.post = fake_post
        try:
            with tempfile.TemporaryDirectory() as tmp:
                with self.assertRaises(SafeTaskError) as caught:
                    edit_image(
                        "job_bad_request",
                        {
                            "prompt": "edit this",
                            "files": [
                                {
                                    "filename": "input.png",
                                    "content_type": "image/png",
                                    "b64_json": base64.b64encode(b"input").decode("ascii"),
                                }
                            ],
                            "provider": {
                                "base_url": "https://provider.example",
                                "api_key": "sk-test",
                                "auth_type": "bearer",
                                "model": "gpt-image-1",
                            },
                        },
                        test_settings(tmp),
                        lambda _: None,
                    )
        finally:
            provider_module.requests.post = original_post

        self.assertEqual(caught.exception.code, "provider_bad_request")
        self.assertFalse(caught.exception.retryable)
        self.assertIn("missing image", caught.exception.message)
        self.assertIn("[url]", caught.exception.message)
        self.assertNotIn("internal.local", caught.exception.message)

    def test_provider_429_is_retryable_and_honors_retry_after(self) -> None:
        original_post = provider_module.requests.post

        def fake_post(url: str, **kwargs: Any) -> FakeProviderResponse:
            return FakeProviderResponse(status_code=429, body={"error": {"message": "Concurrency limit exceeded"}}, headers={"Retry-After": "7"})

        provider_module.requests.post = fake_post
        try:
            with tempfile.TemporaryDirectory() as tmp:
                with self.assertRaises(SafeTaskError) as caught:
                    generate_image(
                        "job_rate_limited",
                        {
                            "prompt": "test",
                            "provider": {
                                "base_url": "https://provider.example",
                                "api_key": "sk-test",
                                "auth_type": "bearer",
                                "model": "gpt-image-1",
                            },
                        },
                        test_settings(tmp),
                        lambda _: None,
                    )
        finally:
            provider_module.requests.post = original_post

        self.assertEqual(caught.exception.code, "provider_rate_limited")
        self.assertTrue(caught.exception.retryable)
        self.assertEqual(caught.exception.retry_after_seconds, 7)

    def test_chat_completions_image_edit_routes_reference_and_markdown_output(self) -> None:
        captured: dict[str, Any] = {}
        original_post = provider_module.requests.post

        def fake_post(url: str, **kwargs: Any) -> FakeProviderResponse:
            captured["url"] = url
            captured.update(kwargs)
            encoded = base64.b64encode(b"chat-image").decode("ascii")
            return FakeProviderResponse(body={"choices": [{"message": {"content": f"![result](data:image/png;base64,{encoded})"}}]})

        provider_module.requests.post = fake_post
        try:
            with tempfile.TemporaryDirectory() as tmp:
                result = edit_image(
                    "job_chat_edit",
                    {
                        "prompt": "keep the person",
                        "files": [{"filename": "input.png", "content_type": "image/png", "b64_json": base64.b64encode(b"input").decode("ascii")}],
                        "provider": {"base_url": "https://relay.example/v1", "endpoint": "chat/completions", "protocol": "openai_chat_completions", "api_key": "sk-test", "auth_type": "bearer", "model": "gemini-2.5-flash-image"},
                    },
                    test_settings(tmp),
                    lambda _: None,
                )
        finally:
            provider_module.requests.post = original_post

        self.assertEqual(captured["url"], "https://relay.example/v1/chat/completions")
        content = captured["json"]["messages"][0]["content"]
        self.assertEqual(content[0]["type"], "text")
        self.assertTrue(content[1]["image_url"]["url"].startswith("data:image/png;base64,"))
        self.assertEqual(result["outputs"][0]["size"], len(b"chat-image"))

    def test_responses_protocol_extracts_image_generation_call(self) -> None:
        captured: dict[str, Any] = {}
        original_post = provider_module.requests.post

        def fake_post(url: str, **kwargs: Any) -> FakeProviderResponse:
            captured["url"] = url
            captured.update(kwargs)
            return FakeProviderResponse(body={"output": [{"type": "image_generation_call", "result": base64.b64encode(b"response-image").decode("ascii")} ]})

        provider_module.requests.post = fake_post
        try:
            with tempfile.TemporaryDirectory() as tmp:
                result = generate_image(
                    "job_responses",
                    {"prompt": "paint", "provider": {"base_url": "https://relay.example/v1", "endpoint": "responses", "protocol": "openai_responses", "auth_type": "none", "model": "gpt-5.5"}},
                    test_settings(tmp),
                    lambda _: None,
                )
        finally:
            provider_module.requests.post = original_post

        self.assertEqual(captured["url"], "https://relay.example/v1/responses")
        self.assertEqual(captured["json"]["tools"][0]["type"], "image_generation")
        self.assertEqual(result["outputs"][0]["size"], len(b"response-image"))

    def test_gemini_native_edit_uses_inline_data(self) -> None:
        captured: dict[str, Any] = {}
        original_post = provider_module.requests.post

        def fake_post(url: str, **kwargs: Any) -> FakeProviderResponse:
            captured["url"] = url
            captured.update(kwargs)
            return FakeProviderResponse(body={"candidates": [{"content": {"parts": [{"inlineData": {"mimeType": "image/png", "data": base64.b64encode(b"gemini-image").decode("ascii")}}]}}]})

        provider_module.requests.post = fake_post
        try:
            with tempfile.TemporaryDirectory() as tmp:
                result = edit_image(
                    "job_gemini_edit",
                    {
                        "prompt": "edit",
                        "files": [{"content_type": "image/png", "b64_json": base64.b64encode(b"input").decode("ascii")}],
                        "provider": {"base_url": "https://generativelanguage.googleapis.com/v1beta", "endpoint": "models/gemini-2.5-flash-image:generateContent", "protocol": "gemini_generate_content", "auth_type": "x_goog_api_key", "api_key": "key", "model": "gemini-2.5-flash-image"},
                    },
                    test_settings(tmp),
                    lambda _: None,
                )
        finally:
            provider_module.requests.post = original_post

        self.assertEqual(captured["url"], "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent")
        self.assertEqual(captured["json"]["contents"][0]["parts"][1]["inlineData"]["data"], base64.b64encode(b"input").decode("ascii"))
        self.assertEqual(result["outputs"][0]["size"], len(b"gemini-image"))

    def test_dashscope_multimodal_protocol_uses_message_shape(self) -> None:
        captured: dict[str, Any] = {}
        original_post = provider_module.requests.post

        def fake_post(url: str, **kwargs: Any) -> FakeProviderResponse:
            captured["url"] = url
            captured.update(kwargs)
            return FakeProviderResponse(body={"output": {"choices": [{"message": {"content": [{"image": "https://cdn.example/result.png"}]}}]}})

        provider_module.requests.post = fake_post
        try:
            with tempfile.TemporaryDirectory() as tmp:
                result = generate_image(
                    "job_dashscope",
                    {"prompt": "paint", "provider": {"base_url": "https://dashscope.aliyuncs.com", "endpoint": "api/v1/services/aigc/multimodal-generation/generation", "protocol": "dashscope_multimodal", "auth_type": "bearer", "api_key": "key", "model": "qwen-image-plus"}},
                    test_settings(tmp),
                    lambda _: None,
                )
        finally:
            provider_module.requests.post = original_post

        self.assertEqual(captured["json"]["input"]["messages"][0]["content"][0]["text"], "paint")
        self.assertEqual(result["outputs"][0]["remote_url"], "https://cdn.example/result.png")

    def test_stability_protocol_accepts_binary_image_response(self) -> None:
        captured: dict[str, Any] = {}
        original_post = provider_module.requests.post

        def fake_post(url: str, **kwargs: Any) -> FakeProviderResponse:
            captured["url"] = url
            captured.update(kwargs)
            return FakeProviderResponse(headers={"Content-Type": "image/webp"}, content=b"webp-image")

        provider_module.requests.post = fake_post
        try:
            with tempfile.TemporaryDirectory() as tmp:
                result = generate_image(
                    "job_stability",
                    {"prompt": "paint", "output_format": "webp", "provider": {"base_url": "https://api.stability.ai", "endpoint": "v2beta/stable-image/generate/sd3", "protocol": "stability_image", "auth_type": "bearer", "api_key": "key", "model": "sd3.5-large"}},
                    test_settings(tmp),
                    lambda _: None,
                )
        finally:
            provider_module.requests.post = original_post

        self.assertEqual(captured["data"]["prompt"], "paint")
        self.assertEqual(Path(result["outputs"][0]["path"]).suffix, ".webp")
        self.assertEqual(result["outputs"][0]["size"], len(b"webp-image"))

if __name__ == "__main__":
    unittest.main()
