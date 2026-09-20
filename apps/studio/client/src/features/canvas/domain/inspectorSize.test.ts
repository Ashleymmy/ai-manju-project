import { describe, expect, it } from "vitest";
import { inspectorSizeLimits, resizeInspector, savedInspectorHeight } from "./inspectorSize";

const limits = inspectorSizeLimits(1200, 800);
const start = { width: 560, height: 300 };
describe("inspector resizing", () => {
  it("allows widening past the previous 560px cap without changing height", () => {
    expect(resizeInspector(start, { width: 100, height: 200 }, "width", limits)).toEqual({ width: 660, height: 300 });
  });
  it("changes height independently and clamps shrinking to usable dimensions", () => {
    expect(resizeInspector(start, { width: 80, height: 150 }, "height", limits)).toEqual({ width: 560, height: 450 });
    expect(resizeInspector(start, { width: 0, height: -1000 }, "height", limits).height).toBe(limits.minHeight);
  });
  it.each([{ width: 56, height: 0 }, { width: 0, height: 30 }])("scales both dimensions from either pointer direction: %o", delta => {
    const next = resizeInspector(start, delta, "proportional", limits);
    expect(next.width).toBeCloseTo(616);
    expect(next.height).toBeCloseTo(330);
  });
  it("preserves the ratio when either dimension hits a bound", () => {
    for (const delta of [-2000, 2000]) {
      const next = resizeInspector(start, { width: delta, height: delta }, "proportional", limits);
      expect(next.width / next.height).toBeCloseTo(start.width / start.height);
      expect(next.width).toBeGreaterThanOrEqual(limits.minWidth);
      expect(next.width).toBeLessThanOrEqual(limits.maxWidth);
      expect(next.height).toBeGreaterThanOrEqual(limits.minHeight);
      expect(next.height).toBeLessThanOrEqual(limits.maxHeight);
    }
  });
  it("fits small viewports and rejects invalid saved heights", () => {
    expect(inspectorSizeLimits(320, 120)).toEqual({ minWidth: 296, maxWidth: 296, minHeight: 100, maxHeight: 100 });
    for (const value of [undefined, "300", NaN, Infinity, -1, 0]) expect(savedInspectorHeight(value)).toBeUndefined();
    expect(savedInspectorHeight(450)).toBe(450);
  });
});
