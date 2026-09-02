import { describe, expect, it } from "vitest";

import {
  MAX_UPSCALE_LONG_EDGE,
  canvasAnglePrompt,
  imageCropRectFromDraft,
  imageToolDraftFromCropRect,
  moveImageCropRect,
  resizeImageCropRect,
  resolveUpscaleSize,
} from "./imageData";

describe("canvas image data", () => {
  it("preserves landscape and portrait aspect ratios while targeting the long edge", () => {
    expect(resolveUpscaleSize(800, 400, 1600)).toEqual({ width: 1600, height: 800 });
    expect(resolveUpscaleSize(400, 800, 1600)).toEqual({ width: 800, height: 1600 });
  });

  it("caps oversized targets at the supported long-edge limit", () => {
    expect(resolveUpscaleSize(1920, 1080, 8192)).toEqual({
      width: MAX_UPSCALE_LONG_EDGE,
      height: 2304,
    });
  });

  it("keeps invalid or degenerate dimensions above the canvas minimum", () => {
    expect(resolveUpscaleSize(0, 0, 0)).toEqual({ width: 1, height: 1 });
    expect(resolveUpscaleSize(-200, 100, Number.NaN)).toEqual({ width: 1, height: 100 });
  });

  it("moves crop rectangles without leaving the source image", () => {
    expect(moveImageCropRect({ x: 0.1, y: 0.2, width: 0.5, height: 0.4 }, 0.7, -0.4)).toEqual({
      x: 0.5,
      y: 0,
      width: 0.5,
      height: 0.4,
    });
  });

  it("resizes crop rectangles from handles and enforces minimum bounds", () => {
    expect(resizeImageCropRect(
      { x: 0.2, y: 0.2, width: 0.5, height: 0.5 },
      -0.1,
      -0.1,
      "nw",
      false,
      { width: 800, height: 600 },
    )).toEqual({ x: 0.1, y: 0.1, width: 0.6, height: 0.6 });
    expect(resizeImageCropRect(
      { x: 0.2, y: 0.2, width: 0.1, height: 0.1 },
      0.2,
      0.2,
      "nw",
      false,
      { width: 800, height: 600 },
    )).toMatchObject({ width: 0.06, height: 0.06 });
  });

  it("locks the crop box to a square in rendered pixels", () => {
    const resized = resizeImageCropRect(
      { x: 0.1, y: 0.1, width: 0.4, height: 0.4 },
      0.1,
      0,
      "se",
      true,
      { width: 800, height: 400 },
    );
    expect(resized.width * 800).toBeCloseTo(resized.height * 400);
  });

  it("round trips crop percentages through the normalized crop rectangle", () => {
    const draft = {
      cropX: 12.34,
      cropY: 8.76,
      cropWidth: 70,
      cropHeight: 60,
    };

    expect(imageToolDraftFromCropRect(imageCropRectFromDraft(draft))).toEqual(
      draft,
    );
  });

  it("describes the selected camera angle without browser dependencies", () => {
    expect(
      canvasAnglePrompt({
        angleHorizontal: 90,
        anglePitch: 45,
        angleDistance: 4.8,
        angleLens: "telephoto",
      }),
    ).toContain("右侧俯视视角");
  });
});
