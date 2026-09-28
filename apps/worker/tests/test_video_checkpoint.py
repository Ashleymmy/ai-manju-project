import copy
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

import requests

from test_generation_failover import DurableStore
from test_tasks import FakeTask, RetryCalled
from test_video import FakeVideoResponse, test_settings
from video_checkpoint_fakes import CheckpointStore
from http_security_fakes import fake_public_send
from worker import tasks, video
from worker.db import JobStore, recovery_transition
from worker.errors import SafeTaskError, VideoRecoveryPendingError, VideoSubmissionUncertainError, VideoReferenceError
from worker.generation_failover import PROVIDER_CANDIDATES_FIELD
from worker.video_checkpoint import VIDEO_CHECKPOINT_KEY, VIDEO_CHECKPOINT_PAYLOAD_KEY, VideoCheckpoint


class SimulatedHardStop(BaseException):
    pass


class RecoveryStore(DurableStore):
    def __init__(self):
        super().__init__()
        self.job.update(type="video.generate")
        self.checkpoints = CheckpointStore()
        self.recoveries = []

    def get_video_checkpoint(self, job_id):
        self.checkpoints.status = self.job["status"]
        return self.checkpoints.get_video_checkpoint(job_id)

    def save_video_checkpoint(self, job_id, value, expected):
        self.checkpoints.status = self.job["status"]
        return self.checkpoints.save_video_checkpoint(job_id, value, expected)

    def mark_video_recovery(self, job_id, *, uncertain=False, reason="", attention=False, recovered_result=None):
        self.recoveries.append(uncertain)
        checkpoint, error, delay = recovery_transition(self.checkpoints.checkpoint, "video", uncertain=uncertain, reason=reason, attention=attention)
        if recovered_result is not None and not checkpoint.get("result"):
            checkpoint["result"] = copy.deepcopy(recovered_result)
        self.checkpoints.checkpoint = checkpoint
        self.job.update(status="queued", queue_phase=error["code"], error=error, bridge_metadata={VIDEO_CHECKPOINT_KEY: checkpoint})
        return {**self.get_job(job_id), "recovery_retry_seconds": delay}


class VideoCheckpointTest(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch("worker.http_security._send_public_once", side_effect=fake_public_send))
        self.provider = {"id": "video-provider", "base_url": "https://api.test/v1/", "auth_type": "none",
                         "model": "seedance", "video_protocol": "seedance", "endpoint": "contents/generations/tasks"}
        self.payload = {"model": "seedance", "content": [], "provider": self.provider}

    def completed(self):
        return {"id": "remote-task", "status": "succeeded", "content": {"video_url": "https://storage.test/output"}}

    def deliver(self, store, settings):
        payload = {**self.payload, VIDEO_CHECKPOINT_PAYLOAD_KEY: VideoCheckpoint(store, "job", self.provider)}
        return video.generate_video("job", payload, settings, lambda _: None)

    def test_intent_precedes_post_and_id_persists_before_poll(self):
        store = CheckpointStore()

        def post(*_, **__):
            self.assertEqual(store.checkpoint["phase"], "submission_intent")
            return FakeVideoResponse({"id": "remote-task", "status": "queued"})

        def get(url, **_):
            self.assertEqual(store.checkpoint["provider_task_id"], "remote-task")
            return FakeVideoResponse(content=b"video", content_type="video/mp4") if "storage" in url else FakeVideoResponse(self.completed())

        with tempfile.TemporaryDirectory() as tmp, patch.object(video.requests, "post", side_effect=post) as create, \
             patch.object(video.requests, "get", side_effect=get), patch.object(video.time, "sleep"):
            self.deliver(store, test_settings(tmp))
        self.assertEqual(store.checkpoint["phase"], "downloaded")
        create.assert_called_once()
        saved = str(store.checkpoint)
        self.assertNotIn("https://", saved)
        self.assertNotIn("api_key", saved)

    def test_database_unavailable_never_submits(self):
        for failure in ("fail_read", "fail_write"):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as tmp, patch.object(video.requests, "post") as create:
                store = CheckpointStore()
                setattr(store, failure, True)
                with self.assertRaises(VideoRecoveryPendingError):
                    self.deliver(store, test_settings(tmp))
                create.assert_not_called()
        with tempfile.TemporaryDirectory() as tmp, patch.object(video.requests, "post") as create:
            # No implicit in-memory fallback when production configuration is absent.
            with self.assertRaises(VideoRecoveryPendingError):
                video.generate_video("job", self.payload, test_settings(tmp), lambda _: None)
            create.assert_not_called()

    def test_hard_stop_after_acceptance_redelivers_only_poll_and_download(self):
        store = CheckpointStore()
        with tempfile.TemporaryDirectory() as tmp, patch.object(video.requests, "post", return_value=FakeVideoResponse({"id": "remote-task", "status": "queued"})) as create:
            with patch.object(video, "wait_for_video_task", side_effect=SimulatedHardStop):
                with self.assertRaises(SimulatedHardStop):
                    self.deliver(store, test_settings(tmp))
            self.assertEqual(store.checkpoint["provider_task_id"], "remote-task")
            with patch.object(video.requests, "get", side_effect=[FakeVideoResponse(self.completed()), FakeVideoResponse(content=b"video", content_type="video/mp4")]), patch.object(video.time, "sleep"):
                result = self.deliver(store, test_settings(tmp))
            self.assertEqual(Path(result["outputs"][0]["path"]).read_bytes(), b"video")
            create.assert_called_once()

    def test_hard_stop_during_submit_is_never_reposted(self):
        store = CheckpointStore()
        with tempfile.TemporaryDirectory() as tmp, patch.object(video.requests, "post", side_effect=SimulatedHardStop) as create:
            with self.assertRaises(SimulatedHardStop):
                self.deliver(store, test_settings(tmp))
            with self.assertRaises(VideoSubmissionUncertainError):
                self.deliver(store, test_settings(tmp))
            create.assert_called_once()

    def test_failed_accepted_id_write_keeps_intent_for_reconciliation(self):
        store = CheckpointStore()

        def accepted(*_, **__):
            store.fail_write = True
            return FakeVideoResponse({"id": "remote-task", "status": "queued"})

        with tempfile.TemporaryDirectory() as tmp, patch.object(video.requests, "post", side_effect=accepted) as create:
            with self.assertRaises(VideoRecoveryPendingError):
                self.deliver(store, test_settings(tmp))
            store.fail_write = False
            with self.assertRaises(VideoSubmissionUncertainError):
                self.deliver(store, test_settings(tmp))
            create.assert_called_once()

    def test_cancel_after_acceptance_prevents_poll_and_cancels_upstream(self):
        store = CheckpointStore()

        def accepted(*_, **__):
            store.status = "canceled"
            return FakeVideoResponse({"id": "remote-task", "status": "queued"})

        with tempfile.TemporaryDirectory() as tmp, patch.object(video.requests, "post", side_effect=accepted) as create, \
             patch.object(video, "cancel_provider_video_task") as cancel, patch.object(video.requests, "get") as get:
            with self.assertRaises(SafeTaskError) as caught:
                self.deliver(store, test_settings(tmp))
            self.assertEqual(caught.exception.code, "job_canceled")
            create.assert_called_once()
            cancel.assert_called_once()
            self.assertEqual(cancel.call_args.args[0], "remote-task")
            get.assert_not_called()

    def test_accepted_task_401_or_404_only_retries_polling(self):
        for status in (401, 404):
            with self.subTest(status=status):
                store = CheckpointStore()
                checkpoint = VideoCheckpoint(store, "job", self.provider)
                checkpoint.begin()
                checkpoint.accepted("remote-task")
                with tempfile.TemporaryDirectory() as tmp, patch.object(video.requests, "post") as create, \
                     patch.object(video.requests, "get", return_value=FakeVideoResponse({"error": "not found"}, status_code=status)), \
                     patch.object(video.time, "sleep"):
                    for _ in range(2):
                        with self.assertRaises(VideoRecoveryPendingError):
                            self.deliver(store, test_settings(tmp))
                    create.assert_not_called()
                    self.assertEqual(store.checkpoint["phase"], "accepted")
                    self.assertEqual(store.checkpoint["provider_task_id"], "remote-task")

    def test_terminal_state_wins_during_recovery(self):
        for status in ("canceled", "failed", "succeeded"):
            with self.subTest(status=status):
                store = RecoveryStore()
                payload = {**self.payload, PROVIDER_CANDIDATES_FIELD: [self.provider]}

                def finish_elsewhere(*_):
                    store.job["status"] = status
                    raise VideoRecoveryPendingError("interrupted", code="video_recovery_pending")

                with tempfile.TemporaryDirectory() as tmp, patch.object(tasks, "settings", test_settings(tmp)), \
                     patch.object(tasks, "JobStore", return_value=store), patch.object(tasks, "provider_gate_from_payload", return_value=None):
                    result = tasks.execute_job(FakeTask(0), "job", payload, finish_elsewhere, "video")
                self.assertEqual(result["status"], status)
                self.assertEqual(store.recoveries, [])
                self.assertEqual(store.final_errors, [])
                self.assertEqual(store.job["attempts"], 0)

    def test_two_owners_cas_allows_only_one_submission(self):
        store = CheckpointStore()
        owners = [VideoCheckpoint(store, "job", self.provider) for _ in range(2)]
        barrier = threading.Barrier(2)

        def begin(checkpoint):
            barrier.wait()
            try:
                checkpoint.begin()
                return "submit"
            except VideoRecoveryPendingError:
                return "wait"

        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertCountEqual(pool.map(begin, owners), ["submit", "wait"])

    def test_changed_provider_never_reuses_or_resubmits_old_task(self):
        store = CheckpointStore()
        checkpoint = VideoCheckpoint(store, "job", self.provider)
        checkpoint.begin()
        checkpoint.accepted("existing")
        with self.assertRaises(VideoSubmissionUncertainError):
            VideoCheckpoint(store, "job", {**self.provider, "base_url": "https://other.test"})

    def test_queued_uncertain_submission_keeps_credits_and_attempts(self):
        store = RecoveryStore()
        payload = {**self.payload, PROVIDER_CANDIDATES_FIELD: [self.provider]}
        with tempfile.TemporaryDirectory() as tmp, patch.object(tasks, "settings", test_settings(tmp)), \
             patch.object(tasks, "JobStore", return_value=store), patch.object(tasks, "provider_gate_from_payload", return_value=None), \
             patch.object(tasks, "cleanup_staged_inputs") as cleanup, patch.object(video.requests, "post", side_effect=requests.ReadTimeout()) as create:
            result = tasks.execute_job(FakeTask(0), "job", payload, video.generate_video, "video")
            self.assertEqual(result["queue_phase"], "video_submission_uncertain")
            result = tasks.execute_job(FakeTask(0), "job", payload, video.generate_video, "video")
            self.assertEqual(result["status"], "queued")
            self.assertEqual(store.job["attempts"], 0)
            self.assertEqual(store.final_errors, [])
            create.assert_called_once()
            cleanup.assert_not_called()

    def test_import_failure_redelivers_cached_output_without_new_paid_task(self):
        store = RecoveryStore()
        payload = {**self.payload, PROVIDER_CANDIDATES_FIELD: [self.provider]}
        with tempfile.TemporaryDirectory() as tmp, patch.object(tasks, "settings", test_settings(tmp)), \
             patch.object(tasks, "JobStore", return_value=store), patch.object(tasks, "provider_gate_from_payload", return_value=None), \
             patch.object(tasks, "cleanup_staged_inputs", return_value=[]), \
             patch.object(video.requests, "post", return_value=FakeVideoResponse(self.completed())) as create, \
             patch.object(video.requests, "get", return_value=FakeVideoResponse(content=b"video", content_type="video/mp4")) as get:
            with patch.object(tasks, "register_result_assets", side_effect=ConnectionError("asset DB unavailable")):
                with self.assertRaises(RetryCalled):
                    tasks.execute_job(FakeTask(0), "job", payload, video.generate_video, "video")
            self.assertEqual(store.checkpoints.checkpoint["phase"], "downloaded")
            self.assertEqual(store.job["attempts"], 0)
            self.assertEqual(store.final_errors, [])
            with patch.object(tasks, "register_result_assets", side_effect=lambda _, __, result, *_args: result) as register:
                result = tasks.execute_job(FakeTask(1), "job", payload, video.generate_video, "video")
            self.assertEqual(result["status"], "succeeded")
            create.assert_called_once()
            get.assert_called_once()
            register.assert_called_once()

    def test_missing_local_cache_downloads_same_remote_task_again(self):
        store = CheckpointStore()
        checkpoint = VideoCheckpoint(store, "job", self.provider)
        checkpoint.begin()
        checkpoint.accepted("remote-task")
        checkpoint.downloaded({"outputs": [{"path": "/definitely/missing/video.mp4", "size": 5}]})
        with tempfile.TemporaryDirectory() as tmp, patch.object(video.requests, "post") as create, \
             patch.object(video.requests, "get", side_effect=[FakeVideoResponse(self.completed()), FakeVideoResponse(content=b"video", content_type="video/mp4")]), patch.object(video.time, "sleep"):
            result = self.deliver(store, test_settings(tmp))
            self.assertEqual(result["provider_task_id"], "remote-task")
            create.assert_not_called()

    def test_reference_timeout_is_terminal_without_three_identical_submissions(self):
        store = RecoveryStore()
        payload = {**self.payload, PROVIDER_CANDIDATES_FIELD: [self.provider]}
        failed = {"id": "remote-task", "status": "failed", "error": {"message": "Timeout occurred while processing video for content[21]. private request details"}}
        with tempfile.TemporaryDirectory() as tmp, patch.object(tasks, "settings", test_settings(tmp)), \
             patch.object(tasks, "JobStore", return_value=store), patch.object(tasks, "provider_gate_from_payload", return_value=None), \
             patch.object(tasks, "cleanup_staged_inputs", return_value=[]), \
             patch.object(video.requests, "post", return_value=FakeVideoResponse(failed)) as create:
            with self.assertRaises(VideoReferenceError):
                tasks.execute_job(FakeTask(0), "job", payload, video.generate_video, "video")
        create.assert_called_once()
        self.assertEqual(store.checkpoints.checkpoint["phase"], "terminal_failure")
        self.assertEqual(store.job["status"], "failed")
        self.assertEqual(store.final_errors[0]["code"], "video_reference_timeout")
        self.assertNotIn("private", store.final_errors[0]["message"])
        self.assertEqual(store.retry_errors, [])


if __name__ == "__main__":
    unittest.main()
