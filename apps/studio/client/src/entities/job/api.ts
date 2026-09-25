import type {
  ApiJob,
  Job,
  JobListResponse,
  CreateJobInput,
  JobState,
} from "./model";
import { request } from "@/shared/api/http";
import { normalizeJobListQuery } from "./queries";

function normalizeJob(raw: ApiJob): Job {
  const status = raw.status ?? raw.state ?? "queued";
  return {
    ...raw,
    id: raw.id || raw.job_id || "",
    type: raw.type || "unknown",
    status,
    state: status,
  };
}

function normalizeJobList(
  raw: ApiJob[] | { items: ApiJob[]; total?: number }
): JobListResponse {
  if (Array.isArray(raw)) return raw.map(normalizeJob);
  const items = (raw.items || []).map(normalizeJob);
  return {
    items,
    total: typeof raw.total === "number" ? raw.total : items.length,
  };
}

export async function getJobs(
  query: Record<string, string | number | boolean | undefined> = {}
) {
  const normalizedQuery = normalizeJobListQuery(query);
  const raw = await request<ApiJob[] | { items: ApiJob[]; total?: number }>(
    "/api/jobs",
    { query: { view: "status", ...normalizedQuery } }
  );
  return normalizeJobList(raw);
}

export async function getJob(id: string, signal?: AbortSignal) {
  return normalizeJob(
    await request<ApiJob>(`/api/jobs/${encodeURIComponent(id)}`, { signal, query: { view: "status" } })
  );
}

export async function createJob(payload: CreateJobInput) {
  return normalizeJob(
    await request<ApiJob>("/api/jobs", { method: "POST", body: payload, query: { view: "status" } })
  );
}

export async function cancelJob(id: string, scope?: "personal" | "team") {
  return normalizeJob(
    await request<ApiJob>(`/api/jobs/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      query: { scope, view: "status" },
    })
  );
}

export function isTerminalJob(job: Pick<Job, "status">) {
  return (
    job.status === "succeeded" ||
    job.status === "failed" ||
    job.status === "canceled"
  );
}

/** Recovery retains the original task ID; these notices must not enable resubmit. */
export function jobProgressNotice(job: Pick<Job, "status" | "queue_phase">): string | undefined {
  if (isTerminalJob(job)) return undefined;
  if (job.queue_phase === "waiting_dispatch") return "任务已保存，正在等待调度，无需重复生成";
  if (job.queue_phase === "video_submission_uncertain") return "提交结果待确认，请联系管理员，勿重复生成";
  if (job.queue_phase === "video_recovery_pending") return "正在恢复原视频任务，无需重新生成";
  return undefined;
}

export function jobErrorMessage(
  job: Pick<Job, "error">,
  fallback = "任务执行失败"
) {
  if (typeof job.error === "string" && job.error.trim()) return job.error;
  if (job.error && typeof job.error === "object") {
    const error = job.error as Record<string, unknown>;
    const message = error.message || error.error || error.detail || error.code;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}
