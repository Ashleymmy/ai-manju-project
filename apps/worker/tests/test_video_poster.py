import hashlib
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from worker.video_poster import create_video_poster


class VideoPosterTest(unittest.TestCase):
    def test_poster_reuses_content_addressed_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            jpeg = b"\xff\xd8preview\xff\xd9"
            with patch("worker.video_poster.subprocess.run", return_value=subprocess.CompletedProcess([], 0, jpeg)) as run:
                self.assertTrue(create_video_poster(root, root / "original.mp4", "asset", "hash"))
                self.assertTrue(create_video_poster(root, root / "original.mp4", "asset", "hash"))
                self.assertEqual(run.call_count, 1)
                name = hashlib.sha256(b"asset/hash").hexdigest() + ".jpg"
                self.assertEqual((root / ".video-posters" / name).read_bytes(), jpeg)
                self.assertTrue(create_video_poster(root, root / "original.mp4", "asset", "new-hash"))
                self.assertEqual(run.call_count, 2)

    def test_preview_failure_does_not_fail_generation(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch("worker.video_poster.subprocess.run", side_effect=subprocess.TimeoutExpired("ffmpeg", 15)):
                self.assertFalse(create_video_poster(Path(directory), Path("video.mp4"), "asset", "hash"))
