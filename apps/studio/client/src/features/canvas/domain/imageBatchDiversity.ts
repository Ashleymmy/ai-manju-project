import { imageCountFromNode } from "./nodeUtils";
import type { CanvasNodeData } from "./types";
import { stringValue } from "./value";

/** 图片接口常用的正整数种子上限（避开 2^31-1 哨兵值）。 */
export const IMAGE_GENERATION_SEED_MAX = 2_147_483_646;

/**
 * 批量成图时轮换构图/光影提示。
 * 多路并行请求如果 prompt 完全相同，gpt-image / Seedream 等会概率性抽到同一画面。
 */
const BATCH_IMAGE_SHOT_HINTS = [
  "近景特写，主体细节更清楚",
  "中景，留出周围环境",
  "略俯视的高机位",
  "略仰视的低机位",
  "偏侧面的三分构图",
  "对称构图",
  "非对称黄金分割构图",
  "逆光，轮廓更清楚",
  "柔和散射光",
  "硬光高对比",
  "更暖的色温",
  "更冷的色温",
  "主体偏左",
  "主体偏右",
  "更开阔的空间感",
] as const;

export function randomImageGenerationSeed(): number {
  const span = IMAGE_GENERATION_SEED_MAX;
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    return (bytes[0] % span) + 1;
  }
  return Math.floor(Math.random() * span) + 1;
}

export function canvasImageBatchSlot(
  nodes: readonly CanvasNodeData[],
  nodeId: string,
): { index: number; count: number } {
  const node = nodes.find(item => item.id === nodeId);
  if (!node) return { index: 0, count: 1 };
  const rootId = stringValue(node.metadata?.batchRootId) || (node.metadata?.isBatchRoot ? node.id : "");
  if (!rootId) return { index: 0, count: 1 };
  const root = nodes.find(item => item.id === rootId) || node;
  const childIds = (root.metadata?.batchChildIds || []).filter((id): id is string => typeof id === "string" && id.trim() !== "");
  const ordered = [rootId, ...childIds];
  const index = Math.max(0, ordered.indexOf(nodeId));
  return { index, count: Math.max(ordered.length, imageCountFromNode(root)) };
}

export function diversifyCanvasBatchImagePrompt(
  prompt: string,
  index: number,
  count: number,
  seed?: number,
): string {
  const trimmed = prompt.trim();
  if (!trimmed || count <= 1) return trimmed;
  const hint = BATCH_IMAGE_SHOT_HINTS[index % BATCH_IMAGE_SHOT_HINTS.length];
  const variant = Number.isFinite(seed) ? `变体 ${Math.trunc(seed as number)}` : `槽位 ${index + 1}`;
  return `${trimmed}\n\n【独立成图 ${index + 1}/${count}｜${variant}】请生成与同批次其他图完全不同的新画面：${hint}。禁止复用同一构图或轻微改动同一画面；不要把这段说明画进画面。`;
}
