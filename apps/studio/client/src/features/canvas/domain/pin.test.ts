import { describe, expect, it } from "vitest";

import { canvasPinnedNodes, CANVAS_PIN_COLORS, normalizeCanvasPinColor } from "./pin";
import type { CanvasNodeData } from "./types";

describe("canvas pin markers", () => {
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
