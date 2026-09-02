import { request } from "./request";

export type SeedanceAssetTag = {
  id: string;
  name: string;
  color?: string;
  scope?: string;
};

export type SeedanceAsset = {
  id: string;
  provider_id?: string;
  provider_protocol?: "tokenspace_material" | "volcano_asset" | string;
  volcano_asset_id: string;
  volcano_group_id?: string;
  name: string;
  description?: string;
  asset_type: "Image" | "Video" | string;
  storage_key?: string;
  source_url?: string;
  content_type?: string;
  size?: number;
  status: string;
  error_message?: string;
  tags?: SeedanceAssetTag[];
  created_at?: string;
  updated_at?: string;
  last_sync_at?: string;
};

export type SeedanceAssetList = {
  items: SeedanceAsset[];
  total: number;
};

export type SeedanceAssetReadiness = {
  provider_configured: boolean;
  provider_id?: string;
  provider_protocol?: "tokenspace_material" | "volcano_asset" | string;
  provider_error?: string;
  material_initialization_url?: string;
  upload_registration_available: boolean;
  public_asset_base_url_configured: boolean;
};

export type SeedanceAssetListParams = {
  status?: string;
  type?: string;
  tag_id?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

export function getSeedanceAssetReadiness() {
  return request<SeedanceAssetReadiness>("/api/admin/seedance-assets/readiness");
}

export function listAdminSeedanceAssets(params: SeedanceAssetListParams = {}) {
  return request<SeedanceAssetList>("/api/admin/seedance-assets", { query: params });
}

export function getAdminSeedanceAsset(id: string) {
  return request<SeedanceAsset>(`/api/admin/seedance-assets/${encodeURIComponent(id)}`);
}

export function listSeedanceAssetMentions(params: SeedanceAssetListParams = {}) {
  return request<SeedanceAssetList>("/api/ai/seedance-assets/mentions", { query: params });
}

export function ensureSeedanceAssetsActive(assetIds: string[]) {
  return request<{ active: boolean }>("/api/ai/seedance-assets/ensure-active", {
    method: "POST",
    body: { asset_ids: assetIds },
  });
}

export function seedanceAssetRef(asset: Pick<SeedanceAsset, "volcano_asset_id">) {
  return `asset://${asset.volcano_asset_id}`;
}

export function uploadSeedanceAsset(formData: FormData) {
  return request<SeedanceAsset>("/api/admin/seedance-assets/upload", { method: "POST", body: formData, timeoutMs: 120_000 });
}

export function registerSeedanceAssetURL(payload: { name?: string; description?: string; asset_type: string; source_url: string; tag_ids?: string[] }) {
  return request<SeedanceAsset>("/api/admin/seedance-assets/register-url", { method: "POST", body: payload, timeoutMs: 120_000 });
}

export function updateSeedanceAsset(id: string, payload: { name?: string; description?: string; tag_ids?: string[] }) {
  return request<SeedanceAsset>(`/api/admin/seedance-assets/${encodeURIComponent(id)}`, { method: "PUT", body: payload });
}

export function deleteSeedanceAsset(id: string) {
  return request<Record<string, never>>(`/api/admin/seedance-assets/${encodeURIComponent(id)}`, { method: "DELETE", timeoutMs: 120_000 });
}

export function syncSeedanceAssets() {
  return request<{ synced: number }>("/api/admin/seedance-assets/sync", { method: "POST", timeoutMs: 120_000 });
}

export function pollSeedanceAssets() {
  return request<{ updated: number }>("/api/admin/seedance-assets/poll", { method: "POST", timeoutMs: 120_000 });
}

export function listSeedanceAssetTags() {
  return request<{ items: SeedanceAssetTag[] }>("/api/admin/seedance-asset-tags");
}

export function upsertSeedanceAssetTag(payload: { name: string; color?: string }, id?: string) {
  return request<SeedanceAssetTag>(id ? `/api/admin/seedance-asset-tags/${encodeURIComponent(id)}` : "/api/admin/seedance-asset-tags", {
    method: id ? "PUT" : "POST",
    body: payload,
  });
}

export function deleteSeedanceAssetTag(id: string) {
  return request<Record<string, never>>(`/api/admin/seedance-asset-tags/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function addSeedanceAssetTag(assetId: string, tagId: string) {
  return request<Record<string, never>>(`/api/admin/seedance-assets/${encodeURIComponent(assetId)}/tags/${encodeURIComponent(tagId)}`, { method: "POST" });
}

export function removeSeedanceAssetTag(assetId: string, tagId: string) {
  return request<Record<string, never>>(`/api/admin/seedance-assets/${encodeURIComponent(assetId)}/tags/${encodeURIComponent(tagId)}`, { method: "DELETE" });
}
