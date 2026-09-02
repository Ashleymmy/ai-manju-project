import {
  controlComicBatch,
  createComicBatch,
  getComicBatch,
  listComicBatches,
  retryComicBatchItem,
  retryFailedComicBatchItems,
} from "@/entities/comic";
import type { WorkspaceScope } from "@/shared/config";

import {
  comicBatchInput,
  latestComicBatch,
  type ComicBatchDraft,
} from "../model/workflow";

export async function loadLatestComicBatch(
  projectId: string,
  scope: WorkspaceScope
) {
  const latest = latestComicBatch(await listComicBatches(projectId, scope));
  return latest ? getComicBatch(latest.id, scope) : null;
}

export function createComicGenerationBatch(
  projectId: string,
  draft: ComicBatchDraft,
  scope: WorkspaceScope
) {
  return createComicBatch(projectId, comicBatchInput(draft), scope);
}

export function changeComicBatchState(
  batchId: string,
  action: "pause" | "resume" | "stop",
  scope: WorkspaceScope
) {
  return controlComicBatch(batchId, action, scope);
}

export function retryComicGenerationItem(
  batchId: string,
  itemId: string,
  scope: WorkspaceScope
) {
  return retryComicBatchItem(batchId, itemId, scope);
}

export function retryFailedComicGenerationItems(
  batchId: string,
  scope: WorkspaceScope
) {
  return retryFailedComicBatchItems(batchId, scope);
}
