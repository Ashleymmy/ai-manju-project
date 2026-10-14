import { modelName } from "@/shared/lib/modelSelection";

const SDVIDEO_PREFIX = "sdvideo/";

function catalogName(value: string) {
  const text = value.trim();
  if (!text) return "";
  if (text.startsWith(SDVIDEO_PREFIX)) return text.slice(SDVIDEO_PREFIX.length);
  return modelName(text);
}

/** Show the catalog or admin display name; keep the upstream endpoint only as a fallback. */
export function usageModelLabel(input: {
  model?: string;
  studioModel?: string;
  provider?: string;
  labels?: Record<string, string>;
}) {
  const endpoint = (input.model || "").trim();
  const endpointName = catalogName(endpoint);
  const studio = (input.studioModel || "").trim();
  const studioName = catalogName(studio);
  const labels = input.labels || {};
  const candidates = [
    studio,
    input.provider && endpointName ? `${input.provider}::${endpointName}` : "",
    endpoint,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const exact = labels[candidate]?.trim();
    if (exact) return exact;
  }
  if (endpointName) {
    for (const [selector, label] of Object.entries(labels)) {
      const text = label.trim();
      if (
        text &&
        catalogName(selector) === endpointName &&
        text !== endpointName
      )
        return text;
    }
  }
  if (studioName && studioName !== endpointName) return studioName;
  return endpointName || studioName || "未记录";
}
