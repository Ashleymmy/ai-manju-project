/** Keep the same marker in worker/image_requirements.py for older clients/workers. */
const CANVAS_OUTPUT_REQUIREMENTS = "[Canvas output requirements]";

/** Some compatible image gateways follow the prompt but ignore the size field. */
export function canvasImageRequestPrompt(input: {
  prompt: string;
  sourceType?: string;
  size?: string;
}) {
  const prompt = input.prompt.trim();
  if (
    input.sourceType !== "canvas" ||
    prompt.includes(CANVAS_OUTPUT_REQUIREMENTS)
  )
    return prompt;
  const match = /^(\d+)x(\d+)$/.exec(input.size || "");
  if (!match) return prompt;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!(width > 0 && height > 0)) return prompt;
  return `${prompt}\n\n${CANVAS_OUTPUT_REQUIREMENTS}\n最终输出图片尺寸必须为 ${width}×${height} 像素（宽×高）。按此宽高比重新构图，不要沿用参考图的宽高比，不要添加边框或把这些规格文字画进图片。`;
}
