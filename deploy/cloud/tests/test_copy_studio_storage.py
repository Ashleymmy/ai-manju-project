"""复制工具使用临时源目录和内存对象库；不访问实际 NAS 或数据库。"""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "copy_studio_storage", Path(__file__).resolve().parents[1] / "copy-studio-storage.py")
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


class MemoryStorage:
    def __init__(self):
        self.objects = {}
        self.uploads = []
        self.corrupt = False

    def upload(self, key, path, content_type):
        data = path.read_bytes()
        self.uploads.append(key)
        if key in self.objects and self.objects[key] != data:
            raise tool.CopyError("Content conflict")
        self.objects[key] = data

    def download(self, key, target, limit):
        data = self.objects[key]
        target.write_bytes(b"x" * len(data) if self.corrupt else data)


class CopyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "source"
        self.state = Path(self.temporary.name) / "state"
        self.root.mkdir()
        self.state.mkdir()
        self.put("personal/user/asset_one.png", b"first")
        self.put("jobs/job_one/output.png", b"first")
        self.put("exports/personal/user/export_one.zip", b"archive")
        self.database = {
            "assets": [{"id": "asset_one", "user_id": "user", "workspace_id": "default:user",
                        "url": "/api/assets/asset_one/content", "content_type": "image/png",
                        "size": 5, "content_sha256": ""}],
            "exports": [{"id": "export_one", "status": "succeeded",
                         "storage_key": "exports/personal/user/export_one.zip", "size": 7}],
            "seedance_assets": [], "jobs": [{"status": "succeeded", "count": 1}],
        }
        self.store = MemoryStorage()

    def put(self, key, data):
        path = self.root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def plan(self):
        return tool.plan(self.root, self.state, self.database)

    def copy(self, manifest, budget=tool.BATCH_BYTES):
        return tool.copy_batch(self.root, self.state, manifest, self.store, self.database, budget)

    def test_plan_preserves_source_and_database(self):
        before = tool.snapshot(self.root)
        database = tool.canonical(self.database)
        manifest = self.plan()
        self.assertEqual(before, tool.snapshot(self.root))
        self.assertEqual(database, tool.canonical(self.database))
        self.assertEqual(manifest, tool.load_manifest(self.state))
        self.assertEqual(3, len(manifest["files"]))
        self.assertEqual("image/png", manifest["content_types"]["personal/user/asset_one.png"])

    def test_existing_plan_is_never_replaced(self):
        self.plan()
        before = (self.state / "manifest.json").read_bytes()
        with self.assertRaises(tool.CopyError):
            self.plan()
        self.assertEqual(before, (self.state / "manifest.json").read_bytes())

    def test_missing_registered_asset_stops_before_manifest(self):
        (self.root / "personal/user/asset_one.png").unlink()
        with self.assertRaisesRegex(tool.CopyError, "no readable local source"):
            self.plan()
        self.assertFalse((self.state / "manifest.json").exists())

    def test_asset_size_and_hash_mismatch(self):
        for change in ({"size": 10}, {"content_sha256": "0" * 64}):
            with self.subTest(change=change):
                database = json.loads(tool.canonical(self.database))
                database["assets"][0].update(change)
                with self.assertRaises(tool.CopyError):
                    tool.check_references(database, tool.snapshot(self.root))

    def test_missing_export_is_not_silently_excluded(self):
        (self.root / "exports/personal/user/export_one.zip").unlink()
        with self.assertRaisesRegex(tool.CopyError, "Associated file"):
            self.plan()

    def test_personal_asset_without_old_workspace_id(self):
        self.database["assets"][0]["workspace_id"] = ""
        self.assertEqual(3, len(self.plan()["files"]))

    def test_batch_size_and_resume_keep_prior_verified_objects(self):
        manifest = self.plan()
        first = self.copy(manifest, budget=7)
        self.assertEqual(1, first["verified"])
        self.assertFalse(first["complete"])
        first_key = self.store.uploads[0]
        while not self.copy(manifest, budget=7)["complete"]:
            pass
        self.assertEqual(1, self.store.uploads.count(first_key))
        self.assertEqual(3, len(self.store.objects))
        self.assertEqual(manifest["files"], tool.snapshot(self.root))

    def test_completed_copy_is_noop(self):
        manifest = self.plan()
        self.assertTrue(self.copy(manifest)["complete"])
        before = list(self.store.uploads)
        self.assertTrue(self.copy(manifest)["complete"])
        self.assertEqual(before, self.store.uploads)

    def test_conflicting_remote_content_is_not_overwritten(self):
        manifest = self.plan()
        key = next(iter(manifest["files"]))
        self.store.objects[key] = b"existing different object"
        with self.assertRaisesRegex(tool.CopyError, "Content conflict"):
            self.copy(manifest)
        self.assertEqual(b"existing different object", self.store.objects[key])
        self.assertEqual({}, tool.load_progress(self.state, manifest)["verified"])

    def test_bad_readback_not_checkpointed_and_same_remote_content_can_resume(self):
        manifest = self.plan()
        self.store.corrupt = True
        with self.assertRaisesRegex(tool.CopyError, "Remote readback"):
            self.copy(manifest)
        self.assertEqual({}, tool.load_progress(self.state, manifest)["verified"])
        self.assertEqual(1, len(self.store.objects))
        self.store.corrupt = False
        self.assertTrue(self.copy(manifest)["complete"])

    def test_source_change_stops_before_upload(self):
        manifest = self.plan()
        self.put("jobs/job_one/output.png", b"changed")
        with self.assertRaisesRegex(tool.CopyError, "Local file set"):
            self.copy(manifest)
        self.assertEqual([], self.store.uploads)

    def test_new_file_stops_before_upload(self):
        manifest = self.plan()
        self.put("jobs/job_new/output.png", b"new")
        with self.assertRaises(tool.CopyError):
            self.copy(manifest)
        self.assertEqual([], self.store.uploads)

    def test_database_change_stops_before_upload(self):
        manifest = self.plan()
        self.database["assets"][0]["size"] += 1
        with self.assertRaisesRegex(tool.CopyError, "Database references"):
            self.copy(manifest)
        self.assertEqual([], self.store.uploads)

    def test_manifest_change_rejects_previous_receipts(self):
        manifest = self.plan()
        self.copy(manifest, budget=7)
        manifest["content_types"]["personal/user/asset_one.png"] = "different/type"
        with self.assertRaisesRegex(tool.CopyError, "Manifest changed"):
            tool.load_progress(self.state, manifest)

    def test_unapproved_source_root_rejected(self):
        self.put("unapproved/config.txt", b"do not copy")
        with self.assertRaisesRegex(tool.CopyError, "approved four"):
            self.plan()

    def test_symlink_file_rejected(self):
        (self.root / "jobs/link.png").symlink_to(self.root / "personal/user/asset_one.png")
        with self.assertRaises(tool.CopyError):
            self.plan()

    def test_symlink_directory_rejected(self):
        (self.root / "jobs/linkdir").symlink_to(self.state, target_is_directory=True)
        with self.assertRaisesRegex(tool.CopyError, "symbolic-link directory"):
            self.plan()

    def test_state_symlink_rejected(self):
        manifest = self.plan()
        outside = self.state / "outside.json"
        outside.write_text("{}")
        (self.state / "progress.json").symlink_to(outside)
        with self.assertRaises(tool.CopyError):
            tool.load_progress(self.state, manifest)
        self.assertEqual("{}", outside.read_text())

    def test_dangling_progress_symlink_rejected(self):
        manifest = self.plan()
        (self.state / "progress.json").symlink_to(self.state / "not-created.json")
        with self.assertRaises(tool.CopyError):
            tool.load_progress(self.state, manifest)

    def test_timeout_stops_batch_without_retry_or_receipt(self):
        manifest = self.plan()

        def timeout(key, path, content_type):
            self.store.uploads.append(key)
            raise tool.CopyTimeout("test timeout")

        self.store.upload = timeout
        with self.assertRaises(tool.CopyTimeout):
            self.copy(manifest)
        self.assertEqual(1, len(self.store.uploads))
        self.assertEqual({}, tool.load_progress(self.state, manifest)["verified"])


if __name__ == "__main__":
    unittest.main()
