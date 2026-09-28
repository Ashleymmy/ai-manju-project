import { describe, expect, it } from "vitest";

import { canvasPinnedNodes, CANVAS_PIN_COLORS, normalizeCanvasPinColor } from "./pin";
import type { CanvasNodeData } from "./types";

describe("canvas pin markers", () => {
  it("preserves all twelve distinct, valid marker colors when reordering the palette", () => {
    expect(CANVAS_PIN_COLORS).toHaveLength(12);
    expect(new Set(CANVAS_PIN_COLORS).size).toBe(12);
    expect(CANVAS_PIN_COLORS).toEqual(expect.arrayContaining([
      "#E9513E", "#F5C14A", "#4ADE80", "#38BDF8", "#A78BFA", "#F472B6", "#FB923C", "#E8E4DC",
      "#2DD4BF", "#3B82F6", "#A3E635", "#94A3B8",
    ]));
    for (const color of CANVAS_PIN_COLORS) {
      expect(normalizeCanvasPinColor(color.toLowerCase())).toBe(color);
    }
    const nodes = CANVAS_PIN_COLORS.map((color, index) => node(`pin-${index}`, `Pin ${index}`, color));
    expect(canvasPinnedNodes(nodes).map(marker => marker.color)).toEqual(CANVAS_PIN_COLORS);
    expect(canvasPinnedNodes([...nodes, node("same-color", "Same color", CANVAS_PIN_COLORS[11])])[11].nodeIds)
      .toEqual(["pin-11", "same-color"]);
  });

  it("aligns related hues vertically in two rainbow-ordered rows, with neutrals last", () => {
    expect(CANVAS_PIN_COLORS.slice(0, 6)).toEqual([
      "#E9513E", "#F5C14A", "#4ADE80", "#38BDF8", "#A78BFA", "#E8E4DC",
    ]);
    expect(CANVAS_PIN_COLORS.slice(6)).toEqual([
      "#FB923C", "#A3E635", "#2DD4BF", "#3B82F6", "#F472B6", "#94A3B8",
    ]);
  });

  it("accepts only the published pin palette", () => {
    expect(normalizeCanvasPinColor("#e9513e")).toBe("#E9513E");
    expect(normalizeCanvasPinColor("#ffffff")).toBe("");
    expect(normalizeCanvasPinColor("")).toBe("");
  });

  it("collects one rail marker per pin color", () => {
    const nodes = [
      node("a", "角色", CANVAS_PIN_COLORS[0]),
      node("b", "场景", ""),
      node("c", "道具", CANVAS_PIN_COLORS[3]),
      node("d", "角色副本", CANVAS_PIN_COLORS[0]),
    ];
    expect(canvasPinnedNodes(nodes)).toEqual([
      { nodeIds: ["a", "d"], title: "角色", color: CANVAS_PIN_COLORS[0] },
      { nodeIds: ["c"], title: "道具", color: CANVAS_PIN_COLORS[3] },
    ]);
  });
});

function node(id: string, title: string, pinColor: string): CanvasNodeData {
  return {
    id,
    kind: "image",
    title,
    content: "",
    x: 0,
    y: 0,
    width: 120,
    height: 80,
    metadata: pinColor ? { pinColor } : {},
  };
}
