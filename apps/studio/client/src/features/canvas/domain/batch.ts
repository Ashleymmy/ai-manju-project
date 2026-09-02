import type { CanvasNodeData, CanvasNodeStatus } from "./types";
import { stringValue } from "./value";
import { assetIdFromNode } from "./nodes";

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
  const rootOwnAssetId = stringValue(root.metadata?.ownAssetId);
  const rootOwnImageSrc = stringValue(root.metadata?.ownImageSrc);
  const rootOwnReady = root.metadata?.status === "success" && Boolean(rootOwnAssetId || rootOwnImageSrc);
  const explicitPrimaryId = stringValue(root.metadata?.primaryImageId);
  const primary = members.find((node) => node.id === explicitPrimaryId) || (rootOwnReady ? root : undefined) || succeeded[0];
  const primaryIsRoot = primary?.id === rootId;
  const primaryAssetId = primary ? (primaryIsRoot ? rootOwnAssetId : assetIdFromNode(primary) || "") : "";
  const primaryImageSrc = primary ? (primaryIsRoot ? rootOwnImageSrc : primary.imageSrc || "") : "";
  const total = members.length;
  const status: CanvasNodeStatus = loading ? "loading" : succeeded.length ? "success" : "error";
  const errorDetails = loading || !failed.length ? undefined : succeeded.length ? `${failed.length} 个结果失败，可单独重试。` : "全部图片生成失败，可重试。";
  return nodes.map((node) => node.id === rootId ? {
    ...node,
    title: loading ? "批量生成中…" : succeeded.length ? `批量图片 ${succeeded.length}/${total}` : "批量生成失败",
    imageAssetId: primaryIsRoot ? rootOwnAssetId || undefined : primaryAssetId || node.imageAssetId,
    imageSrc: primaryIsRoot ? (rootOwnAssetId ? undefined : rootOwnImageSrc || undefined) : primaryAssetId ? undefined : primaryImageSrc || node.imageSrc,
    metadata: {
      ...node.metadata,
      assetId: primaryAssetId || node.metadata?.assetId,
      primaryImageId: primary && !primaryIsRoot ? primary.id : undefined,
      status,
      errorDetails,
      jobId: undefined,
      jobProgress: undefined,
    },
  } : node);
}

export function resetInterruptedCanvasGenerations(nodes: CanvasNodeData[]) {
  const loadingJobIds = new Set(nodes
    .filter((node) => node.metadata?.status === "loading" && stringValue(node.metadata?.jobId))
    .map((node) => node.id));
  return nodes.map((node) => {
    if (node.metadata?.status !== "loading" || stringValue(node.metadata?.jobId)) return node;
    const batchChildren = Array.isArray(node.metadata?.batchChildIds)
      ? node.metadata.batchChildIds.filter((id): id is string => typeof id === "string")
      : [];
    if (node.metadata?.isBatchRoot && batchChildren.some((id) => loadingJobIds.has(id))) return node;
    return {
      ...node,
      title: node.metadata?.isBatchRoot ? "批量生成已中断" : "生成已中断",
      metadata: { ...node.metadata, status: "error" as const, errorDetails: "页面刷新后生成已中断，请重新生成。" },
    };
  });
}
