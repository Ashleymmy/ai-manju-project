import { eventMatchesShortcut } from "./hotkeys";

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

/** 微信 WeUI 默认红（weui-RED），标注弹窗打开时的默认描边色 */
export const CANVAS_ANNOTATION_DEFAULT_COLOR = "#FA5151";

export const CANVAS_ANNOTATION_COLORS = [
  CANVAS_ANNOTATION_DEFAULT_COLOR,
  "#b84dff",
  "#ffb33d",
  "#35c8ff",
  "#6be35f",
  "#ff5367",
  "#f8f2ff",
  "#120d20",
];

/** 图片标注撤回：Ctrl+Z；macOS 同时认 Cmd+Z，避免快捷键落到画布撤销 */
export const CANVAS_ANNOTATION_UNDO_SHORTCUTS = ["Ctrl+Z", "Meta+Z"];

/** 文字标注字号随线宽变化，下限保证小图上仍可读 */
export const CANVAS_ANNOTATION_TEXT_MIN_FONT_SIZE = 14;
export const CANVAS_ANNOTATION_TEXT_FONT_SCALE = 4;
export const CANVAS_ANNOTATION_TEXT_MAX_LENGTH = 80;
/** 与命中盒共用的文字宽度估算；选中框以实际字形墨迹为准，再加这圈边距 */
export const CANVAS_ANNOTATION_TEXT_WIDTH_EM = 0.62;
export const CANVAS_ANNOTATION_TEXT_CJK_WIDTH_EM = 1;
export const CANVAS_ANNOTATION_TEXT_CARET_WIDTH_EM = 0.55;
export const CANVAS_ANNOTATION_TEXT_SELECTION_PAD_EM = 0.12;

export function isCanvasAnnotationUndoShortcut(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">,
) {
  return eventMatchesShortcut(event, CANVAS_ANNOTATION_UNDO_SHORTCUTS);
}

/** 仅文字输入框走浏览器原生撤销；线宽滑杆/取色器聚焦时仍应撤回标注。 */
export function isCanvasAnnotationNativeUndoTarget(target: unknown) {
  if (!target || typeof target !== "object") return false;
  const element = target as { tagName?: unknown; type?: unknown };
  const tag = typeof element.tagName === "string" ? element.tagName.toUpperCase() : "";
  if (tag === "TEXTAREA") return true;
  return tag === "INPUT" && (element.type === "text" || element.type === "search" || element.type === "password");
}

export type CanvasArrowGeometry = {
  tip: CanvasAnnotationPoint;
  left: CanvasAnnotationPoint;
  right: CanvasAnnotationPoint;
  neck: CanvasAnnotationPoint;
  startLeft: CanvasAnnotationPoint;
  startRight: CanvasAnnotationPoint;
  neckLeft: CanvasAnnotationPoint;
  neckRight: CanvasAnnotationPoint;
  tail: CanvasAnnotationPoint;
};

/** 箭头头部长度不超过线段的这一比例，短箭头仍留一点杆 */
const CANVAS_ARROW_HEAD_LENGTH_RATIO = 0.36;
/** 头部全宽不超过线段的这一比例，避免画成扁平三角 */
const CANVAS_ARROW_HEAD_WIDTH_RATIO = 0.28;
/** 头部长度按线宽放大，细长箭头比「杆 + 小三角」更接近截图标注 */
const CANVAS_ARROW_HEAD_LENGTH_STROKE = 6.5;
const CANVAS_ARROW_HEAD_WIDTH_STROKE = 3.1;
const CANVAS_ARROW_HEAD_MIN_LENGTH = 26;
const CANVAS_ARROW_HEAD_MIN_WIDTH = 14;

/** 整支实心箭头轮廓：杆与头连成一块，预览 SVG 与导出 canvas 共用。 */
export function canvasArrowGeometry(
  start: CanvasAnnotationPoint,
  end: CanvasAnnotationPoint,
  strokeWidth: number,
): CanvasArrowGeometry {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;
  const half = strokeWidth / 2;
  const headLength = Math.min(
    length * CANVAS_ARROW_HEAD_LENGTH_RATIO,
    Math.max(CANVAS_ARROW_HEAD_MIN_LENGTH, strokeWidth * CANVAS_ARROW_HEAD_LENGTH_STROKE),
  );
  const headWidth = Math.min(
    length * CANVAS_ARROW_HEAD_WIDTH_RATIO,
    Math.max(CANVAS_ARROW_HEAD_MIN_WIDTH, strokeWidth * CANVAS_ARROW_HEAD_WIDTH_STROKE),
  );
  const tip = { x: end.x, y: end.y };
  const neck = {
    x: tip.x - ux * headLength,
    y: tip.y - uy * headLength,
  };
  const left = {
    x: neck.x + nx * (headWidth / 2),
    y: neck.y + ny * (headWidth / 2),
  };
  const right = {
    x: neck.x - nx * (headWidth / 2),
    y: neck.y - ny * (headWidth / 2),
  };
  return {
    tip,
    left,
    right,
    neck,
    startLeft: { x: start.x + nx * half, y: start.y + ny * half },
    startRight: { x: start.x - nx * half, y: start.y - ny * half },
    neckLeft: { x: neck.x + nx * half, y: neck.y + ny * half },
    neckRight: { x: neck.x - nx * half, y: neck.y - ny * half },
    tail: { x: start.x - ux * half, y: start.y - uy * half },
  };
}

export function canvasArrowOutlinePath(geometry: CanvasArrowGeometry) {
  const { startLeft, neckLeft, left, tip, right, neckRight, startRight, tail } = geometry;
  return [
    `M${fmtArrow(startLeft.x)},${fmtArrow(startLeft.y)}`,
    `L${fmtArrow(neckLeft.x)},${fmtArrow(neckLeft.y)}`,
    `L${fmtArrow(left.x)},${fmtArrow(left.y)}`,
    `L${fmtArrow(tip.x)},${fmtArrow(tip.y)}`,
    `L${fmtArrow(right.x)},${fmtArrow(right.y)}`,
    `L${fmtArrow(neckRight.x)},${fmtArrow(neckRight.y)}`,
    `L${fmtArrow(startRight.x)},${fmtArrow(startRight.y)}`,
    `Q${fmtArrow(tail.x)},${fmtArrow(tail.y)} ${fmtArrow(startLeft.x)},${fmtArrow(startLeft.y)}`,
    "Z",
  ].join("");
}

function fmtArrow(value: number) {
  return Number(value.toFixed(2));
}

export function cloneCanvasAnnotations(marks: readonly CanvasImageAnnotation[]) {
  return marks.map((mark) => mark.type === "brush"
    ? { ...mark, points: mark.points.map((point) => ({ ...point })) }
    : mark.type === "text"
      ? { ...mark }
      : { ...mark, start: { ...mark.start }, end: { ...mark.end } });
}

export function canvasAnnotationFontSize(strokeWidth: number) {
  return Math.max(CANVAS_ANNOTATION_TEXT_MIN_FONT_SIZE, strokeWidth * CANVAS_ANNOTATION_TEXT_FONT_SCALE);
}

/** 文字工具拖动画出区域后，输入落在框的左上；几乎未拖动则落在按下点（基线）。 */
export function canvasAnnotationTextOriginFromDrag(
  start: CanvasAnnotationPoint,
  end: CanvasAnnotationPoint,
  fontSize: number,
): CanvasAnnotationPoint {
  if (distance(start, end) < 2) return { x: start.x, y: start.y };
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y) + fontSize,
  };
}

/** 双击与单击落点过近时，沿用刚打开的空输入框，避免把空文字提交掉。 */
const CANVAS_ANNOTATION_TEXT_REUSE_DISTANCE = 12;

export function shouldKeepCanvasTextEditor(
  session: { mode: string; x: number; y: number } | null | undefined,
  point: CanvasAnnotationPoint,
) {
  if (session?.mode !== "create") return false;
  return distance(session, point) < CANVAS_ANNOTATION_TEXT_REUSE_DISTANCE;
}

export function canvasAnnotationTextWidth(text: string, fontSize: number) {
  if (!text) return fontSize * CANVAS_ANNOTATION_TEXT_CARET_WIDTH_EM;
  let width = 0;
  for (const char of text) {
    width += isWideAnnotationChar(char) ? fontSize * CANVAS_ANNOTATION_TEXT_CJK_WIDTH_EM : fontSize * CANVAS_ANNOTATION_TEXT_WIDTH_EM;
  }
  return width;
}

function isWideAnnotationChar(char: string) {
  const code = char.codePointAt(0) ?? 0;
  return code > 0xff || (code >= 0x1100 && code <= 0x11ff);
}

export function canvasTextEditorOverlay(
  origin: { x: number; y: number; fontSize: number; text: string },
  image: { width: number; height: number },
  stage: { width: number; height: number },
) {
  const scaleX = stage.width / Math.max(1, image.width);
  const scaleY = stage.height / Math.max(1, image.height);
  return {
    left: origin.x * scaleX,
    top: (origin.y - origin.fontSize) * scaleY,
    fontSize: origin.fontSize * scaleY,
    width: canvasAnnotationTextWidth(origin.text, origin.fontSize) * scaleX,
    height: origin.fontSize * 1.25 * scaleY,
  };
}

export function canvasAnnotationTextSelectionBounds(ink: CanvasAnnotationBounds, fontSize: number): CanvasAnnotationBounds {
  const pad = Math.max(1, fontSize * CANVAS_ANNOTATION_TEXT_SELECTION_PAD_EM);
  return {
    x: ink.x - pad,
    y: ink.y - pad,
    width: ink.width + pad * 2,
    height: ink.height + pad * 2,
  };
}

export function canvasAnnotationBounds(mark: CanvasImageAnnotation): CanvasAnnotationBounds {
  if (mark.type === "text") {
    return {
      x: mark.x,
      y: mark.y - mark.fontSize,
      width: canvasAnnotationTextWidth(mark.text, mark.fontSize),
      height: mark.fontSize * 1.25,
    };
  }
  const points = mark.type === "brush"
    ? mark.points
    : mark.type === "arrow"
      ? arrowBoundPoints(mark)
      : [mark.start, mark.end];
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

function arrowBoundPoints(mark: CanvasShapeAnnotation) {
  const arrow = canvasArrowGeometry(mark.start, mark.end, mark.strokeWidth);
  return [mark.start, mark.end, arrow.left, arrow.right, arrow.tail, arrow.startLeft, arrow.startRight];
}

function distance(a: CanvasAnnotationPoint, b: CanvasAnnotationPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value: number, min: number, max: number) {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}
