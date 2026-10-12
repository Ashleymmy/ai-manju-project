import { modelDisplayName, modelName, modelOptions } from "@/shared/lib/modelSelection";

export { DEFAULT_IMAGE_MODEL as DEFAULT_CANVAS_IMAGE_MODEL } from "@/shared/lib/modelSelection";
export { videoModelOptions as canvasVideoModelOptions } from "@/shared/lib/modelSelection";

export const canvasModelName = modelDisplayName;
export const canvasGenerationModelOptions = modelOptions;

/**
 * History may hold a full provider selector or, for older results, only the
 * upstream model ID (often an opaque endpoint). A bare ID borrows a catalog
 * label only when every selector serving that ID agrees on it.
 */
export function canvasHistoryModelName(model: string, labels: Record<string, string> = {}) {
  const value = model.trim();
  if (!value) return "";
  if (labels[value]?.trim() || value.includes("::")) return modelDisplayName(value, labels);
  const matches = new Set(Object.entries(labels)
    .filter(([selector, label]) => label.trim() && modelName(selector) === value)
    .map(([, label]) => label.trim()));
  return matches.size === 1 ? [...matches][0] : modelDisplayName(value, labels);
}

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
