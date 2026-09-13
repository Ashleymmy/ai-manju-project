"""API-first surface for the independent SD-video service.

The copied legacy business modules remain available behind an explicit
``SD_VIDEO_EXECUTION_MODE=legacy`` switch.  Development defaults to a
deterministic local provider so the service can be booted without any old
Supabase/OSS credentials.
"""

import asyncio
import re
import time
import uuid
import hashlib
from dataclasses import dataclass, field
from typing import Any, Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.config import settings
from app.core.auth import ServicePrincipal, require_admin, require_scope
from app.core.envelope import ok
from app.persistence import PostgresCatalogStore, PostgresTaskStore, use_postgres
from app.queue import build_queue
from app.model_store import model_store, public_model
from app.storage import build_storage_adapter
from app.mock_media import MOCK_VIDEO
from app.volcano_store import VolcanoStore, public_asset
from app.input_store import InputStore
from app.task_reconciliation import TaskReconciliationStore, register_reconciliation_routes
from app.catalog_queries import Page, MediaFilter, VolcanoFilter, MENTION_PAGE_SIZE, keyword, record_order, media_stats as summarize_media


class ReferenceInput(BaseModel):
    kind: str
    asset_ref: str | None = None
    storage_token: str | None = None
    name: str | None = None
    mime: str | None = None
    role: str | None = None


class CreateTaskRequest(BaseModel):
    idempotency_key: str = Field(min_length=1, max_length=200)
    model: str
    prompt: str | None = None
    ratio: str = "16:9"
    duration: int = 6
    resolution: str = "720p"
    generate_audio: bool = True
    watermark: bool = False
    seed: int | None = None
    camera_fixed: bool | None = None
    references: list[ReferenceInput] = Field(default_factory=list)
    conversation_id: str | None = None
    studio_job_id: str | None = None
    studio_message_id: str | None = None
    project_id: str | None = None
    node_id: str | None = None
    scope: str = "personal"


class ConversationRequest(BaseModel):
    id: str | None = Field(default=None, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    title: str = "新对话"


class MessageRequest(BaseModel):
    id: str | None = Field(default=None, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    metadata: dict[str, Any] = Field(default_factory=dict)
    conversation_id: str
    text: str
    role: str = "user"
    attachments: list[dict[str, Any]] = Field(default_factory=list)
    task_id: str | None = None
    video_url: str | None = None


class ModelUpdateRequest(BaseModel):
    concurrency_limit: int | None = Field(default=None, ge=1, le=16)
    version: int | None = Field(default=None, ge=1)
    enabled: bool | None = None
    model_id: str | None = None
    name: str | None = None


class InputPresignRequest(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    content_type: str = "application/octet-stream"
    size_bytes: int = Field(default=0, ge=0)


class InputCompleteRequest(BaseModel):
    upload_token: str
    sha256: str | None = None


@dataclass
class TaskRecord:
    id: str
    owner_subject: str
    workspace_id: str
    model: str
    prompt: str | None
    provider: str = ""
    status: str = "queued"
    progress: int = 0
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    attempt: int = 1
    request: dict[str, Any] = field(default_factory=dict)
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None
    provider_task_id: str | None = None
    cancel_requested: bool = False
    mock_ready_at: float | None = None


class InMemoryTaskStore:
    """Deterministic local store used only by development/mock mode."""

    def __init__(self) -> None:
        self._tasks: dict[str, TaskRecord] = {}
        self._idempotency: dict[tuple[str, str, str], str] = {}
        self._lock = asyncio.Lock()

    async def create(self, principal: ServicePrincipal, request: CreateTaskRequest) -> tuple[TaskRecord, bool]:
        payload = request.model_dump(mode="json") if hasattr(request, "model_dump") else dict(request)
        key = (principal.workspace_id, principal.subject, payload["idempotency_key"])
        async with self._lock:
            existing_id = self._idempotency.get(key)
            if existing_id and existing_id in self._tasks:
                return self._tasks[existing_id], False
            record = TaskRecord(
                id=f"sdv_{uuid.uuid4().hex}",
                owner_subject=principal.subject,
                workspace_id=principal.workspace_id,
                model=payload["model"],
                prompt=payload.get("prompt"),
                provider=str(payload.get("provider") or ""),
                attempt=int(payload.get("attempt", 1)),
                request=payload,
            )
            if _execution_mode() == "mock":
                record.mock_ready_at = record.created_at + 0.1
            self._tasks[record.id] = record
            self._idempotency[key] = record.id
            return record, True

    async def get(self, principal: ServicePrincipal, task_id: str) -> TaskRecord | None:
        async with self._lock:
            record = self._tasks.get(task_id)
            if record is None or record.workspace_id != principal.workspace_id or record.owner_subject != principal.subject:
                return None
            _refresh_mock_record(record)
            return record

    async def get_by_id(self, task_id: str) -> TaskRecord | None:
        async with self._lock:
            record = self._tasks.get(task_id)
            if record is not None:
                _refresh_mock_record(record)
            return record

    async def list(self, principal: ServicePrincipal) -> list[TaskRecord]:
        async with self._lock:
            records = [item for item in self._tasks.values() if item.workspace_id == principal.workspace_id and item.owner_subject == principal.subject]
            for record in records:
                _refresh_mock_record(record)
            return records

    async def update(self, task_id: str, **changes: Any) -> TaskRecord | None:
        async with self._lock:
            record = self._tasks.get(task_id)
            if record is None:
                return None
            expected_error = changes.pop("expected_error_code", None)
            if expected_error is not None and (record.error or {}).get("code") != expected_error:
                return None
            lease = changes.pop("expected_lease", None)
            if lease is not None and (getattr(record, "lease_owner", None) != lease or getattr(record, "lease_expires_at", 0) <= time.time()):
                return None
            if "status" in changes:
                cancel_uncertain = (record.status == "failed" and (record.error or {}).get("code") == "submission_uncertain"
                                    and changes["status"] == "canceled" and changes.get("cancel_requested") is True)
                if record.status in {"succeeded", "failed", "canceled"} and not cancel_uncertain:
                    return None
                if changes["status"] in {"running", "succeeded"} and record.cancel_requested:
                    return None
            if "submission_started_at" in changes and (record.cancel_requested or record.status in {"succeeded", "failed", "canceled"}):
                return None
            for key, value in changes.items():
                setattr(record, key, value)
            record.updated_at = time.time()
            return record


task_store = PostgresTaskStore(settings.DATABASE_URL) if use_postgres() else InMemoryTaskStore()
reconciliation_store = TaskReconciliationStore(task_store)
catalog_store = PostgresCatalogStore(settings.DATABASE_URL) if use_postgres() else None
task_queue = build_queue(settings)
task_runs: dict[str, asyncio.Task[None]] = {}
conversation_store: dict[str, dict[str, Any]] = {}
message_store: dict[str, list[dict[str, Any]]] = {}
media_store: dict[str, dict[str, Any]] = {}
volcano_assets_store: dict[str, dict[str, Any]] = {}
volcano_store = VolcanoStore(settings.DATABASE_URL if use_postgres() else "")
input_store = InputStore(settings.DATABASE_URL if use_postgres() else "")
volcano_tags_store: dict[tuple[str, str], dict[str, Any]] = {}
erase_store: dict[str, dict[str, Any]] = {}
local_storage = build_storage_adapter(settings)

router = APIRouter(prefix=settings.API_PREFIX, tags=["sd-video"])


def _local_media(principal: ServicePrincipal, filters: MediaFilter) -> list:
    return sorted((item for item in media_store.values() if item["owner_subject"] == principal.subject
                   and item["workspace_id"] == principal.workspace_id and filters.matches(item)),
                  key=record_order, reverse=True)


async def _completed_input(principal: ServicePrincipal, value: str) -> str:
    token = _scoped_input_token(principal, value)
    item = await input_store.get(principal, token)
    if item is None or item["status"] != "complete": raise HTTPException(status_code=409, detail="reference input is incomplete or expired")
    return token


async def _validate_message_links(principal: ServicePrincipal, payload: dict) -> None:
    task_id = payload.get("task_id")
    if task_id and await task_store.get(principal, str(task_id)) is None:
        raise HTTPException(status_code=404, detail="task not found")
    if "role" in payload and payload["role"] not in {"user", "system", "assistant"}:
        raise HTTPException(status_code=400, detail="invalid message role")
    if payload.get("video_url"):
        raise HTTPException(status_code=400, detail="store stable asset references, not external video URLs")
    for attachment in payload.get("attachments") or []:
        if not isinstance(attachment, dict) or not attachment.get("assetId") or attachment.get("storageKey"):
            raise HTTPException(status_code=400, detail="message attachment requires a Studio asset reference")


def _scoped_input_token(principal: ServicePrincipal, token: str) -> str:
    """Validate the canonical four-segment input key for one principal."""
    normalized = str(token or "").replace("\\", "/").strip("/")
    parts = normalized.split("/")
    if len(parts) != 4 or parts[0] != "inputs" or parts[1] != principal.workspace_id or parts[2] != principal.subject:
        raise HTTPException(status_code=403, detail="upload token scope mismatch")
    if any(not part or part in {".", ".."} for part in parts) or any(any(ord(char) < 32 for char in part) for part in parts):
        raise HTTPException(status_code=400, detail="invalid upload token")
    return normalized


async def _read_limited_body(request: Request, limit: int) -> bytes:
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise HTTPException(status_code=413, detail="input is too large")
        chunks.append(chunk)
    return b"".join(chunks)


async def _cleanup_task_inputs(record: TaskRecord) -> None:
    expected_prefix = f"inputs/{record.workspace_id}/{record.owner_subject}/"
    for item in (record.request or {}).get("references") or []:
        raw = item if isinstance(item, dict) else {}
        token = str(raw.get("storage_token") or "").replace("\\", "/").strip()
        if not token.startswith(expected_prefix) or any(part in {"", ".", ".."} for part in token.split("/")):
            continue
        try:
            await local_storage.delete(token)
        except Exception:
            # Cleanup is best effort; the task remains canceled and a later
            # storage maintenance pass may remove an orphaned input.
            continue


def _execution_mode() -> str:
    return getattr(settings, "EXECUTION_MODE", "mock")


def _rollout_mode() -> str:
    value = str(getattr(settings, "SD_VIDEO_MODE", "active") or "active").strip().lower()
    return value if value in {"disabled", "shadow", "active"} else "active"


def _refresh_mock_record(record: TaskRecord) -> None:
    """Advance deterministic mock state without relying on an event loop task.

    Test clients create a fresh loop for every request, so an asyncio task
    scheduled during POST would be cancelled before the subsequent GET.  A
    timestamp-based transition gives the same queue/running/succeeded
    lifecycle in both TestClient and a long-running worker process.
    """
    if _execution_mode() != "mock" or record.mock_ready_at is None or record.status in {"succeeded", "failed", "canceled"}:
        return
    now = time.time()
    if record.cancel_requested or record.status == "cancel_requested":
        record.status = "canceled"
        record.progress = 0
    elif now >= record.mock_ready_at:
        record.status = "succeeded"
        record.progress = 100
        record.result = {
            "asset_ref": f"sdv-asset:{record.id}",
            "download_url": f"{settings.API_PREFIX}/tasks/{record.id}/result",
            "content_type": "video/mp4",
            "file_name": f"{record.id}.mp4",
            "sha256": hashlib.sha256(MOCK_VIDEO).hexdigest(),
        }
    elif now >= record.mock_ready_at - 0.08:
        record.status = "running"
        record.progress = 70
    else:
        record.status = "running"
        record.progress = 5
    record.updated_at = now


def _task_payload(record: TaskRecord) -> dict[str, Any]:
    return {
        "task_id": record.id,
        "status": record.status,
        "progress": record.progress,
        "model": record.model,
        "provider": getattr(record, "provider", ""),
        "provider_task_id": getattr(record, "provider_task_id", None),
        "attempt": record.attempt,
        "created_at": record.created_at,
        "updated_at": record.updated_at,
        "result": record.result,
        "error": record.error,
        "project_id": record.request.get("project_id"),
        "node_id": record.request.get("node_id"),
        "conversation_id": record.request.get("conversation_id"),
        "reconciliation": record.request.get("_reconciliation"),
    }


async def _run_mock_task(task_id: str) -> None:
    try:
        initial = await task_store.get_by_id(task_id)
        if initial is None or initial.cancel_requested:
            await task_store.update(task_id, status="canceled", progress=0)
            return
        await task_store.update(task_id, status="running", progress=5)
        await asyncio.sleep(0.05)
        record = await task_store.update(task_id, progress=70)
        if record is None or record.cancel_requested:
            await task_store.update(task_id, status="canceled", progress=0)
            return
        await asyncio.sleep(0.05)
        record = await task_store.get_by_id(task_id)
        if record is None or record.cancel_requested:
            await task_store.update(task_id, status="canceled", progress=0)
            return
        await task_store.update(
            task_id,
            status="succeeded",
            progress=100,
            result={
                "asset_ref": f"sdv-asset:{task_id}",
                "download_url": f"{settings.API_PREFIX}/tasks/{task_id}/result",
                "content_type": "video/mp4",
                "file_name": f"{task_id}.mp4",
                "sha256": hashlib.sha256(MOCK_VIDEO).hexdigest(),
            },
        )
    finally:
        task_runs.pop(task_id, None)


def _schedule_mock_task(task_id: str) -> None:
    running = task_runs.get(task_id)
    if running is not None and not running.done():
        running.cancel()
    task_runs[task_id] = asyncio.create_task(_run_mock_task(task_id))


@router.post("/tasks", status_code=status.HTTP_202_ACCEPTED)
async def create_task(request: CreateTaskRequest, http_request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("tasks:write"))]):
    if request.scope not in {"personal", "team"}:
        raise HTTPException(status_code=400, detail="invalid scope")
    if _rollout_mode() == "disabled" and "tasks:drain" not in principal.scopes:
        raise HTTPException(status_code=503, detail="sd-video rollout is disabled")
    if _rollout_mode() == "shadow" and "tasks:drain" not in principal.scopes:
        raise HTTPException(status_code=409, detail="shadow validates requests only; no task was created")
    configured = next((item for item in await model_store.list() if item["key"] == request.model), None)
    from app.providers.seedance import seedance_provider_registry
    upstream = seedance_provider_registry.submission_provider(request.model)
    namespace = seedance_provider_registry.get(upstream).namespace
    for reference in request.references:
        if reference.storage_token:
            await _completed_input(principal, reference.storage_token)
        if reference.role not in {None, "reference", "reference_image", "first_frame", "last_frame"}:
            raise HTTPException(status_code=400, detail="invalid reference role")
        if reference.kind not in {"image", "video", "audio"}:
            raise HTTPException(status_code=400, detail="invalid reference kind")
        if reference.asset_ref and reference.asset_ref.startswith("asset://"):
            if configured and configured.get("provider") in {"vidu", "yike"}: raise HTTPException(status_code=400, detail="model does not support provider assets")
            active = await volcano_store.active_reference(principal, reference.asset_ref.removeprefix("asset://"), namespace)
            if active is None:
                raise HTTPException(status_code=403, detail="provider asset is not owned or Active")
        elif not reference.storage_token:
            raise HTTPException(status_code=400, detail="reference requires a completed input or an authorized provider asset")
    if request.conversation_id:
        current = await catalog_store.get_conversation(principal, request.conversation_id) if catalog_store else conversation_store.get(request.conversation_id)
        if current is None or current["owner_subject"] != principal.subject or current["workspace_id"] != principal.workspace_id:
            raise HTTPException(status_code=404, detail="conversation not found")
    if _execution_mode() not in {"mock", "provider"}:
        raise HTTPException(status_code=503, detail="unsupported execution mode")

    payload = request.model_dump(mode="json")
    payload.update(upstream_provider=upstream, provider_namespace=namespace)
    if _execution_mode() != "mock":
        if configured is None or not public_model(configured).get("available", True): raise HTTPException(status_code=400, detail="model is unavailable")
        payload["model_config"] = public_model(configured)
    record, created = await task_store.create(principal, payload)
    if created:
        # In-memory mock tasks keep their fast deterministic lifecycle for
        # unit tests.  Every durable task is also published to Redis; the
        # Worker polls PostgreSQL as a lossless fallback when Redis is down.
        if isinstance(task_store, InMemoryTaskStore) and _execution_mode() == "mock":
            _schedule_mock_task(record.id)
        else:
            await task_queue.enqueue(record.id)
    return ok(_task_payload(record), http_request)


@router.get("/tasks")
async def list_tasks(http_request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("tasks:read"))]):
    page = Page.read(http_request.query_params)
    if isinstance(task_store, PostgresTaskStore):
        result = await task_store.page(principal, page)
    else:
        records = await task_store.list(principal)
        result = page.slice(sorted(records, key=lambda item: (item.created_at, item.id), reverse=True))
    result["items"] = [_task_payload(item) for item in result["items"]]
    return ok(result, http_request)


@router.get("/tasks/{task_id}")
async def get_task(task_id: str, http_request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("tasks:read"))]):
    record = await task_store.get(principal, task_id)
    if record is None:
        raise HTTPException(status_code=404, detail="task not found")
    return ok(_task_payload(record), http_request)


@router.post("/tasks/{task_id}/cancel")
async def cancel_task(task_id: str, http_request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("tasks:write"))]):
    record = await task_store.get(principal, task_id)
    if record is None:
        raise HTTPException(status_code=404, detail="task not found")
    if record.status == "failed" and (record.error or {}).get("code") == "submission_uncertain":
        # 上游 ID 未知时不能保证真实取消；本地弃用且保留不确定错误，禁止恢复/重试。
        updated = await task_store.update(task_id, expected_error_code="submission_uncertain", cancel_requested=True, status="canceled")
        if updated is not None:
            return ok(_task_payload(updated), http_request)
        # 若核对已先绑定成功，按正常在途取消交给 Worker，不能丢失真实上游取消。
        record = (await task_store.get(principal, task_id)) or record
    if record.status in {"succeeded", "failed", "canceled", "cancel_requested"}:
        return ok(_task_payload(record), http_request)
    await task_store.update(task_id, cancel_requested=True, status="cancel_requested")
    current = (await task_store.get(principal, task_id)) or record
    return ok(_task_payload(current), http_request)


@router.post("/tasks/{task_id}/retry", status_code=status.HTTP_202_ACCEPTED)
async def retry_task(task_id: str, http_request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("tasks:write"))]):
    if _rollout_mode() != "active" and "tasks:drain" not in principal.scopes: raise HTTPException(status_code=503, detail="new tasks are disabled")
    record = await task_store.get(principal, task_id)
    if record is None:
        raise HTTPException(status_code=404, detail="task not found")
    if record.status not in {"failed", "canceled"}:
        raise HTTPException(status_code=409, detail="only failed or canceled tasks can be retried")
    if (record.error or {}).get("code") == "submission_uncertain":
        raise HTTPException(status_code=409, detail="provider submission must be reconciled before retry")
    payload = {**record.request, "idempotency_key": f"retry:{record.id}", "attempt": record.attempt + 1, "retry_of": record.id}
    payload.pop("_reconciliation", None)
    if await http_request.body():
        linkage = await http_request.json()
        if not isinstance(linkage, dict) or not linkage.keys() <= {"studio_job_id", "studio_message_id"}:
            raise HTTPException(status_code=400, detail="invalid retry linkage")
        for key, value in linkage.items():
            if value is not None and (not isinstance(value, str) or len(value) > 160):
                raise HTTPException(status_code=400, detail="invalid retry linkage")
            payload[key] = value
    retried, created = await task_store.create(principal, payload)
    task_id = retried.id
    if isinstance(task_store, InMemoryTaskStore) and _execution_mode() == "mock":
        _schedule_mock_task(task_id)
    else:
        await task_queue.enqueue(task_id)
    return ok(_task_payload((await task_store.get(principal, task_id)) or retried), http_request)


@router.get("/tasks/{task_id}/result")
async def task_result(task_id: str, principal: Annotated[ServicePrincipal, Depends(require_scope("tasks:read"))]):
    record = await task_store.get(principal, task_id)
    if record is None or record.status != "succeeded":
        raise HTTPException(status_code=404, detail="task result not available")
    storage_key = str((record.result or {}).get("storage_key") or "")
    if storage_key:
        try:
            body = await local_storage.get(storage_key)
        except (FileNotFoundError, OSError, ValueError):
            raise HTTPException(status_code=404, detail="task result is not available")
    else:
        if _execution_mode() != "mock":
            raise HTTPException(status_code=409, detail="result storage is not ready")
        body = MOCK_VIDEO
    content_type = str((record.result or {}).get("content_type") or "video/mp4")
    file_name = str((record.result or {}).get("file_name") or f"{task_id}.mp4")
    return Response(content=body, media_type=content_type, headers={"Content-Disposition": f'inline; filename="{file_name}"'})


@router.get("/tasks/{task_id}/events")
async def task_events(task_id: str, http_request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("tasks:read"))]):
    record = await task_store.get(principal, task_id)
    if record is None:
        raise HTTPException(status_code=404, detail="task not found")
    payload = _task_payload(record)
    durable_events = await task_store.events(principal, task_id) if hasattr(task_store, "events") else []

    async def stream():
        import json
        if durable_events:
            for event in durable_events:
                yield f"event: task\ndata: {json.dumps({**payload, **event}, ensure_ascii=False)}\n\n"
        else:
            yield f"event: task\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"X-Request-ID": http_request.headers.get("x-request-id", "")})


@router.get("/models")
async def list_models(http_request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("models:read"))]):
    del principal
    return ok({"items": [public_model(item) for item in await model_store.list()]}, http_request)


@router.post("/inputs/presign")
async def presign_input(request: InputPresignRequest, http_request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("assets:write"))]):
    if request.size_bytes > settings.MAX_INPUT_BYTES:
        raise HTTPException(status_code=413, detail="input is too large")
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", request.name).strip("._") or "input.bin"
    safe_name = safe_name[:180]
    token = f"inputs/{principal.workspace_id}/{principal.subject}/{uuid.uuid4().hex}-{safe_name}"
    await input_store.issue(principal, token, request.content_type, request.size_bytes)
    return ok({"upload_token": token, "upload_url": f"{settings.API_PREFIX}/inputs/{token}", "expires_in": 900, "content_type": request.content_type, "size_bytes": request.size_bytes}, http_request)


@router.post("/inputs/complete")
async def complete_input(request: InputCompleteRequest, http_request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("assets:write"))]):
    token = _scoped_input_token(principal, request.upload_token)
    async with input_store.transfer(token):
        return await _complete_input(request, http_request, principal, token)


async def _complete_input(request, http_request, principal, token):
    issued = await input_store.get(principal, token)
    if issued is None or issued["status"] not in {"pending", "complete"}: raise HTTPException(status_code=404, detail="input not found")
    try:
        body = await local_storage.get(token)
    except (FileNotFoundError, OSError):
        raise HTTPException(status_code=409, detail="input upload is incomplete")
    digest = hashlib.sha256(body).hexdigest()
    if not body or len(body) > settings.MAX_INPUT_BYTES or (request.sha256 and request.sha256 != digest):
        raise HTTPException(status_code=400, detail="input size or checksum mismatch")
    if issued["size_bytes"] and issued["size_bytes"] != len(body): raise HTTPException(status_code=400, detail="input size mismatch")
    if not await input_store.complete(principal, token, len(body), digest): raise HTTPException(status_code=409, detail="input no longer available")
    return ok({"asset_ref": f"sdv-input:{token}", "storage_key": token, "sha256": digest}, http_request)


@router.put("/inputs/{upload_token:path}")
async def upload_input(upload_token: str, request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("assets:write"))]):
    token = _scoped_input_token(principal, upload_token)
    async with input_store.transfer(token):
        issued = await input_store.get(principal, token)
        if issued is None or issued["status"] != "pending": raise HTTPException(status_code=409, detail="input is not awaiting upload")
        body = await _read_limited_body(request, settings.MAX_INPUT_BYTES)
        await local_storage.put(token, body, issued["content_type"])
        return ok({"storage_key": token, "bytes": len(body)}, request)


@router.get("/capacity")
async def capacity(http_request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("models:read"))]):
    models = await model_store.list()
    if hasattr(task_store, "capacity"):
        active = await task_store.capacity()
    else:
        active = {}
        for item in task_store._tasks.values():
            if item.status in {"running", "cancel_requested"}: active[item.model] = active.get(item.model, 0) + 1
    return ok({item["key"]: {"active": active.get(item["key"], 0), "limit": int(item.get("concurrency_limit", 1)), "available": bool(item.get("available", True))} for item in models}, http_request)


@router.post("/conversations")
async def create_conversation(request: ConversationRequest, http_request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("conversations:write"))]):
    if catalog_store is not None:
        return ok(await catalog_store.create_conversation(principal, request.title, request.id), http_request)
    conversation_id = request.id or f"sdvc_{uuid.uuid4().hex}"
    if conversation_id in conversation_store:
        current = conversation_store[conversation_id]
        if current["owner_subject"] != principal.subject or current["workspace_id"] != principal.workspace_id: raise HTTPException(status_code=409, detail="conversation id conflict")
        return ok(current,http_request)
    conversation_store[conversation_id] = {"id": conversation_id, "owner_subject": principal.subject, "workspace_id": principal.workspace_id, "title": request.title, "created_at": time.time(), "version": 1}
    message_store[conversation_id] = []
    return ok(conversation_store[conversation_id], http_request)


@router.get("/conversations")
async def list_conversations(http_request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("conversations:read"))]):
    page, search = Page.read(http_request.query_params), keyword(http_request.query_params)
    if catalog_store is not None:
        return ok(await catalog_store.conversation_page(principal, page, search), http_request)
    items = [item for item in conversation_store.values() if item["owner_subject"] == principal.subject
             and item["workspace_id"] == principal.workspace_id and search in item["title"].lower()]
    return ok(page.slice(sorted(items, key=lambda item: record_order(item, "updated_at"), reverse=True)), http_request)


@router.get("/conversations/{conversation_id}/messages")
async def list_messages(conversation_id: str, http_request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("conversations:read"))]):
    page = Page.read(http_request.query_params)
    if catalog_store is not None:
        messages = await catalog_store.message_page(principal, conversation_id, page)
        if messages is None:
            raise HTTPException(status_code=404, detail="conversation not found")
        return ok(messages, http_request)
    conversation = conversation_store.get(conversation_id)
    if conversation is None or conversation["owner_subject"] != principal.subject or conversation["workspace_id"] != principal.workspace_id:
        raise HTTPException(status_code=404, detail="conversation not found")
    return ok(page.slice(sorted(message_store.get(conversation_id, []), key=record_order)), http_request)


@router.patch("/conversations/{conversation_id}")
async def update_conversation(conversation_id: str, request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("conversations:write"))]):
    payload = await request.json()
    title = str(payload.get("title") or "新对话")[:200]
    version = int(payload.get("version", 1))
    if catalog_store is not None:
        current = await catalog_store.get_conversation(principal, conversation_id)
        if current is None: raise HTTPException(status_code=404, detail="conversation not found")
        updated = await catalog_store.update_conversation(principal, conversation_id, title, version)
        if updated is None: raise HTTPException(status_code=409, detail="conversation version conflict")
    else:
        updated = conversation_store.get(conversation_id)
        if updated is None or updated["owner_subject"] != principal.subject or updated["workspace_id"] != principal.workspace_id: raise HTTPException(status_code=404, detail="conversation not found")
        if updated.get("version", 1) != version: raise HTTPException(status_code=409, detail="conversation version conflict")
        updated.update(title=title, version=version+1, updated_at=time.time())
    return ok(updated, request)


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str, http_request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("conversations:write"))]):
    if catalog_store is not None:
        if not await catalog_store.delete_conversation(principal, conversation_id):
            raise HTTPException(status_code=404, detail="conversation not found")
        return ok({"deleted": True, "id": conversation_id}, http_request)
    conversation = conversation_store.get(conversation_id)
    if conversation is None or conversation["owner_subject"] != principal.subject or conversation["workspace_id"] != principal.workspace_id:
        raise HTTPException(status_code=404, detail="conversation not found")
    conversation_store.pop(conversation_id, None)
    message_store.pop(conversation_id, None)
    return ok({"deleted": True, "id": conversation_id}, http_request)


@router.post("/messages")
async def create_message(request: MessageRequest, http_request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("conversations:write"))]):
    await _validate_message_links(principal, request.model_dump())
    if catalog_store is not None:
        message = await catalog_store.create_message(principal, request.conversation_id, request.model_dump(mode="json"))
        if message is None:
            raise HTTPException(status_code=404, detail="conversation not found")
        return ok(message, http_request)
    conversation = conversation_store.get(request.conversation_id)
    if conversation is None or conversation["owner_subject"] != principal.subject or conversation["workspace_id"] != principal.workspace_id:
        raise HTTPException(status_code=404, detail="conversation not found")
    for existing in message_store.get(request.conversation_id, []):
        if request.id and existing["id"] == request.id: return ok(existing, http_request)
    message = {**request.model_dump(), "id": request.id or f"sdvm_{uuid.uuid4().hex}", "created_at": time.time(), "version": 1}
    message_store.setdefault(request.conversation_id, []).append(message)
    return ok(message, http_request)


@router.patch("/messages/{message_id}")
async def update_message(message_id: str, request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("conversations:write"))]):
    payload = await request.json()
    await _validate_message_links(principal, payload)
    if catalog_store is not None:
        message = await catalog_store.update_message(principal, message_id, payload)
        if message is None:
            raise HTTPException(status_code=404, detail="message not found")
        return ok(message, request)
    for messages in message_store.values():
        for message in messages:
            if message["id"] != message_id:
                continue
            conversation = conversation_store.get(message["conversation_id"])
            if conversation and conversation["owner_subject"] == principal.subject and conversation["workspace_id"] == principal.workspace_id:
                if int(payload.get("version", 1)) != message.get("version", 1): raise HTTPException(status_code=409, detail="message version conflict")
                message["version"] = message.get("version", 1) + 1
                for key in ("metadata", "attachments", "role", "task_id"):
                    if key in payload: message[key] = payload[key]
                if "text" in payload:
                    message["text"] = str(payload["text"])
                if "video_url" in payload:
                    message["video_url"] = payload["video_url"]
                return ok(message, request)
    raise HTTPException(status_code=404, detail="message not found")


@router.get("/media")
async def list_media(http_request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("assets:read"))]):
    page, filters = Page.read(http_request.query_params), MediaFilter.read(http_request.query_params)
    if catalog_store is not None:
        return ok(await catalog_store.media_page(principal, page, filters), http_request)
    return ok(page.slice(_local_media(principal, filters)), http_request)


@router.get("/media/mentions")
async def media_mentions(http_request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("assets:read"))]):
    page = Page.read(http_request.query_params, maximum=MENTION_PAGE_SIZE, default=MENTION_PAGE_SIZE)
    filters = MediaFilter.read(http_request.query_params)
    if catalog_store is not None:
        return ok(await catalog_store.media_page(principal, page, filters), http_request)
    return ok(page.slice(_local_media(principal, filters)), http_request)


@router.get("/media/stats")
async def media_stats(http_request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("assets:read"))]):
    filters = MediaFilter.read(http_request.query_params)
    if catalog_store is not None:
        return ok(await catalog_store.media_stats(principal, filters), http_request)
    return ok(summarize_media(_local_media(principal, filters)), http_request)


@router.patch("/media/{media_id}")
async def update_media(media_id: str, request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("assets:write"))]):
    if catalog_store is not None:
        item = await catalog_store.update_media(principal, media_id, await request.json())
        if item is None:
            raise HTTPException(status_code=404, detail="media not found")
        return ok(item, request)
    item = media_store.get(media_id)
    if item is None or item["owner_subject"] != principal.subject or item["workspace_id"] != principal.workspace_id:
        raise HTTPException(status_code=404, detail="media not found")
    payload = await request.json()
    item.update({key: value for key, value in payload.items() if key in {"name", "metadata"}})
    return ok(item, request)


@router.delete("/media/{media_id}")
async def delete_media(media_id: str, http_request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("assets:write"))]):
    if catalog_store is not None:
        if not await catalog_store.delete_media(principal, media_id):
            raise HTTPException(status_code=404, detail="media not found")
        return ok({"deleted": True}, http_request)
    item = media_store.get(media_id)
    if item is None or item["owner_subject"] != principal.subject or item["workspace_id"] != principal.workspace_id:
        raise HTTPException(status_code=404, detail="media not found")
    media_store.pop(media_id, None)
    return ok({"deleted": True}, http_request)


@router.get("/volcano/tags")
async def volcano_tags(http_request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("assets:read"))]):
    page, search = Page.read(http_request.query_params), keyword(http_request.query_params)
    if catalog_store is not None:
        return ok(await catalog_store.page_tags(principal, page, search), http_request)
    tags = [tag for (workspace_id, _), tag in volcano_tags_store.items() if workspace_id == principal.workspace_id and search in tag["name"].lower()]
    return ok(page.slice(sorted(tags, key=lambda item: (item["name"], item["id"]))), http_request)


@router.get("/volcano/assets")
async def volcano_assets(http_request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("assets:read"))]):
    page = await volcano_store.page(principal, Page.assets(http_request.query_params), VolcanoFilter.read(http_request.query_params))
    page["items"] = await _asset_views(principal, page["items"])
    return ok(page, http_request)


@router.get("/volcano/assets/{asset_id}")
async def volcano_asset(asset_id: str, http_request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("assets:read"))]):
    item = await volcano_store.get(principal, asset_id)
    if item is None: raise HTTPException(status_code=404, detail="asset not found")
    return ok((await _asset_views(principal, [item]))[0], http_request)


@router.post("/volcano/ensure-active")
async def ensure_volcano_active(http_request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("assets:read"))]):
    payload = await http_request.json()
    ids = payload.get("asset_ids")
    if not isinstance(ids, list) or len(ids) > 100 or any(not isinstance(value, str) or not value or len(value) > 512 for value in ids):
        raise HTTPException(status_code=400, detail="invalid asset references")
    from app.providers.seedance import seedance_provider_registry
    namespace = seedance_provider_registry.get(settings.SEEDANCE20_PROVIDER).namespace
    for value in dict.fromkeys(ids):
        if await volcano_store.active_reference(principal, value.removeprefix("asset://"), namespace) is None:
            raise HTTPException(status_code=409, detail="asset not owned or not active in current provider namespace")
    return ok({"active": True}, http_request)


@router.post("/volcano/tags")
async def create_volcano_tag(request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("assets:write"))]):
    payload = await request.json()
    name = str(payload.get("name") or "").strip()
    color = str(payload.get("color") or "")
    if not name or len(name) > 100 or (color and not re.fullmatch(r"#[0-9a-fA-F]{6}", color)):
        raise HTTPException(status_code=400, detail="tag name is required")
    if catalog_store is not None:
        return ok(await catalog_store.create_tag(principal, name, color), request)
    tag = {"id": f"sdvt_{uuid.uuid4().hex}", "name": name, "color": color, "workspace_id": principal.workspace_id, "created_at": time.time()}
    volcano_tags_store[(principal.workspace_id, name.casefold())] = tag
    return ok(tag, request)


@router.delete("/volcano/tags/{tag_id}")
async def delete_volcano_tag(tag_id: str, http_request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("assets:write"))]):
    if catalog_store is not None:
        return ok({"deleted": await catalog_store.delete_tag(principal, tag_id), "id": tag_id}, http_request)
    for key, tag in list(volcano_tags_store.items()):
        if key[0] == principal.workspace_id and tag["id"] == tag_id:
            volcano_tags_store.pop(key, None)
            for item in volcano_store.items.values():
                if item["workspace_id"] == principal.workspace_id:
                    item["tags"] = [value for value in item.get("tags", []) if value != tag_id]
            break
    return ok({"deleted": True, "id": tag_id}, http_request)


@router.post("/volcano/assets")
async def create_volcano_asset(http_request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("assets:write"))]):
    payload = await http_request.json()
    return ok(await register_material(principal, payload), http_request)


async def register_material(principal, payload):
    if _rollout_mode() != "active": raise HTTPException(status_code=503, detail="new registrations are disabled")
    token = await _completed_input(principal, str(payload.get("storage_token") or ""))
    kind = payload.get("kind", "image")
    if kind not in {"image", "video", "audio"}: raise HTTPException(status_code=400, detail="invalid asset kind")
    from app.providers.seedance import seedance_provider_registry
    provider = seedance_provider_registry.get(settings.SEEDANCE20_PROVIDER)
    if _execution_mode() != "mock" and not provider.configured(): raise HTTPException(status_code=503, detail="asset provider is not configured")
    asset = await volcano_store.create(principal, {"storage_key": token, "kind": kind,
        "name": str(payload.get("name") or "素材")[:200], "description": str(payload.get("description") or "")[:2000], "tags": await _validated_asset_tags(principal, payload.get("tags") or []),
        "upstream_provider": provider.name, "provider_namespace": provider.namespace})
    return (await _asset_views(principal, [asset]))[0]


@router.put("/volcano/assets/{asset_id}")
async def update_volcano_asset(asset_id: str, http_request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("assets:write"))]):
    payload = await http_request.json()
    if not payload.keys() <= {"name", "tags", "description"}: raise HTTPException(status_code=400, detail="only asset metadata can be edited")
    if "tags" in payload: payload["tags"] = await _validated_asset_tags(principal, payload["tags"])
    asset = await volcano_store.edit(principal, asset_id, payload)
    if asset is None: raise HTTPException(status_code=404, detail="volcano asset not found")
    return ok((await _asset_views(principal, [asset]))[0], http_request)


@router.delete("/volcano/assets/{asset_id}")
async def delete_volcano_asset(asset_id: str, http_request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("assets:write"))]):
    asset = await volcano_store.edit(principal, asset_id, {"delete": True})
    if asset is None: raise HTTPException(status_code=404, detail="volcano asset not found")
    return ok({"deleted": False, "status": "delete_requested", "id": asset_id}, http_request)


@router.post("/toolkit/erase")
async def erase_tool(request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("toolkit:write"))]):
    payload = await request.json()
    if _rollout_mode() != "active" and "tasks:drain" not in principal.scopes: raise HTTPException(status_code=503, detail="new tasks are disabled")
    token = await _completed_input(principal, str(payload.get("storage_token") or ""))
    if _execution_mode() != "mock" and not settings.AMK_API_KEY: raise HTTPException(status_code=503, detail="MediaKit is not configured")
    mode = payload.get("mode") or "standard"
    if mode not in {"standard", "pro"}: raise HTTPException(status_code=400, detail="invalid erase mode")
    task, created = await task_store.create(principal, {"idempotency_key": payload.get("idempotency_key") or f"erase:{uuid.uuid4().hex}", "model": "toolkit/erase", "provider": "mediakit", "tool_mode": mode, "studio_job_id": payload.get("studio_job_id"), "references": [{"kind": "video", "storage_token": token}]})
    if created:
        if isinstance(task_store, InMemoryTaskStore) and _execution_mode() == "mock": _schedule_mock_task(task.id)
        else: await task_queue.enqueue(task.id)
    return ok({"id": task.id, **_task_payload(task)}, request)


@router.get("/toolkit/erase/{erase_id}")
async def get_erase_tool(erase_id: str, http_request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("toolkit:read"))]):
    record = await task_store.get(principal, erase_id)
    if record is None or record.model != "toolkit/erase":
        raise HTTPException(status_code=404, detail="erase task not found")
    return ok({"id": record.id, **_task_payload(record)}, http_request)


@router.get("/admin/models")
async def admin_models(http_request: Request, principal: Annotated[ServicePrincipal, Depends(require_admin)]):
    del principal
    return ok({"items": [public_model(item) for item in await model_store.list()]}, http_request)


@router.put("/admin/models/{model_key}")
async def update_admin_model(model_key: str, request: ModelUpdateRequest, http_request: Request, principal: Annotated[ServicePrincipal, Depends(require_admin)]):
    del principal
    if model_key not in settings.MODELS:
        raise HTTPException(status_code=404, detail="model not found")
    updated = await model_store.update(model_key, request.model_dump(exclude_none=True))
    return ok(public_model(updated), http_request)


@router.post("/admin/models/{model_key}/test")
async def test_admin_model(model_key: str, http_request: Request, principal: Annotated[ServicePrincipal, Depends(require_admin)]):
    if model_key not in settings.MODELS:
        raise HTTPException(status_code=404, detail="model not found")
    # 使用已有任务的只读查询验证 Provider，不隐式创建付费任务。
    records = await task_store.list(principal)
    probe = next((item for item in records if item.model == model_key and item.provider_task_id), None)
    if probe is None:
        return ok({"key": model_key, "ok": False, "error_category": "probe_task_required", "message": "no provider task available for a non-billable verification"}, http_request)
    from worker.processor import _provider_for, _query_upstream
    started = time.monotonic()
    try:
        provider, model_id = await _provider_for(probe)
        await _query_upstream(probe, provider, probe.provider_task_id, model_id)
        return ok({"key": model_key, "ok": True, "latency_ms": int((time.monotonic()-started)*1000)}, http_request)
    except Exception as exc:
        return ok({"key": model_key, "ok": False, "latency_ms": int((time.monotonic()-started)*1000), "error_category": type(exc).__name__}, http_request)


@router.get("/admin/stats")
async def admin_stats(http_request: Request, principal: Annotated[ServicePrincipal, Depends(require_admin)]):
    from app.usage_stats import workspace_stats
    return ok(await workspace_stats(principal), http_request)


async def _validated_asset_tags(principal, values):
    if not isinstance(values, list) or len(values) > 100 or any(not isinstance(item, str) for item in values):
        raise HTTPException(status_code=400, detail="invalid tags")
    tags = await _find_tags(principal, values)
    if not set(values) <= {item["id"] for item in tags}: raise HTTPException(status_code=403, detail="tag scope mismatch")
    return list(dict.fromkeys(values))


async def _find_tags(principal, ids):
    if catalog_store:
        return await catalog_store.find_tags(principal, ids)
    wanted = set(ids)
    return [tag for (workspace, _), tag in volcano_tags_store.items() if workspace == principal.workspace_id and tag["id"] in wanted]


async def _asset_views(principal, items):
    tags = {tag["id"]: tag for tag in await _find_tags(principal, {tag for item in items for tag in item.get("tags", [])})}
    return [{**public_asset(item), "tag_details": [tags[tag] for tag in item.get("tags", []) if tag in tags]} for item in items]


from app.asset_routes import register_asset_routes
register_asset_routes(router)
register_reconciliation_routes(router)
