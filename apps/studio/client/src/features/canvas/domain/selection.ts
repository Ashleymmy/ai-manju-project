export type CanvasPoint = {
  x: number;
  y: number;
};

export type CanvasSelectionRect = CanvasPoint & {
  width: number;
  height: number;
};

export type CanvasSelectableNode = CanvasPoint & {
  id: string;
  width: number;
  height: number;
};

export type CanvasSelectableEdge = {
  id: string;
  from: string;
  to: string;
};

export type CanvasNodeOrigins = Record<string, CanvasPoint>;

export function normalizeCanvasSelectionRect(start: CanvasPoint, end: CanvasPoint): CanvasSelectionRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function toggleCanvasNodeSelection(current: Iterable<string>, nodeId: string, additive: boolean) {
  if (!additive) return new Set([nodeId]);

  const next = new Set(current);
  if (next.has(nodeId)) next.delete(nodeId);
  else next.add(nodeId);
  return next;
}

export function shouldSuppressCanvasNodeClickAfterPointerSelection(current: Iterable<string>, nodeId: string, additive: boolean) {
  if (additive) return true;
  const selected = new Set(current);
  return selected.has(nodeId) && selected.size > 1;
}

export function canvasNodesInSelectionRect<T extends CanvasSelectableNode>(nodes: readonly T[], rect: CanvasSelectionRect) {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  return nodes
    .filter((node) => (
      rect.x < node.x + node.width
      && right > node.x
      && rect.y < node.y + node.height
      && bottom > node.y
    ))
    .map((node) => node.id);
}

export function captureCanvasNodeOrigins<T extends CanvasSelectableNode>(nodes: readonly T[], selectedIds: ReadonlySet<string>) {
  return Object.fromEntries(
    nodes
      .filter((node) => selectedIds.has(node.id))
      .map((node) => [node.id, { x: node.x, y: node.y }]),
  ) as CanvasNodeOrigins;
}

export function moveCanvasNodesFromOrigins<T extends CanvasSelectableNode>(
  nodes: readonly T[],
  origins: CanvasNodeOrigins,
  deltaX: number,
  deltaY: number,
) {
  return nodes.map((node) => {
    const origin = origins[node.id];
    if (!origin) return node;
    return {
      ...node,
      x: Math.round(origin.x + deltaX),
      y: Math.round(origin.y + deltaY),
    };
  });
}

export function deleteCanvasNodesAndEdges<TNode extends { id: string }, TEdge extends CanvasSelectableEdge>(
  nodes: readonly TNode[],
  edges: readonly TEdge[],
  selectedIds: Iterable<string>,
) {
  const deleteIds = new Set(selectedIds);
  return {
    nodes: nodes.filter((node) => !deleteIds.has(node.id)),
    edges: edges.filter((edge) => !deleteIds.has(edge.from) && !deleteIds.has(edge.to)),
  };
}
