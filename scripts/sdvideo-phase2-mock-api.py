"""隔离 E2E 的只读 Provider 核对替身，不作为应用或生产启动入口。"""
import sys
from pathlib import Path

SERVICE = Path(__file__).resolve().parents[1] / "apps" / "sd-video"
sys.path[:0] = [str(SERVICE), str(SERVICE / "api")]

from app.config import settings

if settings.APP_ENV != "development" or settings.EXECUTION_MODE != "mock":
    raise RuntimeError("reconciliation fixture is restricted to development mock mode")

from worker import processor
import uvicorn


async def verify_existing(record, provider, provider_id, model):
    if provider_id != f"mock-reconciled:{record.id}":
        raise ValueError("mock provider task not found")
    return {"status": "running"}


processor._query_upstream = verify_existing

if __name__ == "__main__":
    uvicorn.run("api.main:app", host="127.0.0.1", port=38211, loop="asyncio:SelectorEventLoop")
