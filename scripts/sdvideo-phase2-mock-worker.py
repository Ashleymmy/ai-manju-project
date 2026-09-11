"""仅隔离 E2E 的故障窗口：延迟 Mock 完成，不修改真实 Provider 行为。"""
import asyncio
import sys
from pathlib import Path

SERVICE = Path(__file__).resolve().parents[1] / "apps" / "sd-video"
sys.path[:0] = [str(SERVICE), str(SERVICE / "api")]

from worker import runner, processor
from app.config import settings

if settings.EXECUTION_MODE != "mock" or settings.APP_ENV != "development":
    raise RuntimeError("fault fixture is only allowed in development mock mode")

finish = processor._finish_mock


async def delayed_finish(record):
    await processor._save(record, status="running", provider_task_id=f"mock:{record.id}")
    await asyncio.sleep(3)
    await finish(record)


processor._finish_mock = delayed_finish
asyncio.run(runner.run())
