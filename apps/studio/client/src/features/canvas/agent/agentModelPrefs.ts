/** Agent 输入框模型选择器优先默认选中的文本模型（目录中存在时）。 */
export const AGENT_DEFAULT_TEXT_MODEL_HINT = "gpt-5.6-luna";

/** 模型选择器「精选推荐」展示条数。 */
export const AGENT_FEATURED_MODEL_COUNT = 3;

function normalizeModelKey(value: string): string {
  return value.toLowerCase().replace(/[\s_]+/g, "-");
}

export function isGpt56LunaModel(model: string, label = ""): boolean {
  const haystack = normalizeModelKey(`${model} ${label}`);
  return haystack.includes("gpt-5.6-luna") || haystack.includes("5.6-luna");
}

export function pickAgentDefaultModel(
  models: string[],
  labels: Record<string, string> = {},
  apiDefault = "",
): string {
  const luna = models.find((model) => isGpt56LunaModel(model, labels[model]));
  if (luna) return luna;
  if (apiDefault && models.includes(apiDefault)) return apiDefault;
  return models[0] || "";
}

export function featuredAgentModels(models: string[], preferred: string): string[] {
  if (!preferred || !models.includes(preferred)) {
    return models.slice(0, AGENT_FEATURED_MODEL_COUNT);
  }
  return [preferred, ...models.filter((model) => model !== preferred)].slice(0, AGENT_FEATURED_MODEL_COUNT);
}

export function extraAgentModels(models: string[], featured: string[]): string[] {
  const featuredSet = new Set(featured);
  return models.filter((model) => !featuredSet.has(model));
}
