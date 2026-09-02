from __future__ import annotations

import hashlib
import re
from pathlib import Path, PurePosixPath
from typing import Any, BinaryIO

from .config import Settings
from .errors import SafeTaskError


STAGED_INPUT_KEYS_FIELD = "staged_input_keys"
INPUT_STORAGE_KEY_FIELD = "input_storage_key"
JOB_WORKSPACE_FIELD = "_job_workspace_id"
STAGED_INPUT_ROOT_PARTS = ("jobs", "inputs")
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
UNSAFE_SEGMENT_PATTERN = re.compile(r"[^a-zA-Z0-9_-]+")


def open_staged_input(item: dict[str, Any], payload: dict[str, Any], settings: Settings) -> BinaryIO:
    path = validate_staged_input(item, payload, settings)
    return path.open("rb")


def validate_staged_input(item: dict[str, Any], payload: dict[str, Any], settings: Settings) -> Path:
    workspace_id = str(payload.get(JOB_WORKSPACE_FIELD) or "").strip()
    storage_key = str(item.get("storage_key") or "").strip()
    path = resolve_staged_input_path(storage_key, workspace_id, settings, require_exists=True)

    expected_size = positive_int(item.get("size"))
    if expected_size is None:
        raise SafeTaskError("staged input size is required", code="invalid_staged_input", retryable=False)
    actual_size = path.stat().st_size
    if actual_size != expected_size:
        raise SafeTaskError("staged input size mismatch", code="staged_input_size_mismatch", retryable=False)

    expected_sha256 = str(item.get("sha256") or "").strip().lower()
    if not SHA256_PATTERN.fullmatch(expected_sha256):
        raise SafeTaskError("staged input sha256 is required", code="invalid_staged_input", retryable=False)
    if file_sha256(path) != expected_sha256:
        raise SafeTaskError("staged input checksum mismatch", code="staged_input_checksum_mismatch", retryable=False)
    return path


def resolve_legacy_asset_path(value: str, settings: Settings) -> Path:
    raw = value.strip()
    if not raw:
        raise SafeTaskError("video input_path is required", code="missing_video_input", retryable=False)
    root = settings.asset_storage_dir.resolve()
    candidate = Path(raw)
    if not candidate.is_absolute():
        candidate = root / candidate
    reject_symlink_path(root, candidate)
    try:
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(root)
    except (FileNotFoundError, ValueError) as exc:
        raise SafeTaskError("video input_path is outside asset storage or missing", code="video_input_not_found", retryable=False) from exc
    if not resolved.is_file():
        raise SafeTaskError("video input_path is not a file", code="video_input_not_found", retryable=False)
    return resolved


def resolve_output_dir(value: Any, job_id: str, settings: Settings) -> Path:
    root = settings.asset_storage_dir.resolve()
    raw = str(value or "").strip()
    candidate = Path(raw) if raw else root / "jobs" / job_id
    if not candidate.is_absolute():
        candidate = root / candidate
    candidate = candidate.resolve(strict=False)
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise SafeTaskError("video output_dir must stay inside asset storage", code="invalid_video_output_dir", retryable=False) from exc
    return candidate


def cleanup_staged_inputs(payload: dict[str, Any], workspace_id: str, settings: Settings) -> list[str]:
    errors: list[str] = []
    for key in staged_input_keys(payload):
        try:
            path = resolve_staged_input_path(key, workspace_id, settings, require_exists=False)
            if path.exists():
                if not path.is_file():
                    raise SafeTaskError("staged input is not a file", code="invalid_staged_input", retryable=False)
                path.unlink()
            remove_empty_batch_dirs(path.parent, workspace_id, settings)
        except Exception as exc:  # best effort; task terminal state must win
            errors.append(str(exc)[:240])
    return errors


def staged_input_keys(payload: dict[str, Any]) -> list[str]:
    raw = payload.get(STAGED_INPUT_KEYS_FIELD)
    if not isinstance(raw, list):
        return []
    seen: set[str] = set()
    keys: list[str] = []
    for item in raw:
        key = str(item or "").strip()
        if key and key not in seen:
            seen.add(key)
            keys.append(key)
    return keys


def resolve_staged_input_path(
    storage_key: str,
    workspace_id: str,
    settings: Settings,
    *,
    require_exists: bool,
) -> Path:
    if not storage_key or "\\" in storage_key:
        raise SafeTaskError("invalid staged input key", code="invalid_staged_input_path", retryable=False)
    key = PurePosixPath(storage_key)
    if key.is_absolute() or any(part in {"", ".", ".."} for part in key.parts):
        raise SafeTaskError("invalid staged input key", code="invalid_staged_input_path", retryable=False)

    expected_parts = (*STAGED_INPUT_ROOT_PARTS, *workspace_prefix_parts(workspace_id))
    if tuple(key.parts[: len(expected_parts)]) != expected_parts or len(key.parts) <= len(expected_parts) + 1:
        raise SafeTaskError("staged input does not belong to job workspace", code="staged_input_workspace_mismatch", retryable=False)

    root = settings.asset_storage_dir.resolve()
    allowed_root = root.joinpath(*expected_parts)
    candidate = root.joinpath(*key.parts)
    reject_symlink_path(root, candidate)
    try:
        resolved = candidate.resolve(strict=require_exists)
        resolved.relative_to(allowed_root.resolve(strict=False))
        resolved.relative_to(root)
    except (FileNotFoundError, ValueError) as exc:
        raise SafeTaskError("staged input path is outside workspace or missing", code="invalid_staged_input_path", retryable=False) from exc
    return resolved


def workspace_prefix_parts(workspace_id: str) -> tuple[str, str]:
    raw = workspace_id.strip()
    if raw.startswith("default:"):
        return "personal", safe_workspace_segment(raw.removeprefix("default:"))
    if raw.startswith("team:"):
        return "team", safe_workspace_segment(raw.removeprefix("team:"))
    raise SafeTaskError("unsupported job workspace", code="invalid_job_workspace", retryable=False)


def safe_workspace_segment(value: str) -> str:
    normalized = UNSAFE_SEGMENT_PATTERN.sub("_", value.strip()).strip("_")
    return normalized or "unknown"


def reject_symlink_path(root: Path, candidate: Path) -> None:
    current = root
    try:
        relative = candidate.relative_to(root)
    except ValueError as exc:
        raise SafeTaskError("path is outside asset storage", code="invalid_staged_input_path", retryable=False) from exc
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise SafeTaskError("symbolic links are not allowed for job inputs", code="invalid_staged_input_path", retryable=False)


def remove_empty_batch_dirs(start: Path, workspace_id: str, settings: Settings) -> None:
    root = settings.asset_storage_dir.resolve()
    allowed_root = root.joinpath(*STAGED_INPUT_ROOT_PARTS, *workspace_prefix_parts(workspace_id)).resolve(strict=False)
    current = start
    while current != allowed_root:
        try:
            current.relative_to(allowed_root)
        except ValueError:
            return
        try:
            current.rmdir()
        except OSError:
            return
        current = current.parent


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def positive_int(value: Any) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None
