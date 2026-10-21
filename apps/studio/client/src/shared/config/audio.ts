// Audio model options and request normalization; pure, so Canvas domain and UI may import it.
export const audioVoiceOptions = [
  { value: "alloy", label: "Alloy" },
  { value: "ash", label: "Ash" },
  { value: "ballad", label: "Ballad" },
  { value: "coral", label: "Coral" },
  { value: "echo", label: "Echo" },
  { value: "fable", label: "Fable" },
  { value: "nova", label: "Nova" },
  { value: "onyx", label: "Onyx" },
  { value: "sage", label: "Sage" },
  { value: "shimmer", label: "Shimmer" },
  { value: "verse", label: "Verse" },
  { value: "marin", label: "Marin" },
  { value: "cedar", label: "Cedar" },
] as const;

export const cosyVoiceSystemOptions = [
  { value: "longanyang", label: "龙安洋 · 阳光青年男声（支持情绪指令）" },
  { value: "longanhuan_v3", label: "龙安欢 · 活泼元气女声（支持方言指令）" },
  { value: "longshange_v3", label: "龙陕哥 · 陕西话男声" },
  { value: "longxiaochun_v3", label: "龙小淳 · 温柔知性女声" },
  { value: "longwan_v3", label: "龙婉 · 治愈故事女声" },
  { value: "longcheng_v3", label: "龙橙 · 沉稳磁性男声" },
] as const;

export const miniMaxVoiceSystemOptions = [
  { value: "male-qn-qingse", label: "青涩青年男声（male-qn-qingse）" },
  { value: "male-qn-jingying", label: "精英青年男声（male-qn-jingying）" },
  { value: "male-qn-badao", label: "霸道总裁男声（male-qn-badao）" },
  { value: "female-shaonv", label: "灵动少女音（female-shaonv）" },
  { value: "female-yujie", label: "成熟御姐音（female-yujie）" },
  { value: "female-chengshu", label: "温柔成熟女声（female-chengshu）" },
  { value: "presenter_male", label: "磁性男主播（presenter_male）" },
  { value: "presenter_female", label: "知性女主播（presenter_female）" },
] as const;

export const miniMaxEmotionOptions = [
  { value: "", label: "自动匹配情绪" },
  { value: "happy", label: "高兴 (happy)" },
  { value: "sad", label: "悲伤 (sad)" },
  { value: "angry", label: "愤怒 (angry)" },
  { value: "fearful", label: "害怕 (fearful)" },
  { value: "surprised", label: "惊讶 (surprised)" },
  { value: "calm", label: "平静 (calm)" },
] as const;

// 复刻音色的下拉标签：有别名（用户克隆时取的名，支持中文）就突出别名，
// 尾号 4 位用来区分同名音色；没有别名回退到完整 ID。
export function clonedVoiceLabel(record: {
  voice_id?: string;
  alias?: string;
}): string {
  const id = (record.voice_id || "").trim();
  const alias = (record.alias || "").trim();
  if (alias) {
    return id ? `${alias}（…${id.slice(-4)}）` : alias;
  }
  return id ? `复刻音色 · ${id}` : "复刻音色";
}

export function isCosyVoiceAudioModel(model: string | undefined): boolean {
  const value = (model || "").toLowerCase();
  return (
    value.includes("cosyvoice") ||
    value.includes("qwen-audio") ||
    value.includes("qwen3-tts")
  );
}

export function isMiniMaxAudioModel(model: string | undefined): boolean {
  const value = (model || "").toLowerCase();
  return (
    value.includes("minimax/speech-") ||
    value.includes("speech-2.") ||
    value.includes("speech-02")
  );
}

const voiceCloneExtensions = ["mp3", "wav", "m4a"];

// 音色名称校验：名称是应用内的展示名（支持中文），长度限制即可。
// 阿里云对 prefix 的硬性要求（仅字母数字 ≤10 位）由 deriveVoiceClonePrefix 处理，
// 用户不需要接触。
export function voiceCloneNameProblem(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "请填写音色名称";
  if ([...trimmed].length > 30) return "音色名称最长 30 个字符";
  return "";
}

// 从用户名称派生发给服务商的技术前缀：名称本身合规（字母数字 ≤10 位）就直接用，
// 否则自动生成一个随机前缀；音色在应用内以别名展示，前缀只出现在服务商控制台。
export function deriveVoiceClonePrefix(name: string): string {
  const trimmed = name.trim();
  if (/^[a-zA-Z0-9]{1,10}$/.test(trimmed)) return trimmed;
  return `r${Date.now().toString(36).slice(-7)}`;
}

// Problems with the reference audio the user can fix before uploading; seconds is
// undefined when the browser cannot read the duration.
export function voiceCloneFileProblem(
  file: { name: string; size: number },
  seconds: number | undefined,
  model: string | undefined
): string {
  const miniMax = isMiniMaxAudioModel(model);
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (!voiceCloneExtensions.includes(extension)) {
    return "参考音频格式不支持：请使用 WAV（16 位）、MP3 或 M4A 文件";
  }
  const maxMB = miniMax ? 20 : 10;
  if (file.size > maxMB * 1024 * 1024) {
    return `参考音频文件太大（最大 ${maxMB} MB）：请截取一小段或压缩后重试`;
  }
  if (seconds === undefined) return "";
  const rounded = Math.round(seconds);
  if (miniMax) {
    if (seconds < 10) {
      return `参考音频只有 ${rounded} 秒，当前模型需要 10 秒到 5 分钟的录音`;
    }
    if (seconds > 300) {
      return `参考音频有 ${rounded} 秒，当前模型最长 5 分钟，请截取一段单人清晰说话的片段`;
    }
    return "";
  }
  // Bailian needs one continuous stretch of speech over 5s and at most 60s of audio.
  if (seconds <= 5) {
    return `参考音频只有 ${rounded} 秒，需要至少一段超过 5 秒的连续说话（推荐 10–20 秒）`;
  }
  if (seconds > 60) {
    return `参考音频有 ${rounded} 秒，最长 60 秒，请截取 10–20 秒单人清晰说话的片段`;
  }
  return "";
}

export function isFunMusicAudioModel(model: string | undefined): boolean {
  const value = (model || "").toLowerCase();
  return value.includes("fun-music");
}

export function audioVoiceOptionsForModel(
  model: string | undefined,
  clonedVoices: ReadonlyArray<{ value: string; label: string; model?: string }> = []
): Array<{ value: string; label: string }> {
  const custom = clonedVoices.filter(item => item.value.trim());
  // Callers pass the OpenAI voice names too; CosyVoice/MiniMax would silently
  // replace them with a default voice, so only real cloned voices are offered.
  const openAIVoices = new Set<string>(
    audioVoiceOptions.map(item => item.value)
  );
  const cloned = custom.filter(item => !openAIVoices.has(item.value));
  if (isCosyVoiceAudioModel(model)) {
    // A CosyVoice clone only works with its target model.
    const bareModel = (model || "").split("::").pop()!.trim().toLowerCase();
    return [
      ...cloned.filter(item => {
        const itemModel = (item.model || "").trim().toLowerCase();
        if (itemModel) return itemModel === bareModel;
        // 无 target_model 的老数据：cosyvoice 音色 ID 里内嵌目标模型
        const value = item.value.toLowerCase();
        return (
          !value.startsWith("cosyvoice-") || value.startsWith(`${bareModel}-`)
        );
      }),
      ...cosyVoiceSystemOptions,
    ];
  }
  if (isMiniMaxAudioModel(model)) {
    return [
      ...cloned.filter(item => {
        const itemModel = (item.model || "").trim().toLowerCase();
        if (itemModel) return isMiniMaxAudioModel(itemModel);
        const value = item.value.toLowerCase();
        return !value.startsWith("cosyvoice-") && !value.startsWith("cvoice-");
      }),
      ...miniMaxVoiceSystemOptions,
    ];
  }
  return [...custom, ...audioVoiceOptions];
}

export const audioFormatOptions = [
  { value: "mp3", label: "MP3" },
  { value: "wav", label: "WAV" },
  { value: "opus", label: "Opus" },
  { value: "aac", label: "AAC" },
  { value: "flac", label: "FLAC" },
] as const;

// CosyVoice returns only these containers; MiniMax has no AAC/Opus. Other
// choices would come back as MP3 while the file is named .aac/.flac.
// PCM is not offered: raw samples have no header, so the canvas player shows 0:00.
const cosyVoiceFormats = new Set<string>(["mp3", "wav", "opus"]);
const miniMaxFormats = new Set<string>(["mp3", "wav", "flac"]);

export function audioFormatOptionsForModel(model: string | undefined) {
  const supported = isCosyVoiceAudioModel(model)
    ? cosyVoiceFormats
    : isMiniMaxAudioModel(model)
      ? miniMaxFormats
      : null;
  return supported
    ? audioFormatOptions.filter(item => supported.has(item.value))
    : [...audioFormatOptions];
}

export type CosyVoiceInstructionMode = "free" | "dialect" | "emotion" | "none";

/** Which kind of instruction a CosyVoice voice accepts (Bailian voice list). */
export function cosyVoiceInstructionMode(
  voice: string | undefined
): CosyVoiceInstructionMode {
  const value = (voice || "").trim().toLowerCase();
  // cvoice- 是本地音色（cv3.5 复刻），支持指令
  if (/^cosyvoice-|^qwen-audio-|^cvoice-/.test(value)) return "free";
  if (value === "longanhuan_v3") return "dialect";
  if (value === "longanyang" || value === "longanhuan") return "emotion";
  return "none";
}

export type AudioVoiceValue = string;
export type AudioFormatValue = (typeof audioFormatOptions)[number]["value"];

export type AudioGenerationConfig = {
  model: string;
  voice?: string;
  format?: string;
  speed?: string | number;
  instructions?: string;
  emotion?: string;
  lyrics?: string;
  gender?: "female" | "male" | string;
  isInstrumental?: boolean;
};

export type NormalizedAudioGenerationConfig = {
  model: string;
  voice: AudioVoiceValue;
  format: AudioFormatValue;
  speed: string;
  instructions: string;
  emotion?: string;
  lyrics?: string;
  gender?: string;
  isInstrumental?: boolean;
};

const knownNonOpenAIVoiceValues = new Set<string>([
  ...cosyVoiceSystemOptions.map(item => item.value),
  ...miniMaxVoiceSystemOptions.map(item => item.value),
]);

export function normalizeAudioVoiceValue(
  value: string | undefined,
  model?: string
): AudioVoiceValue {
  const trimmed = (value || "").trim();
  if (audioVoiceOptions.some(item => item.value === trimmed)) {
    return trimmed;
  }
  if (
    trimmed &&
    (knownNonOpenAIVoiceValues.has(trimmed) ||
      /^cosyvoice-|^qwen-audio-|^BailianVoice|^MiniMax|^cvoice-/i.test(trimmed) ||
      isCosyVoiceAudioModel(model) ||
      isMiniMaxAudioModel(model))
  ) {
    return trimmed;
  }
  if (isCosyVoiceAudioModel(model)) return "longanyang";
  if (isMiniMaxAudioModel(model)) return "male-qn-qingse";
  return "alloy";
}

export function normalizeAudioFormatValue(
  value: string | undefined,
  model?: string
): AudioFormatValue {
  const options = model
    ? audioFormatOptionsForModel(model)
    : audioFormatOptions;
  return options.some(item => item.value === value)
    ? (value as AudioFormatValue)
    : "mp3";
}

export function normalizeAudioSpeedValue(value: string | number | undefined) {
  const speed = Number(value);
  if (!Number.isFinite(speed)) return "1";
  return String(Math.max(0.25, Math.min(4, Number(speed.toFixed(2)))));
}

export function normalizeAudioGenerationConfig(
  config: AudioGenerationConfig
): NormalizedAudioGenerationConfig {
  const model = config.model.trim();
  const base: NormalizedAudioGenerationConfig = {
    model,
    voice: normalizeAudioVoiceValue(config.voice, model),
    format: normalizeAudioFormatValue(config.format, model),
    speed: normalizeAudioSpeedValue(config.speed),
    instructions: (config.instructions || "").trim(),
  };
  // A CosyVoice voice without Instruct support fails the whole request.
  if (
    isCosyVoiceAudioModel(model) &&
    cosyVoiceInstructionMode(base.voice) === "none"
  ) {
    base.instructions = "";
  }
  if (config.emotion && config.emotion.trim()) {
    base.emotion = config.emotion.trim();
  }
  if (config.lyrics && config.lyrics.trim()) {
    base.lyrics = config.lyrics.trim();
  }
  if (config.gender && config.gender.trim()) {
    base.gender = config.gender.trim();
  }
  if (typeof config.isInstrumental === "boolean") {
    base.isInstrumental = config.isInstrumental;
  }
  return base;
}

export function audioMimeType(format: string) {
  const normalized = normalizeAudioFormatValue(format);
  if (normalized === "wav") return "audio/wav";
  if (normalized === "opus") return "audio/ogg";
  if (normalized === "aac") return "audio/aac";
  if (normalized === "flac") return "audio/flac";
  return "audio/mpeg";
}

export function audioFileName(name: string, format: string) {
  const clean =
    name
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .slice(0, 80) || "generated-audio";
  if (/\.(mp3|wav|opus|aac|flac|pcm)$/i.test(clean)) return clean;
  return `${clean}.${normalizeAudioFormatValue(format)}`;
}
