import type {
  AssetCategory,
  AssetSourceType,
  AssetUserState,
  Asset,
  AssetFolder,
  AssetLibraryQuery,
  AssetLibraryResponse,
  AssetTrashPreflight,
  AssetExportStatus,
  AssetExportBatch,
  AssetExportFilter,
  AssetUsageEvent,
  AssetLineageEntry,
  AssetLineageView,
} from "./model";
import { API_BASE_URL, getAuthToken, request } from "@/shared/api/http";
import type { WorkspaceScope } from "@/shared/config";

function scopedQuery(
  scope: WorkspaceScope,
  query: Record<string, string | number | boolean | undefined> = {}
) {
  return { scope, ...query };
}

export function getAssetLibrary(
  scope: WorkspaceScope = "personal",
  query: AssetLibraryQuery = {},
  signal?: AbortSignal
) {
  return request<AssetLibraryResponse>("/api/assets/library", {
    signal,
    query: scopedQuery(scope, {
      folder_id: query.folderId,
      include_descendants: query.includeDescendants || undefined,
      smart_view: query.smartView || undefined,
      type: query.type || undefined,
      category: query.category || undefined,
      source_type: query.sourceType || undefined,
      keyword: query.keyword || undefined,
      tag_ids: query.tagIds?.length ? query.tagIds.join(",") : undefined,
      tag_match: query.tagMatch,
      include_tag_descendants: query.includeTagDescendants || undefined,
      created_from: query.createdFrom || undefined,
      created_to: query.createdTo || undefined,
      source_project_id: query.sourceProjectId || undefined,
      page: query.page,
      page_size: query.pageSize,
      sort: query.sort,
    }),
  });
}

export function getTrashedAssetLibrary(
  scope: WorkspaceScope = "personal",
  query: AssetLibraryQuery = {},
  signal?: AbortSignal
) {
  return request<AssetLibraryResponse>("/api/assets/trash/library", {
    signal,
    query: scopedQuery(scope, {
      keyword: query.keyword || undefined,
      page: query.page,
      page_size: query.pageSize,
      sort: query.sort,
    }),
  });
}

export function getAssets(scope: WorkspaceScope = "personal") {
  return request<Asset[]>("/api/assets", { query: { scope } });
}

export function getAsset(id: string, scope: WorkspaceScope = "personal") {
  return request<Asset>(`/api/assets/${encodeURIComponent(id)}`, {
    query: { scope },
  });
}

export function listTagAssets(
  scope: WorkspaceScope,
  tagId: string,
  page = 1,
  pageSize = 24,
  signal?: AbortSignal
) {
  return request<{ items: Asset[]; total: number }>(
    `/api/tags/${encodeURIComponent(tagId)}/assets`,
    {
      signal,
      query: {
        scope,
        include_descendants: true,
        page,
        page_size: pageSize,
      },
    }
  );
}

export function getAssetFolders(scope: WorkspaceScope = "personal") {
  return request<AssetFolder[]>("/api/asset-folders", { query: { scope } });
}

export function createAssetFolder(
  input: { name: string; parent_id?: string; sort_order?: number },
  scope: WorkspaceScope = "personal"
) {
  return request<AssetFolder>("/api/asset-folders", {
    method: "POST",
    query: { scope },
    body: input,
  });
}

export function updateAssetFolder(
  id: string,
  input: { name: string; parent_id?: string; sort_order?: number },
  scope: WorkspaceScope = "personal"
) {
  return request<AssetFolder>(`/api/asset-folders/${encodeURIComponent(id)}`, {
    method: "PUT",
    query: { scope },
    body: input,
  });
}

export function deleteAssetFolder(
  id: string,
  scope: WorkspaceScope = "personal"
) {
  return request<{ moved_assets: number }>(
    `/api/asset-folders/${encodeURIComponent(id)}`,
    { method: "DELETE", query: { scope } }
  );
}

export function uploadAsset(
  file: File,
  metadata: Record<string, string> = {},
  scope: WorkspaceScope = "personal",
  signal?: AbortSignal
) {
  const body = new FormData();
  body.append("file", file);
  Object.entries(metadata).forEach(([key, value]) => body.append(key, value));
  return request<Asset>("/api/assets", {
    method: "POST",
    query: { scope },
    body,
    timeoutMs: 120_000,
    signal,
  });
}

export function updateAssetMetadata(
  id: string,
  data: Record<string, unknown>,
  scope: WorkspaceScope = "personal"
) {
  return request<Asset>(`/api/assets/${encodeURIComponent(id)}/metadata`, {
    method: "PUT",
    query: { scope },
    body: data,
  });
}

export function getAssetLineage(
  id: string,
  scope: WorkspaceScope = "personal"
) {
  return request<AssetLineageView>(
    `/api/assets/${encodeURIComponent(id)}/lineage`,
    { query: { scope } }
  );
}

export function getAssetUserState(
  id: string,
  scope: WorkspaceScope = "personal"
) {
  return request<AssetUserState>(
    `/api/assets/${encodeURIComponent(id)}/user-state`,
    { query: { scope } }
  );
}

export function updateAssetUserState(
  id: string,
  data: Partial<AssetUserState>,
  scope: WorkspaceScope = "personal"
) {
  return request<AssetUserState>(
    `/api/assets/${encodeURIComponent(id)}/user-state`,
    { method: "PUT", query: { scope }, body: data }
  );
}

export function getAssetUsageEvents(
  id: string,
  scope: WorkspaceScope = "personal"
) {
  return request<{ items: AssetUsageEvent[]; total?: number }>(
    `/api/assets/${encodeURIComponent(id)}/usage-events`,
    { query: { scope } }
  );
}

export function bindAssetTags(
  id: string,
  tagIds: string[],
  scope: WorkspaceScope = "personal"
) {
  return request<unknown>(`/api/assets/${encodeURIComponent(id)}/tags`, {
    method: "POST",
    query: { scope },
    body: { tag_ids: tagIds },
  });
}

export function removeAssetTag(
  id: string,
  tagId: string,
  scope: WorkspaceScope = "personal"
) {
  return request<void>(
    `/api/assets/${encodeURIComponent(id)}/tags/${encodeURIComponent(tagId)}`,
    { method: "DELETE", query: { scope } }
  );
}

export function resyncAssetInheritedTags(
  id: string,
  scope: WorkspaceScope = "personal"
) {
  return request<unknown>(
    `/api/assets/${encodeURIComponent(id)}/tags/resync-inherited`,
    { method: "POST", query: { scope } }
  );
}

export function bulkMoveAssets(
  assetIds: string[],
  folderId: string,
  scope: WorkspaceScope = "personal"
) {
  return request<{ moved: number }>("/api/assets/bulk-move", {
    method: "POST",
    query: { scope },
    body: { asset_ids: assetIds, folder_id: folderId },
  });
}

export function preflightAssetTrash(
  assetIds: string[],
  scope: WorkspaceScope = "personal"
) {
  return request<AssetTrashPreflight>("/api/assets/trash-preflight", {
    method: "POST",
    query: { scope },
    body: { asset_ids: assetIds },
  });
}

export function trashAssets(
  assetIds: string[],
  scope: WorkspaceScope = "personal"
) {
  return request<{ items: Asset[]; count: number }>("/api/assets/bulk-trash", {
    method: "POST",
    query: { scope },
    body: { asset_ids: assetIds },
  });
}

export function restoreAssets(
  assetIds: string[],
  scope: WorkspaceScope = "personal"
) {
  return request<Asset[]>("/api/assets/bulk-restore", {
    method: "POST",
    query: { scope },
    body: { asset_ids: assetIds },
  });
}

export function permanentDeleteAsset(
  assetId: string,
  scope: WorkspaceScope = "personal"
) {
  return request<{ deleted: boolean; id: string }>(
    `/api/assets/${encodeURIComponent(assetId)}/permanent`,
    { method: "DELETE", query: { scope } }
  );
}

export function emptyAssetTrash(scope: WorkspaceScope = "personal") {
  return request<{ deleted: number; failed?: number }>("/api/assets/trash", {
    method: "DELETE",
    query: { scope },
  });
}

export function bulkUpdateAssetTags(
  assetIds: string[],
  tagIds: string[],
  action: "add" | "remove" = "add",
  scope: WorkspaceScope = "personal"
) {
  return request<{ count: number }>("/api/assets/bulk-tags", {
    method: "POST",
    query: { scope },
    body: { asset_ids: assetIds, tag_ids: tagIds, action },
  });
}

export function createAssetExport(
  input: {
    selection_mode: "selected" | "filter" | "folder";
    asset_ids?: string[];
    folder_id?: string;
    filter?: AssetExportFilter;
    canvas_fragment?: Record<string, unknown>;
  },
  scope: WorkspaceScope = "personal"
) {
  return request<AssetExportBatch>("/api/asset-exports", {
    method: "POST",
    query: { scope },
    body: input,
  });
}

export function listAssetExports(scope: WorkspaceScope = "personal") {
  return request<AssetExportBatch[]>("/api/asset-exports", {
    query: { scope },
  });
}

export function getAssetExport(
  exportId: string,
  scope: WorkspaceScope = "personal"
) {
  return request<AssetExportBatch>(
    `/api/asset-exports/${encodeURIComponent(exportId)}`,
    { query: { scope } }
  );
}

export function cancelAssetExport(
  exportId: string,
  scope: WorkspaceScope = "personal"
) {
  return request<AssetExportBatch>(
    `/api/asset-exports/${encodeURIComponent(exportId)}/cancel`,
    { method: "POST", query: { scope } }
  );
}

export async function downloadAssetExport(
  exportId: string,
  scope: WorkspaceScope = "personal"
) {
  const url = new URL(
    `${API_BASE_URL}/api/asset-exports/${encodeURIComponent(exportId)}/content`
  );
  url.searchParams.set("scope", scope);
  const token = getAuthToken();
  const response = await fetch(url, {
    credentials: "include",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(
      payload?.error || `asset export download failed (${response.status})`
    );
  }
  return response.blob();
}

export async function getAssetContentObjectUrl(
  id: string,
  scope: WorkspaceScope = "personal",
  thumbnail?: 320 | 640,
  signal?: AbortSignal
) {
  const url = new URL(
    `${API_BASE_URL}/api/assets/${encodeURIComponent(id)}/content`
  );
  url.searchParams.set("scope", scope);
  if (thumbnail) url.searchParams.set("thumbnail", String(thumbnail));
  const token = getAuthToken();
  const response = await fetch(url, {
    credentials: "include",
    signal,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) throw new Error(`读取资产内容失败（${response.status}）`);
  return URL.createObjectURL(await response.blob());
}
