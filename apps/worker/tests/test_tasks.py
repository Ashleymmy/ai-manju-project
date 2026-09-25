import sys
import unittest
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch
from pathlib import Path
from types import SimpleNamespace
from typing import Any


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from worker.errors import SafeTaskError
import worker.tasks as tasks
from worker.tasks import execute_job, extract_request, retry_countdown


class RetryCalled(Exception):
    pass


class FakeRequest:
    def __init__(self, retries: int) -> None:
        self.retries = retries


class FakeTask:
    def __init__(self, retries: int) -> None:
        self.request = FakeRequest(retries)

    def retry(self, exc: BaseException, countdown: int, **_: Any) -> None:
        raise RetryCalled(f"countdown={countdown}")


class FakeLock:
    acquired = True


class FakeStore:
    def __init__(self) -> None:
        self.job = {
            "id": "job_123",
            "status": "queued",
            "user_id": "user_123",
            "workspace_id": "default:user_123",
            "attempts": 0,
            "max_attempts": 3,
        }
        self.retry_errors: list[dict[str, Any]] = []
        self.final_errors: list[dict[str, Any]] = []
        self.results: list[dict[str, Any]] = []
        self.waiting_provider_count = 0

    @contextmanager
    def job_lock(self, job_id: str):
        yield FakeLock()

    def get_job(self, job_id: str) -> dict[str, Any]:
        return self.job

    def mark_running(self, job_id: str, progress: int = 5):
        self.job["status"] = "running"
        return dict(self.job)

    def mark_waiting_provider(self, job_id: str) -> None:
        self.waiting_provider_count += 1

    def update_progress(self, job_id: str, progress: int) -> None:
        self.job["progress"] = progress

    def record_retry(self, job_id: str, error: dict[str, Any]) -> None:
        self.retry_errors.append(error)

    def set_error(self, job_id: str, error: dict[str, Any]) -> None:
        self.final_errors.append(error)

    def set_result(self, job_id: str, result: dict[str, Any]):
        self.results.append(result)
        self.job["status"] = "succeeded"
        return dict(self.job)


class TasksTest(unittest.TestCase):
    def test_upstream_concurrency_wait_does_not_exhaust_generation_attempts(self):
        store = FakeStore()
        store.job.update(created_at=datetime.now(timezone.utc), attempts=2)
        gate = MagicMock()
        gate.acquire.return_value = SimpleNamespace(acquired=True)
        provider = {"base_url": "https://example.test", "model": "image", "auth_type": "none"}
        payload = {"model":"image", "_provider_candidates":[provider]}
        executor = MagicMock(side_effect=SafeTaskError("busy", code="provider_rate_limited", retryable=True, retry_after_seconds=20))
        with patch.object(tasks, "JobStore", return_value=store), patch.object(tasks, "provider_gate_from_payload", return_value=(gate, 3)):
            for _ in range(5):
                with self.assertRaises(RetryCalled):
                    execute_job(FakeTask(10), "job_123", payload, executor, "image")
        self.assertEqual(store.waiting_provider_count, 5)
        self.assertEqual(store.retry_errors, [])
        self.assertEqual(store.final_errors, [])
        self.assertEqual(gate.release.call_count, 5)
        gate.set_cooldown.assert_called_with(20)
        self.assertFalse(tasks.provider_throttle_can_wait({"created_at": datetime.now(timezone.utc)-timedelta(hours=1)}))

    def test_extract_request_matches_go_celery_envelope(self) -> None:
        job_id, payload = extract_request(("job_123",), {"job_id": "job_123", "payload": {"prompt": "x"}})

        self.assertEqual(job_id, "job_123")
        self.assertEqual(payload, {"prompt": "x"})

    def test_extract_request_accepts_ephemeral_provider_kwargs(self) -> None:
        job_id, payload = extract_request(
            ("job_123",),
            {
                "payload": {"prompt": "x"},
                "provider": {"base_url": "https://provider.example", "api_key": "short-lived"},
            },
        )

        self.assertEqual(job_id, "job_123")
        self.assertEqual(payload["provider"]["api_key"], "short-lived")

    def test_extract_request_requires_object_payload(self) -> None:
        with self.assertRaises(SafeTaskError):
            extract_request(("job_123",), {"payload": []})

    def test_retry_countdown_is_bounded(self) -> None:
        self.assertEqual(retry_countdown(0), 1)
        self.assertEqual(retry_countdown(10), 60)

    def test_provider_gate_wait_does_not_consume_real_attempt(self) -> None:
        fake_store = FakeStore()

        class BusyGate:
            def acquire(self, *_: Any) -> Any:
                return SimpleNamespace(acquired=False, retry_after_seconds=3)

        original_store = tasks.JobStore
        original_gate_factory = tasks.provider_gate_from_payload
        tasks.JobStore = lambda database_url: fake_store
        tasks.provider_gate_from_payload = lambda *_: (BusyGate(), 1)
        try:
            with self.assertRaises(RetryCalled):
                execute_job(FakeTask(retries=37), "job_123", {}, lambda *_: self.fail("executor must not run"), asset_type="image")
        finally:
            tasks.JobStore = original_store
            tasks.provider_gate_from_payload = original_gate_factory

        self.assertEqual(fake_store.waiting_provider_count, 1)
        self.assertEqual(fake_store.retry_errors, [])
        self.assertEqual(fake_store.final_errors, [])

    def test_provider_gate_outage_does_not_consume_real_attempt(self) -> None:
        fake_store = FakeStore()

        class BrokenGate:
            def acquire(self, *_: Any) -> Any:
                raise ConnectionError("redis unavailable")

        original_store = tasks.JobStore
        original_gate_factory = tasks.provider_gate_from_payload
        tasks.JobStore = lambda database_url: fake_store
        tasks.provider_gate_from_payload = lambda *_: (BrokenGate(), 1)
        try:
            with self.assertRaises(RetryCalled):
                execute_job(FakeTask(retries=37), "job_123", {}, lambda *_: self.fail("executor must not run"), asset_type="image")
        finally:
            tasks.JobStore = original_store
            tasks.provider_gate_from_payload = original_gate_factory

        self.assertEqual(fake_store.waiting_provider_count, 1)
        self.assertEqual(fake_store.retry_errors, [])
        self.assertEqual(fake_store.final_errors, [])

    def test_cancel_after_provider_acquisition_releases_slot(self) -> None:
        for release_error in (None, ConnectionError("release unavailable")):
            with self.subTest(release_error=release_error):
                store = FakeStore()
                gate = MagicMock()
                gate.acquire.return_value = SimpleNamespace(acquired=True)
                gate.release.side_effect = release_error
                executor = MagicMock()

                def cancel_before_running(*_: Any) -> None:
                    store.job["status"] = "canceled"

                store.mark_running = cancel_before_running
                with patch.object(tasks, "JobStore", return_value=store), patch.object(
                    tasks, "provider_gate_from_payload", return_value=(gate, 1)
                ), patch.object(tasks, "cleanup_job_inputs"):
                    result = execute_job(FakeTask(0), "job_123", {}, executor, "video")

                self.assertEqual(result["status"], "canceled")
                gate.start_heartbeat.assert_called_once_with("job_123")
                gate.release.assert_called_once_with("job_123")
                executor.assert_not_called()
                self.assertEqual(store.final_errors, [])

    def test_cancel_while_waiting_removes_provider_waiter(self) -> None:
        for acquire_error in (None, ConnectionError("acquire unavailable")):
            for cleanup_error in (None, ConnectionError("cleanup unavailable")):
                with self.subTest(acquire_error=acquire_error, cleanup_error=cleanup_error):
                    store = FakeStore()
                    gate = MagicMock()
                    gate.acquire.return_value = SimpleNamespace(acquired=False, retry_after_seconds=1)
                    gate.acquire.side_effect = acquire_error
                    gate.remove_waiter.side_effect = cleanup_error
                    executor = MagicMock()

                    def cancel_while_waiting(*_: Any) -> None:
                        store.job["status"] = "canceled"

                    store.mark_waiting_provider = cancel_while_waiting
                    with patch.object(tasks, "JobStore", return_value=store), patch.object(
                        tasks, "provider_gate_from_payload", return_value=(gate, 1)
                    ), patch.object(tasks, "cleanup_job_inputs"):
                        result = execute_job(FakeTask(0), "job_123", {}, executor, "video")

                    self.assertEqual(result["status"], "canceled")
                    gate.remove_waiter.assert_called_once_with("default:user_123", "job_123")
                    gate.start_heartbeat.assert_not_called()
                    gate.release.assert_not_called()
                    executor.assert_not_called()
                    self.assertEqual(store.retry_errors, [])
                    self.assertEqual(store.final_errors, [])

    def test_startup_failure_releases_slot_without_masking_original_error(self) -> None:
        for stage in ("heartbeat", "mark_running"):
            with self.subTest(stage=stage):
                store = FakeStore()
                gate = MagicMock()
                gate.acquire.return_value = SimpleNamespace(acquired=True)
                gate.release.side_effect = ConnectionError("release unavailable")
                if stage == "heartbeat":
                    gate.start_heartbeat.side_effect = OSError("startup failed")
                else:
                    store.mark_running = MagicMock(side_effect=OSError("startup failed"))
                executor = MagicMock()
                with patch.object(tasks, "JobStore", return_value=store), patch.object(
                    tasks, "provider_gate_from_payload", return_value=(gate, 1)
                ), self.assertRaisesRegex(OSError, "startup failed"):
                    execute_job(FakeTask(0), "job_123", {}, executor, "video")

                gate.release.assert_called_once_with("job_123")
                executor.assert_not_called()
                self.assertEqual(store.final_errors, [])

    def test_execute_job_records_retry_before_celery_retry(self) -> None:
        fake_store = FakeStore()
        cleanup_calls: list[str] = []
        original_store = tasks.JobStore
        original_register = tasks.register_result_assets
        original_cleanup = tasks.cleanup_staged_inputs
        tasks.JobStore = lambda database_url: fake_store
        tasks.register_result_assets = lambda store, job, result, settings, asset_type: result
        tasks.cleanup_staged_inputs = lambda *_: cleanup_calls.append("called") or []
        try:
            with self.assertRaises(RetryCalled):
                execute_job(
                    FakeTask(retries=0),
                    "job_123",
                    {"staged_input_keys": ["jobs/inputs/personal/user_123/batch/file.png"]},
                    lambda *_: (_ for _ in ()).throw(SafeTaskError("temporary failure")),
                    asset_type="image",
                )
        finally:
            tasks.JobStore = original_store
            tasks.register_result_assets = original_register
            tasks.cleanup_staged_inputs = original_cleanup

        self.assertEqual(len(fake_store.retry_errors), 1)
        self.assertEqual(fake_store.retry_errors[0]["code"], "worker_error")
        self.assertEqual(fake_store.final_errors, [])
        self.assertEqual(cleanup_calls, [])

    def test_execute_job_marks_final_failure_after_retries(self) -> None:
        fake_store = FakeStore()
        fake_store.job["attempts"] = 2
        cleanup_calls: list[str] = []
        original_store = tasks.JobStore
        original_register = tasks.register_result_assets
        original_cleanup = tasks.cleanup_staged_inputs
        tasks.JobStore = lambda database_url: fake_store
        tasks.register_result_assets = lambda store, job, result, settings, asset_type: result
        tasks.cleanup_staged_inputs = lambda *_: cleanup_calls.append("called") or []
        try:
            with self.assertRaises(SafeTaskError):
                execute_job(
                    FakeTask(retries=99),
                    "job_123",
                    {"staged_input_keys": ["jobs/inputs/personal/user_123/batch/file.png"]},
                    lambda *_: (_ for _ in ()).throw(SafeTaskError("final failure")),
                    asset_type="image",
                )
        finally:
            tasks.JobStore = original_store
            tasks.register_result_assets = original_register
            tasks.cleanup_staged_inputs = original_cleanup

        self.assertEqual(fake_store.retry_errors, [])
        self.assertEqual(len(fake_store.final_errors), 1)
        self.assertEqual(fake_store.final_errors[0]["message"], "final failure")
        self.assertEqual(cleanup_calls, ["called"])

    def test_execute_job_cleans_staged_inputs_when_already_canceled(self) -> None:
        fake_store = FakeStore()
        fake_store.job["status"] = "canceled"
        cleanup_calls: list[str] = []
        original_store = tasks.JobStore
        original_cleanup = tasks.cleanup_staged_inputs
        tasks.JobStore = lambda database_url: fake_store
        tasks.cleanup_staged_inputs = lambda *_: cleanup_calls.append("called") or []
        try:
            result = execute_job(
                FakeTask(retries=0),
                "job_123",
                {"staged_input_keys": ["jobs/inputs/personal/user_123/batch/file.png"]},
                lambda *_: self.fail("canceled job executor must not run"),
                asset_type="image",
            )
        finally:
            tasks.JobStore = original_store
            tasks.cleanup_staged_inputs = original_cleanup

        self.assertEqual(result, {"job_id": "job_123", "status": "canceled", "skipped": True})
        self.assertEqual(cleanup_calls, ["called"])

    def test_execute_job_stops_when_canceled_during_progress(self) -> None:
        fake_store = FakeStore()
        cleanup_calls: list[str] = []
        executor_completed = False

        def cancel_on_progress(job_id: str, progress: int) -> None:
            del job_id, progress
            fake_store.job["status"] = "canceled"
            return None

        def executor(_job_id: str, _payload: dict[str, Any], _settings: Any, progress: Any) -> dict[str, Any]:
            nonlocal executor_completed
            progress(30)
            executor_completed = True
            return {"outputs": []}

        fake_store.update_progress = cancel_on_progress
        original_store = tasks.JobStore
        original_register = tasks.register_result_assets
        original_cleanup = tasks.cleanup_staged_inputs
        tasks.JobStore = lambda database_url: fake_store
        tasks.register_result_assets = lambda *_: self.fail("canceled task must not register assets")
        tasks.cleanup_staged_inputs = lambda *_: cleanup_calls.append("called") or []
        try:
            result = execute_job(FakeTask(retries=0), "job_123", {}, executor, asset_type="video")
        finally:
            tasks.JobStore = original_store
            tasks.register_result_assets = original_register
            tasks.cleanup_staged_inputs = original_cleanup

        self.assertEqual(result["status"], "canceled")
        self.assertFalse(executor_completed)
        self.assertEqual(fake_store.results, [])
        self.assertEqual(fake_store.final_errors, [])
        self.assertEqual(cleanup_calls, ["called"])

    def test_execute_job_cleans_staged_inputs_only_after_success(self) -> None:
        fake_store = FakeStore()
        cleanup_calls: list[tuple[str, str]] = []
        original_store = tasks.JobStore
        original_register = tasks.register_result_assets
        original_cleanup = tasks.cleanup_staged_inputs
        tasks.JobStore = lambda database_url: fake_store
        tasks.register_result_assets = lambda store, job, result, settings, asset_type: result
        tasks.cleanup_staged_inputs = lambda payload, workspace_id, settings: cleanup_calls.append((payload["staged_input_keys"][0], workspace_id)) or []
        try:
            result = execute_job(
                FakeTask(retries=0),
                "job_123",
                {"staged_input_keys": ["jobs/inputs/personal/user_123/batch/file.png"]},
                lambda job_id, payload, *_: {"workspace": payload["_job_workspace_id"]},
                asset_type="image",
            )
        finally:
            tasks.JobStore = original_store
            tasks.register_result_assets = original_register
            tasks.cleanup_staged_inputs = original_cleanup

        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(cleanup_calls, [("jobs/inputs/personal/user_123/batch/file.png", "default:user_123")])
        self.assertEqual(fake_store.results[0]["workspace"], "default:user_123")

    def test_cleanup_exception_does_not_overwrite_success(self) -> None:
        fake_store = FakeStore()
        original_store = tasks.JobStore
        original_register = tasks.register_result_assets
        original_cleanup = tasks.cleanup_staged_inputs
        tasks.JobStore = lambda database_url: fake_store
        tasks.register_result_assets = lambda store, job, result, settings, asset_type: result
        tasks.cleanup_staged_inputs = lambda *_: (_ for _ in ()).throw(OSError("cleanup failed"))
        try:
            result = execute_job(
                FakeTask(retries=0),
                "job_123",
                {"staged_input_keys": ["jobs/inputs/personal/user_123/batch/file.png"]},
                lambda *_: {"ok": True},
                asset_type="image",
            )
        finally:
            tasks.JobStore = original_store
            tasks.register_result_assets = original_register
            tasks.cleanup_staged_inputs = original_cleanup

        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(fake_store.results, [{"ok": True}])
        self.assertEqual(fake_store.final_errors, [])

    def test_execute_job_converts_registered_asset_datetimes_before_result(self) -> None:
        fake_store = FakeStore()
        original_store = tasks.JobStore
        original_register = tasks.register_result_assets
        original_cleanup = tasks.cleanup_staged_inputs
        timestamp = datetime(2026, 7, 16, 8, 24, 23, tzinfo=timezone.utc)
        tasks.JobStore = lambda database_url: fake_store
        tasks.register_result_assets = lambda *_: {"assets": [{"created_at": timestamp}], "outputs": []}
        tasks.cleanup_staged_inputs = lambda *_: []
        try:
            result = execute_job(
                FakeTask(retries=0),
                "job_123",
                {},
                lambda *_: {"outputs": []},
                asset_type="image",
            )
        finally:
            tasks.JobStore = original_store
            tasks.register_result_assets = original_register
            tasks.cleanup_staged_inputs = original_cleanup

        self.assertEqual(result["result"]["assets"][0]["created_at"], "2026-07-16T08:24:23+00:00")
        self.assertEqual(fake_store.results[0]["assets"][0]["created_at"], "2026-07-16T08:24:23+00:00")


if __name__ == "__main__":
    unittest.main()
