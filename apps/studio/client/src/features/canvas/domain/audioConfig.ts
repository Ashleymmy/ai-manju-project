const AUDIO_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
] as const;
const AUDIO_FORMATS = ["mp3", "wav", "opus", "aac", "flac", "pcm"] as const;

export type CanvasAudioVoice = (typeof AUDIO_VOICES)[number];
export type CanvasAudioFormat = (typeof AUDIO_FORMATS)[number];
export type CanvasAudioGenerationConfig = {
  model: string;
  voice?: string;
  format?: string;
  speed?: string | number;
  instructions?: string;
};
export type NormalizedCanvasAudioGenerationConfig = {
  model: string;
  voice: CanvasAudioVoice;
  format: CanvasAudioFormat;
  speed: string;
  instructions: string;
};

export function normalizeCanvasAudioGenerationConfig(
  config: CanvasAudioGenerationConfig,
): NormalizedCanvasAudioGenerationConfig {
  const speed = Number(config.speed);
  return {
    model: config.model.trim(),
    voice: AUDIO_VOICES.includes(config.voice as CanvasAudioVoice)
      ? config.voice as CanvasAudioVoice
      : "alloy",
    format: AUDIO_FORMATS.includes(config.format as CanvasAudioFormat)
      ? config.format as CanvasAudioFormat
      : "mp3",
    speed: Number.isFinite(speed)
      ? String(Math.max(0.25, Math.min(4, Number(speed.toFixed(2)))))
      : "1",
    instructions: (config.instructions || "").trim(),
  };
}

export function canvasAudioMimeType(format: string) {
  const normalized = AUDIO_FORMATS.includes(format as CanvasAudioFormat)
    ? format as CanvasAudioFormat
    : "mp3";
  if (normalized === "wav") return "audio/wav";
  if (normalized === "opus") return "audio/opus";
  if (normalized === "aac") return "audio/aac";
  if (normalized === "flac") return "audio/flac";
  if (normalized === "pcm") return "audio/pcm";
  return "audio/mpeg";
}
