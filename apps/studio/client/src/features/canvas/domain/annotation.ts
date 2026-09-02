export type CanvasAnnotationTool = "select" | "rect" | "ellipse" | "arrow" | "brush" | "text";

export type CanvasAnnotationPoint = {
  x: number;
  y: number;
};

type CanvasAnnotationBase = {
  id: string;
  color: string;
  strokeWidth: number;
};

export type CanvasShapeAnnotation = CanvasAnnotationBase & {
  type: "rect" | "ellipse" | "arrow";
  start: CanvasAnnotationPoint;
  end: CanvasAnnotationPoint;
};

export type CanvasBrushAnnotation = CanvasAnnotationBase & {
  type: "brush";
  points: CanvasAnnotationPoint[];
};

export type CanvasTextAnnotation = CanvasAnnotationBase & {
  type: "text";
  x: number;
  y: number;
  text: string;
  fontSize: number;
};

export type CanvasImageAnnotation = CanvasShapeAnnotation | CanvasBrushAnnotation | CanvasTextAnnotation;

export type CanvasAnnotationBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export const CANVAS_ANNOTATION_COLORS = ["#ff4f8c", "#b84dff", "#ffb33d", "#35c8ff", "#6be35f", "#ff5367", "#f8f2ff", "#120d20"];

export function cloneCanvasAnnotations(marks: readonly CanvasImageAnnotation[]) {
  return marks.map((mark) => mark.type === "brush"
    ? { ...mark, points: mark.points.map((point) => ({ ...point })) }
    : mark.type === "text"
      ? { ...mark }
      : { ...mark, start: { ...mark.start }, end: { ...mark.end } });
}

export function canvasAnnotationBounds(mark: CanvasImageAnnotation): CanvasAnnotationBounds {
  if (mark.type === "text") {
    const width = Math.max(mark.fontSize, mark.text.length * mark.fontSize * 0.62);
    return { x: mark.x, y: mark.y - mark.fontSize, width, height: mark.fontSize * 1.25 };
  }
  const points = mark.type === "brush" ? mark.points : [mark.start, mark.end];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const padding = Math.max(1, mark.strokeWidth / 2);
  return {
    x: Math.min(...xs) - padding,
    y: Math.min(...ys) - padding,
    width: Math.max(0, Math.max(...xs) - Math.min(...xs)) + padding * 2,
    height: Math.max(0, Math.max(...ys) - Math.min(...ys)) + padding * 2,
  };
}

export function isMeaningfulCanvasAnnotation(mark: CanvasImageAnnotation) {
  if (mark.type === "text") return Boolean(mark.text.trim());
  if (mark.type === "brush") {
    if (mark.points.length < 2) return false;
    return mark.points.some((point, index) => index > 0 && distance(point, mark.points[index - 1]) >= 1);
  }
  return distance(mark.start, mark.end) >= 2;
}

export function translateCanvasAnnotation(
  mark: CanvasImageAnnotation,
  dx: number,
  dy: number,
  image: { width: number; height: number },
): CanvasImageAnnotation {
  const bounds = canvasAnnotationBounds(mark);
  const boundedDx = clamp(dx, -bounds.x, image.width - bounds.x - bounds.width);
  const boundedDy = clamp(dy, -bounds.y, image.height - bounds.y - bounds.height);
  if (mark.type === "text") return { ...mark, x: mark.x + boundedDx, y: mark.y + boundedDy };
  if (mark.type === "brush") {
    return { ...mark, points: mark.points.map((point) => ({ x: point.x + boundedDx, y: point.y + boundedDy })) };
  }
  return {
    ...mark,
    start: { x: mark.start.x + boundedDx, y: mark.start.y + boundedDy },
    end: { x: mark.end.x + boundedDx, y: mark.end.y + boundedDy },
  };
}

function distance(a: CanvasAnnotationPoint, b: CanvasAnnotationPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value: number, min: number, max: number) {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}
