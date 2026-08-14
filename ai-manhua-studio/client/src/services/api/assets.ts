import { request } from "./request";

export type Asset = { id: string; type: "image" | "video" | "audio"; name: string; url?: string; size?: number; content_type?: string; folder_id?: string; category?: string; source_type?: string; created_at?: string };
export type AssetLibraryResponse = { items: Asset[]; total: number } | Asset[];

export function getAssetLibrary(query: Record<string, string | number | boolean | undefined> = {}) { return request<AssetLibraryResponse>("/api/assets/library", { query }); }
export function getAssets() { return request<Asset[]>("/api/assets"); }
export function getAsset(id: string) { return request<Asset>(`/api/assets/${id}`); }
export function uploadAsset(file: File, metadata: Record<string, string> = {}) { const body = new FormData(); body.append("file", file); Object.entries(metadata).forEach(([key, value]) => body.append(key, value)); return request<Asset>("/api/assets", { method: "POST", body }); }
export function updateAssetMetadata(id: string, data: Record<string, unknown>) { return request<Asset>(`/api/assets/${id}/metadata`, { method: "PUT", body: data }); }
export function getAssetLineage(id: string) { return request<unknown>(`/api/assets/${id}/lineage`); }
export function getAssetUserState(id: string) { return request<unknown>(`/api/assets/${id}/user-state`); }
export function updateAssetUserState(id: string, data: Record<string, unknown>) { return request<unknown>(`/api/assets/${id}/user-state`, { method: "PUT", body: data }); }
