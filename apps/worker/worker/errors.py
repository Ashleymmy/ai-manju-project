from __future__ import annotations

import re
from dataclasses import dataclass


SENSITIVE_PATTERNS = [
    re.compile(r"(api[_-]?key|authorization|bearer|password|secret)=([^&\s]+)", re.IGNORECASE),
    re.compile(r"(Bearer\s+)[A-Za-z0-9._~+/=-]+", re.IGNORECASE),
]


@dataclass
class SafeTaskError(Exception):
    message: str
    code: str = "worker_error"
    retryable: bool = True
    retry_after_seconds: int | None = None

    def __str__(self) -> str:
        return self.message


def job_canceled_error() -> SafeTaskError:
    return SafeTaskError("job was canceled", code="job_canceled", retryable=False)


def safe_message(value: object) -> str:
    message = str(value).strip()
    if not message:
        return "worker task failed"
    for pattern in SENSITIVE_PATTERNS:
        message = pattern.sub(lambda match: match.group(1) + "***", message)
    return message[:500]


def error_payload(exc: BaseException) -> dict[str, object]:
    if isinstance(exc, SafeTaskError):
        payload: dict[str, object] = {
            "message": safe_message(exc.message),
            "code": exc.code,
            "retryable": exc.retryable,
        }
        if exc.retry_after_seconds is not None:
            payload["retry_after_seconds"] = max(1, int(exc.retry_after_seconds))
        return payload
    return {
        "message": safe_message(exc),
        "code": "worker_error",
        "retryable": True,
    }
