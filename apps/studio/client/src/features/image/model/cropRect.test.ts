import { describe, expect, it } from "vitest";

import { cropRectForAspectRatio } from "./cropRect";

describe("cropRectForAspectRatio", () => {
  it("fits a 16:9 box inside a landscape image and keeps it centered", () => {
    const rect = cropRectForAspectRatio(16 / 9, 16 / 9);
    expect(rect.width / rect.height).toBeCloseTo(1);
    expect(rect.x + rect.width / 2).toBeCloseTo(0.5);
    expect(rect.y + rect.height / 2).toBeCloseTo(0.5);
    expect(rect.width).toBeCloseTo(0.92);
    expect(rect.height).toBeCloseTo(0.92);
  });

  it("fits a square box inside a 3:2 image without leaving the frame", () => {
    const rect = cropRectForAspectRatio(3 / 2, 1);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(1);
    expect(rect.y + rect.height).toBeLessThanOrEqual(1);
    expect((rect.width * 3) / (rect.height * 2)).toBeCloseTo(1);
  });

  it("falls back to a 1:1 source aspect when the image size is invalid", () => {
    const rect = cropRectForAspectRatio(Number.NaN, 1);
    expect(rect.width).toBeCloseTo(0.92);
    expect(rect.height).toBeCloseTo(0.92);
    expect(rect.x).toBeCloseTo(0.04);
    expect(rect.y).toBeCloseTo(0.04);
  });
});
