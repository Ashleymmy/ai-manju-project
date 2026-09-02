import { describe, expect, it } from "vitest";

import { buildCanvasMinimapModel, canvasMinimapWorldPoint } from "./minimap";

describe("canvas minimap", () => {
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
