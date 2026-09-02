// Compatibility forwarder. Remove after all callers move to the Canvas feature boundary.
export {
  canvasTextAssetStorageKey,
  listCanvasTextAssets,
  saveCanvasTextAsset,
} from "@/features/canvas/repositories/textAssetsRepository";
export type {
  CanvasTextAsset,
  CanvasTextAssetStorage,
} from "@/features/canvas/repositories/textAssetsRepository";
