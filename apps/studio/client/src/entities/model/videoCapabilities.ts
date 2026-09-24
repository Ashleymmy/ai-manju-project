export type VideoModelCapabilities = {
  resolutions?: string[];
  ratios?: string[];
  supports?: string[];
  durations?: number[];
  has_audio?: boolean;
  references?: { images: number; videos: number; audios: number; audio_only: boolean };
  frames_exclusive?: boolean;
};

let catalog: Record<string, VideoModelCapabilities> = {};

export function replaceVideoModelCapabilities(value: unknown) {
  catalog = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const [model, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const cap: VideoModelCapabilities = {};
    for (const field of ["resolutions", "ratios", "supports"] as const) {
      if (Array.isArray(raw[field])) cap[field] = raw[field].filter((item: unknown): item is string => typeof item === "string");
    }
    if (typeof raw.has_audio === "boolean") cap.has_audio = raw.has_audio;
    if (typeof raw.frames_exclusive === "boolean") cap.frames_exclusive = raw.frames_exclusive;
    if (raw.references && ["images", "videos", "audios"].every(key => Number.isInteger(raw.references[key]) && raw.references[key] >= 0)) {
      cap.references = { ...raw.references, audio_only: raw.references.audio_only === true };
    }
    catalog[model] = cap;
  }
}

/** Fallback is only for identifiable IDs before discovery. Live metadata wins;
 * endpoint IDs and renamed labels never borrow another account's limits. */
export function videoModelCapabilities(model: string): VideoModelCapabilities {
  if (catalog[model]) return catalog[model];
  const id = (model.split("::").at(-1) || "").replace(/^sdvideo\//, "").toLowerCase();
  const h3 = id.match(/^zzdh-minimax-h3-限时优惠-多参考图生-(480p|768p)$/);
  if (h3) return { resolutions: [h3[1]], ratios: ["16:9", "9:16"], supports: ["reference_image"], has_audio: false, references: { images: 9, videos: 0, audios: 0, audio_only: false } };
  if (/seedance/.test(id) && /(?:fast|mini)/.test(id)) return { resolutions: ["480p", "720p"] };
  if (/wan3|wan-3/.test(id)) return { ratios: ["16:9", "9:16", "1:1", "4:3", "3:4", "adaptive"], frames_exclusive: true };
  return {};
}

export function videoOptionAvailable(model: string, field: "resolutions" | "ratios" | "supports", value: string) {
  const choices = videoModelCapabilities(model)[field];
  if (field === "ratios") value = ({ "1280x720": "16:9", "720x1280": "9:16", "1024x1024": "1:1" } as Record<string, string>)[value] || value;
  return !choices?.length || choices.some(choice => choice.toLowerCase() === value.toLowerCase());
}
