import unittest
import os
from unittest.mock import patch

from test_tasks import FakeStore, FakeTask, RetryCalled
from worker import tasks
from worker.errors import SafeTaskError
from worker.monitoring import attempt_event, safe_detail
from worker.generation_failover import PROVIDER_CANDIDATES_FIELD
from worker.db import JobStore


class MonitoringTest(unittest.TestCase):
    @unittest.skipUnless(os.environ.get("TEST_DATABASE_URL"), "isolated PostgreSQL required")
    def test_attempt_is_durable_in_postgres(self):
        store = JobStore(os.environ["TEST_DATABASE_URL"])
        event = attempt_event({'id': 'monitoring_test', 'user_id': 'owner'}, {}, {'message': 'password=SECRET'}, 10)
        try:
            store.record_monitoring_error(event)
            store.record_monitoring_error(event)
            with store.connect() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT user_id,detail FROM runtime_errors WHERE id=%s", (event['id'],))
                    rows = cur.fetchall()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]['user_id'], 'owner')
            self.assertNotIn('SECRET', rows[0]['detail'])
        finally:
            with store.connect() as conn:
                conn.execute("DELETE FROM runtime_errors WHERE id=%s", (event['id'],))

    def test_secret_redaction_and_limit(self):
        for text in ['Authorization: Bearer SECRET123', '{"api_key":"SECRET123"}',
                     'https://user:SECRET123@host/path?token=SECRET123#SECRET123',
                     'data:image/png;base64,SECRET123', 'sk-SECRET123']:
            self.assertNotIn('SECRET123', safe_detail(text))
        self.assertLessEqual(len(safe_detail('好' * 10000)), 4000)

    def test_event_ownership_correlation_and_unique_attempt_ids(self):
        job = {'id': 'j', 'user_id': 'alice', 'attempts': 2, 'payload': {'request_id': 'req'}}
        payload = {'user_id': 'bob', 'asset_context': {'source_node_id': 'n', 'source_project_id': 'p'}}
        first = attempt_event(job, payload, {'message': 'private diagnostic', 'retryable': True}, 10)
        second = attempt_event(job, payload, {'message': 'x'}, 0)
        self.assertEqual((first['user_id'], first['request_id'], first['node_id'], first['attempt']), ('alice', 'req', 'n', 3))
        self.assertNotEqual(first['id'], second['id'])
        self.assertNotIn('private', first['message'])
        self.assertIn('private', first['detail'])

    def test_retry_diagnostic_persisted_before_private_error_masking(self):
        store = FakeStore()
        events = []
        store.record_monitoring_error = events.append
        payload = {'model': 'test', PROVIDER_CANDIDATES_FIELD: [{'id': 'a', 'model': 'test', 'base_url': 'http://test', 'auth_type': 'none'}]}
        def fail(*args):
            raise SafeTaskError('timeout Authorization: Bearer SECRET123', code='provider_timeout')
        with patch.object(tasks, 'JobStore', return_value=store), patch.object(tasks, 'provider_gate_from_payload', return_value=None):
            with self.assertRaises(RetryCalled):
                tasks.execute_job(FakeTask(retries=0), 'job_123', payload, fail, 'video')
        self.assertEqual(len(events), 1)
        self.assertIn('timeout', events[0]['detail'])
        self.assertNotIn('SECRET123', events[0]['detail'])
        self.assertEqual(store.retry_errors, [{}])

    def test_monitoring_failure_does_not_replace_retry(self):
        store = FakeStore()
        def broken(event):
            raise RuntimeError('db down')
        store.record_monitoring_error = broken
        def fail(*args):
            raise SafeTaskError('timeout')
        with patch.object(tasks, 'JobStore', return_value=store), patch.object(tasks, 'provider_gate_from_payload', return_value=None):
            with self.assertRaises(RetryCalled):
                tasks.execute_job(FakeTask(retries=0), 'job_123', {}, fail, 'video')
        self.assertEqual(len(store.retry_errors), 1)
