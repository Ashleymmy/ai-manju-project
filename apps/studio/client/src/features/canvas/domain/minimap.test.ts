import { describe, expect, it } from "vitest";

import { buildCanvasMinimapModel, canvasMinimapViewportInFrame, canvasMinimapWorldPoint } from "./minimap";

describe("canvas minimap", () => {
  it("leaves navigation room around a compact scene without changing the world viewport", () => {
    const nodes = [{ id: "node", x: 300, y: 250, width: 200, height: 100 }];
    const stage = { width: 800, height: 600 };
    const panel = { width: 184, height: 122 };
    const first = buildCanvasMinimapModel(nodes, { zoom: 100, panX: 0, panY: 0 }, stage, panel);
    expect(first.viewport.width).toBeLessThanOrEqual(panel.width / 2);
    expect(first.viewport.height).toBeLessThanOrEqual(panel.height / 2);
    expect(canvasMinimapWorldPoint(first, first.viewport).x).toBeCloseTo(0);
    const next = buildCanvasMinimapModel(nodes, { zoom: 100, panX: 100, panY: 50 }, stage, panel);
    expect(next.world).toEqual(first.world);
    expect(next.nodes).toEqual(first.nodes);
  });

  it("projects the live viewport into a frozen frame after panning beyond the scene", () => {
    const nodes = [{ id: "node", x: 100, y: 120, width: 200, height: 160 }];
    const stage = { width: 900, height: 600 };
    const panel = { width: 184, height: 122 };
    const original = buildCanvasMinimapModel(nodes, { zoom: 80, panX: 0, panY: 0 }, stage, panel);
    const moved = buildCanvasMinimapModel(nodes, { zoom: 80, panX: -4000, panY: 2000 }, stage, panel);
    const projected = canvasMinimapViewportInFrame(moved, original);
    const point = canvasMinimapWorldPoint(original, projected);
    expect(point.x).toBeCloseTo(5000);
    expect(point.y).toBeCloseTo(-2500);
    expect(projected.width).toBeCloseTo(original.viewport.width);
    expect(projected.height).toBeCloseTo(original.viewport.height);
  });

  it("keeps an empty canvas navigable with finite bounds", () => {
    const model = buildCanvasMinimapModel([], { zoom: 5, panX: -800, panY: 700 }, { width: 800, height: 600 }, { width: 184, height: 122 });
    expect(Object.values(model.world).every(Number.isFinite)).toBe(true);
    expect(model.viewport.width).toBeGreaterThan(0);
    expect(model.nodes).toEqual([]);
  });

  it("keeps the viewport center accurate even with extremely distant nodes", () => {
    const nodes = [{ id: "far", x: 1e8, y: -1e8, width: 200, height: 100 }];
    const stage = { width: 800, height: 600 };
    const panel = { width: 184, height: 122 };
    const model = buildCanvasMinimapModel(nodes, { zoom: 100, panX: -40, panY: 80 }, stage, panel);
    const center = canvasMinimapWorldPoint(model, {
      x: model.viewport.x + model.viewport.width / 2,
      y: model.viewport.y + model.viewport.height / 2,
    });
    expect(center.x).toBeCloseTo(440);
    expect(center.y).toBeCloseTo(220);
    expect(model.nodes[0].width).toBe(1);
    const moved = buildCanvasMinimapModel(nodes, { zoom: 100, panX: -200, panY: 50 }, stage, panel);
    const projected = canvasMinimapViewportInFrame(moved, model);
    expect(projected.width).toBeCloseTo(model.viewport.width, 10);
  });
  it("includes both distant nodes and the current viewport in its world bounds", () => {
    const model = buildCanvasMinimapModel(
      [{ id: "far", x: 1200, y: 800, width: 300, height: 220 }],
      { zoom: 100, panX: 0, panY: 0 },
      { width: 800, height: 600 },
      { width: 180, height: 120 },
    );

    expect(model.world.x).toBeLessThan(0);
    expect(model.world.y).toBeLessThan(0);
    expect(model.world.x + model.world.width).toBeGreaterThan(1500);
    expect(model.world.y + model.world.height).toBeGreaterThan(1020);
    expect(model.nodes[0].width).toBeGreaterThan(0);
    expect(model.viewport.width).toBeGreaterThan(0);
  });

  it("maps minimap coordinates back into world coordinates", () => {
    const model = buildCanvasMinimapModel(
      [{ id: "node", x: 100, y: 120, width: 200, height: 160 }],
      { zoom: 80, panX: -40, panY: -20 },
      { width: 900, height: 600 },
      { width: 180, height: 120 },
    );
    const point = canvasMinimapWorldPoint(model, {
      x: model.viewport.x + model.viewport.width / 2,
      y: model.viewport.y + model.viewport.height / 2,
    });

    expect(point.x).toBeCloseTo(612.5, 4);
    expect(point.y).toBeCloseTo(400, 4);
  });
});
