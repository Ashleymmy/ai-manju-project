from __future__ import annotations

import hashlib
import secrets
import shutil
from pathlib import Path
from typing import Any

from .config import Settings
from .db import JobStore, json_compatible


def register_result_assets(
    store: JobStore,
    job: dict[str, Any],
    result: dict[str, Any],
    settings: Settings,
    asset_type: str,
) -> dict[str, Any]:
    outputs = result.get("outputs")
    if not isinstance(outputs, list):
        return result

    registration = asset_registration(job)
    registered_outputs: list[dict[str, Any]] = []
    assets: list[dict[str, Any]] = []
    for output_index, output in enumerate(outputs):
        if not isinstance(output, dict) or not output.get("path"):
            registered_outputs.append(output)
            continue

        source = Path(str(output["path"]))
        if not source.exists():
            registered_outputs.append(output)
            continue

        asset_id = registered_asset_id(str(job.get("id") or ""), output_index)
        content_type = str(output.get("content_type") or "application/octet-stream")
        extension = extension_for_output(source, content_type, asset_type)
        key = asset_storage_key(str(job.get("workspace_id") or ""), asset_id, extension)
        target = settings.asset_storage_dir / key
        target.parent.mkdir(parents=True, exist_ok=True)
        if source.resolve() != target.resolve() and not target.exists():
            shutil.copy2(source, target)

        source_metadata = registration.get("source_metadata") if isinstance(registration.get("source_metadata"), dict) else {}
        source_metadata = dict(source_metadata)
        source_metadata.setdefault("candidate_index", output_index + 1)

        asset = {
            "id": asset_id,
            "user_id": str(job["user_id"]),
            "workspace_id": str(job.get("workspace_id") or ""),
            "type": asset_type,
            "name": str(registration.get("name") or source.name),
            "url": f"/api/assets/{asset_id}/content",
            "size": target.stat().st_size,
            "content_type": content_type,
            "folder_id": str(registration.get("folder_id") or ""),
            "category": normalized_asset_category(registration.get("category")),
            "tags": [],
            "note": "",
            "source_type": normalized_asset_source(registration.get("source_type")),
            "source_project_id": str(registration.get("source_project_id") or ""),
            "source_batch_id": str(registration.get("source_batch_id") or ""),
            "source_item_id": str(registration.get("source_item_id") or ""),
            "source_job_id": str(job.get("id") or ""),
            "source_metadata": source_metadata,
            "content_sha256": file_sha256(target),
            "ingestion_mode": "automatic",
            "parent_asset_ids": normalized_parent_asset_ids(registration.get("parent_asset_ids")),
            "relation_type": normalized_lineage_relation(registration.get("relation_type")),
            "source_node_id": str(registration.get("source_node_id") or source_metadata.get("node_id") or ""),
        }
        persisted = store.create_asset(asset)
        if isinstance(persisted, dict):
            asset = json_compatible({**asset, **persisted})
        enriched = dict(output)
        enriched.update(
            {
                "asset_id": asset_id,
                "asset_url": asset["url"],
                "storage_key": key.as_posix(),
                "path": str(target),
                "size": asset["size"],
            }
        )
        registered_outputs.append(enriched)
        assets.append(asset)

    enriched_result = dict(result)
    enriched_result["outputs"] = registered_outputs
    if assets:
        enriched_result["assets"] = assets
    return enriched_result


def asset_registration(job: dict[str, Any]) -> dict[str, Any]:
    payload = job.get("payload")
    if not isinstance(payload, dict):
        return {}
    value = payload.get("asset_registration")
    return dict(value) if isinstance(value, dict) else {}


def registered_asset_id(job_id: str, output_index: int) -> str:
    job_id = job_id.strip()
    if not job_id:
        return "asset_" + secrets.token_hex(12)
    digest = hashlib.sha256(f"{job_id}\x00{output_index}".encode("utf-8")).hexdigest()
    return "asset_" + digest[:24]


def normalized_asset_category(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"character", "environment", "costume", "prop", "ui", "reference", "other"}:
        return normalized
    return "other"


def normalized_asset_source(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"manual_upload", "image_workbench", "canvas", "comic_batch", "legacy", "unknown"}:
        return normalized
    return "unknown"


def normalized_parent_asset_ids(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value:
        asset_id = str(item or "").strip()
        if asset_id and asset_id not in result:
            result.append(asset_id)
        if len(result) >= 20:
            break
    return result


def normalized_lineage_relation(value: Any) -> str:
    relation = str(value or "").strip().lower()
    if relation in {"generation", "edit", "crop", "annotation", "compress", "import"}:
        return relation
    return "generation"


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def asset_storage_key(workspace_id: str, asset_id: str, extension: str) -> Path:
    return Path(asset_workspace_path(workspace_id)) / f"{asset_id}{extension}"


def asset_workspace_path(workspace_id: str) -> Path:
    if workspace_id == "team:default":
        return Path("team") / "default"
    return Path("personal") / workspace_id.removeprefix("default:")


def extension_for_output(source: Path, content_type: str, asset_type: str) -> str:
    if source.suffix:
        return source.suffix.lower()
    if content_type == "image/png":
        return ".png"
    if content_type == "image/jpeg":
        return ".jpeg"
    if content_type == "image/webp":
        return ".webp"
    if content_type == "image/gif":
        return ".gif"
    if content_type == "video/mp4":
        return ".mp4"
    if content_type == "video/webm":
        return ".webm"
    if content_type == "video/quicktime":
        return ".mov"
    if asset_type == "image":
        return ".png"
    if asset_type == "video":
        return ".mp4"
    return ".bin"
