import sys
import unittest
from contextlib import contextmanager
from datetime import datetime, timezone
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

    def mark_running(self, job_id: str, progress: int = 5) -> None:
        self.job["status"] = "running"

    def mark_waiting_provider(self, job_id: str) -> None:
        self.waiting_provider_count += 1

    def update_progress(self, job_id: str, progress: int) -> None:
        self.job["progress"] = progress

    def record_retry(self, job_id: str, error: dict[str, Any]) -> None:
        self.retry_errors.append(error)

    def set_error(self, job_id: str, error: dict[str, Any]) -> None:
        self.final_errors.append(error)

    def set_result(self, job_id: str, result: dict[str, Any]) -> None:
        self.results.append(result)


class TasksTest(unittest.TestCase):
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
