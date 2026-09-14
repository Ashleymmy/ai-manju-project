from __future__ import annotations

from typing import Any

from billiard.exceptions import SoftTimeLimitExceeded

from .errors import SafeTaskError

# Includes the initial request. Keep in sync with model.GenerationAttemptsPerProvider.
ATTEMPTS_PER_PROVIDER = 3
# Matches model.GenerationMediaRequestTimeout; each supplier attempt is bounded.
MEDIA_REQUEST_TIMEOUT_SECONDS = 15 * 60
# This field is installed only from server-owned Celery kwargs, never job payloads.
PROVIDER_CANDIDATES_FIELD = "_provider_candidates"
GENERATION_UNAVAILABLE_MESSAGE = "当前模型暂时不可用，请稍后重试"


def generation_attempt(payload: dict[str, Any], attempts: int) -> tuple[dict[str, Any], int]:
    candidates = payload.get(PROVIDER_CANDIDATES_FIELD)
    if not isinstance(candidates, list) or not candidates:
        return payload, 0
    model = str(payload.get("model") or candidates[0].get("model") or "")
    if any(not isinstance(item, dict) or str(item.get("model") or "") != model for item in candidates):
        raise SafeTaskError("invalid generation configuration", code="invalid_generation_config", retryable=False)
    active = {key: value for key, value in payload.items() if key != PROVIDER_CANDIDATES_FIELD}
    active["provider"] = candidates[min(max(0, attempts) // ATTEMPTS_PER_PROVIDER, len(candidates) - 1)]
    active["provider"] = {**active["provider"], "generation_attempt": max(0, attempts)}
    return active, len(candidates) * ATTEMPTS_PER_PROVIDER


def is_provider_failure(exc: BaseException) -> bool:
    return isinstance(exc, SoftTimeLimitExceeded) or (
        isinstance(exc, SafeTaskError) and exc.code.startswith("provider_")
    )


def unavailable_error() -> SafeTaskError:
    return SafeTaskError(GENERATION_UNAVAILABLE_MESSAGE, code="generation_unavailable", retryable=False)
