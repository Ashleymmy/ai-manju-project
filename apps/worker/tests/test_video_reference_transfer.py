import copy
import hashlib
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from test_video import test_settings
from worker import video_reference_transfer as transfer


class ReferenceTransferTest(unittest.TestCase):
    def test_small_media_unchanged_and_missing_encoder_keeps_original(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "reference"
            source.write_bytes(b"original")
            with patch.object(transfer, "media_info") as probe:
                self.assertEqual(transfer.prepare_reference_transfer(source, "video/mp4", test_settings(tmp)), source)
                probe.assert_not_called()
            with patch.object(transfer, "REFERENCE_COMPACT_MIN_BYTES", 1), patch.object(transfer, "media_info", side_effect=FileNotFoundError):
                self.assertEqual(transfer.prepare_reference_transfer(source, "video/mp4", test_settings(tmp)), source)
            self.assertEqual(source.read_bytes(), b"original")

    def test_changed_duration_dimensions_framerate_or_tracks_rejected(self):
        before = {"format": {"duration": "24.31"}, "streams": [
            {"codec_type": "video", "width": 1280, "height": 720, "r_frame_rate": "30/1"},
            {"codec_type": "audio", "r_frame_rate": "0/0"},
        ]}
        self.assertTrue(transfer.equivalent_media(before, before))
        for field, value in (("width", 640), ("height", 480), ("r_frame_rate", "25/1")):
            after = copy.deepcopy(before)
            after["streams"][0][field] = value
            self.assertFalse(transfer.equivalent_media(before, after))
        after = copy.deepcopy(before)
        after["format"]["duration"] = "23"
        self.assertFalse(transfer.equivalent_media(before, after))
        after = copy.deepcopy(before)
        after["streams"].pop()
        self.assertFalse(transfer.equivalent_media(before, after))

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "requires existing ffmpeg runtime")
    def test_real_reference_smaller_decodable_and_original_intact(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "source.mp4"
            subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24",
                            "-f", "lavfi", "-i", "sine=frequency=440", "-t", "2", "-c:v", "libx264", "-threads", "1",
                            "-preset", "ultrafast", "-crf", "0", "-c:a", "aac", str(source)], check=True, capture_output=True, timeout=20)
            digest = hashlib.sha256(source.read_bytes()).digest()
            with patch.object(transfer, "REFERENCE_COMPACT_MIN_BYTES", 1):
                output = transfer.prepare_reference_transfer(source, "video/mp4", test_settings(tmp))
            self.assertNotEqual(source, output)
            self.assertLess(output.stat().st_size, source.stat().st_size)
            self.assertEqual(hashlib.sha256(source.read_bytes()).digest(), digest)
            data = output.read_bytes()
            self.assertLess(data.find(b"moov"), data.find(b"mdat"))
            subprocess.run(["ffmpeg", "-v", "error", "-i", str(output), "-f", "null", "-"], check=True, capture_output=True, timeout=20)


if __name__ == "__main__":
    unittest.main()
