import localforage from "localforage";

import type { WorkspaceScope } from "@/shared/config";
import type { NormalizedCanvasAudioGenerationConfig } from "./audioConfig";

/**
 * A generated audio result is kept until its asset and canvas are both saved.
 * The Blob is deliberately separate from the canvas snapshot: snapshots are
 * JSON-shaped and must remain cheap to save, while IndexedDB can retain the
 * binary result across a refresh without asking the provider to generate it
 * again.
 */
export type CanvasPendingAudioUpload = {
  key: string;
  userId: string;
  workspace: WorkspaceScope;
  projectId: string;
  projectKey: string;
  nodeId: string;
  originNodeId: string;
  scope: WorkspaceScope;
  prompt: string;
  config: NormalizedCanvasAudioGenerationConfig;
  blob: Blob;
  fileName: string;
  contentType: string;
  bytes: number;
  createdAt: string;
  attemptId: string;
  /** Saved before updating the canvas, so recovery never uploads twice. */
  assetId?: string;
};

export type CanvasPendingAudioUploadQuery = Pick<CanvasPendingAudioUpload,
  "userId" | "workspace" | "projectId" | "projectKey" | "nodeId">;

export type CanvasPendingAudioUploadDescriptor = {
  key: string;
  fileName: string;
  contentType: string;
  bytes: number;
  createdAt: string;
};

/** Stable per-project/node key; projectKey already contains the workspace scope. */
export function canvasPendingAudioUploadKey(
  userId: string,
  workspace: WorkspaceScope,
  projectKey: string,
  nodeId: string,
  attemptId: string
) {
  return ["canvas-audio", userId, workspace, projectKey, nodeId, attemptId]
    .map(part => encodeURIComponent(part))
    .join(":");
}

export function canvasPendingAudioUploadDescriptor(
  pending: CanvasPendingAudioUpload
): CanvasPendingAudioUploadDescriptor {
  return {
    key: pending.key,
    fileName: pending.fileName,
    contentType: pending.contentType,
    bytes: pending.bytes,
    createdAt: pending.createdAt,
  };
}

const pendingAudioStore = localforage.createInstance({
  name: "ai-manhua-studio",
  storeName: "canvas_audio_uploads_v1",
});

/** Browser persistence adapter used by the generation controller. */
export const browserPendingAudioUploadStore = {
  async save(pending: CanvasPendingAudioUpload) {
    await pendingAudioStore.setItem(pending.key, pending);
  },
  load(key: string) {
    return pendingAudioStore.getItem<CanvasPendingAudioUpload>(key);
  },
  async find(query: CanvasPendingAudioUploadQuery) {
    // Locate orphan results even when the canvas descriptor never reached the
    // server. Filter keys before loading Blobs, and never scan another user's
    // media or another canvas into memory.
    const prefix = canvasPendingAudioUploadKey(query.userId, query.workspace, query.projectKey, query.nodeId, "");
    const keys = (await pendingAudioStore.keys()).filter(key => key.startsWith(prefix));
    let latest: CanvasPendingAudioUpload | null = null;
    for (const key of keys) {
      const item = await pendingAudioStore.getItem<CanvasPendingAudioUpload>(key);
      if (!item) continue;
      if (item.key !== key) throw new Error("invalid pending audio record");
      if (!latest || item.createdAt > latest.createdAt) latest = item;
    }
    return latest;
  },
  async remove(key: string) {
    await pendingAudioStore.removeItem(key);
  },
};
