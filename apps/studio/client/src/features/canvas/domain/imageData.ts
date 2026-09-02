export type ImageCropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ImageAngleLensPreset = "wide" | "standard" | "telephoto";
export type ImageAngleViewPreset =
  | "front"
  | "front-left"
  | "front-right"
  | "side-left"
  | "side-right"
  | "back"
  | "top"
  | "low";

export type ImageAngleTransform = {
  horizontalAngle: number;
  pitchAngle: number;
  cameraDistance: number;
  wideAngle: boolean;
  lensPreset?: ImageAngleLensPreset;
  viewPreset?: ImageAngleViewPreset;
};

export type ImageCropResizeHandle =
  | "n"
  | "e"
  | "s"
  | "w"
  | "ne"
  | "nw"
  | "se"
  | "sw";

export type ImageCropBox = {
  width: number;
  height: number;
};

export type ImageCropDraft = {
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
};

export type ImageAnglePromptDraft = {
  angleHorizontal: number;
  anglePitch: number;
  angleDistance: number;
  angleLens: ImageAngleLensPreset;
};

export type ImageUpscaleAlgorithm = "nearest" | "bilinear" | "high";
export type ImageFlipDirection = "horizontal" | "vertical";

export type ImageUpscaleParams = {
  targetLongEdge: number;
  algorithm: ImageUpscaleAlgorithm;
};

export type ImageSplitParams = {
  rows: number;
  columns: number;
};

export type ImageSplitPiece = {
  row: number;
  column: number;
  dataUrl: string;
};

export type StoryboardLayout =
  | "grid-2x2"
  | "grid-3x3"
  | "strip-horizontal"
  | "strip-vertical";

export type StoryboardFrame = {
  dataUrl: string;
  title?: string;
  note?: string;
};

export type OutpaintMargins = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type ImageCompressionFormat = "image/jpeg" | "image/webp";

export type ImageCompressionParams = {
  format: ImageCompressionFormat;
  quality: number;
  maxDimension: number;
  targetBytes?: number;
};

export type ImageCompressionResult = {
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
  sourceBytes: number;
  quality: number;
  format: ImageCompressionFormat;
};

const MIN_IMAGE_CROP_SIZE = 0.06;

export const MAX_UPSCALE_LONG_EDGE = 4096;

export function moveImageCropRect(
  crop: ImageCropRect,
  dx: number,
  dy: number,
): ImageCropRect {
  return {
    ...crop,
    x: clampImageCropValue(crop.x + dx, 0, 1 - crop.width),
    y: clampImageCropValue(crop.y + dy, 0, 1 - crop.height),
  };
}

export function resizeImageCropRect(
  crop: ImageCropRect,
  dx: number,
  dy: number,
  handle: ImageCropResizeHandle,
  locked: boolean,
  box: ImageCropBox,
): ImageCropRect {
  let next = { ...crop };
  if (handle.includes("e")) next.width = crop.width + dx;
  if (handle.includes("s")) next.height = crop.height + dy;
  if (handle.includes("w")) {
    next.x = crop.x + dx;
    next.width = crop.width - dx;
  }
  if (handle.includes("n")) {
    next.y = crop.y + dy;
    next.height = crop.height - dy;
  }
  if (locked) {
    const size = Math.max(next.width * box.width, next.height * box.height);
    next.width = size / box.width;
    next.height = size / box.height;
    if (handle.includes("w")) next.x = crop.x + crop.width - next.width;
    if (handle.includes("n")) next.y = crop.y + crop.height - next.height;
  }
  next.width = clampImageCropValue(
    next.width,
    MIN_IMAGE_CROP_SIZE,
    1,
  );
  next.height = clampImageCropValue(
    next.height,
    MIN_IMAGE_CROP_SIZE,
    1,
  );
  next.x = clampImageCropValue(next.x, 0, 1 - next.width);
  next.y = clampImageCropValue(next.y, 0, 1 - next.height);
  return next;
}

export function resolveUpscaleSize(
  width: number,
  height: number,
  targetLongEdge: number,
) {
  const sourceWidth = Number.isFinite(width) && width > 0 ? width : 1;
  const sourceHeight = Number.isFinite(height) && height > 0 ? height : 1;
  const longEdge = Math.max(sourceWidth, sourceHeight);
  const requestedLongEdge =
    Number.isFinite(targetLongEdge) && targetLongEdge > 0
      ? Math.round(targetLongEdge)
      : longEdge;
  const target = Math.min(
    MAX_UPSCALE_LONG_EDGE,
    Math.max(1, requestedLongEdge),
  );
  const scale = target / longEdge;
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

export function imageCropRectFromDraft(draft: ImageCropDraft): ImageCropRect {
  const x = clampImageCropValue(draft.cropX / 100, 0, 0.94);
  const y = clampImageCropValue(draft.cropY / 100, 0, 0.94);
  return {
    x,
    y,
    width: clampImageCropValue(draft.cropWidth / 100, 0.06, 1 - x),
    height: clampImageCropValue(draft.cropHeight / 100, 0.06, 1 - y),
  };
}

export function imageToolDraftFromCropRect(crop: ImageCropRect): ImageCropDraft {
  return {
    cropX: Number((crop.x * 100).toFixed(2)),
    cropY: Number((crop.y * 100).toFixed(2)),
    cropWidth: Number((crop.width * 100).toFixed(2)),
    cropHeight: Number((crop.height * 100).toFixed(2)),
  };
}

export function canvasAnglePrompt(draft: ImageAnglePromptDraft) {
  const horizontal =
    draft.angleHorizontal < -150 || draft.angleHorizontal > 150
      ? "背面"
      : draft.angleHorizontal < -70
        ? "左侧"
        : draft.angleHorizontal < -15
          ? "左前方"
          : draft.angleHorizontal > 70
            ? "右侧"
            : draft.angleHorizontal > 15
              ? "右前方"
              : "正面";
  const pitch =
    draft.anglePitch > 35
      ? "俯视"
      : draft.anglePitch < -25
        ? "仰视"
        : "平视";
  const lens =
    draft.angleLens === "wide"
      ? "广角"
      : draft.angleLens === "telephoto"
        ? "长焦"
        : "标准";
  return `基于参考图重新生成同一主体的${horizontal}${pitch}视角。保持人物或物体身份、服装、材质、光线、色彩和画风一致；镜头距离 ${draft.angleDistance.toFixed(1)}，使用${lens}镜头。不要把原图做二维拉伸或透视变形，而要生成真实的新机位画面。`;
}

function clampImageCropValue(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
