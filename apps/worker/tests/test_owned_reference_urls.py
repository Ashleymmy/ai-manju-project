import copy
import os
import tempfile
import unittest
from contextlib import contextmanager
from unittest.mock import Mock, patch

from worker import owned_reference_urls as owned
from worker import video_references as refs
from worker.errors import SafeTaskError
from test_video import test_settings
from worker.db import JobStore
from worker.config import load_settings

ENV = {"ASSET_STORAGE_BACKEND": "supabase", "STUDIO_SUPABASE_URL": "https://nas.test:18000", "STUDIO_SUPABASE_PUBLIC_URL": "http://studio.test", "STUDIO_SUPABASE_BUCKET": "studio-test-assets"}
OLD = "http://studio.test/storage/v1/object/sign/studio-test-assets/personal/user/asset-video.mp4?token=expired"


class OwnedReferenceURLTest(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.dict(os.environ, ENV, clear=False))
        self.store = Mock()
        self.store.owns_reference_asset.return_value = True
        self.sign = self.enterContext(patch.object(owned.object_storage, "signed_reference_url", return_value="http://studio.test/fresh"))

    def test_expired_reference_is_refreshed_without_fetch_or_upload(self):
        self.assertEqual(owned.refresh_owned_reference(OLD, "video_url", "default:user", self.store), "http://studio.test/fresh")
        self.store.owns_reference_asset.assert_called_once_with("asset-video", "default:user", "video")
        self.sign.assert_called_once_with("personal/user/asset-video.mp4")

    def test_foreign_workspace_missing_asset_and_wrong_kind_cannot_refresh(self):
        self.assertEqual(owned.refresh_owned_reference(OLD, "video_url", "default:other", self.store), OLD)
        self.store.owns_reference_asset.assert_not_called()
        self.store.owns_reference_asset.return_value = False
        for kind in ("image_url", "video_url"):
            with self.assertRaises(SafeTaskError):
                owned.refresh_owned_reference(OLD, kind, "default:user", self.store)
        self.sign.assert_not_called()

    def test_shared_team_asset_uses_team_ownership(self):
        raw = OLD.replace("personal/user/", "team/default/")
        owned.refresh_owned_reference(raw, "video_url", "team:default", self.store)
        self.store.owns_reference_asset.assert_called_once_with("asset-video", "team:default", "video")
        self.assertEqual(owned.refresh_owned_reference(raw, "video_url", "default:user", self.store), raw)

    def test_does_not_sign_external_registered_staging_or_other_bucket_urls(self):
        urls = ["asset://registered", "https://external.test/video?token=expired", OLD.replace("studio.test", "studio.test.evil"),
                OLD.replace("studio-test-assets", "studio-sdvideo-test-inputs"), OLD.replace("personal/user/", "jobs/inputs/personal/user/")]
        for raw in urls:
            self.assertEqual(owned.refresh_owned_reference(raw, "video_url", "default:user", self.store), raw)
        self.sign.assert_not_called()
        self.store.owns_reference_asset.assert_not_called()

    def test_encoded_traversal_or_nested_keys_never_grant_read_access(self):
        for path in ("personal/user/../other/a.mp4", "personal/user/%2e%2e/other/a.mp4", "personal/user/%252e%252e/a.mp4", "personal/user/%5cother.mp4", "personal/user/asset-video.mp4/secret", "personal/user//asset-video.mp4", "personal/user/asset-video%00.mp4"):
            with self.subTest(path=path), self.assertRaises(SafeTaskError):
                owned.refresh_owned_reference(OLD.replace("personal/user/asset-video.mp4", path), "video_url", "default:user", self.store)
        self.sign.assert_not_called()

    def test_database_failure_stops_before_provider_with_safe_message(self):
        self.store.owns_reference_asset.side_effect = RuntimeError("private database diagnostics")
        with self.assertRaises(SafeTaskError) as result:
            owned.refresh_owned_reference(OLD, "video_url", "default:user", self.store)
        self.assertNotIn("private", str(result.exception))
        self.assertTrue(result.exception.retryable)
        self.sign.assert_not_called()

    def test_actual_native_context_keeps_original_body_and_does_not_delete_asset(self):
        body = {"content": [{"type": "video_url", "video_url": {"url": OLD}, "role": "reference_video"}]}
        original = copy.deepcopy(body)
        checkpoint = Mock(store=self.store, references=[], state={})
        with tempfile.TemporaryDirectory() as tmp, patch.object(refs.object_storage, "upload") as upload, patch.object(refs.object_storage, "delete") as delete:
            with refs.native_video_references("job", body, {"_job_workspace_id": "default:user"}, test_settings(tmp), checkpoint=checkpoint) as ready:
                self.assertEqual(ready["content"][0]["video_url"]["url"], "http://studio.test/fresh")
                self.assertEqual(ready["content"][0]["role"], "reference_video")
            upload.assert_not_called()
            delete.assert_not_called()
        self.assertEqual(body, original)
        self.assertEqual(checkpoint.references, [])

    def test_oss_bucket_and_configured_cdn_urls_still_require_database_access(self):
        with patch.dict(os.environ, {"ASSET_STORAGE_BACKEND": "oss", "STUDIO_OSS_ENDPOINT": "https://oss-cn-shanghai.aliyuncs.com", "STUDIO_OSS_BUCKET": "mybucket", "ASSET_CDN_BASE_URL": "https://cdn.test"}):
            for host in ("mybucket.oss-cn-shanghai.aliyuncs.com", "cdn.test"):
                raw = "https://" + host + "/personal/user/asset-video.mp4?auth_key=expired"
                self.assertEqual(owned.refresh_owned_reference(raw, "video_url", "default:user", self.store), "http://studio.test/fresh")
            self.assertEqual(self.store.owns_reference_asset.call_count, 2)
            self.assertIsNone(owned.studio_object_key("https://other.oss-cn-shanghai.aliyuncs.com/personal/user/a.mp4"))


@unittest.skipUnless(os.getenv("STUDIO_OWNED_REFERENCE_POSTGRES_TEST") == "1", "requires session-local PostgreSQL opt-in")
class OwnedReferencePostgresTest(unittest.TestCase):
    def test_only_real_asset_with_matching_workspace_and_kind_is_authorized(self):
        import psycopg
        from psycopg.rows import dict_row
        class TempStore(JobStore):
            @contextmanager
            def connect(self):
                with conn.transaction():
                    yield conn
        with psycopg.connect(load_settings().database_url, row_factory=dict_row, autocommit=True) as conn:
            conn.execute("SET search_path TO pg_temp")
            conn.execute("CREATE TEMP TABLE assets (id text, workspace_id text, type text)")
            conn.execute("INSERT INTO assets VALUES ('own','default:user','video'),('foreign','default:other','video'),('shared','team:default','image')")
            store = TempStore("")
            self.assertTrue(store.owns_reference_asset("own", "default:user", "video"))
            self.assertTrue(store.owns_reference_asset("shared", "team:default", "image"))
            self.assertFalse(store.owns_reference_asset("foreign", "default:user", "video"))
            self.assertFalse(store.owns_reference_asset("own", "default:user", "image"))
            self.assertFalse(store.owns_reference_asset("missing", "default:user", "video"))


if __name__ == "__main__":
    unittest.main()
