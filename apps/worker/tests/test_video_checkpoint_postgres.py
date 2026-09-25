"""Opt-in integration test against an isolated, disposable PostgreSQL instance."""
import os
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from worker.db import JobStore
from worker.errors import VideoRecoveryPendingError
from worker.video_checkpoint import VIDEO_CHECKPOINT_KEY, VideoCheckpoint


TEST_DSN = os.environ.get("WORKER_CHECKPOINT_TEST_DATABASE_URL", "")


class IsolatedStore(JobStore):
    def __init__(self, dsn, schema):
        super().__init__(dsn)
        self.schema = schema

    @contextmanager
    def connect(self):
        with psycopg.connect(self.database_url, row_factory=dict_row) as conn:
            conn.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(self.schema)))
            yield conn


@unittest.skipUnless(TEST_DSN, "requires isolated WORKER_CHECKPOINT_TEST_DATABASE_URL")
class VideoCheckpointPostgresTest(unittest.TestCase):
    def setUp(self):
        self.schema = "checkpoint_test_" + uuid4().hex
        self.store = IsolatedStore(TEST_DSN, self.schema)
        self.provider = {"id": "provider", "model": "video", "base_url": "https://provider.test"}
        with psycopg.connect(TEST_DSN) as conn:
            conn.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(self.schema)))
        with self.store.connect() as conn:
            conn.execute("""CREATE TABLE jobs (
                id text PRIMARY KEY, type text NOT NULL DEFAULT 'video.generate',
                external_provider text, status text NOT NULL DEFAULT 'running',
                bridge_metadata jsonb, queue_phase text, error jsonb, result jsonb,
                progress integer DEFAULT 50, attempts integer DEFAULT 1,
                updated_at timestamptz, finished_at timestamptz, started_at timestamptz
            )""")
            conn.execute("INSERT INTO jobs (id, bridge_metadata) VALUES ('job', %s)", (Jsonb({"other": "keep"}),))

    def tearDown(self):
        # Only the randomly created test schema is ever removed.
        with psycopg.connect(TEST_DSN) as conn:
            conn.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(self.schema)))

    def test_checkpoint_persists_and_recovery_preserves_attempts(self):
        checkpoint = VideoCheckpoint(self.store, "job", self.provider)
        checkpoint.begin()
        checkpoint.accepted("upstream-123")
        restored = VideoCheckpoint(self.store, "job", self.provider)
        self.assertEqual(restored.task_id, "upstream-123")
        self.assertEqual(restored.state["revision"], 2)
        self.store.mark_video_recovery("job")
        with self.store.connect() as conn:
            row = conn.execute("SELECT * FROM jobs WHERE id = 'job'").fetchone()
        self.assertEqual(row["bridge_metadata"]["other"], "keep")
        self.assertEqual(row["bridge_metadata"][VIDEO_CHECKPOINT_KEY]["provider_task_id"], "upstream-123")
        self.assertEqual((row["status"], row["queue_phase"], row["progress"], row["attempts"]),
                         ("queued", "video_recovery_pending", 50, 1))

    def test_metadata_sql_null_and_json_null_both_persist_checkpoint(self):
        for value in (None, Jsonb(None)):
            with self.subTest(value=value):
                with self.store.connect() as conn:
                    conn.execute("UPDATE jobs SET bridge_metadata = %s WHERE id = 'job'", (value,))
                checkpoint = VideoCheckpoint(self.store, "job", self.provider)
                checkpoint.begin()
                self.assertEqual(self.store.get_video_checkpoint("job")["checkpoint"]["phase"], "submission_intent")

    def test_concurrent_post_intents_allow_one_owner(self):
        owners = [VideoCheckpoint(self.store, "job", self.provider) for _ in range(2)]
        barrier = threading.Barrier(2)

        def begin(checkpoint):
            barrier.wait()
            try:
                checkpoint.begin()
                return "submit"
            except VideoRecoveryPendingError:
                return "wait"

        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertCountEqual(pool.map(begin, owners), ["submit", "wait"])
        self.assertEqual(self.store.get_video_checkpoint("job")["checkpoint"]["revision"], 1)

    def test_terminal_and_bridge_jobs_cannot_be_modified(self):
        for status, external in (("canceled", ""), ("succeeded", ""), ("failed", ""), ("running", "sd-video")):
            with self.subTest(status=status, external=external):
                with self.store.connect() as conn:
                    conn.execute("UPDATE jobs SET status = %s, external_provider = %s WHERE id = 'job'", (status, external))
                self.assertIsNone(self.store.save_video_checkpoint("job", {"revision": 1}, 0))
                self.assertIsNone(self.store.mark_video_recovery("job"))

    def test_lifecycle_retries_and_result_import_never_revive_terminal_jobs(self):
        for status in ("canceled", "succeeded", "failed"):
            with self.subTest(status=status):
                with self.store.connect() as conn:
                    conn.execute("UPDATE jobs SET status = %s WHERE id = 'job'", (status,))
                self.assertIsNone(self.store.mark_running("job"))
                self.assertIsNone(self.store.mark_waiting_provider("job"))
                self.assertIsNone(self.store.record_retry("job", {}))
                self.assertIsNone(self.store.set_result("job", {"outputs": []}))
                self.assertIsNone(self.store.set_error("job", {"code": "late_error"}))
                with self.store.connect() as conn:
                    row = conn.execute("SELECT status, attempts FROM jobs WHERE id = 'job'").fetchone()
                self.assertEqual(row, {"status": status, "attempts": 1})


if __name__ == "__main__":
    unittest.main()
