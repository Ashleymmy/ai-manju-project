import copy
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from http_security_fakes import fake_public_send
from test_image_checkpoint import RecoveryStore as ImageStore
from test_video_checkpoint import RecoveryStore as VideoStore
from test_provider import FakeProviderResponse, test_settings
from test_tasks import FakeTask, RetryCalled
from test_video import FakeVideoResponse
from worker import tasks, provider, video
from worker.db import RECOVERY_MAX_FAILURES, recovery_transition
from worker.errors import ImageRecoveryAttentionError, VideoRecoveryAttentionError, error_payload, recovery_attention_error
from worker.generation_failover import PROVIDER_CANDIDATES_FIELD
from worker.image_checkpoint import ImageCheckpoint
from worker.video_checkpoint import VideoCheckpoint


class RecoveryEscalationTest(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch("worker.http_security._send_public_once", side_effect=fake_public_send))
        self.provider = {"id": "native", "model": "video", "base_url": "https://api.test", "auth_type": "none", "video_protocol": "seedance"}
        self.payload = {"provider": self.provider, PROVIDER_CANDIDATES_FIELD: [self.provider], "staged_input_keys": ["private-input"]}

    def configure(self, directory, store):
        self.enterContext(patch.object(tasks, "settings", test_settings(directory)))
        self.enterContext(patch.object(tasks, "JobStore", return_value=store))
        self.gate = self.enterContext(patch.object(tasks, "provider_gate_from_payload", return_value=None))
        self.cleanup = self.enterContext(patch.object(tasks, "cleanup_job_inputs"))
        self.enterContext(patch.object(tasks, "register_result_assets", side_effect=lambda _s, _j, result, *_: result))

    def deliver(self, kind="video"):
        executor = video.generate_video if kind == "video" else provider.generate_image
        return tasks.execute_job(FakeTask(99), "job", self.payload, executor, kind)

    def test_repeated_accepted_401_403_404_stop_after_three_deliveries(self):
        for status in (401, 403, 404):
            with self.subTest(status=status), tempfile.TemporaryDirectory() as directory:
                store = VideoStore()
                checkpoint = VideoCheckpoint(store, "job", self.provider)
                checkpoint.begin()
                checkpoint.accepted("original-paid-id")
                self.configure(directory, store)
                with patch.object(video.requests, "get", return_value=FakeVideoResponse({}, status_code=status)) as get, patch.object(video.requests, "post") as post, patch.object(video.time, "sleep"):
                    for delay in (30, 60):
                        with self.assertRaisesRegex(RetryCalled, f"countdown={delay}"):
                            self.deliver()
                    result = self.deliver()
                    self.assertEqual(result["queue_phase"], "video_recovery_attention")
                    self.assertEqual(get.call_count, 3)
                    post.assert_not_called()
                    self.gate.reset_mock()
                    self.deliver()
                    self.gate.assert_not_called()
                    self.assertEqual(get.call_count, 3)
                self.cleanup.assert_not_called()
                self.assertEqual(store.job["attempts"], 0)
                self.assertEqual(store.job["status"], "queued")
                self.assertFalse(store.job["error"]["retryable"])
                self.assertEqual(store.final_errors, [])
                self.assertEqual(store.checkpoints.checkpoint["provider_task_id"], "original-paid-id")
                self.assertEqual(store.checkpoints.checkpoint["phase"], "accepted")

    def test_repeated_result_write_failure_keeps_video_output_and_stops_queue(self):
        with tempfile.TemporaryDirectory() as directory:
            store = VideoStore()
            self.configure(directory, store)
            completed = {"id": "original", "status": "succeeded", "content": {"video_url": "https://cdn.test/video"}}
            with patch.object(video.requests, "post", return_value=FakeVideoResponse(completed)) as post, patch.object(video.requests, "get", return_value=FakeVideoResponse(content=b"video", content_type="video/mp4")) as get, patch.object(store, "set_result", return_value=None):
                for index in range(RECOVERY_MAX_FAILURES):
                    if index < RECOVERY_MAX_FAILURES - 1:
                        with self.assertRaises(RetryCalled):
                            self.deliver()
                    else:
                        self.assertEqual(self.deliver()["queue_phase"], "video_recovery_attention")
                self.deliver()
                post.assert_called_once()
                get.assert_called_once()
            checkpoint = store.checkpoints.checkpoint
            self.assertEqual(checkpoint["phase"], "downloaded")
            self.assertEqual(Path(checkpoint["result"]["outputs"][0]["path"]).read_bytes(), b"video")
            self.assertEqual(store.results, [])
            self.assertEqual(store.final_errors, [])
            self.cleanup.assert_not_called()

    def test_image_recovery_stops_with_original_receipt_and_output_intact(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ImageStore()
            self.provider = {key: value for key, value in self.provider.items() if key != "video_protocol"}
            self.payload = {"provider": self.provider, PROVIDER_CANDIDATES_FIELD: [self.provider]}
            self.configure(directory, store)
            with patch.object(provider.requests, "post", return_value=FakeProviderResponse()) as post, patch.object(store, "set_result", side_effect=ConnectionError("offline")):
                for index in range(RECOVERY_MAX_FAILURES):
                    if index < RECOVERY_MAX_FAILURES - 1:
                        with self.assertRaises(RetryCalled):
                            self.deliver("image")
                    else:
                        self.assertEqual(self.deliver("image")["queue_phase"], "image_recovery_attention")
                self.deliver("image")
                post.assert_called_once()
            self.assertEqual(len(list(Path(directory).glob(".image-checkpoints/*/*.json"))), 1)
            self.assertEqual(Path(store.checkpoints.checkpoint["result"]["outputs"][0]["path"]).read_bytes(), b"png")
            self.cleanup.assert_not_called()
            self.assertEqual(store.job["attempts"], 0)

    def test_backoff_and_elapsed_time_are_private_and_bounded(self):
        now = datetime(2026, 9, 25, tzinfo=timezone.utc)
        checkpoint = {"phase": "accepted", "provider_task_id": "keep", "result": {"outputs": [{"path": "keep"}]}}
        delays = []
        for _ in range(5):
            checkpoint, error, delay = recovery_transition(checkpoint, "video", now=now)
            delays.append(delay)
        self.assertEqual(delays, [30, 60, 120, 240, 300])
        snapshot = copy.deepcopy(checkpoint)
        checkpoint, error, delay = recovery_transition(checkpoint, "video", now=now + timedelta(minutes=30))
        self.assertEqual(error["code"], "video_recovery_attention")
        self.assertEqual(checkpoint["result"], snapshot["result"])
        self.assertEqual(checkpoint["provider_task_id"], "keep")
        self.assertFalse(error["retryable"])
        self.assertNotIn("path", str(error))
        self.assertEqual(delay, 300)

    def test_access_failure_streak_resets_on_other_recovery_failure(self):
        checkpoint = {}
        for reason in ("video_recovery_http_401", "video_recovery_http_404", "video_recovery_pending", "video_recovery_http_401"):
            checkpoint, error, _ = recovery_transition(checkpoint, "video", reason=reason)
        self.assertEqual(checkpoint["recovery"]["consecutive_access_failures"], 1)
        self.assertEqual(error["code"], "video_recovery_pending")

    def test_review_checkpoints_reject_direct_execution_and_keep_public_code(self):
        with tempfile.TemporaryDirectory() as directory:
            store = VideoStore()
            checkpoint = VideoCheckpoint(store, "job", self.provider)
            checkpoint.begin()
            checkpoint.accepted("keep")
            store.mark_video_recovery("job", attention=True)
            with self.assertRaises(VideoRecoveryAttentionError):
                VideoCheckpoint(store, "job", self.provider).assert_recoverable()
            image_store = ImageStore()
            image_store.mark_image_recovery("job", attention=True)
            with self.assertRaises(ImageRecoveryAttentionError):
                ImageCheckpoint(image_store, "job", self.provider, test_settings(directory))
        for kind in ("image", "video"):
            self.assertEqual(error_payload(recovery_attention_error(kind))["code"], f"{kind}_recovery_attention")

    def test_startup_write_not_acknowledged_never_calls_executor(self):
        store = ImageStore()
        with tempfile.TemporaryDirectory() as directory:
            self.configure(directory, store)
            with patch.object(store, "mark_running", return_value=None), patch.object(provider.requests, "post") as post:
                with self.assertRaisesRegex(RetryCalled, "countdown=300"):
                    self.deliver("image")
                post.assert_not_called()
            self.cleanup.assert_not_called()

    def test_nonprovider_result_failure_is_preserved_for_review_not_reported_success(self):
        for failure in (None, ConnectionError("offline")):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                store = ImageStore()
                self.configure(directory, store)
                output = Path(directory) / "existing.png"
                output.write_bytes(b"image")
                kwargs = {"side_effect": failure} if isinstance(failure, Exception) else {"return_value": None}
                with patch.object(store, "set_result", **kwargs):
                    result = tasks.execute_job(FakeTask(0), "job", {}, lambda *_: {"outputs": [{"path": str(output), "size": 5}]}, "image")
                self.assertEqual(result["queue_phase"], "image_recovery_attention")
                self.assertEqual(store.job["status"], "queued")
                self.assertEqual(store.checkpoints.checkpoint["result"]["outputs"][0]["path"], str(output))
                self.assertEqual(output.read_bytes(), b"image")
                self.cleanup.assert_not_called()

    def test_private_attention_flag_restores_cleared_public_phase_without_network(self):
        store = VideoStore()
        store.mark_video_recovery("job", attention=True)
        store.job.update(queue_phase="", status="running")
        with tempfile.TemporaryDirectory() as directory:
            self.configure(directory, store)
            with patch.object(video.requests, "get") as get, patch.object(video.requests, "post") as post:
                result = self.deliver()
                self.assertEqual(result["queue_phase"], "video_recovery_attention")
                self.assertEqual(store.job["status"], "queued")
                self.assertEqual(store.job["queue_phase"], "video_recovery_attention")
                self.gate.assert_not_called()
                get.assert_not_called()
                post.assert_not_called()
                self.payload[PROVIDER_CANDIDATES_FIELD] = [None]
                self.assertEqual(self.deliver()["queue_phase"], "video_recovery_attention")

    def test_recovery_state_database_failure_never_acks_or_discards_output(self):
        store = ImageStore()
        self.provider = {key: value for key, value in self.provider.items() if key != "video_protocol"}
        self.payload = {"provider": self.provider, PROVIDER_CANDIDATES_FIELD: [self.provider]}
        with tempfile.TemporaryDirectory() as directory:
            self.configure(directory, store)
            with patch.object(provider.requests, "post", return_value=FakeProviderResponse()) as post, patch.object(store, "set_result", side_effect=ConnectionError("offline")), patch.object(store, "mark_image_recovery", side_effect=ConnectionError("offline")):
                with self.assertRaisesRegex(RetryCalled, "countdown=300"):
                    self.deliver("image")
                self.assertEqual(store.checkpoints.checkpoint["phase"], "downloaded")
                self.assertTrue(Path(store.checkpoints.checkpoint["result"]["outputs"][0]["path"]).is_file())
                self.cleanup.assert_not_called()
                post.assert_called_once()
