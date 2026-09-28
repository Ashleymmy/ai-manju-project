import tempfile
import unittest
from unittest.mock import patch

import requests

from test_generation_failover import DurableStore
from test_tasks import FakeTask, RetryCalled
from test_video import FakeVideoResponse, test_settings
from worker import tasks, video
from worker.errors import SafeTaskError
from worker.generation_failover import PROVIDER_CANDIDATES_FIELD


class NativeVideoFailoverTest(unittest.TestCase):
    def setUp(self):
        from http_security_fakes import fake_public_send
        self.enterContext(patch("worker.http_security._send_public_once", side_effect=fake_public_send))
        from video_checkpoint_fakes import isolated_checkpoint
        self.enterContext(patch("worker.video.checkpoint_for_video", side_effect=isolated_checkpoint))

    def test_native_result_preserves_nested_url_formats_and_rejects_nonvideo_content(self):
        self.assertEqual(video.native_video_url({"data": {"outputs": [{"downloadUrl": "https://storage.test/video"}]}}), "https://storage.test/video")
        with tempfile.TemporaryDirectory() as tmp, patch.object(video.requests, "get", return_value=FakeVideoResponse(content=b"error", content_type="text/html")):
            with self.assertRaises(SafeTaskError) as caught:
                video.download_video_result("job_html", "task", {"content": {"video_url": "https://storage.test/video"}}, {"video_protocol": "seedance"}, "https://api.test/", {}, 900, test_settings(tmp), lambda _: None)
            self.assertEqual(caught.exception.code, "provider_invalid_response")

    def test_async_failure_retries_three_times_then_switches_and_registers_once(self):
        for success in (True, False):
            with self.subTest(success=success), tempfile.TemporaryDirectory() as tmp:
                settings = test_settings(tmp)
                store = DurableStore()
                providers = [{"id": name, "model": "wan3.0-video", "base_url": f"https://{name}.test/v1/",
                              "auth_type": "bearer", "api_key": "private-key", "video_protocol": "seedance",
                              "endpoint": "contents/generations/tasks",
                              "endpoint_overrides": {"video_get": "contents/generations/tasks/{id}"}}
                             for name in ("a", "b")]
                providers[1].update(provider_type="aliyun_yike", video_request_body={"model": "wan3.0-video", "input": {"prompt": "test"}})
                payload = {"model": "wan3.0-video", "content": [{"type": "text", "text": "test"}], PROVIDER_CANDIDATES_FIELD: providers}
                calls, keys, polls = [], [], []

                def post(url, **kwargs):
                    supplier = "b" if "b.test" in url else "a"
                    calls.append(supplier)
                    keys.append(kwargs["headers"]["Idempotency-Key"])
                    self.assertGreaterEqual(kwargs["timeout"], 900)
                    self.assertEqual(kwargs["json"]["model"], "wan3.0-video")
                    self.assertNotIn("provider", kwargs["json"])
                    if supplier == "b":
                        self.assertEqual(kwargs["headers"]["X-DashScope-Async"], "enable")
                        self.assertEqual(kwargs["json"]["input"], {"prompt": "test"})
                    return FakeVideoResponse({"output": {"task_id": "accepted-task", "task_status": "PENDING"}})

                def get(url, **kwargs):
                    self.assertNotIn("X-DashScope-Async", kwargs.get("headers", {}))
                    if "storage.test" in url:
                        self.assertEqual(kwargs.get("headers", {}), {})
                        return FakeVideoResponse(content=b"generated-video", content_type="video/mp4")
                    polls.append(url)
                    status = "SUCCEEDED" if success and "b.test" in url else "FAILED"
                    return FakeVideoResponse({"output": {"task_id": "accepted-task", "task_status": status, "video_url": "https://storage.test/output.mp4"}})

                with patch.object(tasks, "JobStore", return_value=store), \
                     patch.object(tasks, "settings", settings), \
                     patch.object(tasks, "provider_gate_from_payload", return_value=None), \
                     patch.object(tasks, "cleanup_staged_inputs", return_value=[]), \
                     patch.object(tasks, "register_result_assets", side_effect=lambda _s, _j, result, *_: result) as register, \
                     patch.object(video.requests, "post", side_effect=post), \
                     patch.object(video.requests, "get", side_effect=get), \
                     patch.object(video.time, "sleep"):
                    for attempt in range(6):
                        try:
                            result = tasks.execute_job(FakeTask(retries=0), "job_native", payload, video.generate_video, "video")
                            self.assertTrue(success)
                            self.assertEqual(result["status"], "succeeded")
                            break
                        except RetryCalled:
                            self.assertEqual(store.retry_errors, [{}] * (attempt + 1))
                            self.assertEqual(store.final_errors, [])
                        except SafeTaskError as error:
                            self.assertFalse(success)
                            self.assertEqual(error.code, "generation_unavailable")
                    self.assertEqual(calls, ["a", "a", "a", "b"] if success else ["a", "a", "a", "b", "b", "b"])
                    self.assertEqual(len(set(keys)), len(calls))
                    self.assertEqual(len(polls), len(calls))
                    self.assertEqual(register.call_count, 1 if success else 0)

    def test_transient_poll_errors_keep_the_accepted_task(self):
        with tempfile.TemporaryDirectory() as tmp, \
             patch.object(video.requests, "post", return_value=FakeVideoResponse({"id": "existing", "status": "queued"})) as create, \
             patch.object(video.requests, "get", side_effect=[requests.ConnectionError(), FakeVideoResponse(status_code=503), FakeVideoResponse({"status": "succeeded", "content": {"video_url": "https://storage.test/video"}}), FakeVideoResponse(content=b"video", content_type="video/mp4")]), \
             patch.object(video.time, "sleep"):
            result = video.generate_video("job_poll", {"model": "seedance", "provider": {"base_url": "https://api.test/v1/", "auth_type": "none", "model": "seedance", "video_protocol": "seedance", "endpoint": "contents/generations/tasks"}}, test_settings(tmp), lambda _: None)
            self.assertEqual(len(result["outputs"]), 1)
            create.assert_called_once()

    def test_timeout_and_cancellation_remain_bounded(self):
        with tempfile.TemporaryDirectory() as tmp, \
             patch.object(video.time, "monotonic", side_effect=[0, 901]):
            with self.assertRaises(SafeTaskError) as caught:
                video.wait_for_video_task("task", {"status": "running"}, {}, "https://api.test/", {}, 900, test_settings(tmp), lambda _: None)
            self.assertEqual(caught.exception.code, "provider_timeout")
        with patch.object(video.requests, "delete") as cancel:
            video.cancel_provider_video_task("task", {"video_protocol": "seedance"}, "https://api.test/v1/", {}, 900)
            self.assertEqual(cancel.call_args.kwargs["timeout"], 10)
