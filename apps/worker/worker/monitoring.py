from __future__ import annotations

import re
import json
import traceback
from contextvars import ContextVar
from datetime import datetime, timezone
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

# Keep private diagnostic text bounded and never retain credentials or media.
MAX_DETAIL_LENGTH = 4000
MAX_ERROR_DEPTH = 6
MAX_ERROR_ITEMS = 20
# Bound exception chains, including causes deliberately hidden from public text.
MAX_EXCEPTION_CHAIN = 8
# Terminal failed downloads may return a large gateway page. Bound collection
# without reading successful media or changing the caller's error decision.
MAX_ERROR_RESPONSE_BYTES = 32 * 1024
ERROR_READ_CHUNK_BYTES = 1024
_request_diagnostic: ContextVar[dict | None] = ContextVar("request_diagnostic", default=None)
ERROR_FIELDS = {"error", "errors", "error_message", "errormessage", "error_code", "errorcode", "error_name", "message", "msg", "description", "error_description", "detail", "details", "reason", "code", "type", "param", "status", "status_code", "request_id", "requestid", "trace_id", "traceid", "suggestion", "retry_after", "title", "output", "data", "response"}
ERROR_FIELDS.update({"statuscode", "success", "loc", "field", "ctx", "limit_value", "min_length", "max_length", "ge", "gt", "le", "lt", "expected", "actual_length"})
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


def reset_request_diagnostic() -> None:
    _request_diagnostic.set(None)


def begin_provider_request(method: str, url: str) -> None:
    _request_diagnostic.set({"stage": "provider_transport", "provider_url": safe_detail(url), "provider_method": method,
                             "provider_response_received": False})


def error_body(raw: str) -> str:
    def filter_fields(value, depth=0):
        if depth > MAX_ERROR_DEPTH:
            return None
        if isinstance(value, dict):
            return {key: child for key, value in value.items() if key.lower() in ERROR_FIELDS
                    and (key.lower() not in {"data", "output", "response"} or isinstance(value, dict))
                    and (child := filter_fields(value, depth + 1)) is not None} or None
        if isinstance(value, list):
            return [child for value in value[:MAX_ERROR_ITEMS] if (child := filter_fields(value, depth + 1)) is not None] or None
        if isinstance(value, str):
            return safe_detail(value)
        if isinstance(value, (int, float, bool)):
            return value
        return None
    try:
        value = filter_fields(json.loads(raw))
        if value is None:
            return ""
        encoded = json.dumps(value, ensure_ascii=False)
        return json.dumps(encoded[:MAX_DETAIL_LENGTH] + " [truncated]", ensure_ascii=False) if len(encoded) > MAX_DETAIL_LENGTH else encoded
    except (ValueError, TypeError):
        if raw.lstrip().startswith(('{', '[')):
            return ""
        return safe_detail(raw)


def observe_provider_response(response, *, streamed=False) -> None:
    # A diagnostic observer must never change submission/recovery behavior.
    try:
        _observe_provider_response(response, streamed=streamed)
    except Exception:
        pass


def observe_provider_exception(exc: BaseException) -> None:
    current = dict(_request_diagnostic.get() or {})
    current.update(exception_name=type(exc).__name__, exception_message=safe_detail(exc),
                   stack=safe_detail("".join(traceback.format_exception(type(exc), exc, exc.__traceback__))))
    _request_diagnostic.set(current)


def observe_failed_response(response, *, streamed=False) -> None:
    """Call only after the caller has decided to reject/discard this response."""
    observe_provider_response(response, streamed=streamed)
    if not streamed or isinstance(getattr(response, "_content", None), bytes):
        return
    try:
        iterator = getattr(response, "iter_content", None) or getattr(response, "iter_bytes", None)
        if not callable(iterator):
            return
        chunks, size = [], 0
        for chunk in iterator(chunk_size=ERROR_READ_CHUNK_BYTES):
            chunks.append(chunk[:MAX_ERROR_RESPONSE_BYTES - size])
            size += len(chunk)
            if size >= MAX_ERROR_RESPONSE_BYTES:
                break
        body = error_body(b"".join(chunks).decode("utf-8", errors="replace"))
        current = dict(_request_diagnostic.get() or {})
        if body:
            current["provider_body"] = body
            try:
                for key, value in error_identifiers(json.loads(body)).items():
                    current.setdefault(key, value)
            except ValueError:
                pass
        _request_diagnostic.set(current)
    except Exception as exc:
        observe_provider_exception(exc)


def exception_chain(exc: BaseException) -> list[BaseException]:
    chain = []
    while exc is not None and len(chain) < MAX_EXCEPTION_CHAIN and all(exc is not item for item in chain):
        chain.append(exc)
        exc = exc.__cause__ or exc.__context__
    return chain


def error_identifiers(value, depth=0):
    if not isinstance(value, dict) or depth > MAX_ERROR_DEPTH:
        return {}
    values = {str(key).lower(): child for key, child in value.items()}
    result = {}
    for key in ("error", "response", "data", "output"):
        for name, child in error_identifiers(values.get(key), depth + 1).items():
            result.setdefault(name, child)
    for key in ("code", "error_code", "errorcode"):
        if isinstance(values.get(key), (str, int)) and not isinstance(values[key], bool):
            result.setdefault("provider_code", safe_detail(values[key]))
    for key in ("request_id", "requestid", "trace_id", "traceid"):
        if isinstance(values.get(key), str):
            result.setdefault("provider_request_id", safe_detail(values[key]))
    return result


def _observe_provider_response(response, *, streamed=False) -> None:
    current = dict(_request_diagnostic.get() or {})
    status = getattr(response, "status_code", None)
    if not isinstance(status, int):
        return
    current.update(stage="provider_response", provider_response_received=True, provider_status=status)
    _request_diagnostic.set(current)
    headers = getattr(response, "headers", {}) or {}
    for key in ("x-request-id", "request-id", "x-trace-id", "x-tt-logid", "x-amzn-requestid"):
        value = next((value for name, value in headers.items() if str(name).lower() == key), None)
        if isinstance(value, str) and value:
            current["provider_request_id"] = safe_detail(value)
            break
    # Never consume streamed media or store successful generated output. JSON
    # task polling can return HTTP 200 with an error; retain its error fields.
    content_type = str(headers.get("Content-Type", headers.get("content-type", "")))
    if streamed and isinstance(getattr(response, "_content", None), bytes):
        streamed = False  # Already consumed by the business caller; no extra IO.
    if not streamed and (status >= 400 or "json" in content_type or not content_type):
        raw = getattr(response, "text", "")
        if isinstance(raw, str):
            body = error_body(raw)
            if status < 400 and not content_type:
                try:
                    json.loads(raw)
                except ValueError:
                    body = ""  # An untyped successful media payload is not a diagnostic.
            # These facts are persisted only when attempt_event receives an
            # exception. Do not guess failure from English keywords: success:false,
            # numeric codes and vendor-specific messages are equally real data.
            if body:
                current["provider_body"] = body
                try:
                    for key, value in error_identifiers(json.loads(body)).items():
                        current.setdefault(key, value)
                except ValueError:
                    pass
    _request_diagnostic.set(current)


def attempt_event(job: dict, payload: dict, error: dict, duration_ms: int, exc: BaseException | None = None) -> dict:
    context = payload.get("asset_registration") or payload.get("asset_context") or {}
    if not isinstance(context, dict):
        context = {}
    stored = job.get("payload") or {}
    if not isinstance(stored, dict):
        stored = {}
    chain = exception_chain(exc) if exc is not None else []
    # HTTP libraries retain the failed request/response on the exception even
    # when a public SafeTaskError hides its cause. Never use a prior request's
    # status for this different failed exchange.
    for cause in chain:
        try:
            response = getattr(cause, "response", None)
            request = getattr(cause, "request", None)
            if request is None and response is not None:
                request = getattr(response, "request", None)
            if request is not None:
                current = _request_diagnostic.get() or {}
                if current.get("provider_url") != safe_detail(request.url) or current.get("provider_method") != str(request.method):
                    begin_provider_request(str(request.method), str(request.url))
                if response is not None:
                    observe_provider_response(response, streamed=not getattr(response, "is_stream_consumed", False) and not isinstance(getattr(response, "_content", None), bytes))
                observe_provider_exception(cause)
                break
        except Exception:
            pass
    diagnostic = dict(_request_diagnostic.get() or {}) if exc is not None else {}
    provider_status = diagnostic.pop("provider_status", 0)
    if exc is not None:
        diagnostic.setdefault("stage", "worker_execution")
        original = chain[-1]
        diagnostic.setdefault("exception_name", type(original).__name__)
        diagnostic.setdefault("exception_message", safe_detail(original))
        # Deepest cause first so long wrapper traces cannot truncate it away.
        diagnostic["stack"] = safe_detail("\n".join("".join(traceback.format_exception(type(cause), cause, cause.__traceback__, chain=False)) for cause in reversed(chain)))
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
        "diagnostics": diagnostic,
        "provider_status": provider_status,
        "suggestion": "查看任务最终状态；若持续失败，请携带任务编号联系管理员。",
        "attempt": int(job.get("attempts") or 0) + 1,
        "retryable": bool(error.get("retryable")),
        "duration_ms": max(0, duration_ms),
        "created_at": datetime.now(timezone.utc),
    }
