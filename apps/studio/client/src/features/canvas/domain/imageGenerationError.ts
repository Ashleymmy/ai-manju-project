/** Public copy also handles old snapshots whose errors predate worker sanitization. */
const IMAGE_GENERATION_ERRORS = [
  {
    code: "image_output_size_mismatch",
    legacy: /^图片尺寸不符合所选参数[：:]/,
    message: "本次图片未达到所选规格，请调整参数或更换模型后重试。",
  },
  {
    code: "image_output_unreadable",
    legacy: /^生成服务未返回可校验的原图/,
    message: "本次图片未能完整生成，请稍后重试或更换模型。",
  },
] as const;

export function canvasImageGenerationError(message: string, code?: string): string {
  return IMAGE_GENERATION_ERRORS.find(error => error.code === code || error.legacy.test(message.trim()))?.message || message;
}
