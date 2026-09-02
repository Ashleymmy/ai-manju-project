import { describe, expect, it } from "vitest";

import {
  canvasNodesInSelectionRect,
  captureCanvasNodeOrigins,
  deleteCanvasNodesAndEdges,
  moveCanvasNodesFromOrigins,
  normalizeCanvasSelectionRect,
  shouldSuppressCanvasNodeClickAfterPointerSelection,
  toggleCanvasNodeSelection,
} from "./selection";

const nodes = [
  { id: "a", x: 10, y: 10, width: 40, height: 30 },
  { id: "b", x: 80, y: 20, width: 40, height: 40 },
  { id: "c", x: 180, y: 120, width: 30, height: 30 },
];

describe("canvas selection", () => {
  it("normalizes reverse drag rectangles and selects intersecting nodes", () => {
    const rect = normalizeCanvasSelectionRect({ x: 130, y: 70 }, { x: 30, y: 0 });

    expect(rect).toEqual({ x: 30, y: 0, width: 100, height: 70 });
    expect(canvasNodesInSelectionRect(nodes, rect)).toEqual(["a", "b"]);
  });

  it("matches production strict intersection and ignores edge-touching boxes", () => {
    expect(canvasNodesInSelectionRect(nodes, { x: 50, y: 10, width: 30, height: 30 })).toEqual([]);
    expect(canvasNodesInSelectionRect(nodes, { x: 49, y: 10, width: 31, height: 30 })).toEqual(["a"]);
  });

  it("replaces selection normally and toggles it with an additive modifier", () => {
    expect([...toggleCanvasNodeSelection(["a", "b"], "c", false)]).toEqual(["c"]);
    expect([...toggleCanvasNodeSelection(["a", "b"], "b", true)]).toEqual(["a"]);
    expect([...toggleCanvasNodeSelection(["a"], "c", true)]).toEqual(["a", "c"]);
  });

  it("suppresses the follow-up click after additive pointer selection", () => {
    expect(shouldSuppressCanvasNodeClickAfterPointerSelection(["a"], "b", true)).toBe(true);
    expect(shouldSuppressCanvasNodeClickAfterPointerSelection(["a", "b"], "b", true)).toBe(true);
  });

  it("suppresses the follow-up click when dragging an already multi-selected node", () => {
    expect(shouldSuppressCanvasNodeClickAfterPointerSelection(["a", "b"], "b", false)).toBe(true);
  });

  it("does not suppress ordinary single-node pointer selection", () => {
    expect(shouldSuppressCanvasNodeClickAfterPointerSelection([], "a", false)).toBe(false);
    expect(shouldSuppressCanvasNodeClickAfterPointerSelection(["a"], "a", false)).toBe(false);
    expect(shouldSuppressCanvasNodeClickAfterPointerSelection(["a"], "b", false)).toBe(false);
  });

  it("moves every selected node from its captured drag origin", () => {
    const origins = captureCanvasNodeOrigins(nodes, new Set(["a", "c"]));
    const moved = moveCanvasNodesFromOrigins(nodes, origins, 15.4, -4.6);

    expect(moved).toEqual([
      { id: "a", x: 25, y: 5, width: 40, height: 30 },
      nodes[1],
      { id: "c", x: 195, y: 115, width: 30, height: 30 },
    ]);
  });

  it("deletes selected nodes and every edge connected to them", () => {
    const edges = [
      { id: "a-b", from: "a", to: "b" },
      { id: "b-c", from: "b", to: "c" },
      { id: "external", from: "x", to: "y" },
    ];

    expect(deleteCanvasNodesAndEdges(nodes, edges, ["a", "c"])).toEqual({
      nodes: [nodes[1]],
      edges: [edges[2]],
    });
  });
});
