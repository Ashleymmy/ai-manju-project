import { CANVAS_ZOOM_MIN, type CanvasViewport } from "./history";

/** Inspector dimensions are screen pixels, independent of the canvas zoom. */
export const INSPECTOR_SIZE = {
  minWidth: 340,
  defaultWidth: 560,
  defaultMaxWidth: 720,
  nodeWidthExtra: 200,
  defaultHeight: 320,
  minHeight: 240,
  minEditorHeight: 40,
  viewportMargin: 12,
  topMargin: 8,
  nodeGap: 12,
  // Leave room for the node title and rounding when reframing a crowded viewport.
  nodeTitleSpace: 28,
  fitSafety: 2,
} as const;

export type InspectorResizeMode = "width" | "height" | "both";
export type InspectorSize = { width: number; height: number };
export type InspectorSizeLimits = {
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
};

export function inspectorSizeLimits(viewportWidth: number, viewportHeight: number): InspectorSizeLimits {
  const maxWidth = Math.max(1, viewportWidth - INSPECTOR_SIZE.viewportMargin * 2);
  const maxHeight = Math.max(1, viewportHeight - INSPECTOR_SIZE.topMargin - INSPECTOR_SIZE.viewportMargin);
  return {
    minWidth: Math.min(INSPECTOR_SIZE.minWidth, maxWidth), maxWidth,
    minHeight: Math.min(INSPECTOR_SIZE.minHeight, maxHeight), maxHeight,
  };
}

export function savedInspectorHeight(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function resizeInspector(start: InspectorSize, delta: InspectorSize, mode: InspectorResizeMode, limits: InspectorSizeLimits): InspectorSize {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  return {
    width: mode !== "height" ? clamp(start.width + delta.width, limits.minWidth, limits.maxWidth) : start.width,
    height: mode !== "width" ? clamp(start.height + delta.height, limits.minHeight, limits.maxHeight) : start.height,
  };
}

type InspectorRect = { left: number; top: number; right: number; bottom: number };

/** Pick a free region independently of text length or saved dimensions.
 * Center above/below the node; side panels keep their nearest edge anchored. */
export function inspectorLayout(node: InspectorRect, viewport: InspectorRect, saved: Partial<InspectorSize> = {}) {
  const { nodeGap, nodeWidthExtra, defaultWidth, defaultMaxWidth, defaultHeight, minWidth, minHeight } = INSPECTOR_SIZE;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const viewportWidth = Math.max(1, viewport.right - viewport.left);
  const viewportHeight = Math.max(1, viewport.bottom - viewport.top);
  const preferredWidth = Math.min(viewportWidth, defaultMaxWidth, Math.max(defaultWidth, node.right - node.left + nodeWidthExtra));
  const preferredHeight = Math.min(viewportHeight, defaultHeight);
  const areas = [
    { ...viewport, top: Math.max(viewport.top, node.bottom + nodeGap), side: "below" },
    { ...viewport, left: Math.max(viewport.left, node.right + nodeGap), side: "right" },
    { ...viewport, right: Math.min(viewport.right, node.left - nodeGap), side: "left" },
    { ...viewport, bottom: Math.min(viewport.bottom, node.top - nodeGap), side: "above" },
  ];
  const fits = (area: InspectorRect, width: number, height: number) => area.right - area.left >= width && area.bottom - area.top >= height;
  // Prefer the space below even when it needs a shorter scrolling editor.
  const minimumWidth = Math.min(minWidth, viewportWidth);
  const minimumHeight = Math.min(minHeight, viewportHeight / 2);
  const area = (fits(areas[0], minimumWidth, minimumHeight) ? areas[0] : undefined)
    ?? areas.find(candidate => fits(candidate, preferredWidth, preferredHeight))
    ?? areas.find(candidate => fits(candidate, minimumWidth, minimumHeight));
  // Never fall back to covering the node. The caller makes room in the viewport first.
  if (!area) return null;
  const areaWidth = Math.max(1, area.right - area.left);
  const areaHeight = Math.max(1, area.bottom - area.top);
  const centered = area.side === "below" || area.side === "above";
  const center = (node.left + node.right) / 2;
  const top = area.side === "right" || area.side === "left"
    ? clamp(node.top, area.top, area.bottom - Math.min(preferredHeight, areaHeight))
    : area.top;
  const maxWidth = areaWidth;
  const maxHeight = area.side === "above" ? areaHeight : area.bottom - top;
  const width = clamp(saved.width || preferredWidth, Math.min(minWidth, maxWidth), maxWidth);
  const height = clamp(saved.height || preferredHeight, Math.min(minHeight, maxHeight), maxHeight);
  const left = centered ? clamp(center - width / 2, area.left, area.right - width)
    : area.side === "left" ? area.right - width : area.left;
  // Put the handle on the roomier side, so it can keep moving after the opposite edge hits the viewport.
  const resizeX = area.side === "left" || (centered && center > (area.left + area.right) / 2) ? -1 : 1;
  const resizeEdge = resizeX < 0 ? left : left + width;
  const resizeLeftCenterDistance = centered ? center - left : undefined;
  const resizeRightCenterDistance = centered ? left + width - center : undefined;
  const resizeLeftBoundaryDistance = centered ? area.right - left : undefined;
  const resizeRightBoundaryDistance = centered ? left + width - area.left : undefined;
  return {
    left,
    top: area.side === "above" ? area.bottom - height : top,
    width, height, maxWidth, maxHeight,
    resizeX,
    resizeY: area.side === "above" ? -1 : 1,
    // Distances in panel screen pixels also let the drag calculation invert viewport clamping.
    resizeCenterDistance: centered ? resizeX * (resizeEdge - center) : undefined,
    resizeBoundaryDistance: centered ? resizeX * (resizeEdge - (resizeX < 0 ? area.right : area.left)) : undefined,
    resizeLeftCenterDistance,
    resizeRightCenterDistance,
    resizeLeftBoundaryDistance,
    resizeRightBoundaryDistance,
  };
}

/** Reframe only when no usable region exists. Node data and saved editor sizes stay intact. */
export function inspectorViewportForNode(
  node: { x: number; y: number; width: number; height: number },
  viewport: InspectorRect,
  current: CanvasViewport,
  stageOffset: number,
): CanvasViewport {
  const width = Math.max(1, viewport.right - viewport.left);
  const height = Math.max(1, viewport.bottom - viewport.top);
  const panelHeight = Math.min(INSPECTOR_SIZE.minHeight, height / 2);
  const nodeBottom = viewport.bottom - panelHeight - INSPECTOR_SIZE.nodeGap - INSPECTOR_SIZE.fitSafety;
  const nodeHeight = Math.max(1, nodeBottom - viewport.top - INSPECTOR_SIZE.nodeTitleSpace);
  const zoom = Math.max(CANVAS_ZOOM_MIN, Math.floor(Math.min(current.zoom,
    width / Math.max(1, node.width) * 100, nodeHeight / Math.max(1, node.height) * 100)));
  const scale = zoom / 100;
  const left = Math.max(viewport.left, Math.min(viewport.right - node.width * scale, current.panX + node.x * scale));
  return { zoom, panX: left - node.x * scale, panY: nodeBottom - (node.y + node.height) * scale - stageOffset };
}
