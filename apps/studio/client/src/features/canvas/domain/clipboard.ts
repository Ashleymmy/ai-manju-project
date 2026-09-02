export type CanvasClipboardNode = {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  metadata?: Record<string, unknown>;
};

export type CanvasClipboardEdge = {
  id: string;
  from: string;
  to: string;
};

export type CanvasClipboardPayload<TNode extends CanvasClipboardNode, TEdge extends CanvasClipboardEdge> = {
  projectKey: string;
  nodes: TNode[];
  edges: TEdge[];
};

export function createCanvasClipboard<TNode extends CanvasClipboardNode, TEdge extends CanvasClipboardEdge>(
  nodes: readonly TNode[],
  edges: readonly TEdge[],
  selectedIds: Iterable<string>,
  projectKey: string,
): CanvasClipboardPayload<TNode, TEdge> | null {
  if (!projectKey) return null;
  const selected = new Set(selectedIds);
  const copiedNodes = nodes.filter((node) => selected.has(node.id)).map((node) => structuredClone(node));
  if (!copiedNodes.length) return null;

  return {
    projectKey,
    nodes: copiedNodes,
    edges: edges
      .filter((edge) => selected.has(edge.from) && selected.has(edge.to))
      .map((edge) => structuredClone(edge)),
  };
}

export function pasteCanvasClipboard<TNode extends CanvasClipboardNode, TEdge extends CanvasClipboardEdge>(
  clipboard: CanvasClipboardPayload<TNode, TEdge> | null,
  projectKey: string,
  center: { x: number; y: number },
  createId: () => string,
) {
  if (!clipboard?.nodes.length || !projectKey || clipboard.projectKey !== projectKey) return null;

  const bounds = clipboard.nodes.reduce((current, node) => ({
    left: Math.min(current.left, node.x),
    top: Math.min(current.top, node.y),
    right: Math.max(current.right, node.x + node.width),
    bottom: Math.max(current.bottom, node.y + node.height),
  }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
  const offsetX = center.x - (bounds.left + bounds.right) / 2;
  const offsetY = center.y - (bounds.top + bounds.bottom) / 2;
  const idMap = new Map<string, string>();
  clipboard.nodes.forEach((source) => idMap.set(source.id, createId()));

  const nodes = clipboard.nodes.map((source) => {
    const node = structuredClone(source);
    const id = idMap.get(source.id)!;
    return {
      ...node,
      id,
      title: node.title.endsWith(" 副本") ? node.title : `${node.title} 副本`,
      x: Math.round(node.x + offsetX),
      y: Math.round(node.y + offsetY),
      metadata: remapCanvasClipboardMetadata(node.metadata, idMap),
    };
  });

  const edges = clipboard.edges.flatMap((source) => {
    const from = idMap.get(source.from);
    const to = idMap.get(source.to);
    if (!from || !to) return [];
    return [{ ...structuredClone(source), id: `${from}:${to}`, from, to }];
  });

  return { nodes, edges, idMap };
}

function remapCanvasClipboardMetadata(metadata: Record<string, unknown> | undefined, idMap: ReadonlyMap<string, string>) {
  if (!metadata) return metadata;
  const next = structuredClone(metadata);
  for (const key of ["sourceNodeId", "batchRootId", "primaryImageId"]) {
    const value = next[key];
    if (typeof value !== "string") continue;
    const mapped = idMap.get(value);
    if (mapped) next[key] = mapped;
    else delete next[key];
  }
  if (Array.isArray(next.batchChildIds)) {
    next.batchChildIds = next.batchChildIds
      .map((value) => typeof value === "string" ? idMap.get(value) : undefined)
      .filter((value): value is string => Boolean(value));
  }
  return next;
}
