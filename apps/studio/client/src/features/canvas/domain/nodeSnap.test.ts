import { describe, expect, it } from "vitest";

import {
  CANVAS_NODE_DOCK_GAP,
  alignmentGuidesBetween,
  canvasNodeAlignmentThreshold,
  canvasNodeAlignmentSnapThreshold,
  canvasNodeDockThreshold,
  snapMovingBoxesToDock,
  type CanvasNodeSnapBox,
} from "./nodeSnap";

function box(id: string, x: number, y: number, width = 100, height = 80): CanvasNodeSnapBox {
  return { id, x, y, width, height };
}

describe("canvas node dock snap", () => {
  it("docks a box to the left of a sibling and shows top/center/bottom guides", () => {
    const targetX = 300;
    const dockX = targetX - 100 - CANVAS_NODE_DOCK_GAP;
    const result = snapMovingBoxesToDock(
      [box("a", dockX + 6, 4)],
      [box("b", targetX, 0)],
      24,
    );
    expect(result.deltaX).toBe(-6);
    expect(result.deltaY).toBe(-4);
    expect(result.guides).toEqual([
      { axis: "y", position: 0, start: dockX, end: 400 },
      { axis: "y", position: 40, start: dockX, end: 400 },
      { axis: "y", position: 80, start: dockX, end: 400 },
    ]);
  });

  it("docks a box below a sibling and left-aligns with a vertical guide", () => {
    const result = snapMovingBoxesToDock(
      [box("a", 2, 80 + CANVAS_NODE_DOCK_GAP + 5, 100, 80)],
      [box("b", 0, 0, 120, 80)],
      24,
    );
    expect(result.deltaX).toBe(-2);
    expect(result.deltaY).toBe(-5);
    expect(result.guides).toEqual([
      { axis: "x", position: 0, start: 0, end: 80 + CANVAS_NODE_DOCK_GAP + 80 },
    ]);
  });

  it("does not dock when farther than the threshold", () => {
    expect(snapMovingBoxesToDock([box("a", 0, 0)], [box("b", 300, 200)], 22)).toEqual({
      deltaX: 0,
      deltaY: 0,
      guides: [],
    });
  });

  it("triggers docking within the 24px screen range", () => {
    const targetX = 300;
    const dockX = targetX - 100 - CANVAS_NODE_DOCK_GAP;
    const result = snapMovingBoxesToDock(
      [box("a", dockX + 24, 0)],
      [box("b", targetX, 0)],
      canvasNodeDockThreshold(100),
    );
    expect(result.deltaX).toBe(-24);
    expect(result.guides).toHaveLength(3);
    const outside = snapMovingBoxesToDock(
      [box("a", dockX + 25, 0)],
      [box("b", targetX, 0)],
      canvasNodeDockThreshold(100),
      canvasNodeAlignmentThreshold(100),
    );
    expect(outside.deltaX).toBe(0);
    expect(outside.guides).toHaveLength(3);
  });

  it("shows alignment guides up to 200px without moving the node", () => {
    const targetX = 300;
    const dockX = targetX - 100 - CANVAS_NODE_DOCK_GAP;
    const result = snapMovingBoxesToDock(
      [box("a", dockX + 324, 100)],
      [box("b", targetX, 0)],
      canvasNodeDockThreshold(100),
      canvasNodeAlignmentThreshold(100),
    );
    expect(result.deltaX).toBe(0);
    expect(result.deltaY).toBe(0);
    expect(result.guides).toEqual([
      { axis: "y", position: 0, start: 300, end: 600 },
      { axis: "y", position: 40, start: 300, end: 600 },
      { axis: "y", position: 80, start: 300, end: 600 },
    ]);
  });

  it("corrects a near alignment without changing the other axis", () => {
    const target = box("b", 300, 0);
    const result = snapMovingBoxesToDock(
      [box("a", 500, 8)],
      [target],
      canvasNodeDockThreshold(100),
      canvasNodeAlignmentThreshold(100),
      canvasNodeAlignmentSnapThreshold(100),
    );
    expect(result.deltaX).toBe(0);
    expect(result.deltaY).toBe(-8);
    expect(result.guides).toEqual([
      { axis: "y", position: 0, start: 300, end: 600 },
      { axis: "y", position: 40, start: 300, end: 600 },
      { axis: "y", position: 80, start: 300, end: 600 },
    ]);
  });

  it("scales the dock threshold with canvas zoom", () => {
    expect(canvasNodeDockThreshold(100)).toBe(24);
    expect(canvasNodeDockThreshold(50)).toBe(48);
    expect(canvasNodeAlignmentThreshold(100)).toBe(200);
    expect(canvasNodeAlignmentThreshold(50)).toBe(400);
    expect(canvasNodeAlignmentSnapThreshold(100)).toBe(12);
    expect(canvasNodeAlignmentSnapThreshold(50)).toBe(24);
  });

  it("shows only the center guide when heights differ and mids align", () => {
    const placed = box("a", 124, 20, 100, 80);
    const target = box("b", 0, 0, 100, 120);
    expect(alignmentGuidesBetween(placed, target)).toEqual([
      { axis: "y", position: 60, start: 0, end: 224 },
    ]);
  });
});
