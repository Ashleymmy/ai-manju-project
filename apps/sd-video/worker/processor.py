"""Durable task execution for SD-video.

The processor owns the Provider lifecycle.  API requests only validate and
enqueue; this module claims queued rows, polls upstream tasks, stores results,
and records a compact event trail in the standalone database.
"""

from __future__ import annotations

import hashlib
import logging
import asyncio
from contextlib import suppress
from datetime import datetime, timedelta, timezone
from typing import Any

from app.config import settings
from app.standalone_api import _execution_mode, _rollout_mode, catalog_store, local_storage, task_store
from app.vidu_api import vidu_api
from app.volcano_api import volcano_api
from app.yike_api import yike_api
from app.providers.seedance import LEGACY_PROXY, seedance_provider_registry
from app.model_store import model_store
from app.mock_media import MOCK_VIDEO


logger = logging.getLogger("sdvideo.worker")


class LeaseLost(RuntimeError):
    """原持有者不得在租约丢失或任务取消之后写入结果。"""


async def _save(record: Any, **changes: Any) -> Any:
    updated = await task_store.update(record.id, expected_lease=getattr(record, "lease_owner", None), **changes)
    if updated is None:
        raise LeaseLost(record.id)
    return updated


async def _provider_for(record: Any) -> tuple[str, str]:
    if record.model == "toolkit/erase": return "mediakit", "toolkit/erase"
    config = (record.request or {}).get("model_config") or next((item for item in await model_store.list() if item["key"] == record.model), None)
    if config is None or not config.get("available", True):
        raise ValueError("model is unavailable")
    provider = str(record.provider or config.get("provider") or "volcano").lower()
    return provider, str(config.get("id") or record.model)


async def _references(record: Any) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for item in (record.request or {}).get("references") or []:
        raw = item if isinstance(item, dict) else {}
        kind = str(raw.get("kind") or raw.get("type") or "image").lower()
        ref_type = kind if kind.startswith("reference_") else f"reference_{kind}"
        url = str(raw.get("url") or "").strip()
        if not url:
            storage_token = str(raw.get("storage_token") or "").strip()
            if storage_token and hasattr(local_storage, "url"):
                try:
                    url = str(await local_storage.url(storage_token, settings.RESULT_SIGNED_URL_TTL_SECONDS) or "").strip()
                except Exception as exc:
                    logger.info("input URL signing unavailable task=%s error=%s", record.id, type(exc).__name__)
            if storage_token and not url:
                raise ValueError("storage cannot provide a signed reference URL")
        if not url and raw.get("asset_ref"):
            from app.core.auth import ServicePrincipal
            from app.standalone_api import volcano_store
            principal = ServicePrincipal(record.owner_subject, record.workspace_id, "member", frozenset())
            if await volcano_store.active_reference(principal, str(raw["asset_ref"]).removeprefix("asset://"), record.request.get("provider_namespace")) is None:
                raise ValueError("provider reference is no longer Active or belongs to another namespace")
            url = "asset://" + str(raw.get("asset_ref")).strip().removeprefix("asset://")
        if url:
            result.append({"type": ref_type, "url": url, "asset_ref": raw.get("asset_ref"), "role": raw.get("role")})
    return result


async def _create_upstream(record: Any, provider: str, model_id: str) -> dict[str, Any]:
    request = record.request or {}
    refs = await _references(record)
    if provider == "mediakit":
        from app.mediakit_api import mediakit_api
        execute = mediakit_api.erase_subtitle_pro if request.get("tool_mode") == "pro" else mediakit_api.erase_subtitle_standard
        response = await execute(refs[0]["url"], client_token=record.id)
        data = response.get("data") or response
        return {"id": data.get("task_id") or data.get("id")}
    kwargs = {
        "model": model_id,
        "prompt": record.prompt,
        "ratio": request.get("ratio") or "16:9",
        "duration": int(request.get("duration") or 6),
        "resolution": request.get("resolution") or "720p",
        "reference_inputs": [item for item in refs if item.get("role") not in {"first_frame", "last_frame"}],
        "first_frame_url": next((item["url"] for item in refs if item.get("role") == "first_frame"), None),
        "last_frame_url": next((item["url"] for item in refs if item.get("role") == "last_frame"), None),
        "generate_audio": bool(request.get("generate_audio", True)),
        "watermark": bool(request.get("watermark", False)),
        "seed": request.get("seed"),
    }
    if provider == "vidu":
        return await vidu_api.create_video_task(
            model=model_id,
            prompt=record.prompt,
            ratio=kwargs["ratio"],
            duration=kwargs["duration"],
            resolution=kwargs["resolution"],
            reference_inputs=kwargs["reference_inputs"],
            first_frame_url=kwargs["first_frame_url"],
            last_frame_url=kwargs["last_frame_url"],
            generate_audio=kwargs["generate_audio"],
            seed=kwargs["seed"],
        )
    if provider == "yike":
        return await yike_api.create_video_task(**kwargs)
    upstream = str(request.get("upstream_provider") or "").strip() or seedance_provider_registry.submission_provider(record.model)
    if model_id not in settings.SEEDANCE20_MODEL_IDS and not seedance_provider_registry.configured(upstream):
        # Non-Seedance Volcano models use the Ark client directly; the copied
        # client performs its own credential check and error classification.
        upstream = None
    kwargs.update({"upstream_provider": upstream})
    return await volcano_api.create_video_task(**kwargs)


async def _query_upstream(record: Any, provider: str, provider_id: str, model_id: str) -> dict[str, Any]:
    if provider == "mediakit":
        from app.mediakit_api import mediakit_api
        response = await mediakit_api.query_task(provider_id)
        data = response.get("data") or response
        result = data.get("result") or {}
        state = str(data.get("status") or "running").lower()
        state = {"success": "succeeded", "completed": "succeeded", "done": "succeeded", "failure": "failed"}.get(state, state)
        return {"status": state, "progress": data.get("progress", 0), "content": {"video_url": result.get("video_url") or result.get("output_video_url") or data.get("video_url")}, "error": data.get("error")}
    if provider == "vidu":
        return await vidu_api.query_task(provider_id)
    if provider == "yike":
        return await yike_api.query_task(provider_id)
    request = record.request or {}
    return await volcano_api.query_task(
        provider_id,
        model=model_id,
        upstream_provider=str(request.get("upstream_provider") or seedance_provider_registry.submission_provider(record.model)),
    )


async def _cancel_upstream(record: Any, provider: str, provider_id: str, model_id: str) -> None:
    try:
        if provider == "vidu":
            await vidu_api.cancel_task(provider_id)
        elif provider in {"yike", "mediakit"}:
            # Yike currently has no safe cancellation endpoint.  Local state
            # still prevents the result from being imported.
            return
        else:
            request = record.request or {}
            await volcano_api.cancel_task(provider_id, model=model_id, upstream_provider=str(request.get("upstream_provider") or LEGACY_PROXY))
    except Exception as exc:
        if getattr(exc, "http_status", None) in {404, 405, 409, 422}: return
        raise


async def _download(record: Any, provider: str, video_url: str) -> bytes:
    del record, provider
    from app.safe_download import download_result
    return await download_result(video_url)


async def _finish_mock(record: Any) -> None:
    body = MOCK_VIDEO
    key = f"results/{record.workspace_id}/{record.owner_subject}/{record.id}.mp4"
    await local_storage.put(key, body, "video/mp4")
    await _save(
        record,
        status="succeeded",
        progress=100,
        result={
            "asset_ref": f"sdv-asset:{record.id}",
            "storage_key": key,
            "content_type": "video/mp4",
            "file_name": f"{record.id}.mp4",
            "sha256": hashlib.sha256(body).hexdigest(),
            "size_bytes": len(body),
        },
        result_storage_key=key,
        lease_owner=None,
        lease_expires_at=None,
    )
    if catalog_store is not None:
        await catalog_store.upsert_generated_media(record, key, len(body))


async def process_task(record: Any) -> None:
    # 开关只控制新任务；已受理任务在关闭入口后仍须恢复、取消和同步。
    lease_owner = getattr(record, "lease_owner", None)
    async def heartbeat() -> None:
        while True:
            await asyncio.sleep(max(1, settings.WORKER_LEASE_SECONDS // 3))
            if lease_owner:
                updated = await task_store.update(record.id, expected_lease=lease_owner, lease_expires_at=datetime.now(timezone.utc) + timedelta(seconds=settings.WORKER_LEASE_SECONDS))
                if updated is None:
                    raise LeaseLost(record.id)

    heartbeat_task = asyncio.create_task(heartbeat())
    execution = asyncio.create_task(_execute(record))
    try:
        done, _ = await asyncio.wait({heartbeat_task, execution}, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            await task
    except LeaseLost:
        logger.warning("task lease lost task=%s", record.id)
    finally:
        for task in (heartbeat_task, execution):
            task.cancel()
        await asyncio.gather(heartbeat_task, execution, return_exceptions=True)


async def _execute(record: Any) -> None:
    provider_id = getattr(record, "provider_task_id", None)
    try:
        if record.cancel_requested and (not provider_id or _execution_mode() == "mock"):
            await _save(record, status="canceled", lease_owner=None, lease_expires_at=None)
            return
        if _execution_mode() == "mock":
            await _finish_mock(record)
            return
        provider, model_id = await _provider_for(record)
        if not provider_id:
            if getattr(record, "submission_started_at", None):
                await _save(record, status="failed", error={"code": "submission_uncertain", "message": "provider submission requires reconciliation; automatic resubmission prevented"}, lease_owner=None, lease_expires_at=None)
                return
            # 先持久化提交意图；崩溃窗口内不重复调用可能已扣费的 Provider。
            await _references(record)
            await _save(record, submission_started_at=datetime.now(timezone.utc))
            created = await _create_upstream(record, provider, model_id)
            provider_id = str(created.get("id") or created.get("task_id") or "")
            if not provider_id:
                raise RuntimeError("provider response did not include a task id")
            await _save(record, provider=provider, provider_task_id=provider_id)

        poll_count = 0
        while True:
            latest = await task_store.get_by_id(record.id)
            if latest is None:
                return
            if latest.cancel_requested or latest.status == "cancel_requested":
                await _cancel_upstream(latest, provider, provider_id, model_id)
                await _save(record, status="canceled", progress=latest.progress, lease_owner=None, lease_expires_at=None)
                return
            state = await _query_upstream(latest, provider, provider_id, model_id)
            status = str(state.get("status") or "running").lower()
            if status in {"cancelled", "canceled"}:
                await _save(record, status="canceled", lease_owner=None, lease_expires_at=None)
                return
            if status in {"failed", "error", "expired", "timeout"}:
                message = str(state.get("error_message") or (state.get("error") or {}).get("message") or "provider task failed")
                await _save(record, status="failed", error={"code": str(state.get("error_code") or "provider_error"), "message": "provider reported a failed task"}, lease_owner=None, lease_expires_at=None)
                return
            if status == "succeeded":
                content = state.get("content") or {}
                video_url = str(content.get("video_url") or content.get("url") or "")
                if not video_url:
                    raise RuntimeError("provider succeeded without a video URL")
                body = await _download(latest, provider, video_url)
                key = f"results/{latest.workspace_id}/{latest.owner_subject}/{latest.id}-a{latest.attempt}.mp4"
                await local_storage.put(key, body, "video/mp4")
                await _save(
                    record,
                    status="succeeded",
                    progress=100,
                    result={"asset_ref": f"sdv-asset:{record.id}", "storage_key": key, "content_type": "video/mp4", "file_name": f"{record.id}.mp4", "sha256": hashlib.sha256(body).hexdigest(), "size_bytes": len(body)},
                    result_storage_key=key,
                    lease_owner=None,
                    lease_expires_at=None,
                )
                if catalog_store is not None:
                    await catalog_store.upsert_generated_media(latest, key, len(body))
                return
            progress = int(state.get("progress") or min(95, 10 + poll_count * 5))
            await _save(record, status="running", progress=max(5, min(99, progress)))
            poll_count += 1
            if poll_count >= max(1, int(settings.MODEL_RETURN_WAIT_TIMEOUT_SECONDS / max(1, settings.TASK_POLL_INTERVAL_SECONDS))):
                raise TimeoutError("provider task polling timed out")
            await asyncio.sleep(max(1, settings.TASK_POLL_INTERVAL_SECONDS))
    except LeaseLost:
        raise
    except Exception as exc:
        logger.warning("task execution interrupted task=%s error=%s", record.id, type(exc).__name__)
        if provider_id:
            # 远端任务仍存在：保留 ID，释放租约，下一轮仅查询/下载，不重新生成。
            await _save(record, lease_owner=None, lease_expires_at=None, next_poll_at=datetime.now(timezone.utc) + timedelta(seconds=30))
        else:
            latest = await task_store.get_by_id(record.id)
            code = "submission_uncertain" if getattr(latest, "submission_started_at", None) else "invalid_configuration"
            await _save(record, status="failed", error={"code": code, "message": "task could not be submitted; inspect request_id in service logs"}, lease_owner=None, lease_expires_at=None)
