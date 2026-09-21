import { describe, expect, it } from "vitest";
import { CANVAS_MEDIA_NODE_MAX_EDGE, canvasNodeResizeAspect, resizeCanvasNodeFrame } from "./nodeResize";
import { applyCanvasImageNaturalSize } from "./nodeUtils";
import type { CanvasNodeData } from "./types";

describe("media node proportional resizing", () => {
  it.each([16 / 9, 9 / 16, 1, 20, 1 / 20])("locks aspect %s for every drag direction and boundary", aspect => {
    const initial = { width: 320, height: 320 / aspect, aspect };
    for (const [dx, dy] of [[100, 0], [0, 100], [-50, 0], [0, -50], [120, -60], [10000, 10000], [-10000, -10000]]) {
      const size = resizeCanvasNodeFrame(initial, dx, dy);
      expect(size.width / size.height).toBeCloseTo(aspect, 8);
      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);
      expect(size.width).toBeLessThanOrEqual(CANVAS_MEDIA_NODE_MAX_EDGE);
      expect(size.height).toBeLessThanOrEqual(CANVAS_MEDIA_NODE_MAX_EDGE);
    }
  });

  it("uses a single scale for outward and inward drags", () => {
    const initial = { width: 320, height: 180, aspect: 16 / 9 };
    for (const [dx, dy] of [[100, 0], [0, 100]]) {
      expect(resizeCanvasNodeFrame(initial, dx, dy).width).toBeGreaterThan(320);
      expect(resizeCanvasNodeFrame(initial, -dx, -dy).width).toBeLessThan(320);
    }
    expect(resizeCanvasNodeFrame(initial, 160, 90)).toEqual({ width: 480, height: 270 });
    expect(resizeCanvasNodeFrame(initial, 0, 0)).toEqual({ width: 320, height: 180 });
  });

  it.each(["image", "video"] as const)("uses source aspect for %s, falling back to its frame", kind => {
    const node = { kind, width: 500, height: 300, metadata: { naturalWidth: 1080, naturalHeight: 1920 } } as CanvasNodeData;
    expect(canvasNodeResizeAspect(node)).toBe(9 / 16);
    expect(canvasNodeResizeAspect({ ...node, metadata: {} })).toBe(5 / 3);
    expect(canvasNodeResizeAspect({ ...node, metadata: { naturalWidth: NaN, naturalHeight: 0 } })).toBe(5 / 3);
  });

  it("keeps non-media nodes freely resizable", () => {
    expect(canvasNodeResizeAspect({ kind: "text", width: 300, height: 200 } as CanvasNodeData)).toBeNull();
    expect(resizeCanvasNodeFrame({ width: 300, height: 200, aspect: null }, 90, -50)).toEqual({ width: 390, height: 150 });
    expect(resizeCanvasNodeFrame({ width: 300, height: 200, aspect: null }, 10000, 10000)).toEqual({ width: 960, height: 720 });
  });

  it.each([[1920, 1080, 960, 540], [1080, 1920, 405, 720], [1080, 1080, 720, 720]])(
    "enlarges %s:%s video beyond its initial fitting limits without resetting on metadata reload",
    (naturalWidth, naturalHeight, width, height) => {
      const node = { kind: "video", width, height, metadata: { naturalWidth, naturalHeight, size: "1280x720" } } as CanvasNodeData;
      const aspect = canvasNodeResizeAspect(node);
      const enlarged = { ...node, ...resizeCanvasNodeFrame({ width, height, aspect }, width / 2, height / 2) };
      expect(enlarged.width).toBeCloseTo(width * 1.5, 8);
      expect(enlarged.height).toBeCloseTo(height * 1.5, 8);
      expect(enlarged.width / enlarged.height).toBeCloseTo(naturalWidth / naturalHeight, 8);
      expect(applyCanvasImageNaturalSize(enlarged, naturalWidth, naturalHeight)).toBe(enlarged);
      expect(enlarged.metadata).toEqual(node.metadata);
      const restored = JSON.parse(JSON.stringify(enlarged));
      expect(applyCanvasImageNaturalSize(restored, naturalWidth, naturalHeight)).toBe(restored);
    },
  );
});
