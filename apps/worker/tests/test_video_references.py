import base64
import copy
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from worker import video_references as refs
from worker.errors import SafeTaskError, VideoTaskAcceptedError, VideoSubmissionUncertainError, job_canceled_error
from worker.video import generate_video
from test_video import FakeVideoResponse, test_settings


def inline(kind="image", data=b"reference bytes"):
    return {"type": kind + "_url", kind + "_url": {"url": "data:" + kind + "/test;base64," + base64.b64encode(data).decode()}, "role": "reference_" + kind}


class NativeVideoReferencesTest(unittest.TestCase):
    def setUp(self):
        from video_checkpoint_fakes import isolated_checkpoint
        self.enterContext(patch("worker.video.checkpoint_for_video", side_effect=isolated_checkpoint))

    def test_unconfirmed_remote_task_keeps_its_downloadable_references(self):
        for error_type in (VideoTaskAcceptedError, VideoSubmissionUncertainError):
            with self.subTest(error_type=error_type), tempfile.TemporaryDirectory() as tmp, patch.object(refs.object_storage, "enabled", return_value=True), patch.object(refs.object_storage, "upload") as upload, patch.object(refs.object_storage, "signed_reference_url", return_value="https://media.test/signed"), patch.object(refs.object_storage, "delete") as delete:
                with self.assertRaises(error_type):
                    with refs.native_video_references("job", {"content": [inline()]}, {"_job_workspace_id": "default:user"}, test_settings(tmp)):
                        raise error_type("unconfirmed", retryable=False)
                upload.assert_called_once()
                delete.assert_not_called()

    def test_media_use_short_urls_and_keep_original_bytes_and_roles(self):
        original = {"model": "doubao-seedance-2-5-260628", "content": [
            {"type": "text", "text": "animate"}, inline(), inline("video"), inline("audio"),
            {"type": "image_url", "image_url": {"url": "asset://registered"}, "role": "first_frame"},
            {"type": "image_url", "image_url": {"url": "https://media.test/original"}},
        ]}
        unchanged = copy.deepcopy(original)
        uploaded = {}
        def upload(key, path, content_type):
            uploaded[key] = (path.read_bytes(), content_type)
        with tempfile.TemporaryDirectory() as tmp, patch.object(refs.object_storage, "enabled", return_value=True), patch.object(refs.object_storage, "upload", side_effect=upload), patch.object(refs.object_storage, "signed_reference_url", return_value="https://media.test/signed"), patch.object(refs.object_storage, "delete") as delete:
            with refs.native_video_references("job_test", original, {"_job_workspace_id": "default:user_123"}, test_settings(tmp)) as body:
                self.assertEqual(len(uploaded), 3)
                self.assertTrue(all(key.startswith("jobs/inputs/personal/user_123/native-") for key in uploaded))
                self.assertTrue(all(value[0] == b"reference bytes" for value in uploaded.values()))
                for item in body["content"][1:4]:
                    self.assertEqual(item[item["type"]]["url"], "https://media.test/signed")
                    self.assertEqual(item["role"], "reference_" + item["type"].removesuffix("_url"))
                self.assertEqual(body["content"][4:], original["content"][4:])
                delete.assert_not_called()
            self.assertEqual(delete.call_count, 3)
        self.assertEqual(original, unchanged)

    def test_invalid_data_rejected_before_upload(self):
        invalid = [inline(data=b""), {"type": "image_url", "image_url": {"url": "data:audio/test;base64,YQ=="}}, {"type": "image_url", "image_url": {"url": "data:image/png;base64,!invalid"}}]
        with tempfile.TemporaryDirectory() as tmp, patch.object(refs.object_storage, "enabled", return_value=True), patch.object(refs.object_storage, "upload") as upload:
            for item in invalid:
                with self.subTest(item=item), self.assertRaises(SafeTaskError):
                    with refs.native_video_references("job", {"content": [item]}, {"_job_workspace_id": "default:user"}, test_settings(tmp)):
                        self.fail("invalid media accepted")
            upload.assert_not_called()

    def test_upload_failure_cleans_only_job_reference(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(refs.object_storage, "enabled", return_value=True), patch.object(refs.object_storage, "upload", side_effect=SafeTaskError("storage failure")), patch.object(refs.object_storage, "delete") as delete:
            with self.assertRaises(SafeTaskError):
                with refs.native_video_references("job", {"content": [inline()]}, {"_job_workspace_id": "team:team1"}, test_settings(tmp)):
                    self.fail("failed storage must not reach provider")
            self.assertTrue(delete.call_args.args[0].startswith("jobs/inputs/team/team1/native-"))

    def test_local_storage_retains_inline_compatibility(self):
        body = {"content": [inline()]}
        with tempfile.TemporaryDirectory() as tmp, patch.object(refs.object_storage, "enabled", return_value=False), patch.object(refs.object_storage, "upload") as upload:
            with refs.native_video_references("job", body, {}, test_settings(tmp)) as result:
                self.assertIs(result, body)
            upload.assert_not_called()

    def test_generation_keeps_reference_until_provider_finishes(self):
        payload = {"_job_workspace_id": "default:user", "provider": {
            "base_url": "https://provider.test/api/v3", "api_key": "test", "auth_type": "bearer",
            "model": "doubao-seedance-2-5-260628", "video_protocol": "seedance", "endpoint": "contents/generations/tasks",
            "video_request_body": {"content": [inline()]},
        }}
        with tempfile.TemporaryDirectory() as tmp, patch.object(refs.object_storage, "enabled", return_value=True), patch.object(refs.object_storage, "upload"), patch.object(refs.object_storage, "signed_reference_url", return_value="https://media.test/signed"), patch.object(refs.object_storage, "delete") as delete:
            def create(url, **kwargs):
                self.assertEqual(kwargs["json"]["content"][0]["image_url"]["url"], "https://media.test/signed")
                delete.assert_not_called()
                return FakeVideoResponse({"id": "remote", "status": "queued"})
            def poll(*args):
                delete.assert_not_called()
                return {"id": "remote", "status": "succeeded"}
            def download(*args):
                delete.assert_not_called()
                return {"path": "result.mp4"}
            with patch("worker.video.requests.post", side_effect=create), patch("worker.video.wait_for_video_task", side_effect=poll), patch("worker.video.download_video_result", side_effect=download):
                result = generate_video("job", payload, test_settings(tmp), lambda _: None)
                self.assertEqual(result["provider_task_id"], "remote")
            delete.assert_called_once()
            delete.reset_mock()
            with patch("worker.video.requests.post", side_effect=create), patch("worker.video.wait_for_video_task", side_effect=job_canceled_error()), patch("worker.video.cancel_provider_video_task") as cancel:
                with self.assertRaises(SafeTaskError):
                    generate_video("job", payload, test_settings(tmp), lambda _: None)
                cancel.assert_called_once()
            delete.assert_called_once()


if __name__ == "__main__":
    unittest.main()
