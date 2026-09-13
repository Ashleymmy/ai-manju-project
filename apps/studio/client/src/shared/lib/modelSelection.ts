/** Real upstream identity; supplier aliases must never rename or merge models. */
export function modelName(model: string) {
  return model.split("::").at(-1)?.trim() || "";
}

/** Keep the saved selector for routing while showing each real model once. */
export function modelOptions(models: string[], selected = "") {
  const grouped = new Map<string, { value: string; label: string }>();
  for (const value of models) {
    const name = modelName(value);
    if (!name) continue;
    if (!grouped.has(name)) grouped.set(name, { value, label: name });
    if (selected && modelName(selected) === name) {
      grouped.set(name, { value: selected, label: name });
    }
  }
  return [...grouped.values()];
}

/** A removed supplier does not invalidate a model still offered by another. */
export function resolveModel(models: string[], requested: string) {
  const name = modelName(requested);
  return name && models.some(model => modelName(model) === name) ? requested : "";
}
