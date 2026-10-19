import {
  audioFormatOptionsForModel,
  isCosyVoiceAudioModel,
  isMiniMaxAudioModel,
  normalizeAudioVoiceValue,
} from "@/shared/config/audio";

const AUDIO_FORMATS = ["mp3", "wav", "opus", "aac", "flac"] as const;

export type CanvasAudioVoice = string;
export type CanvasAudioFormat = (typeof AUDIO_FORMATS)[number];
export type CanvasAudioGenerationConfig = {
  model: string;
  voice?: string;
  format?: string;
  speed?: string | number;
  instructions?: string;
  emotion?: string;
  lyrics?: string;
  gender?: string;
  isInstrumental?: boolean;
};
export type NormalizedCanvasAudioGenerationConfig = {
  model: string;
  voice: CanvasAudioVoice;
  format: CanvasAudioFormat;
  speed: string;
  instructions: string;
  emotion?: string;
  lyrics?: string;
  gender?: string;
  isInstrumental?: boolean;
};

export function normalizeCanvasAudioGenerationConfig(
  config: CanvasAudioGenerationConfig
): NormalizedCanvasAudioGenerationConfig {
  const model = config.model.trim();
  const speed = Number(config.speed);
  const defaultVoice = isCosyVoiceAudioModel(model)
    ? "longanyang"
    : isMiniMaxAudioModel(model)
      ? "male-qn-qingse"
      : "alloy";
  const result: NormalizedCanvasAudioGenerationConfig = {
    model,
    voice: normalizeAudioVoiceValue(config.voice || defaultVoice, model),
    format: audioFormatOptionsForModel(model).some(
      item => item.value === config.format
    )
      ? (config.format as CanvasAudioFormat)
      : "mp3",
    speed: Number.isFinite(speed)
      ? String(Math.max(0.25, Math.min(4, Number(speed.toFixed(2)))))
      : "1",
    instructions: (config.instructions || "").trim(),
  };
  if (config.emotion && config.emotion.trim()) {
    result.emotion = config.emotion.trim();
  }
  if (config.lyrics && config.lyrics.trim()) {
    result.lyrics = config.lyrics.trim();
  }
  if (config.gender && config.gender.trim()) {
    result.gender = config.gender.trim();
  }
  if (typeof config.isInstrumental === "boolean") {
    result.isInstrumental = config.isInstrumental;
  }
  return result;
}

export function canvasAudioMimeType(format: string) {
  const normalized = AUDIO_FORMATS.includes(format as CanvasAudioFormat)
    ? (format as CanvasAudioFormat)
    : "mp3";
  if (normalized === "wav") return "audio/wav";
  if (normalized === "opus") return "audio/ogg";
  if (normalized === "aac") return "audio/aac";
  if (normalized === "flac") return "audio/flac";
  return "audio/mpeg";
}
