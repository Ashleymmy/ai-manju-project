import { getUserSeedanceAsset, uploadUserSeedanceAsset, type SeedanceAsset } from "@/entities/asset";
import type { WorkspaceScope } from "@/shared/config";
import type { CanvasNodeData, CanvasNodeMetadata } from "../domain/types";

export type SeedanceRegistrationState = {
  phase: "queued" | "uploading" | "processing" | "pending" | "success" | "error";
  error?: string;
};

// SD-video owns its managed model slots; explicit Studio selectors own separate libraries.
export function registrationProviderId(model: string): string | undefined {
  return model.startsWith("sdvideo/") ? undefined : model.includes("::") ? model.split("::")[0] : undefined;
}

// Background polling tolerates slow provider processing without holding the UI.
// Bound it to five minutes; longer registrations can still be refreshed by ID.
const registrationPollAttempts = 60;
const registrationPollIntervalMs = 5_000;

// A registration is bound to the exact image pixels, so moving a node keeps it while replacing the image resets it.
export function seedanceRegistrationSource(node: CanvasNodeData) {
  return JSON.stringify([node.imageAssetId || node.metadata?.assetId || "", node.imageSrc || node.metadata?.content || "", node.metadata?.assetScope || ""]);
}

export function seedanceRegistrationKey(projectKey: string | null | undefined, node: CanvasNodeData) {
  return JSON.stringify([projectKey, node.id, seedanceRegistrationSource(node)]);
}

export function seedanceRegistrationPhase(asset: Pick<SeedanceAsset, "status" | "volcano_asset_id">) {
  const status = asset.status.toLowerCase();
  if (["failed", "error", "rejected"].includes(status)) return "error";
  return status === "active" && asset.volcano_asset_id.trim() ? "success" : "pending";
}

export function savedSeedanceRegistration(node: CanvasNodeData): SeedanceAsset | undefined {
  if (node.metadata?.seedanceRegistrationSource && node.metadata.seedanceRegistrationSource !== seedanceRegistrationSource(node)) return undefined;
  const asset = node.metadata?.seedanceVolcanoAssets?.[0];
  if (!asset) return undefined;
  return {
    id: asset.id, name: asset.name || node.title, asset_type: asset.assetType || "Image",
    volcano_asset_id: asset.volcanoAssetId, status: asset.status || "Processing",
  };
}

export async function registerCanvasImageAsset(options: {
  scope: WorkspaceScope;
  providerId?: string;
  existing?: NonNullable<CanvasNodeMetadata["seedanceVolcanoAssets"]>[number];
  loadFile: () => Promise<File>;
  onUpdate: (asset: SeedanceAsset) => Promise<void>;
  onState?: (state: SeedanceRegistrationState) => void;
  isCurrent: () => boolean;
}) {
  const { scope, providerId, existing, loadFile, onUpdate, onState, isCurrent } = options;
  const reusable = existing?.id && (existing.providerId || "") === (providerId || "")
    && seedanceRegistrationPhase({ status: existing.status || "Processing", volcano_asset_id: existing.volcanoAssetId }) !== "error";
  onState?.({ phase: reusable ? "processing" : "uploading" });
  let asset = reusable
    ? await getUserSeedanceAsset(existing.id, scope, providerId)
    : await uploadUserSeedanceAsset(await loadFile(), scope, providerId);
  // Persist even a pending record with no upstream ID, so a retry resumes that record.
  await onUpdate(asset);
  onState?.({ phase: "processing" });
  for (let attempt = 0; attempt < registrationPollAttempts && isCurrent(); attempt += 1) {
    if (seedanceRegistrationPhase(asset) === "error") throw new Error(asset.error_message || "素材注册失败，请检查官方账号的素材状态");
    if (seedanceRegistrationPhase(asset) === "success") return asset;
    await new Promise((resolve) => window.setTimeout(resolve, registrationPollIntervalMs));
    if (!isCurrent()) return asset;
    asset = await getUserSeedanceAsset(asset.id, scope, providerId);
    await onUpdate(asset);
  }
  if (seedanceRegistrationPhase(asset) === "error") throw new Error(asset.error_message || "素材注册失败，请检查官方账号的素材状态");
  return asset;
}
