import { describe, expect, it } from "vitest";

import {
  captureCanvasHistoryEntry,
  commitCanvasHistory,
  fitCanvasViewport,
  panCanvasViewport,
  redoCanvasHistory,
  undoCanvasHistory,
  zoomCanvasViewportAtPoint,
} from "./history";

describe("canvas history", () => {
  it("captures only graph state and deep clones it", () => {
    const nodes = [{ id: "a", metadata: { prompt: "before" } }];
    const entry = captureCanvasHistoryEntry(nodes, [{ id: "a-b" }]);

    nodes[0].metadata.prompt = "after";
    expect(entry).toEqual({ nodes: [{ id: "a", metadata: { prompt: "before" } }], edges: [{ id: "a-b" }] });
    expect(entry).not.toHaveProperty("viewport");
    expect(entry).not.toHaveProperty("selectedId");
  });

  it("commits, undoes, and redoes bounded history", () => {
    const first = { nodes: ["first"], edges: [] as string[] };
    const second = { nodes: ["second"], edges: [] as string[] };
    const third = { nodes: ["third"], edges: [] as string[] };
    const committed = commitCanvasHistory({ past: [], future: [third] }, first, 2);
    const undone = undoCanvasHistory(committed, second)!;
    const redone = redoCanvasHistory(undone.stack, undone.entry)!;

    expect(committed).toEqual({ past: [first], future: [] });
    expect(undone).toEqual({ entry: first, stack: { past: [], future: [second] } });
    expect(redone).toEqual({ entry: second, stack: { past: [first], future: [] } });
  });

  it("keeps only the newest entries at the configured limit", () => {
    const stack = commitCanvasHistory({ past: ["one", "two"], future: ["redo"] }, "three", 2);

    expect(stack).toEqual({ past: ["two", "three"], future: [] });
  });
});

describe("canvas viewport", () => {
  it("pans by wheel deltas and zooms around the pointer", () => {
    expect(panCanvasViewport({ zoom: 100, panX: 20, panY: 30 }, 5, -10)).toEqual({ zoom: 100, panX: 15, panY: 40 });
    expect(zoomCanvasViewportAtPoint({ zoom: 100, panX: 0, panY: 0 }, { x: 100, y: 80 }, 200)).toEqual({
      zoom: 200,
      panX: -100,
      panY: -80,
    });
  });

  it("clamps every pointer zoom to the supported range", () => {
    expect(zoomCanvasViewportAtPoint({ zoom: 100, panX: 0, panY: 0 }, { x: 0, y: 0 }, 1).zoom).toBe(5);
    expect(zoomCanvasViewportAtPoint({ zoom: 100, panX: 0, panY: 0 }, { x: 0, y: 0 }, 900).zoom).toBe(500);
  });

  it("fits graph bounds into the stage and centers an empty canvas", () => {
    expect(fitCanvasViewport([], { width: 800, height: 652 }, 52)).toEqual({ zoom: 100, panX: 400, panY: 300 });
    expect(fitCanvasViewport([
      { x: 100, y: 50, width: 200, height: 100 },
      { x: 500, y: 250, width: 100, height: 100 },
    ], { width: 800, height: 652 }, 52, 100)).toEqual({ zoom: 120, panX: -20, panY: 60 });
  });
});
