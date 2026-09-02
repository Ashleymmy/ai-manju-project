import { describe, expect, it } from "vitest";

import {
  canvasAnnotationBounds,
  cloneCanvasAnnotations,
  isMeaningfulCanvasAnnotation,
  translateCanvasAnnotation,
  type CanvasImageAnnotation,
} from "./annotation";

describe("canvas annotation", () => {
  it("detects meaningful shapes, brush strokes and text", () => {
    expect(isMeaningfulCanvasAnnotation({ id: "r", type: "rect", color: "#fff", strokeWidth: 4, start: { x: 1, y: 1 }, end: { x: 1, y: 1 } })).toBe(false);
    expect(isMeaningfulCanvasAnnotation({ id: "a", type: "arrow", color: "#fff", strokeWidth: 4, start: { x: 1, y: 1 }, end: { x: 20, y: 20 } })).toBe(true);
    expect(isMeaningfulCanvasAnnotation({ id: "b", type: "brush", color: "#fff", strokeWidth: 4, points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] })).toBe(true);
    expect(isMeaningfulCanvasAnnotation({ id: "t", type: "text", color: "#fff", strokeWidth: 4, x: 4, y: 20, text: "  ", fontSize: 16 })).toBe(false);
  });

  it("calculates annotation bounds with stroke padding", () => {
    expect(canvasAnnotationBounds({ id: "r", type: "rect", color: "#fff", strokeWidth: 4, start: { x: 10, y: 20 }, end: { x: 50, y: 80 } })).toEqual({ x: 8, y: 18, width: 44, height: 64 });
  });

  it("translates marks while keeping them inside the image", () => {
    const moved = translateCanvasAnnotation(
      { id: "r", type: "rect", color: "#fff", strokeWidth: 4, start: { x: 10, y: 10 }, end: { x: 40, y: 40 } },
      -50,
      200,
      { width: 100, height: 100 },
    );
    expect(canvasAnnotationBounds(moved).x).toBe(0);
    expect(canvasAnnotationBounds(moved).y + canvasAnnotationBounds(moved).height).toBe(100);
  });

  it("deep clones brush points", () => {
    const source: CanvasImageAnnotation[] = [{ id: "b", type: "brush", color: "#fff", strokeWidth: 4, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }];
    const cloned = cloneCanvasAnnotations(source);
    expect(cloned).toEqual(source);
    expect(cloned[0]).not.toBe(source[0]);
    if (cloned[0].type === "brush" && source[0].type === "brush") expect(cloned[0].points[0]).not.toBe(source[0].points[0]);
  });
});
