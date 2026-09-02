export type CanvasMaskPoint = { x: number; y: number };

export type CanvasMaskRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function canvasMaskPoint(
  clientX: number,
  clientY: number,
  rect: CanvasMaskRect,
  imageWidth: number,
  imageHeight: number,
): CanvasMaskPoint {
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  return {
    x: clamp(((clientX - rect.left) / width) * Math.max(1, imageWidth), 0, Math.max(1, imageWidth)),
    y: clamp(((clientY - rect.top) / height) * Math.max(1, imageHeight), 0, Math.max(1, imageHeight)),
  };
}

export function canvasMaskBrushSize(value: number, imageWidth: number, imageHeight: number) {
  const longEdge = Math.max(1, imageWidth, imageHeight);
  const normalized = Number.isFinite(value) ? value : 36;
  return clamp(normalized, Math.max(2, longEdge * 0.002), Math.max(8, longEdge * 0.25));
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
