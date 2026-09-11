"""仅清理新服务登记过的输入；使用行锁与任务创建协调，失败删除保持可补偿。"""
import asyncio
import logging

from app.standalone_api import input_store, local_storage

RETENTION_DAYS = 7


async def cleanup_once(store=input_store, storage=local_storage):
    if not store.database_url: return 0
    async with store.connection() as connection:
        cursor = await connection.execute("""select storage_key from input_objects i where
            i.status='deleting' or (i.status in ('pending','complete') and i.created_at<now()-%s*interval '1 day'
            and not exists(select 1 from tasks t where t.request->'references' @> jsonb_build_array(jsonb_build_object('storage_token',i.storage_key))
              and (t.status not in ('succeeded','failed','canceled') or t.updated_at>now()-%s*interval '1 day' or t.error->>'code'='submission_uncertain'))
            and not exists(select 1 from volcano_assets v where v.storage_key=i.storage_key and v.status<>'deleted'))
            order by created_at for update skip locked limit 5""", (RETENTION_DAYS, RETENTION_DAYS))
        keys = [row["storage_key"] for row in await cursor.fetchall()]
        for key in keys:
            await connection.execute("update input_objects set status='deleting' where storage_key=%s", (key,))
    for key in keys:
        await storage.delete(key)
        async with store.connection() as connection:
            await connection.execute("update input_objects set status='deleted' where storage_key=%s and status='deleting'", (key,))
    return len(keys)


async def run_cleanup():
    while True:
        try:
            await cleanup_once()
        except Exception as exc:
            logging.getLogger("sdvideo.cleanup").warning("input cleanup deferred category=%s", type(exc).__name__)
        await asyncio.sleep(60)
