import base64
import struct
import subprocess
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest.mock import MagicMock, patch

import requests

from test_provider import FakeProviderResponse, test_settings
from test_tasks import FakeStore, FakeTask
from worker import provider, tasks
from worker.generation_failover import PROVIDER_CANDIDATES_FIELD
from worker.image_output_validation import ImageOutputValidationError, validate_canvas_image_outputs
from worker.image_requirements import ImageParameterError


def png_bytes(width, height):
    def chunk(kind, body):
        return struct.pack("!I", len(body)) + kind + body + struct.pack("!I", zlib.crc32(kind + body))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack("!2I5B", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress((b"\x00" + b"\x24\x68\x48" * width) * height)) + chunk(b"IEND", b""))


class ImageOutputValidationTest(unittest.TestCase):
    def test_remote_original_is_downloaded_and_checked_before_registration(self):
        for dimensions in ((1024, 1024), (1254, 1254), (1536, 1024)):
            with self.subTest(dimensions=dimensions), tempfile.TemporaryDirectory() as tmp:
                store = FakeStore()
                remote = {"base_url": "https://provider.example/v1", "model": "image", "auth_type": "none"}
                payload = {"model": "image", "size": "1024x1024", "quality": "high", "prompt": "苹果",
                           "asset_registration": {"source_type": "canvas"}, PROVIDER_CANDIDATES_FIELD: [remote]}
                response = MagicMock()
                response.__enter__.return_value = response
                response.headers = {"Content-Type": "image/png"}
                original = png_bytes(*dimensions)
                response.iter_content.return_value = [original[:32], original[32:]]
                generated = FakeProviderResponse(body={"data": [{"url": "https://cdn.example/original.png"}]})
                with patch.object(tasks, "settings", test_settings(tmp)), patch.object(tasks, "JobStore", return_value=store), \
                     patch.object(tasks, "provider_gate_from_payload", return_value=None), \
                     patch.object(tasks, "register_result_assets", side_effect=lambda _s, _j, result, *_: result) as register, \
                     patch.object(provider.requests, "post", return_value=generated) as post, \
                     patch("worker.image_output_validation.requests.get", return_value=response) as get:
                    if dimensions in ((1024, 1024), (1254, 1254)):
                        tasks.execute_job(FakeTask(0), "job_remote", payload, provider.generate_image, "image")
                        output = store.results[0]["outputs"][0]
                        self.assertEqual((output["width"], output["height"]), dimensions)
                        self.assertEqual(Path(output["path"]).read_bytes(), original)
                        self.assertEqual(output["content_type"], "image/png")
                        register.assert_called_once()
                    else:
                        with self.assertRaises(ImageOutputValidationError):
                            tasks.execute_job(FakeTask(0), "job_remote", payload, provider.generate_image, "image")
                        register.assert_not_called()
                        self.assertEqual(store.final_errors[0]["code"], "image_output_size_mismatch")
                    post.assert_called_once()
                    get.assert_called_once_with("https://cdn.example/original.png", stream=True, timeout=15)
                    self.assertEqual(store.retry_errors, [])

    def test_incomplete_remote_download_is_rejected_and_removed(self):
        with tempfile.TemporaryDirectory() as tmp:
            response = MagicMock()
            response.__enter__.return_value = response
            response.headers = {"Content-Type": "image/png"}

            def interrupted():
                yield b"partial image"
                raise requests.ConnectionError("download interrupted")

            response.iter_content.return_value = interrupted()
            payload = {"size": "1024x1024", "asset_registration": {"source_type": "canvas"}}
            result = {"outputs": [{"remote_url": "https://cdn.example/original.png"}]}
            with patch("worker.image_output_validation.requests.get", return_value=response):
                with self.assertRaises(ImageOutputValidationError) as caught:
                    validate_canvas_image_outputs(payload, result, test_settings(tmp))
            self.assertFalse(caught.exception.retryable)
            self.assertEqual(list(Path(tmp).iterdir()), [])

    def test_unsupported_parameter_error_survives_failover_without_calling_provider(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = FakeStore()
            payload = {"model": "image", "size": "1024x1024", "quality": "high", "prompt": "苹果",
                       "asset_registration": {"source_type": "canvas"},
                       PROVIDER_CANDIDATES_FIELD: [{"base_url": "https://provider.example/v1", "model": "image", "protocol": "openai_chat_completions", "auth_type": "none"}]}
            with patch.object(tasks, "settings", test_settings(tmp)), patch.object(tasks, "JobStore", return_value=store), \
                 patch.object(tasks, "provider_gate_from_payload", return_value=None), patch.object(provider.requests, "post") as post:
                with self.assertRaises(ImageParameterError):
                    tasks.execute_job(FakeTask(0), "job_unsupported", payload, provider.generate_image, "image")
            post.assert_not_called()
            self.assertEqual(store.retry_errors, [])
            self.assertEqual(store.results, [])
            self.assertEqual(store.final_errors[0]["code"], "image_parameters_unsupported")

    def test_original_resolution_and_aspect_ratio_must_meet_request(self):
        for operation in (provider.generate_image, provider.edit_image):
            for requested, actual, accepted in (
                ("1024x1024", (1024, 1024), True), ("2304x1728", (2304, 1728), True),
                ("3840x2160", (3840, 2160), True), ("1024x1024", (1254, 1254), True),
                ("1280x720", (1672, 941), True), ("720x1280", (941, 1672), True),
                ("1280x720", (2560, 1440), True), ("1280x720", (1672, 943), False),
                ("1024x1024", (1536, 1024), False), ("2048x2048", (1024, 1024), False),
                ("1280x720", (1279, 720), False),
            ):
                with self.subTest(operation=operation.__name__, requested=requested, actual=actual), tempfile.TemporaryDirectory() as tmp:
                    settings = test_settings(tmp)
                    store = FakeStore()
                    remote = {"base_url": "https://provider.example/v1", "model": "gpt-image-2", "auth_type": "none"}
                    payload = {"model": "gpt-image-2", "size": requested, "quality": "high", "prompt": "四个苹果",
                               "asset_registration": {"source_type": "canvas"},
                               "files": [{"filename": "ref.png", "content_type": "image/png", "b64_json": base64.b64encode(png_bytes(128, 64)).decode()}],
                               PROVIDER_CANDIDATES_FIELD: [remote]}
                    output = png_bytes(*actual)
                    response = FakeProviderResponse(body={"data": [{"b64_json": base64.b64encode(output).decode()}]})
                    with patch.object(tasks, "settings", settings), patch.object(tasks, "JobStore", return_value=store), \
                         patch.object(tasks, "provider_gate_from_payload", return_value=None), \
                         patch.object(tasks, "register_result_assets", side_effect=lambda _s, _j, result, *_: result) as register, \
                         patch.object(provider.requests, "post", return_value=response) as post:
                        if accepted:
                            tasks.execute_job(FakeTask(0), "job_dimensions", payload, operation, "image")
                            self.assertEqual(len(store.results), 1)
                            self.assertEqual(store.results[0]["outputs"][0]["width"], actual[0])
                            self.assertEqual(register.call_count, 1)
                            self.assertEqual(store.final_errors, [])
                        else:
                            with self.assertRaises(ImageOutputValidationError):
                                tasks.execute_job(FakeTask(0), "job_dimensions", payload, operation, "image")
                            self.assertEqual(store.results, [])
                            self.assertEqual(register.call_count, 0)
                            self.assertEqual(store.final_errors[0]["code"], "image_output_size_mismatch")
                            self.assertIn(f"{actual[0]}×{actual[1]}", store.final_errors[0]["message"])
                            self.assertEqual(store.retry_errors, [])
                        self.assertEqual(post.call_count, 1)
                        sent = post.call_args.kwargs.get("json") or post.call_args.kwargs["data"]
                        self.assertEqual(sent["size"], requested)
                        self.assertEqual(sent["quality"], "high")
                        # Successful and failed originals remain byte-for-byte intact, never resized.
                        self.assertIn(output, [path.read_bytes() for path in Path(tmp).rglob("*.png")])

    def test_unreadable_empty_and_timeout_results_fail_without_retries(self):
        with tempfile.TemporaryDirectory() as tmp:
            settings = test_settings(tmp)
            path = Path(tmp) / "broken.png"
            path.write_bytes(b"not an image")
            payload = {"size": "1024x1024", "asset_registration": {"source_type": "canvas"}}
            for result in ({"outputs": []}, {"outputs": [{"path": str(path)}]}, {"outputs": [{"path": "missing"}]}):
                with self.assertRaises(ImageOutputValidationError) as caught:
                    validate_canvas_image_outputs(payload, result, settings)
                self.assertFalse(caught.exception.retryable)
            with patch("worker.image_output_validation.subprocess.run", side_effect=subprocess.TimeoutExpired("ffprobe", 15)):
                with self.assertRaises(ImageOutputValidationError):
                    validate_canvas_image_outputs(payload, {"outputs": [{"path": str(path)}]}, settings)

    def test_legacy_auto_and_non_canvas_workflows_are_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            for payload in ({"size": "auto", "asset_registration": {"source_type": "canvas"}},
                            {"size": "1024x1024", "asset_registration": {"source_type": "comic_batch"}}):
                validate_canvas_image_outputs(payload, {}, test_settings(tmp))
