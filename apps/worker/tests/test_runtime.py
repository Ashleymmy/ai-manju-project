import os
import sys
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from worker import runtime


class RuntimeTest(unittest.TestCase):
    def setUp(self):
        # 单测中的 PID 是替身，不对宿主机进程组发送信号。
        patcher = patch.object(runtime.os, "killpg", create=True)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_commands_use_configured_capacity_and_exact_node(self):
        with patch.dict(os.environ, {"WORKER_CONCURRENCY": "2"}, clear=True):
            commands = runtime.commands()
        self.assertEqual(commands[0][:4], [sys.executable, "-m", "uvicorn", "worker.app:app"])
        self.assertIn("--concurrency=2", commands[1])
        self.assertIn(f"--hostname={runtime.worker_name()}", commands[1])
        self.assertIn("--prefetch-multiplier=1", commands[1])

    def test_either_child_exit_is_failure_and_stops_peer(self):
        for index in (0, 1):
            for code in (0, 2, -9):
                children = [Mock(), Mock()]
                for child in children:
                    child.poll.return_value = None
                children[index].poll.return_value = code
                with patch.object(runtime.subprocess, "Popen", side_effect=children):
                    self.assertEqual(runtime.supervise([["health"], ["celery"]], threading.Event()), 1)
                children[1 - index].terminate.assert_called_once()
                for child in children:
                    child.wait.assert_called_once()

    def test_partial_start_failure_stops_started_child(self):
        child = Mock()
        child.poll.return_value = None
        with patch.object(runtime.subprocess, "Popen", side_effect=[child, OSError("private detail")]):
            with self.assertLogs(runtime.logger, "ERROR") as output:
                self.assertEqual(runtime.supervise([["health"], ["celery"]], threading.Event()), 1)
        child.terminate.assert_called_once()
        self.assertNotIn("private detail", "".join(output.output))

    def test_signal_shutdown_stops_both_children(self):
        children = [Mock(), Mock()]
        for child in children:
            child.poll.return_value = None
        stopped = threading.Event()
        stopped.set()
        with patch.object(runtime.subprocess, "Popen", side_effect=children):
            self.assertEqual(runtime.supervise([["health"], ["celery"]], stopped), 0)
        for child in children:
            child.terminate.assert_called_once()

    def test_shutdown_has_shared_deadline_and_kills_stuck_pool(self):
        child = Mock(pid=123)
        child.poll.return_value = None
        child.wait.side_effect = [runtime.subprocess.TimeoutExpired("celery", 0), 0]
        with patch.object(runtime.os, "name", "posix"), patch.object(runtime.os, "killpg", create=True) as kill:
            runtime.stop_children([child], grace=0)
        kill.assert_any_call(123, runtime.signal.SIGKILL)


if __name__ == "__main__":
    unittest.main()
