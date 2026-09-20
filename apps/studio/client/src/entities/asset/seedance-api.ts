import type {
  SeedanceAssetTag,
  SeedanceAsset,
  SeedanceAssetList,
  SeedanceAssetReadiness,
  SeedanceAssetListParams,
} from "./model";
import { apiUrl, getAuthToken, request } from "@/shared/api/http";
import type { WorkspaceScope } from "@/shared/config";

export function listUserSeedanceAssets(params: SeedanceAssetListParams = {}) {
  return request<SeedanceAssetList>("/api/ai/seedance-assets", { query: params });
}

export function getUserSeedanceAsset(id: string, scope: WorkspaceScope, providerId?: string) {
  return request<SeedanceAsset>(`/api/ai/seedance-assets/${encodeURIComponent(id)}`, {
    query: { scope, provider_id: providerId }, timeoutMs: 120_000,
  });
}

export function uploadUserSeedanceAsset(file: File, scope: WorkspaceScope, providerId?: string) {
  const body = new FormData();
  body.append("file", file);
  body.append("name", file.name);
  body.append("asset_type", file.type.startsWith("video/") ? "Video" : "Image");
  return request<SeedanceAsset>("/api/ai/seedance-assets/upload", {
    method: "POST", body, query: { scope, provider_id: providerId }, timeoutMs: 120_000,
  });
}

// 仅固定的同源素材路径携带鉴权；外部预览地址绝不接收 Studio Token。
export function seedanceAssetPreviewSource(source?: string) {
  return source && (/^https?:\/\//i.test(source) || /^\/api\/sd-video\/volcano\/assets\/[^/?#]+\/content\?scope=(personal|team)$/.test(source)) ? source : "";
}

/** Cards use the existing registered-material JPEG, including video posters.
 * Keep the original preview helper unchanged for generation references/details.
 */
export function seedanceAssetThumbnailSource(source?: string, assetType = "Image") {
  const path = seedanceAssetPreviewSource(source);
  if (path.startsWith("/api/")) return apiUrl(path.replace("/content?", "/thumbnail?"));
  return assetType === "Image" ? path : "";
}

export async function getSeedanceAssetPreviewUrl(source?: string, signal?: AbortSignal) {
  const path = seedanceAssetPreviewSource(source);
  if (!path.startsWith("/api/")) return path;
  const token = getAuthToken();
  const response = await fetch(apiUrl(path), {
    signal, credentials: "include", headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) throw new Error(`读取素材预览失败（${response.status}）`);
  return URL.createObjectURL(await response.blob());
}

export function getSeedanceAssetReadiness() {
  return request<SeedanceAssetReadiness>(
    "/api/admin/seedance-assets/readiness"
  );
}

export function listAdminSeedanceAssets(params: SeedanceAssetListParams = {}) {
  return request<SeedanceAssetList>("/api/admin/seedance-assets", {
    query: params,
  });
}

export function getAdminSeedanceAsset(id: string) {
  return request<SeedanceAsset>(
    `/api/admin/seedance-assets/${encodeURIComponent(id)}`
  );
}

export function listSeedanceAssetMentions(
  params: SeedanceAssetListParams = {}
) {
  return request<SeedanceAssetList>("/api/ai/seedance-assets/mentions", {
    query: params,
  });
}

export function ensureSeedanceAssetsActive(assetIds: string[], scope: WorkspaceScope = "personal", providerId?: string) {
  return request<{ active: boolean }>("/api/ai/seedance-assets/ensure-active", {
    method: "POST",
    body: { asset_ids: assetIds },
    query: { scope, provider_id: providerId },
  });
}

export function seedanceAssetRef(
  asset: Pick<SeedanceAsset, "volcano_asset_id">
) {
  return `asset://${asset.volcano_asset_id}`;
}

export function uploadSeedanceAsset(formData: FormData) {
  return request<SeedanceAsset>("/api/admin/seedance-assets/upload", {
    method: "POST",
    body: formData,
    timeoutMs: 120_000,
  });
}

export function registerSeedanceAssetURL(payload: {
  name?: string;
  description?: string;
  asset_type: string;
  source_url: string;
  tag_ids?: string[];
}) {
  return request<SeedanceAsset>("/api/admin/seedance-assets/register-url", {
    method: "POST",
    body: payload,
    timeoutMs: 120_000,
  });
}

export function updateSeedanceAsset(
  id: string,
  payload: { name?: string; description?: string; tag_ids?: string[] }
) {
  return request<SeedanceAsset>(
    `/api/admin/seedance-assets/${encodeURIComponent(id)}`,
    { method: "PUT", body: payload }
  );
}

export function deleteSeedanceAsset(id: string) {
  return request<Record<string, never>>(
    `/api/admin/seedance-assets/${encodeURIComponent(id)}`,
    { method: "DELETE", timeoutMs: 120_000 }
  );
}

export function syncSeedanceAssets() {
  return request<{ synced: number }>("/api/admin/seedance-assets/sync", {
    method: "POST",
    timeoutMs: 120_000,
  });
}

export function pollSeedanceAssets() {
  return request<{ updated: number }>("/api/admin/seedance-assets/poll", {
    method: "POST",
    timeoutMs: 120_000,
  });
}

export function listSeedanceAssetTags() {
  return request<{ items: SeedanceAssetTag[] }>(
    "/api/admin/seedance-asset-tags"
  );
}

export function upsertSeedanceAssetTag(
  payload: { name: string; color?: string },
  id?: string
) {
  return request<SeedanceAssetTag>(
    id
      ? `/api/admin/seedance-asset-tags/${encodeURIComponent(id)}`
      : "/api/admin/seedance-asset-tags",
    {
      method: id ? "PUT" : "POST",
      body: payload,
    }
  );
}

export function deleteSeedanceAssetTag(id: string) {
  return request<Record<string, never>>(
    `/api/admin/seedance-asset-tags/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
}

export function addSeedanceAssetTag(assetId: string, tagId: string) {
  return request<Record<string, never>>(
    `/api/admin/seedance-assets/${encodeURIComponent(assetId)}/tags/${encodeURIComponent(tagId)}`,
    { method: "POST" }
  );
}

export function removeSeedanceAssetTag(assetId: string, tagId: string) {
  return request<Record<string, never>>(
    `/api/admin/seedance-assets/${encodeURIComponent(assetId)}/tags/${encodeURIComponent(tagId)}`,
    { method: "DELETE" }
  );
}
