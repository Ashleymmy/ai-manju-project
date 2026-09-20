import { updateAssetMetadata, type Asset, type AssetCategory } from "@/entities/asset";
import type { WorkspaceScope } from "@/shared/config";

// Keep a page-wide edit from flooding the API while retaining per-asset results.
const CATEGORY_UPDATE_CONCURRENCY = 3;

export type BulkCategoryResult = { updated: Asset[]; failedIds: string[] };

export async function updateAssetCategories(ids: readonly string[], category: AssetCategory, scope: WorkspaceScope): Promise<BulkCategoryResult> {
  const pending = [...new Set(ids)];
  const updated: Asset[] = [];
  const failedIds: string[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CATEGORY_UPDATE_CONCURRENCY, pending.length) }, async () => {
    while (next < pending.length) {
      const id = pending[next++];
      try {
        // Omit other metadata so names, notes, tags, and folder assignments survive.
        updated.push(await updateAssetMetadata(id, { category }, scope));
      } catch {
        failedIds.push(id);
      }
    }
  }));
  return { updated, failedIds };
}
