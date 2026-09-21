import type { CanvasNodeData } from "./types";
import { clamp } from "./value";

/** Node-frame bounds in canvas coordinates, independent of viewport zoom. */
export const CANVAS_NODE_RESIZE_BOUNDS = { minWidth: 220, minHeight: 120, maxWidth: 960, maxHeight: 720 } as const;
/** Media frames can grow beyond the initial fitting box; limit the long edge symmetrically. */
export const CANVAS_MEDIA_NODE_MAX_EDGE = 3840;

export function canvasNodeResizeAspect(node: CanvasNodeData): number | null {
  if (node.kind !== "image" && node.kind !== "video") return null;
  const { naturalWidth, naturalHeight } = node.metadata || {};
  if (typeof naturalWidth === "number" && Number.isFinite(naturalWidth) && naturalWidth > 0
    && typeof naturalHeight === "number" && Number.isFinite(naturalHeight) && naturalHeight > 0) {
    return naturalWidth / naturalHeight;
  }
  return node.width / node.height;
}

export function resizeCanvasNodeFrame(
  initial: { width: number; height: number; aspect: number | null },
  deltaX: number,
  deltaY: number,
) {
  if (deltaX === 0 && deltaY === 0) return { width: initial.width, height: initial.height };
  const bounds = CANVAS_NODE_RESIZE_BOUNDS;
  const width = initial.width + deltaX;
  const height = initial.height + deltaY;
  const aspect = initial.aspect;
  if (aspect == null) {
    return {
      width: Math.round(clamp(width, bounds.minWidth, bounds.maxWidth)),
      height: Math.round(clamp(height, bounds.minHeight, bounds.maxHeight)),
    };
  }
  // Project the pointer onto the aspect diagonal; horizontal and vertical drags both work.
  const projectedHeight = (width * aspect + height) / (aspect * aspect + 1);
  // Fit both limit boxes uniformly. A narrow side may be smaller than the minimum box.
  const minHeight = Math.min(bounds.minHeight, bounds.minWidth / aspect, initial.height, initial.width / aspect);
  const maxHeight = Math.min(CANVAS_MEDIA_NODE_MAX_EDGE, CANVAS_MEDIA_NODE_MAX_EDGE / aspect);
  const nextHeight = clamp(projectedHeight, Math.min(minHeight, maxHeight), maxHeight);
  return { width: nextHeight * aspect, height: nextHeight };
}
