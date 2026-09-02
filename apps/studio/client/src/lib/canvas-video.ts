// Compatibility forwarder. Remove after all callers move to the Canvas feature boundary.
import { hydrateCanvasVideoReferences as hydrateDomainCanvasVideoReferences } from "@/features/canvas/domain/video";
import type { CanvasVideoReferenceHydrators as DomainHydrators } from "@/features/canvas/domain/video";

export {
  canvasSeedanceVideoReferences,
  mergeCanvasVideoReferences,
  videoResultPersistentMetadata,
} from "@/features/canvas/domain/video";
export type {
  ArchivedVideoAsset,
  CanvasSeedanceMaterialReference,
  CanvasSeedanceVolcanoReference,
  CanvasVideoReferenceHydrationResult,
  CanvasVideoReferenceSnapshot,
  CanvasVideoReferenceSnapshotItem,
  PersistentVideoResultMetadata,
} from "@/features/canvas/domain/video";

export type CanvasVideoReferenceHydrators = Omit<DomainHydrators, "createFile"> & {
  createFile?: DomainHydrators["createFile"];
};

export function hydrateCanvasVideoReferences(
  inputs: Parameters<typeof hydrateDomainCanvasVideoReferences>[0],
  hydrators: CanvasVideoReferenceHydrators,
) {
  return hydrateDomainCanvasVideoReferences(inputs, {
    ...hydrators,
    createFile:
      hydrators.createFile ??
      ((blob, name, mime) => new File([blob], name, { type: mime })),
  });
}
