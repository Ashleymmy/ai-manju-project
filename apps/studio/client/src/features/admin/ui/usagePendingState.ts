import type { UsageRow } from "../services/adminUsageApi";

// Keep operational codes out of the admin-facing copy. Unknown phases still
// indicate held credits without exposing a raw provider or worker message.
const PENDING_REASON_LABELS: Record<string, string> = {
  waiting_dispatch: "等待任务派发",
  waiting_provider_slot: "等待模型并发空位",
  provider_retry_backoff: "等待自动重试",
  image_recovery_pending: "图片结果待恢复",
  video_recovery_pending: "视频结果待恢复",
  image_submission_uncertain: "图片提交结果待确认",
  video_submission_uncertain: "视频提交结果待确认",
  submission_uncertain: "提交结果待确认",
  video_metrics_pending: "等待成片时长核验与积分结算",
  job_in_progress: "任务处理中",
  reservation_pending: "积分冻结待核对",
};
const SECONDS_PER_MINUTE = 60;

export function formatUsagePendingState(row: Pick<UsageRow, "credit_status" | "pending_reason" | "pending_age_seconds">): string {
  if (row.credit_status !== "reserved" || !row.pending_reason?.trim()) return "";
  const reason = row.pending_reason.trim();
  const label = Object.prototype.hasOwnProperty.call(PENDING_REASON_LABELS, reason)
    ? PENDING_REASON_LABELS[reason]
    : "积分冻结待处理";
  const age = row.pending_age_seconds;
  if (typeof age !== "number" || !Number.isFinite(age) || age <= 0) return label;
  const elapsed = age < SECONDS_PER_MINUTE ? "不足 1 分钟" : `${Math.floor(age / SECONDS_PER_MINUTE)} 分钟`;
  return `${label} · 已冻结 ${elapsed}`;
}
