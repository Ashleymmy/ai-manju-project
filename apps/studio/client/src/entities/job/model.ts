export type JobState =
  "queued" | "running" | "succeeded" | "failed" | "canceled";

export type ApiJob = {
  id?: string;
  job_id?: string;
  type?: string;
  name?: string;
  status?: JobState;
  state?: JobState;
  progress?: number;
  scope?: "personal" | "team";
  workspace_id?: string;
  project_id?: string;
  asset_id?: string;
  error?: unknown;
  payload?: unknown;
  result?: unknown;
  queue_phase?: string;
  attempts?: number;
  max_attempts?: number;
  created_at?: string;
  updated_at?: string;
  started_at?: string;
  finished_at?: string;
};

export type Job = Omit<ApiJob, "id" | "status" | "state" | "type"> & {
  id: string;
  type: string;
  status: JobState;
  /** 兼容现有界面的字段名；统一由后端 status 映射。 */
  state: JobState;
};

export type JobListResponse = { items: Job[]; total: number } | Job[];

export type CreateJobInput = {
  type: "image.generate" | "image.edit" | "video.transcode";
  payload?: unknown;
  scope?: "personal" | "team";
};
