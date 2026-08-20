export type CanvasConnectionHandleType = "source" | "target";

export type CanvasConnectionNode = {
  id: string;
  kind: string;
  title?: string;
  content?: string;
  imageAssetId?: string;
  imageSrc?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  metadata?: Record<string, unknown>;
};

export type CanvasConnectionEdge = {
  id: string;
  from: string;
  to: string;
};

export type CanvasConnectionDraft = {
  nodeId: string;
  handleType: CanvasConnectionHandleType;
};

export type CanvasConnectionLayerBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
  viewBox: string;
};

export type CanvasConnectionViewport = {
  zoom: number;
  panX: number;
  panY: number;
};

export type CanvasConnectionScreenRect = {
  left: number;
  top: number;
};

export type CanvasConnectionDropTarget = {
  nodeId: string;
  isNearNode: boolean;
};

export function canvasClientPointToWorld(
  clientX: number,
  clientY: number,
  rect: CanvasConnectionScreenRect | null | undefined,
  viewport: CanvasConnectionViewport,
  stageOffset = 0,
) {
  const scale = Math.max(0.05, viewport.zoom / 100);
  return {
    x: Math.round(((clientX - (rect?.left ?? 0)) - viewport.panX) / scale),
    y: Math.round(((clientY - (rect?.top ?? 0) - stageOffset) - viewport.panY) / scale),
  };
}

export function findCanvasConnectionDropTarget(
  nodes: readonly CanvasConnectionNode[],
  current: CanvasConnectionDraft,
  world: { x: number; y: number },
  options: { padding?: number; handleRadius?: number; zoom?: number } = {},
): CanvasConnectionDropTarget {
  const scale = Math.max(0.05, (options.zoom ?? 100) / 100);
  const padding = (options.padding ?? 28) / scale;
  const handleRadius = (options.handleRadius ?? 18) / scale;
  let isNearNode = false;
  let bestNodeId = "";
  let bestPriority = Number.POSITIVE_INFINITY;

  [...nodes]
    .filter((node) => !isHiddenCanvasBatchChild(node, nodes))
    .reverse()
    .forEach((node) => {
      const anchor = canvasConnectionTargetAnchor(node, current.handleType);
      const dx = world.x - anchor.x;
      const dy = world.y - anchor.y;
      const hitsHandle = dx * dx + dy * dy <= handleRadius * handleRadius;
      const hitsInside = world.x >= (node.x || 0)
        && world.x <= (node.x || 0) + (node.width || 0)
        && world.y >= (node.y || 0)
        && world.y <= (node.y || 0) + (node.height || 0);
      const hitsExpanded = world.x >= (node.x || 0) - padding
        && world.x <= (node.x || 0) + (node.width || 0) + padding
        && world.y >= (node.y || 0) - padding
        && world.y <= (node.y || 0) + (node.height || 0) + padding;
      if (!hitsHandle && !hitsInside && !hitsExpanded) return;
      isNearNode = true;
      if (node.id === current.nodeId || !normalizeCanvasConnection(current.nodeId, node.id, nodes, current.handleType)) return;
      const priority = hitsInside ? 0 : hitsHandle ? 1 : 2;
      if (priority < bestPriority) {
        bestNodeId = node.id;
        bestPriority = priority;
      }
    });

  return { nodeId: bestNodeId, isNearNode };
}

export function normalizeCanvasConnection(
  firstNodeId: string,
  secondNodeId: string,
  nodes: readonly CanvasConnectionNode[],
  firstHandleType: CanvasConnectionHandleType = "source",
) {
  const first = nodes.find((node) => node.id === firstNodeId);
  const second = nodes.find((node) => node.id === secondNodeId);
  if (!first || !second || first.id === second.id) return null;
  if (first.kind === "config" && second.kind === "config") return null;
  if (second.kind === "config") return { from: first.id, to: second.id };
  if (first.kind === "config" && firstHandleType === "target") return { from: second.id, to: first.id };
  return { from: first.id, to: second.id };
}

export function defaultCanvasConnectionHandle(node: CanvasConnectionNode | null | undefined): CanvasConnectionHandleType {
  return node?.kind === "config" ? "target" : "source";
}

export function canvasConnectionCurvature(startX: number, endX: number) {
  return Math.max(50, Math.abs(endX - startX) * 0.5);
}

export function canvasActiveConnectionPath(
  node: CanvasConnectionNode,
  handleType: CanvasConnectionHandleType,
  mouseWorld: { x: number; y: number },
  target?: CanvasConnectionNode | null,
) {
  const start = handleType === "source"
    ? canvasEdgeStartPoint(node)
    : target
      ? canvasEdgeStartPoint(target)
      : mouseWorld;
  const end = handleType === "source"
    ? target
      ? canvasEdgeTargetPoint(target)
      : mouseWorld
    : canvasEdgeTargetPoint(node);
  const distance = Math.abs(end.x - start.x);
  return `M ${start.x} ${start.y} C ${start.x + distance * 0.5} ${start.y}, ${end.x - distance * 0.5} ${end.y}, ${end.x} ${end.y}`;
}

export function addCanvasConnection<TEdge extends CanvasConnectionEdge>(
  edges: readonly TEdge[],
  connection: Pick<CanvasConnectionEdge, "from" | "to">,
  createId: () => string,
): TEdge[] {
  if (edges.some((edge) => edge.from === connection.from && edge.to === connection.to)) return edges as TEdge[];
  return [...edges, { id: createId(), ...connection } as TEdge];
}

export function connectCanvasNodesToConfig<TEdge extends CanvasConnectionEdge>(
  nodes: readonly CanvasConnectionNode[],
  edges: readonly TEdge[],
  selectedNodeIds: Iterable<string>,
  targetConfigId: string,
  createId: () => string,
) {
  const target = nodes.find((node) => node.id === targetConfigId);
  if (!target || target.kind !== "config") return { edges: edges as TEdge[], addedCount: 0, sourceNodeIds: [] as string[] };
  const sourceNodeIds = connectableCanvasNodesToConfig(nodes, selectedNodeIds, targetConfigId)
    .map((node) => node.id);
  let nextEdges = edges as TEdge[];
  let addedCount = 0;
  sourceNodeIds.forEach((nodeId) => {
    const connection = normalizeCanvasConnection(nodeId, targetConfigId, nodes, "source");
    if (!connection) return;
    const updated = addCanvasConnection(nextEdges, connection, createId);
    if (updated !== nextEdges) addedCount += 1;
    nextEdges = updated;
  });
  return { edges: nextEdges, addedCount, sourceNodeIds };
}

export function connectableCanvasNodesToConfig<TNode extends CanvasConnectionNode>(
  nodes: readonly TNode[],
  selectedNodeIds: Iterable<string>,
  targetConfigId: string,
) {
  return visibleCanvasConnectionNodes(nodes, selectedNodeIds)
    .filter((node) => node.id !== targetConfigId && Boolean(normalizeCanvasConnection(node.id, targetConfigId, nodes, "source")));
}

export function createConnectedCanvasGraph<TNode extends CanvasConnectionNode, TEdge extends CanvasConnectionEdge>(
  nodes: readonly TNode[],
  edges: readonly TEdge[],
  candidate: TNode,
  draft: CanvasConnectionDraft,
  createEdgeId: () => string,
) {
  const nextNodes = [...nodes, candidate];
  const connection = normalizeCanvasConnection(draft.nodeId, candidate.id, nextNodes, draft.handleType);
  if (!connection) return null;
  return {
    nodes: nextNodes,
    edges: addCanvasConnection(edges, connection, createEdgeId),
    connection,
  };
}

export function isActiveCanvasConnectionPointer(active: boolean, pointerId: number | null, eventPointerId: number) {
  return active && pointerId === eventPointerId;
}

export function isHiddenCanvasBatchChild(node: CanvasConnectionNode, nodes: readonly CanvasConnectionNode[]) {
  const rootId = stringMetadata(node, "batchRootId");
  if (!rootId) return false;
  const root = nodes.find((item) => item.id === rootId);
  return Boolean(root && !root.metadata?.imageBatchExpanded);
}

export function isHiddenCanvasConnectionEndpoint(node: CanvasConnectionNode, nodes: readonly CanvasConnectionNode[]) {
  return isHiddenCanvasBatchChild(node, nodes);
}

export function visibleCanvasConnectionNodes<TNode extends CanvasConnectionNode>(
  nodes: readonly TNode[],
  selectedNodeIds: Iterable<string>,
) {
  const selectedIds = new Set(selectedNodeIds);
  return nodes.filter((node) => selectedIds.has(node.id) && !isHiddenCanvasBatchChild(node, nodes));
}

export type CanvasGenerationInput = {
  nodeId: string;
  type: "text" | "image" | "video" | "audio";
  title: string;
  text?: string;
  content?: string;
  assetId?: string;
  assetScope?: "personal" | "team";
};

export function buildCanvasGenerationInputs(
  nodeId: string,
  nodes: readonly CanvasConnectionNode[],
  edges: readonly Pick<CanvasConnectionEdge, "from" | "to">[],
): CanvasGenerationInput[] {
  const configInputs = connectedConfigInputs(nodeId, nodes, edges);
  if (configInputs.length) return configInputs;
  const directInputs = contextResourceInputs(nodeId, nodes, edges);
  if (directInputs.length) return directInputs;
  const self = nodes.find((node) => node.id === nodeId);
  const selfInput = self && !isHiddenCanvasBatchChild(self, nodes) && isDirectMediaResource(self) ? generationInput(self) : null;
  return selfInput ? [selfInput] : [];
}

export function buildCanvasConnectionLayerBounds(
  nodes: readonly CanvasConnectionNode[],
  edges: readonly Pick<CanvasConnectionEdge, "from" | "to">[],
  preview?: {
    nodeId: string;
    handleType: CanvasConnectionHandleType;
    previewPoint?: { x: number; y: number } | null;
    targetNodeId?: string;
  },
): CanvasConnectionLayerBounds {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const points: Array<{ x: number; y: number }> = [];
  const addPoint = (point?: { x: number; y: number } | null) => {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    points.push(point);
  };
  const addPathPoints = (
    start: { x: number; y: number },
    end: { x: number; y: number },
    handleType: CanvasConnectionHandleType = "source",
  ) => {
    const curvature = canvasConnectionCurvature(start.x, end.x);
    const direction = handleType === "source" ? 1 : -1;
    addPoint(start);
    addPoint(end);
    addPoint({ x: start.x + curvature * direction, y: start.y });
    addPoint({ x: end.x - curvature * direction, y: end.y });
  };

  edges.forEach((edge) => {
    const from = nodeMap.get(edge.from);
    const to = nodeMap.get(edge.to);
    if (!from || !to || isHiddenCanvasConnectionEndpoint(from, nodes) || isHiddenCanvasConnectionEndpoint(to, nodes)) return;
    const start = canvasEdgeStartPoint(from);
    const end = canvasEdgeTargetPoint(to);
    addPathPoints(start, end);
  });

  if (preview) {
    const source = nodeMap.get(preview.nodeId);
    if (source) {
      const start = preview.handleType === "source"
        ? canvasEdgeStartPoint(source)
        : canvasEdgeTargetPoint(source);
      const target = preview.targetNodeId ? nodeMap.get(preview.targetNodeId) : null;
      const end = target
        ? (preview.handleType === "source" ? canvasEdgeTargetPoint(target) : canvasEdgeStartPoint(target))
        : preview.previewPoint;
      if (end) addPathPoints(start, end, preview.handleType);
    }
  }

  if (!points.length) {
    return { left: 0, top: 0, width: 1, height: 1, viewBox: "0 0 1 1" };
  }

  const padding = 120;
  const left = Math.floor(Math.min(...points.map((point) => point.x)) - padding);
  const top = Math.floor(Math.min(...points.map((point) => point.y)) - padding);
  const right = Math.ceil(Math.max(...points.map((point) => point.x)) + padding);
  const bottom = Math.ceil(Math.max(...points.map((point) => point.y)) + padding);
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
    viewBox: `${left} ${top} ${Math.max(1, right - left)} ${Math.max(1, bottom - top)}`,
  };
}

function canvasEdgeStartPoint(node: CanvasConnectionNode) {
  return {
    x: (node.x || 0) + (node.width || 0),
    y: (node.y || 0) + (node.height || 0) / 2,
  };
}

function canvasEdgeTargetPoint(node: CanvasConnectionNode) {
  return {
    x: node.x || 0,
    y: (node.y || 0) + (node.height || 0) / 2,
  };
}

function canvasConnectionTargetAnchor(node: CanvasConnectionNode, handleType: CanvasConnectionHandleType) {
  return handleType === "source" ? canvasEdgeTargetPoint(node) : canvasEdgeStartPoint(node);
}

export function promptFromCanvasTopology(
  nodeId: string,
  nodes: readonly CanvasConnectionNode[],
  edges: readonly Pick<CanvasConnectionEdge, "from" | "to">[],
  ownPrompt: string,
) {
  const upstreamText = buildCanvasGenerationInputs(nodeId, nodes, edges)
    .map((input) => input.text)
    .filter(Boolean)
    .join("\n\n");
  return [ownPrompt, upstreamText].filter(Boolean).join("\n\n").trim();
}

function connectedConfigInputs(
  nodeId: string,
  nodes: readonly CanvasConnectionNode[],
  edges: readonly Pick<CanvasConnectionEdge, "from" | "to">[],
) {
  const configEdge = edges.find((edge) => edge.from === nodeId && nodes.find((node) => node.id === edge.to)?.kind === "config");
  if (!configEdge) return [];
  return contextResourceInputs(configEdge.to, nodes, edges).filter((input) => input.nodeId !== nodeId);
}

function contextResourceInputs(
  nodeId: string,
  nodes: readonly CanvasConnectionNode[],
  edges: readonly Pick<CanvasConnectionEdge, "from" | "to">[],
) {
  return edges
    .filter((edge) => edge.to === nodeId)
    .map((edge) => nodes.find((node) => node.id === edge.from))
    .filter((node): node is CanvasConnectionNode => Boolean(node && !isHiddenCanvasBatchChild(node, nodes)))
    .map(generationInput)
    .filter((input): input is CanvasGenerationInput => Boolean(input));
}

function generationInput(node: CanvasConnectionNode): CanvasGenerationInput | null {
  const type = generationInputType(node);
  if (!type) return null;
  const title = node.title?.trim() || node.id;
  if (type === "text") return { nodeId: node.id, type, title, text: nodeText(node) };
  return {
    nodeId: node.id,
    type,
    title,
    content: node.imageSrc || stringMetadata(node, "content") || undefined,
    assetId: node.imageAssetId || stringMetadata(node, "assetId") || undefined,
    assetScope: workspaceScopeMetadata(node, "assetScope"),
  };
}

function generationInputType(node: CanvasConnectionNode): CanvasGenerationInput["type"] | null {
  if ((node.kind === "prompt" || node.kind === "text") && nodeText(node)) return "text";
  if ((node.kind === "image" || node.kind === "video" || node.kind === "audio") && hasMediaResource(node)) return node.kind;
  return null;
}

function isDirectMediaResource(node: CanvasConnectionNode) {
  return (node.kind === "image" || node.kind === "video" || node.kind === "audio") && hasMediaResource(node);
}

function hasMediaResource(node: CanvasConnectionNode) {
  return Boolean(node.imageSrc || node.imageAssetId || stringMetadata(node, "content") || stringMetadata(node, "assetId"));
}

function nodeText(node: CanvasConnectionNode) {
  return stringMetadata(node, "prompt") || node.content?.trim() || stringMetadata(node, "content");
}

function stringMetadata(node: CanvasConnectionNode, key: string) {
  const value = node.metadata?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function workspaceScopeMetadata(node: CanvasConnectionNode, key: string) {
  const value = stringMetadata(node, key);
  return value === "personal" || value === "team" ? value : undefined;
}
