import { describe, expect, it } from "vitest";
import { CANVAS_CROP_RATIOS } from "./imageTool";
import { cropRectForAspectRatio } from "@/features/image/model/cropRect";

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

  it.each(CANVAS_CROP_RATIOS.filter(preset => preset.ratio !== null))("keeps $label through all resize handles and image boundaries", ({ ratio }) => {
    for (const box of [{ width: 1600, height: 900 }, { width: 900, height: 1600 }, { width: 1024, height: 1024 }]) {
      const crop = cropRectForAspectRatio(box.width / box.height, ratio!);
      for (const handle of ["n", "e", "s", "w", "ne", "nw", "se", "sw"] as const) {
        for (const delta of [-2, -0.1, 0.1, 2]) {
          const resized = resizeImageCropRect(crop, delta, -delta, handle, true, box, ratio!);
          expect(resized.width * box.width / (resized.height * box.height)).toBeCloseTo(ratio!, 8);
          expect(resized.x).toBeGreaterThanOrEqual(-Number.EPSILON);
          expect(resized.y).toBeGreaterThanOrEqual(-Number.EPSILON);
          expect(resized.x + resized.width).toBeLessThanOrEqual(1 + Number.EPSILON);
          expect(resized.y + resized.height).toBeLessThanOrEqual(1 + Number.EPSILON);
          expect(resized.width).toBeGreaterThan(0);
          expect(resized.height).toBeGreaterThan(0);
        }
      }
    }
  });

  it("shrinks a locked box from a single side without forcing its old height or a square", () => {
    const crop = { x: 0.1, y: 0.1, width: 0.8, height: 0.45 };
    const result = resizeImageCropRect(crop, -0.2, 0, "e", true, { width: 1000, height: 1000 }, 16 / 9);
    expect(result.width).toBeCloseTo(0.6);
    expect(result.height).toBeCloseTo(0.3375);
    expect(result.x).toBe(crop.x);
    expect(result.y).toBe(crop.y);
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
