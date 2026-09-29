import unittest
import os
import socket
from unittest.mock import patch
from types import SimpleNamespace
import requests
import httpx

from test_tasks import FakeStore, FakeTask, RetryCalled
from worker import tasks
from worker.errors import SafeTaskError, ImageSubmissionUncertainError
from worker.monitoring import attempt_event, safe_detail, reset_request_diagnostic, begin_provider_request, observe_provider_response, observe_failed_response, error_body, MAX_ERROR_RESPONSE_BYTES
from worker.http_security import provider_request, public_media_get, pinned_socket
from worker.supabase_storage import SupabaseStorage
from worker.generation_failover import PROVIDER_CANDIDATES_FIELD
from worker.db import JobStore


class MonitoringTest(unittest.TestCase):
    def setUp(self):
        reset_request_diagnostic()

    def test_real_upstream_http_failure_and_async_error_are_recorded(self):
        for status in (422, 200):
            begin_provider_request('POST', 'https://host/generate?token=SECRET')
            observe_provider_response(SimpleNamespace(status_code=status, headers={'content-type': 'application/json', 'X-Request-ID': 'vendor-id'}, text='{"status":"failed","error":{"code":"bad_audio","message":"audio too long"},"prompt":"PRIVATE","output":"MEDIA"}'))
            event = attempt_event({'id': 'j'}, {}, {}, 2500, SafeTaskError('generation failed'))
            self.assertEqual(event['provider_status'], status)
            self.assertEqual(event['diagnostics']['provider_request_id'], 'vendor-id')
            self.assertEqual(event['diagnostics']['provider_code'], 'bad_audio')
            self.assertIn('audio too long', event['diagnostics']['provider_body'])
            self.assertNotIn('PRIVATE', str(event))
            self.assertNotIn('MEDIA', str(event))
            self.assertNotIn('SECRET', str(event))

    def test_http200_vendor_envelopes_and_validation_locations(self):
        for headers in ({'content-type': 'application/json'}, {}):
            begin_provider_request('POST', 'https://host/generate')
            observe_provider_response(SimpleNamespace(status_code=200, headers=headers, text='{"success":false,"Response":{"Error":{"Code":422,"Message":"真实拒绝"},"RequestId":"vendor-id"},"detail":[{"loc":["body","audio",0],"ctx":{"le":30},"input":"PRIVATE"}]}'))
            event = attempt_event({}, {}, {}, 10, SafeTaskError('failed'))
            self.assertEqual(event['provider_status'], 200)
            self.assertEqual(event['diagnostics']['provider_code'], '422')
            self.assertEqual(event['diagnostics']['provider_request_id'], 'vendor-id')
            self.assertIn('真实拒绝', event['diagnostics']['provider_body'])
            self.assertIn('"loc": ["body", "audio", 0]', event['diagnostics']['provider_body'])
            self.assertIn('"le": 30', event['diagnostics']['provider_body'])
            self.assertNotIn('PRIVATE', str(event))

    def test_hidden_exception_chain_preserves_actual_storage_transport(self):
        request = httpx.Request('POST', 'https://storage/object?token=SECRET')
        begin_provider_request('POST', 'https://provider/generate')
        observe_provider_response(SimpleNamespace(status_code=200, headers={}, text='{}'))
        try:
            try:
                raise httpx.ConnectError('actual TLS certificate verification failed', request=request)
            except httpx.HTTPError:
                raise SafeTaskError('Storage upload unavailable') from None
        except SafeTaskError as exc:
            event = attempt_event({}, {}, {}, 10, exc)
        diagnostic = event['diagnostics']
        self.assertEqual(diagnostic['provider_url'], 'https://storage/object')
        self.assertFalse(diagnostic['provider_response_received'])
        self.assertEqual(event['provider_status'], 0)
        self.assertEqual(diagnostic['exception_name'], 'ConnectError')
        self.assertIn('actual TLS certificate verification failed', diagnostic['stack'])
        self.assertIn('Storage upload unavailable', diagnostic['stack'])
        self.assertNotIn('SECRET', str(event))

    def test_public_media_transport_is_not_replaced_by_generic_message(self):
        with patch('worker.http_security.requests.Session.get', side_effect=requests.ConnectionError('actual media DNS failure https://host/file?token=SECRET')):
            try:
                public_media_get('https://host/file?token=SECRET', timeout=1)
            except requests.RequestException as exc:
                self.assertEqual(str(exc), 'media download connection failed')
                event = attempt_event({}, {}, {}, 10, exc)
        self.assertIn('actual media DNS failure', event['diagnostics']['exception_message'])
        self.assertIn('actual media DNS failure', event['diagnostics']['stack'])
        self.assertFalse(event['diagnostics']['provider_response_received'])
        self.assertNotIn('SECRET', str(event))

    def test_pinned_socket_retains_actual_os_cause_after_address_attempts(self):
        connection = SimpleNamespace(_dns_host='cdn.test', port=443, timeout=1, socket_options=[])
        addresses = [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, '', ('8.8.8.8', 443))]
        with patch('worker.http_security.socket.getaddrinfo', return_value=addresses), patch('worker.http_security.socket.socket') as factory:
            factory.return_value.connect.side_effect = OSError(111, 'Connection refused')
            try:
                pinned_socket(connection, False)
            except Exception as exc:
                event = attempt_event({}, {}, {}, 10, exc)
        self.assertIn('Connection refused', event['diagnostics']['exception_message'])
        self.assertIn('Connection refused', event['diagnostics']['stack'])
        factory.return_value.close.assert_called_once()

    def test_discarded_error_stream_is_bounded_and_preserves_real_body(self):
        class ErrorStream:
            status_code = 403
            headers = {'x-request-id': 'cdn-id'}
            total = 0
            def iter_content(self, chunk_size):
                while True:
                    self.total += chunk_size
                    yield b'x' * chunk_size
        response = ErrorStream()
        begin_provider_request('GET', 'https://cdn/result')
        observe_failed_response(response, streamed=True)
        self.assertEqual(response.total, MAX_ERROR_RESPONSE_BYTES)
        event = attempt_event({}, {}, {}, 10, SafeTaskError('download rejected'))
        self.assertEqual(event['provider_status'], 403)
        self.assertEqual(event['diagnostics']['provider_request_id'], 'cdn-id')
        self.assertLessEqual(len(event['diagnostics']['provider_body']), 4000)

    def test_storage_http_failure_captures_unread_stream_before_generic_error(self):
        with httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(403, headers={'x-request-id': 'storage-id'}, json={'error': 'actual bucket permission denied', 'token': 'SECRET'}))) as client:
            with client.stream('GET', 'https://storage/object') as response:
                try:
                    SupabaseStorage._check(response)
                except SafeTaskError as exc:
                    event = attempt_event({}, {}, {}, 10, exc)
        self.assertEqual(event['provider_status'], 403)
        self.assertEqual(event['diagnostics']['provider_request_id'], 'storage-id')
        self.assertIn('actual bucket permission denied', event['diagnostics']['provider_body'])
        self.assertNotIn('SECRET', str(event))

    def test_read_failure_does_not_erase_received_headers_or_inherit_another_attempt(self):
        request = httpx.Request('GET', 'https://storage/object')
        begin_provider_request('GET', str(request.url))
        observe_provider_response(SimpleNamespace(status_code=200, headers={'x-request-id': 'read-id'}), streamed=True)
        event = attempt_event({}, {}, {}, 10, httpx.ReadError('actual peer reset', request=request))
        self.assertEqual(event['provider_status'], 200)
        self.assertEqual(event['diagnostics']['provider_request_id'], 'read-id')
        reset_request_diagnostic()
        event = attempt_event({}, {}, {}, 10, ValueError('local parsing failed'))
        self.assertEqual(event['provider_status'], 0)
        self.assertNotIn('provider_request_id', event['diagnostics'])

    def test_wrapped_transport_failure_preserves_original_cause(self):
        try:
            with patch('worker.http_security.requests.post', side_effect=requests.ConnectionError('DNS lookup failed https://host/path?token=SECRET')):
                try:
                    provider_request('POST', 'https://host/path')
                except requests.RequestException:
                    raise SafeTaskError('provider unavailable') from None
        except SafeTaskError as exc:
            event = attempt_event({}, {}, {}, 30, exc)
        self.assertEqual(event['diagnostics']['exception_name'], 'ConnectionError')
        self.assertIn('DNS lookup failed', event['diagnostics']['exception_message'])
        self.assertFalse(event['diagnostics']['provider_response_received'])
        self.assertEqual(event['provider_status'], 0)
        self.assertNotIn('SECRET', str(event))

    def test_observer_does_not_consume_success_media_or_break_requests(self):
        class Unreadable:
            status_code = 502
            headers = {}
            @property
            def text(self):
                raise RuntimeError('read failed')
        begin_provider_request('GET', 'https://host/result')
        observe_provider_response(Unreadable())
        event = attempt_event({}, {}, {}, 10, SafeTaskError('failed'))
        self.assertEqual(event['provider_status'], 502)
        self.assertNotIn('provider_body', event['diagnostics'])
        reset_request_diagnostic()
        begin_provider_request('GET', 'https://host/result')
        observe_provider_response(SimpleNamespace(status_code=200, headers={'content-type': 'application/json'}, text='{"data":"PRIVATE_MEDIA","output":{"b64_json":"PRIVATE_MEDIA"}}'))
        self.assertNotIn('PRIVATE_MEDIA', str(attempt_event({}, {}, {}, 10, SafeTaskError('save failed'))))
        self.assertEqual(error_body('{"data":["PRIVATE_MEDIA"],"output":"PRIVATE_MEDIA"}'), '')
        self.assertEqual(error_body('{"prompt":"PRIVATE","error":'), '')
        for raw in ('{"msg":"actual rejection"}', '{"Response":{"Error":{"Message":"actual rejection"}}}', '{"errorMessage":"actual rejection"}'):
            self.assertIn('actual rejection', error_body(raw))

    @unittest.skipUnless(os.environ.get("TEST_DATABASE_URL"), "isolated PostgreSQL required")
    def test_attempt_is_durable_in_postgres(self):
        store = JobStore(os.environ["TEST_DATABASE_URL"])
        begin_provider_request('POST', 'https://host/generate?token=SECRET')
        observe_provider_response(SimpleNamespace(status_code=422, headers={'x-request-id': 'vendor-id'}, text='{"error":{"message":"real failure"}}'))
        event = attempt_event({'id': 'monitoring_test', 'user_id': 'owner'}, {}, {'message': 'password=SECRET'}, 10, SafeTaskError('failed'))
        try:
            store.record_monitoring_error(event)
            store.record_monitoring_error(event)
            with store.connect() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT user_id,detail,diagnostics,provider_status FROM runtime_errors WHERE id=%s", (event['id'],))
                    rows = cur.fetchall()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]['user_id'], 'owner')
            self.assertNotIn('SECRET', rows[0]['detail'])
            self.assertEqual(rows[0]['provider_status'], 422)
            self.assertEqual(rows[0]['diagnostics']['provider_request_id'], 'vendor-id')
            self.assertIn('real failure', rows[0]['diagnostics']['provider_body'])
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

    def test_uncertain_submission_records_failure_before_recovery_return(self):
        store = FakeStore()
        events = []
        store.record_monitoring_error = events.append
        store.mark_image_recovery = lambda *args, **kwargs: {'queue_phase': 'image_submission_uncertain'}
        def fail(*args):
            raise ImageSubmissionUncertainError('connection lost after submit', code='image_submission_uncertain')
        with patch.object(tasks, 'JobStore', return_value=store), patch.object(tasks, 'provider_gate_from_payload', return_value=None):
            result = tasks.execute_job(FakeTask(retries=0), 'job_123', {}, fail, 'image')
        self.assertEqual(result['queue_phase'], 'image_submission_uncertain')
        self.assertEqual(len(events), 1)
        self.assertIn('connection lost after submit', events[0]['diagnostics']['exception_message'])
        self.assertEqual(store.retry_errors, [])
        self.assertEqual(store.final_errors, [])
