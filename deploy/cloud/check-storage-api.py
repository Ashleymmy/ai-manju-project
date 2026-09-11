"""在全新本机容器中验证真实 Storage API；不读取 .env、不访问生产或旧业务。"""
from __future__ import annotations

import asyncio
import importlib.util
import ipaddress
import json
import os
import secrets
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import httpx
import jwt
import psycopg
from psycopg import sql
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ed25519, rsa
from cryptography.x509.oid import NameOID

ROOT = Path(__file__).resolve().parents[2]
STORAGE_IMAGE = "supabase/storage-api@sha256:86487b496499561225c1f79c546645421890125539a8d9e00da45dee0a834314"
DATABASE_IMAGE = "postgres@sha256:e013e867e712fec275706a6c51c966f0bb0c93cfa8f51000f85a15f9865a28cb"
LABEL = "studio.storage-api-test"
BUCKETS = ["studio-sdvideo-test-" + kind for kind in ("inputs", "results", "thumbnails", "volcano")]


def docker(*args):
    result = subprocess.run(["docker", *args], capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise RuntimeError("Docker operation failed: " + args[0])
    return result.stdout.strip()


def wait_for(check, limit=60):
    deadline = time.monotonic() + limit
    while time.monotonic() < deadline:
        try:
            if check():
                return
        except (OSError, httpx.HTTPError, psycopg.OperationalError):
            pass
        time.sleep(0.25)
    raise RuntimeError("Isolated Storage startup check timed out")


def issuer_module():
    spec = importlib.util.spec_from_file_location("storage_issuer", Path(__file__).with_name("storage-token.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def tls_proxy(upstream, directory):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "storage-api-test")])
    now = datetime.now(timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(minutes=1))
            .not_valid_after(now+timedelta(hours=1))
            .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]), critical=False)
            .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True).sign(key, hashes.SHA256()))
    cert_file, key_file = directory / "test-ca.pem", directory / "test-tls.key"
    cert_file.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_file.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))

    class Proxy(BaseHTTPRequestHandler):
        def log_message(self, *_):
            # 日志不记录签名查询字符串或 Authorization。
            return

        def handle_request(self):
            if not self.path.startswith("/storage/v1/"):
                self.send_error(404)
                return
            body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            headers = {name: value for name, value in self.headers.items() if name.lower() not in {"host", "connection", "content-length"}}
            headers["Accept-Encoding"] = "identity"
            with httpx.Client(trust_env=False, timeout=10, follow_redirects=False) as client:
                response = client.request(self.command, self.server.upstream + self.path.removeprefix("/storage/v1"), headers=headers, content=body)
            self.send_response(response.status_code)
            for name, value in response.headers.items():
                if name.lower() not in {"connection", "transfer-encoding", "content-encoding"}:
                    self.send_header(name, value)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(response.content)

        do_GET = do_HEAD = do_POST = do_DELETE = do_PUT = handle_request

    server = ThreadingHTTPServer(("127.0.0.1", 0), Proxy)
    server.upstream = upstream
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert_file, key_file)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, cert_file, f"https://127.0.0.1:{server.server_port}"


def main():
    issuer = issuer_module()
    run_id = "studio-storage-api-" + uuid.uuid4().hex[:10]
    containers = []
    network = volume = None
    proxy = None
    with tempfile.TemporaryDirectory(prefix="studio-storage-api-") as temporary:
        directory = Path(temporary)
        db_password = secrets.token_urlsafe(24)
        signing_key = ed25519.Ed25519PrivateKey.generate()
        legacy_test_secret = secrets.token_urlsafe(48)
        kid = "isolated-storage-key"
        subject = str(uuid.uuid4())
        try:
            # Docker 29 的 internal 网络不发布宿主端口；测试桥仅绑定 loopback，不接业务网络。
            network = docker("network", "create", "--label", LABEL+"=true", run_id)
            volume = docker("volume", "create", "--label", LABEL+"=true", run_id+"-objects")
            database = docker("run", "-d", "--name", run_id+"-db", "--label", LABEL+"=true", "--network", network,
                              "--network-alias", "db", "-e", "POSTGRES_DB=storage_api_test", "-e", "POSTGRES_PASSWORD="+db_password,
                              "--tmpfs", "/var/lib/postgresql/data:rw,size=268435456", "-p", "127.0.0.1::5432", DATABASE_IMAGE)
            containers.append(database)
            port = docker("port", database, "5432/tcp").split(":")[-1]
            dsn = f"postgresql://postgres:{db_password}@127.0.0.1:{port}/storage_api_test"
            def database_ready():
                with psycopg.connect(dsn, connect_timeout=2):
                    return True
            wait_for(database_ready)
            print("PASS: fresh isolated PostgreSQL started", flush=True)
            # API 官方迁移自行建立真实 Storage schema，不用最小表替代。
            storage_env = directory / "storage.env"
            storage_env.write_text("\n".join([
                "DATABASE_URL=postgresql://postgres:"+db_password+"@db:5432/storage_api_test",
                "AUTH_JWT_SECRET="+legacy_test_secret, "JWT_JWKS="+json.dumps(issuer.public_jwks(signing_key, kid)),
                "DB_INSTALL_ROLES=true", "DB_SUPER_USER=supabase_storage_admin", "DB_MIGRATIONS_STRATEGY=on_request",
                "STORAGE_BACKEND=file", "FILE_STORAGE_BACKEND_PATH=/var/lib/storage", "REGION=test", "GLOBAL_S3_BUCKET=test",
                "TENANT_ID=storage-api-test", "FILE_SIZE_LIMIT=10485760", "LOG_LEVEL=error", "PORT=5000",
            ]), encoding="utf-8")
            storage = docker("run", "-d", "--name", run_id+"-storage", "--label", LABEL+"=true", "--network", network,
                             "--env-file", str(storage_env), "--mount", f"type=volume,source={volume},target=/var/lib/storage",
                             "-p", "127.0.0.1::5000", STORAGE_IMAGE)
            containers.append(storage)
            port = docker("port", storage, "5000/tcp").split(":")[-1]
            upstream = f"http://127.0.0.1:{port}"
            service = jwt.encode({"role":"service_role", "exp":int(time.time())+600}, legacy_test_secret, algorithm="HS256")
            with httpx.Client(trust_env=False, timeout=5) as client:
                wait_for(lambda: client.get(upstream+"/bucket", headers={"Authorization":"Bearer "+service}).status_code == 200)
            print("PASS: official Storage API v1.48.26 migrations and startup", flush=True)
            with psycopg.connect(dsn, autocommit=True) as connection:
                connection.execute(Path(__file__).with_name("storage-isolation.sql").read_text(encoding="utf-8"))
                # fixture 使用新建的旧桶同名容器，仅验证兼容；不读取任何旧环境数据。
                connection.execute("INSERT INTO storage.buckets(id,name,public) VALUES ('old-fixture','old-fixture',false)")
                connection.execute("CREATE POLICY old_fixture_open ON storage.objects TO PUBLIC USING(true) WITH CHECK(true)")
                # 模拟既有 Supabase 的连接角色；实际请求不能继续借 postgres 超级用户权限。
                connection.execute(sql.SQL("ALTER ROLE supabase_storage_admin LOGIN PASSWORD {}").format(sql.Literal(db_password)))
                connection.execute("GRANT anon, authenticated, service_role TO supabase_storage_admin")
            docker("rm", "-f", storage)
            containers.remove(storage)
            storage_env.write_text(storage_env.read_text(encoding="utf-8").replace("postgresql://postgres:", "postgresql://supabase_storage_admin:"), encoding="utf-8")
            storage = docker("run", "-d", "--name", run_id+"-storage", "--label", LABEL+"=true", "--network", network,
                             "--env-file", str(storage_env), "--mount", f"type=volume,source={volume},target=/var/lib/storage",
                             "-p", "127.0.0.1::5000", STORAGE_IMAGE)
            containers.append(storage)
            upstream = "http://127.0.0.1:"+docker("port", storage, "5000/tcp").split(":")[-1]
            with httpx.Client(trust_env=False, timeout=5) as client:
                wait_for(lambda: client.get(upstream+"/bucket", headers={"Authorization":"Bearer "+service}).status_code == 200)
            print("PASS: runtime database connection uses supabase_storage_admin", flush=True)
            proxy, ca, origin = tls_proxy(upstream, directory)
            token_file = directory / "studio-token"
            video_token_file = directory / "sdvideo-token"
            issuer.atomic_token(token_file, issuer.mint(signing_key, kid, subject, "studio_storage_service", ["studio-test-assets"]))
            issuer.atomic_token(video_token_file, issuer.mint(signing_key, kid, subject, "sdvideo_storage_service", BUCKETS))
            os.environ.update({"SDVIDEO_LOAD_ENV_FILE":"false", "STUDIO_SUPABASE_URL":origin, "STUDIO_SUPABASE_BUCKET":"studio-test-assets",
                "STUDIO_SUPABASE_STORAGE_TOKEN_FILE":str(token_file), "STUDIO_SUPABASE_API_KEY_FILE":"", "STUDIO_SUPABASE_API_KEY":"",
                "STUDIO_SUPABASE_CA_FILE":str(ca)})
            sys.path.insert(0, str(ROOT / "apps/sd-video/api"))
            sys.path.insert(0, str(ROOT / "apps/worker"))
            from app.config import settings
            from app.storage.supabase import SupabaseStorageAdapter
            from worker.supabase_storage import SupabaseStorage
            settings.SUPABASE_URL = settings.SUPABASE_PUBLIC_URL = origin
            settings.SUPABASE_STORAGE_TOKEN_FILE, settings.SUPABASE_CA_FILE = str(video_token_file), str(ca)
            settings.SUPABASE_API_KEY = settings.SUPABASE_API_KEY_FILE = ""
            for kind, bucket in zip(("INPUT", "RESULT", "THUMBNAIL", "VOLCANO"), BUCKETS):
                setattr(settings, "SUPABASE_"+kind+"_BUCKET", bucket)
            worker = SupabaseStorage()
            source = directory / "payload.bin"
            source.write_bytes(b"real-storage-roundtrip")
            worker_key = "personal/"+subject+"/payload.bin"
            worker.upload(worker_key, source, "application/octet-stream")
            worker.upload(worker_key, source, "application/octet-stream")
            target = directory / "download.bin"
            worker.download(worker_key, target, 1024)
            assert target.read_bytes() == source.read_bytes()
            worker.probe()
            print("PASS: Studio Worker TLS/private bucket/CRUD/idempotent upload", flush=True)

            async def check_video():
                adapter = SupabaseStorageAdapter()
                await adapter.probe()
                for prefix in ("inputs", "results", "thumbnails", "volcano"):
                    key = prefix+"/"+subject+"/payload.bin"
                    await adapter.put(key, source.read_bytes(), "application/octet-stream")
                    await adapter.put(key, source.read_bytes(), "application/octet-stream")
                    assert await adapter.get(key) == source.read_bytes()
                    url = await adapter.url(key)
                    async with httpx.AsyncClient(verify=ssl.create_default_context(cafile=str(ca)), trust_env=False) as client:
                        response = await client.get(url, headers={"Range":"bytes=0-3"})
                        assert response.status_code == 206 and response.content == source.read_bytes()[:4]
                    await adapter.delete(key)
                print("PASS: SD-video four-bucket upload/sign/Range/download/delete", flush=True)
            asyncio.run(check_video())

            with httpx.Client(verify=ssl.create_default_context(cafile=str(ca)), trust_env=False) as client:
                headers = {"Authorization":"Bearer "+token_file.read_text()}
                for bucket in ("old-fixture", BUCKETS[0]):
                    response = client.post(origin+"/storage/v1/object/"+bucket+"/forbidden.bin", headers=headers, content=b"forbidden")
                    assert response.status_code >= 400, "cross-bucket write allowed"
                expired = jwt.encode({"role":"studio_storage_service", "sub":subject, "iat":1, "exp":2,
                                      "storage_buckets":["studio-test-assets"]}, signing_key, algorithm="EdDSA", headers={"kid":kid})
                for bad in (expired, token_file.read_text()[:-8]+"invalid!"):
                    assert client.get(origin+"/storage/v1/bucket/studio-test-assets", headers={"Authorization":"Bearer "+bad}).status_code >= 400
                response = client.get(origin+"/storage/v1/object/authenticated/studio-test-assets/"+worker_key)
                assert response.status_code >= 400
                # 新 JWKS 与旧 HS256 并存：只访问此临时库的 synthetic fixture。
                legacy_headers = {"Authorization":"Bearer "+service, "Content-Type":"application/octet-stream"}
                assert client.post(origin+"/storage/v1/object/old-fixture/existing.bin", headers=legacy_headers, content=b"old-fixture-content").status_code == 200
                old_user = jwt.encode({"role":"authenticated", "sub":str(uuid.uuid4()), "exp":int(time.time())+300}, legacy_test_secret, algorithm="HS256")
                old_headers = {"Authorization":"Bearer "+old_user}
                response = client.get(origin+"/storage/v1/object/authenticated/old-fixture/existing.bin", headers=old_headers)
                assert response.status_code == 200 and response.content == b"old-fixture-content"
                assert client.get(origin+"/storage/v1/object/authenticated/studio-test-assets/"+worker_key, headers=old_headers).status_code >= 400
            issuer.atomic_token(token_file, issuer.mint(signing_key, kid, subject, "studio_storage_service", ["studio-test-assets"]))
            worker.probe()
            docker("restart", storage)
            # Docker 随机宿主端口可能在 restart 后重新分配，刷新测试反代而非误报存储丢失。
            upstream = "http://127.0.0.1:"+docker("port", storage, "5000/tcp").split(":")[-1]
            proxy.upstream = upstream
            with httpx.Client(trust_env=False, timeout=5) as client:
                wait_for(lambda: client.get(upstream+"/bucket", headers={"Authorization":"Bearer "+service}).status_code == 200)
            worker.download(worker_key, target, 1024)
            assert target.read_bytes() == source.read_bytes()
            worker.delete(worker_key)
            print("PASS: JWT/old-bucket denial, legacy HS256 compatibility, rotation, Storage restart persistence", flush=True)
            go_env = os.environ.copy()
            go_env.update({"STORAGE_INTEGRATION_URL":origin, "STORAGE_INTEGRATION_CA_FILE":str(ca),
                           "STORAGE_INTEGRATION_TOKEN_FILE":str(token_file)})
            checked = subprocess.run(["go", "test", "-tags", "storageintegration", "./internal/storage", "-run", "TestSupabaseLive", "-count=1"],
                                     cwd=ROOT / "apps/api", env=go_env, capture_output=True, text=True, timeout=120)
            if checked.returncode:
                print(checked.stdout)
                raise RuntimeError("Go live Storage integration failed")
            print("PASS: Go storage adapter against live TLS/Storage API", flush=True)
        except Exception:
            if containers:
                # 仅输出错误类别摘要，容器日志可能包含请求令牌，不直接打印。
                print("Storage check failed; disposable containers will be removed; no production resources were accessed.", flush=True)
            raise
        finally:
            if proxy is not None:
                proxy.shutdown()
                proxy.server_close()
            for container in reversed(containers):
                if docker("inspect", "--format", '{{index .Config.Labels "'+LABEL+'"}}', container) != "true":
                    raise RuntimeError("Refusing cleanup without test ownership label")
                docker("rm", "-f", container)
            if volume:
                if docker("volume", "inspect", "--format", '{{index .Labels "'+LABEL+'"}}', volume) != "true":
                    raise RuntimeError("Refusing volume cleanup without ownership")
                docker("volume", "rm", volume)
            if network:
                docker("network", "rm", network)
            print("Cleaned only this run's containers, synthetic objects, temporary keys and network.", flush=True)


if __name__ == "__main__":
    main()
