import os
import time

os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("LOCAL_DEMO_MODE", "true")
os.environ.setdefault("SD_VIDEO_EXECUTION_MODE", "mock")
os.environ.setdefault("STORAGE_BACKEND", "local")

from fastapi.testclient import TestClient

from api.main import app
from app.config import settings

settings.APP_ENV = "development"
settings.LOCAL_DEMO_MODE = True
settings.STORAGE_BACKEND = "local"


AUTH = {"Authorization": "Bearer local-demo"}


def test_health_and_auth_envelope():
    client = TestClient(app)
    assert client.get("/health/live").status_code == 200
    response = client.get("/v1/models")
    assert response.status_code == 401
    body = response.json()
    assert body["success"] is False
    assert body["error"]["code"] == "unauthorized"
    assert body["request_id"]


def test_mock_task_lifecycle_idempotency_and_result():
    client = TestClient(app)
    request = {"idempotency_key": "standalone-test", "model": "seedance-2.0", "prompt": "一只猫"}
    created = client.post("/v1/tasks", headers=AUTH, json=request)
    assert created.status_code == 202
    task_id = created.json()["data"]["task_id"]
    duplicate = client.post("/v1/tasks", headers=AUTH, json=request)
    assert duplicate.json()["data"]["task_id"] == task_id
    time.sleep(0.12)
    fetched = client.get(f"/v1/tasks/{task_id}", headers=AUTH)
    assert fetched.json()["data"]["status"] == "succeeded"
    assert client.get(f"/v1/tasks/{task_id}/result", headers=AUTH).status_code == 200
    events = client.get(f"/v1/tasks/{task_id}/events", headers=AUTH)
    assert "event: task\n" in events.text


def test_cancel_and_scoped_conversation_crud():
    client = TestClient(app)
    created = client.post("/v1/tasks", headers=AUTH, json={"idempotency_key": "cancel-test", "model": "seedance-2.0", "prompt": "取消"})
    task_id = created.json()["data"]["task_id"]
    assert client.post(f"/v1/tasks/{task_id}/cancel", headers=AUTH).json()["data"]["status"] == "canceled"

    conversation = client.post("/v1/conversations", headers=AUTH, json={"title": "测试对话"}).json()["data"]
    conversation_id = conversation["id"]
    message = client.post("/v1/messages", headers=AUTH, json={"conversation_id": conversation_id, "text": "你好"}).json()["data"]
    assert client.patch(f"/v1/messages/{message['id']}", headers=AUTH, json={"text": "已编辑"}).json()["data"]["text"] == "已编辑"
    assert client.delete(f"/v1/conversations/{conversation_id}", headers=AUTH).status_code == 200
