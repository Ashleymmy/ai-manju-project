"""本地隔离联通检查：只访问 compose.mock-deps 的新测试库，绝不使用项目 .env。"""
import base64
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import time
import uuid

import httpx
import jwt
import psycopg
from psycopg import sql
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

ROOT = Path(__file__).resolve().parents[1]
BROWSER_IMAGE = "--browser-image" in sys.argv
BROWSER = "--browser" in sys.argv or BROWSER_IMAGE
OUTPUT = ROOT / ".tmp" / "sdvideo-phase2" / ("browser" if BROWSER else "e2e")
SD = ROOT / "apps" / "sd-video"
API = "http://127.0.0.1:33111"
REMOTE = "http://127.0.0.1:38211"
children = []
logs = []


def start(name, command, directory, environment):
    log = (OUTPUT / f"{name}.log").open("w", encoding="utf-8")
    logs.append(log)
    process = subprocess.Popen(command, cwd=directory, env=environment, stdout=log, stderr=subprocess.STDOUT,
                               creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    children.append(process)
    return process


def wait_for(check, seconds=45):
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        try:
            value = check()
            if value: return value
        except httpx.TransportError:
            pass
        time.sleep(0.3)
    raise AssertionError("condition timed out")


def data(response):
    if not response.is_success:
        raise AssertionError(f"HTTP {response.status_code}: {response.text[:300]}")
    payload = response.json()
    assert payload["success"], payload
    return payload["data"]


def browser_acceptance(api_env, sd_env, admin, secret, extension):
    """复用真实隔离栈；页面接口不拦截，Nginx 使用发布配置的仅测试上游替换。"""
    web = "http://127.0.0.1:33110"
    bundle = OUTPUT / "web"
    if not BROWSER_IMAGE and (not (bundle / "index.html").is_file() or not (bundle / "director-desk/index.html").is_file()):
        raise RuntimeError("build Studio and Director Desk before browser acceptance")
    start("bridge", [str(OUTPUT / ("bridge" + extension))], ROOT / "apps/api", api_env)
    start("sd-worker", [sys.executable, str(ROOT / "scripts/sdvideo-phase2-mock-worker.py")], SD, sd_env)
    start("sd-asset-worker", [sys.executable, "-m", "worker.asset_worker"], SD, sd_env)
    nginx = OUTPUT / "web.nginx.conf"
    nginx.write_text((ROOT / "deploy/cloud/web.nginx.conf").read_text(encoding="utf-8")
                     .replace("http://api:3101", "http://host.docker.internal:33111"), encoding="utf-8")
    name = "studio-phase2-browser-" + uuid.uuid4().hex[:12]
    image = "studio-phase2-web:check" if BROWSER_IMAGE else "nginx:1.27-alpine"
    content_mount = [] if BROWSER_IMAGE else ["--mount", f"type=bind,source={bundle},target=/usr/share/nginx/html,readonly"]
    try:
        subprocess.run(["docker", "run", "-d", "--name", name, "--label", "studio.test=phase2-browser",
                        "-p", "127.0.0.1:33110:3100", *content_mount,
                        "--mount", f"type=bind,source={nginx},target=/etc/nginx/conf.d/default.conf,readonly",
                        image], check=True, timeout=60, stdout=subprocess.DEVNULL)
        with httpx.Client(timeout=5, trust_env=False) as client:
            wait_for(lambda: client.get(web + "/health").status_code == 200)
            wait_for(lambda: client.get("http://127.0.0.1:33113/health/ready").status_code == 200)
        environment = {**api_env, "E2E_BASE_URL": web, "E2E_API_URL": web,
                       "E2E_ADMIN_ACCOUNT": admin, "E2E_ADMIN_PASSWORD": secret,
                       "E2E_PHASE2_BROWSER": "isolated-mock"}
        # 发布配置只允许服务 origin；媒体也必须经过鉴权 Gateway。
        subprocess.run([shutil.which("pnpm.cmd" if os.name == "nt" else "pnpm"), "exec", "playwright", "test",
                        "--config", "playwright.phase2.config.ts"], cwd=ROOT, env=environment, check=True, timeout=600)
    finally:
        subprocess.run(["docker", "rm", "-f", name], timeout=30, check=False, stdout=subprocess.DEVNULL)


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    private = Ed25519PrivateKey.generate()
    public = private.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()
    pem_private = private.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
    secret = secrets.token_urlsafe(32)
    admin = "phase2-" + uuid.uuid4().hex[:10]
    # 每轮创建专用空库，确保管理员初始化可重复；不清空或覆盖任何已有库。
    database = "phase2_" + uuid.uuid4().hex
    sd_test_port = int(os.getenv("SDVIDEO_TEST_DB_PORT", "55439"))
    if sd_test_port not in {55439, 55449}: raise ValueError("only dedicated loopback fixture ports are allowed")
    for port, owner in ((55438, "studio_test"), (sd_test_port, "sdvideo_test")):
        with psycopg.connect(host="127.0.0.1", port=port, user=owner,
                             password="disposable_test_only", dbname=owner, autocommit=True) as connection:
            connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database)))
    # 不继承父会话的数据库、Provider、Storage 或代理配置，只保留运行工具所需系统路径。
    system_keys = {"PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP", "TMPDIR",
                   "USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)",
                   "PROGRAMDATA", "GOPATH", "GOCACHE", "PNPM_HOME", "PLAYWRIGHT_BROWSERS_PATH"}
    common = {**{key: value for key, value in os.environ.items() if key.upper() in system_keys},
              "APP_ENV": "development", "SD_VIDEO_MODE": "active"}
    sd_env = {**common, "SDVIDEO_LOAD_ENV_FILE": "false", "LOCAL_DEMO_MODE": "false", "SD_VIDEO_EXECUTION_MODE": "mock",
              "SERVICE_JWT_PUBLIC_KEY": public, "SDVIDEO_DATA_DIR": str(OUTPUT / "sd-assets"), "STORAGE_BACKEND": "local",
              "SDVIDEO_DATABASE_URL": f"postgresql://sdvideo_test:disposable_test_only@127.0.0.1:{sd_test_port}/{database}",
              "SDVIDEO_REDIS_URL": "redis://127.0.0.1:16389/0", "PYTHONPATH": str(SD / "api"),
              "SDVIDEO_WORKER_INTERVAL_SECONDS": "1", "SDVIDEO_WORKER_LEASE_SECONDS": "6", "SDVIDEO_WORKER_HEALTH_PORT": "38212", "SDVIDEO_ASSET_WORKER_HEALTH_PORT": "38213"}
    # 测试只使用本轮生成的环境；排除父进程指向文件的隐式密钥覆盖。
    for key in list(sd_env):
        if key.endswith("_FILE"): sd_env.pop(key)
    api_env = {**common, "HOST": "127.0.0.1", "PORT": "33111", "STORAGE_DRIVER": "postgres",
               "DB_HOST": "127.0.0.1", "DB_PORT": "55438", "DB_USER": "studio_test", "DB_PASSWORD": "disposable_test_only",
               "DB_NAME": database, "DB_SSLMODE": "disable", "APP_SECRET": secret,
               "ADMIN_USERNAME": admin, "ADMIN_PASSWORD": secret, "FRONTEND_URLS": "http://127.0.0.1:33110" if BROWSER else API,
               "ASSET_STORAGE_BACKEND": "local", "ASSET_STORAGE_DIR": str(OUTPUT / "studio-assets"),
               "REDIS_URL": "redis://127.0.0.1:16388/0", "CELERY_BROKER_URL": "redis://127.0.0.1:16388/0",
               "SD_VIDEO_BASE_URL": REMOTE, "SD_VIDEO_JWT_PRIVATE_KEY": pem_private,
               "SD_VIDEO_BRIDGE_INTERVAL_SECONDS": "1", "SD_VIDEO_BRIDGE_ENABLED": "false", "SD_VIDEO_BRIDGE_HEALTH_ADDR": "127.0.0.1:33113"}
    for key in list(api_env):
        if key.endswith("_FILE") or key in {"DATABASE_URL", "ASSET_CDN_BASE_URL"}: api_env.pop(key)
    subprocess.run([sys.executable, "scripts/migrate.py"], cwd=SD, env=sd_env, check=True, timeout=60)
    extension = ".exe" if os.name == "nt" else ""
    for name, package in (("api", "./cmd/server"), ("bridge", "./cmd/sd-video-bridge")):
        subprocess.run(["go", "build", "-o", str(OUTPUT / (name+extension)), package], cwd=ROOT / "apps/api", check=True, timeout=120)
    sd_command = [sys.executable, str(ROOT / "scripts/sdvideo-phase2-mock-api.py")]
    sd_api = start("sd-api", sd_command, SD, sd_env)
    start("studio-api", [str(OUTPUT / ("api"+extension))], ROOT / "apps/api", api_env)
    with httpx.Client(timeout=10, follow_redirects=True) as client:
        wait_for(lambda: client.get(REMOTE + "/health/ready").status_code == 200)
        wait_for(lambda: client.get(API + "/health").status_code == 200)
        login = data(client.post(API + "/api/auth/login", json={"username": admin, "password": secret}))
        client.headers["Authorization"] = "Bearer " + login["token"]
        if BROWSER:
            model_path = API + "/api/admin/model-providers/sdvideo::seedance-2.0"
            managed = data(client.get(model_path))
            data(client.put(model_path, json={**managed, "enabled": True}))
            browser_acceptance(api_env, sd_env, admin, secret, extension)
            return
        providers = data(client.get(API + "/api/admin/model-providers"))["providers"]
        managed = next(item for item in providers if item["id"] == "sdvideo::seedance-2.0")
        model_path = API + "/api/admin/model-providers/sdvideo::seedance-2.0"
        saved = data(client.put(model_path, json={**managed, "max_concurrency": 2}))
        assert saved["version"] == managed["version"] + 1 and saved["max_concurrency"] == 2
        assert client.put(model_path, json=managed).status_code == 409
        assert data(client.post(model_path + "/test", json={}))['ok'] is False
        nonce = uuid.uuid4().hex
        conv = data(client.post(API + "/api/sd-video/conversations", json={"id": "e2e_"+nonce, "title": "isolated test"}))
        message = data(client.post(API + "/api/sd-video/messages", json={"id": "msg_"+nonce, "conversation_id": conv["id"], "role": "system", "text": "test", "metadata": {"taskStatus": "queued", "taskProvider": "seedance", "model": "sdvideo/seedance-2.0"}}))
        payload = {"model": "sdvideo/seedance-2.0", "content": [{"type": "text", "text": "isolated mock"}], "conversation_id": conv["id"], "studio_message_id": message["id"]}
        headers = {"Idempotency-Key": nonce}
        job = data(client.post(API + "/api/ai/contents/generations/tasks", json=payload, headers=headers))
        assert data(client.post(API + "/api/ai/contents/generations/tasks", json=payload, headers=headers))["id"] == job["id"]
        canceled = data(client.post(API + "/api/ai/contents/generations/tasks", json={**payload, "studio_message_id": ""}))
        assert data(client.post(API + f"/api/jobs/{canceled['id']}/cancel"))["status"] == "canceled"
        image = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDoAAAAAASUVORK5CYII=")
        reference = data(client.post(API + "/api/ai/videos", data={"model": "sdvideo/seedance-2.0", "prompt": "image", "seconds": "6"}, files={"input_reference[]": ("pixel.png", image, "image/png")}))
        tag = data(client.post(API + "/api/admin/seedance-asset-tags", json={"name": "test", "color": "#123456"}))
        data(client.put(API + f"/api/admin/seedance-asset-tags/{tag['id']}", json={"name": "renamed", "color": "#654321"}))
        tags = data(client.get(API + "/api/admin/seedance-asset-tags"))["items"]
        assert next(item for item in tags if item["id"] == tag["id"])["name"] == "renamed"
        material = data(client.post(API + "/api/admin/seedance-assets/upload", data={"asset_type": "Image", "name": "material", "tag_ids": tag["id"]}, files={"file": ("pixel.png", image, "image/png")}))
        assert material["status"] == "Processing"
        # API 关闭新任务入口后，Bridge 仍可发送此前已经持久化的 outbox。
        sd_api.terminate(); sd_api.wait(timeout=10)
        sd_api = start("sd-api-draining", sd_command, SD, {**sd_env, "SD_VIDEO_MODE": "disabled"})
        wait_for(lambda: client.get(REMOTE + "/health/ready").status_code == 200)
        bridge = start("bridge", [str(OUTPUT / ("bridge"+extension))], ROOT / "apps/api", api_env)
        wait_for(lambda: client.get("http://127.0.0.1:33113/health/ready").status_code == 200)
        worker = start("sd-worker", [sys.executable, "-m", "worker.runner"], SD, sd_env)
        start("sd-asset-worker", [sys.executable, "-m", "worker.asset_worker"], SD, sd_env)
        results = []
        for task in (job, reference):
            result = wait_for(lambda: (value if (value := data(client.get(API + f"/api/jobs/{task['id']}")))["status"] in {"succeeded", "failed"} else None))
            assert result["status"] == "succeeded", result
            results.append(result)
        assert results[0]["result"]["asset_id"]
        asset_body = client.get(API + f"/api/assets/{results[0]['result']['asset_id']}/content")
        assert asset_body.status_code == 200 and b"ftyp" in asset_body.content[:32]
        tool = data(client.post(API + "/api/sd-video/toolkit/erase", json={"asset_id": results[0]["result"]["asset_id"], "mode": "pro"}))
        erased = wait_for(lambda: (value if (value := data(client.get(API + f"/api/jobs/{tool['id']}")))["status"] in {"succeeded", "failed"} else None))
        assert erased["status"] == "succeeded" and erased["result"]["asset_id"], erased
        registered = wait_for(lambda: (value if (value := data(client.get(API + f"/api/admin/seedance-assets/{material['id']}")))["status"] == "Active" else None))
        thumbnail_url = API + f"/api/sd-video/volcano/assets/{material['id']}/thumbnail"
        wait_for(lambda: client.get(thumbnail_url).status_code == 200)
        assert client.get(thumbnail_url).headers["content-type"] == "image/jpeg"
        with psycopg.connect(sd_env["SDVIDEO_DATABASE_URL"]) as connection:
            media_id = connection.execute("select id from media_library where task_id=%s", (results[0]["external_task_id"],)).fetchone()[0]
        wait_for(lambda: client.get(API + f"/api/sd-video/media/{media_id}/thumbnail").status_code == 200)
        stats = data(client.get(API + "/api/sd-video/admin/stats"))
        assert stats["usage"]["completed_tasks"] >= 3 and stats["usage"]["priced_tasks"] == 0 and stats["usage"]["amounts"] == []
        metrics = client.get("http://127.0.0.1:33113/metrics")
        assert metrics.status_code == 200 and "studio_sdvideo_bridge_probe_up 1" in metrics.text
        assert "sdvideo_thumbnail_failures" in client.get(REMOTE + "/metrics").text
        print("PASS: image/video thumbnails, scoped usage, durable Bridge health/metrics", flush=True)
        assert registered["tags"][0]["id"] == tag["id"]
        with psycopg.connect(sd_env["SDVIDEO_DATABASE_URL"]) as connection:
            assert connection.execute("select count(*) from asset_tags where asset_id=%s and tag_id=%s", (material["id"], tag["id"])).fetchone()[0] == 1
        data(client.delete(API + f"/api/admin/seedance-asset-tags/{tag['id']}"))
        assert data(client.get(API + f"/api/admin/seedance-assets/{material['id']}"))["tags"] == []
        with psycopg.connect(sd_env["SDVIDEO_DATABASE_URL"]) as connection:
            assert connection.execute("select tags from volcano_assets where id=%s", (material["id"],)).fetchone()[0] == []
            assert connection.execute("select count(*) from asset_tags where asset_id=%s", (material["id"],)).fetchone()[0] == 0
        assert client.get(API + registered["source_url"]).content == image
        assert data(client.post(API + "/api/ai/seedance-assets/ensure-active", json={"asset_ids": [registered["volcano_asset_id"]]}))["active"]
        data(client.delete(API + f"/api/admin/seedance-assets/{material['id']}"))
        assert client.post(API + "/api/ai/seedance-assets/ensure-active", json={"asset_ids": [registered["volcano_asset_id"]]}).status_code == 409
        body = client.get(API + f"/api/ai/contents/generations/tasks/{job['id']}/content")
        assert body.status_code == 200 and b"ftyp" in body.content[:32]
        restored = data(client.get(API + f"/api/sd-video/conversations/{conv['id']}/messages"))["items"][0]["metadata"]
        assert restored["taskId"] == job["id"] and restored["resultAssetId"] == results[0]["result"]["asset_id"]
        assert data(client.get(API + f"/api/jobs/{canceled['id']}"))["status"] == "canceled"
        worker.terminate(); worker.wait(timeout=10)
        bridge.terminate(); bridge.wait(timeout=10)
        start("bridge-restarted", [str(OUTPUT / ("bridge"+extension))], ROOT / "apps/api", api_env)
        fault_worker = [sys.executable, str(ROOT / "scripts/sdvideo-phase2-mock-worker.py")]
        worker = start("sd-worker-delayed", fault_worker, SD, sd_env)
        assert data(client.get(API + f"/api/jobs/{job['id']}"))["result"]["asset_id"] == results[0]["result"]["asset_id"]
        recovering = data(client.post(API + "/api/ai/contents/generations/tasks", json={**payload, "studio_message_id": ""}))
        wait_for(lambda: data(client.get(API + f"/api/jobs/{recovering['id']}"))["status"] == "running")
        worker.terminate(); worker.wait(timeout=10)
        worker = start("sd-worker-recovered", fault_worker, SD, sd_env)
        recovered = wait_for(lambda: (value if (value := data(client.get(API + f"/api/jobs/{recovering['id']}")))["status"] == "succeeded" else None))
        with psycopg.connect(sd_env["SDVIDEO_DATABASE_URL"]) as connection:
            assert connection.execute("select count(*) from task_events where task_id=%s and status='queued'", (recovered["external_task_id"],)).fetchone()[0] == 1
        cancel_running = data(client.post(API + "/api/ai/contents/generations/tasks", json={**payload, "studio_message_id": ""}))
        wait_for(lambda: data(client.get(API + f"/api/jobs/{cancel_running['id']}"))["status"] == "running")
        assert data(client.post(API + f"/api/jobs/{cancel_running['id']}/cancel"))["status"] == "canceled"
        def remote_canceled():
            with psycopg.connect(sd_env["SDVIDEO_DATABASE_URL"]) as connection:
                row = connection.execute("select status from tasks where request->>'studio_job_id'=%s", (cancel_running["id"],)).fetchone()
                return row and row[0] == "canceled"
        wait_for(remote_canceled)
        canceled_result = data(client.get(API + f"/api/jobs/{cancel_running['id']}"))
        assert canceled_result["status"] == "canceled" and not (canceled_result.get("result") or {}).get("asset_id")

        # 核对流程：只在本轮新库注入“上游已接单、本地未收到 ID”的故障状态。
        worker.terminate(); worker.wait(timeout=10)
        # 早前的模型元数据回归保留了默认停用状态；核对测试显式启用合成模型。
        review_model = data(client.get(model_path))
        data(client.put(model_path, json={**review_model, "enabled": True}))
        member_name = "review-" + uuid.uuid4().hex[:10]
        member = data(client.post(API + "/api/admin/users", json={"username": member_name, "password": secret, "role": "member"}))
        with httpx.Client(timeout=10) as member_client:
            member_login = data(member_client.post(API + "/api/auth/login", json={"username": member_name, "password": secret}))
            member_client.headers["Authorization"] = "Bearer " + member_login["token"]
            review_jobs = {}
            for decision in ("bind_existing", "confirm_not_submitted", "cancel"):
                created = data(member_client.post(API + "/api/ai/contents/generations/tasks", headers={"Idempotency-Key": uuid.uuid4().hex}, json={"model": "sdvideo/seedance-2.0", "content": [{"type": "text", "text": "reconciliation mock " + decision}]}))
                def external_id():
                    with psycopg.connect(sd_env["SDVIDEO_DATABASE_URL"]) as connection:
                        row = connection.execute("select id from tasks where request->>'studio_job_id'=%s", (created["id"],)).fetchone()
                        return row[0] if row else None
                remote_task = wait_for(external_id)
                with psycopg.connect(sd_env["SDVIDEO_DATABASE_URL"]) as connection:
                    connection.execute("update tasks set status='failed',error=%s::jsonb,submission_started_at=now() where id=%s",
                                       (json.dumps({"code": "submission_uncertain", "message": "test fixture"}), remote_task))
                wait_for(lambda: data(member_client.get(API + f"/api/jobs/{created['id']}"))["status"] == "failed")
                operation = API + f"/api/admin/sd-video/jobs/{created['id']}/reconciliation"
                assert member_client.get(operation).status_code == 403
                inspected = data(client.get(operation))
                assert inspected["owner_subject"] == member["id"] and inspected["requires_reconciliation"]
                review = {"decision": decision if decision != "cancel" else "bind_existing", "expected_attempt": 1,
                          "evidence_ref": "E2E_review", "confirmed": True}
                if review["decision"] == "bind_existing": review["provider_task_id"] = f"mock-reconciled:{remote_task}"
                assert client.post(operation, json={**review, "owner_subject": "forged"}).status_code == 400
                if decision == "cancel":
                    assert data(member_client.post(API + f"/api/jobs/{created['id']}/cancel"))["status"] == "canceled"
                    def remote_was_canceled():
                        with psycopg.connect(sd_env["SDVIDEO_DATABASE_URL"]) as connection:
                            return connection.execute("select status from tasks where id=%s", (remote_task,)).fetchone()[0] == "canceled"
                    wait_for(remote_was_canceled)
                    assert client.post(operation, json=review).status_code == 409
                    assert member_client.post(API + f"/api/jobs/{created['id']}/retry").status_code == 409
                else:
                    # 老版本曾把不确定任务关为 done；新 Bridge 必须恢复这类记录。
                    studio_url = f"postgresql://studio_test:disposable_test_only@127.0.0.1:55438/{database}"
                    with psycopg.connect(studio_url) as connection:
                        connection.execute("update jobs set bridge_state='done' where id=%s", (created["id"],))
                    resolved = data(client.post(operation, json=review))
                    if decision == "bind_existing":
                        sd_api.terminate(); sd_api.wait(timeout=10)
                        sd_api = start("sd-api-reconciliation-restarted", sd_command, SD, {**sd_env, "SD_VIDEO_MODE": "disabled"})
                        wait_for(lambda: client.get(REMOTE + "/health/ready").status_code == 200)
                    assert data(client.post(operation, json=review))["task_id"] == remote_task
                    assert client.post(operation, json={**review, "evidence_ref": "conflicting"}).status_code == 409
                    audit = data(client.get(operation))["audit"]
                    assert audit["actor_subject"] == login["user"]["id"] and audit["expected_attempt"] == 1
                    if decision == "bind_existing":
                        assert resolved["provider_task_id"] == review["provider_task_id"]
                        wait_for(lambda: data(member_client.get(API + f"/api/jobs/{created['id']}"))["status"] == "running")
                    else:
                        wait_for(lambda: data(member_client.get(API + f"/api/jobs/{created['id']}"))["error"].get("code") == "submission_not_created_verified")
                        retry = data(member_client.post(API + f"/api/jobs/{created['id']}/retry"))
                        assert retry["id"] != created["id"]
                        assert data(member_client.post(API + f"/api/jobs/{created['id']}/retry"))["id"] == retry["id"]
                review_jobs[decision] = created
            worker = start("sd-worker-after-reconciliation", [sys.executable, "-m", "worker.runner"], SD, sd_env)
            for task in (review_jobs["bind_existing"], retry):
                restored_job = wait_for(lambda: (value if (value := data(member_client.get(API + f"/api/jobs/{task['id']}")))["status"] == "succeeded" else None))
                assert restored_job["result"]["asset_id"]
            with psycopg.connect(sd_env["SDVIDEO_DATABASE_URL"]) as connection:
                assert connection.execute("select count(*) from task_reconciliations").fetchone()[0] == 2
                assert connection.execute("select count(*) from tasks where request->>'studio_job_id'=%s", (review_jobs["bind_existing"]["id"],)).fetchone()[0] == 1
            assert not (data(member_client.get(API + f"/api/jobs/{review_jobs['cancel']['id']}"))["result"] or {}).get("asset_id")
        print("PASS: superadmin reconciliation of member jobs / immutable audit / idempotent decisions / legacy done recovery / explicit retry / canceled uncertain job never revives")
        claims = {"iss": "ai-manju-studio", "aud": "sd-video", "sub": "intruder", "workspace_id": "team", "role": "member", "scope": "tasks:read", "iat": int(time.time()), "exp": int(time.time())+60, "jti": uuid.uuid4().hex}
        stranger = jwt.encode(claims, private, algorithm="EdDSA")
        remote_id = results[0]["external_task_id"]
        assert client.get(REMOTE+f"/v1/tasks/{remote_id}", headers={"Authorization": "Bearer "+stranger}).status_code == 404
        expired = jwt.encode({**claims, "iat": int(time.time())-120, "exp": int(time.time())-60}, private, algorithm="EdDSA")
        assert client.get(REMOTE+"/v1/models", headers={"Authorization": "Bearer "+expired}).status_code == 401
        sd_api.terminate(); sd_api.wait(timeout=10)
        assert client.get(API + f"/api/ai/contents/generations/tasks/{job['id']}/content").content == asset_body.content
        print("PASS: real JWT + separate PostgreSQL/Redis + Go outbox + Worker + Bridge + asset import + MP4 content")
        print("PASS: text / multipart image reference / idempotency / pre-dispatch cancellation / process restart / server history recovery / owner isolation / expired JWT")
        print("PASS: model metadata update / stale version conflict / non-fake Provider test / MediaKit durable task and asset import")
        print("PASS: material upload / tag binding / asset worker registration / private preview / Active reference check / delete prevents reuse")
        print("PASS: accepted outbox drains with remote rollout disabled / normalized tag relation and delete cleanup / imported video survives SD-video API shutdown")
        print("PASS: in-flight Worker termination / lease expiry recovery without duplicate enqueue / in-flight cancellation blocks late asset import")
        backup_root = OUTPUT / ("backup-" + uuid.uuid4().hex)
        command = [sys.executable, str(ROOT / "deploy/cloud/backup.py")]
        subprocess.run([*command, "backup", "--test-database", database, "--directory", str(backup_root)], check=True, timeout=120)
        backup_folder, = backup_root.iterdir()
        subprocess.run([*command, "restore-check", "--test-database", database, "--directory", str(backup_folder)], check=True, timeout=120)
        print("PASS: both isolated databases backed up, SHA verified and restored into new rehearsal databases")
        print("NOT COVERED: real OSS/CDN, paid Providers, browser rendering, cloud recovery time and full-scale load")


if __name__ == "__main__":
    try:
        main()
    finally:
        for process in reversed(children):
            if process.poll() is None:
                process.terminate()
                try: process.wait(timeout=10)
                except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=5)
        for log in logs: log.close()
