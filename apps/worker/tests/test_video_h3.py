import base64
import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from test_video import FakeVideoResponse, test_settings
from worker.errors import SafeTaskError
from worker.video import generate_video
from worker.video_h3 import h3_request_body, is_h3_reference_model


MODEL = "zzdh-minimax-h3-限时优惠-多参考图生-768p"


class H3VideoTest(unittest.TestCase):
    def staged_payload(self, root, count=1):
        files = []
        for index in range(count):
            content = b"\x89PNG\r\n" + bytes([index])
            key = f"jobs/inputs/personal/user_123/batch/ref{index}.png"
            path = Path(root) / key
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
            files.append({"field_name": "input_reference[]", "filename": f"ref{index}.png",
                          "content_type": "image/png", "storage_key": key,
                          "size": len(content), "sha256": hashlib.sha256(content).hexdigest()})
        return {"_job_workspace_id": "default:user_123", "files": files,
                "seconds": "5", "size": "1280x720", "resolution_name": "720p",
                "prompt": "camera moves", "provider": {
                    "base_url": "https://www.zizidonghua.com/v1", "endpoint": "videos",
                    "endpoint_overrides": {"video_get": "videos/{id}"},
                    "auth_type": "bearer", "api_key": "test-key", "model": MODEL}}

    def test_json_images_v8_poll_and_v1_download_for_both_resolutions(self):
        for resolution in ("480p", "768p"):
            for nested in (False, True):
                with self.subTest(resolution=resolution, nested=nested), tempfile.TemporaryDirectory() as tmp:
                    payload = self.staged_payload(tmp, 9)
                    payload["provider"]["model"] = MODEL.replace("768p", resolution)
                    task = {"task_id": "task_h3", "status": "SUCCESS", "progress": "100%"}
                    completed = {"code": "success", "data": task} if nested else task
                    with patch("worker.video.requests.post", return_value=FakeVideoResponse({"task_id": "task_h3", "status": "queued"})) as post, \
                         patch("worker.video.requests.get", side_effect=[FakeVideoResponse(completed), FakeVideoResponse(content=b"video", content_type="video/mp4")]) as get, \
                         patch("worker.video.time.sleep"):
                        result = generate_video("job_h3", payload, test_settings(tmp), lambda _: None)
                    self.assertEqual(post.call_args.args[0], "https://www.zizidonghua.com/v8/videos/generations")
                    body = post.call_args.kwargs["json"]
                    self.assertEqual(set(body), {"model", "prompt", "duration", "aspect_ratio", "mode", "reference_images"})
                    self.assertEqual(body["duration"], 5)
                    self.assertEqual(body["aspect_ratio"], "horizontal")
                    self.assertEqual(len(body["reference_images"]), 9)
                    for index, image in enumerate(body["reference_images"]):
                        self.assertEqual(image["role"], "reference_image")
                        self.assertEqual(base64.b64decode(image["base64"]), b"\x89PNG\r\n" + bytes([index]))
                    self.assertNotIn("files", post.call_args.kwargs)
                    self.assertEqual([call.args[0] for call in get.call_args_list], [
                        "https://www.zizidonghua.com/v8/videos/generations/task_h3",
                        "https://www.zizidonghua.com/v1/videos/task_h3/content"])
                    self.assertEqual(Path(result["outputs"][0]["path"]).read_bytes(), b"video")
                    self.assertEqual(payload["provider"]["endpoint"], "videos")

    def test_invalid_parameters_never_submit(self):
        for change in ({"files": []}, {"seconds": "16"}, {"seconds": "0"}, {"seconds": "1.5"}, {"size": "1024x1024"}, {"size": "auto"}):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as tmp:
                payload = {**self.staged_payload(tmp), **change}
                with patch("worker.video.requests.post") as post, self.assertRaises(SafeTaskError):
                    generate_video("job_h3", payload, test_settings(tmp), lambda _: None)
                post.assert_not_called()

    def test_bad_reference_count_type_and_workspace_never_submit(self):
        for kind in ("too_many", "audio", "workspace", "checksum"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as tmp:
                payload = self.staged_payload(tmp, 10 if kind == "too_many" else 1)
                if kind == "audio": payload["files"][0]["content_type"] = "audio/mpeg"
                if kind == "workspace": payload["_job_workspace_id"] = "default:other"
                if kind == "checksum": payload["files"][0]["sha256"] = "0" * 64
                with patch("worker.video.requests.post") as post, self.assertRaises(SafeTaskError):
                    generate_video("job_h3", payload, test_settings(tmp), lambda _: None)
                post.assert_not_called()

    def test_vertical_and_duration_boundaries(self):
        with tempfile.TemporaryDirectory() as tmp:
            for seconds in (1, 15):
                payload = {**self.staged_payload(tmp), "seconds": str(seconds), "size": "720x1280"}
                body = h3_request_body(payload, payload["provider"], test_settings(tmp))
                self.assertEqual(body["duration"], seconds)
                self.assertEqual(body["aspect_ratio"], "vertical")

    def test_failure_envelope_is_terminal(self):
        with tempfile.TemporaryDirectory() as tmp:
            payload = self.staged_payload(tmp)
            with patch("worker.video.requests.post", return_value=FakeVideoResponse({"id": "h3", "status": "queued"})), \
                 patch("worker.video.requests.get", return_value=FakeVideoResponse({"code": "success", "data": {"status": "FAILURE", "message": "rejected"}})) as get, \
                 patch("worker.video.time.sleep"), self.assertRaises(SafeTaskError) as raised:
                generate_video("job_h3", payload, test_settings(tmp), lambda _: None)
            self.assertEqual(raised.exception.code, "provider_video_failed")
            self.assertEqual(get.call_count, 1)

    def test_detection_does_not_change_other_models(self):
        for name in ("MiniMax-H3-MAX", "sora", "seedance-2.5", "zzdh-Minimax-h3-720p", MODEL + "-other"):
            self.assertFalse(is_h3_reference_model(name))


if __name__ == "__main__":
    unittest.main()
