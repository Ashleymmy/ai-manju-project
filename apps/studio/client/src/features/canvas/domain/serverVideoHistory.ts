import type { Asset } from "@/entities/asset";
import { getAssetMediaUrl } from "@/entities/asset";
import type { WorkspaceScope } from "@/shared/config";
import type { CanvasNodeData } from "./types";
import type { CanvasGenerationHistoryItem } from "./generationHistory";

// Virtual nodes exist only in the history picker until the user adds a result.
const HISTORY_NODE_PREFIX = "history-asset:";
const HISTORY_VIDEO_WIDTH = 320;
const HISTORY_VIDEO_HEIGHT = 180;
function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

export function serverVideoHistoryNodes(assets: readonly Asset[], scope: WorkspaceScope): CanvasNodeData[] {
  return assets.filter(asset => asset.type === "video" && asset.source_job_id && !asset.trashed_at).map(asset => {
    const meta = asset.source_metadata || {};
    const prompt = text(meta.prompt);
    return {
      id: `${HISTORY_NODE_PREFIX}${asset.id}`, kind: "video", title: asset.name || "生成视频", content: prompt,
      x: 0, y: 0, width: HISTORY_VIDEO_WIDTH, height: HISTORY_VIDEO_HEIGHT,
      imageAssetId: asset.id, imageSrc: getAssetMediaUrl(asset.id, scope),
      metadata: {
        assetId: asset.id, assetScope: scope, status: "success", prompt, composerContent: prompt,
        model: text(meta.model), seconds: text(meta.seconds), size: text(meta.size),
        generatedAt: asset.created_at, seed: asset.source_job_id,
        mimeType: asset.content_type || "video/mp4", bytes: asset.size,
      },
    };
  });
}

/** One result per asset; prefer durable generation parameters over an edited node. */
export function mergeCanvasGenerationHistory(
  local: readonly CanvasGenerationHistoryItem[], server: readonly CanvasGenerationHistoryItem[],
) {
  const byAsset = new Map<string, CanvasGenerationHistoryItem>();
  for (const item of [...server, ...local]) {
    const key = item.assetId ? `${item.kind}:${item.assetId}` : item.nodeId;
    const existing = byAsset.get(key);
    if (!existing) byAsset.set(key, item);
    else if (existing.nodeId.startsWith(HISTORY_NODE_PREFIX) && !item.nodeId.startsWith(HISTORY_NODE_PREFIX)) {
      byAsset.set(key, { ...item, ...existing,
        prompt: existing.prompt || item.prompt, model: existing.model || item.model,
        size: existing.size || item.size, seconds: existing.seconds || item.seconds, modeLabel: item.modeLabel });
    }
  }
  return [...byAsset.values()].sort((a, b) => (Date.parse(b.generatedAt) || 0) - (Date.parse(a.generatedAt) || 0));
}
