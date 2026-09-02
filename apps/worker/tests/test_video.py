import hashlib
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from worker.config import Settings
from worker.errors import SafeTaskError, job_canceled_error
from worker import video as video_module
from worker.video import generate_video, video_input_path


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


class VideoInputTest(unittest.TestCase):
    def test_resolves_staged_video_input(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            content = b"video"
            key = "jobs/inputs/personal/user_123/batch/clip.webm"
            path = Path(tmp) / Path(key)
            path.parent.mkdir(parents=True)
            path.write_bytes(content)
            payload = {
                "_job_workspace_id": "default:user_123",
                "input_storage_key": key,
                "files": [
                    {
                        "storage_key": key,
                        "size": len(content),
                        "sha256": hashlib.sha256(content).hexdigest(),
                    }
                ],
            }
            self.assertEqual(video_input_path(payload, test_settings(tmp)), path.resolve())

    def test_falls_back_to_first_staged_video_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            content = b"video"
            key = "jobs/inputs/personal/user_123/batch/clip.webm"
            path = Path(tmp) / Path(key)
            path.parent.mkdir(parents=True)
            path.write_bytes(content)
            payload = {
                "_job_workspace_id": "default:user_123",
                "files": [
                    {
                        "storage_key": key,
                        "size": len(content),
                        "sha256": hashlib.sha256(content).hexdigest(),
                    }
                ],
            }
            self.assertEqual(video_input_path(payload, test_settings(tmp)), path.resolve())

    def test_rejects_legacy_input_outside_asset_root(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, tempfile.NamedTemporaryFile() as outside:
            with self.assertRaises(SafeTaskError):
                video_input_path({"input_path": outside.name}, test_settings(tmp))


class FakeVideoResponse:
    def __init__(
        self,
        body: dict[str, Any] | None = None,
        *,
        content: bytes = b"",
        content_type: str = "application/json",
        status_code: int = 200,
    ) -> None:
        self.body = body
        self.content = content
        self.status_code = status_code
        self.headers = {"Content-Type": content_type}

    def json(self) -> dict[str, Any]:
        if self.body is None:
            raise ValueError("not json")
        return self.body

    def iter_content(self, chunk_size: int):
        del chunk_size
        yield self.content

    def close(self) -> None:
        return None


class VideoGenerationTest(unittest.TestCase):
    def test_generates_polls_and_persists_openai_compatible_video(self) -> None:
        captured: dict[str, Any] = {}
        original_post = video_module.requests.post
        original_get = video_module.requests.get
        original_sleep = video_module.time.sleep

        def fake_post(url: str, **kwargs: Any) -> FakeVideoResponse:
            captured["create_url"] = url
            captured["headers"] = kwargs["headers"]
            captured["parts"] = {
                name: value[1] if value[0] is None else (value[0], value[2])
                for name, value in kwargs["files"]
            }
            return FakeVideoResponse({"id": "video-task-1", "status": "queued"})

        def fake_get(url: str, **kwargs: Any) -> FakeVideoResponse:
            captured.setdefault("get_urls", []).append(url)
            if url.endswith("/content"):
                self.assertTrue(kwargs["stream"])
                return FakeVideoResponse(content=b"video-bytes", content_type="video/mp4")
            return FakeVideoResponse({"id": "video-task-1", "status": "completed", "progress": 100})

        video_module.requests.post = fake_post
        video_module.requests.get = fake_get
        video_module.time.sleep = lambda _: None
        try:
            with tempfile.TemporaryDirectory() as tmp:
                progress: list[int] = []
                result = generate_video(
                    "job_video",
                    {
                        "model": "sora",
                        "prompt": "camera moves forward",
                        "seconds": "6",
                        "size": "1280x720",
                        "provider": {
                            "base_url": "https://provider.example/v1",
                            "endpoint": "videos",
                            "api_key": "sk-test",
                            "auth_type": "bearer",
                            "model": "sora",
                        },
                    },
                    test_settings(tmp),
                    progress.append,
                )
                output = Path(result["outputs"][0]["path"])
                self.assertEqual(output.read_bytes(), b"video-bytes")
                self.assertEqual(result["provider_task_id"], "video-task-1")
        finally:
            video_module.requests.post = original_post
            video_module.requests.get = original_get
            video_module.time.sleep = original_sleep

        self.assertEqual(captured["create_url"], "https://provider.example/v1/videos")
        self.assertEqual(captured["headers"]["Authorization"], "Bearer sk-test")
        self.assertEqual(captured["headers"]["Idempotency-Key"], "job_video")
        self.assertEqual(captured["parts"]["model"], "sora")
        self.assertEqual(captured["parts"]["prompt"], "camera moves forward")
        self.assertEqual(captured["get_urls"], [
            "https://provider.example/v1/videos/video-task-1",
            "https://provider.example/v1/videos/video-task-1/content",
        ])
        self.assertIn(95, progress)

    def test_canceled_job_requests_provider_cancellation(self) -> None:
        post_urls: list[str] = []
        original_post = video_module.requests.post

        def fake_post(url: str, **_: Any) -> FakeVideoResponse:
            post_urls.append(url)
            return FakeVideoResponse({"id": "video-task-cancel", "status": "queued"})

        calls = 0

        def canceling_progress(_: int) -> None:
            nonlocal calls
            calls += 1
            if calls >= 2:
                raise job_canceled_error()

        video_module.requests.post = fake_post
        try:
            with tempfile.TemporaryDirectory() as tmp, self.assertRaises(SafeTaskError) as raised:
                generate_video(
                    "job_cancel",
                    {
                        "model": "sora",
                        "prompt": "cancel me",
                        "provider": {
                            "base_url": "https://provider.example/v1",
                            "endpoint": "videos",
                            "api_key": "sk-test",
                            "auth_type": "bearer",
                            "model": "sora",
                        },
                    },
                    test_settings(tmp),
                    canceling_progress,
                )
        finally:
            video_module.requests.post = original_post

        self.assertEqual(raised.exception.code, "job_canceled")
        self.assertEqual(post_urls[-1], "https://provider.example/v1/videos/video-task-cancel/cancel")


if __name__ == "__main__":
    unittest.main()
