import type {
  ComicAssetClass,
  ComicAnalysisCandidate,
  ComicAnalysisSession,
  ComicAnalysisRevision,
  ComicAnalysisDetail,
  ComicAssetProject,
  ComicAsset,
  ComicProjectDetail,
  ComicBatchStatus,
  ComicBatchItemStatus,
  ComicPromptPreview,
  ComicPromptOptimizeResult,
  ComicBulkPromptApprovalResult,
  ComicGenerationBatch,
  ComicGenerationItem,
  ComicBatchDetail,
  ComicProjectInput,
  ComicAssetInput,
  ImportComicProjectInput,
  ComicAssetGenerationConfigInput,
} from "./model";
import { API_BASE_URL, getAuthToken, request } from "@/shared/api/http";
import type { WorkspaceScope } from "@/shared/config";

export function listComicProjects(scope: WorkspaceScope = "personal") {
  return request<ComicAssetProject[]>("/api/comic-asset-projects", {
    query: { scope },
  });
}

export function getComicProject(
  projectId: string,
  scope: WorkspaceScope = "personal"
) {
  return request<ComicProjectDetail>(
    `/api/comic-asset-projects/${encodeURIComponent(projectId)}`,
    { query: { scope } }
  );
}

export function createComicProject(
  input: ComicProjectInput,
  scope: WorkspaceScope = "personal"
) {
  return request<ComicProjectDetail>("/api/comic-asset-projects", {
    method: "POST",
    query: { scope },
    body: input,
  });
}

export function importComicProject(
  input: ImportComicProjectInput,
  sourceFile: File,
  scope: WorkspaceScope = "personal"
) {
  const body = new FormData();
  body.set("payload", JSON.stringify(input));
  body.set("source_file", sourceFile, sourceFile.name);
  return request<ComicProjectDetail>("/api/comic-asset-projects/import", {
    method: "POST",
    query: { scope },
    body,
    timeoutMs: 120_000,
  });
}

export function updateComicProject(
  projectId: string,
  input: Partial<ComicProjectInput>,
  scope: WorkspaceScope = "personal"
) {
  return request<ComicProjectDetail>(
    `/api/comic-asset-projects/${encodeURIComponent(projectId)}`,
    { method: "PUT", query: { scope }, body: input }
  );
}

export function deleteComicProject(
  projectId: string,
  scope: WorkspaceScope = "personal"
) {
  return request<Record<string, never>>(
    `/api/comic-asset-projects/${encodeURIComponent(projectId)}`,
    { method: "DELETE", query: { scope } }
  );
}

export async function downloadComicProjectSource(
  projectId: string,
  scope: WorkspaceScope = "personal"
) {
  const token = getAuthToken();
  const response = await fetch(
    `${API_BASE_URL}/api/comic-asset-projects/${encodeURIComponent(projectId)}/source?scope=${encodeURIComponent(scope)}`,
    {
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    }
  );
  if (!response.ok)
    throw new Error(`下载剧本源文件失败（HTTP ${response.status}）`);
  const disposition = response.headers.get("Content-Disposition") || "";
  const fileName = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(disposition)?.[1];
  return {
    blob: await response.blob(),
    fileName: fileName ? decodeURIComponent(fileName) : "",
  };
}

export function createComicAsset(
  projectId: string,
  input: ComicAssetInput,
  scope: WorkspaceScope = "personal"
) {
  return request<ComicAsset>(
    `/api/comic-asset-projects/${encodeURIComponent(projectId)}/assets`,
    { method: "POST", query: { scope }, body: input }
  );
}

export function updateComicAsset(
  projectId: string,
  assetId: string,
  input: ComicAssetInput,
  scope: WorkspaceScope = "personal"
) {
  return request<ComicAsset>(
    `/api/comic-asset-projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`,
    { method: "PUT", query: { scope }, body: input }
  );
}

export function deleteComicAsset(
  projectId: string,
  assetId: string,
  scope: WorkspaceScope = "personal"
) {
  return request<Record<string, never>>(
    `/api/comic-asset-projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`,
    { method: "DELETE", query: { scope } }
  );
}

export function getComicAnalysisSession(
  sessionId: string,
  scope: WorkspaceScope = "personal"
) {
  return request<ComicAnalysisDetail>(
    `/api/comic-asset-analysis-sessions/${encodeURIComponent(sessionId)}`,
    { query: { scope } }
  );
}

export function setActiveComicAnalysisRevision(
  sessionId: string,
  revisionId: string,
  scope: WorkspaceScope = "personal"
) {
  return request<ComicAnalysisDetail>(
    `/api/comic-asset-analysis-sessions/${encodeURIComponent(sessionId)}/active-revision`,
    { method: "PUT", query: { scope }, body: { revision_id: revisionId } }
  );
}

export function createComicAnalysisSession(
  input: {
    title: string;
    style_preset?: string;
    source_text: string;
    instruction: string;
    model: string;
  },
  sourceFile: File,
  scope: WorkspaceScope = "personal"
) {
  const body = new FormData();
  body.set(
    "payload",
    JSON.stringify({ ...input, source_type: "script", default_templates: {} })
  );
  body.set("source_file", sourceFile, sourceFile.name);
  return request<ComicAnalysisDetail>("/api/comic-asset-analysis-sessions", {
    method: "POST",
    query: { scope },
    body,
    timeoutMs: 180_000,
  });
}

export function createComicAnalysisRevision(
  sessionId: string,
  input: {
    instruction: string;
    model: string;
    parent_revision_id: string;
    expected_active_revision_id: string;
  },
  scope: WorkspaceScope = "personal"
) {
  return request<ComicAnalysisDetail>(
    `/api/comic-asset-analysis-sessions/${encodeURIComponent(sessionId)}/revisions`,
    {
      method: "POST",
      query: { scope },
      body: { ...input, source: "ai" },
      timeoutMs: 180_000,
    }
  );
}

export function confirmComicAnalysisSession(
  sessionId: string,
  revisionId: string,
  scope: WorkspaceScope = "personal"
) {
  return request<ComicProjectDetail>(
    `/api/comic-asset-analysis-sessions/${encodeURIComponent(sessionId)}/confirm`,
    {
      method: "POST",
      query: { scope },
      body: { revision_id: revisionId },
      timeoutMs: 60_000,
    }
  );
}

export function previewComicPrompt(
  projectId: string,
  assetId: string,
  scope: WorkspaceScope = "personal"
) {
  return request<ComicPromptPreview>(
    `/api/comic-asset-projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/prompt-preview`,
    {
      method: "POST",
      query: { scope },
    }
  );
}

export function saveComicPrompt(
  projectId: string,
  assetId: string,
  input: {
    content: string;
    source: "source" | "template" | "ai" | "merge" | "manual";
    action: "draft" | "approve";
  },
  scope: WorkspaceScope = "personal"
) {
  return request<ComicAsset>(
    `/api/comic-asset-projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/prompt`,
    {
      method: "PUT",
      query: { scope },
      body: input,
    }
  );
}

export function optimizeComicPrompt(
  projectId: string,
  assetId: string,
  input: {
    direction: string;
    model: string;
    operation?: "optimize" | "merge";
    base_content?: string;
    expected_prompt_version?: number;
  },
  scope: WorkspaceScope = "personal"
) {
  return request<ComicPromptOptimizeResult>(
    `/api/comic-asset-projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/prompt-optimize`,
    {
      method: "POST",
      query: { scope },
      body: input,
      timeoutMs: 120_000,
    }
  );
}

export function bulkApproveComicPrompts(
  projectId: string,
  approvals: Array<{
    asset_id: string;
    expected_prompt_version: number;
  }>,
  scope: WorkspaceScope = "personal"
) {
  return request<{ results: ComicBulkPromptApprovalResult[] }>(
    `/api/comic-asset-projects/${encodeURIComponent(projectId)}/prompts/bulk-approve`,
    {
      method: "POST",
      query: { scope },
      body: { approvals },
    }
  );
}

export function listComicBatches(
  projectId: string,
  scope: WorkspaceScope = "personal"
) {
  return request<ComicGenerationBatch[]>(
    `/api/comic-asset-projects/${encodeURIComponent(projectId)}/generation-batches`,
    { query: { scope } }
  );
}

export function createComicBatch(
  projectId: string,
  input: {
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
  },
  scope: WorkspaceScope = "personal"
) {
  return request<ComicBatchDetail>(
    `/api/comic-asset-projects/${encodeURIComponent(projectId)}/generation-batches`,
    {
      method: "POST",
      query: { scope },
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: input,
      timeoutMs: 60_000,
    }
  );
}

export function getComicBatch(
  batchId: string,
  scope: WorkspaceScope = "personal"
) {
  return request<ComicBatchDetail>(
    `/api/comic-asset-generation-batches/${encodeURIComponent(batchId)}`,
    { query: { scope } }
  );
}

export function controlComicBatch(
  batchId: string,
  action: "pause" | "resume" | "stop",
  scope: WorkspaceScope = "personal"
) {
  return request<ComicBatchDetail>(
    `/api/comic-asset-generation-batches/${encodeURIComponent(batchId)}/${action}`,
    { method: "POST", query: { scope } }
  );
}

export function retryComicBatchItem(
  batchId: string,
  itemId: string,
  scope: WorkspaceScope = "personal"
) {
  return request<ComicBatchDetail>(
    `/api/comic-asset-generation-batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/retry`,
    { method: "POST", query: { scope } }
  );
}

export function retryFailedComicBatchItems(
  batchId: string,
  scope: WorkspaceScope = "personal"
) {
  return request<ComicBatchDetail>(
    `/api/comic-asset-generation-batches/${encodeURIComponent(batchId)}/retry-failed`,
    { method: "POST", query: { scope } }
  );
}
