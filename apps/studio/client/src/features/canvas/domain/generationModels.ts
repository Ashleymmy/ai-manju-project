import { modelDisplayName, modelOptions } from "@/shared/lib/modelSelection";

export { DEFAULT_IMAGE_MODEL as DEFAULT_CANVAS_IMAGE_MODEL } from "@/shared/lib/modelSelection";
export { videoModelOptions as canvasVideoModelOptions } from "@/shared/lib/modelSelection";

export const canvasModelName = modelDisplayName;
export const canvasGenerationModelOptions = modelOptions;

/** Canvas video nodes prefer this catalog entry; provider selectors vary by installation. */
const DEFAULT_CANVAS_VIDEO_MODEL_LABEL = "yuntu Seedance Fast";

export function pickDefaultCanvasVideoModel(
  models: string[],
  labels: Record<string, string> = {},
  providerNames: Record<string, string> = {},
  fallback = "",
) {
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  const preferred = normalize(DEFAULT_CANVAS_VIDEO_MODEL_LABEL);
  return models.find(model => {
    const label = modelDisplayName(model, labels);
    return normalize(label) === preferred
      || normalize(`${providerNames[model] || ""} ${label}`) === preferred;
  }) || (models.includes(fallback) ? fallback : models[0]) || "";
}
