import { describe, expect, it } from "vitest";

import { canvasMaskBrushSize, canvasMaskPoint, canvasMaskStageStyle, CANVAS_MASK_STAGE_MAX_HEIGHT_VAR } from "./mask";

describe("canvas mask", () => {
  it("maps rendered pointer coordinates into image pixels", () => {
    expect(canvasMaskPoint(150, 100, { left: 50, top: 25, width: 200, height: 150 }, 1000, 600)).toEqual({
      x: 500,
      y: 300,
    });
  });

  it("clamps pointer coordinates and brush sizes to the image", () => {
    expect(canvasMaskPoint(-50, 500, { left: 0, top: 0, width: 200, height: 100 }, 800, 400)).toEqual({ x: 0, y: 400 });
    expect(canvasMaskBrushSize(Number.NaN, 1000, 500)).toBe(36);
    expect(canvasMaskBrushSize(9999, 1000, 500)).toBe(250);
  });

  it("keeps the stage box from stretching a portrait image", () => {
    expect(canvasMaskStageStyle(768, 1024)).toEqual({
      aspectRatio: "768 / 1024",
      width: `min(100%, calc(var(${CANVAS_MASK_STAGE_MAX_HEIGHT_VAR}) * 768 / 1024))`,
    });
  });
});
