/** Preferred default for image creation when offered by the live model catalog. */
export const DEFAULT_IMAGE_MODEL = "gpt-image-2.5-flare";

/** Real upstream identity; supplier aliases must never rename or merge models. */
export function modelName(model: string) {
  return model.split("::").at(-1)?.trim() || "";
}

// SD-video selectors identify managed slots, not user-facing model names.
const SDVIDEO_MODEL_PREFIX = "sdvideo/";

export function modelDisplayName(model: string, labels: Record<string, string> = {}) {
  // Official endpoint IDs have no user-facing model identity; use their saved name.
  if (modelName(model).startsWith("ep-")) {
    return labels[model]?.trim() || modelName(model);
  }
  if (model.startsWith(SDVIDEO_MODEL_PREFIX)) {
    return labels[model]?.trim() || model.slice(SDVIDEO_MODEL_PREFIX.length);
  }
  return modelName(model);
}

/** Keep the saved selector for routing while showing each real model once. */
export function modelOptions(models: string[], selected = "", labels: Record<string, string> = {}) {
  const grouped = new Map<string, { value: string; label: string }>();
  for (const value of models) {
    const name = modelName(value);
    if (!name) continue;
    const label = modelDisplayName(value, labels);
    if (!grouped.has(name)) grouped.set(name, { value, label });
    if (selected && modelName(selected) === name) {
      grouped.set(name, { value: selected, label });
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
