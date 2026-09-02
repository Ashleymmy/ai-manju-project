export type CanvasHistoryEntry<TNode, TEdge> = {
  nodes: TNode[];
  edges: TEdge[];
};

export type CanvasHistoryStack<TEntry> = {
  past: TEntry[];
  future: TEntry[];
};

export type CanvasViewport = {
  zoom: number;
  panX: number;
  panY: number;
};

// 所有画布入口共用同一缩放边界，避免交互与 Agent 操作产生不同视口。
export const CANVAS_ZOOM_MIN = 5;
export const CANVAS_ZOOM_MAX = 500;

export type CanvasViewportNode = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function captureCanvasHistoryEntry<TNode, TEdge>(nodes: readonly TNode[], edges: readonly TEdge[]) {
  return structuredClone({ nodes, edges }) as CanvasHistoryEntry<TNode, TEdge>;
}

export function commitCanvasHistory<TEntry>(stack: CanvasHistoryStack<TEntry>, previous: TEntry, limit = 50) {
  return {
    past: [...stack.past, previous].slice(-limit),
    future: [],
  } satisfies CanvasHistoryStack<TEntry>;
}

export function undoCanvasHistory<TEntry>(stack: CanvasHistoryStack<TEntry>, current: TEntry) {
  const previous = stack.past.at(-1);
  if (!previous) return null;
  return {
    entry: previous,
    stack: {
      past: stack.past.slice(0, -1),
      future: [...stack.future, current],
    } satisfies CanvasHistoryStack<TEntry>,
  };
}

export function redoCanvasHistory<TEntry>(stack: CanvasHistoryStack<TEntry>, current: TEntry) {
  const next = stack.future.at(-1);
  if (!next) return null;
  return {
    entry: next,
    stack: {
      past: [...stack.past, current],
      future: stack.future.slice(0, -1),
    } satisfies CanvasHistoryStack<TEntry>,
  };
}

export function panCanvasViewport(viewport: CanvasViewport, deltaX: number, deltaY: number): CanvasViewport {
  return {
    ...viewport,
    panX: viewport.panX - deltaX,
    panY: viewport.panY - deltaY,
  };
}

export function zoomCanvasViewportAtPoint(
  viewport: CanvasViewport,
  point: { x: number; y: number },
  nextZoom: number,
  minZoom = CANVAS_ZOOM_MIN,
  maxZoom = CANVAS_ZOOM_MAX,
): CanvasViewport {
  const oldScale = Math.max(0.0001, viewport.zoom / 100);
  const zoom = Math.min(Math.max(nextZoom, minZoom), maxZoom);
  const nextScale = zoom / 100;
  const worldX = (point.x - viewport.panX) / oldScale;
  const worldY = (point.y - viewport.panY) / oldScale;
  return {
    zoom,
    panX: point.x - worldX * nextScale,
    panY: point.y - worldY * nextScale,
  };
}

export function fitCanvasViewport(
  nodes: readonly CanvasViewportNode[],
  stage: { width: number; height: number },
  topOffset: number,
  padding = 64,
): CanvasViewport {
  const contentHeight = Math.max(1, stage.height - topOffset);
  if (!nodes.length) {
    return { zoom: 100, panX: stage.width / 2, panY: contentHeight / 2 };
  }

  const bounds = nodes.reduce((current, node) => ({
    left: Math.min(current.left, node.x),
    top: Math.min(current.top, node.y),
    right: Math.max(current.right, node.x + node.width),
    bottom: Math.max(current.bottom, node.y + node.height),
  }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
  const width = Math.max(1, bounds.right - bounds.left);
  const height = Math.max(1, bounds.bottom - bounds.top);
  const availableWidth = Math.max(1, stage.width - padding * 2);
  const availableHeight = Math.max(1, contentHeight - padding * 2);
  const scale = Math.min(Math.max(Math.min(availableWidth / width, availableHeight / height), 0.05), 5);

  return {
    zoom: Math.round(scale * 100),
    panX: (stage.width - width * scale) / 2 - bounds.left * scale,
    panY: (contentHeight - height * scale) / 2 - bounds.top * scale,
  };
}
