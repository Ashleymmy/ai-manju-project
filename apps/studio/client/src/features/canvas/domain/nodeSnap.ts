/** 两框贴靠时的固定间距（画布单位）。吸附本身不绘制，只改变位置。 */
export const CANVAS_NODE_DOCK_GAP = 24;
/** 磁力吸引范围（屏幕像素），随缩放换算到世界坐标。 */
export const CANVAS_NODE_DOCK_SCREEN_PX = 22;
/** 判定顶 / 中 / 底（或左 / 中 / 右）已对齐的容差（画布单位）。 */
const CANVAS_ALIGN_GUIDE_EPSILON = 0.5;

export type CanvasNodeSnapBox = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CanvasAlignGuide = {
  axis: "x" | "y";
  position: number;
  start: number;
  end: number;
};

export type CanvasNodeSnapResult = {
  deltaX: number;
  deltaY: number;
  guides: CanvasAlignGuide[];
};

const EMPTY_RESULT: CanvasNodeSnapResult = { deltaX: 0, deltaY: 0, guides: [] };

export function snapMovingBoxesToDock(
  moving: readonly CanvasNodeSnapBox[],
  targets: readonly CanvasNodeSnapBox[],
  threshold: number,
): CanvasNodeSnapResult {
  if (!moving.length || !targets.length || threshold <= 0) return EMPTY_RESULT;

  const source = unionSnapBoxes(moving);
  let best: { dist: number; deltaX: number; deltaY: number; target: CanvasNodeSnapBox } | null = null;

  for (const target of targets) {
    for (const slot of dockSlots(source, target)) {
      const dist = Math.hypot(slot.x - source.x, slot.y - source.y);
      if (dist > threshold) continue;
      if (best && dist >= best.dist - 1e-6) continue;
      best = {
        dist,
        deltaX: slot.x - source.x,
        deltaY: slot.y - source.y,
        target,
      };
    }
  }

  if (!best) return EMPTY_RESULT;
  const placed = { ...source, x: source.x + best.deltaX, y: source.y + best.deltaY };
  return {
    deltaX: best.deltaX,
    deltaY: best.deltaY,
    guides: alignmentGuidesBetween(placed, best.target),
  };
}

export function canvasNodeDockThreshold(zoomPercent: number) {
  const scale = Math.max(0.01, zoomPercent / 100);
  return CANVAS_NODE_DOCK_SCREEN_PX / scale;
}

export function alignmentGuidesBetween(
  placed: CanvasNodeSnapBox,
  target: CanvasNodeSnapBox,
): CanvasAlignGuide[] {
  const guides: CanvasAlignGuide[] = [];
  const xStart = Math.min(placed.x, target.x);
  const xEnd = Math.max(placed.x + placed.width, target.x + target.width);
  const yStart = Math.min(placed.y, target.y);
  const yEnd = Math.max(placed.y + placed.height, target.y + target.height);

  const placedMidY = placed.y + placed.height / 2;
  const targetMidY = target.y + target.height / 2;
  const placedMidX = placed.x + placed.width / 2;
  const targetMidX = target.x + target.width / 2;

  if (aligned(placed.y, target.y)) {
    guides.push({ axis: "y", position: target.y, start: xStart, end: xEnd });
  }
  if (aligned(placedMidY, targetMidY)) {
    guides.push({ axis: "y", position: targetMidY, start: xStart, end: xEnd });
  }
  if (aligned(placed.y + placed.height, target.y + target.height)) {
    guides.push({ axis: "y", position: target.y + target.height, start: xStart, end: xEnd });
  }
  if (aligned(placed.x, target.x)) {
    guides.push({ axis: "x", position: target.x, start: yStart, end: yEnd });
  }
  if (aligned(placedMidX, targetMidX)) {
    guides.push({ axis: "x", position: targetMidX, start: yStart, end: yEnd });
  }
  if (aligned(placed.x + placed.width, target.x + target.width)) {
    guides.push({ axis: "x", position: target.x + target.width, start: yStart, end: yEnd });
  }
  return guides;
}

function aligned(a: number, b: number) {
  return Math.abs(a - b) <= CANVAS_ALIGN_GUIDE_EPSILON;
}

function unionSnapBoxes(boxes: readonly CanvasNodeSnapBox[]): CanvasNodeSnapBox {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return {
    id: "",
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function dockSlots(moving: CanvasNodeSnapBox, target: CanvasNodeSnapBox) {
  const gap = CANVAS_NODE_DOCK_GAP;
  const rightX = target.x + target.width + gap;
  const leftX = target.x - moving.width - gap;
  const belowY = target.y + target.height + gap;
  const aboveY = target.y - moving.height - gap;
  const centerY = target.y + (target.height - moving.height) / 2;
  const bottomY = target.y + target.height - moving.height;
  const centerX = target.x + (target.width - moving.width) / 2;
  const rightAlignX = target.x + target.width - moving.width;

  return [
    { x: rightX, y: target.y },
    { x: rightX, y: centerY },
    { x: rightX, y: bottomY },
    { x: leftX, y: target.y },
    { x: leftX, y: centerY },
    { x: leftX, y: bottomY },
    { x: target.x, y: belowY },
    { x: centerX, y: belowY },
    { x: rightAlignX, y: belowY },
    { x: target.x, y: aboveY },
    { x: centerX, y: aboveY },
    { x: rightAlignX, y: aboveY },
  ];
}
