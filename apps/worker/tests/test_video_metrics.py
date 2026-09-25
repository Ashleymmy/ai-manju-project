import json
import hashlib
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from worker.video_metrics import METRIC_MAX_JSON_BYTES, backfill_video_metrics, probe_video_metrics


class VideoMetricsTest(unittest.TestCase):
    @unittest.skipUnless(os.getenv("STUDIO_METRICS_POSTGRES_TEST") == "1", "opt-in PostgreSQL temp-table check")
    def test_postgres_recovery_preserves_finished_job_and_asset_ownership(self):
        import psycopg
        from psycopg.rows import dict_row
        from psycopg.types.json import Jsonb
        from worker.config import load_settings
        with tempfile.TemporaryDirectory() as directory, psycopg.connect(load_settings().database_url, row_factory=dict_row) as connection:
            # Session-local tables shadow all referenced names; no business row is touched.
            connection.execute("CREATE TEMP TABLE jobs(id text PRIMARY KEY,user_id text,workspace_id text,status text,type text,result jsonb,updated_at timestamptz)")
            connection.execute("CREATE TEMP TABLE assets(id text PRIMARY KEY,user_id text,workspace_id text,source_job_id text,type text,content_type text,content_sha256 text)")
            connection.execute("CREATE TEMP TABLE task_consumptions(id text PRIMARY KEY,job_id text,status text,params jsonb)")
            root = Path(directory)
            source = root / "personal" / "user_1" / "asset_1.mp4"
            source.parent.mkdir(parents=True)
            source.write_bytes(b"video")
            digest = hashlib.sha256(b"video").hexdigest()
            connection.execute("INSERT INTO jobs VALUES('job_1','user_1','default:user_1','succeeded','video.generate',%s,NOW())", (Jsonb({"asset_id": "asset_1", "external_task_id": "preserved", "video_content_sha256": digest}),))
            connection.execute("INSERT INTO assets VALUES('asset_1','other_user','default:user_1','job_1','video','video/mp4',%s)", (digest,))
            connection.execute("INSERT INTO task_consumptions VALUES('cons_1','job_1','reserved',%s)", (Jsonb({"billing_mode": "actual_video_duration"}),))
            settings = SimpleNamespace(asset_storage_dir=root, ffmpeg_bin="ffmpeg")
            metrics = {"version": 1, "source": "ffprobe", "duration_seconds": 5, "width": 640, "height": 480}
            with patch("worker.video_metrics.probe_video_metrics", return_value=metrics) as probe:
                self.assertEqual(backfill_video_metrics(connection, settings), "")
                probe.assert_not_called()
                connection.execute("UPDATE assets SET user_id='user_1'")
                self.assertEqual(backfill_video_metrics(connection, settings), "cons_1")
                row = connection.execute("SELECT result,status FROM jobs").fetchone()
                self.assertEqual(row["result"]["video_metrics"], metrics)
                self.assertEqual(row["result"]["external_task_id"], "preserved")
                self.assertEqual(row["status"], "succeeded")
                self.assertEqual(backfill_video_metrics(connection, settings), "")
                self.assertEqual(probe.call_count, 1)

    def test_reads_local_video_stream_duration_not_longer_audio_container(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "output.mp4"
            source.write_bytes(b"media")

            def fake_run(command, **kwargs):
                self.assertIn("file,pipe", command)
                self.assertIn("-format_whitelist", command)
                self.assertEqual(command[-1], str(source.resolve()))
                self.assertLessEqual(kwargs["timeout"], 10)
                kwargs["stdout"].write(json.dumps({"streams": [{"codec_type": "video", "duration": "4.25", "width": 1280, "height": 720}], "format": {"duration": "9"}}).encode())

            with patch("worker.video_metrics.subprocess.run", side_effect=fake_run):
                metrics = probe_video_metrics(source, SimpleNamespace(ffmpeg_bin="ffmpeg"))
            self.assertEqual(metrics, {"version": 1, "source": "ffprobe", "duration_seconds": 4.25, "width": 1280, "height": 720})

    def test_invalid_or_unavailable_metrics_do_not_fail_finished_generation(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "output.mp4"
            source.write_bytes(b"media")
            settings = SimpleNamespace(ffmpeg_bin="ffmpeg")
            invalid = [b"not-json", b"x" * (METRIC_MAX_JSON_BYTES + 1)]
            for duration in ("NaN", "inf", "-1", "0", "99999999"):
                invalid.append(json.dumps({"streams": [{"codec_type": "video", "duration": duration, "width": 1280, "height": 720}]}).encode())
            for raw in invalid:
                with self.subTest(raw=raw[:60]), patch("worker.video_metrics.subprocess.run", side_effect=lambda *args, **kw: kw["stdout"].write(raw)):
                    self.assertIsNone(probe_video_metrics(source, settings))
            for failure in (FileNotFoundError(), subprocess.TimeoutExpired("ffprobe", 10)):
                with patch("worker.video_metrics.subprocess.run", side_effect=failure):
                    self.assertIsNone(probe_video_metrics(source, settings))

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "requires existing ffmpeg runtime")
    def test_real_finished_video_is_measured(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "output.mp4"
            subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=black:s=320x240:r=24", "-t", "1.5", "-c:v", "libx264", "-threads", "1", str(source)], check=True, timeout=15)
            metrics = probe_video_metrics(source, SimpleNamespace(ffmpeg_bin="ffmpeg"))
            self.assertEqual((metrics["width"], metrics["height"]), (320, 240))
            self.assertAlmostEqual(metrics["duration_seconds"], 1.5, places=2)

    def test_backfill_uses_owned_asset_and_preserves_result(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "personal" / "user_1" / "asset_1.mp4"
            source.parent.mkdir(parents=True)
            source.write_bytes(b"video")
            digest = hashlib.sha256(b"video").hexdigest()
            row = {"consumption_id": "cons_1", "job_id": "job_1", "asset_id": "asset_1", "workspace_id": "default:user_1", "content_type": "video/mp4", "content_sha256": digest}
            calls = []

            class Connection:
                def execute(self, sql, args):
                    calls.append((sql, args))
                    return SimpleNamespace(fetchall=lambda: [row])
                def commit(self):
                    pass
                def rollback(self):
                    self.failed = True

            metrics = {"version": 1, "source": "ffprobe", "duration_seconds": 5, "width": 640, "height": 480}
            with patch("worker.video_metrics.probe_video_metrics", return_value=metrics):
                cursor = backfill_video_metrics(Connection(), SimpleNamespace(asset_storage_dir=root, ffmpeg_bin="ffmpeg"))
            self.assertEqual(cursor, "cons_1")
            self.assertIn("a.source_job_id=j.id", calls[0][0])
            self.assertIn("a.user_id=j.user_id", calls[0][0])
            self.assertIn("a.workspace_id=j.workspace_id", calls[0][0])
            self.assertIn("actual_video_duration", calls[0][0])
            self.assertIn("jsonb_set", calls[1][0])
            self.assertEqual(calls[1][1][1:], ("job_1", "asset_1", digest))


if __name__ == "__main__":
    unittest.main()
