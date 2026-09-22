import { describe, expect, it } from "vitest";
import { inspectorLayout, inspectorSizeLimits, resizeInspector, savedInspectorHeight } from "./inspectorSize";

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
  it.each([{ width: 56, height: 0 }, { width: 0, height: 30 }, { width: 100, height: -30 }])("changes corner dimensions independently: %o", delta => {
    const next = resizeInspector(start, delta, "both", limits);
    expect(next.width).toBe(start.width + delta.width);
    expect(next.height).toBe(start.height + delta.height);
  });
  it("clamps each dimension independently without the old 720px width cap", () => {
    expect(resizeInspector(start, { width: 2000, height: 30 }, "both", limits)).toEqual({ width: limits.maxWidth, height: 330 });
    expect(resizeInspector(start, { width: 240, height: -2000 }, "both", limits)).toEqual({ width: 800, height: limits.minHeight });
  });
  it("fits small viewports and rejects invalid saved heights", () => {
    expect(inspectorSizeLimits(320, 120)).toEqual({ minWidth: 296, maxWidth: 296, minHeight: 100, maxHeight: 100 });
    for (const value of [undefined, "300", NaN, Infinity, -1, 0]) expect(savedInspectorHeight(value)).toBeUndefined();
    expect(savedInspectorHeight(450)).toBe(450);
  });
});

describe("inspector placement", () => {
  const viewport = { left: 12, top: 60, right: 1428, bottom: 988 };
  const overlaps = (panel: ReturnType<typeof inspectorLayout>, node: typeof viewport) =>
    panel.left < node.right && panel.left + panel.width > node.left && panel.top < node.bottom && panel.top + panel.height > node.top;

  it.each([
    { left: 450, top: 100, right: 770, bottom: 280 },
    { left: 100, top: 100, right: 500, bottom: 950 },
    { left: 900, top: 100, right: 1400, bottom: 950 },
    { left: 300, top: 650, right: 1000, bottom: 950 },
  ])("uses free space around the node and clamps oversized saved panels: %o", node => {
    const panel = inspectorLayout(node, viewport, { width: 2000, height: 2000 });
    expect(overlaps(panel, node)).toBe(false);
    expect(panel.left).toBeGreaterThanOrEqual(viewport.left);
    expect(panel.top).toBeGreaterThanOrEqual(viewport.top);
    expect(panel.left + panel.width).toBeLessThanOrEqual(viewport.right);
    expect(panel.top + panel.height).toBeLessThanOrEqual(viewport.bottom);
  });

  it.each([340, 560, 900])("centers a below panel at its actual width %s", width => {
    const node = { left: 450, top: 100, right: 770, bottom: 280 };
    const initial = inspectorLayout(node, viewport);
    const next = inspectorLayout(node, viewport, { width, height: initial.height + 80 });
    expect(next.left + next.width / 2).toBe((node.left + node.right) / 2);
    expect(next.top).toBe(initial.top);
    expect(next.width).toBe(width);
    expect(next.height).toBe(initial.height + 80);
  });

  it.each([
    { left: 60, right: 380, direction: 1 },
    { left: 1060, right: 1380, direction: -1 },
  ])("clamps near the viewport edge and recenters when narrowed: %o", ({ left, right, direction }) => {
    const node = { left, right, top: 100, bottom: 280 };
    const narrow = inspectorLayout(node, viewport, { width: 340 });
    const wide = inspectorLayout(node, viewport, { width: 900 });
    expect(narrow.left + narrow.width / 2).toBe((left + right) / 2);
    expect(wide.resizeX).toBe(direction);
    expect(direction > 0 ? wide.left : wide.left + wide.width).toBe(direction > 0 ? viewport.left : viewport.right);
    expect(wide.maxWidth).toBe(viewport.right - viewport.left);
    expect(inspectorLayout(node, viewport, { width: narrow.width })).toEqual(narrow);
  });

  it.each([340, 720, 1100])("centers an above panel at its actual width %s", width => {
    const node = { left: 200, top: 650, right: 1300, bottom: 950 };
    const panel = inspectorLayout(node, viewport, { width });
    expect(panel.left + panel.width / 2).toBe((node.left + node.right) / 2);
    expect(node.top - panel.top - panel.height).toBe(12);
  });

  it("prefers a shorter panel below over a full-height panel beside the node", () => {
    const node = { left: 100, top: 100, right: 500, bottom: 710 };
    const panel = inspectorLayout(node, viewport, { width: 600, height: 500 });
    expect(panel.top).toBe(node.bottom + 12);
    expect(panel.height).toBe(266);
    expect(panel.top + panel.height).toBe(viewport.bottom);
  });

  it("keeps controls reachable when no separate region fits", () => {
    const panel = inspectorLayout(viewport, viewport);
    expect(panel.top + panel.height).toBeLessThanOrEqual(viewport.bottom);
    expect(panel.left + panel.width).toBeLessThanOrEqual(viewport.right);
  });

  it.each([340, 560, 820])("keeps a left-side panel adjacent to a right-edge node at width %s", width => {
    const node = { left: 1000, top: 500, right: 1400, bottom: 950 };
    const panel = inspectorLayout(node, viewport, { width, height: 400 });
    expect(node.left - panel.left - panel.width).toBe(12);
    expect(panel.width).toBe(width);
    expect(panel.resizeX).toBe(-1);
    expect(overlaps(panel, node)).toBe(false);
  });

  it.each([240, 400])("keeps an above panel adjacent to its node at height %s", height => {
    const node = { left: 200, top: 650, right: 1300, bottom: 950 };
    const panel = inspectorLayout(node, viewport, { height });
    expect(node.top - panel.top - panel.height).toBe(12);
    expect(panel.resizeY).toBe(-1);
    expect(overlaps(panel, node)).toBe(false);
  });
});
