import asyncio
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock

from worker import runner


def test_pool_processes_in_parallel_without_exceeding_slots(monkeypatch):
    async def check():
        pending = [SimpleNamespace(id=str(i)) for i in range(4)]
        started = []
        active = set()
        releases = {record.id: asyncio.Event() for record in pending}
        two_started = asyncio.Event()
        third_started = asyncio.Event()

        async def claim_next():
            return pending.pop(0) if pending else None

        async def process(record):
            started.append(record.id)
            active.add(record.id)
            assert len(active) <= 2
            if len(started) == 2:
                two_started.set()
            if len(started) == 3:
                third_started.set()
            try:
                await releases[record.id].wait()
            finally:
                active.remove(record.id)

        monkeypatch.setattr(runner, "task_store", SimpleNamespace(claim_next=claim_next))
        monkeypatch.setattr(runner, "process_task", process)
        monkeypatch.setattr(runner, "build_queue", lambda _: SimpleNamespace(receive=AsyncMock(return_value=None)))
        pool = asyncio.create_task(runner._worker_pool(0.001, 2, logging.getLogger("test")))
        try:
            await asyncio.wait_for(two_started.wait(), timeout=1)
            assert started == ["0", "1"]  # Second starts while first is still blocked.
            releases["0"].set()
            await asyncio.wait_for(third_started.wait(), timeout=1)
            assert started == ["0", "1", "2"]
        finally:
            pool.cancel()
            await asyncio.gather(pool, return_exceptions=True)
        assert not active  # Pool cancellation cleans up every slot.

    asyncio.run(check())


def test_durable_backlog_does_not_wait_for_redis(monkeypatch):
    async def check():
        done = asyncio.Event()
        receive = AsyncMock(side_effect=AssertionError("must claim durable work first"))

        async def process(_):
            done.set()
            await asyncio.Event().wait()

        monkeypatch.setattr(runner, "task_store", SimpleNamespace(claim_next=AsyncMock(return_value=SimpleNamespace(id="existing"))))
        monkeypatch.setattr(runner, "build_queue", lambda _: SimpleNamespace(receive=receive))
        monkeypatch.setattr(runner, "process_task", process)
        loop = asyncio.create_task(runner._worker_loop(1, logging.getLogger("test")))
        try:
            await asyncio.wait_for(done.wait(), 1)
            receive.assert_not_awaited()
        finally:
            loop.cancel()
            await asyncio.gather(loop, return_exceptions=True)

    asyncio.run(check())


def test_slot_survives_claim_and_processing_errors(monkeypatch):
    async def check():
        done = asyncio.Event()
        claim = AsyncMock(side_effect=[RuntimeError("database unavailable"), SimpleNamespace(id="bad"), SimpleNamespace(id="good")])

        async def process(record):
            if record.id == "bad":
                raise RuntimeError("processor interrupted")
            done.set()
            await asyncio.Event().wait()

        monkeypatch.setattr(runner, "task_store", SimpleNamespace(claim_next=claim))
        monkeypatch.setattr(runner, "build_queue", lambda _: SimpleNamespace(receive=AsyncMock(return_value=None)))
        monkeypatch.setattr(runner, "process_task", process)
        loop = asyncio.create_task(runner._worker_loop(0.001, logging.getLogger("test")))
        try:
            await asyncio.wait_for(done.wait(), 1)
            assert claim.await_count == 3
        finally:
            loop.cancel()
            await asyncio.gather(loop, return_exceptions=True)

    asyncio.run(check())
