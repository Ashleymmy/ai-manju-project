from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, time
from decimal import Decimal
import hashlib
from typing import Any, Iterator
from uuid import UUID

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
import psycopg


JOB_STATUS_QUEUED = "queued"
JOB_STATUS_RUNNING = "running"
JOB_STATUS_SUCCEEDED = "succeeded"
JOB_STATUS_FAILED = "failed"
JOB_STATUS_CANCELED = "canceled"
TERMINAL_STATUSES = {JOB_STATUS_SUCCEEDED, JOB_STATUS_FAILED, JOB_STATUS_CANCELED}


@dataclass
class JobLock:
    acquired: bool
    _conn: Any | None = None
    _job_id: str = ""

    def release(self) -> None:
        if self._conn is None:
            return
        try:
            if self.acquired:
                with self._conn.cursor() as cur:
                    cur.execute("SELECT pg_advisory_unlock(hashtext(%s))", (self._job_id,))
            self._conn.commit()
        finally:
            self._conn.close()
            self._conn = None


class JobStore:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    def is_configured(self) -> bool:
        return bool(self.database_url.strip())

    @contextmanager
    def connect(self) -> Iterator[Any]:
        if not self.is_configured():
            raise RuntimeError("DATABASE_URL or DB_HOST is required")
        with psycopg.connect(self.database_url, row_factory=dict_row) as conn:
            yield conn

    @contextmanager
    def job_lock(self, job_id: str) -> Iterator[JobLock]:
        if not self.is_configured():
            raise RuntimeError("DATABASE_URL or DB_HOST is required")
        conn = psycopg.connect(self.database_url, row_factory=dict_row)
        lock = JobLock(acquired=False, _conn=conn, _job_id=job_id)
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT pg_try_advisory_lock(hashtext(%s)) AS acquired", (job_id,))
                row = cur.fetchone()
                lock.acquired = bool(row and row["acquired"])
            conn.commit()
            yield lock
        finally:
            lock.release()

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM jobs WHERE id = %s", (job_id,))
                return cur.fetchone()

    def count_by_status(self) -> dict[str, int]:
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT status, COUNT(*) AS count FROM jobs GROUP BY status")
                return {str(row["status"]): int(row["count"]) for row in cur.fetchall()}

    def metrics(self) -> dict[str, Any]:
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        COUNT(*) AS total,
                        COUNT(*) FILTER (WHERE status = %s) AS queued,
                        COUNT(*) FILTER (WHERE status = %s) AS running,
                        COUNT(*) FILTER (WHERE status = %s) AS succeeded,
                        COUNT(*) FILTER (WHERE status = %s) AS failed,
                        COUNT(*) FILTER (WHERE status = %s) AS canceled,
                        COALESCE(AVG(EXTRACT(EPOCH FROM (finished_at - created_at))) FILTER (WHERE finished_at IS NOT NULL), 0) AS avg_latency_seconds,
                        COALESCE(AVG(EXTRACT(EPOCH FROM (finished_at - started_at))) FILTER (WHERE finished_at IS NOT NULL AND started_at IS NOT NULL), 0) AS avg_run_seconds
                    FROM jobs
                    """,
                    (
                        JOB_STATUS_QUEUED,
                        JOB_STATUS_RUNNING,
                        JOB_STATUS_SUCCEEDED,
                        JOB_STATUS_FAILED,
                        JOB_STATUS_CANCELED,
                    ),
                )
                row = cur.fetchone() or {}
        queued = int(row.get("queued") or 0)
        running = int(row.get("running") or 0)
        succeeded = int(row.get("succeeded") or 0)
        failed = int(row.get("failed") or 0)
        canceled = int(row.get("canceled") or 0)
        return {
            "total": int(row.get("total") or 0),
            "queued": queued,
            "running": running,
            "succeeded": succeeded,
            "failed": failed,
            "canceled": canceled,
            "completed": succeeded + failed + canceled,
            "backlog": queued + running,
            "avg_latency_seconds": float(row.get("avg_latency_seconds") or 0),
            "avg_run_seconds": float(row.get("avg_run_seconds") or 0),
        }

    def mark_running(self, job_id: str, progress: int = 5) -> dict[str, Any] | None:
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE jobs
                       SET status = %s,
                           queue_phase = '',
                           progress = GREATEST(progress, %s),
                           started_at = COALESCE(started_at, timezone('utc', now())),
                           finished_at = NULL,
                           updated_at = timezone('utc', now())
                     WHERE id = %s
                       AND status NOT IN (%s, %s, %s)
                    RETURNING *
                    """,
                    (JOB_STATUS_RUNNING, clamp_progress(progress), job_id, JOB_STATUS_SUCCEEDED, JOB_STATUS_FAILED, JOB_STATUS_CANCELED),
                )
                return cur.fetchone()

    def mark_waiting_provider(self, job_id: str) -> dict[str, Any] | None:
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE jobs
                       SET status = %s,
                           queue_phase = 'waiting_provider_slot',
                           finished_at = NULL,
                           updated_at = timezone('utc', now())
                     WHERE id = %s
                       AND status <> %s
                    RETURNING *
                    """,
                    (JOB_STATUS_QUEUED, job_id, JOB_STATUS_CANCELED),
                )
                return cur.fetchone()

    def update_progress(self, job_id: str, progress: int) -> dict[str, Any] | None:
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE jobs
                       SET progress = GREATEST(progress, %s),
                           updated_at = timezone('utc', now())
                     WHERE id = %s
                       AND status IN (%s, %s)
                    RETURNING *
                    """,
                    (clamp_progress(progress), job_id, JOB_STATUS_QUEUED, JOB_STATUS_RUNNING),
                )
                return cur.fetchone()

    def record_retry(self, job_id: str, error: dict[str, Any]) -> dict[str, Any] | None:
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE jobs
                       SET status = %s,
                           queue_phase = 'provider_retry_backoff',
                           error = %s,
                           attempts = attempts + 1,
                           updated_at = timezone('utc', now())
                     WHERE id = %s
                       AND status <> %s
                    RETURNING *
                    """,
                    (JOB_STATUS_QUEUED, Jsonb(error), job_id, JOB_STATUS_CANCELED),
                )
                return cur.fetchone()

    def set_result(self, job_id: str, result: dict[str, Any]) -> dict[str, Any] | None:
        result = json_compatible(result)
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE jobs
                       SET status = %s,
                           queue_phase = '',
                           result = %s,
                           progress = 100,
                           updated_at = timezone('utc', now()),
                           finished_at = timezone('utc', now())
                     WHERE id = %s
                       AND status <> %s
                    RETURNING *
                    """,
                    (JOB_STATUS_SUCCEEDED, Jsonb(result), job_id, JOB_STATUS_CANCELED),
                )
                return cur.fetchone()

    def set_error(self, job_id: str, error: dict[str, Any]) -> dict[str, Any] | None:
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE jobs
                       SET status = %s,
                           queue_phase = '',
                           error = %s,
                           attempts = attempts + 1,
                           updated_at = timezone('utc', now()),
                           finished_at = timezone('utc', now())
                     WHERE id = %s
                       AND status <> %s
                    RETURNING *
                    """,
                    (JOB_STATUS_FAILED, Jsonb(error), job_id, JOB_STATUS_CANCELED),
                )
                return cur.fetchone()

    def create_asset(self, asset: dict[str, Any]) -> dict[str, Any] | None:
        with self.connect() as conn:
            with conn.cursor() as cur:
                folder_id = self._asset_folder_id(
                    cur,
                    str(asset.get("workspace_id") or ""),
                    str(asset.get("folder_id") or ""),
                    str(asset.get("user_id") or ""),
                )
                cur.execute(
                    """
                    INSERT INTO assets (
                        id,
                        user_id,
                        workspace_id,
                        type,
                        name,
                        url,
                        size,
                        content_type,
                        folder_id,
                        category,
                        tags,
                        note,
                        source_type,
                        source_project_id,
                        source_batch_id,
                        source_item_id,
                        source_job_id,
                        source_metadata,
                        content_sha256,
                        ingestion_mode,
                        created_at,
                        updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, timezone('utc', now()), timezone('utc', now()))
                    ON CONFLICT (id) DO NOTHING
                    RETURNING *
                    """,
                    (
                        asset["id"],
                        asset["user_id"],
                        asset.get("workspace_id") or "",
                        asset["type"],
                        asset["name"],
                        asset["url"],
                        int(asset.get("size") or 0),
                        asset.get("content_type") or "application/octet-stream",
                        folder_id,
                        asset.get("category") or "other",
                        Jsonb(asset.get("tags") if isinstance(asset.get("tags"), list) else []),
                        asset.get("note") or "",
                        asset.get("source_type") or "unknown",
                        asset.get("source_project_id") or "",
                        asset.get("source_batch_id") or "",
                        asset.get("source_item_id") or "",
                        asset.get("source_job_id") or "",
                        Jsonb(asset.get("source_metadata") if isinstance(asset.get("source_metadata"), dict) else {}),
                        asset.get("content_sha256") or "",
                        asset.get("ingestion_mode") or "automatic",
                    ),
                )
                row = cur.fetchone()
                if not row:
                    cur.execute("SELECT * FROM assets WHERE id = %s", (asset["id"],))
                    row = cur.fetchone()
                self._record_asset_lineage_and_inherit_tags(cur, asset)
                return row

    @staticmethod
    def _record_asset_lineage_and_inherit_tags(cur: Any, asset: dict[str, Any]) -> None:
        workspace_id = str(asset.get("workspace_id") or "")
        child_asset_id = str(asset.get("id") or "")
        parent_asset_ids = [str(item).strip() for item in asset.get("parent_asset_ids", []) if str(item).strip()]
        parent_asset_ids = list(dict.fromkeys(parent_asset_ids))[:20]
        if not parent_asset_ids:
            return
        cur.execute(
            "SELECT id FROM assets WHERE workspace_id = %s AND trashed_at IS NULL AND id = ANY(%s)",
            (workspace_id, parent_asset_ids),
        )
        found_parent_ids = {str(row["id"]) for row in cur.fetchall()}
        if found_parent_ids != set(parent_asset_ids) or child_asset_id in found_parent_ids:
            raise ValueError("asset lineage parents must be active assets in the same workspace")
        relation_type = str(asset.get("relation_type") or "generation").strip().lower()
        if relation_type not in {"generation", "edit", "crop", "annotation", "compress", "import"}:
            relation_type = "generation"
        for ordinal, parent_asset_id in enumerate(parent_asset_ids):
            identity = "\x00".join((workspace_id, parent_asset_id, child_asset_id, relation_type, str(ordinal)))
            lineage_id = "asset_lineage_" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]
            cur.execute(
                """
                INSERT INTO asset_lineages (
                    id, workspace_id, parent_asset_id, child_asset_id, relation_type,
                    source_project_id, source_node_id, source_job_id, input_ordinal, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, timezone('utc', now()), timezone('utc', now()))
                ON CONFLICT DO NOTHING
                """,
                (
                    lineage_id,
                    workspace_id,
                    parent_asset_id,
                    child_asset_id,
                    relation_type,
                    str(asset.get("source_project_id") or ""),
                    str(asset.get("source_node_id") or ""),
                    str(asset.get("source_job_id") or ""),
                    ordinal,
                ),
            )
        cur.execute(
            """
            SELECT DISTINCT b.tag_id, b.asset_id AS source_asset_id
              FROM asset_tag_bindings b
              JOIN tags t ON t.id = b.tag_id
             WHERE b.workspace_id = %s
               AND b.asset_id = ANY(%s)
               AND b.state = 'active'
               AND t.asset_enabled = TRUE
               AND t.status = 'active'
               AND t.inherit_mode = 'auto'
            """,
            (workspace_id, parent_asset_ids),
        )
        for source in cur.fetchall():
            tag_id = str(source["tag_id"])
            source_asset_id = str(source["source_asset_id"])
            cur.execute("SELECT id, state FROM asset_tag_bindings WHERE asset_id = %s AND tag_id = %s", (child_asset_id, tag_id))
            binding = cur.fetchone()
            if binding:
                binding_id = str(binding["id"])
            else:
                binding_identity = "\x00".join((workspace_id, child_asset_id, tag_id))
                binding_id = "asset_tag_" + hashlib.sha256(binding_identity.encode("utf-8")).hexdigest()[:24]
                cur.execute(
                    """
                    INSERT INTO asset_tag_bindings (
                        id, workspace_id, asset_id, tag_id, state, created_by, created_at, updated_at
                    )
                    VALUES (%s, %s, %s, %s, 'active', %s, timezone('utc', now()), timezone('utc', now()))
                    ON CONFLICT DO NOTHING
                    """,
                    (binding_id, workspace_id, child_asset_id, tag_id, str(asset.get("user_id") or "")),
                )
            origin_identity = "\x00".join((binding_id, "inherited", source_asset_id))
            origin_id = "asset_tag_origin_" + hashlib.sha256(origin_identity.encode("utf-8")).hexdigest()[:24]
            cur.execute(
                """
                INSERT INTO asset_tag_origins (
                    id, binding_id, origin_type, source_asset_id, source_job_id, source_node_id, created_at, updated_at
                )
                VALUES (%s, %s, 'inherited', %s, '', '', timezone('utc', now()), timezone('utc', now()))
                ON CONFLICT DO NOTHING
                """,
                (origin_id, binding_id, source_asset_id),
            )
        cur.execute(
            """
            UPDATE assets
               SET tags = COALESCE((
                   SELECT jsonb_agg(names.name ORDER BY names.name)
                     FROM (
                       SELECT DISTINCT t.name
                         FROM asset_tag_bindings b
                         JOIN tags t ON t.id = b.tag_id
                        WHERE b.asset_id = %s AND b.state = 'active' AND t.status = 'active'
                   ) names
               ), '[]'::jsonb),
                   updated_at = timezone('utc', now())
             WHERE id = %s
            """,
            (child_asset_id, child_asset_id),
        )

    @staticmethod
    def _asset_folder_id(cur: Any, workspace_id: str, requested_folder_id: str, created_by: str) -> str:
        if requested_folder_id:
            cur.execute(
                "SELECT id FROM asset_folders WHERE id = %s AND workspace_id = %s AND system_key <> 'system_root'",
                (requested_folder_id, workspace_id),
            )
            row = cur.fetchone()
            if row:
                return str(row["id"])
        cur.execute(
            "SELECT id FROM asset_folders WHERE workspace_id = %s AND system_key = 'unsorted' ORDER BY created_at ASC LIMIT 1",
            (workspace_id,),
        )
        row = cur.fetchone()
        if row:
            return str(row["id"])
        return JobStore._ensure_unsorted_folder(cur, workspace_id, created_by)

    @staticmethod
    def _ensure_unsorted_folder(cur: Any, workspace_id: str, created_by: str) -> str:
        root_identity = f"{workspace_id}|system_root|"
        root_id = deterministic_folder_id(root_identity)
        cur.execute(
            """
            INSERT INTO asset_folders (
                id, workspace_id, created_by, parent_id, name, normalized_name,
                kind, system_key, source_ref_type, source_ref_id, system_identity,
                sort_order, created_at, updated_at
            )
            VALUES (%s, %s, %s, '', '系统归档', '系统归档', 'system', 'system_root', 'workspace', '', %s, 0, timezone('utc', now()), timezone('utc', now()))
            ON CONFLICT DO NOTHING
            """,
            (root_id, workspace_id, created_by, root_identity),
        )
        cur.execute("SELECT id FROM asset_folders WHERE system_identity = %s LIMIT 1", (root_identity,))
        root = cur.fetchone()
        if not root:
            return ""
        unsorted_identity = f"{workspace_id}|unsorted|"
        unsorted_id = deterministic_folder_id(unsorted_identity)
        cur.execute(
            """
            INSERT INTO asset_folders (
                id, workspace_id, created_by, parent_id, name, normalized_name,
                kind, system_key, source_ref_type, source_ref_id, system_identity,
                sort_order, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, '未分类', '未分类', 'system', 'unsorted', 'workspace', '', %s, 10, timezone('utc', now()), timezone('utc', now()))
            ON CONFLICT DO NOTHING
            """,
            (unsorted_id, workspace_id, created_by, str(root["id"]), unsorted_identity),
        )
        cur.execute("SELECT id FROM asset_folders WHERE system_identity = %s LIMIT 1", (unsorted_identity,))
        row = cur.fetchone()
        return str(row["id"]) if row else ""


def clamp_progress(value: int) -> int:
    return max(0, min(100, int(value)))


def json_compatible(value: Any) -> Any:
    """Convert PostgreSQL-native result values before JSONB/Celery serialization."""
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, (Decimal, UUID)):
        return str(value)
    if isinstance(value, dict):
        return {str(key): json_compatible(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [json_compatible(item) for item in value]
    return value


def deterministic_folder_id(identity: str) -> str:
    return "asset_folder_" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]
