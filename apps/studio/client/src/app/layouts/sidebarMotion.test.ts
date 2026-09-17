import { describe, expect, it } from "vitest";
import { nextSidebarEffect } from "./sidebarMotion";

describe("sidebar animation bounds", () => {
  it("never reverses easing when the first frame predates a pointer event", () => {
    // The old clock reset produced a negative delta, amplifying hover values instead of easing.
    expect(nextSidebarEffect(1, 0, -50)).toBe(1);
    expect(nextSidebarEffect(0, 1, -50)).toBe(0);
  });

  it("converges after stalls and rapid direction changes without hiding labels", () => {
    let value = 0;
    for (const elapsed of [-20, 0, 16, 2_000, -60, 16, 8, 50]) {
      for (const target of [1, 0, 0.7]) {
        value = nextSidebarEffect(value, target, elapsed);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
    for (let frame = 0; frame < 100; frame++) value = nextSidebarEffect(value, 0, 16);
    expect(value).toBe(0);
  });

  it.each([NaN, Infinity, -Infinity, -10, 10])("recovers from an invalid prior effect %s", value => {
    const result = nextSidebarEffect(value, 1, 16);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});
