import { request } from "./request";
import type { JobState } from "@/lib/api-contract";

export type Job = {
  id: string;
  type: string;
  name?: string;
  state: JobState;
  progress?: number;
  project_id?: string;
  asset_id?: string;
  error?: string;
  params?: unknown;
  result?: unknown;
  created_at?: string;
  updated_at?: string;
};

export type JobListResponse = { items: Job[]; total: number } | Job[];

export function getJobs(query: Record<string, string | number | boolean | undefined> = {}) {
  return request<JobListResponse>("/api/jobs", { query });
}

export function getJob(id: string) {
  return request<Job>(`/api/jobs/${id}`);
}

export function createJob(payload: { type: string; project_id?: string; params?: unknown }) {
  return request<Job>("/api/jobs", { method: "POST", body: payload });
}

export function cancelJob(id: string) {
  return request<void>(`/api/jobs/${id}/cancel`, { method: "POST" });
}

export function retryJob(id: string) {
  return request<Job>(`/api/jobs/${id}/retry`, { method: "POST" });
}
