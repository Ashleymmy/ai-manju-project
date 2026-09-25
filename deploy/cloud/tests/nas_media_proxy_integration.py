"""真实 Nginx + 隔离 HTTPS 假 NAS；不连接云端，不读取任何业务凭据。

运行：python -B deploy/cloud/tests/nas_media_proxy_integration.py
使用本机已有 studio-beta-web:20260911 / studio-beta-worker:20260911 镜像，禁止拉取。
独立集成入口，不纳入只需 Python 的 test_*.py 单元测试发现范围。
"""

import base64
import hashlib
import hmac
import json
import os
import re
from pathlib import Path
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import uuid
from urllib.parse import parse_qs, urlsplit


CONFIG = Path(__file__).resolve().parents[1] / "studio.nas-media.nginx.conf"
PREFIX = "/storage/v1/object/sign/studio-test-assets/"
SDVIDEO_BUCKETS = tuple(f"studio-sdvideo-test-{kind}" for kind in ("inputs", "results", "thumbnails", "volcano"))
SECRET = b"isolated-fixture-only-not-a-deployment-secret"
BODY = b"media-proxy-byte-range-fixture-0123456789"
WEB_IMAGE = os.environ.get("NAS_PROXY_TEST_WEB_IMAGE", "studio-beta-web:20260911")
WORKER_IMAGE = os.environ.get("NAS_PROXY_TEST_WORKER_IMAGE", "studio-beta-worker:20260911")


def b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def signed_path(key="personal/u1/image.png", expires=60, bucket="studio-test-assets"):
    prefix = f"/storage/v1/object/sign/{bucket}/"
    header = b64(b'{"alg":"HS256","typ":"JWT"}')
    payload = b64(json.dumps({"url": prefix + key, "exp": time.time() + expires}).encode())
    unsigned = f"{header}.{payload}"
    signature = b64(hmac.new(SECRET, unsigned.encode(), hashlib.sha256).digest())
    return prefix + key + "?token=" + unsigned + "." + signature


def run_origin():
    from datetime import datetime, timedelta, timezone
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    fixture = Path("/fixtures")
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "sd.ggwp.cn")])
    now = datetime.now(timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
            .public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(minutes=1)).not_valid_after(now + timedelta(hours=1))
            .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
            .add_extension(x509.SubjectAlternativeName([x509.DNSName("sd.ggwp.cn")]), critical=False)
            .sign(key, hashes.SHA256()))
    (fixture / "key.pem").write_bytes(key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    (fixture / "ca.pem").write_bytes(cert.public_bytes(serialization.Encoding.PEM))

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def reply(self, status, body=b"", headers=None):
            self.send_response(status)
            for name, value in (headers or {}).items():
                self.send_header(name, value)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def do_GET(self):
            path = urlsplit(self.path)
            if self.server.server_port == 3101 and not path.path.startswith("/storage/"):
                self.reply(200, json.dumps({"path": path.path, "authorization": self.headers.get("Authorization")}).encode())
                return
            with (fixture / "requests.jsonl").open("a", encoding="utf-8") as stream:
                stream.write(json.dumps({"path": path.path, "headers": dict(self.headers)}) + "\n")
            try:
                token = parse_qs(path.query)["token"][0]
                header, payload, signature = token.split(".")
                expected = b64(hmac.new(SECRET, f"{header}.{payload}".encode(), hashlib.sha256).digest())
                claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
                valid = (hmac.compare_digest(signature, expected) and claims["exp"] > time.time()
                         and claims["url"] == path.path)
            except (KeyError, ValueError):
                valid = False
            if not valid:
                self.reply(403, b"signature rejected")
                return
            if path.path.endswith("redirect.mp4"):
                self.reply(307, headers={"Location": "https://sd.ggwp.cn:18000" + self.path})
                return
            if path.path.endswith("missing.png"):
                self.reply(404, b"missing")
                return
            content_type = "video/mp4" if path.path.endswith(".mp4") else "image/png"
            if path.path.endswith(".html"):
                content_type = "text/html"
            if path.path.endswith(".svg"):
                content_type = "image/svg+xml"
            headers = {"Content-Type": content_type, "ETag": '"fixture-v1"', "Accept-Ranges": "bytes",
                       "Cache-Control": "public, max-age=99999", "Set-Cookie": "nas-cookie=unwanted",
                       "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Credentials": "true",
                       "Content-Disposition": 'inline; filename="fixture.png"'}
            if path.path.endswith("accel.png"):
                headers["X-Accel-Redirect"] = "/api/should-not-run"
            if self.headers.get("If-None-Match") == '"fixture-v1"':
                self.reply(304, headers=headers)
                return
            body = BODY * (128 * 1024) if path.path.endswith("large.mp4") else BODY
            requested_range = self.headers.get("Range", "")
            # Reproduce the NAS suffix-range defect; the proxy must translate it.
            if requested_range.startswith("bytes=-"):
                if self.server.server_port == 3101:
                    # Fake the API adapter; Go tests exercise its real HEAD/GET calls.
                    count = min(int(requested_range[7:]), len(body))
                    headers["Content-Range"] = f"bytes {len(body)-count}-{len(body)-1}/{len(body)}"
                    self.reply(206, body[-count:], headers)
                else:
                    self.reply(500, b"unsupported suffix range")
                return
            match = re.fullmatch(r"bytes=(\d+)-(\d*)", requested_range)
            if match:
                start = int(match[1])
                end = min(int(match[2]) if match[2] else len(body) - 1, len(body) - 1)
                if start >= len(body):
                    self.reply(416, headers={"Content-Range": f"bytes */{len(body)}"})
                    return
                headers["Content-Range"] = f"bytes {start}-{end}/{len(body)}"
                self.reply(206, body[start:end + 1], headers)
                return
            self.reply(200, body, headers)

        do_HEAD = do_GET

    plain = ThreadingHTTPServer(("0.0.0.0", 3101), Handler)
    threading.Thread(target=plain.serve_forever, daemon=True).start()
    secure = ThreadingHTTPServer(("0.0.0.0", 18000), Handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(fixture / "ca.pem", fixture / "key.pem")
    secure.socket = context.wrap_socket(secure.socket, server_side=True)
    (fixture / "ready").touch()
    secure.serve_forever()


class NasMediaProxyTests(unittest.TestCase):
    @classmethod
    def docker(cls, *args, check=True):
        result = subprocess.run(["docker", *args], capture_output=True, text=True, timeout=45)
        if check and result.returncode:
            raise RuntimeError(f"Docker command failed: {result.stderr[:1200]}")
        return result.stdout.strip()

    @classmethod
    def setUpClass(cls):
        cls.containers = []
        cls.tokens = []
        cls.network = "studio-nas-proxy-test-" + uuid.uuid4().hex[:10]
        cls.temp = tempfile.TemporaryDirectory(prefix="studio-nas-proxy-test-")
        cls.fixture = Path(cls.temp.name)
        cls.addClassCleanup(cls.cleanup)
        for image in (WEB_IMAGE, WORKER_IMAGE):
            cls.docker("image", "inspect", image)
        cls.docker("network", "create", "--internal", cls.network)
        origin = cls.origin = cls.network + "-origin"
        cls.containers.append(origin)
        cls.docker("run", "-d", "--pull=never", "--name", origin, "--user", "0:0",
                   "--network", cls.network, "--network-alias", "sd.ggwp.cn", "--network-alias", "api",
                   "--mount", f"type=bind,source={Path(__file__).resolve()},target=/nas-test/tests/test.py,readonly",
                   "--mount", f"type=bind,source={cls.fixture},target=/fixtures",
                   "--entrypoint", "python", WORKER_IMAGE, "-B", "/nas-test/tests/test.py", "--origin")
        deadline = time.monotonic() + 20
        while not (cls.fixture / "ready").exists():
            if time.monotonic() > deadline:
                logs = subprocess.run(["docker", "logs", origin], capture_output=True, text=True, timeout=15)
                raise RuntimeError("Mock HTTPS origin startup failed: " + logs.stdout + logs.stderr)
            time.sleep(0.1)
        cls.web, cls.endpoint = cls.start_web("web", CONFIG)

    @classmethod
    def start_web(cls, suffix, config, trust=True):
        name = cls.network + "-" + suffix
        cls.containers.append(name)
        args = ["run", "-d", "--pull=never", "--name", name, "--network", cls.network, "--mount",
                f"type=bind,source={config},target=/etc/nginx/conf.d/default.conf,readonly"]
        if trust:
            args += ["--mount", f"type=bind,source={cls.fixture / 'ca.pem'},target=/etc/ssl/certs/ca-certificates.crt,readonly"]
        cls.docker(*args, "--entrypoint", "nginx", WEB_IMAGE, "-g", "daemon off;")
        deadline = time.monotonic() + 15
        while True:
            try:
                if cls.request("/health", endpoint=name)[0] == 200:
                    break
            except (OSError, RuntimeError):
                pass
            if time.monotonic() > deadline:
                raise RuntimeError("Test Nginx startup failed: " + cls.docker("logs", name))
            time.sleep(0.1)
        cls.docker("exec", name, "nginx", "-t")
        return name, name

    @classmethod
    def cleanup(cls):
        for name in reversed(cls.containers):
            cls.docker("rm", "-f", name, check=False)
        cls.docker("network", "rm", cls.network, check=False)
        cls.temp.cleanup()

    @classmethod
    def request(cls, path, method="GET", headers=None, endpoint=None):
        if "?token=" in path:
            cls.tokens.append(path.split("?token=", 1)[1].split("&", 1)[0])
        # 在 internal 网络内请求，避免为测试开放宿主机端口或公网出口。
        client = (
            "import base64,http.client,json,sys; "
            "r=json.load(sys.stdin); c=http.client.HTTPConnection(r['host'],3100,timeout=8); "
            "c.request(r['method'],r['path'],headers=r['headers']); s=c.getresponse(); "
            "print(json.dumps([s.status,dict((k.lower(),v) for k,v in s.getheaders()),"
            "base64.b64encode(s.read()).decode()])); c.close()"
        )
        request = json.dumps({"host": endpoint or cls.endpoint, "path": path,
                              "method": method, "headers": headers or {}})
        result = subprocess.run(["docker", "exec", "-i", cls.origin, "python", "-B", "-c", client],
                                input=request, capture_output=True, text=True, timeout=15)
        if result.returncode:
            raise RuntimeError("Isolated HTTP client failed: " + result.stderr[-400:])
        status, response_headers, body = json.loads(result.stdout)
        return status, response_headers, base64.b64decode(body)

    def test_suffix_range_translates_nas_failure(self):
        path = signed_path("personal/user_a/reference.mp4")
        for requested, expected in [("bytes=-6", BODY[-6:]), ("bytes=-999999", BODY)]:
            with self.subTest(requested=requested):
                status, headers, body = self.request(path, headers={"Range": requested})
                self.assertEqual(status, 206)
                self.assertEqual(body, expected)
                self.assertEqual(headers.get("content-length"), str(len(expected)))
        expired = signed_path("personal/user_a/reference.mp4", expires=-1)
        self.assertEqual(self.request(expired, headers={"Range": "bytes=-6"})[0], 403)

    def test_suffix_range_reads_large_file_tail(self):
        source = BODY * (128 * 1024)
        for length in (65536, 400000):
            status, headers, body = self.request(signed_path("personal/u1/large.mp4"), headers={"Range": f"bytes=-{length}"})
            self.assertEqual(status, 206)
            self.assertEqual(body, source[-length:])
            self.assertEqual(headers["content-range"], f"bytes {len(source)-length}-{len(source)-1}/{len(source)}")

    def test_01_existing_routes_are_unchanged(self):
        base = CONFIG.parents[2] / "apps/studio/nginx.conf"
        marker = "    location = /health {"
        self.assertEqual(base.read_text(encoding="utf-8").split(marker, 1)[1],
                         CONFIG.read_text(encoding="utf-8").split(marker, 1)[1])
        for path in ("/", "/chat", "/assets", "/director-desk/"):
            self.assertEqual(self.request(path)[0], 200)
        status, _, data = self.request("/api/probe", headers={"Authorization": "Bearer studio-fixture"})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(data)["authorization"], "Bearer studio-fixture")

    def test_02_get_head_range_and_conditional(self):
        path = signed_path("personal/u1/video.mp4")
        status, headers, body = self.request(path)
        self.assertEqual((status, body), (200, BODY))
        self.assertEqual(headers["content-type"], "video/mp4")
        status, headers, body = self.request(path, "HEAD")
        self.assertEqual((status, body, headers["content-length"]), (200, b"", str(len(BODY))))
        status, headers, body = self.request(path, headers={"Range": "bytes=2-7", "If-Range": '"fixture-v1"'})
        self.assertEqual((status, body), (206, BODY[2:8]))
        self.assertEqual(headers["content-range"], f"bytes 2-7/{len(BODY)}")
        self.assertEqual(self.request(path, headers={"If-None-Match": '"fixture-v1"'})[0], 304)

    def test_03_nas_still_validates_signature_and_expiration(self):
        self.assertEqual(self.request(signed_path(expires=-60))[0], 403)
        path = signed_path()
        token = path.rsplit(".", 1)[1]
        forged = path.rsplit(".", 1)[0] + "." + ("A" if token[0] != "A" else "B") + token[1:]
        self.assertEqual(self.request(forged)[0], 403)
        self.assertEqual(self.request(path.replace("image.png", "another.png"))[0], 403)
        self.assertEqual(self.request(signed_path("team/w1/missing.png"))[0], 404)

    def test_03_sdvideo_buckets_require_their_own_valid_signatures(self):
        for bucket in SDVIDEO_BUCKETS:
            with self.subTest(bucket=bucket):
                path = signed_path("inputs/personal/u1/reference.png", bucket=bucket)
                status, headers, body = self.request(path)
                self.assertEqual((status, body), (200, BODY))
                personal_path = signed_path("inputs/default:u1/reference.png", bucket=bucket)
                self.assertEqual(self.request(personal_path)[0], 200)
                encoded_personal_path = signed_path("inputs/default%3Au1/reference.png", bucket=bucket)
                self.assertEqual(self.request(encoded_personal_path)[0], 200)
                self.assertEqual(headers["cache-control"], "private, no-store")
                status, headers, body = self.request(path, "HEAD")
                self.assertEqual((status, body, headers["content-length"]), (200, b"", str(len(BODY))))
                self.assertEqual(self.request(path, headers={"Range": "bytes=2-7"})[2], BODY[2:8])
                self.assertEqual(self.request(path.split("?", 1)[0])[0], 404)
                self.assertEqual(self.request(path, "PUT")[0], 405)
                self.assertEqual(self.request(signed_path(bucket=bucket, expires=-60))[0], 403)
                self.assertEqual(self.request(path.replace(bucket, "studio-test-assets"))[0], 403)

    def test_04_rejects_writes_and_noncanonical_paths(self):
        path = signed_path()
        for method in ("POST", "PUT", "PATCH", "DELETE"):
            self.assertEqual(self.request(path, method)[0], 405)
        invalid = [path.split("?", 1)[0], path + "&token=duplicate", path + "&download=1",
                   path.replace("studio-test-assets", "old-bucket"), path.replace("object/sign", "object/public"),
                   path.replace("studio-test-assets", "studio-sdvideo-test-other"),
                   path.replace("studio-test-assets", "studio-sdvideo-test-inputs-extra"),
                   path.replace("studio-test-assets", "studio-sdvideo-production-inputs"),
                   path.replace("personal/", "personal/../"), path.replace("personal/", "personal/%2e%2e/"),
                   path.replace("personal/", "personal%2f"), path.replace("personal/", "personal//"),
                   path.replace("personal/", "personal/%252e%252e/"), "/storage/../api/probe",
                   "/storage/v1/bucket", "/storage/v1/object/authenticated/studio-test-assets/x"]
        for index, target in enumerate(invalid):
            with self.subTest(case=index):
                self.assertEqual(self.request(target)[0], 404)

    def test_05_does_not_forward_browser_credentials_or_origin_headers(self):
        status, headers, _ = self.request(signed_path(), headers={
            "Authorization": "Bearer studio-secret-fixture", "Cookie": "session=studio-secret-fixture",
            "apikey": "studio-apikey-fixture", "X-Forwarded-For": "192.0.2.42",
            "Referer": "https://studio.clouddo.cc/?token=referrer-fixture", "Origin": "https://evil.invalid"})
        self.assertEqual(status, 200)
        record = json.loads((self.fixture / "requests.jsonl").read_text().splitlines()[-1])
        forwarded = {key.lower(): value for key, value in record["headers"].items()}
        for key in ("authorization", "cookie", "apikey", "x-forwarded-for", "referer", "origin"):
            self.assertNotIn(key, forwarded)
        for key in ("set-cookie", "access-control-allow-credentials", "access-control-allow-origin"):
            self.assertNotIn(key, headers)

    def test_06_read_only_cors_and_no_cache(self):
        for origin in ("https://studio.clouddo.cc", "http://studio.clouddo.cc", "http://47.103.211.217"):
            status, headers, body = self.request(signed_path(), "OPTIONS", {"Origin": origin})
            self.assertEqual((status, body), (204, b""))
            self.assertEqual(headers["access-control-allow-origin"], origin)
            self.assertEqual(headers["access-control-allow-methods"], "GET, HEAD, OPTIONS")
        _, headers, _ = self.request(signed_path())
        self.assertEqual(headers["cache-control"], "private, no-store")
        self.assertEqual(headers["referrer-policy"], "no-referrer")

    def test_07_untrusted_html_svg_cannot_execute_on_studio_origin(self):
        for extension in ("html", "svg"):
            status, headers, _ = self.request(signed_path("personal/u1/untrusted." + extension))
            self.assertEqual(status, 200)
            self.assertEqual(headers["content-disposition"], "attachment")
            self.assertEqual(headers["x-content-type-options"], "nosniff")
            self.assertTrue(headers["content-security-policy"].startswith("sandbox;"))

    def test_08_does_not_follow_redirects_or_accel_headers(self):
        status, headers, _ = self.request(signed_path("personal/u1/redirect.mp4"))
        self.assertEqual(status, 502)
        self.assertNotIn("location", headers)
        self.assertEqual(self.request(signed_path("personal/u1/accel.png"))[2], BODY)

    def test_09_rejects_untrusted_tls_and_wrong_hostname(self):
        _, endpoint = self.start_web("untrusted", CONFIG, trust=False)
        self.assertEqual(self.request(signed_path(), endpoint=endpoint)[0], 502)
        wrong_name = self.fixture / "wrong-name.conf"
        wrong_name.write_text(CONFIG.read_text(encoding="utf-8").replace(
            "proxy_ssl_name sd.ggwp.cn;", "proxy_ssl_name wrong.invalid;"), encoding="utf-8")
        _, endpoint = self.start_web("wrong-name", wrong_name)
        self.assertEqual(self.request(signed_path(), endpoint=endpoint)[0], 502)

    def test_10_nas_dns_failure_does_not_block_studio_startup(self):
        offline = self.fixture / "offline.conf"
        offline.write_text(CONFIG.read_text(encoding="utf-8").replace(
            "set $nas_media_host sd.ggwp.cn:18000;", "set $nas_media_host offline.invalid:18000;"), encoding="utf-8")
        _, endpoint = self.start_web("offline", offline)
        self.assertEqual(self.request("/chat", endpoint=endpoint)[0], 200)
        self.assertEqual(self.request(signed_path(), endpoint=endpoint)[0], 502)

    def test_11_signed_queries_and_credentials_are_not_in_nginx_logs(self):
        for name in self.containers[1:]:
            result = subprocess.run(["docker", "logs", name], capture_output=True, text=True, timeout=15)
            logs = result.stdout + result.stderr
            self.assertFalse(any(token in logs for token in self.tokens), "signature leaked in log")
            self.assertNotIn("studio-secret-fixture", logs)
            self.assertNotIn("referrer-fixture", logs)
            self.assertIn('"status":', logs)


if __name__ == "__main__":
    if sys.argv[1:] == ["--origin"]:
        run_origin()
    else:
        unittest.main(verbosity=2)
