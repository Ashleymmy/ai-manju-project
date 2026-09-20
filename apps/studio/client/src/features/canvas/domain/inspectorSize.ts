/** Inspector dimensions are screen pixels, independent of the canvas zoom. */
export const INSPECTOR_SIZE = {
  minWidth: 340,
  defaultWidth: 560,
  maxWidth: 720,
  minHeight: 140,
  minEditorHeight: 40,
  viewportMargin: 12,
  topMargin: 8,
} as const;

export type InspectorResizeMode = "width" | "height" | "proportional";
export type InspectorSize = { width: number; height: number };
export type InspectorSizeLimits = {
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
};

export function inspectorSizeLimits(viewportWidth: number, viewportHeight: number): InspectorSizeLimits {
  const maxWidth = Math.max(1, Math.min(INSPECTOR_SIZE.maxWidth, viewportWidth - INSPECTOR_SIZE.viewportMargin * 2));
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
  if (mode === "proportional") {
    // Use the dominant pointer direction and clamp one shared scale to preserve the ratio at the edges.
    const dx = delta.width / start.width;
    const dy = delta.height / start.height;
    const minScale = Math.max(limits.minWidth / start.width, limits.minHeight / start.height);
    const maxScale = Math.min(limits.maxWidth / start.width, limits.maxHeight / start.height);
    const scale = clamp(1 + (Math.abs(dx) >= Math.abs(dy) ? dx : dy), Math.min(minScale, maxScale), maxScale);
    return { width: start.width * scale, height: start.height * scale };
  }
  return {
    width: mode === "width" ? clamp(start.width + delta.width, limits.minWidth, limits.maxWidth) : start.width,
    height: mode === "height" ? clamp(start.height + delta.height, limits.minHeight, limits.maxHeight) : start.height,
  };
}
