import sys
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import Response
from worker import app, object_storage


class WorkerHealthTest(unittest.TestCase):
    def test_unresponsive_celery_is_not_healthy(self):
        for healthy in (False, True):
            with patch.object(app, "settings", replace(app.settings, database_url="")), \
                 patch.object(app, "queue_depth", return_value=0), \
                 patch.object(object_storage, "probe"), \
                 patch.object(app, "celery_ready", return_value=healthy):
                response = Response()
                result = app.health(response)
            self.assertEqual(response.status_code, 200 if healthy else 503)
            self.assertIs(result["checks"]["celery"], healthy)

    def test_only_this_container_pong_is_accepted(self):
        for reply, expected in ((None, False), ({"another-worker": {"ok": "pong"}}, False),
                                ({app.worker_name(): {"ok": "pong"}}, True)):
            with patch.object(app, "Celery") as factory:
                client = factory.return_value.__enter__.return_value
                client.control.inspect.return_value.ping.return_value = reply
                self.assertIs(app.celery_ready(), expected)
                client.control.inspect.assert_called_once_with(
                    destination=[app.worker_name()], timeout=app.CELERY_PROBE_TIMEOUT_SECONDS)

    def test_probe_exception_is_not_leaked(self):
        with patch.object(app, "Celery", side_effect=RuntimeError("secret")):
            self.assertFalse(app.celery_ready())


if __name__ == "__main__":
    unittest.main()
