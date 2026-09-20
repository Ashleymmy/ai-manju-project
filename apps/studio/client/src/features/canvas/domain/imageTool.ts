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
