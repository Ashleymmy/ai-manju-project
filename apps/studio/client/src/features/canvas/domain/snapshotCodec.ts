import type {
  CanvasAgentSnapshot,
  CanvasAgentViewport,
} from "@ai-manju/canvas-agent-protocol";
import {
  buildRoundTripCanvasSnapshot,
  collectRoundTripCanvasEdgeEntries,
  hasRoundTripCanvasGraph,
  type CanvasSnapshotBase,
} from "./snapshotRoundTrip";
import type { CanvasGroupData } from "./groups";
import { normalizeCanvasGroups } from "./groups";
import { canvasAgentNodeFromCanvas, normalizeCanvasEdge, normalizeCanvasNode, serializeCanvasEdge, serializeCanvasNode } from "./nodes";
import { batchChildGridPosition, refreshImageBatchRoot } from "./batch";
import type { CanvasBackgroundMode, CanvasEdgeData, CanvasNodeData, CanvasSnapshotData } from "./types";
import { isRecord, numberValue, stringValue } from "./value";
import { CANVAS_ZOOM_MAX, CANVAS_ZOOM_MIN } from "./history";

export type CanvasStudioAgentSnapshot = CanvasAgentSnapshot<
  ReturnType<typeof canvasAgentNodeFromCanvas>
>;

export function parseCanvasSnapshot(value: unknown): CanvasSnapshotData | null {
  if (!hasRoundTripCanvasGraph(value)) return null;
  const data = value;
  const nodes0 = Array.isArray(data.nodes)
    ? data.nodes.map(normalizeCanvasNode).filter(Boolean) as CanvasNodeData[]
    : [];
  let edges = collectRoundTripCanvasEdgeEntries(data)
    .map(({ base, edge }) => normalizeCanvasEdge({ ...base, ...edge }))
    .filter(Boolean) as CanvasEdgeData[];
  let nodes = nodes0;
  const migratedRootIds: string[] = [];
  nodes.forEach((root) => {
    const childIds = Array.isArray(root.metadata?.batchChildIds)
      ? root.metadata.batchChildIds.filter((id): id is string => typeof id === "string")
      : [];
    if (!root.metadata?.isBatchRoot || !childIds.length || root.metadata.batchModelV2) return;
    if (stringValue(root.metadata.ownAssetId) || stringValue(root.metadata.ownImageSrc)) return;
    const firstChild = nodes.find((item) => item.id === childIds[0]);
    if (!firstChild) return;
    const restIds = childIds.slice(1);
    const promotedAssetId = firstChild.imageAssetId || stringValue(firstChild.metadata?.assetId);
    nodes = nodes
      .filter((item) => item.id !== firstChild.id)
      .map((item) => {
        if (item.id === root.id) {
          return {
            ...item,
            metadata: {
              ...item.metadata,
              batchModelV2: true,
              batchChildIds: restIds.length ? restIds : undefined,
              isBatchRoot: restIds.length > 0,
              ownAssetId: promotedAssetId || undefined,
              ownImageSrc: promotedAssetId ? undefined : firstChild.imageSrc || undefined,
              status: firstChild.metadata?.status,
            },
          };
        }
        const restIndex = restIds.indexOf(item.id);
        if (restIndex >= 0) {
          const pos = batchChildGridPosition(root, restIndex);
          return { ...item, x: pos.x, y: pos.y };
        }
        return item;
      });
    edges = edges.filter((edge) => edge.from !== firstChild.id && edge.to !== firstChild.id);
    migratedRootIds.push(root.id);
  });
  migratedRootIds.forEach((rootId) => { nodes = refreshImageBatchRoot(nodes, rootId); });
  const batchChildIdsByRoot = new Map<string, Set<string>>();
  nodes.forEach((node) => {
    const childIds = node.metadata?.batchChildIds;
    if (node.metadata?.isBatchRoot && Array.isArray(childIds)) batchChildIdsByRoot.set(node.id, new Set(childIds));
  });
  const cleanedEdges = batchChildIdsByRoot.size
    ? edges.filter((edge) => !batchChildIdsByRoot.get(edge.from)?.has(edge.to))
    : edges;
  const viewport = isRecord(data.viewport) ? data.viewport : {};
  const zoomFromViewport = numberValue(viewport.k);
  const backgroundMode = stringValue(data.backgroundMode);
  return {
    nodes,
    edges: cleanedEdges,
    groups: normalizeCanvasGroups(data.groups, nodes),
    zoom: numberValue(data.zoom) || (zoomFromViewport ? Math.round(zoomFromViewport * 100) : 90),
    panX: numberValue(data.panX) ?? numberValue(viewport.x) ?? 0,
    panY: numberValue(data.panY) ?? numberValue(viewport.y) ?? 0,
    backgroundMode: backgroundMode === "dots" || backgroundMode === "blank" ? backgroundMode : "lines",
    showImageInfo: data.showImageInfo === true,
  };
}

export function buildCanvasSnapshot(
  base: CanvasSnapshotBase,
  nodes: CanvasNodeData[],
  edges: CanvasEdgeData[],
  zoom: number,
  panX: number,
  panY: number,
  groups: CanvasGroupData[] = [],
  backgroundMode: CanvasBackgroundMode = "lines",
  showImageInfo = false,
) {
  return buildRoundTripCanvasSnapshot(base, {
    nodes: nodes.map(serializeCanvasNode),
    edges: edges.map(serializeCanvasEdge),
    groups: structuredClone(groups),
    zoom,
    panX,
    panY,
    backgroundMode,
    showImageInfo,
    defaultSchema: "ai-manhua-studio-canvas",
    defaultVersion: 3,
  });
}

export function canvasAgentSnapshotFromCanvas(
  projectId: string,
  title: string,
  nodes: CanvasNodeData[],
  edges: CanvasEdgeData[],
  selectedNodeIds: ReadonlySet<string>,
  viewport: { zoom: number; panX: number; panY: number },
): CanvasStudioAgentSnapshot {
  return {
    projectId,
    title,
    nodes: nodes.map(canvasAgentNodeFromCanvas),
    connections: edges.map((edge) => ({ id: edge.id, fromNodeId: edge.from, toNodeId: edge.to })),
    selectedNodeIds: Array.from(selectedNodeIds),
    viewport: { x: viewport.panX, y: viewport.panY, k: viewport.zoom / 100 },
  };
}

export function canvasViewportFromAgent(viewport: CanvasAgentViewport) {
  return {
    zoom: Math.max(CANVAS_ZOOM_MIN, Math.min(CANVAS_ZOOM_MAX, viewport.k * 100)),
    panX: viewport.x,
    panY: viewport.y,
  };
}
