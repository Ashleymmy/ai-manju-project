import type { ImageGenerationInput } from "../api";

export const IMAGE_WORKBENCH_SIZE_OPTIONS = [
  "1:1",
  "3:2",
  "2:3",
  "4:3",
  "3:4",
  "16:9",
  "9:16",
  "1:1(2x)",
  "16:9(2x)",
  "9:16(2x)",
  "16:9(4k)",
  "9:16(4k)",
  "auto",
] as const;

export type ImageWorkbenchSizeOption = (typeof IMAGE_WORKBENCH_SIZE_OPTIONS)[number];
export type ImageWorkbenchQuality = NonNullable<ImageGenerationInput["quality"]>;
export type ImagePixelSize = { width: number; height: number };

type ImageWorkbenchRequestOptions = {
  size: NonNullable<ImageGenerationInput["size"]>;
  quality: ImageWorkbenchQuality;
};

/* 与 apps/api/internal/service/image_generation_spec.go 保持一致 */
const IMAGE_DIMENSION_STEP = 16;
const IMAGE_DEFAULT_SHORT = 1024;
const IMAGE_MIN_EDGE = 256;
const IMAGE_MAX_EDGE = 3840;
const IMAGE_QUALITY_BASE: Record<string, number> = {
  low: 1024,
  medium: 2048,
  high: 2880,
  standard: 1024,
  hd: 2048,
};

const FLIPPED_SIZE_OPTION: Partial<Record<ImageWorkbenchSizeOption, ImageWorkbenchSizeOption>> = {
  "3:2": "2:3",
  "2:3": "3:2",
  "4:3": "3:4",
  "3:4": "4:3",
  "16:9": "9:16",
  "9:16": "16:9",
  "16:9(2x)": "9:16(2x)",
  "9:16(2x)": "16:9(2x)",
  "16:9(4k)": "9:16(4k)",
  "9:16(4k)": "16:9(4k)",
};

const BASE_RATIO_OPTIONS: Array<{ option: ImageWorkbenchSizeOption; ratio: number }> = [
  { option: "1:1", ratio: 1 },
  { option: "3:2", ratio: 3 / 2 },
  { option: "2:3", ratio: 2 / 3 },
  { option: "4:3", ratio: 4 / 3 },
  { option: "3:4", ratio: 3 / 4 },
  { option: "16:9", ratio: 16 / 9 },
  { option: "9:16", ratio: 9 / 16 },
];

export function resolveImageWorkbenchRequestOptions(
  size: ImageWorkbenchSizeOption,
  quality: ImageWorkbenchQuality,
): ImageWorkbenchRequestOptions {
  switch (size) {
    case "1:1(2x)":
      return { size: "1:1", quality: "medium" };
    case "16:9(2x)":
      return { size: "16:9", quality: "medium" };
    case "9:16(2x)":
      return { size: "9:16", quality: "medium" };
    case "16:9(4k)":
      return { size: "16:9", quality: "high" };
    case "9:16(4k)":
      return { size: "9:16", quality: "high" };
    default:
      return { size, quality };
  }
}

export function workbenchPixelDimensions(
  option: ImageWorkbenchSizeOption,
  quality: ImageWorkbenchQuality,
): ImagePixelSize | null {
  const resolved = resolveImageWorkbenchRequestOptions(option, quality);
  if (resolved.size === "auto") return null;
  return ratioToPixelSize(resolved.size, resolved.quality);
}

export function workbenchRequestSize(
  option: ImageWorkbenchSizeOption,
  width: number,
  height: number,
  align16 = true,
): string {
  if (option === "auto") return "auto";
  const pixels = clampImagePixelSize({ width, height }, align16);
  return `${pixels.width}x${pixels.height}`;
}

export function snapPixelSizeForModel(model: string, pixels: ImagePixelSize): ImagePixelSize {
  const token = model.toLowerCase();
  const isGptImage1Family = token.includes("gpt-image-1") && !token.includes("gpt-image-2");
  if (!isGptImage1Family) return pixels;
  if (pixels.width === pixels.height) return { width: 1024, height: 1024 };
  return pixels.width > pixels.height
    ? { width: 1536, height: 1024 }
    : { width: 1024, height: 1536 };
}

export function clampImagePixelSize(size: ImagePixelSize, align16 = true): ImagePixelSize {
  return {
    width: clampImageEdge(size.width, align16),
    height: clampImageEdge(size.height, align16),
  };
}

export function flippedWorkbenchSizeOption(option: ImageWorkbenchSizeOption): ImageWorkbenchSizeOption {
  return FLIPPED_SIZE_OPTION[option] ?? option;
}

export function nearestWorkbenchSizeOption(width: number, height: number): ImageWorkbenchSizeOption {
  const ratio = width / Math.max(1, height);
  let best: ImageWorkbenchSizeOption = "1:1";
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of BASE_RATIO_OPTIONS) {
    const score = Math.abs(Math.log(ratio / candidate.ratio));
    if (score < bestScore) {
      best = candidate.option;
      bestScore = score;
    }
  }
  return best;
}

function ratioToPixelSize(size: string, quality: string): ImagePixelSize {
  const [ratioWidth, ratioHeight] = size.split(":").map(Number);
  const longRatio = Math.max(ratioWidth, ratioHeight) / Math.min(ratioWidth, ratioHeight);
  const basePixels = IMAGE_QUALITY_BASE[quality] || 0;
  let longSide = 0;
  let shortSide = 0;
  if (basePixels > 0) {
    const targetPixels = basePixels * basePixels;
    longSide = Math.floor(Math.sqrt(targetPixels * longRatio) / IMAGE_DIMENSION_STEP) * IMAGE_DIMENSION_STEP;
    shortSide = Math.round(longSide / longRatio / IMAGE_DIMENSION_STEP) * IMAGE_DIMENSION_STEP;
  } else {
    shortSide = IMAGE_DEFAULT_SHORT;
    longSide = Math.round((shortSide * longRatio) / IMAGE_DIMENSION_STEP) * IMAGE_DIMENSION_STEP;
  }
  return ratioWidth >= ratioHeight
    ? { width: longSide, height: shortSide }
    : { width: shortSide, height: longSide };
}

function clampImageEdge(value: number, align16: boolean) {
  const n = Math.max(IMAGE_MIN_EDGE, Math.min(IMAGE_MAX_EDGE, Math.round(Number(value) || 0)));
  if (!align16) return n;
  return Math.max(IMAGE_DIMENSION_STEP, Math.round(n / IMAGE_DIMENSION_STEP) * IMAGE_DIMENSION_STEP);
}
