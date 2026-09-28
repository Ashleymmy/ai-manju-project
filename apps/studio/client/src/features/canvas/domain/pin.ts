import type { CanvasNodeData } from "./types";
import { stringValue } from "./value";

/** Two warm-to-cool rows with related hues aligned vertically and neutrals last. */
export const CANVAS_PIN_COLORS = [
  "#E9513E",
  "#F5C14A",
  "#4ADE80",
  "#38BDF8",
  "#A78BFA",
  "#E8E4DC",
  "#FB923C",
  "#A3E635",
  "#2DD4BF",
  "#3B82F6",
  "#F472B6",
  "#94A3B8",
] as const;

export type CanvasPinColor = (typeof CANVAS_PIN_COLORS)[number];

export type CanvasPinnedMarker = {
  nodeIds: string[];
  title: string;
  color: CanvasPinColor;
};

export function normalizeCanvasPinColor(value: unknown): CanvasPinColor | "" {
  const color = stringValue(value).toUpperCase();
  return CANVAS_PIN_COLORS.find((item) => item.toUpperCase() === color) || "";
}

/** One left-rail marker per color; later nodes of the same color join that marker. */
export function canvasPinnedNodes(nodes: readonly CanvasNodeData[]): CanvasPinnedMarker[] {
  const markers: CanvasPinnedMarker[] = [];
  const indexByColor = new Map<CanvasPinColor, number>();
  for (const node of nodes) {
    const color = normalizeCanvasPinColor(node.metadata?.pinColor);
    if (!color) continue;
    const existingIndex = indexByColor.get(color);
    if (existingIndex != null) {
      markers[existingIndex].nodeIds.push(node.id);
      continue;
    }
    indexByColor.set(color, markers.length);
    markers.push({
      nodeIds: [node.id],
      title: stringValue(node.title) || "未命名节点",
      color,
    });
  }
  return markers;
}
