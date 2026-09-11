import { describe, expect, it } from "vitest";

import {
  CANVAS_ANNOTATION_COLORS,
  CANVAS_ANNOTATION_DEFAULT_COLOR,
  CANVAS_ANNOTATION_UNDO_SHORTCUTS,
  canvasAnnotationBounds,
  canvasAnnotationFontSize,
  canvasAnnotationTextOriginFromDrag,
  canvasAnnotationTextSelectionBounds,
  canvasAnnotationTextWidth,
  canvasArrowGeometry,
  canvasArrowOutlinePath,
  canvasTextEditorOverlay,
  cloneCanvasAnnotations,
  shouldKeepCanvasTextEditor,
  isCanvasAnnotationNativeUndoTarget,
  isCanvasAnnotationUndoShortcut,
  isMeaningfulCanvasAnnotation,
  translateCanvasAnnotation,
  type CanvasImageAnnotation,
} from "./annotation";

describe("canvas annotation", () => {
  it("defaults the color palette to WeChat red", () => {
    expect(CANVAS_ANNOTATION_DEFAULT_COLOR).toBe("#FA5151");
    expect(CANVAS_ANNOTATION_COLORS[0]).toBe(CANVAS_ANNOTATION_DEFAULT_COLOR);
  });

  it("treats Ctrl+Z as the annotation undo shortcut", () => {
    expect(CANVAS_ANNOTATION_UNDO_SHORTCUTS).toEqual(["Ctrl+Z", "Meta+Z"]);
    expect(isCanvasAnnotationUndoShortcut({ key: "z", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })).toBe(true);
    expect(isCanvasAnnotationUndoShortcut({ key: "z", ctrlKey: false, metaKey: true, shiftKey: false, altKey: false })).toBe(true);
    expect(isCanvasAnnotationUndoShortcut({ key: "z", ctrlKey: true, metaKey: false, shiftKey: true, altKey: false })).toBe(false);
    expect(isCanvasAnnotationUndoShortcut({ key: "y", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })).toBe(false);
  });

  it("only treats text inputs as native undo targets so the stroke slider still undoes marks", () => {
    expect(isCanvasAnnotationNativeUndoTarget({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(isCanvasAnnotationNativeUndoTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isCanvasAnnotationNativeUndoTarget({ tagName: "INPUT", type: "range" })).toBe(false);
    expect(isCanvasAnnotationNativeUndoTarget({ tagName: "INPUT", type: "color" })).toBe(false);
    expect(isCanvasAnnotationNativeUndoTarget({ tagName: "BUTTON" })).toBe(false);
  });

  it("builds a single filled arrow silhouette that is longer than it is wide", () => {
    const arrow = canvasArrowGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 8);
    const headLength = arrow.tip.x - arrow.neck.x;
    const headWidth = Math.abs(arrow.left.y - arrow.right.y);
    expect(arrow.neck.x).toBeGreaterThan(50);
    expect(headLength).toBeGreaterThan(headWidth);
    expect(headWidth).toBeGreaterThan(8 * 2.4);
    const path = canvasArrowOutlinePath(arrow);
    expect(path.startsWith("M")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
    expect(path).toContain(`L${arrow.tip.x},${arrow.tip.y}`);
  });

  it("scales on-image text editors from image space to stage pixels", () => {
    expect(canvasAnnotationFontSize(8)).toBe(32);
    expect(canvasAnnotationTextWidth("11", 20)).toBe(20 * 2 * 0.62);
    expect(canvasAnnotationTextWidth("水果摊", 20)).toBe(60);
    expect(canvasTextEditorOverlay(
      { x: 100, y: 80, fontSize: 20, text: "11" },
      { width: 200, height: 100 },
      { width: 400, height: 200 },
    )).toEqual({
      left: 200,
      top: 120,
      fontSize: 40,
      width: 20 * 2 * 0.62 * 2,
      height: 20 * 1.25 * 2,
    });
  });

  it("detects meaningful shapes, brush strokes and text", () => {
    expect(isMeaningfulCanvasAnnotation({ id: "r", type: "rect", color: "#fff", strokeWidth: 4, start: { x: 1, y: 1 }, end: { x: 1, y: 1 } })).toBe(false);
    expect(isMeaningfulCanvasAnnotation({ id: "a", type: "arrow", color: "#fff", strokeWidth: 4, start: { x: 1, y: 1 }, end: { x: 20, y: 20 } })).toBe(true);
    expect(isMeaningfulCanvasAnnotation({ id: "b", type: "brush", color: "#fff", strokeWidth: 4, points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] })).toBe(true);
    expect(isMeaningfulCanvasAnnotation({ id: "t", type: "text", color: "#fff", strokeWidth: 4, x: 4, y: 20, text: "  ", fontSize: 16 })).toBe(false);
  });

  it("calculates annotation bounds with stroke padding", () => {
    expect(canvasAnnotationBounds({ id: "r", type: "rect", color: "#fff", strokeWidth: 4, start: { x: 10, y: 20 }, end: { x: 50, y: 80 } })).toEqual({ x: 8, y: 18, width: 44, height: 64 });
  });

  it("places dragged text at the box origin and click-sized drags at the press point", () => {
    expect(canvasAnnotationTextOriginFromDrag({ x: 10, y: 20 }, { x: 10.5, y: 20.2 }, 16)).toEqual({ x: 10, y: 20 });
    expect(canvasAnnotationTextOriginFromDrag({ x: 80, y: 40 }, { x: 10, y: 90 }, 16)).toEqual({ x: 10, y: 56 });
  });

  it("reuses a nearby create text editor so a double-click does not commit an empty box", () => {
    expect(shouldKeepCanvasTextEditor({ mode: "create", x: 40, y: 80 }, { x: 42, y: 81 })).toBe(true);
    expect(shouldKeepCanvasTextEditor({ mode: "create", x: 40, y: 80 }, { x: 80, y: 80 })).toBe(false);
    expect(shouldKeepCanvasTextEditor({ mode: "edit", x: 40, y: 80 }, { x: 41, y: 80 })).toBe(false);
    expect(shouldKeepCanvasTextEditor(null, { x: 40, y: 80 })).toBe(false);
  });

  it("pads text selection bounds around glyph ink so the box covers every character", () => {
    expect(canvasAnnotationTextSelectionBounds({ x: 10, y: 20, width: 48, height: 16 }, 20)).toEqual({
      x: 7.6,
      y: 17.6,
      width: 52.8,
      height: 20.8,
    });
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
