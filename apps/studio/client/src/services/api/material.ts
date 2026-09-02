import { request } from "./request";

export type SeedanceMaterialResponse = Record<string, unknown>;

export type SeedanceMaterialAsset = {
  id: string;
  name?: string;
  status?: string;
  raw?: SeedanceMaterialResponse;
};

export function createVisualValidateSession(payload: Record<string, unknown>) {
  return request<SeedanceMaterialResponse>("/api/ai/materials/visual-validate-sessions", { method: "POST", body: payload });
}

export function createRealValidateH5(payload: Record<string, unknown>) {
  return request<SeedanceMaterialResponse>("/api/ai/materials/real-validate-h5", { method: "POST", body: payload });
}

export function getVisualValidateResult(bytedToken: string) {
  return request<SeedanceMaterialResponse>("/api/ai/materials/visual-validate-result", { query: { BytedToken: bytedToken } });
}

export function createMaterialGroup(payload: Record<string, unknown>) {
  return request<SeedanceMaterialResponse>("/api/ai/materials/groups", { method: "POST", body: payload });
}

export function getMaterialGroup(id: string) {
  return request<SeedanceMaterialResponse>(`/api/ai/materials/groups/${encodeURIComponent(id)}`);
}

export function deleteMaterialGroup(id: string) {
  return request<SeedanceMaterialResponse>(`/api/ai/materials/groups/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function createMaterialAsset(payload: Record<string, unknown>) {
  return request<SeedanceMaterialResponse>("/api/ai/materials", { method: "POST", body: payload });
}

export function getMaterialAsset(id: string) {
  return request<SeedanceMaterialResponse>(`/api/ai/materials/${encodeURIComponent(id)}`);
}

export function deleteMaterialAsset(id: string) {
  return request<SeedanceMaterialResponse>(`/api/ai/materials/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function ensureMaterialAssetsActive(assetIds: string[]) {
  return request<{ active: boolean }>("/api/ai/materials/ensure-active", { method: "POST", body: { asset_ids: assetIds } });
}

export function materialAssetFromResponse(raw: SeedanceMaterialResponse): SeedanceMaterialAsset | null {
  const id = stringFromNested(raw, ["AssetID", "AssetId", "asset_id", "Id", "id"]);
  if (!id) return null;
  return {
    id,
    name: stringFromNested(raw, ["Name", "name", "AssetName", "asset_name"]),
    status: stringFromNested(raw, ["Status", "status"]),
    raw,
  };
}

export function materialH5Link(raw: SeedanceMaterialResponse) {
  return stringFromNested(raw, ["H5Link", "h5_link", "Link", "link", "Url", "url", "QRCode", "QrCode", "qr_code"]);
}

export function materialBytedToken(raw: SeedanceMaterialResponse) {
  return stringFromNested(raw, ["BytedToken", "byted_token"]);
}

function stringFromNested(value: unknown, keys: string[]): string {
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = stringFromNested(item, keys);
      if (found) return found;
    }
    return "";
  }
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const item = record[key];
    if (typeof item === "string" && item.trim()) return item.trim();
    if (typeof item === "number") return String(item);
  }
  for (const key of ["Result", "result", "Data", "data", "Asset", "asset"]) {
    const found = stringFromNested(record[key], keys);
    if (found) return found;
  }
  return "";
}
