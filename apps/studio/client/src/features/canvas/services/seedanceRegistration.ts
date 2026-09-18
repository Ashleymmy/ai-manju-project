import { getUserSeedanceAsset, uploadUserSeedanceAsset, type SeedanceAsset } from "@/entities/asset";
import type { WorkspaceScope } from "@/shared/config";
import type { CanvasNodeMetadata } from "../domain/types";

// SD-video owns its managed model slots; explicit Studio selectors own separate libraries.
export function registrationProviderId(model: string): string | undefined {
  return model.startsWith("sdvideo/") ? undefined : model.includes("::") ? model.split("::")[0] : undefined;
}

const registrationPollAttempts = 15;
const registrationPollIntervalMs = 2_000;

export async function registerCanvasImageAsset(options: {
  scope: WorkspaceScope;
  providerId?: string;
  existing?: NonNullable<CanvasNodeMetadata["seedanceVolcanoAssets"]>[number];
  loadFile: () => Promise<File>;
  onUpdate: (asset: SeedanceAsset) => Promise<void>;
  isCurrent: () => boolean;
}) {
  const { scope, providerId, existing, loadFile, onUpdate, isCurrent } = options;
  const reusable = existing?.id && (existing.providerId || "") === (providerId || "") && existing.status?.toLowerCase() !== "failed";
  let asset = reusable
    ? await getUserSeedanceAsset(existing.id, scope, providerId)
    : await uploadUserSeedanceAsset(await loadFile(), scope, providerId);
  // Persist even a pending record with no upstream ID, so a retry resumes that record.
  await onUpdate(asset);
  for (let attempt = 0; attempt < registrationPollAttempts && isCurrent(); attempt += 1) {
    if (asset.status.toLowerCase() === "failed") throw new Error(asset.error_message || "素材注册失败，请检查官方账号的素材状态");
    if (asset.status.toLowerCase() === "active" && asset.volcano_asset_id) return asset;
    await new Promise((resolve) => window.setTimeout(resolve, registrationPollIntervalMs));
    if (!isCurrent()) return asset;
    asset = await getUserSeedanceAsset(asset.id, scope, providerId);
    await onUpdate(asset);
  }
  if (asset.status.toLowerCase() === "failed") throw new Error(asset.error_message || "素材注册失败，请检查官方账号的素材状态");
  return asset;
}
