from __future__ import annotations

import re
from dataclasses import dataclass


SENSITIVE_PATTERNS = [
    re.compile(r"(api[_-]?key|authorization|bearer|password|secret)=([^&\s]+)", re.IGNORECASE),
    re.compile(r"(Bearer\s+)[A-Za-z0-9._~+/=-]+", re.IGNORECASE),
]

# Task status is public; full exception diagnostics are recorded separately by tasks.py.
PUBLIC_TASK_ERROR_MESSAGES = {
    "image_output_size_mismatch": "本次图片未达到所选规格，请调整参数或更换模型后重试。",
    "image_output_unreadable": "本次图片未能完整生成，请稍后重试或更换模型。",
    "video_reference_timeout": "参考视频读取超时，请稍后重试或改用较小的视频。",
}


@dataclass
class SafeTaskError(Exception):
    message: str
    code: str = "worker_error"
    retryable: bool = True
    retry_after_seconds: int | None = None

    def __str__(self) -> str:
        return self.message


class VideoTaskAcceptedError(SafeTaskError):
    """The paid task exists; retrying generation would create another video."""


class VideoSubmissionUncertainError(SafeTaskError):
    """The submit may have been accepted; a new POST risks duplicate charges."""


class VideoRecoveryPendingError(VideoTaskAcceptedError):
    """Resume this durable task; never count recovery as a generation attempt."""


class VideoReferenceError(SafeTaskError):
    """The supplier rejected reference media, not the model's availability."""


class ImageSubmissionUncertainError(SafeTaskError):
    """The paid POST may have completed; never retry generation automatically."""


class ImageRecoveryPendingError(SafeTaskError):
    """Recover an existing response/output without a new paid POST."""


class ImageResultRejectedError(SafeTaskError):
    """A completed image response is invalid; it is not a supplier retry."""


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
        public_message = PUBLIC_TASK_ERROR_MESSAGES.get(exc.code, exc.message)
        if isinstance(exc, VideoTaskAcceptedError):
            public_message = "视频任务已提交，查询或下载结果中断，请联系管理员核查，勿重复生成"
        elif isinstance(exc, VideoSubmissionUncertainError):
            public_message = "视频提交结果待确认，请勿重复提交，请联系管理员核查"
        payload: dict[str, object] = {
            "message": safe_message(public_message),
            "code": "video_result_pending" if isinstance(exc, VideoTaskAcceptedError) else exc.code,
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
