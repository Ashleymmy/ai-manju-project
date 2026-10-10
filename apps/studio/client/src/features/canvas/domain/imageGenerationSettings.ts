import {
  CANVAS_IMAGE_AVAILABLE_RESOLUTIONS,
  imageResolutionFromNode,
  isCanvasImageResolutionAvailable,
  modelFromNode,
  promptTextFromNode,
  qualityFromNode,
  sizeFromNode,
  type CanvasImageResolution,
} from "./nodeUtils";
import { imageModelSupportsDetail } from "@/entities/model/imageProtocol";
import { extractCanvasMentionTokens, type CanvasMentionReference } from "./mentions";
import { assetIdFromNode, imageSrcFromNode } from "./nodes";
import type { CanvasNodeData } from "./types";

export type CanvasImageDimensions = { width: number; height: number };

/** Match the API's 16 px alignment, 3:1 ratio, 3840 px edge and 8.2944 MP limits. */
const IMAGE_DIMENSION_STEP = 16;
const IMAGE_MAX_EDGE = 3840;
const IMAGE_MAX_RATIO = 3;
const IMAGE_MAX_PIXELS = 8_294_400;
/** Auto without a reference, bitmap or earlier request follows the empty image node's 4:3 frame. */
const EMPTY_IMAGE_AUTO_RATIO = "4:3";
/** Resolution controls pixel budget independently of the model's detail quality. */
const RESOLUTION_PIXELS = { "1K": 1024 ** 2, "2K": 2048 ** 2, "4K": IMAGE_MAX_PIXELS } as const;

/** Validate persisted selections too; never silently downgrade a requested output. */
export function canvasImageResolutionIssue(resolution: CanvasImageResolution): string {
  return isCanvasImageResolutionAvailable(resolution) ? ""
    : `当前暂不支持 ${resolution} 生成，请在参数中选择 ${CANVAS_IMAGE_AVAILABLE_RESOLUTIONS.join(" / ")} 后再生成。`;
}

export function canvasImageGenerationSettingsIssue(node: CanvasNodeData): string {
  return canvasImageResolutionIssue(imageResolutionFromNode(node));
}

/**
 * Auto follows the first @-referenced image, in the same order submission sends references.
 * Returns "unknown" when that image's bitmap size is only readable at submission time.
 */
export function canvasImageAutoReferenceSize(
  node: CanvasNodeData,
  references: readonly CanvasMentionReference[],
  nodes: readonly CanvasNodeData[],
): CanvasImageDimensions | "unknown" | undefined {
  if (sizeFromNode(node) !== "auto") return undefined;
  const byKey = new Map(references.map(reference => [reference.key, reference]));
  for (const token of extractCanvasMentionTokens(promptTextFromNode(node))) {
    const reference = byKey.get(token.key);
    if (!reference || reference.kind !== "image" || reference.nodeId === node.id) continue;
    const source = reference.nodeId ? nodes.find(item => item.id === reference.nodeId) : undefined;
    const width = Number(source?.metadata?.naturalWidth);
    const height = Number(source?.metadata?.naturalHeight);
    return positiveRatio(width, height) ? { width, height } : "unknown";
  }
  return undefined;
}

/**
 * Pixel size an empty, idle image node will request, when it is known before submission.
 * Undefined for nodes that already show media or whose auto reference is only readable at submission.
 */
export function canvasEmptyImageRequestDimensions(
  node: CanvasNodeData,
  references: readonly CanvasMentionReference[],
  nodes: readonly CanvasNodeData[],
): CanvasImageDimensions | undefined {
  if (node.kind !== "image" || node.metadata?.status === "loading") return undefined;
  if (assetIdFromNode(node) || imageSrcFromNode(node, {})) return undefined;
  const reference = canvasImageAutoReferenceSize(node, references, nodes);
  if (reference === "unknown") return undefined;
  const [width, height] = canvasImageGenerationSettings(node, undefined, undefined, reference).size.split("x").map(Number);
  return width > 0 && height > 0 ? { width, height } : undefined;
}

export function canvasImageGenerationSettings(
  node: CanvasNodeData,
  size = sizeFromNode(node),
  model = modelFromNode(node, ""),
  autoReferenceSize?: CanvasImageDimensions,
) {
  const imageResolution = imageResolutionFromNode(node);
  const quality = imageModelSupportsDetail(model) ? qualityFromNode(node) : "auto";
  const effectiveSize = size === "auto" && imageAutoRatio(node, autoReferenceSize) === undefined ? EMPTY_IMAGE_AUTO_RATIO : size;
  // Explicit ratio buttons must stay exact after the API's 16 px alignment.
  const ratioParts = (effectiveSize === "panorama" ? "3:1" : effectiveSize).match(/^(\d+):(\d+)$/);
  if (ratioParts) {
    const rw = Number(ratioParts[1]);
    const rh = Number(ratioParts[2]);
    if (rw > 0 && rh > 0 && Math.max(rw, rh) / Math.min(rw, rh) <= IMAGE_MAX_RATIO) {
      const divisor = greatestCommonDivisor(rw, rh);
      const unitWidth = rw / divisor * IMAGE_DIMENSION_STEP;
      const unitHeight = rh / divisor * IMAGE_DIMENSION_STEP;
      const scale = Math.floor(Math.min(
        IMAGE_MAX_EDGE / Math.max(unitWidth, unitHeight),
        Math.sqrt(RESOLUTION_PIXELS[imageResolution] / (unitWidth * unitHeight)),
      ));
      if (scale > 0) return {
        size: `${unitWidth * scale}x${unitHeight * scale}` as const,
        quality, imageResolution,
      };
    }
  }
  const ratio = imageAspectRatio(node, size, autoReferenceSize);
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
  return { size: `${width}x${height}` as const, quality, imageResolution };
}

function greatestCommonDivisor(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

function imageAspectRatio(node: CanvasNodeData, size: string, autoReferenceSize?: CanvasImageDimensions) {
  if (size === "panorama") return IMAGE_MAX_RATIO;
  const parts = size.split(/[:x]/).map(Number);
  const explicit = parts.length === 2 ? positiveRatio(parts[0], parts[1]) : undefined;
  return Math.max(1 / IMAGE_MAX_RATIO, Math.min(IMAGE_MAX_RATIO, explicit ?? imageAutoRatio(node, autoReferenceSize) ?? 1));
}

/**
 * Auto follows the first reference image, then the current bitmap (never the resized
 * canvas card), then the last request. Undefined means none is known (an empty node).
 */
function imageAutoRatio(node: CanvasNodeData, autoReferenceSize?: CanvasImageDimensions) {
  const reference = autoReferenceSize ? positiveRatio(autoReferenceSize.width, autoReferenceSize.height) : undefined;
  const natural = positiveRatio(Number(node.metadata?.naturalWidth), Number(node.metadata?.naturalHeight));
  const requested = String(node.metadata?.requestedImageSize || "").split("x").map(Number);
  const previous = requested.length === 2 ? positiveRatio(requested[0], requested[1]) : undefined;
  return reference ?? natural ?? previous;
}

function positiveRatio(width: number, height: number) {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? width / height : undefined;
}
