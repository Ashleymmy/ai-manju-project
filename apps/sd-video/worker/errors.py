"""任务错误的安全摘要；不保存原始响应、请求素材或凭证。"""
from __future__ import annotations

import re
from typing import Any
from urllib.parse import quote

import httpx

from app.config import settings
from app.providers.seedance.base import SeedanceProviderError, error_from_response
from app.vidu_api import ViduAPIError
from app.volcano_api import VolcanoAPIError
from app.yike_api import YikeAPIError


# 仅这些明确拒绝允许普通的手动重试；408/409/5xx 等仍须核对上游。
REJECTED_HTTP_STATUSES = frozenset({400, 401, 403, 404, 405, 413, 415, 422, 429})
PROVIDER_ERRORS = (SeedanceProviderError, VolcanoAPIError, ViduAPIError, YikeAPIError)
# 限制数据库与日志中的错误体积，避免上游响应变成无界日志。
MESSAGE_LIMIT = 2048
IDENTIFIER_LIMIT = 128


def safe_text(value: Any, limit: int = MESSAGE_LIMIT) -> str:
    text = str(value or "")
    for name in dir(settings):
        if any(word in name for word in ("KEY", "SECRET", "PASSWORD", "TOKEN")):
            secret = getattr(settings, name)
            if isinstance(secret, str) and len(secret) >= 6:
                for encoded in (secret, quote(secret, safe="")):
                    text = text.replace(encoded, "[redacted]")
    text = re.sub(r"-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----",
                  "[private-key]", text, flags=re.DOTALL)
    text = re.sub(r"https?://[^\s\"'<>]+|https?%3A%2F%2F[^\s\"'<>]+", "[url]", text, flags=re.IGNORECASE)
    text = re.sub(r"data:[^\s,]+,[A-Za-z0-9+/=_-]+", "[media]", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(?:Bearer|Basic)\s+[^\s\"',;}]+|eyJ[\w-]+\.[\w-]+\.[\w-]+", "[token]", text, flags=re.IGNORECASE)
    text = re.sub(
        r"([\"']?\b(?:api[-_]?key|access[-_]?key(?:[-_]?secret)?|secret|token|password|signature|authorization)[\"']?\s*[:=]\s*)"
        r"(?:\"[^\"]*\"|'[^']*'|[^\s,;}\]]+)",
        r"\1[redacted]", text, flags=re.IGNORECASE,
    )
    # 单行输出，避免上游文本伪造多条日志；先完整脱敏再截断。
    return " ".join(text.split())[:limit]


def _provider_exception(exc: Exception) -> Exception:
    if isinstance(exc, httpx.HTTPStatusError):
        return error_from_response(exc.response, "provider request")
    return exc


def submission_rejected(exc: Exception) -> bool:
    error = _provider_exception(exc)
    return isinstance(error, PROVIDER_ERRORS) and error.http_status in REJECTED_HTTP_STATUSES


def exception_details(exc: Exception, *, code: str, phase: str) -> dict[str, Any]:
    error = _provider_exception(exc)
    # 未知异常可能包含 SQL、连接串或内部数据，只暴露类型，不照搬正文。
    message = (str(error) or "provider request interrupted") if isinstance(error, PROVIDER_ERRORS + (httpx.RequestError,)) else "task execution interrupted; inspect exception_type and phase"
    result: dict[str, Any] = {
        "code": code, "message": safe_text(message), "phase": phase,
        "exception_type": type(exc).__name__,
    }
    status = getattr(error, "http_status", 0)
    if isinstance(status, int) and 100 <= status <= 599:
        result["http_status"] = status
    for attribute, field in (("error_code", "provider_code"), ("request_id", "request_id")):
        value = safe_text(getattr(error, attribute, ""), IDENTIFIER_LIMIT)
        if value:
            result[field] = value
    return result


def terminal_details(state: dict[str, Any]) -> dict[str, Any]:
    nested = state.get("error") if isinstance(state.get("error"), dict) else {}
    provider_code = safe_text(state.get("error_code") or nested.get("code"), IDENTIFIER_LIMIT)
    result = {
        "code": provider_code or "provider_error",
        "message": safe_text(state.get("error_message") or nested.get("message") or "provider reported a failed task"),
        "phase": "poll",
    }
    if provider_code:
        result["provider_code"] = provider_code
    request_id = safe_text(state.get("request_id"), IDENTIFIER_LIMIT)
    if request_id:
        result["request_id"] = request_id
    return result
