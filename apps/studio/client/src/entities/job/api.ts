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
    { query: normalizedQuery }
  );
  return normalizeJobList(raw);
}

export async function getJob(id: string) {
  return normalizeJob(
    await request<ApiJob>(`/api/jobs/${encodeURIComponent(id)}`)
  );
}

export async function createJob(payload: CreateJobInput) {
  return normalizeJob(
    await request<ApiJob>("/api/jobs", { method: "POST", body: payload })
  );
}

export async function cancelJob(id: string, scope?: "personal" | "team") {
  return normalizeJob(
    await request<ApiJob>(`/api/jobs/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      query: { scope },
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
