import { API_BASE_URL, getAuthToken, request } from "./request";
import type { WorkspaceScope } from "./projects";

export type ComicAssetClass = "character" | "environment" | "prop" | "ui";
export type ComicAnalysisCandidate = {
  code: string;
  class: ComicAssetClass;
  name: string;
  state: string;
  description: string;
  visual_description: string;
  change_request: string;
  source_prompt: string;
  prompt_template: string;
  archive_status: string;
};

export type ComicAnalysisSession = {
  id: string;
  title: string;
  style_preset: string;
  status: "active" | "confirmed";
  active_revision_id: string;
  confirmed_revision_id: string;
  project_id: string;
  source_file_name: string;
};

export type ComicAnalysisRevision = {
  id: string;
  version: number;
  source: "initial" | "ai" | "manual";
  instruction: string;
  requested_model: string;
  response_model: string;
  candidate: { assets: ComicAnalysisCandidate[] };
};

export type ComicAnalysisDetail = { session: ComicAnalysisSession; revisions: ComicAnalysisRevision[] };

export type ComicAssetProject = {
  id: string;
  title: string;
  style_preset: string;
  source_file_name?: string;
  created_at: string;
  updated_at: string;
};

export type ComicAsset = ComicAnalysisCandidate & {
  id: string;
  project_id: string;
  draft_prompt: string;
  approved_prompt: string;
  prompt_status: "draft" | "needs_review" | "approved";
  prompt_warnings?: string[];
  prompt_version: number;
  output_version: number;
  outputs?: Array<{ version: number; asset_id: string; batch_id: string; batch_item_id: string; created_at: string }>;
};

export type ComicProjectDetail = { project: ComicAssetProject; assets: ComicAsset[] };
export type ComicBatchStatus = "queued" | "running" | "paused" | "stopping" | "succeeded" | "partial_failed" | "canceled";
export type ComicBatchItemStatus = "pending" | "queued" | "running" | "succeeded" | "failed" | "canceled";

export type ComicPromptPreview = {
  asset_id: string;
  source_prompt: string;
  draft_prompt: string;
  approved_prompt: string;
  template: string;
  template_source: "asset" | "project" | "system";
  warnings: string[];
  blockers: string[];
};

export type ComicPromptOptimizeResult = {
  asset: ComicAsset;
  requested_model: string;
  response_model: string;
};

export type ComicBulkPromptApprovalResult = {
  asset_id: string;
  ok: boolean;
  asset?: ComicAsset;
  error?: string;
};

export type ComicGenerationBatch = {
  id: string;
  project_id: string;
  status: ComicBatchStatus;
  model_selector: string;
  model: string;
  size: string;
  quality: string;
  concurrency: number;
  total: number;
  pending: number;
  active: number;
  succeeded: number;
  failed: number;
  canceled: number;
  created_at: string;
  updated_at: string;
  finished_at?: string;
};

export type ComicGenerationItem = {
  id: string;
  batch_id: string;
  comic_asset_id: string;
  asset_code: string;
  asset_name: string;
  position: number;
  status: ComicBatchItemStatus;
  prompt_snapshot: string;
  attempt: number;
  job_id: string;
  output_asset_id: string;
  output_version: number;
  error?: { code?: string; message?: string; suggestion?: string };
  updated_at: string;
};

export type ComicBatchDetail = {
  batch: ComicGenerationBatch;
  items: ComicGenerationItem[];
};

export type ComicProjectInput = {
  title: string;
  style_preset?: string;
  default_templates?: Partial<Record<ComicAssetClass, string>>;
};

export type ComicAssetInput = Partial<
  Pick<
    ComicAsset,
    | "code"
    | "class"
    | "name"
    | "state"
    | "description"
    | "visual_description"
    | "change_request"
    | "source_prompt"
    | "prompt_template"
    | "archive_status"
  >
>;

export type ImportComicProjectInput = ComicProjectInput & {
  source_type: "script" | "workbook";
  assets: ComicAssetInput[];
};

export function listComicProjects(scope: WorkspaceScope = "personal") {
  return request<ComicAssetProject[]>("/api/comic-asset-projects", { query: { scope } });
}

export function getComicProject(projectId: string, scope: WorkspaceScope = "personal") {
  return request<ComicProjectDetail>(`/api/comic-asset-projects/${encodeURIComponent(projectId)}`, { query: { scope } });
}

export function createComicProject(input: ComicProjectInput, scope: WorkspaceScope = "personal") {
  return request<ComicProjectDetail>("/api/comic-asset-projects", { method: "POST", query: { scope }, body: input });
}

export function importComicProject(input: ImportComicProjectInput, sourceFile: File, scope: WorkspaceScope = "personal") {
  const body = new FormData();
  body.set("payload", JSON.stringify(input));
  body.set("source_file", sourceFile, sourceFile.name);
  return request<ComicProjectDetail>("/api/comic-asset-projects/import", { method: "POST", query: { scope }, body, timeoutMs: 120_000 });
}

export function updateComicProject(projectId: string, input: Partial<ComicProjectInput>, scope: WorkspaceScope = "personal") {
  return request<ComicProjectDetail>(`/api/comic-asset-projects/${encodeURIComponent(projectId)}`, { method: "PUT", query: { scope }, body: input });
}

export function deleteComicProject(projectId: string, scope: WorkspaceScope = "personal") {
  return request<Record<string, never>>(`/api/comic-asset-projects/${encodeURIComponent(projectId)}`, { method: "DELETE", query: { scope } });
}

export async function downloadComicProjectSource(projectId: string, scope: WorkspaceScope = "personal") {
  const token = getAuthToken();
  const response = await fetch(`${API_BASE_URL}/api/comic-asset-projects/${encodeURIComponent(projectId)}/source?scope=${encodeURIComponent(scope)}`, {
    credentials: "include",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) throw new Error(`下载剧本源文件失败（HTTP ${response.status}）`);
  const disposition = response.headers.get("Content-Disposition") || "";
  const fileName = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(disposition)?.[1];
  return { blob: await response.blob(), fileName: fileName ? decodeURIComponent(fileName) : "" };
}

export function createComicAsset(projectId: string, input: ComicAssetInput, scope: WorkspaceScope = "personal") {
  return request<ComicAsset>(`/api/comic-asset-projects/${encodeURIComponent(projectId)}/assets`, { method: "POST", query: { scope }, body: input });
}

export function updateComicAsset(projectId: string, assetId: string, input: ComicAssetInput, scope: WorkspaceScope = "personal") {
  return request<ComicAsset>(`/api/comic-asset-projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`, { method: "PUT", query: { scope }, body: input });
}

export function deleteComicAsset(projectId: string, assetId: string, scope: WorkspaceScope = "personal") {
  return request<Record<string, never>>(`/api/comic-asset-projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`, { method: "DELETE", query: { scope } });
}

export function getComicAnalysisSession(sessionId: string, scope: WorkspaceScope = "personal") {
  return request<ComicAnalysisDetail>(`/api/comic-asset-analysis-sessions/${encodeURIComponent(sessionId)}`, { query: { scope } });
}

export function setActiveComicAnalysisRevision(sessionId: string, revisionId: string, scope: WorkspaceScope = "personal") {
  return request<ComicAnalysisDetail>(`/api/comic-asset-analysis-sessions/${encodeURIComponent(sessionId)}/active-revision`, { method: "PUT", query: { scope }, body: { revision_id: revisionId } });
}

export function createComicAnalysisSession(input: { title: string; style_preset?: string; source_text: string; instruction: string; model: string }, sourceFile: File, scope: WorkspaceScope = "personal") {
  const body = new FormData();
  body.set("payload", JSON.stringify({ ...input, source_type: "script", default_templates: {} }));
  body.set("source_file", sourceFile, sourceFile.name);
  return request<ComicAnalysisDetail>("/api/comic-asset-analysis-sessions", { method: "POST", query: { scope }, body, timeoutMs: 180_000 });
}

export function createComicAnalysisRevision(sessionId: string, input: { instruction: string; model: string; parent_revision_id: string; expected_active_revision_id: string }, scope: WorkspaceScope = "personal") {
  return request<ComicAnalysisDetail>(`/api/comic-asset-analysis-sessions/${encodeURIComponent(sessionId)}/revisions`, { method: "POST", query: { scope }, body: { ...input, source: "ai" }, timeoutMs: 180_000 });
}

export function confirmComicAnalysisSession(sessionId: string, revisionId: string, scope: WorkspaceScope = "personal") {
  return request<ComicProjectDetail>(`/api/comic-asset-analysis-sessions/${encodeURIComponent(sessionId)}/confirm`, { method: "POST", query: { scope }, body: { revision_id: revisionId }, timeoutMs: 60_000 });
}

export function previewComicPrompt(projectId: string, assetId: string, scope: WorkspaceScope = "personal") {
  return request<ComicPromptPreview>(`/api/comic-asset-projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/prompt-preview`, {
    method: "POST",
    query: { scope },
  });
}

export function saveComicPrompt(projectId: string, assetId: string, input: {
  content: string;
  source: "source" | "template" | "ai" | "merge" | "manual";
  action: "draft" | "approve";
}, scope: WorkspaceScope = "personal") {
  return request<ComicAsset>(`/api/comic-asset-projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/prompt`, {
    method: "PUT",
    query: { scope },
    body: input,
  });
}

export function optimizeComicPrompt(projectId: string, assetId: string, input: {
  direction: string;
  model: string;
  operation?: "optimize" | "merge";
  base_content?: string;
  expected_prompt_version?: number;
}, scope: WorkspaceScope = "personal") {
  return request<ComicPromptOptimizeResult>(`/api/comic-asset-projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/prompt-optimize`, {
    method: "POST",
    query: { scope },
    body: input,
    timeoutMs: 120_000,
  });
}

export function bulkApproveComicPrompts(projectId: string, approvals: Array<{
  asset_id: string;
  expected_prompt_version: number;
}>, scope: WorkspaceScope = "personal") {
  return request<{ results: ComicBulkPromptApprovalResult[] }>(`/api/comic-asset-projects/${encodeURIComponent(projectId)}/prompts/bulk-approve`, {
    method: "POST",
    query: { scope },
    body: { approvals },
  });
}

export function listComicBatches(projectId: string, scope: WorkspaceScope = "personal") {
  return request<ComicGenerationBatch[]>(`/api/comic-asset-projects/${encodeURIComponent(projectId)}/generation-batches`, { query: { scope } });
}

export type ComicAssetGenerationConfigInput = {
  asset_id: string;
  model_selector: string;
  size: string;
  quality: string;
  output_format: string;
  system_prompt: string;
  variants: number;
  reference_asset_ids: string[];
};

export function createComicBatch(projectId: string, input: {
  asset_ids: string[];
  model_selector: string;
  size: string;
  quality?: string;
  output_format?: string;
  system_prompt?: string;
  variants_per_asset?: number;
  reference_asset_ids?: string[];
  asset_configs?: ComicAssetGenerationConfigInput[];
  concurrency: 1 | 2;
  destination_mode?: "auto" | "custom";
  destination_folder_id?: string;
  create_category_subfolders?: boolean;
}, scope: WorkspaceScope = "personal") {
  return request<ComicBatchDetail>(`/api/comic-asset-projects/${encodeURIComponent(projectId)}/generation-batches`, {
    method: "POST",
    query: { scope },
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: input,
    timeoutMs: 60_000,
  });
}

export function getComicBatch(batchId: string, scope: WorkspaceScope = "personal") {
  return request<ComicBatchDetail>(`/api/comic-asset-generation-batches/${encodeURIComponent(batchId)}`, { query: { scope } });
}

export function controlComicBatch(batchId: string, action: "pause" | "resume" | "stop", scope: WorkspaceScope = "personal") {
  return request<ComicBatchDetail>(`/api/comic-asset-generation-batches/${encodeURIComponent(batchId)}/${action}`, { method: "POST", query: { scope } });
}

export function retryComicBatchItem(batchId: string, itemId: string, scope: WorkspaceScope = "personal") {
  return request<ComicBatchDetail>(`/api/comic-asset-generation-batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/retry`, { method: "POST", query: { scope } });
}

export function retryFailedComicBatchItems(batchId: string, scope: WorkspaceScope = "personal") {
  return request<ComicBatchDetail>(`/api/comic-asset-generation-batches/${encodeURIComponent(batchId)}/retry-failed`, { method: "POST", query: { scope } });
}
