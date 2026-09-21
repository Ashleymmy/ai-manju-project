/** Preferred default for image creation when offered by the live model catalog. */
export const DEFAULT_IMAGE_MODEL = "gpt-image-2.5-flare";

/** 已下线的图片模型：所有模型选择器不再展示，已保存的选择也视为无效并回退默认。 */
const HIDDEN_IMAGE_MODEL_NAMES = new Set(["gpt-image-1", "gpt-image-1.5"]);

/** Real upstream identity; supplier aliases must never rename or merge models. */
export function modelName(model: string) {
  return model.split("::").at(-1)?.trim() || "";
}

// SD-video selectors identify managed slots, not user-facing model names.
const SDVIDEO_MODEL_PREFIX = "sdvideo/";

export function modelDisplayName(model: string, labels: Record<string, string> = {}) {
  // Names are presentation only. Resolve them by the exact provider selector
  // so another account's alias cannot replace this model's saved name.
  const label = labels[model]?.trim();
  if (label) return label;
  if (model.startsWith(SDVIDEO_MODEL_PREFIX)) {
    return model.slice(SDVIDEO_MODEL_PREFIX.length);
  }
  return modelName(model);
}

export function isHiddenImageModel(model: string) {
  return HIDDEN_IMAGE_MODEL_NAMES.has(modelName(model));
}

/** Image catalogs drop retired models before defaults/options are derived. */
export function visibleImageModels(models: string[]) {
  return models.filter(model => !isHiddenImageModel(model));
}

/** Keep the saved selector for routing while showing each real model once. */
export function modelOptions(models: string[], selected = "", labels: Record<string, string> = {}) {
  const grouped = new Map<string, { value: string; label: string }>();
  for (const value of models) {
    const name = modelName(value);
    if (!name || HIDDEN_IMAGE_MODEL_NAMES.has(name)) continue;
    const selector = selected && modelName(selected) === name ? selected : value;
    if (!grouped.has(name) || value === selected) {
      grouped.set(name, { value: selector, label: modelDisplayName(selector, labels) });
    }
  }
  return [...grouped.values()];
}

/** A removed supplier does not invalidate a model still offered by another. */
export function resolveModel(models: string[], requested: string) {
  const name = modelName(requested);
  return name && models.some(model => modelName(model) === name) ? requested : "";
}

/** All image creation entry points use the same default from the real catalog. */
export function pickDefaultImageModel(models: string[], fallback = "") {
  return models.find(model => modelName(model) === DEFAULT_IMAGE_MODEL)
    || resolveModel(models, fallback)
    || models[0]
    || "";
}
