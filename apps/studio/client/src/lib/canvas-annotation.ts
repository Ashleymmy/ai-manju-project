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

export async function exportCanvasAnnotations(dataUrl: string, marks: readonly CanvasImageAnnotation[]) {
  const image = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, image.naturalWidth || image.width);
  canvas.height = Math.max(1, image.naturalHeight || image.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法合成标注图片");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  marks.forEach((mark) => drawCanvasAnnotation(context, mark));
  return canvas.toDataURL("image/png");
}

function drawCanvasAnnotation(context: CanvasRenderingContext2D, mark: CanvasImageAnnotation) {
  context.save();
  context.strokeStyle = mark.color;
  context.fillStyle = mark.color;
  context.lineWidth = mark.strokeWidth;
  context.lineCap = "round";
  context.lineJoin = "round";
  if (mark.type === "rect") {
    context.strokeRect(mark.start.x, mark.start.y, mark.end.x - mark.start.x, mark.end.y - mark.start.y);
  } else if (mark.type === "ellipse") {
    const centerX = (mark.start.x + mark.end.x) / 2;
    const centerY = (mark.start.y + mark.end.y) / 2;
    context.beginPath();
    context.ellipse(centerX, centerY, Math.abs(mark.end.x - mark.start.x) / 2, Math.abs(mark.end.y - mark.start.y) / 2, 0, 0, Math.PI * 2);
    context.stroke();
  } else if (mark.type === "arrow") {
    drawArrow(context, mark.start, mark.end, mark.strokeWidth);
  } else if (mark.type === "brush") {
    context.beginPath();
    mark.points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
    context.stroke();
  } else if (mark.type === "text") {
    context.font = `600 ${mark.fontSize}px sans-serif`;
    context.textBaseline = "alphabetic";
    context.fillText(mark.text, mark.x, mark.y);
  }
  context.restore();
}

function drawArrow(context: CanvasRenderingContext2D, start: CanvasAnnotationPoint, end: CanvasAnnotationPoint, strokeWidth: number) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const head = Math.max(12, strokeWidth * 3.2);
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
  context.beginPath();
  context.moveTo(end.x, end.y);
  context.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6));
  context.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6));
  context.closePath();
  context.fill();
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("标注原图读取失败"));
    image.src = source;
  });
}

function distance(a: CanvasAnnotationPoint, b: CanvasAnnotationPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value: number, min: number, max: number) {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}
