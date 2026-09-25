import unittest
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

from worker.db import JobStore


class JobLifecycleQueriesTest(unittest.TestCase):
    def test_progress_and_terminal_updates_do_not_transfer_input_media(self):
        store = JobStore("unused")
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.fetchone.return_value = {"id": "job_media", "status": "running", "progress": 50, "attempts": 0}
        connection = MagicMock()
        connection.cursor.return_value = cursor

        @contextmanager
        def connect():
            yield connection

        actions = (
            lambda: store.mark_running("job_media"),
            lambda: store.mark_waiting_provider("job_media"),
            lambda: store.update_progress("job_media", 50),
            lambda: store.record_retry("job_media", {}),
            lambda: store.set_result("job_media", {"outputs": []}),
            lambda: store.set_error("job_media", {"code": "test"}),
        )
        with patch.object(store, "connect", side_effect=connect):
            for action in actions:
                with self.subTest(action=action):
                    result = action()
                    self.assertEqual(result["id"], "job_media")
                    sql, parameters = cursor.execute.call_args.args
                    projection = sql.split("RETURNING", 1)[1]
                    self.assertNotIn("*", projection)
                    self.assertNotIn("payload", projection)
                    self.assertIn("status", projection)
                    self.assertIn("job_media", parameters)
