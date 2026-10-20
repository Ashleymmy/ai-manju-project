import type { Asset } from "@/entities/asset";
import { getAssetMediaUrl } from "@/entities/asset";
import type { WorkspaceScope } from "@/shared/config";
import type { CanvasNodeData } from "./types";
import {
  preferredStudioJobId,
  type CanvasGenerationHistoryItem,
} from "./generationHistory";

// Virtual nodes exist only in the history picker until the user adds a result.
// They let generations outlive their canvas node: the server keeps them in the
// asset library (overwritten ones for a 90-day grace period) and the history
// rebuilds them from there.
const HISTORY_NODE_PREFIX = "history-asset:";
const HISTORY_VIDEO_WIDTH = 320;
const HISTORY_VIDEO_HEIGHT = 180;
const HISTORY_IMAGE_WIDTH = 420;
const HISTORY_IMAGE_HEIGHT = 236;
function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

/**
 * Videos come from server jobs. Images may also be generated in the browser and
 * uploaded with their prompt (the server's canvasGeneratedAsset rule); plain
 * imports carry neither and never enter the generation history.
 */
function isGeneratedAsset(asset: Asset) {
  if (asset.source_job_id) return true;
  return (
    asset.type === "image" &&
    Boolean(asset.source_metadata && "prompt" in asset.source_metadata)
  );
}

export function serverVideoHistoryNodes(
  assets: readonly Asset[],
  scope: WorkspaceScope
): CanvasNodeData[] {
  return assets
    .filter(
      asset =>
        (asset.type === "video" || asset.type === "image") &&
        isGeneratedAsset(asset) &&
        !asset.trashed_at
    )
    .map(asset => {
      const meta = asset.source_metadata || {};
      const prompt = text(meta.prompt);
      const video = asset.type === "video";
      return {
        id: `${HISTORY_NODE_PREFIX}${asset.id}`,
        kind: video ? "video" : "image",
        title: asset.name || (video ? "生成视频" : "生成图片"),
        content: prompt,
        x: 0,
        y: 0,
        width: video ? HISTORY_VIDEO_WIDTH : HISTORY_IMAGE_WIDTH,
        height: video ? HISTORY_VIDEO_HEIGHT : HISTORY_IMAGE_HEIGHT,
        imageAssetId: asset.id,
        imageSrc: getAssetMediaUrl(asset.id, scope),
        metadata: {
          assetId: asset.id,
          assetScope: scope,
          status: "success",
          prompt,
          composerContent: prompt,
          model: text(meta.model),
          seconds: text(meta.seconds),
          size: text(meta.size),
          generatedAt: asset.created_at,
          seed: asset.source_job_id,
          generationJobId: asset.source_job_id,
          mimeType: asset.content_type || (video ? "video/mp4" : "image/png"),
          bytes: asset.size,
        },
      };
    });
}

/** One result per asset; prefer durable generation parameters over an edited node. */
export function mergeCanvasGenerationHistory(
  local: readonly CanvasGenerationHistoryItem[],
  server: readonly CanvasGenerationHistoryItem[]
) {
  const byAsset = new Map<string, CanvasGenerationHistoryItem>();
  for (const item of [...server, ...local]) {
    const key = item.assetId ? `${item.kind}:${item.assetId}` : item.nodeId;
    const existing = byAsset.get(key);
    if (!existing) byAsset.set(key, item);
    else if (
      existing.nodeId.startsWith(HISTORY_NODE_PREFIX) &&
      !item.nodeId.startsWith(HISTORY_NODE_PREFIX)
    ) {
      byAsset.set(key, {
        ...item,
        ...existing,
        prompt: existing.prompt || item.prompt,
        model: existing.model || item.model,
        size: existing.size || item.size,
        seconds: existing.seconds || item.seconds,
        modeLabel: item.modeLabel,
        jobId: preferredStudioJobId(existing.jobId, item.jobId),
      });
    }
  }
  return [...byAsset.values()].sort(
    (a, b) =>
      (Date.parse(b.generatedAt) || 0) - (Date.parse(a.generatedAt) || 0)
  );
}
