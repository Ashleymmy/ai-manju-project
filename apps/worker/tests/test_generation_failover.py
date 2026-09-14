import unittest
from unittest.mock import patch

from billiard.exceptions import SoftTimeLimitExceeded

from test_tasks import FakeStore, FakeTask, RetryCalled
from worker import tasks
from worker.errors import SafeTaskError
from worker.generation_failover import PROVIDER_CANDIDATES_FIELD


class DurableStore(FakeStore):
    def get_job(self, job_id):
        return dict(self.job)

    def record_retry(self, job_id, error):
        super().record_retry(job_id, error)
        self.job.update(status="queued", attempts=self.job["attempts"] + 1)
        return self.get_job(job_id)

    def set_error(self, job_id, error):
        super().set_error(job_id, error)
        self.job.update(status="failed", attempts=self.job["attempts"] + 1)
        return self.get_job(job_id)

    def set_result(self, job_id, result):
        super().set_result(job_id, result)
        self.job["status"] = "succeeded"
        return self.get_job(job_id)


class GenerationFailoverTest(unittest.TestCase):
    def setUp(self):
        self.store = DurableStore()
        self.providers = [{"id": name, "model": "gpt-image-2", "base_url": "http://local.test", "auth_type": "none"} for name in ("a", "b")]
        self.payload = {"model": "gpt-image-2", PROVIDER_CANDIDATES_FIELD: self.providers, "staged_input_keys": ["input"]}
        self.calls = []
        self.gates = []
        for name, replacement in (
            ("JobStore", lambda _: self.store),
            ("cleanup_staged_inputs", lambda *_: []),
            ("provider_gate_from_payload", self.gate),
            ("register_result_assets", lambda _store, _job, result, *_: result),
        ):
            patcher = patch.object(tasks, name, side_effect=replacement)
            setattr(self, name, patcher.start())
            self.addCleanup(patcher.stop)

    def gate(self, payload, *_):
        from types import SimpleNamespace
        name = payload["provider"]["id"]
        return SimpleNamespace(
            acquire=lambda *_: SimpleNamespace(acquired=True),
            start_heartbeat=lambda *_: self.gates.append((name, "acquire")),
            release=lambda *_: self.gates.append((name, "release")),
            remove_waiter=lambda *_: None,
            set_cooldown=lambda *_: None,
        ), 1

    def executor(self, succeed_at=None, exc=None):
        def execute(_id, payload, _settings, progress):
            self.assertNotIn(PROVIDER_CANDIDATES_FIELD, payload)
            self.assertEqual(payload["model"], payload["provider"]["model"])
            self.calls.append(payload["provider"]["id"])
            if len(self.calls) == succeed_at:
                return {"outputs": [{"path": "result.png"}]}
            raise exc or SafeTaskError("private supplier secret", code="provider_bad_request", retryable=False)
        return execute

    def deliver(self, execute):
        return tasks.execute_job(FakeTask(retries=99), "job_123", self.payload, execute, "image")

    def test_each_supplier_gets_three_attempts_and_failures_stay_private(self):
        execute = self.executor()
        for _ in range(5):
            with self.assertRaises(RetryCalled):
                self.deliver(execute)
            self.assertEqual(self.store.final_errors, [])
            self.cleanup_staged_inputs.assert_not_called()
        with self.assertRaisesRegex(SafeTaskError, "当前模型暂时不可用"):
            self.deliver(execute)
        self.assertEqual(self.calls, ["a", "a", "a", "b", "b", "b"])
        self.assertEqual(self.store.retry_errors, [{}] * 5)
        self.assertNotIn("secret", str(self.store.final_errors))
        self.assertEqual(self.gates, [(name, action) for name in self.calls for action in ("acquire", "release")])
        self.cleanup_staged_inputs.assert_called_once()
        self.register_result_assets.assert_not_called()
        # A duplicate Celery delivery cannot restart an exhausted generation.
        self.assertTrue(self.deliver(execute)["skipped"])
        self.assertEqual(len(self.calls), 6)

    def test_success_on_next_supplier_stops_immediately_and_registers_once(self):
        execute = self.executor(succeed_at=4)
        for _ in range(3):
            with self.assertRaises(RetryCalled):
                self.deliver(execute)
        self.assertEqual(self.deliver(execute)["status"], "succeeded")
        self.assertEqual(self.calls, ["a", "a", "a", "b"])
        self.register_result_assets.assert_called_once()
        self.assertEqual(self.store.final_errors, [])
        self.assertTrue(self.deliver(execute)["skipped"])
        self.register_result_assets.assert_called_once()

    def test_success_on_first_attempt_does_not_try_others(self):
        self.assertEqual(self.deliver(self.executor(succeed_at=1))["status"], "succeeded")
        self.assertEqual(self.calls, ["a"])
        self.assertEqual(self.store.retry_errors, [])

    def test_real_celery_retry_keeps_server_candidates_between_deliveries(self):
        with patch.object(tasks, "generate_image", side_effect=self.executor(succeed_at=4)):
            result = tasks.image_generate.apply(kwargs={
                "job_id": "job_123", "payload": {"model": "gpt-image-2"},
                "provider": self.providers[0], "provider_candidates": self.providers,
            }).get()
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(self.calls, ["a", "a", "a", "b"])
        self.register_result_assets.assert_called_once()

    def test_timeout_consumes_one_attempt_and_can_fail_over(self):
        self.store.job["attempts"] = 2
        with self.assertRaises(RetryCalled):
            self.deliver(self.executor(exc=SoftTimeLimitExceeded()))
        self.assertEqual(self.deliver(self.executor(succeed_at=2))["status"], "succeeded")
        self.assertEqual(self.calls, ["a", "b"])

    def test_cancel_during_retry_stops_before_another_supplier_call(self):
        with self.assertRaises(RetryCalled):
            self.deliver(self.executor())
        self.store.job["status"] = "canceled"
        self.assertEqual(self.deliver(self.executor())["status"], "canceled")
        self.assertEqual(self.calls, ["a"])
        self.assertEqual(self.store.final_errors, [])

    def test_asset_write_failure_does_not_repeat_successful_generation(self):
        self.register_result_assets.side_effect = OSError("disk full")
        with self.assertRaisesRegex(SafeTaskError, "任务处理失败"):
            self.deliver(self.executor(succeed_at=1))
        self.assertEqual(self.calls, ["a"])
        self.assertEqual(self.store.retry_errors, [])

    def test_slot_wait_on_second_supplier_does_not_consume_attempt(self):
        from types import SimpleNamespace
        self.store.job["attempts"] = 3
        self.provider_gate_from_payload.side_effect = lambda *_: (SimpleNamespace(acquire=lambda *_: SimpleNamespace(acquired=False, retry_after_seconds=1)), 1)
        with self.assertRaises(RetryCalled):
            self.deliver(self.executor())
        self.assertEqual(self.store.job["attempts"], 3)
        self.assertEqual(self.calls, [])
        self.assertEqual(self.store.retry_errors, [])

    def test_user_payload_cannot_override_server_candidates(self):
        _, payload = tasks.extract_request((), {"job_id": "job_123", "payload": {
            "provider": {"api_key": "user"}, "provider_candidates": ["user"], PROVIDER_CANDIDATES_FIELD: ["user"],
        }, "provider": self.providers[0], "provider_candidates": self.providers})
        self.assertEqual(payload[PROVIDER_CANDIDATES_FIELD], self.providers)
        self.assertEqual(payload["provider"], self.providers[0])
        _, untrusted = tasks.extract_request(("job_123",), {"payload": {PROVIDER_CANDIDATES_FIELD: self.providers}})
        self.assertNotIn(PROVIDER_CANDIDATES_FIELD, untrusted)
