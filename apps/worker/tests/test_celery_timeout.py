"""Exercise installed Celery request callbacks without starting paid work."""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from billiard.einfo import ExceptionInfo
from billiard.exceptions import TimeLimitExceeded, WorkerLostError
from celery.worker.request import Request

from worker.tasks import celery_app


class CeleryTimeoutTest(unittest.TestCase):
    def request(self, task_name="worker.video_generate"):
        task = celery_app.tasks[task_name]
        backend = Mock()
        self.enterContext(patch.object(task, "_backend", backend))
        self.enterContext(patch("celery.worker.request.error"))
        self.enterContext(patch("celery.worker.request.warn"))
        self.enterContext(patch("celery.worker.request.state.should_terminate", False))
        message = SimpleNamespace(
            headers={"id": "synthetic-timeout", "task": task_name},
            body=([], {}, {}), delivery_info={}, properties={},
        )
        ack, reject = Mock(), Mock()
        req = Request(message, app=celery_app, task=task, decoded=True,
                      on_ack=ack, on_reject=reject)
        return req, ack, reject

    def simulate_failure(self, req, exception):
        try:
            raise exception
        except type(exception):
            req.on_failure(ExceptionInfo(), send_failed_event=False, return_ok=True)

    def test_hard_timeout_does_not_ack_and_requeues_delivery(self):
        for name in ("worker.image_generate", "worker.image_edit", "worker.video_generate", "worker.video_transcode"):
            with self.subTest(task=name):
                req, ack, reject = self.request(name)
                req.on_timeout(soft=False, timeout=60)
                ack.assert_not_called()
                self.simulate_failure(req, TimeLimitExceeded(60))
                ack.assert_not_called()
                self.assertTrue(req.acknowledged)
                reject.assert_called_once()
                self.assertTrue(reject.call_args.args[-1], "timeout delivery must be requeued")

    def test_worker_process_loss_requeues_delivery(self):
        req, ack, reject = self.request()
        self.simulate_failure(req, WorkerLostError("synthetic worker exit"))
        ack.assert_not_called()
        reject.assert_called_once()
        self.assertTrue(reject.call_args.args[-1])

    def test_soft_timeout_keeps_delivery_owned(self):
        req, ack, reject = self.request()
        req.on_timeout(soft=True, timeout=55)
        ack.assert_not_called()
        reject.assert_not_called()

    def test_definitive_task_failure_does_not_create_requeue_loop(self):
        req, ack, reject = self.request()
        self.simulate_failure(req, ValueError("synthetic terminal error"))
        ack.assert_not_called()
        reject.assert_called_once()
        self.assertFalse(reject.call_args.args[-1])


if __name__ == "__main__":
    unittest.main()
