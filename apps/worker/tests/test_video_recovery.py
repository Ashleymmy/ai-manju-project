import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import requests
from billiard.exceptions import SoftTimeLimitExceeded

from test_video import FakeVideoResponse, test_settings
from http_security_fakes import fake_public_send
from worker import video
from worker.errors import SafeTaskError, VideoSubmissionUncertainError, VideoTaskAcceptedError, job_canceled_error


class VideoRecoveryTest(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch("worker.http_security._send_public_once", side_effect=fake_public_send))
        from video_checkpoint_fakes import isolated_checkpoint
        self.enterContext(patch("worker.video.checkpoint_for_video", side_effect=isolated_checkpoint))

    def payload(self):
        return {"model": "seedance", "provider": {
            "base_url": "https://api.test/v1/", "auth_type": "none", "model": "seedance",
            "video_protocol": "seedance", "endpoint": "contents/generations/tasks",
        }}

    def completed(self):
        return FakeVideoResponse({"id": "accepted", "status": "succeeded", "content": {"video_url": "https://storage.test/video"}})

    def test_transient_download_errors_retry_get_not_paid_generation(self):
        with tempfile.TemporaryDirectory() as tmp, \
             patch.object(video.requests, "post", return_value=self.completed()) as create, \
             patch.object(video.requests, "get", side_effect=[requests.ConnectionError(), FakeVideoResponse({"error": "temporary"}, status_code=503), FakeVideoResponse(content=b"video", content_type="video/mp4")]) as download, \
             patch.object(video.time, "sleep"):
            result = video.generate_video("job_transfer", self.payload(), test_settings(tmp), lambda _: None)
            self.assertEqual(Path(result["outputs"][0]["path"]).read_bytes(), b"video")
            create.assert_called_once()
            self.assertEqual(download.call_count, 3)

    def test_partial_download_is_overwritten_after_transport_failure(self):
        partial = FakeVideoResponse(content_type="video/mp4")

        def interrupted(**_kwargs):
            yield b"partial"
            raise requests.ConnectionError()

        partial.iter_content = interrupted
        with tempfile.TemporaryDirectory() as tmp, \
             patch.object(video.requests, "post", return_value=self.completed()) as create, \
             patch.object(video.requests, "get", side_effect=[partial, FakeVideoResponse(content=b"complete", content_type="video/mp4")]), \
             patch.object(video.time, "sleep"):
            result = video.generate_video("job_partial", self.payload(), test_settings(tmp), lambda _: None)
            self.assertEqual(Path(result["outputs"][0]["path"]).read_bytes(), b"complete")
            create.assert_called_once()

    def test_exhausted_download_is_not_a_generation_failure(self):
        with tempfile.TemporaryDirectory() as tmp, \
             patch.object(video.requests, "post", return_value=self.completed()) as create, \
             patch.object(video.requests, "get", side_effect=requests.ConnectionError()) as download, \
             patch.object(video.time, "sleep"):
            with self.assertRaises(VideoTaskAcceptedError) as caught:
                video.generate_video("job_transfer_failure", self.payload(), test_settings(tmp), lambda _: None)
            self.assertTrue(caught.exception.retryable)
            self.assertEqual(download.call_count, video.VIDEO_DOWNLOAD_ATTEMPTS)
            create.assert_called_once()

    def test_download_cancellation_is_not_retried(self):
        with tempfile.TemporaryDirectory() as tmp, \
             patch.object(video.requests, "get", side_effect=requests.ConnectionError()) as download, \
             patch.object(video.time, "sleep") as sleep:
            calls = 0

            def progress(_):
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise job_canceled_error()

            with self.assertRaises(SafeTaskError) as caught:
                video.download_completed_video("job_cancel", "task", self.completed().body, self.payload()["provider"], "https://api.test/", {}, 30, test_settings(tmp), progress)
            self.assertEqual(caught.exception.code, "job_canceled")
            download.assert_called_once()
            sleep.assert_not_called()

    def test_ambiguous_submit_never_authorizes_a_new_paid_request(self):
        cases = [requests.ReadTimeout(), requests.ConnectionError(), SoftTimeLimitExceeded(), FakeVideoResponse(status_code=504), FakeVideoResponse(body=None), FakeVideoResponse({"status": "queued"})]
        for response in cases:
            with self.subTest(response=type(response).__name__), tempfile.TemporaryDirectory() as tmp, \
                 patch.object(video.requests, "post", side_effect=response if isinstance(response, Exception) else None, return_value=response) as create:
                with self.assertRaises(VideoSubmissionUncertainError) as caught:
                    video.generate_video("job_uncertain", self.payload(), test_settings(tmp), lambda _: None)
                self.assertFalse(caught.exception.retryable)
                create.assert_called_once()

    def test_connect_timeout_is_still_safe_to_retry(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(video.requests, "post", side_effect=requests.ConnectTimeout()):
            with self.assertRaises(SafeTaskError) as caught:
                video.generate_video("job_not_sent", self.payload(), test_settings(tmp), lambda _: None)
            self.assertNotIsInstance(caught.exception, VideoSubmissionUncertainError)
            self.assertTrue(caught.exception.retryable)

    def test_soft_timeout_after_acceptance_cannot_trigger_supplier_failover(self):
        with tempfile.TemporaryDirectory() as tmp, \
             patch.object(video.requests, "post", return_value=self.completed()) as create, \
             patch.object(video.requests, "get", side_effect=SoftTimeLimitExceeded()):
            with self.assertRaises(VideoTaskAcceptedError) as caught:
                video.generate_video("job_accepted_timeout", self.payload(), test_settings(tmp), lambda _: None)
            self.assertTrue(caught.exception.retryable)
            create.assert_called_once()

    def test_soft_timeout_after_download_cannot_recreate_completed_video(self):
        def progress(value):
            if value == video.VIDEO_COMPLETE_PROGRESS:
                raise SoftTimeLimitExceeded()

        with tempfile.TemporaryDirectory() as tmp, \
             patch.object(video.requests, "post", return_value=self.completed()) as create, \
             patch.object(video.requests, "get", return_value=FakeVideoResponse(content=b"video", content_type="video/mp4")):
            with self.assertRaises(VideoTaskAcceptedError):
                video.generate_video("job_downloaded_timeout", self.payload(), test_settings(tmp), progress)
            create.assert_called_once()

    def test_terminal_provider_failure_remains_eligible_for_failover(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(video.requests, "post", return_value=FakeVideoResponse({"id": "accepted", "status": "failed"})):
            with self.assertRaises(SafeTaskError) as caught:
                video.generate_video("job_rejected", self.payload(), test_settings(tmp), lambda _: None)
            self.assertEqual(caught.exception.code, "provider_video_failed")
            self.assertNotIsInstance(caught.exception, VideoTaskAcceptedError)

    def test_exhausted_content_rate_limit_is_an_accepted_task_error(self):
        with tempfile.TemporaryDirectory() as tmp, \
             patch.object(video.requests, "post", return_value=self.completed()) as create, \
             patch.object(video.requests, "get", return_value=FakeVideoResponse({"error": "busy"}, status_code=429)) as download, \
             patch.object(video.time, "sleep"):
            with self.assertRaises(VideoTaskAcceptedError) as caught:
                video.generate_video("job_content_busy", self.payload(), test_settings(tmp), lambda _: None)
            self.assertEqual(caught.exception.code, "video_recovery_pending")
            self.assertTrue(caught.exception.retryable)
            self.assertEqual(download.call_count, video.VIDEO_DOWNLOAD_ATTEMPTS)
            create.assert_called_once()

    def test_accepted_content_rate_limit_never_requeues_create(self):
        from test_generation_failover import DurableStore
        from test_tasks import FakeTask
        from worker import tasks
        from worker.generation_failover import PROVIDER_CANDIDATES_FIELD

        store = DurableStore()
        store.job["created_at"] = datetime.now(timezone.utc)
        payload = self.payload()
        payload[PROVIDER_CANDIDATES_FIELD] = [payload["provider"]]
        error = VideoTaskAcceptedError("content download busy", code="provider_rate_limited", retryable=False)
        with patch.object(tasks, "JobStore", return_value=store), \
             patch.object(tasks, "provider_gate_from_payload", return_value=None), \
             patch.object(tasks, "cleanup_staged_inputs", return_value=[]), \
             patch.object(tasks, "generate_video", side_effect=error) as generate:
            with self.assertRaises(VideoTaskAcceptedError):
                tasks.execute_job(FakeTask(retries=0), "job_rate", payload, tasks.generate_video, "video")
            self.assertEqual(store.retry_errors, [])
            generate.assert_called_once()


if __name__ == "__main__":
    unittest.main()
