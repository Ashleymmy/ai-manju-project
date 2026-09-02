import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from worker.assets import asset_storage_key, register_result_assets, registered_asset_id
from worker.config import Settings


class FakeStore:
    def __init__(self) -> None:
        self.assets: list[dict[str, Any]] = []

    def create_asset(self, asset: dict[str, Any]) -> dict[str, Any]:
        for existing in self.assets:
            if existing["id"] == asset["id"]:
                return existing
        self.assets.append(asset)
        return asset


class TimestampStore(FakeStore):
    def create_asset(self, asset: dict[str, Any]) -> dict[str, Any]:
        persisted = super().create_asset(asset)
        timestamp = datetime(2026, 7, 16, 8, 24, 23, tzinfo=timezone.utc)
        return {**persisted, "created_at": timestamp, "updated_at": timestamp}


class AssetsTest(unittest.TestCase):
    def test_asset_storage_key_matches_go_personal_layout(self) -> None:
        self.assertEqual(
            asset_storage_key("default:user_123", "asset_abc", ".png").as_posix(),
            "personal/user_123/asset_abc.png",
        )

    def test_asset_storage_key_matches_go_team_layout(self) -> None:
        self.assertEqual(
            asset_storage_key("team:default", "asset_abc", ".mp4").as_posix(),
            "team/default/asset_abc.mp4",
        )

    def test_register_result_assets_copies_output_and_inserts_asset(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.mp4"
            source.write_bytes(b"video")
            store = FakeStore()
            settings = Settings(
                celery_broker_url="redis://localhost:6379/0",
                celery_queue_name="celery",
                celery_result_backend=None,
                database_url="",
                job_max_attempts=3,
                job_default_timeout_seconds=30,
                asset_storage_dir=root / "assets",
                worker_tmp_dir=root / "tmp",
                ffmpeg_bin="ffmpeg",
                health_host="0.0.0.0",
                health_port=8101,
            )

            result = register_result_assets(
                store,
                {
                    "id": "job_video_1",
                    "user_id": "user_123",
                    "workspace_id": "default:user_123",
                    "payload": {
                        "asset_registration": {
                            "folder_id": "folder_1",
                            "category": "character",
                            "source_type": "comic_batch",
                            "source_project_id": "project_1",
                            "parent_asset_ids": ["asset_parent_1", "asset_parent_1", "asset_parent_2"],
                            "relation_type": "edit",
                            "source_node_id": "node_1",
                        }
                    },
                },
                {"outputs": [{"path": str(source), "content_type": "video/mp4"}]},
                settings,
                "video",
            )

            self.assertEqual(len(store.assets), 1)
            self.assertTrue(Path(result["outputs"][0]["path"]).exists())
            self.assertEqual(store.assets[0]["url"], f"/api/assets/{store.assets[0]['id']}/content")
            self.assertEqual(store.assets[0]["folder_id"], "folder_1")
            self.assertEqual(store.assets[0]["category"], "character")
            self.assertEqual(store.assets[0]["source_type"], "comic_batch")
            self.assertEqual(store.assets[0]["source_job_id"], "job_video_1")
            self.assertEqual(store.assets[0]["source_metadata"]["candidate_index"], 1)
            self.assertEqual(
                store.assets[0]["content_sha256"],
                "0cab1c9617404faf2b24e221e189ca5945813e14d3f766345b09ca13bbe28ffc",
            )
            self.assertEqual(store.assets[0]["ingestion_mode"], "automatic")
            self.assertEqual(store.assets[0]["parent_asset_ids"], ["asset_parent_1", "asset_parent_2"])
            self.assertEqual(store.assets[0]["relation_type"], "edit")
            self.assertEqual(store.assets[0]["source_node_id"], "node_1")

            second = register_result_assets(
                store,
                {
                    "id": "job_video_1",
                    "user_id": "user_123",
                    "workspace_id": "default:user_123",
                    "payload": {"asset_registration": {"folder_id": "folder_1"}},
                },
                {"outputs": [{"path": str(source), "content_type": "video/mp4"}]},
                settings,
                "video",
            )
            self.assertEqual(len(store.assets), 1)
            self.assertEqual(second["outputs"][0]["asset_id"], result["outputs"][0]["asset_id"])

    def test_registered_asset_id_is_stable_per_job_output(self) -> None:
        self.assertEqual(registered_asset_id("job_1", 0), registered_asset_id("job_1", 0))
        self.assertNotEqual(registered_asset_id("job_1", 0), registered_asset_id("job_1", 1))
        self.assertNotEqual(registered_asset_id("job_1", 0), registered_asset_id("job_2", 0))

    def test_registered_asset_timestamps_are_json_compatible(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.png"
            source.write_bytes(b"png")
            result = register_result_assets(
                TimestampStore(),
                {
                    "id": "job_image_1",
                    "user_id": "user_123",
                    "workspace_id": "default:user_123",
                    "payload": {},
                },
                {"outputs": [{"path": str(source), "content_type": "image/png"}]},
                Settings(
                    celery_broker_url="redis://localhost:6379/0",
                    celery_queue_name="celery",
                    celery_result_backend=None,
                    database_url="",
                    job_max_attempts=3,
                    job_default_timeout_seconds=30,
                    asset_storage_dir=root / "assets",
                    worker_tmp_dir=root / "tmp",
                    ffmpeg_bin="ffmpeg",
                    health_host="0.0.0.0",
                    health_port=8101,
                ),
                "image",
            )

            self.assertEqual(result["assets"][0]["created_at"], "2026-07-16T08:24:23+00:00")
            self.assertEqual(result["assets"][0]["updated_at"], "2026-07-16T08:24:23+00:00")


if __name__ == "__main__":
    unittest.main()
