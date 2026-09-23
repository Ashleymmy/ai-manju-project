import { getAssetContentObjectUrl, getAssetMediaUrl, getAssetFolders, getAssetLibrary, listUserSeedanceAssets } from "@/entities/asset";
import { listCanvasTextAssets } from "@/features/canvas/repositories/textAssetsRepository";
import type { CanvasAssetsMentionsServices } from "./types";

export const browserCanvasAssetsMentionsServices: CanvasAssetsMentionsServices = {
  listUserSeedanceAssets,
  getAssetLibrary,
  getAssetFolders,
  getAssetContentObjectUrl,
  getAssetMediaUrl,
  listCanvasTextAssets,
  createId: () => crypto.randomUUID(),
  confirm: message => window.confirm(message),
  schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
  cancelSchedule: timer => window.clearTimeout(timer),
  revokeObjectURL: url => URL.revokeObjectURL(url),
  warn: (message, error) => console.warn(message, error),
};
