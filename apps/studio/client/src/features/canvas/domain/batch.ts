import type { CanvasNodeData, CanvasNodeStatus } from "./types";
import { stringValue } from "./value";
import { assetIdFromNode } from "./nodes";
import { preserveCanvasNodeTitle } from "./nodeTitles";
import { markInterruptedCanvasRequests } from "./generationResume";

/** 批次子图的网格间距（画布单位）。 */
export const BATCH_GRID_GAP = 36;

export function batchChildGridPosition(root: CanvasNodeData, index: number) {
  const col = index === 0 ? 0 : 1 + Math.floor((index - 1) / 2);
  const row = index === 0 ? -1 : (index - 1) % 2 === 0 ? -1 : 0;
  return {
    x: root.x + col * (root.width + BATCH_GRID_GAP),
    y: root.y + row * (root.height + BATCH_GRID_GAP),
  };
}

export function snapImageBatchChildrenToGrid(nodes: CanvasNodeData[], rootId: string) {
  const root = nodes.find((node) => node.id === rootId);
  const childIds = Array.isArray(root?.metadata?.batchChildIds)
    ? root.metadata.batchChildIds.filter((id): id is string => typeof id === "string")
    : [];
  if (!root || !childIds.length) return nodes;
  return nodes.map((node) => {
    const index = childIds.indexOf(node.id);
    if (index < 0) return node;
    const pos = batchChildGridPosition(root, index);
    return node.x === pos.x && node.y === pos.y ? node : { ...node, x: pos.x, y: pos.y };
  });
}

export function refreshImageBatchRoot(nodes: CanvasNodeData[], rootId: string) {
  const root = nodes.find((node) => node.id === rootId);
  const childIds = Array.isArray(root?.metadata?.batchChildIds)
    ? root.metadata.batchChildIds.filter((id): id is string => typeof id === "string")
    : [];
  if (!root || !childIds.length) return nodes;
  const children = childIds
    .map((id) => nodes.find((node) => node.id === id))
    .filter((node): node is CanvasNodeData => Boolean(node));
  const members = [root, ...children];
  const loading = members.some((node) => node.metadata?.status === "loading");
  const succeeded = members.filter((node) => node.metadata?.status === "success");
  const failed = members.filter((node) => node.metadata?.status === "error");
  // Each slot owns one result. Never copy a finished child into the root while
  // its request is pending: that duplicates the child and loses the root's slot.
  const rootOwnAssetId = stringValue(root.metadata?.ownAssetId) || assetIdFromNode(root);
  const rootOwnImageSrc = stringValue(root.metadata?.ownImageSrc) || root.imageSrc;
  const total = members.length;
  const status: CanvasNodeStatus = loading ? "loading" : succeeded.length ? "success" : "error";
  const errorDetails = loading || !failed.length ? undefined : succeeded.length ? `${failed.length} 个结果失败，可单独重试。` : "全部图片生成失败，可重试。";
  return nodes.map((node) => node.id === rootId ? {
    ...node,
    title: preserveCanvasNodeTitle(node, loading ? "批量生成中…" : succeeded.length ? `批量图片 ${succeeded.length}/${total}` : "批量生成失败"),
    imageAssetId: rootOwnAssetId || undefined,
    imageSrc: rootOwnAssetId ? undefined : rootOwnImageSrc,
    metadata: {
      ...node.metadata,
      assetId: rootOwnAssetId || undefined,
      primaryImageId: undefined,
      // status/errorDetails/jobId describe the root request and must survive a
      // child update, so recovery, cancellation and retry still target it.
      batchStatus: status,
      batchErrorDetails: errorDetails,
    },
  } : node);
}

/**
 * Exchange the image payloads of a batch root and one child. The node IDs and
 * batch membership stay fixed, so selecting a different primary image is a
 * true position swap and never discards the image that was previously shown
 * in the primary slot.
 */
export function swapImageBatchPrimary(nodes: CanvasNodeData[], rootId: string, childId: string) {
  const root = nodes.find((node) => node.id === rootId);
  const child = nodes.find((node) => node.id === childId && node.metadata?.batchRootId === rootId);
  if (!root || !child || rootId === childId) return nodes;
  if ([root, child].some(node => node.metadata?.status === "loading"
    || node.metadata?.status === "error"
    || (!assetIdFromNode(node) && !node.imageSrc))) return nodes;

  const rootPayload = imagePayload(root);
  const childPayload = imagePayload(child);
  const next = nodes.map((node) => {
    if (node.id === rootId) {
      return {
        ...node,
        ...childPayload.node,
        metadata: {
          ...node.metadata,
          ...childPayload.metadata,
          // The swapped child is now physically in the primary slot; root
          // owns that payload so later batch refreshes keep the same layout.
          primaryImageId: undefined,
          ownAssetId: childPayload.metadata.assetId,
          ownImageSrc: childPayload.node.imageSrc,
        },
      };
    }
    if (node.id === childId) {
      return {
        ...node,
        ...rootPayload.node,
        metadata: {
          ...node.metadata,
          ...rootPayload.metadata,
          batchRootId: rootId,
        },
      };
    }
    return node;
  });
  return refreshImageBatchRoot(next, rootId);
}

function imagePayload(node: CanvasNodeData) {
  return {
    node: {
      title: node.title,
      content: node.content,
      imageAssetId: node.imageAssetId,
      imageSrc: node.imageSrc,
    },
    metadata: {
      assetId: assetIdFromNode(node) || undefined,
      assetScope: node.metadata?.assetScope,
      naturalWidth: node.metadata?.naturalWidth,
      naturalHeight: node.metadata?.naturalHeight,
      bytes: node.metadata?.bytes,
      mimeType: node.metadata?.mimeType,
      content: node.metadata?.content,
      prompt: node.metadata?.prompt,
      composerContent: node.metadata?.composerContent,
      model: node.metadata?.model,
      seed: node.metadata?.seed,
      generatedAt: node.metadata?.generatedAt,
      generationType: node.metadata?.generationType,
      referenceInputs: node.metadata?.referenceInputs,
      size: node.metadata?.size,
      quality: node.metadata?.quality,
      imageResolution: node.metadata?.imageResolution,
      requestedImageSize: node.metadata?.requestedImageSize,
    },
  };
}

export function resetInterruptedCanvasGenerations(nodes: CanvasNodeData[]) {
  const loadingJobIds = new Set(nodes
    .filter((node) => node.metadata?.status === "loading" && stringValue(node.metadata?.jobId))
    .map((node) => node.id));
  return markInterruptedCanvasRequests(nodes).map((node) => {
    if (node.metadata?.status !== "loading" || stringValue(node.metadata?.jobId)) return node;
    // 图片/视频任务在 worker 侧继续跑，刷新后由 recoverPendingJobs 接回，这里不能直接标失败。
    if (node.kind === "image" || node.kind === "video") return node;
    const batchChildren = Array.isArray(node.metadata?.batchChildIds)
      ? node.metadata.batchChildIds.filter((id): id is string => typeof id === "string")
      : [];
    if (node.metadata?.isBatchRoot && batchChildren.some((id) => loadingJobIds.has(id))) return node;
    return {
      ...node,
      title: preserveCanvasNodeTitle(node, node.metadata?.isBatchRoot ? "批量生成已中断" : "生成已中断"),
      metadata: { ...node.metadata, status: "error" as const, errorDetails: "页面刷新后生成已中断，请重新生成。" },
    };
  });
}
