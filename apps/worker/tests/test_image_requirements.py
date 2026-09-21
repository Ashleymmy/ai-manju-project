import base64
import tempfile
import unittest
from unittest.mock import patch

from test_provider import FakeProviderResponse, test_settings
from worker import provider
from worker.image_requirements import CANVAS_OUTPUT_REQUIREMENTS, ImageParameterError, with_canvas_image_requirements


class ImageRequirementsTest(unittest.TestCase):
    def test_square_request_reaches_every_generation_and_reference_edit_protocol(self):
        for protocol in ("openai_images", "openai_responses", "openai_chat_completions", "gemini_generate_content", "dashscope_multimodal", "stability_image"):
            for operation in (provider.generate_image, provider.edit_image):
                with self.subTest(protocol=protocol, operation=operation.__name__), tempfile.TemporaryDirectory() as tmp:
                    payload = {
                        "prompt": "四个苹果", "size": "1024x1024", "quality": "high" if protocol in ("openai_images", "openai_responses") else "auto",
                        "asset_registration": {"source_type": "canvas"},
                        "files": [{"filename": "wide.png", "content_type": "image/png", "b64_json": base64.b64encode(b"reference").decode()}],
                        "provider": {"base_url": "https://provider.example/v1", "model": "gpt-image-2", "protocol": protocol, "auth_type": "none"},
                    }
                    with patch.object(provider.requests, "post", return_value=FakeProviderResponse()) as post:
                        operation("job_parameters", payload, test_settings(tmp), lambda _: None)
                    sent = str(post.call_args.kwargs.get("json") or post.call_args.kwargs.get("data"))
                    self.assertIn("1024×1024", sent)
                    self.assertIn("不要沿用参考图的宽高比", sent)
                    if protocol == "openai_images":
                        body = post.call_args.kwargs.get("json") or post.call_args.kwargs["data"]
                        self.assertEqual(body["size"], "1024x1024")
                        self.assertEqual(body["quality"], "high")
                    self.assertEqual(payload["prompt"], "四个苹果")

    def test_unsupported_detail_is_rejected_before_any_paid_request(self):
        for protocol in ("openai_chat_completions", "gemini_generate_content", "dashscope_multimodal", "stability_image"):
            for quality in ("low", "medium", "high"):
                with self.subTest(protocol=protocol, quality=quality), tempfile.TemporaryDirectory() as tmp:
                    payload = {"prompt": "苹果", "size": "1024x1024", "quality": quality,
                               "asset_registration": {"source_type": "canvas"},
                               "provider": {"base_url": "https://provider.example/v1", "model": "image", "protocol": protocol, "auth_type": "none"}}
                    with patch.object(provider.requests, "post") as post:
                        with self.assertRaises(ImageParameterError) as caught:
                            provider.generate_image("job_unsupported", payload, test_settings(tmp), lambda _: None)
                    self.assertEqual(caught.exception.code, "image_parameters_unsupported")
                    self.assertFalse(caught.exception.retryable)
                    post.assert_not_called()

    def test_requirements_are_not_duplicated_and_do_not_affect_auto_or_other_workflows(self):
        payload = {"prompt": "苹果", "size": "1024x1024", "asset_registration": {"source_type": "canvas"}}
        enriched = with_canvas_image_requirements(payload)
        self.assertEqual(with_canvas_image_requirements(enriched), enriched)
        self.assertEqual(enriched["prompt"].count(CANVAS_OUTPUT_REQUIREMENTS), 1)
        for changes in ({"size": "auto"}, {"size": "0x1024"}, {"asset_registration": {"source_type": "comic_batch"}}):
            original = {**payload, **changes}
            self.assertEqual(with_canvas_image_requirements(original), original)
