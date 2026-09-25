"""Recovery dispatch cannot become a second paid generation request."""
import base64
import copy
import os
import tempfile
import unittest
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import uuid4

import psycopg
from celery.exceptions import Retry
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from http_security_fakes import fake_public_send
from test_image_checkpoint import RecoveryStore as ImageStore
from test_provider import test_settings
from test_tasks import FakeTask, RetryCalled
from test_video import FakeVideoResponse
from test_video_checkpoint import RecoveryStore as VideoStore
from worker import tasks, provider, video
from worker.config import load_settings
from worker.db import JobStore
from worker.errors import SafeTaskError
from worker.generation_failover import PROVIDER_CANDIDATES_FIELD
from worker.image_checkpoint import IMAGE_CHECKPOINT_KEY, ImageCheckpoint
from worker.recovery_dispatch import (
    RECOVERY_CONTROL_KEY, RECOVERY_ONLY_FIELD, RECOVERY_TOKEN_FIELD, RECOVERY_AUTOMATIC_FIELD,
    acknowledge_recovery, automatic_recovery_allowed,
)
from worker.video_checkpoint import VIDEO_CHECKPOINT_KEY, VideoCheckpoint

TOKEN = "1" * 32
VIDEO_PROVIDER = {"id": "native", "model": "video", "base_url": "https://api.test",
                  "auth_type": "none", "video_protocol": "seedance"}


class AckMixin:
    """Fake only ACK's SQL boundary; real checkpoint/execution code runs."""
    def __init__(self):
        super().__init__()
        self.key = VIDEO_CHECKPOINT_KEY if self.job["type"] == "video.generate" else IMAGE_CHECKPOINT_KEY
        self.metadata = {RECOVERY_CONTROL_KEY: {"token": TOKEN}, "sibling": {"keep": True}}
        self.ack_count = 0
        self.locked = False

    @contextmanager
    def job_lock(self, job_id):
        self.locked = True
        try:
            yield SimpleNamespace(acquired=True)
        finally:
            self.locked = False

    def get_job(self, job_id):
        self.metadata[self.key] = copy.deepcopy(self.checkpoints.checkpoint)
        self.job["bridge_metadata"] = copy.deepcopy(self.metadata)
        return copy.deepcopy(self.job)

    @contextmanager
    def connect(self):
        assert self.locked, "acknowledgement must hold the job advisory lock"
        yield self

    @contextmanager
    def cursor(self):
        yield self

    def execute(self, sql, params):
        if sql.startswith("SELECT"):
            self.row = self.get_job("job")
        else:
            assert sql.startswith("UPDATE jobs")
            self.ack_count += 1
            self.metadata = copy.deepcopy(params[0].obj)
            self.checkpoints.checkpoint = copy.deepcopy(self.metadata[self.key])
            self.job.update(dispatch_state="observed", queue_phase=params[2])
            self.row = self.get_job("job")

    def fetchone(self):
        return self.row


class RecoverableVideoStore(AckMixin, VideoStore):
    pass


class RecoverableImageStore(AckMixin, ImageStore):
    pass


class RecoveryDispatchTest(unittest.TestCase):
    def setUp(self):
        self.directory = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(patch("worker.http_security._send_public_once", side_effect=fake_public_send))
        self.enterContext(patch.object(video.time, "sleep"))
        self.enterContext(patch.object(tasks, "settings", test_settings(self.directory)))
        self.gate = self.enterContext(patch.object(tasks, "provider_gate_from_payload", return_value=None))
        self.cleanup = self.enterContext(patch.object(tasks, "cleanup_job_inputs"))
        self.enterContext(patch.object(tasks, "register_result_assets", side_effect=lambda _s, _j, result, *_: result))
        self.provider = dict(VIDEO_PROVIDER)

    def bind(self, store):
        self.enterContext(patch.object(tasks, "JobStore", return_value=store))

    def payload(self, token=TOKEN):
        return {"provider": self.provider, PROVIDER_CANDIDATES_FIELD: [self.provider],
                RECOVERY_ONLY_FIELD: True, RECOVERY_TOKEN_FIELD: token}

    def deliver(self, executor=None, kind="video", token=TOKEN):
        return tasks.execute_job(FakeTask(99), "job", self.payload(token), executor or video.generate_video, kind)

    def accepted(self):
        store = RecoverableVideoStore()
        checkpoint = VideoCheckpoint(store, "job", self.provider)
        checkpoint.begin()
        checkpoint.accepted("original-paid-task")
        store.mark_video_recovery("job", attention=True)
        self.bind(store)
        return store

    def automatic_payload(self):
        return {"provider": self.provider, PROVIDER_CANDIDATES_FIELD: [self.provider],
                RECOVERY_ONLY_FIELD: True, RECOVERY_AUTOMATIC_FIELD: True}

    def automatic_store(self):
        store = self.accepted()
        store.metadata.pop(RECOVERY_CONTROL_KEY)
        store.job.update(queue_phase="video_recovery_pending", dispatch_state="observed")
        store.checkpoints.checkpoint["recovery"] = {
            "failures": 1, "first_failure_at": datetime.now(timezone.utc).isoformat(),
        }
        return store

    def test_automatic_video_recovery_only_downloads_original_and_preserves_budget(self):
        store = self.automatic_store()
        original = copy.deepcopy(store.checkpoints.checkpoint["recovery"])
        completed = {"id": "original-paid-task", "status": "succeeded", "content": {"video_url": "https://cdn.test/video"}}
        replies = [FakeVideoResponse(completed), FakeVideoResponse(content=b"video", content_type="video/mp4")]
        with patch.object(video.requests, "post") as post, patch.object(video.requests, "get", side_effect=replies) as get:
            result = tasks.execute_job(FakeTask(0), "job", self.automatic_payload(), video.generate_video, "video")
            self.assertEqual(result["status"], "succeeded")
            self.assertEqual(get.call_count, 2)
            post.assert_not_called()
        self.assertEqual(store.checkpoints.checkpoint["recovery"], original)
        self.assertEqual(store.ack_count, 0)

    def test_automatic_image_recovery_uses_existing_private_receipt_without_post(self):
        self.provider = {"id": "native", "model": "image", "base_url": "https://api.test", "auth_type": "none"}
        store = RecoverableImageStore()
        store.metadata.pop(RECOVERY_CONTROL_KEY)
        checkpoint = ImageCheckpoint(store, "job", self.provider, test_settings(self.directory))
        checkpoint.begin()
        checkpoint.received([{"b64_json": base64.b64encode(b"png").decode()}], {"mode": "provider"})
        store.mark_image_recovery("job")
        original = copy.deepcopy(store.checkpoints.checkpoint["recovery"])
        self.bind(store)
        with patch.object(provider.requests, "post") as post:
            result = tasks.execute_job(FakeTask(0), "job", self.automatic_payload(), provider.generate_image, "image")
            self.assertEqual(result["status"], "succeeded")
            post.assert_not_called()
        self.assertEqual(store.checkpoints.checkpoint["recovery"], original)
        self.assertEqual(store.ack_count, 0)

    def test_automatic_mode_is_trusted_only_and_never_reaches_executor(self):
        _, untrusted = tasks.extract_request(("job",), {"payload": self.automatic_payload()})
        self.assertNotIn(RECOVERY_AUTOMATIC_FIELD, untrusted)
        self.assertNotIn(RECOVERY_ONLY_FIELD, untrusted)
        for flag in (False, "true", 1):
            _, payload = tasks.extract_request(("job",), {RECOVERY_ONLY_FIELD: True, RECOVERY_AUTOMATIC_FIELD: flag})
            self.assertNotIn(RECOVERY_AUTOMATIC_FIELD, payload)
        store = self.automatic_store()
        executor = Mock(return_value={"outputs": []})
        self.assertEqual(tasks.execute_job(FakeTask(0), "job", self.automatic_payload(), executor, "video")["status"], "succeeded")
        self.assertNotIn(RECOVERY_AUTOMATIC_FIELD, executor.call_args.args[1])

    def test_automatic_stale_delivery_cannot_reset_manual_request_or_new_timer(self):
        store = self.automatic_store()
        store.metadata[RECOVERY_CONTROL_KEY] = {"token": TOKEN}
        executor = Mock()
        result = tasks.execute_job(FakeTask(0), "job", self.automatic_payload(), executor, "video")
        self.assertTrue(result["recovery_ignored"])
        store.metadata[RECOVERY_CONTROL_KEY]["acknowledged"] = True
        store.job["worker_retry_at"] = datetime.now(timezone.utc) + timedelta(minutes=10)
        before = copy.deepcopy(store.checkpoints.checkpoint)
        result = tasks.execute_job(FakeTask(0), "job", self.automatic_payload(), executor, "video")
        self.assertTrue(result["recovery_ignored"])
        self.assertEqual(store.checkpoints.checkpoint, before)
        executor.assert_not_called()
        self.assertEqual(store.ack_count, 0)

    def test_automatic_recovery_after_gate_wait_still_has_bounded_failures(self):
        store = self.automatic_store()
        store.job["queue_phase"] = "waiting_provider_slot"
        store.metadata[RECOVERY_CONTROL_KEY] = {"token": TOKEN, "acknowledged": True}
        original_start = store.checkpoints.checkpoint["recovery"]["first_failure_at"]
        with patch.object(video.requests, "get", return_value=FakeVideoResponse({}, status_code=403)) as get, patch.object(video.requests, "post") as post:
            for _ in range(2):
                with self.assertRaises(RetryCalled):
                    tasks.execute_job(FakeTask(0), "job", self.automatic_payload(), video.generate_video, "video")
            result = tasks.execute_job(FakeTask(0), "job", self.automatic_payload(), video.generate_video, "video")
            self.assertEqual(result["queue_phase"], "video_recovery_attention")
            tasks.execute_job(FakeTask(0), "job", self.automatic_payload(), video.generate_video, "video")
            self.assertEqual(get.call_count, 3)
            post.assert_not_called()
        self.assertEqual(store.checkpoints.checkpoint["recovery"]["first_failure_at"], original_start)
        self.assertEqual(store.ack_count, 0)

    def test_expired_recovery_budget_stops_before_any_provider_or_gate_call(self):
        store = self.automatic_store()
        store.checkpoints.checkpoint["recovery"]["first_failure_at"] = (datetime.now(timezone.utc) - timedelta(minutes=31)).isoformat()
        before = copy.deepcopy(store.checkpoints.checkpoint["recovery"])
        executor = Mock()
        result = tasks.execute_job(FakeTask(0), "job", self.automatic_payload(), executor, "video")
        self.assertEqual(result["queue_phase"], "video_recovery_attention")
        self.assertEqual(store.checkpoints.checkpoint["recovery"]["failures"], before["failures"])
        self.assertEqual(store.checkpoints.checkpoint["recovery"]["first_failure_at"], before["first_failure_at"])
        executor.assert_not_called()
        self.gate.assert_not_called()

    def test_automatic_guard_rejects_ambiguous_conflicting_or_malformed_checkpoints(self):
        store = self.automatic_store()
        baseline = store.get_job("job")
        for mutate in (
            lambda j: j.update(status="succeeded"),
            lambda j: j.update(queue_phase="video_submission_uncertain"),
            lambda j: j.update(dispatch_state="recovery_pending"),
            lambda j: j["bridge_metadata"].update({IMAGE_CHECKPOINT_KEY: {}}),
            lambda j: j["bridge_metadata"][VIDEO_CHECKPOINT_KEY].update(phase="submission_intent"),
            lambda j: j["bridge_metadata"][VIDEO_CHECKPOINT_KEY].update(provider_task_id=""),
            lambda j: j["bridge_metadata"][VIDEO_CHECKPOINT_KEY].update(revision=True),
            lambda j: j["bridge_metadata"][VIDEO_CHECKPOINT_KEY].update(recovery="bad"),
        ):
            candidate = copy.deepcopy(baseline)
            mutate(candidate)
            self.assertFalse(automatic_recovery_allowed(candidate))

    def test_original_upstream_failure_ends_recovery_without_generation_retry(self):
        for automatic in (False, True):
            with self.subTest(automatic=automatic):
                store = self.automatic_store() if automatic else self.accepted()
                payload = self.automatic_payload() if automatic else self.payload()
                original_attempts = store.job["attempts"]
                with patch.object(video.requests, "get", return_value=FakeVideoResponse({"id": "original-paid-task", "status": "failed", "error": {"message": "failed"}})) as get, patch.object(video.requests, "post") as post:
                    with self.assertRaises(SafeTaskError):
                        tasks.execute_job(FakeTask(0), "job", payload, video.generate_video, "video")
                    self.assertEqual(store.job["status"], "failed")
                    # Existing set_error records the original attempt's final
                    # failure once; there is no new attempt or retry chain.
                    self.assertEqual(store.job["attempts"], original_attempts + 1)
                    self.assertEqual(store.retry_errors, [])
                    self.assertEqual(store.checkpoints.checkpoint["phase"], "terminal_failure")
                    get.assert_called_once()
                    post.assert_not_called()

    def test_untrusted_flags_are_stripped_and_only_literal_server_true_is_accepted(self):
        untrusted = {RECOVERY_ONLY_FIELD: True, RECOVERY_TOKEN_FIELD: "forged", "prompt": "keep"}
        for flag in (None, False, "true", 1):
            kwargs = {"payload": untrusted, RECOVERY_ONLY_FIELD: flag, RECOVERY_TOKEN_FIELD: TOKEN}
            _, payload = tasks.extract_request(("job",), kwargs)
            self.assertNotIn(RECOVERY_ONLY_FIELD, payload)
            self.assertNotIn(RECOVERY_TOKEN_FIELD, payload)
        kwargs = {"payload": untrusted, RECOVERY_ONLY_FIELD: True, RECOVERY_TOKEN_FIELD: TOKEN}
        before = copy.deepcopy(kwargs)
        _, payload = tasks.extract_request(("job",), kwargs)
        self.assertIs(payload[RECOVERY_ONLY_FIELD], True)
        self.assertEqual(payload[RECOVERY_TOKEN_FIELD], TOKEN)
        self.assertEqual(kwargs, before)

    def test_stale_or_invalid_token_never_acquires_gate_or_runs_executor(self):
        store = self.accepted()
        before = store.get_job("job")
        execute = Mock()
        for token in ("", "bad", "2" * 32):
            result = self.deliver(execute, token=token)
            self.assertTrue(result["recovery_ignored"])
        self.assertEqual(store.get_job("job"), before)
        self.assertEqual(store.ack_count, 0)
        self.gate.assert_not_called()
        execute.assert_not_called()

    def test_acknowledgement_uses_fresh_job_and_never_passes_controls_to_executor(self):
        store = self.accepted()
        executor = Mock(return_value={"outputs": []})
        self.assertEqual(self.deliver(executor)["status"], "succeeded")
        self.assertEqual(store.ack_count, 1)
        payload = executor.call_args.args[1]
        self.assertNotIn(RECOVERY_ONLY_FIELD, payload)
        self.assertNotIn(RECOVERY_TOKEN_FIELD, payload)
        self.assertNotIn("recovery", store.checkpoints.checkpoint)
        self.assertEqual(store.checkpoints.checkpoint["provider_task_id"], "original-paid-task")
        self.assertEqual(store.metadata["sibling"], {"keep": True})

    def test_duplicate_token_does_not_restart_recovery_window_or_repeat_post(self):
        store = self.accepted()
        with patch.object(video.requests, "get", return_value=FakeVideoResponse({}, status_code=401)) as get, patch.object(video.requests, "post") as post:
            for delay in (30, 60):
                with self.assertRaisesRegex(RetryCalled, f"countdown={delay}"):
                    self.deliver()
            first_at = store.checkpoints.checkpoint["recovery"]["first_failure_at"]
            self.assertEqual(self.deliver()["queue_phase"], "video_recovery_attention")
            self.gate.reset_mock()
            self.assertEqual(self.deliver()["queue_phase"], "video_recovery_attention")
            self.gate.assert_not_called()
            self.assertEqual(get.call_count, 3)
            post.assert_not_called()
        self.assertEqual(store.ack_count, 1)
        self.assertEqual(store.checkpoints.checkpoint["recovery"]["failures"], 3)
        self.assertEqual(store.checkpoints.checkpoint["recovery"]["first_failure_at"], first_at)
        self.assertEqual(store.job["attempts"], 0)
        self.cleanup.assert_not_called()

    def test_missing_or_rejected_checkpoint_never_calls_executor(self):
        for kind, cls in (("video", RecoverableVideoStore), ("image", RecoverableImageStore)):
            for phase in (None, "rejected", "terminal_failure"):
                with self.subTest(kind=kind, phase=phase):
                    store = cls()
                    if phase:
                        store.checkpoints.checkpoint = {"phase": phase}
                    self.bind(store)
                    executor = Mock()
                    result = self.deliver(executor, kind)
                    self.assertEqual(result["queue_phase"], f"{kind}_submission_uncertain")
                    executor.assert_not_called()
                    self.assertEqual(store.final_errors, [])

    def test_image_intent_missing_receipt_never_posts_and_saved_receipt_recovers(self):
        self.provider.pop("video_protocol")
        for persisted in (False, True):
            with self.subTest(persisted=persisted):
                store = RecoverableImageStore()
                checkpoint = ImageCheckpoint(store, "job", self.provider, test_settings(self.directory))
                checkpoint.begin()
                if persisted:
                    checkpoint.received([{"b64_json": base64.b64encode(b"png").decode()}], {"mode": "provider"})
                    store.checkpoints.checkpoint["phase"] = "submission_intent"
                store.mark_image_recovery("job", attention=True)
                self.bind(store)
                with patch.object(provider.requests, "post") as post:
                    result = self.deliver(provider.generate_image, "image")
                    self.assertEqual(result["status"], "succeeded" if persisted else "queued")
                    post.assert_not_called()

    def test_cached_video_without_task_id_reuses_output_without_network(self):
        store = self.accepted()
        output = Path(self.directory) / "video.mp4"
        output.write_bytes(b"saved-video")
        store.checkpoints.checkpoint.update(phase="downloaded", provider_task_id="",
            result={"outputs": [{"path": str(output), "size": output.stat().st_size}]})
        with patch.object(video.requests, "get") as get, patch.object(video.requests, "post") as post:
            self.assertEqual(self.deliver()["status"], "succeeded")
            get.assert_not_called()
            post.assert_not_called()

    def test_celery_retry_retains_original_server_recovery_kwargs(self):
        self.accepted()
        kwargs = {"payload": {"prompt": "keep"}, "provider": self.provider,
                  "provider_candidates": [self.provider],
                  RECOVERY_ONLY_FIELD: True, RECOVERY_TOKEN_FIELD: TOKEN}
        task = tasks.video_generate
        task.push_request(args=("job",), kwargs=kwargs, called_directly=False, is_eager=False,
                          retries=0, delivery_info={"routing_key": "celery"})
        try:
            with patch.object(task, "apply_async") as publish, patch.object(video.requests, "get", return_value=FakeVideoResponse({}, status_code=404)), patch.object(video.requests, "post") as post:
                with self.assertRaises(Retry):
                    task.run("job", **kwargs)
                sent = publish.call_args.args[1] if len(publish.call_args.args) > 1 else publish.call_args.kwargs["kwargs"]
                self.assertEqual(sent, kwargs)
                post.assert_not_called()
        finally:
            task.pop_request()

    def test_cache_disappearing_after_guard_cannot_fall_through_to_paid_post(self):
        store = self.accepted()
        store.checkpoints.checkpoint.update(phase="downloaded", provider_task_id="")
        with patch.object(VideoCheckpoint, "cached_result", side_effect=[{"outputs": [{"path": "cached"}]}, None]), \
                patch.object(video.requests, "post") as post, patch.object(video.requests, "get") as get:
            result = self.deliver()
            self.assertEqual(result["queue_phase"], "video_submission_uncertain")
            post.assert_not_called()
            get.assert_not_called()

    def test_terminal_external_and_unsupported_jobs_are_not_acknowledged(self):
        for changes in ({"status": "succeeded"}, {"status": "canceled"}, {"status": "failed"},
                        {"external_provider": "sd-video"}, {"type": "video.transcode"}):
            with self.subTest(changes=changes):
                store = RecoverableVideoStore()
                store.job.update(changes)
                with store.job_lock("job"):
                    self.assertIsNone(acknowledge_recovery(store, "job", TOKEN))
                self.assertEqual(store.ack_count, 0)


class TempTableStore(JobStore):
    """All SQL resolves only session-local tables, never business tables."""
    def __init__(self, conn):
        super().__init__("")
        self.conn = conn

    @contextmanager
    def connect(self):
        with self.conn.transaction():
            yield self.conn

    @contextmanager
    def job_lock(self, job_id):
        acquired = self.conn.execute("SELECT pg_try_advisory_lock(hashtext(%s)) AS acquired", (job_id,)).fetchone()["acquired"]
        try:
            yield SimpleNamespace(acquired=acquired)
        finally:
            if acquired:
                self.conn.execute("SELECT pg_advisory_unlock(hashtext(%s))", (job_id,))

    def record_monitoring_error(self, *args, **kwargs):
        pass


@unittest.skipUnless(os.environ.get("STUDIO_RECOVERY_POSTGRES_TEST") == "1",
                     "requires explicit session-local PostgreSQL test opt-in")
class RecoveryDispatchPostgresTest(unittest.TestCase):
    def setUp(self):
        try:
            self.conn = psycopg.connect(load_settings().database_url, row_factory=dict_row, autocommit=True)
        except Exception:
            self.fail("PostgreSQL test connection unavailable; connection details suppressed")
        self.addCleanup(self.conn.close)
        self.conn.execute("SET search_path TO pg_temp")
        self.conn.execute("""CREATE TEMP TABLE jobs (
            id text PRIMARY KEY, type text NOT NULL DEFAULT 'video.generate',
            external_provider text, status text NOT NULL DEFAULT 'queued',
            bridge_metadata jsonb, queue_phase text, error jsonb, result jsonb,
            progress integer DEFAULT 50, attempts integer DEFAULT 2, max_attempts integer DEFAULT 3,
            user_id text DEFAULT 'synthetic-user', workspace_id text DEFAULT 'synthetic-workspace',
            created_at timestamptz DEFAULT now(), updated_at timestamptz,
            finished_at timestamptz, started_at timestamptz, dispatch_state text,
            dispatch_next_attempt_at timestamptz, worker_retry_at timestamptz
        )""")
        self.job_id = "synthetic-recovery-" + uuid4().hex
        self.store = TempTableStore(self.conn)
        self.conn.execute("INSERT INTO jobs(id,bridge_metadata) VALUES (%s,%s)", (self.job_id, Jsonb({
            RECOVERY_CONTROL_KEY: {"token": TOKEN, "checkpoint_revision": 2},
            "sibling": {"keep": True},
        })))
        checkpoint = VideoCheckpoint(self.store, self.job_id, VIDEO_PROVIDER)
        checkpoint.references = ["original-reference"]
        checkpoint.begin()
        checkpoint.accepted("original-paid-task")
        self.store.mark_video_recovery(self.job_id, attention=True)

    def test_acknowledgement_is_atomic_idempotent_and_preserves_original_task(self):
        before = self.store.get_job(self.job_id)
        with self.store.job_lock(self.job_id):
            self.assertIsNone(acknowledge_recovery(self.store, self.job_id, "2" * 32))
            self.assertEqual(self.store.get_job(self.job_id), before)
            first = acknowledge_recovery(self.store, self.job_id, TOKEN)
            self.assertEqual(first["dispatch_state"], "observed")
            self.assertEqual(first["queue_phase"], "video_recovery_pending")
            original = before["bridge_metadata"][VIDEO_CHECKPOINT_KEY]
            checkpoint = first["bridge_metadata"][VIDEO_CHECKPOINT_KEY]
            self.assertEqual(checkpoint["revision"], original["revision"] + 1)
            self.assertNotIn("recovery", checkpoint)
            for key in ("phase", "provider_identity", "provider_task_id", "reference_keys"):
                self.assertEqual(checkpoint[key], original[key])
            self.assertEqual(first["bridge_metadata"]["sibling"], {"keep": True})
            self.assertEqual(first["attempts"], 2)
            self.store.mark_video_recovery(self.job_id, reason="video_recovery_http_404")
            counted = self.store.get_job(self.job_id)
            duplicate = acknowledge_recovery(self.store, self.job_id, TOKEN)
            self.assertEqual(duplicate, counted)
            self.assertEqual(duplicate["dispatch_next_attempt_at"], first["dispatch_next_attempt_at"])

    def test_recovery_deadline_is_saved_atomically_and_cleared_on_attention(self):
        with self.store.job_lock(self.job_id):
            acknowledge_recovery(self.store, self.job_id, TOKEN)
            for delay in (30, 60):
                saved = self.store.mark_video_recovery(self.job_id, reason="video_recovery_http_404")
                self.assertEqual(saved["recovery_retry_seconds"], delay)
                row = self.store.get_job(self.job_id)
                remaining = (row["worker_retry_at"] - datetime.now(timezone.utc)).total_seconds()
                self.assertGreater(remaining, delay - 5)
                self.assertLessEqual(remaining, delay)
                self.assertEqual(row["attempts"], 2)
            self.store.mark_video_recovery(self.job_id, reason="video_recovery_http_404")
            row = self.store.get_job(self.job_id)
            self.assertEqual(row["queue_phase"], "video_recovery_attention")
            self.assertIsNone(row["worker_retry_at"])

    def test_real_sql_escalates_three_access_failures_without_resetting_window(self):
        with self.store.job_lock(self.job_id):
            acknowledge_recovery(self.store, self.job_id, TOKEN)
            for _ in range(3):
                self.store.mark_video_recovery(self.job_id, reason="video_recovery_http_401")
                acknowledge_recovery(self.store, self.job_id, TOKEN)
        row = self.store.get_job(self.job_id)
        checkpoint = row["bridge_metadata"][VIDEO_CHECKPOINT_KEY]
        self.assertEqual((row["status"], row["queue_phase"], row["attempts"]), ("queued", "video_recovery_attention", 2))
        self.assertEqual(checkpoint["recovery"]["failures"], 3)
        self.assertTrue(checkpoint["recovery"]["requires_attention"])
        self.assertEqual(checkpoint["provider_task_id"], "original-paid-task")
        self.assertEqual(checkpoint["reference_keys"], ["original-reference"])
        self.assertEqual(row["bridge_metadata"]["sibling"], {"keep": True})
        self.assertIsNone(row["finished_at"])

    def test_terminal_and_external_jobs_reject_ack_without_mutation(self):
        for status, external in (("succeeded", ""), ("failed", ""), ("canceled", ""), ("queued", "sd-video")):
            self.conn.execute("UPDATE jobs SET status=%s, external_provider=%s WHERE id=%s", (status, external, self.job_id))
            before = self.store.get_job(self.job_id)
            with self.store.job_lock(self.job_id):
                self.assertIsNone(acknowledge_recovery(self.store, self.job_id, TOKEN))
            self.assertEqual(self.store.get_job(self.job_id), before)

    def test_actual_execute_job_recovers_only_existing_video_with_temp_table(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(tasks, "settings", test_settings(directory)), \
                patch.object(tasks, "JobStore", return_value=self.store), \
                patch.object(tasks, "provider_gate_from_payload", return_value=None), \
                patch.object(video.time, "sleep"), \
                patch.object(tasks, "cleanup_job_inputs"), patch.object(video.requests, "post") as post, \
                patch.object(video.requests, "get", return_value=FakeVideoResponse({}, status_code=404)) as get:
            payload = {"provider": VIDEO_PROVIDER, RECOVERY_ONLY_FIELD: True, RECOVERY_TOKEN_FIELD: TOKEN}
            for delay in (30, 60):
                with self.assertRaisesRegex(RetryCalled, f"countdown={delay}"):
                    tasks.execute_job(FakeTask(0), self.job_id, payload, video.generate_video, "video")
            for _ in range(2):
                result = tasks.execute_job(FakeTask(0), self.job_id, payload, video.generate_video, "video")
                self.assertEqual(result["queue_phase"], "video_recovery_attention")
            self.assertEqual(get.call_count, 3)
            post.assert_not_called()
            self.assertEqual(self.store.get_job(self.job_id)["attempts"], 2)


if __name__ == "__main__":
    unittest.main()
