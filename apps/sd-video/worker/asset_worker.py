"""素材注册、状态查询、删除补偿；网络超时不盲目重复注册。"""
import asyncio
import logging
import time
import os

from app.config import settings
from app.providers.seedance import seedance_provider_registry
from app.providers.seedance.base import first_string
from app.standalone_api import local_storage, volcano_store

logger = logging.getLogger("sdvideo.assets")


async def process_asset(item, store=volcano_store, storage=local_storage, provider=None, mock=False):
    async def save(**changes):
        updated = await store.save(item, **changes)
        if updated is None: raise RuntimeError("asset lease lost")
        return updated

    try:
        if mock:
            await save(release=True, status="deleted" if item["status"] == "delete_requested" else "active",
                       provider_asset_id=item.get("provider_asset_id") or f"mock_{item['id']}")
            return
        provider = provider or seedance_provider_registry.get(item["upstream_provider"])
        if not provider.configured() or provider.namespace != item["provider_namespace"]:
            await save(release=True, error={"code": "provider_configuration_changed"})
            return
        remote_id = item.get("provider_asset_id")
        if item["status"] == "delete_requested":
            # 没有远端 ID 的不确定提交不能伪称远端已清理。
            if not remote_id and item.get("submission_started_at"):
                await save(release=True, error={"code": "submission_uncertain"})
                return
            if remote_id:
                try:
                    await provider.delete_asset(remote_id)
                except Exception as exc:
                    if getattr(exc, "http_status", None) != 404: raise
            await save(release=True, status="deleted", error=None)
            return
        if not remote_id:
            if item.get("submission_started_at"):
                await save(release=True, status="failed", error={"code": "submission_uncertain"})
                return
            source = await storage.url(item["storage_key"])
            if not source.startswith("https://"): raise ValueError("public HTTPS input storage required")
            # 先持久化意图；恢复时不重新调用可能已经成功的远端创建。
            await save(submission_started_at=time.time())
            group = await provider.create_asset_group(item["id"], "Studio isolated asset group")
            group_id = first_string(group, "id", "GroupId")
            if not group_id: raise ValueError("missing asset group id")
            await save(group_id=group_id)
            result = await provider.create_asset(group_id, source, item["name"], item["kind"].capitalize())
            remote_id = first_string(result, "id", "AssetId")
            if not remote_id: raise ValueError("missing provider asset id")
            await save(release=True, provider_asset_id=remote_id, status="processing", error=None)
            return
        result = await provider.get_asset(remote_id, item.get("group_id") or "")
        raw = result.get("record") or result.get("raw") or result
        status = first_string(raw, "Status", "status").lower()
        mapped = {"active": "active", "failed": "failed", "error": "failed"}.get(status, "processing")
        await save(release=True, status=mapped, error={"code": "provider_asset_failed"} if mapped == "failed" else None)
    except Exception as exc:
        # 不记录异常正文：SDK 可能在其中包含签名 URL 或密钥。
        logger.warning("asset operation failed asset=%s category=%s", item["id"], type(exc).__name__)
        await store.save(item, release=True, error={"code": "asset_operation_failed", "category": type(exc).__name__})


async def run():
    from app.runtime_health import worker_heartbeat
    from worker.runner import _health_server
    from worker.input_cleanup import run_cleanup
    from worker.thumbnails import thumbnail_loop
    await asyncio.gather(asset_loop(), thumbnail_loop(), worker_heartbeat("asset"), _health_server(int(os.getenv("SDVIDEO_ASSET_WORKER_HEALTH_PORT", "8203"))), run_cleanup())


async def asset_loop():
    logging.basicConfig(level="INFO")
    while True:
        try:
            item = await volcano_store.claim()
            if item:
                await asyncio.wait_for(process_asset(item, mock=settings.EXECUTION_MODE == "mock"), timeout=150)
            else:
                await asyncio.sleep(5)
        except Exception as exc:
            logger.warning("asset worker unavailable category=%s", type(exc).__name__)
            await asyncio.sleep(5)


if __name__ == "__main__":
    from worker import runner  # Windows 的 Selector policy 必须在创建事件循环前设置。
    asyncio.run(run())
