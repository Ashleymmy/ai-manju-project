from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from decimal import Decimal
import hashlib
from typing import Any, Iterator
from uuid import UUID

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
import psycopg

from .video_checkpoint import VIDEO_CHECKPOINT_KEY
from .image_checkpoint import IMAGE_CHECKPOINT_KEY
from .errors import recovery_attention_error


JOB_STATUS_QUEUED = "queued"
JOB_STATUS_RUNNING = "running"
JOB_STATUS_SUCCEEDED = "succeeded"
JOB_STATUS_FAILED = "failed"
JOB_STATUS_CANCELED = "canceled"
TERMINAL_STATUSES = {JOB_STATUS_SUCCEEDED, JOB_STATUS_FAILED, JOB_STATUS_CANCELED}
# Diagnostic failures must not hold up a business retry during a DB outage.
MONITORING_DB_TIMEOUT_SECONDS = 2
# Failed recovery is bounded separately from generation attempts and credits.
RECOVERY_MAX_FAILURES = 10
RECOVERY_MAX_AGE_SECONDS = 30 * 60
RECOVERY_ACCESS_FAILURE_LIMIT = 3
RECOVERY_INITIAL_DELAY_SECONDS = 30
RECOVERY_MAX_DELAY_SECONDS = 5 * 60
RECOVERY_ACCESS_CODES = {"video_recovery_http_401", "video_recovery_http_403", "video_recovery_http_404"}


def recovery_transition(checkpoint, kind, *, uncertain=False, reason="", attention=False, now=None):
    """Private counters plus public state, preserving every existing output."""
    now = now or datetime.now(timezone.utc)
    checkpoint = dict(checkpoint) if isinstance(checkpoint, dict) else {}
    recovery = dict(checkpoint.get("recovery") or {})
    attention = attention or recovery.get("requires_attention") is True
    count = int(recovery.get("failures") or 0)
    if not uncertain and not attention:
        count += 1
        try:
            started = datetime.fromisoformat(str(recovery["first_failure_at"]).replace("Z", "+00:00"))
            if started.tzinfo is None:
                started = started.replace(tzinfo=timezone.utc)
        except (KeyError, TypeError, ValueError):
            started = now
        access_failures = int(recovery.get("consecutive_access_failures") or 0) + 1 if reason in RECOVERY_ACCESS_CODES else 0
        attention = count >= RECOVERY_MAX_FAILURES or (now - started).total_seconds() >= RECOVERY_MAX_AGE_SECONDS or access_failures >= RECOVERY_ACCESS_FAILURE_LIMIT
        recovery.update(failures=count, first_failure_at=started.isoformat(), last_failure_at=now.isoformat(),
                        consecutive_access_failures=access_failures, reason=reason if reason in RECOVERY_ACCESS_CODES else "result_recovery_failed")
    if attention:
        recovery["requires_attention"] = True
        error = recovery_attention_error(kind)
        phase, message, retryable = error.code, error.message, False
    else:
        phase = f"{kind}_submission_uncertain" if uncertain else f"{kind}_recovery_pending"
        label = "视频" if kind == "video" else "图片"
        message = f"{label}提交结果待确认，请勿重复提交，请联系管理员核查" if uncertain else f"{label}结果正在恢复处理，请勿重复提交"
        retryable = not uncertain
    if recovery:
        checkpoint["recovery"] = recovery
        checkpoint["revision"] = int(checkpoint.get("revision") or 0) + 1
    delay = min(RECOVERY_MAX_DELAY_SECONDS, RECOVERY_INITIAL_DELAY_SECONDS * (2 ** min(max(count - 1, 0), 4)))
    return checkpoint, {"code": phase, "message": message, "retryable": retryable}, delay


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

    def get_video_checkpoint(self, job_id: str) -> dict[str, Any] | None:
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT status, bridge_metadata -> %s AS checkpoint FROM jobs WHERE id = %s AND type = 'video.generate' AND COALESCE(external_provider, '') = ''", (VIDEO_CHECKPOINT_KEY, job_id))
                return cur.fetchone()

    def save_video_checkpoint(self, job_id: str, checkpoint: dict[str, Any], expected_revision: int) -> dict[str, Any] | None:
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """UPDATE jobs SET bridge_metadata = jsonb_set(
                           CASE WHEN jsonb_typeof(bridge_metadata) = 'object' THEN bridge_metadata ELSE '{}'::jsonb END,
                           ARRAY[%s], %s::jsonb), updated_at = timezone('utc', now())
                       WHERE id = %s AND type = 'video.generate' AND COALESCE(external_provider, '') = ''
                         AND status IN ('queued', 'running')
                         AND COALESCE((bridge_metadata -> %s ->> 'revision')::bigint, 0) = %s
                       RETURNING id, status""",
                    (VIDEO_CHECKPOINT_KEY, Jsonb(json_compatible(checkpoint)), job_id, VIDEO_CHECKPOINT_KEY, expected_revision),
                )
                return cur.fetchone()

    def mark_video_recovery(self, job_id: str, *, uncertain: bool = False, reason: str = "", attention: bool = False, recovered_result=None) -> dict[str, Any] | None:
        # Keep credits reserved and generation attempts unchanged while only
        # polling/downloading/importing an existing paid task.
        return self._mark_media_recovery(job_id, "video", uncertain=uncertain, reason=reason, attention=attention, recovered_result=recovered_result)

    def get_image_checkpoint(self, job_id: str) -> dict[str, Any] | None:
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("""SELECT status, bridge_metadata -> %s AS checkpoint FROM jobs
                    WHERE id = %s AND type IN ('image.generate', 'image.edit') AND COALESCE(external_provider, '') = ''""",
                            (IMAGE_CHECKPOINT_KEY, job_id))
                return cur.fetchone()

    def save_image_checkpoint(self, job_id: str, checkpoint: dict[str, Any], expected_revision: int) -> dict[str, Any] | None:
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("""UPDATE jobs SET bridge_metadata = jsonb_set(
                        CASE WHEN jsonb_typeof(bridge_metadata) = 'object' THEN bridge_metadata ELSE '{}'::jsonb END,
                        ARRAY[%s], %s::jsonb), updated_at = timezone('utc', now())
                    WHERE id = %s AND type IN ('image.generate', 'image.edit') AND COALESCE(external_provider, '') = ''
                      AND status IN ('queued', 'running')
                      AND COALESCE((bridge_metadata -> %s ->> 'revision')::bigint, 0) = %s
                    RETURNING id, status""",
                            (IMAGE_CHECKPOINT_KEY, Jsonb(json_compatible(checkpoint)), job_id, IMAGE_CHECKPOINT_KEY, expected_revision))
                return cur.fetchone()

    def mark_image_recovery(self, job_id: str, *, uncertain: bool = False, reason: str = "", attention: bool = False, recovered_result=None) -> dict[str, Any] | None:
        return self._mark_media_recovery(job_id, "image", uncertain=uncertain, reason=reason, attention=attention, recovered_result=recovered_result)

    def _mark_media_recovery(self, job_id, kind, *, uncertain=False, reason="", attention=False, recovered_result=None):
        key = VIDEO_CHECKPOINT_KEY if kind == "video" else IMAGE_CHECKPOINT_KEY
        types = ["video.generate", "video.transcode"] if kind == "video" else ["image.generate", "image.edit"]
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("""SELECT status, bridge_metadata FROM jobs WHERE id = %s
                    AND type = ANY(%s) AND COALESCE(external_provider, '') = '' FOR UPDATE""", (job_id, types))
                row = cur.fetchone()
                if not row or row["status"] not in {"queued", "running"}:
                    return None
                metadata = dict(row["bridge_metadata"]) if isinstance(row.get("bridge_metadata"), dict) else {}
                checkpoint, error, delay = recovery_transition(metadata.get(key), kind, uncertain=uncertain, reason=reason, attention=attention)
                if recovered_result is not None and not checkpoint.get("result"):
                    # Last-resort preservation for non-provider processing too.
                    # Only local output metadata, never upstream URLs/credentials.
                    checkpoint["result"] = {"outputs": [
                        {field: item[field] for field in ("path", "size", "content_type", "file_name", "asset_id", "width", "height") if field in item}
                        for item in recovered_result.get("outputs", []) if isinstance(item, dict)
                    ]}
                if checkpoint:
                    metadata[key] = checkpoint
                cur.execute("""UPDATE jobs SET status = 'queued', queue_phase = %s, error = %s,
                        bridge_metadata = %s::jsonb,
                        updated_at = timezone('utc', now()), finished_at = NULL
                    WHERE id = %s AND status IN ('queued', 'running')
                    RETURNING id, status, progress, attempts, queue_phase, error""",
                            (error["code"], Jsonb(error), Jsonb(metadata), job_id))
                saved = cur.fetchone()
                if saved is not None:
                    saved["recovery_retry_seconds"] = delay
                return saved

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
                # Keep queue visibility separate from the lifecycle counters.
                # A queued job can be waiting for a provider slot or retry
                # backoff; reporting those phases makes a long "preparing"
                # state actionable without exposing payloads or provider data.
                cur.execute(
                    """
                    SELECT COALESCE(queue_phase, '') AS phase, COUNT(*) AS count
                      FROM jobs
                     WHERE status = %s
                     GROUP BY COALESCE(queue_phase, '')
                     ORDER BY phase
                    """,
                    (JOB_STATUS_QUEUED,),
                )
                queue_phase_counts = {
                    str(item["phase"] or ""): int(item["count"] or 0)
                    for item in cur.fetchall()
                }
                cur.execute(
                    """
                    SELECT
                        COALESCE(MAX(EXTRACT(EPOCH FROM (now() - created_at)))
                            FILTER (WHERE status = %s), 0) AS oldest_queued_seconds,
                        COALESCE(MAX(EXTRACT(EPOCH FROM (now() - created_at)))
                            FILTER (WHERE status = %s), 0) AS oldest_running_seconds,
                        COALESCE(MAX(EXTRACT(EPOCH FROM (now() - created_at)))
                            FILTER (WHERE status = %s AND queue_phase = 'waiting_provider_slot'), 0)
                            AS oldest_waiting_provider_slot_seconds,
                        COUNT(*) FILTER (WHERE status = %s AND queue_phase IN
                            ('image_recovery_attention', 'video_recovery_attention',
                             'image_submission_uncertain', 'video_submission_uncertain'))
                            AS recovery_attention_count
                      FROM jobs
                    """,
                    (JOB_STATUS_QUEUED, JOB_STATUS_RUNNING, JOB_STATUS_QUEUED, JOB_STATUS_QUEUED),
                )
                age_row = cur.fetchone() or {}
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
            "queue_phase_counts": queue_phase_counts,
            "oldest_queued_seconds": max(0.0, float(age_row.get("oldest_queued_seconds") or 0)),
            "oldest_running_seconds": max(0.0, float(age_row.get("oldest_running_seconds") or 0)),
            "oldest_waiting_provider_slot_seconds": max(
                0.0, float(age_row.get("oldest_waiting_provider_slot_seconds") or 0)
            ),
            "recovery_attention_count": int(age_row.get("recovery_attention_count") or 0),
        }

    def mark_running(self, job_id: str, progress: int = 5) -> dict[str, Any] | None:
        # Lifecycle updates only need status; returning inline references on each
        # poll/download chunk can repeatedly transfer tens of MB from PostgreSQL.
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
                    RETURNING id, status, progress, attempts
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
                       AND status IN (%s, %s)
                    RETURNING id, status, progress, attempts
                    """,
                    (JOB_STATUS_QUEUED, job_id, JOB_STATUS_QUEUED, JOB_STATUS_RUNNING),
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
                    RETURNING id, status, progress, attempts
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
                       AND status IN (%s, %s)
                    RETURNING id, status, progress, attempts
                    """,
                    (JOB_STATUS_QUEUED, Jsonb(error), job_id, JOB_STATUS_QUEUED, JOB_STATUS_RUNNING),
                )
                return cur.fetchone()

    def record_monitoring_error(self, event: dict[str, Any]) -> None:
        # Independent insert preserves each attempt even when job.error is replaced.
        with psycopg.connect(self.database_url, connect_timeout=MONITORING_DB_TIMEOUT_SECONDS, row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT set_config('statement_timeout', %s, true)", (str(MONITORING_DB_TIMEOUT_SECONDS * 1000),))
                cur.execute(
                    """INSERT INTO runtime_errors
                       (id,user_id,source,request_id,job_id,project_id,node_id,operation,model,
                        error_code,message,detail,suggestion,attempt,retryable,duration_ms,created_at)
                       VALUES (%(id)s,%(user_id)s,%(source)s,%(request_id)s,%(job_id)s,%(project_id)s,
                        %(node_id)s,%(operation)s,%(model)s,%(error_code)s,%(message)s,%(detail)s,
                        %(suggestion)s,%(attempt)s,%(retryable)s,%(duration_ms)s,%(created_at)s)
                       ON CONFLICT (id) DO NOTHING""", event,
                )

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
                       AND status IN (%s, %s)
                    RETURNING id, status, progress, attempts
                    """,
                    (JOB_STATUS_SUCCEEDED, Jsonb(result), job_id, JOB_STATUS_QUEUED, JOB_STATUS_RUNNING),
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
                       AND status IN (%s, %s)
                    RETURNING id, status, progress, attempts
                    """,
                    (JOB_STATUS_FAILED, Jsonb(error), job_id, JOB_STATUS_QUEUED, JOB_STATUS_RUNNING),
                )
                return cur.fetchone()

    def owns_reference_asset(self, asset_id: str, workspace_id: str, kind: str) -> bool:
        # Refreshing an expired URL grants fresh read access. Trust only the
        # persisted asset and locked Job workspace, never URL/token claims.
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM assets WHERE id=%s AND workspace_id=%s AND type=%s", (asset_id, workspace_id, kind))
                return cur.fetchone() is not None

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
