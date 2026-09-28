import os
import socket
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import requests

from image_checkpoint_fakes import ImageCheckpointStore
from test_provider import test_settings
from video_checkpoint_fakes import CheckpointStore
from worker import http_security as security, provider, video
from worker.errors import ImageSubmissionUncertainError, VideoSubmissionUncertainError
from worker.image_checkpoint import IMAGE_CHECKPOINT_PAYLOAD_KEY, ImageCheckpoint
from worker.video_checkpoint import VIDEO_CHECKPOINT_PAYLOAD_KEY, VideoCheckpoint


def response(status=200, location=None):
    result = requests.Response()
    result.status_code = status
    result._content = b"result"
    result._content_consumed = True
    if location:
        result.headers["Location"] = location
    return result


class HttpSecurityTest(unittest.TestCase):
    def test_public_transport_error_does_not_expose_signed_query(self):
        with patch.object(security.requests.Session, "get", side_effect=requests.ConnectionError("https://cdn.test/file?signature=private-example")):
            with self.assertRaises(requests.RequestException) as caught:
                security.public_media_get("https://cdn.test/file?signature=private-example", timeout=3)
        self.assertNotIn("signature", str(caught.exception))
        self.assertNotIsInstance(caught.exception, security.HTTPPolicyError)
        self.assertTrue(caught.exception.__suppress_context__)

    def test_authenticated_requests_never_forward_headers_cross_origin(self):
        headers = {"X-Company-Key": "test-secret", "Authorization": "Bearer synthetic", "Cookie": "private=1"}
        for method in ("POST", "GET", "DELETE"):
            for target in ("https://other.test/path", "http://api.test/path", "https://api.test:444/path"):
                with self.subTest(method=method, target=target), patch.object(security.requests, method.lower(), return_value=response(307, target)) as request:
                    with self.assertRaises(security.HTTPPolicyError) as caught:
                        security.provider_request(method, "https://api.test/task", headers=headers, timeout=3)
                    request.assert_called_once()
                    self.assertFalse(request.call_args.kwargs["allow_redirects"])
                    self.assertNotIn("test-secret", str(caught.exception))

    def test_post_is_never_replayed_even_on_same_origin_307(self):
        for status in (307, 308):
            with patch.object(security.requests, "post", return_value=response(status, "/canonical")) as post:
                with self.assertRaises(security.HTTPPolicyError):
                    security.provider_request("POST", "https://api.test/task", json={"paid": True}, timeout=3)
                post.assert_called_once()

    def test_same_origin_303_uses_get_without_reposting_body(self):
        with patch.object(security.requests, "post", return_value=response(303, "/result")) as post, patch.object(security.requests, "get", return_value=response()) as get:
            security.provider_request("POST", "https://api.test/task", json={"prompt": "x"}, files=["private"], headers={"X-Key": "key", "Content-Type": "multipart/form-data"}, timeout=3)
        post.assert_called_once()
        self.assertEqual(get.call_args.args, ("https://api.test/result",))
        self.assertEqual(get.call_args.kwargs["headers"], {"X-Key": "key"})
        self.assertNotIn("json", get.call_args.kwargs)
        self.assertNotIn("files", get.call_args.kwargs)

    def test_same_origin_get_redirect_is_compatible_and_bounded(self):
        with patch.object(security.requests, "get", side_effect=[response(302, "/canonical"), response()]) as get:
            security.provider_request("GET", "https://api.test/task", headers={"X-Key": "key"}, timeout=3)
            self.assertEqual(get.call_count, 2)
            self.assertEqual(get.call_args.kwargs["headers"], {"X-Key": "key"})
        with patch.object(security.requests, "get", return_value=response(302, "/cycle")) as get:
            with self.assertRaises(security.HTTPPolicyError):
                security.provider_request("GET", "https://api.test/task", timeout=3)
            self.assertEqual(get.call_count, security.MAX_MEDIA_REDIRECTS + 1)

    def test_submit_redirect_query_failure_never_becomes_safe_post_retry(self):
        configuration = {"id": "image", "base_url": "https://api.test", "model": "image", "auth_type": "none"}
        for subsequent in (requests.ConnectTimeout("private"), response(429), response(401)):
            store = ImageCheckpointStore()
            with tempfile.TemporaryDirectory() as tmp, patch.object(provider.requests, "post", return_value=response(303, "/receipt")) as post, patch.object(provider.requests, "get", side_effect=[subsequent]):
                for _ in range(2):
                    checkpoint = ImageCheckpoint(store, "job", configuration, test_settings(tmp))
                    with self.assertRaises(ImageSubmissionUncertainError):
                        provider.generate_image("job", {"provider": configuration, IMAGE_CHECKPOINT_PAYLOAD_KEY: checkpoint}, test_settings(tmp), lambda _: None)
                post.assert_called_once()

    def test_content_redirect_uses_new_uncredentialed_request(self):
        with patch.object(security.requests, "get", return_value=response(302, "https://cdn.test/video?key=private&signature=keep")) as get, patch.object(security, "public_media_get", return_value=response()) as download:
            security.provider_request("GET", "https://api.test/content", headers={"X-Key": "private", "Cookie": "private=1"}, timeout=3, stream=True, allow_public_redirect=True, credential_values=("private",))
        get.assert_called_once()
        download.assert_called_once_with("https://cdn.test/video?signature=keep", timeout=3, stream=True, trusted_origins=())

    def test_uncredentialed_session_ignores_proxy_and_netrc(self):
        captured = []

        def send(adapter, prepared, **kwargs):
            captured.append((adapter, prepared, kwargs))
            return response()

        with patch.dict(os.environ, {"HTTPS_PROXY": "http://untrusted-proxy.test", "NETRC": "/nonexistent/private-netrc"}), patch.object(requests.adapters.HTTPAdapter, "send", new=send), patch.object(requests.utils, "get_netrc_auth", side_effect=AssertionError("netrc must not be read")):
            downloaded = security.public_media_get("https://cdn.test/image?signature=keep", timeout=3)
            downloaded.close()
        adapter, prepared, kwargs = captured[0]
        self.assertIsInstance(adapter, security.PinnedMediaAdapter)
        self.assertFalse(adapter.allow_private)
        self.assertNotIn("Authorization", prepared.headers)
        self.assertNotIn("Cookie", prepared.headers)
        self.assertFalse(kwargs["proxies"])
        self.assertTrue(kwargs["verify"])

    def test_public_redirects_revalidate_targets_and_drop_previous_cookies(self):
        first = response(302, "https://cdn2.test/result")
        first.headers["Set-Cookie"] = "private=1"
        with patch.object(security, "_send_public_once", side_effect=[first, response()]) as send:
            security.public_media_get("https://cdn.test/image", timeout=3)
            self.assertEqual(send.call_args_list[1].args, ("https://cdn2.test/result",))
            self.assertNotIn("headers", send.call_args_list[1].kwargs)
        for target in ("http://cdn.test/plain", "http://169.254.169.254/latest/meta-data", "https://user:pass@cdn.test/x"):
            with self.subTest(target=target), patch.object(security, "_send_public_once", return_value=response(302, target)) as send:
                with self.assertRaises(security.HTTPPolicyError):
                    security.public_media_get("https://cdn.test/image", timeout=3)
                send.assert_called_once()

    def connection(self):
        return SimpleNamespace(_dns_host="cdn.test", port=443, timeout=3, socket_options=[])

    def addresses(self, *ips):
        return [(socket.AF_INET6 if ":" in ip else socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (ip, 443)) for ip in ips]

    def test_public_dns_blocks_private_and_mixed_addresses_before_connect(self):
        for ip in ("127.0.0.1", "10.0.0.1", "192.168.1.2", "172.16.1.2", "100.64.0.1", "::1", "fc00::1", "::ffff:127.0.0.1", "169.254.169.254", "100.100.100.200", "168.63.129.16", "fd00:ec2::254"):
            with self.subTest(ip=ip), patch.object(security.socket, "getaddrinfo", return_value=self.addresses("8.8.8.8", ip)), patch.object(security.socket, "socket") as channel:
                with self.assertRaises(security.HTTPPolicyError):
                    security.pinned_socket(self.connection(), False)
                channel.assert_not_called()

    def test_dns_pinning_connects_numeric_address_without_second_resolution(self):
        with patch.object(security.socket, "getaddrinfo", side_effect=[self.addresses("8.8.8.8"), self.addresses("127.0.0.1")]) as dns, patch.object(security.socket, "socket") as factory:
            security.pinned_socket(self.connection(), False)
            dns.assert_called_once()
            factory.return_value.connect.assert_called_once_with(("8.8.8.8", 443))

    def test_admin_private_origin_preserved_but_metadata_always_denied(self):
        with patch.object(security.socket, "getaddrinfo", return_value=self.addresses("10.0.0.1")), patch.object(security.socket, "socket") as factory:
            security.pinned_socket(self.connection(), True)
            factory.return_value.connect.assert_called_once()
        for ip in ("169.254.169.254", "100.100.100.200", "fd00:ec2::254"):
            with patch.object(security.socket, "getaddrinfo", return_value=self.addresses(ip)), patch.object(security.socket, "socket") as factory:
                with self.assertRaises(security.HTTPPolicyError):
                    security.pinned_socket(self.connection(), True)
                factory.assert_not_called()
        with patch.dict(os.environ, {"STUDIO_SUPABASE_URL": "http://nas.test:18000"}):
            trusted = security.trusted_media_origins({"base_url": "http://api.internal:3101/v1"})
        self.assertIn(("http", "nas.test", 18000), trusted)
        self.assertNotIn(("https", "nas.test", 18000), trusted)
        self.assertNotIn(("http", "nas.test", 80), trusted)

    def test_actual_adapter_private_origin_loopback_transfer(self):
        # Actual requests/urllib3/socket path, entirely on container loopback.
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/redirect":
                    self.send_response(302)
                    self.send_header("Location", "http://127.0.0.1:1/private")
                    self.end_headers()
                    return
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"synthetic media")

            def log_message(self, *_):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            url = f"http://127.0.0.1:{server.server_port}/media"
            with security.public_media_get(url, timeout=3, trusted_origins={security.origin(url)}) as downloaded:
                self.assertEqual(downloaded.content, b"synthetic media")
            with self.assertRaises(security.HTTPPolicyError):
                security.public_media_get(url, timeout=3)
            with self.assertRaises(security.HTTPPolicyError):
                security.public_media_get(url.replace("/media", "/redirect"), timeout=3, trusted_origins={security.origin(url)})
        finally:
            server.shutdown()
            server.server_close()
            thread.join(3)

    def test_pinned_https_preserves_hostname_for_tls(self):
        adapter = security.PinnedMediaAdapter()
        connection = adapter.poolmanager.connection_from_url("https://cdn.test/image")._new_conn()
        channel = MagicMock()
        wrapped = SimpleNamespace(socket=channel, is_verified=True)
        with patch.object(security, "pinned_socket", return_value=channel) as connect, patch("urllib3.connection._ssl_wrap_socket_and_match_hostname", return_value=wrapped) as tls:
            connection.connect()
        connect.assert_called_once()
        self.assertEqual(tls.call_args.kwargs["server_hostname"], "cdn.test")
        self.assertEqual(connection.host, "cdn.test")
        adapter.close()

    def test_image_redirect_keeps_checkpoint_uncertain_without_new_post(self):
        configuration = {"id": "image", "base_url": "https://api.test", "model": "image", "auth_type": "custom_header", "custom_auth_header": "X-Key", "api_key": "synthetic"}
        store = ImageCheckpointStore()
        with tempfile.TemporaryDirectory() as tmp, patch.object(provider.requests, "post", return_value=response(307, "https://other.test/task")) as post:
            for _ in range(2):
                checkpoint = ImageCheckpoint(store, "job", configuration, test_settings(tmp))
                with self.assertRaises(ImageSubmissionUncertainError):
                    provider.generate_image("job", {"provider": configuration, IMAGE_CHECKPOINT_PAYLOAD_KEY: checkpoint}, test_settings(tmp), lambda _: None)
            post.assert_called_once()

    def test_video_redirect_keeps_checkpoint_uncertain_without_new_post(self):
        configuration = {"id": "video", "base_url": "https://api.test", "model": "seedance", "auth_type": "none", "video_protocol": "seedance"}
        store = CheckpointStore()
        with tempfile.TemporaryDirectory() as tmp, patch.object(video.requests, "post", return_value=response(307, "https://other.test/task")) as post:
            for _ in range(2):
                checkpoint = VideoCheckpoint(store, "job", configuration)
                with self.assertRaises(VideoSubmissionUncertainError):
                    video.generate_video("job", {"provider": configuration, VIDEO_CHECKPOINT_PAYLOAD_KEY: checkpoint}, test_settings(tmp), lambda _: None)
            post.assert_called_once()

    def test_cancel_redirect_does_not_forward_api_key(self):
        with patch.object(video.requests, "post", return_value=response(307, "https://other.test/cancel")) as post:
            video.cancel_provider_video_task("id", {}, "https://api.test/", {"X-Key": "synthetic"}, 3)
            post.assert_called_once()
