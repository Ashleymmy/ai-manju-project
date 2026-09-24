from __future__ import annotations

import re
from datetime import datetime, timezone
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

# Keep private diagnostic text bounded and never retain credentials or media.
MAX_DETAIL_LENGTH = 4000
_SECRET = re.compile(r'''(?i)(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|cookie|token)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)''')
_BEARER = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+")
_URL = re.compile(r'''https?://[^\s<>"']+''')


def safe_detail(value: object) -> str:
    text = re.sub(r'''(?i)data:[^\s"']+''', "[media redacted]", str(value))

    def clean_url(match: re.Match) -> str:
        try:
            url = urlsplit(match.group())
            return urlunsplit((url.scheme, url.netloc.rsplit("@", 1)[-1], url.path, "", ""))
        except ValueError:
            return "[url redacted]"

    text = _URL.sub(clean_url, text)
    text = _BEARER.sub("Bearer [redacted]", text)
    text = _SECRET.sub(lambda m: m.group(1) + "[redacted]", text)
    text = re.sub(r"\b(?:sk-|sess-)[A-Za-z0-9_-]{8,}", "[redacted]", text)
    return text.strip()[:MAX_DETAIL_LENGTH]


def attempt_event(job: dict, payload: dict, error: dict, duration_ms: int) -> dict:
    context = payload.get("asset_registration") or payload.get("asset_context") or {}
    if not isinstance(context, dict):
        context = {}
    stored = job.get("payload") or {}
    if not isinstance(stored, dict):
        stored = {}
    return {
        "id": "attempt_" + uuid4().hex,
        "user_id": str(job.get("user_id") or ""),
        "source": "worker",
        "request_id": str(stored.get("request_id") or ""),
        "job_id": str(job.get("id") or ""),
        "project_id": str(payload.get("source_project_id") or context.get("source_project_id") or ""),
        "node_id": str(payload.get("source_node_id") or context.get("source_node_id") or ""),
        "operation": str(job.get("type") or "generation"),
        "model": safe_detail(payload.get("model") or ""),
        "error_code": safe_detail(error.get("code") or "worker_error"),
        "message": "生成尝试失败",
        "detail": safe_detail(error.get("message") or "任务执行异常"),
        "suggestion": "查看任务最终状态；若持续失败，请携带任务编号联系管理员。",
        "attempt": int(job.get("attempts") or 0) + 1,
        "retryable": bool(error.get("retryable")),
        "duration_ms": max(0, duration_ms),
        "created_at": datetime.now(timezone.utc),
    }
