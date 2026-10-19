import type {
  ImageCompressionFormat,
  ImageUpscaleAlgorithm,
} from "@/features/canvas/domain/imageData";

export type CanvasImageToolDraft = {
  cropRatio: number | null;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  splitRows: number;
  splitColumns: number;
  upscaleLongEdge: number;
  upscaleAlgorithm: ImageUpscaleAlgorithm;
  aiUpscaleFactor: 1 | 2 | 3 | 4;
  aiUpscaleMode: "base" | "enhancement";
  aiUpscaleOutputFormat: "jpg" | "png" | "bmp";
  aiUpscaleOutputQuality: number;
  compressionFormat: ImageCompressionFormat;
  compressionQuality: number;
  compressionMaxDimension: number;
  compressionTargetKb: number;
  outpaintTop: number;
  outpaintRight: number;
  outpaintBottom: number;
  outpaintLeft: number;
  outpaintPrompt: string;
  angleHorizontal: number;
  anglePitch: number;
  angleDistance: number;
  angleLens: "wide" | "standard" | "telephoto";
};

export const defaultCanvasImageToolDraft: CanvasImageToolDraft = {
  cropRatio: null,
  cropX: 12,
  cropY: 12,
  cropWidth: 76,
  cropHeight: 76,
  splitRows: 2,
  splitColumns: 2,
  upscaleLongEdge: 2048,
  upscaleAlgorithm: "high",
  aiUpscaleFactor: 2,
  aiUpscaleMode: "enhancement",
  aiUpscaleOutputFormat: "jpg",
  aiUpscaleOutputQuality: 95,
  compressionFormat: "image/jpeg",
  compressionQuality: 82,
  compressionMaxDimension: 2048,
  compressionTargetKb: 0,
  outpaintTop: 22,
  outpaintRight: 22,
  outpaintBottom: 22,
  outpaintLeft: 22,
  outpaintPrompt: "延展画面边缘，保持主体、光线、材质和画风一致",
  angleHorizontal: 0,
  anglePitch: 8,
  angleDistance: 4.8,
  angleLens: "standard",
};

// Common output formats; null keeps the crop frame freely resizable.
export const CANVAS_CROP_RATIOS = [
  { label: "自由", ratio: null },
  { label: "1:1", ratio: 1 },
  { label: "4:3", ratio: 4 / 3 },
  { label: "3:4", ratio: 3 / 4 },
  { label: "3:2", ratio: 3 / 2 },
  { label: "2:3", ratio: 2 / 3 },
  { label: "16:9", ratio: 16 / 9 },
  { label: "9:16", ratio: 9 / 16 },
] as const;

// Alibaba Cloud super-resolution input limits (imageenhan MakeSuperResolutionImage, videoenhan SuperResolveVideo).
export const AI_UPSCALE_IMAGE_MAX_LONG_EDGE = 1920;
export const AI_UPSCALE_IMAGE_MAX_SHORT_EDGE = 1080;
export const AI_UPSCALE_IMAGE_MIN_EDGE = 32;
export const AI_UPSCALE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Long edge the image must be shrunk to before AI upscaling, or null when it already fits. */
export function aiUpscaleImageFitLongEdge(
  width: number,
  height: number,
  bytes: number
): number | null {
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  const scale = Math.min(
    1,
    AI_UPSCALE_IMAGE_MAX_LONG_EDGE / longEdge,
    AI_UPSCALE_IMAGE_MAX_SHORT_EDGE / shortEdge
  );
  if (scale < 1) return Math.floor(longEdge * scale);
  if (bytes > AI_UPSCALE_IMAGE_MAX_BYTES) return longEdge;
  return null;
}

export function aiUpscaleImageProblem(width: number, height: number) {
  if (Math.min(width, height) < AI_UPSCALE_IMAGE_MIN_EDGE) {
    return `图片太小：AI 超分要求图片不小于 ${AI_UPSCALE_IMAGE_MIN_EDGE}×${AI_UPSCALE_IMAGE_MIN_EDGE} 像素`;
  }
  return "";
}

/** Video limits are exclusive on Alibaba Cloud: larger than 360×360 and smaller than 1920×1080. */
export function aiUpscaleVideoProblem(width: number, height: number) {
  if (!width || !height) return "";
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  if (shortEdge <= 360) {
    return `视频分辨率过低（${width}×${height}）：AI 超分要求视频大于 360×360`;
  }
  if (longEdge > 1920 || shortEdge > 1080) {
    return `视频分辨率已达 ${width}×${height}，超出 AI 超分支持范围（需小于 1920×1080）`;
  }
  return "";
}
