"""管理员核对只绑定已存在的上游任务，或记录人工确认未创建；从不提交生成。"""
import asyncio
import copy
import time
from datetime import datetime
from typing import Annotated, Literal

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator
from psycopg.types.json import Jsonb

from app.core.auth import ServicePrincipal, require_admin
from app.core.envelope import ok

# 核对仅允许短时只读查询；证据只保存运维记录编号，不接收 URL、密钥或任意描述。
PROBE_TIMEOUT_SECONDS = 15
UNCERTAIN = "submission_uncertain"
CONFIRMED_ABSENT = "submission_not_created_verified"
PROVIDER_STATUSES = {"queued", "pending", "running", "processing", "succeeded", "failed", "error", "canceled", "cancelled", "expired", "timeout"}


class ReconciliationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: Literal["bind_existing", "confirm_not_submitted"]
    expected_attempt: int = Field(ge=1)
    evidence_ref: str = Field(min_length=1, max_length=160, pattern=r"^[A-Za-z0-9_-]+$")
    confirmed: Literal[True]
    provider_task_id: str | None = Field(default=None, min_length=1, max_length=200, pattern=r"^[A-Za-z0-9_.:-]+$")

    @model_validator(mode="after")
    def validate_decision(self):
        if (self.decision == "bind_existing") != bool(self.provider_task_id):
            raise ValueError("provider_task_id must be present only for bind_existing")
        return self


def existing_decision(audit, request):
    if audit is None:
        return False
    if any(audit.get(key) != value for key, value in request.model_dump(exclude={"confirmed"}).items()):
        raise ValueError("reconciliation decision conflict")
    return True


def validate_pending(record, request):
    lease_expires = getattr(record, "lease_expires_at", None) or 0
    if isinstance(lease_expires, datetime):
        lease_expires = lease_expires.timestamp()
    if (record.status != "failed" or (record.error or {}).get("code") != UNCERTAIN
            or record.provider_task_id or record.cancel_requested or record.attempt != request.expected_attempt
            or lease_expires > time.time()):
        raise ValueError("task reconciliation state conflict")


class TaskReconciliationStore:
    def __init__(self, tasks):
        self.tasks = tasks
        self.audits = {}

    async def read(self, target, task_id):
        record = await self.tasks.get(target, task_id)
        if record is None:
            return None, None
        if not hasattr(self.tasks, "database_url"):
            return record, copy.deepcopy(self.audits.get(task_id))
        async with self.tasks._connection() as connection:
            cursor = await connection.execute("""select a.* from task_reconciliations a join tasks t on t.id=a.task_id
                where a.task_id=%s and t.owner_subject=%s and t.workspace_id=%s""",
                [task_id, target.subject, target.workspace_id])
            row = await cursor.fetchone()
        return record, dict(row) if row else None

    async def apply(self, target, actor, task_id, request, request_id, provider_status, provider_name=None):
        audit = dict(request.model_dump(exclude={"confirmed"}), actor_subject=actor.subject,
                     request_id=request_id, provider_status=provider_status, reviewed_at=time.time())
        summary = {"decision": request.decision, "attempt": request.expected_attempt}
        error = None if request.decision == "bind_existing" else {
            "code": CONFIRMED_ABSENT, "message": "operator confirmed no upstream task; explicit retry is permitted"}
        state = "running" if request.decision == "bind_existing" else "failed"
        if not hasattr(self.tasks, "database_url"):
            async with self.tasks._lock:
                record = self.tasks._tasks.get(task_id)
                if record is None or record.owner_subject != target.subject or record.workspace_id != target.workspace_id:
                    return None
                if existing_decision(self.audits.get(task_id), request):
                    return record
                validate_pending(record, request)
                bound_provider = provider_name or record.provider
                if request.provider_task_id and any(item.id != task_id and item.provider_task_id == request.provider_task_id
                        and item.provider == bound_provider
                        and item.request.get("provider_namespace", "") == record.request.get("provider_namespace", "")
                        and item.request.get("upstream_provider", "") == record.request.get("upstream_provider", "")
                        for item in self.tasks._tasks.values()):
                    raise ValueError("provider task binding conflict")
                self.audits[task_id] = dict(audit, task_id=task_id, previous_error=copy.deepcopy(record.error))
                record.request = {**record.request, "_reconciliation": summary}
                record.provider_task_id, record.status, record.error = request.provider_task_id, state, error
                record.provider = bound_provider
                record.lease_owner, record.lease_expires_at, record.next_poll_at = None, None, 0
                record.updated_at = time.time()
                return record
        async with self.tasks._connection() as connection:
            # 锁序固定：上游 ID 防重复认领锁，再锁本地任务；核对与取消通过行锁串行化。
            if request.provider_task_id:
                await connection.execute("select pg_advisory_xact_lock(hashtextextended(%s,0))", ["sdvideo:bind:" + request.provider_task_id])
            cursor = await connection.execute("select * from tasks where id=%s and owner_subject=%s and workspace_id=%s for update",
                                              [task_id, target.subject, target.workspace_id])
            row = await cursor.fetchone()
            if row is None:
                return None
            cursor = await connection.execute("select * from task_reconciliations where task_id=%s", [task_id])
            if existing_decision(await cursor.fetchone(), request):
                return self.tasks._record(row)
            record = self.tasks._record(row)
            validate_pending(record, request)
            bound_provider = provider_name or record.provider
            if request.provider_task_id:
                cursor = await connection.execute("""select 1 from tasks where provider_task_id=%s and id<>%s and provider=%s
                    and coalesce(request->>'provider_namespace','')=%s and coalesce(request->>'upstream_provider','')=%s limit 1""",
                    [request.provider_task_id, task_id, bound_provider, record.request.get("provider_namespace") or "", record.request.get("upstream_provider") or ""])
                if await cursor.fetchone():
                    raise ValueError("provider task binding conflict")
            await connection.execute("""insert into task_reconciliations(task_id,actor_subject,expected_attempt,decision,
                evidence_ref,provider_task_id,provider_status,previous_error,request_id)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                [task_id, actor.subject, request.expected_attempt, request.decision, request.evidence_ref,
                 request.provider_task_id, provider_status, Jsonb(record.error), request_id])
            cursor = await connection.execute("""update tasks set status=%s,provider_task_id=%s,error=%s,provider=%s,
                request=request || %s,lease_owner=null,lease_expires_at=null,next_poll_at=now(),updated_at=now()
                where id=%s returning *""", [state, request.provider_task_id, Jsonb(error), bound_provider, Jsonb({"_reconciliation": summary}), task_id])
            updated = await cursor.fetchone()
            await connection.execute("insert into task_events(task_id,status,progress,payload) values (%s,%s,%s,%s)",
                [task_id, state, record.progress, Jsonb({"action": "reconciliation", **summary, "actor_subject": actor.subject,
                                                       "evidence_ref": request.evidence_ref, "request_id": request_id})])
            await connection.commit()
            return self.tasks._record(updated)


def register_reconciliation_routes(router):
    async def load(owner_subject, task_id, actor):
        from app import standalone_api as api
        # 身份始终是 JWT sub；owner_subject 是管理员的目标资源，不是来路身份。
        target = ServicePrincipal(owner_subject, actor.workspace_id, "member", frozenset())
        record, audit = await api.reconciliation_store.read(target, task_id)
        if record is None:
            raise HTTPException(status_code=404, detail="task not found")
        return target, record, audit

    @router.get("/admin/owners/{owner_subject}/tasks/{task_id}/reconciliation")
    async def inspect(owner_subject: str, task_id: str, request: Request,
                      actor: Annotated[ServicePrincipal, Depends(require_admin)]):
        _, record, audit = await load(owner_subject, task_id, actor)
        return ok({"task_id": record.id, "owner_subject": record.owner_subject, "workspace_id": record.workspace_id,
                   "model": record.model, "provider": record.provider, "status": record.status, "attempt": record.attempt,
                   "provider_task_id": record.provider_task_id, "submission_started_at": getattr(record, "submission_started_at", None),
                   "requires_reconciliation": record.status == "failed" and (record.error or {}).get("code") == UNCERTAIN,
                   "audit": audit}, request)

    @router.post("/admin/owners/{owner_subject}/tasks/{task_id}/reconciliation")
    async def reconcile(owner_subject: str, task_id: str, payload: ReconciliationRequest, request: Request,
                        actor: Annotated[ServicePrincipal, Depends(require_admin)]):
        from app import standalone_api as api
        target, record, audit = await load(owner_subject, task_id, actor)
        if existing_decision(audit, payload):
            return ok(api._task_payload(record), request)
        validate_pending(record, payload)
        provider_status, provider = None, None
        if payload.decision == "bind_existing":
            from worker.processor import _provider_for, _query_upstream
            try:
                provider, model_id = await _provider_for(record)
                result = await asyncio.wait_for(_query_upstream(record, provider, payload.provider_task_id, model_id), PROBE_TIMEOUT_SECONDS)
                provider_status = str(result.get("status") or "").lower()
                if provider_status not in PROVIDER_STATUSES:
                    raise ValueError("invalid provider status")
            except Exception as exc:
                # 不回显远端 URL/错误响应中的凭证，也不以 404 等价“从未扣费”。
                raise HTTPException(status_code=502, detail="provider task could not be verified; no changes applied") from exc
        updated = await api.reconciliation_store.apply(target, actor, task_id, payload,
                                                       request.state.request_id, provider_status, provider)
        if updated is None:
            raise HTTPException(status_code=404, detail="task not found")
        # 不依赖 Redis 写入成功：Worker 现有数据库 claim_next 会认领恢复任务。
        return ok(api._task_payload(updated), request)
