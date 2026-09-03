import { getAssetContentObjectUrl, getAssetLibrary } from "@/entities/asset";
import { listCanvasTextAssets } from "@/features/canvas/repositories/textAssetsRepository";
import type { CanvasAssetsMentionsServices } from "./types";

export const browserCanvasAssetsMentionsServices: CanvasAssetsMentionsServices = {
  getAssetLibrary,
  getAssetContentObjectUrl,
  listCanvasTextAssets,
  createId: () => crypto.randomUUID(),
  confirm: message => window.confirm(message),
  schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
  cancelSchedule: timer => window.clearTimeout(timer),
  revokeObjectURL: url => URL.revokeObjectURL(url),
  warn: (message, error) => console.warn(message, error),
};
