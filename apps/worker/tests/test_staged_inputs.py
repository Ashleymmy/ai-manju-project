import hashlib
import os
import sys
import tempfile
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from worker.config import Settings
from worker.errors import SafeTaskError
from worker.staged_inputs import JOB_WORKSPACE_FIELD, cleanup_staged_inputs, open_staged_input, resolve_staged_input_path


def test_settings(root: str) -> Settings:
    return Settings(
        celery_broker_url="redis://localhost:6379/0",
        celery_queue_name="celery",
        celery_result_backend=None,
        database_url="",
        job_max_attempts=3,
        job_default_timeout_seconds=30,
        asset_storage_dir=Path(root),
        worker_tmp_dir=Path(root) / "tmp",
        ffmpeg_bin="ffmpeg",
        health_host="0.0.0.0",
        health_port=8101,
    )


class StagedInputsTest(unittest.TestCase):
    def test_open_and_cleanup_valid_workspace_input(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            settings = test_settings(tmp)
            key = "jobs/inputs/personal/user_123/batch/file.png"
            path = Path(tmp) / Path(key)
            path.parent.mkdir(parents=True)
            content = b"staged-image"
            path.write_bytes(content)
            payload = {
                JOB_WORKSPACE_FIELD: "default:user_123",
                "staged_input_keys": [key],
            }
            item = {
                "storage_key": key,
                "size": len(content),
                "sha256": hashlib.sha256(content).hexdigest(),
            }

            with open_staged_input(item, payload, settings) as stream:
                self.assertEqual(stream.read(), content)
            self.assertEqual(cleanup_staged_inputs(payload, "default:user_123", settings), [])
            self.assertFalse(path.exists())

    def test_rejects_traversal_cross_workspace_and_checksum_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            settings = test_settings(tmp)
            with self.assertRaises(SafeTaskError):
                resolve_staged_input_path(
                    "/etc/passwd",
                    "default:user_123",
                    settings,
                    require_exists=False,
                )
            with self.assertRaises(SafeTaskError):
                resolve_staged_input_path(
                    "jobs/inputs/personal/user_123/../user_999/file.png",
                    "default:user_123",
                    settings,
                    require_exists=False,
                )
            with self.assertRaises(SafeTaskError):
                resolve_staged_input_path(
                    "jobs/inputs/personal/user_999/batch/file.png",
                    "default:user_123",
                    settings,
                    require_exists=False,
                )

            key = "jobs/inputs/personal/user_123/batch/file.png"
            path = Path(tmp) / Path(key)
            path.parent.mkdir(parents=True)
            path.write_bytes(b"content")
            payload = {JOB_WORKSPACE_FIELD: "default:user_123"}
            with self.assertRaises(SafeTaskError) as size_error:
                open_staged_input(
                    {"storage_key": key, "size": 999, "sha256": hashlib.sha256(b"content").hexdigest()},
                    payload,
                    settings,
                )
            self.assertEqual(size_error.exception.code, "staged_input_size_mismatch")
            with self.assertRaises(SafeTaskError) as caught:
                open_staged_input(
                    {"storage_key": key, "size": 7, "sha256": "0" * 64},
                    payload,
                    settings,
                )
            self.assertEqual(caught.exception.code, "staged_input_checksum_mismatch")

    @unittest.skipIf(os.name == "nt", "symlink creation may require elevated Windows privileges")
    def test_rejects_symlink_escape(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as outside:
            settings = test_settings(tmp)
            workspace = Path(tmp) / "jobs" / "inputs" / "personal" / "user_123"
            workspace.mkdir(parents=True)
            (Path(outside) / "secret.bin").write_bytes(b"secret")
            (workspace / "batch").symlink_to(Path(outside), target_is_directory=True)
            with self.assertRaises(SafeTaskError):
                resolve_staged_input_path(
                    "jobs/inputs/personal/user_123/batch/secret.bin",
                    "default:user_123",
                    settings,
                    require_exists=True,
                )


if __name__ == "__main__":
    unittest.main()
