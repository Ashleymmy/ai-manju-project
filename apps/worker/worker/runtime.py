"""共同监管 Celery 与健康接口；任一子进程退出时收尾并交给容器重启。"""
from __future__ import annotations

import logging
import os
import signal
import socket
import subprocess
import sys
import threading
import time

from .config import load_settings

POLL_SECONDS = 0.25
SHUTDOWN_SECONDS = 30
logger = logging.getLogger(__name__)


def worker_name() -> str:
    return f"celery@{socket.gethostname()}"


def commands() -> list[list[str]]:
    settings = load_settings()
    return [
        [sys.executable, "-m", "uvicorn", "worker.app:app", "--host", settings.health_host,
         "--port", str(settings.health_port)],
        [sys.executable, "-m", "celery", "-A", "worker.tasks", "worker", "--loglevel=info",
         f"--hostname={worker_name()}", f"--concurrency={settings.worker_concurrency}",
         "--prefetch-multiplier=1"],
    ]


def stop_children(children: list[subprocess.Popen], grace: float = SHUTDOWN_SECONDS) -> None:
    for child in children:
        if child.poll() is None:
            try:
                child.terminate()
            except ProcessLookupError:
                logger.debug("child already stopped")
    deadline = time.monotonic() + grace
    for child in children:
        try:
            child.wait(timeout=max(0, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            # 每个子进程拥有独立进程组；强制收尾也不能遗留 Celery pool。
            if os.name == "posix":
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    logger.debug("child group already stopped")
            else:
                child.kill()
            child.wait()
        # 主进程已退出时也收走同组孤儿 pool；进程组由本监管器创建。
        if os.name == "posix":
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                logger.debug("child group already stopped")


def supervise(process_commands: list[list[str]], stop: threading.Event) -> int:
    children: list[subprocess.Popen] = []
    try:
        for command in process_commands:
            children.append(subprocess.Popen(command, start_new_session=os.name == "posix"))
        while not stop.is_set():
            for index, child in enumerate(children):
                code = child.poll()
                if code is not None:
                    logger.error("worker child exited index=%s code=%s", index, code)
                    return 1  # 常驻服务即使意外以 0 退出，也不能保留半个容器。
            stop.wait(POLL_SECONDS)
        return 0
    except OSError as exc:
        logger.error("worker child startup failed category=%s", type(exc).__name__)
        return 1
    finally:
        stop_children(children)


def main() -> int:
    logging.basicConfig(level=logging.INFO)
    stop = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda _sig, _frame: stop.set())
    return supervise(commands(), stop)


if __name__ == "__main__":
    raise SystemExit(main())
