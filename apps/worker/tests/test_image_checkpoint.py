import base64
import json
import os
import tempfile
import traceback
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

import requests
from billiard.exceptions import SoftTimeLimitExceeded

from image_checkpoint_fakes import ImageCheckpointStore
from http_security_fakes import fake_public_send
from test_generation_failover import DurableStore
from test_image_output_validation import png_bytes
from test_provider import FakeProviderResponse, test_settings
from test_tasks import FakeTask, RetryCalled
from worker import provider, tasks
from worker.db import recovery_transition
from worker.errors import ImageRecoveryPendingError, ImageResultRejectedError, ImageSubmissionUncertainError, SafeTaskError
from worker.generation_failover import PROVIDER_CANDIDATES_FIELD
from worker.image_checkpoint import IMAGE_CHECKPOINT_KEY, IMAGE_CHECKPOINT_PAYLOAD_KEY, ImageCheckpoint
from worker.image_requirements import ImageParameterError


class SimulatedHardStop(BaseException):
    pass


class RecoveryStore(DurableStore):
    def __init__(self):
        super().__init__()
        self.job.update(type="image.generate")
        self.checkpoints = ImageCheckpointStore()
        self.recoveries = []

    def get_image_checkpoint(self, job_id):
        self.checkpoints.status = self.job["status"]
        return self.checkpoints.get_image_checkpoint(job_id)

    def save_image_checkpoint(self, job_id, value, expected):
        self.checkpoints.status = self.job["status"]
        return self.checkpoints.save_image_checkpoint(job_id, value, expected)

    def mark_image_recovery(self, job_id, *, uncertain=False, reason="", attention=False, recovered_result=None):
        self.recoveries.append(uncertain)
        checkpoint, error, delay = recovery_transition(self.checkpoints.checkpoint, "image", uncertain=uncertain, reason=reason, attention=attention)
        if recovered_result is not None and not checkpoint.get("result"):
            checkpoint["result"] = recovered_result
        self.checkpoints.checkpoint = checkpoint
        self.job.update(status="queued", queue_phase=error["code"], error=error, bridge_metadata={IMAGE_CHECKPOINT_KEY: checkpoint})
        return {**self.get_job(job_id), "recovery_retry_seconds": delay}


class ImageCheckpointTest(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch("worker.http_security._send_public_once", side_effect=fake_public_send))
        self.provider = {"id": "image-provider", "base_url": "https://api.test/v1", "auth_type": "none", "model": "image"}
        self.payload = {"prompt": "image", "provider": self.provider}

    def deliver(self, store, settings, progress=None):
        payload = {**self.payload, IMAGE_CHECKPOINT_PAYLOAD_KEY: ImageCheckpoint(store, "job", self.provider, settings)}
        return provider.generate_image("job", payload, settings, progress or (lambda _: None))

    def test_intent_and_private_receipt_precede_download(self):
        store = ImageCheckpointStore()
        signed = "https://storage.test/image.png?token=private-signature"

        def post(*_, **kwargs):
            self.assertEqual(store.checkpoint["phase"], "submission_intent")
            self.assertNotIn(IMAGE_CHECKPOINT_PAYLOAD_KEY, kwargs["json"])
            return FakeProviderResponse(body={"data": [{"url": signed}]})

        def get(*_, **kwargs):
            self.assertEqual(store.checkpoint["phase"], "received")
            self.assertNotIn("headers", kwargs)
            self.assertNotIn("auth", kwargs)
            self.assertNotIn(signed, json.dumps(store.checkpoint))
            return FakeProviderResponse(headers={"Content-Type": "image/png"}, content=b"image-bytes")

        with tempfile.TemporaryDirectory() as tmp, patch.object(provider.requests, "post", side_effect=post) as create, patch.object(provider.requests, "get", side_effect=get):
            result = self.deliver(store, test_settings(tmp))
            self.assertEqual(Path(result["outputs"][0]["path"]).read_bytes(), b"image-bytes")
            receipts = list(Path(tmp).glob(".image-checkpoints/*/*.json"))
            self.assertEqual(len(receipts), 1)
            self.assertIn(signed, receipts[0].read_text())
            if os.name != "nt":
                self.assertEqual(receipts[0].stat().st_mode & 0o777, 0o600)
            self.assertNotIn(signed, str(result))
            self.deliver(store, test_settings(tmp))
            create.assert_called_once()
        self.assertEqual(store.checkpoint["phase"], "downloaded")

    def test_database_failure_never_submits(self):
        for failure in ("fail_read", "fail_write"):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as tmp, patch.object(provider.requests, "post") as create:
                store = ImageCheckpointStore()
                setattr(store, failure, True)
                with self.assertRaises(ImageRecoveryPendingError):
                    self.deliver(store, test_settings(tmp))
                create.assert_not_called()
        with tempfile.TemporaryDirectory() as tmp, patch.object(provider.requests, "post") as create:
            with self.assertRaises(ImageRecoveryPendingError):
                provider.generate_image("job", self.payload, test_settings(tmp), lambda _: None)
            create.assert_not_called()

    def test_uncertain_submit_never_reposts_after_redelivery(self):
        cases = (requests.ReadTimeout("private URL"), requests.ConnectionError("private URL"), SoftTimeLimitExceeded(),
                 FakeProviderResponse(status_code=408), FakeProviderResponse(status_code=500), FakeProviderResponse(status_code=503))
        for failure in cases:
            with self.subTest(failure=type(failure).__name__), tempfile.TemporaryDirectory() as tmp:
                store = ImageCheckpointStore()
                kwargs = {"side_effect": failure} if isinstance(failure, BaseException) else {"return_value": failure}
                with patch.object(provider.requests, "post", **kwargs) as create:
                    for _ in range(2):
                        try:
                            self.deliver(store, test_settings(tmp))
                        except ImageSubmissionUncertainError as caught:
                            self.assertNotIn("private URL", "".join(traceback.format_exception(caught)))
                        else:
                            self.fail("uncertain submission should not be accepted")
                    create.assert_called_once()

    def test_hard_loss_during_post_never_reposts(self):
        store = ImageCheckpointStore()
        with tempfile.TemporaryDirectory() as tmp, patch.object(provider.requests, "post", side_effect=SimulatedHardStop) as create:
            with self.assertRaises(SimulatedHardStop):
                self.deliver(store, test_settings(tmp))
            with self.assertRaises(ImageSubmissionUncertainError):
                self.deliver(store, test_settings(tmp))
            create.assert_called_once()

    def test_hard_loss_after_receipt_recovers_without_post(self):
        store = ImageCheckpointStore()
        with tempfile.TemporaryDirectory() as tmp, patch.object(provider.requests, "post", return_value=FakeProviderResponse()) as create:
            with patch.object(provider, "recover_image_receipt", side_effect=SimulatedHardStop):
                with self.assertRaises(SimulatedHardStop):
                    self.deliver(store, test_settings(tmp))
            self.assertEqual(store.checkpoint["phase"], "received")
            result = self.deliver(store, test_settings(tmp))
            self.assertEqual(Path(result["outputs"][0]["path"]).read_bytes(), b"png")
            create.assert_called_once()

    def test_receipt_survives_database_failure_after_response(self):
        store = ImageCheckpointStore()

        def post(*_, **__):
            store.fail_write = True
            return FakeProviderResponse()

        with tempfile.TemporaryDirectory() as tmp, patch.object(provider.requests, "post", side_effect=post) as create:
            with self.assertRaises(ImageRecoveryPendingError):
                self.deliver(store, test_settings(tmp))
            self.assertEqual(store.checkpoint["phase"], "submission_intent")
            store.fail_write = False
            result = self.deliver(store, test_settings(tmp))
            self.assertEqual(Path(result["outputs"][0]["path"]).read_bytes(), b"png")
            create.assert_called_once()

    def test_explicit_rejection_or_connect_timeout_can_retry(self):
        for initial in (requests.ConnectTimeout(), FakeProviderResponse(status_code=429)):
            with self.subTest(initial=type(initial).__name__), tempfile.TemporaryDirectory() as tmp:
                store = ImageCheckpointStore()
                with patch.object(provider.requests, "post", side_effect=[initial, FakeProviderResponse()]) as create:
                    with self.assertRaises(SafeTaskError) as caught:
                        self.deliver(store, test_settings(tmp))
                    self.assertTrue(caught.exception.retryable)
                    self.assertEqual(store.checkpoint["phase"], "rejected")
                    self.deliver(store, test_settings(tmp))
                    self.assertEqual(create.call_count, 2)

    def test_preflight_validation_never_writes_intent(self):
        store = ImageCheckpointStore()
        self.provider.update(protocol="openai_chat_completions")
        self.payload.update(size="1024x1024", quality="high", asset_registration={"source_type": "canvas"})
        with tempfile.TemporaryDirectory() as tmp, patch.object(provider.requests, "post") as create:
            with self.assertRaises(ImageParameterError):
                self.deliver(store, test_settings(tmp))
            create.assert_not_called()
        self.assertEqual(store.checkpoint, {})

    def test_failed_download_recovers_only_get_and_missing_receipt_never_posts(self):
        store = ImageCheckpointStore()
        with tempfile.TemporaryDirectory() as tmp, patch.object(provider.requests, "post", return_value=FakeProviderResponse(body={"data": [{"url": "https://cdn.test/result?token=private"}]})) as create:
            with patch.object(provider.requests, "get", side_effect=requests.ConnectionError("signed URL")):
                try:
                    self.deliver(store, test_settings(tmp))
                except ImageRecoveryPendingError as exc:
                    self.assertNotIn("signed URL", "".join(traceback.format_exception(exc)))
                else:
                    self.fail("download failure should be recoverable")
            with patch.object(provider.requests, "get", return_value=FakeProviderResponse(headers={"Content-Type": "image/png"}, content=b"image")) as get:
                result = self.deliver(store, test_settings(tmp))
                get.assert_called_once()
            Path(result["outputs"][0]["path"]).unlink()
            for receipt in Path(tmp).glob(".image-checkpoints/*/*.json"):
                receipt.unlink()
            with self.assertRaises(ImageRecoveryPendingError):
                self.deliver(store, test_settings(tmp))
            create.assert_called_once()

    def test_same_size_corrupt_cache_is_restored_from_receipt(self):
        store = ImageCheckpointStore()
        with tempfile.TemporaryDirectory() as tmp, patch.object(provider.requests, "post", return_value=FakeProviderResponse()) as create:
            result = self.deliver(store, test_settings(tmp))
            path = Path(result["outputs"][0]["path"])
            path.write_bytes(b"bad")
            self.deliver(store, test_settings(tmp))
            self.assertEqual(path.read_bytes(), b"png")
            create.assert_called_once()

    def test_changed_identity_and_concurrent_stale_revision_never_post(self):
        store = ImageCheckpointStore()
        with tempfile.TemporaryDirectory() as tmp, patch.object(provider.requests, "post") as create:
            settings = test_settings(tmp)
            one = ImageCheckpoint(store, "job", self.provider, settings)
            two = ImageCheckpoint(store, "job", self.provider, settings)
            one.begin()
            with self.assertRaises(ImageRecoveryPendingError):
                two.begin()
            self.provider["id"] = "another"
            with self.assertRaises(ImageSubmissionUncertainError):
                self.deliver(store, settings)
            create.assert_not_called()

    def test_cancel_race_keeps_canceled_state(self):
        store = ImageCheckpointStore()

        def post(*_, **__):
            store.status = "canceled"
            return FakeProviderResponse()

        with tempfile.TemporaryDirectory() as tmp, patch.object(provider.requests, "post", side_effect=post) as create:
            with self.assertRaises(SafeTaskError) as caught:
                self.deliver(store, test_settings(tmp))
            self.assertEqual(caught.exception.code, "job_canceled")
            create.assert_called_once()

    def task_context(self, tmp, store):
        stack = ExitStack()
        stack.enter_context(patch.object(tasks, "settings", test_settings(tmp)))
        stack.enter_context(patch.object(tasks, "JobStore", return_value=store))
        stack.enter_context(patch.object(tasks, "provider_gate_from_payload", return_value=None))
        self.cleanup = stack.enter_context(patch.object(tasks, "cleanup_job_inputs"))
        return stack

    def task_deliver(self, store):
        payload = {**self.payload, PROVIDER_CANDIDATES_FIELD: [self.provider, {**self.provider, "id": "fallback"}], "staged_input_keys": ["input"]}
        return tasks.execute_job(FakeTask(99), "job", payload, provider.generate_image, "image")

    def test_uncertain_keeps_inputs_attempts_and_original_job_without_failover(self):
        store = RecoveryStore()
        with tempfile.TemporaryDirectory() as tmp, self.task_context(tmp, store), patch.object(provider.requests, "post", side_effect=requests.ReadTimeout()) as create:
            for _ in range(2):
                result = self.task_deliver(store)
                self.assertEqual(result["queue_phase"], "image_submission_uncertain")
            create.assert_called_once()
            self.cleanup.assert_not_called()
            self.assertEqual(store.retry_errors, [])
            self.assertEqual(store.final_errors, [])
            self.assertEqual(store.job["attempts"], 0)
            self.assertEqual(store.job["status"], "queued")

    def test_import_or_result_database_failure_recovers_without_generation(self):
        for failing in ("import", "set_result", "result_not_saved"):
            with self.subTest(failing=failing), tempfile.TemporaryDirectory() as tmp:
                store = RecoveryStore()
                with self.task_context(tmp, store), patch.object(provider.requests, "post", return_value=FakeProviderResponse()) as create:
                    if failing == "import":
                        failure = patch.object(tasks, "register_result_assets", side_effect=ConnectionError("assets unavailable"))
                    elif failing == "result_not_saved":
                        failure = patch.object(store, "set_result", return_value=None)
                    else:
                        failure = patch.object(store, "set_result", side_effect=ConnectionError("database unavailable"))
                    with patch.object(tasks, "register_result_assets", side_effect=lambda _s, _j, result, *_: result), failure:
                        with self.assertRaises(RetryCalled):
                            self.task_deliver(store)
                    self.cleanup.assert_not_called()
                    self.assertEqual(store.job["queue_phase"], "image_recovery_pending")
                    self.assertEqual(store.job["attempts"], 0)
                    with patch.object(tasks, "register_result_assets", side_effect=lambda _s, _j, result, *_: result):
                        self.assertEqual(self.task_deliver(store)["status"], "succeeded")
                    create.assert_called_once()

    def test_definite_wrong_dimensions_fail_normally_without_recovery(self):
        store = RecoveryStore()
        self.payload.update(size="1024x1024", asset_registration={"source_type": "canvas"})
        generated = FakeProviderResponse(body={"data": [{"b64_json": base64.b64encode(png_bytes(512, 512)).decode()}]})
        with tempfile.TemporaryDirectory() as tmp, self.task_context(tmp, store), patch.object(provider.requests, "post", return_value=generated) as create:
            with self.assertRaises(ImageParameterError):
                self.task_deliver(store)
            self.assertEqual(store.job["status"], "failed")
            self.assertEqual(store.final_errors[0]["code"], "image_output_size_mismatch")
            self.assertEqual(store.recoveries, [])
            self.assertEqual(store.checkpoints.checkpoint["phase"], "terminal_failure")
            self.task_deliver(store)
            create.assert_called_once()

    def test_definite_bad_output_never_restarts_generation(self):
        store = ImageCheckpointStore()
        with tempfile.TemporaryDirectory() as tmp, patch.object(provider.requests, "post", return_value=FakeProviderResponse(body={"data": [{"b64_json": "invalid-b64"}]})) as create:
            for _ in range(2):
                with self.assertRaises(ImageResultRejectedError):
                    self.deliver(store, test_settings(tmp))
            create.assert_called_once()

    def test_queue_envelope_drops_forged_checkpoint(self):
        _, payload = tasks.extract_request(("job",), {"payload": {IMAGE_CHECKPOINT_PAYLOAD_KEY: {"phase": "downloaded"}, "prompt": "x"}})
        self.assertEqual(payload, {"prompt": "x"})
