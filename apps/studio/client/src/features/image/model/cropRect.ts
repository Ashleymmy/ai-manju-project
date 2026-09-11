import type { ImageCropRect } from "@/lib/canvas-image-data";

/* 裁剪框默认：居中约 76% 区域，与弹窗初始选框一致 */
export const DEFAULT_IMAGE_CROP_RECT: ImageCropRect = { x: 0.12, y: 0.12, width: 0.76, height: 0.76 };

/* 在图片内取目标宽高比的最大居中区域，再按 inset 留边 */
export function cropRectForAspectRatio(
  imageAspect: number,
  ratio: number,
  inset = 0.92,
): ImageCropRect {
  const safeAspect = Number.isFinite(imageAspect) && imageAspect > 0 ? imageAspect : 1;
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  let frameWidth: number;
  let frameHeight: number;
  if (safeAspect >= safeRatio) {
    frameHeight = 1;
    frameWidth = safeRatio / safeAspect;
  } else {
    frameWidth = 1;
    frameHeight = safeAspect / safeRatio;
  }
  frameWidth *= inset;
  frameHeight *= inset;
  return {
    x: (1 - frameWidth) / 2,
    y: (1 - frameHeight) / 2,
    width: frameWidth,
    height: frameHeight,
  };
}
