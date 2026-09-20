import { imageResolutionFromNode, qualityFromNode, sizeFromNode } from "./nodeUtils";
import type { CanvasNodeData } from "./types";

/** Match the API's 16 px alignment, 3:1 ratio, 3840 px edge and 8.2944 MP limits. */
const IMAGE_DIMENSION_STEP = 16;
const IMAGE_MAX_EDGE = 3840;
const IMAGE_MAX_RATIO = 3;
const IMAGE_MAX_PIXELS = 8_294_400;
/** Resolution controls pixel budget independently of the model's detail quality. */
const RESOLUTION_PIXELS = { "1K": 1024 ** 2, "2K": 2048 ** 2, "4K": IMAGE_MAX_PIXELS } as const;

export function canvasImageGenerationSettings(node: CanvasNodeData, size = sizeFromNode(node)) {
  const imageResolution = imageResolutionFromNode(node);
  const ratio = imageAspectRatio(node, size);
  const longRatio = Math.max(ratio, 1 / ratio);
  const longSide = Math.floor(Math.min(
    IMAGE_MAX_EDGE,
    Math.sqrt(RESOLUTION_PIXELS[imageResolution] * longRatio),
  ) / IMAGE_DIMENSION_STEP) * IMAGE_DIMENSION_STEP;
  // Align without exceeding the API's pixel or aspect limits.
  const shortSide = Math.max(
    Math.ceil(longSide / IMAGE_MAX_RATIO / IMAGE_DIMENSION_STEP),
    Math.min(
      Math.floor(IMAGE_MAX_PIXELS / longSide / IMAGE_DIMENSION_STEP),
      Math.round(longSide / longRatio / IMAGE_DIMENSION_STEP),
    ),
  ) * IMAGE_DIMENSION_STEP;
  const [width, height] = ratio >= 1 ? [longSide, shortSide] : [shortSide, longSide];
  return { size: `${width}x${height}` as const, quality: qualityFromNode(node), imageResolution };
}

function imageAspectRatio(node: CanvasNodeData, size: string) {
  if (size === "panorama") return IMAGE_MAX_RATIO;
  const parts = size.split(/[:x]/).map(Number);
  const explicit = parts.length === 2 ? positiveRatio(parts[0], parts[1]) : undefined;
  // Auto follows the current bitmap, never the resized canvas card. Empty nodes use 1:1.
  const natural = positiveRatio(Number(node.metadata?.naturalWidth), Number(node.metadata?.naturalHeight));
  const requested = String(node.metadata?.requestedImageSize || "").split("x").map(Number);
  const previous = requested.length === 2 ? positiveRatio(requested[0], requested[1]) : undefined;
  return Math.max(1 / IMAGE_MAX_RATIO, Math.min(IMAGE_MAX_RATIO, explicit ?? natural ?? previous ?? 1));
}

function positiveRatio(width: number, height: number) {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? width / height : undefined;
}
