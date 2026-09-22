// Duration choices belong to the full provider selector. An opaque endpoint or
// a friendly label must never inherit another provider's advertised limits.
let durationsByModel: Record<string, readonly number[]> = {};
let catalogLoaded = false;
export const defaultVideoDuration = 5;

export function replaceVideoModelDurations(value: unknown) {
  const next: Record<string, number[]> = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [model, durations] of Object.entries(value)) {
      if (!Array.isArray(durations)) continue;
      const valid = durations.filter((seconds): seconds is number =>
        typeof seconds === "number" && Number.isFinite(seconds) && (seconds > 0 || seconds === -1));
      if (valid.length) next[model.trim()] = [...new Set(valid)].sort((a, b) => a - b);
    }
  }
  durationsByModel = next;
  catalogLoaded = true;
}

export function hasVideoDurationCatalog() { return catalogLoaded; }

export function videoModelDurations(model: string): readonly number[] {
  return durationsByModel[model.trim()] ?? [];
}

/** Used when changing models or restoring a saved configuration, before display. */
export function normalizeVideoDuration(model: string, value: string): string {
  const choices = videoModelDurations(model);
  const seconds = Number(value);
  if (choices.includes(seconds)) return String(seconds);
  const positive = choices.filter(item => item > 0);
  const requested = Number.isFinite(seconds) && seconds > 0 ? seconds : defaultVideoDuration;
  if (positive.length) return String(positive.reduce((best, item) =>
    Math.abs(item - requested) <= Math.abs(best - requested) ? item : best));
  if (choices.includes(-1)) return "-1";
  // Unknown capabilities: preserve a positive duration without inventing a cap.
  return String(Math.max(1, Math.round(requested)));
}
