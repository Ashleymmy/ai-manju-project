import { getAssetContentObjectUrl } from "./assets";
import { getJob, isTerminalJob, jobErrorMessage, type Job } from "./jobs";
import type { WorkspaceScope } from "./projects";
import { API_BASE_URL, getAuthToken, request } from "./request";

export type VideoProvider = "openai" | "seedance";

export type VideoGenerationConfig = {
  model: string;
  size: string;
  resolution: string;
  seconds: string;
  generateAudio: boolean;
  watermark: boolean;
};

export type VideoGenerationTask = {
  id: string;
  provider: VideoProvider;
  model: string;
};

export type VideoGenerationImageReference = {
  id: string;
  kind: "image";
  file?: File;
  url?: string;
  name: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
};

export type VideoGenerationVideoReference = {
  id: string;
  kind: "video";
  file?: File;
  url?: string;
  name: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  durationMs: number;
};

export type VideoGenerationAudioReference = {
  id: string;
  kind: "audio";
  file?: File;
  url?: string;
  name: string;
  mime: string;
  bytes: number;
  durationMs: number;
};

export type VideoGenerationReferences = {
  images: VideoGenerationImageReference[];
  videos: VideoGenerationVideoReference[];
  audios: VideoGenerationAudioReference[];
};

export type VideoGenerationResult = {
  url: string;
  mimeType?: string;
  fileName?: string;
  assetId?: string;
  scope?: WorkspaceScope;
  ephemeral?: boolean;
};

export type VideoGenerationTaskState =
  | { status: "pending"; progress?: number }
  | { status: "completed"; result: VideoGenerationResult }
  | { status: "failed"; error: string };

type RequestOptions = {
  signal?: AbortSignal;
  onProgress?: (job: Job) => void;
};

type JobSubmission = { id?: string; job_id?: string };

type SeedanceTask = {
  id: string;
  status?: string;
  state?: string;
  error?: string | { code?: string; message?: string; error?: string; detail?: string } | null;
  error_message?: string;
  message?: string;
  content?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
};

type ApiEnvelope<T> = T | {
  code?: number;
  data?: T | null;
  msg?: string;
  error?: string | { message?: string };
};

const seedanceResolutions = ["480p", "720p", "1080p"] as const;
const seedanceRatios = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"] as const;
const emptyReferences: VideoGenerationReferences = { images: [], videos: [], audios: [] };
const seedanceImageDataUrlMaxBytes = 1800 * 1024;
const seedanceImageDataUrlMaxEdge = 1280;
const wanImageMinEdge = 300;
const wanImageMaxEdge = 8000;
const seedanceImageCompressionSteps = [
  { edge: 1280, quality: 0.78 },
  { edge: 1024, quality: 0.72 },
  { edge: 896, quality: 0.66 },
  { edge: 768, quality: 0.6 },
  { edge: 640, quality: 0.56 },
  { edge: 512, quality: 0.52 },
] as const;

export const videoReferenceLimits = {
  openAiImages: 7,
  images: 9,
  videos: 3,
  audios: 3,
  imageMaxBytes: 30 * 1024 * 1024,
  videoMaxBytes: 50 * 1024 * 1024,
  audioMaxBytes: 15 * 1024 * 1024,
  mediaMinDurationMs: 2_000,
  mediaMaxDurationMs: 15_000,
  mediaMaxTotalDurationMs: 15_000,
  videoMinEdge: 300,
  videoMaxEdge: 6000,
  videoMinRatio: 0.4,
  videoMaxRatio: 2.5,
  videoMinPixels: 640 * 640,
  videoMaxPixels: 2206 * 946,
} as const;

export const videoModelSettings = {
  seedanceResolutions,
  seedanceRatios,
  seedanceDurations: [-1, 4, 5, 6, 8, 10, 12, 15],
  seedanceLongDurations: [-1, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30],
  openAiSizes: ["1280x720", "720x1280", "1024x1024", "1792x1024", "1024x1792", "auto"],
  openAiResolutions: ["480p", "720p", "1080p"],
  openAiDurations: [6, 10, 12, 16, 20],
} as const;

export function modelOptionName(value: string) {
  const trimmed = String(value || "").trim();
  const separator = trimmed.indexOf("::");
  return separator >= 0 ? trimmed.slice(separator + 2).trim() : trimmed;
}

export function isSeedanceVideoModel(model: string) {
  const value = modelOptionName(model).toLowerCase();
  return value.includes("seedance") || value.includes("doubao-seedance") || value.includes("wan3");
}

export function isSeedanceFastVideoModel(model: string) {
  const value = modelOptionName(model).toLowerCase();
  return isSeedanceVideoModel(value) && value.includes("fast");
}

export function isWanVideoModel(model: string) {
  const value = modelOptionName(model).toLowerCase();
  return value.includes("wan3");
}

export function isLongSeedanceVideoModel(model: string) {
  const value = modelOptionName(model).toLowerCase();
  return value.includes("wan3") || value.includes("seedance-2-5") || value.includes("seedance-2.5") || value.includes("seedance_2_5");
}

export function normalizeVideoGenerationConfig(config: VideoGenerationConfig): VideoGenerationConfig {
  const seedance = isSeedanceVideoModel(config.model);
  return {
    model: config.model.trim(),
    size: seedance ? normalizeSeedanceRatio(config.size) : normalizeVideoSizeValue(config.size),
    resolution: seedance
      ? normalizeSeedanceResolution(config.resolution, config.model)
      : normalizeVideoResolutionName(config.resolution),
    seconds: seedance
      ? String(normalizeSeedanceDuration(config.seconds, config.model))
      : normalizeOpenAiSeconds(config.seconds),
    generateAudio: Boolean(config.generateAudio),
    watermark: Boolean(config.watermark),
  };
}

export function normalizeVideoSizeValue(value: string) {
  if (value === "auto") return "auto";
  if (/^\d+x\d+$/.test(value || "")) return value;
  return ["9:16", "2:3", "3:4"].includes(value) ? "720x1280" : "1280x720";
}

export function normalizeVideoResolutionName(value: string) {
  if (value === "480" || value === "480p" || value === "low") return "480p";
  if (value === "1080" || value === "1080p") return "1080p";
  if (value === "720" || value === "720p" || value === "auto" || value === "high" || value === "medium") return "720p";
  const numeric = String(value || "").trim().replace(/p$/i, "");
  if (/^\d+$/.test(numeric)) return `${Math.max(1, Math.floor(Number(numeric)))}p`;
  return "720p";
}

export function normalizeSeedanceResolution(value: string, model = "") {
  const normalized = normalizeVideoResolutionName(value);
  if (isSeedanceFastVideoModel(model) && normalized === "1080p") return "720p";
  return seedanceResolutions.includes(normalized as (typeof seedanceResolutions)[number]) ? normalized : "720p";
}

export function normalizeSeedanceRatio(value: string) {
  if (!value || value === "auto" || value === "adaptive") return "adaptive";
  if (seedanceRatios.includes(value as (typeof seedanceRatios)[number])) return value;
  const match = value.match(/^(\d+)x(\d+)$/);
  if (!match) return "adaptive";
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return "adaptive";
  const ratio = width / height;
  const options = [
    ["16:9", 16 / 9],
    ["4:3", 4 / 3],
    ["1:1", 1],
    ["3:4", 3 / 4],
    ["9:16", 9 / 16],
    ["21:9", 21 / 9],
  ] as const;
  return options.reduce(
    (best, item) => Math.abs(item[1] - ratio) < Math.abs(best[1] - ratio) ? item : best,
    options[0],
  )[0];
}

export function normalizeSeedanceDuration(value: string, model = "") {
  if (String(value).trim() === "-1") return -1;
  const seconds = Math.floor(Number(value) || 5);
  return Math.max(4, Math.min(isLongSeedanceVideoModel(model) ? 30 : 15, seconds));
}

export async function createVideoGenerationTask(
  config: VideoGenerationConfig,
  prompt: string,
  references: VideoGenerationReferences = emptyReferences,
  options: RequestOptions = {},
): Promise<VideoGenerationTask> {
  const normalized = normalizeVideoGenerationConfig(config);
  const referenceSnapshot = normalizeReferences(references);
  if (!normalized.model) throw new Error("请先配置视频模型");
  const text = prompt.trim();
  if (!text) throw new Error("请输入视频提示词");
  validateVideoGenerationReferences(referenceSnapshot, normalized.model);
  return isSeedanceVideoModel(normalized.model)
    ? createSeedanceTask(normalized, text, referenceSnapshot, options)
    : createOpenAiVideoTask(normalized, text, referenceSnapshot, options);
}

export function validateVideoGenerationReferences(
  references: VideoGenerationReferences,
  model: string,
) {
  const seedance = isSeedanceVideoModel(model);
  if (references.images.length > videoReferenceLimits.images) throw new Error("参考图片最多 9 张");
  if (references.videos.length > videoReferenceLimits.videos) throw new Error("参考视频最多 3 个");
  if (references.audios.length > videoReferenceLimits.audios) throw new Error("参考音频最多 3 个");
  if (!seedance) {
    if (references.videos.length || references.audios.length) {
      throw new Error("OpenAI-compatible 视频模型仅支持参考图片，请移除参考视频/音频或切换 Seedance/Wan 模型");
    }
    if (references.images.length > videoReferenceLimits.openAiImages) {
      throw new Error("OpenAI-compatible 视频模型最多支持 7 张参考图片");
    }
  }
  if (references.audios.length && !references.images.length && !references.videos.length) {
    throw new Error("Seedance 参考音频不能单独使用，请同时添加参考图或参考视频");
  }
  references.images.forEach((reference, index) => {
    if (isAssetReference(reference.url)) {
      if (!seedance) throw new Error("asset:// 素材引用仅支持 Seedance / 火山视频模型");
      return;
    }
    if (!reference.file) throw new Error(`参考图片${index + 1}读取失败`);
    if (!isSupportedImageReference(reference)) throw new Error(`参考图片${index + 1}格式不支持，请使用图片文件`);
    if (!Number.isFinite(reference.bytes) || reference.bytes <= 0) throw new Error(`参考图片${index + 1}读取失败`);
    if (reference.bytes > videoReferenceLimits.imageMaxBytes) throw new Error(`参考图片${index + 1}超过 30MB`);
  });
  let videoDurationMs = 0;
  references.videos.forEach((reference, index) => {
    if (isAssetReference(reference.url)) {
      if (!seedance) throw new Error("asset:// 素材引用仅支持 Seedance / 火山视频模型");
      return;
    }
    if (!reference.file) throw new Error(`参考视频${index + 1}读取失败`);
    if (!isSupportedVideoReference(reference)) throw new Error(`参考视频${index + 1}格式不支持，请使用 mp4/mov`);
    if (!Number.isFinite(reference.bytes) || reference.bytes <= 0) throw new Error(`参考视频${index + 1}读取失败`);
    if (reference.bytes > videoReferenceLimits.videoMaxBytes) throw new Error(`参考视频${index + 1}超过 50MB`);
    assertReferenceDuration(reference.durationMs, `参考视频${index + 1}`);
    assertReferenceVideoGeometry(reference, index);
    videoDurationMs += reference.durationMs;
  });
  if (videoDurationMs > videoReferenceLimits.mediaMaxTotalDurationMs) throw new Error("参考视频总时长不能超过 15 秒");
  let audioDurationMs = 0;
  references.audios.forEach((reference, index) => {
    if (isAssetReference(reference.url)) {
      if (!seedance) throw new Error("asset:// 素材引用仅支持 Seedance / 火山视频模型");
      return;
    }
    if (!reference.file) throw new Error(`参考音频${index + 1}读取失败`);
    if (!isSupportedAudioReference(reference)) throw new Error(`参考音频${index + 1}格式不支持，请使用 mp3/wav`);
    if (!Number.isFinite(reference.bytes) || reference.bytes <= 0) throw new Error(`参考音频${index + 1}读取失败`);
    if (reference.bytes > videoReferenceLimits.audioMaxBytes) throw new Error(`参考音频${index + 1}超过 15MB`);
    assertReferenceDuration(reference.durationMs, `参考音频${index + 1}`);
    audioDurationMs += reference.durationMs;
  });
  if (audioDurationMs > videoReferenceLimits.mediaMaxTotalDurationMs) throw new Error("参考音频总时长不能超过 15 秒");
}

export async function pollVideoGenerationTask(
  config: VideoGenerationConfig,
  task: VideoGenerationTask,
  options: RequestOptions = {},
): Promise<VideoGenerationTaskState> {
  if (!(task.model || config.model).trim()) throw new Error("请先配置视频模型");
  return task.provider === "seedance"
    ? pollSeedanceTask(task, options)
    : pollOpenAiVideoTask(task, options);
}

async function createOpenAiVideoTask(
  config: VideoGenerationConfig,
  prompt: string,
  references: VideoGenerationReferences,
  options: RequestOptions,
): Promise<VideoGenerationTask> {
  if (references.videos.length || references.audios.length) {
    throw new Error("OpenAI-compatible 视频模型仅支持参考图片，请移除参考视频/音频或切换 Seedance/Wan 模型");
  }
  if (references.images.length > videoReferenceLimits.openAiImages) {
    throw new Error("OpenAI-compatible 视频模型最多支持 7 张参考图片");
  }
  const body = new FormData();
  body.append("model", config.model);
  body.append("prompt", prompt);
  body.append("seconds", normalizeOpenAiSeconds(config.seconds));
  body.append("size", normalizeVideoSizeValue(config.size));
  body.append("resolution_name", normalizeVideoResolutionName(config.resolution));
  body.append("preset", "normal");
  references.images.forEach((reference) => {
    if (!reference.file) throw new Error("OpenAI-compatible 视频模型不支持 asset:// 图片素材");
    body.append("input_reference[]", reference.file, reference.name);
  });
  const created = await request<JobSubmission>("/api/ai/videos", {
    method: "POST",
    body,
    signal: options.signal,
    timeoutMs: 30_000,
  });
  const id = created.job_id || created.id || "";
  if (!id) throw new Error("视频接口没有返回任务 ID");
  return { id, provider: "openai", model: config.model };
}

async function createSeedanceTask(
  config: VideoGenerationConfig,
  prompt: string,
  references: VideoGenerationReferences,
  options: RequestOptions,
): Promise<VideoGenerationTask> {
  const content = await buildSeedanceContent(config, prompt, references);
  const created = unwrapSeedanceTask(await request<ApiEnvelope<SeedanceTask>>(
    "/api/ai/contents/generations/tasks",
    {
      method: "POST",
      body: {
        model: config.model,
        content,
        ratio: normalizeSeedanceRatio(config.size),
        resolution: normalizeSeedanceResolution(config.resolution, config.model),
        duration: normalizeSeedanceDuration(config.seconds, config.model),
        generate_audio: config.generateAudio,
        watermark: config.watermark,
      },
      signal: options.signal,
      timeoutMs: 30_000,
    },
  ));
  if (!created.id) throw new Error("Seedance 接口没有返回任务 ID");
  return { id: created.id, provider: "seedance", model: config.model };
}

async function buildSeedanceContent(
  config: VideoGenerationConfig,
  prompt: string,
  references: VideoGenerationReferences,
) {
  const content: Array<Record<string, unknown>> = [{
    type: "text",
    text: buildReferencePromptText(prompt, references),
  }];
  const imageBudgetBytes = seedanceImageReferenceBudget(references.images.length);
  const wanImage = isWanVideoModel(config.model);
  for (const reference of references.images) {
    content.push({
      type: "image_url",
      image_url: { url: await resolveSeedanceImageReference(reference, imageBudgetBytes, wanImage) },
      role: "reference_image",
    });
  }
  for (const reference of references.videos) {
    content.push({
      type: "video_url",
      video_url: { url: isAssetReference(reference.url) ? reference.url : await fileToDataUrl(requiredReferenceFile(reference.file, "参考视频")) },
      role: "reference_video",
    });
  }
  for (const reference of references.audios) {
    content.push({
      type: "audio_url",
      audio_url: { url: isAssetReference(reference.url) ? reference.url : await fileToDataUrl(requiredReferenceFile(reference.file, "参考音频")) },
      role: "reference_audio",
    });
  }
  return content;
}

function buildReferencePromptText(prompt: string, references: VideoGenerationReferences) {
  const labels = [
    ...references.images.map((_, index) => `图片${index + 1}`),
    ...references.videos.map((_, index) => `视频${index + 1}`),
    ...references.audios.map((_, index) => `音频${index + 1}`),
  ];
  return labels.length
    ? `参考素材编号：${labels.join("、")}。请按这些编号理解提示词中的图片、视频和音频引用。\n\n${prompt}`
    : prompt;
}

function normalizeReferences(references?: VideoGenerationReferences): VideoGenerationReferences {
  return {
    images: (references?.images || []).map((item) => ({ ...item })),
    videos: (references?.videos || []).map((item) => ({ ...item })),
    audios: (references?.audios || []).map((item) => ({ ...item })),
  };
}

function seedanceImageReferenceBudget(count: number) {
  return Math.max(220 * 1024, Math.floor(seedanceImageDataUrlMaxBytes / Math.max(1, count)));
}

async function resolveSeedanceImageReference(
  reference: VideoGenerationImageReference,
  targetBytes: number,
  wanImage: boolean,
) {
  if (isAssetReference(reference.url)) return reference.url;
  let dataUrl = await fileToDataUrl(requiredReferenceFile(reference.file, "参考图片"));
  if (wanImage) dataUrl = await normalizeWanImageDataUrl(dataUrl, reference.width, reference.height);
  return compressImageDataUrl(dataUrl, targetBytes, wanImage);
}

async function normalizeWanImageDataUrl(dataUrl: string, width: number, height: number) {
  const sourceWidth = Math.max(1, Math.floor(width || 1));
  const sourceHeight = Math.max(1, Math.floor(height || 1));
  const scale = Math.min(1, wanImageMaxEdge / Math.max(sourceWidth, sourceHeight));
  const drawWidth = Math.max(1, Math.round(sourceWidth * scale));
  const drawHeight = Math.max(1, Math.round(sourceHeight * scale));
  const canvasWidth = Math.max(wanImageMinEdge, drawWidth);
  const canvasHeight = Math.max(wanImageMinEdge, drawHeight);
  if (scale === 1 && canvasWidth === sourceWidth && canvasHeight === sourceHeight) return dataUrl;
  return resizeImageDataUrl(dataUrl, canvasWidth, canvasHeight, drawWidth, drawHeight, 0.92);
}

async function compressImageDataUrl(dataUrl: string, targetBytes: number, wanImage: boolean) {
  const meta = await readImageDataUrlMeta(dataUrl);
  const sourceBytes = dataUrlByteSize(dataUrl);
  if (sourceBytes > 0 && sourceBytes <= targetBytes) return dataUrl;
  let bestDataUrl = dataUrl;
  let bestBytes = sourceBytes || Number.MAX_SAFE_INTEGER;
  for (const step of seedanceImageCompressionSteps) {
    const scale = Math.min(1, step.edge / Math.max(meta.width, meta.height, seedanceImageDataUrlMaxEdge));
    const drawWidth = Math.max(1, Math.round(meta.width * scale));
    const drawHeight = Math.max(1, Math.round(meta.height * scale));
    const canvasWidth = wanImage ? Math.max(wanImageMinEdge, drawWidth) : drawWidth;
    const canvasHeight = wanImage ? Math.max(wanImageMinEdge, drawHeight) : drawHeight;
    const candidate = await resizeImageDataUrl(dataUrl, canvasWidth, canvasHeight, drawWidth, drawHeight, step.quality);
    const candidateBytes = dataUrlByteSize(candidate);
    if (candidateBytes > 0 && candidateBytes < bestBytes) {
      bestDataUrl = candidate;
      bestBytes = candidateBytes;
    }
    if (candidateBytes > 0 && candidateBytes <= targetBytes) return candidate;
  }
  if (bestBytes <= targetBytes) return bestDataUrl;
  throw new Error(`参考图压缩后仍超过 ${(targetBytes / 1024 / 1024).toFixed(1)}MB，请先压缩图片`);
}

async function resizeImageDataUrl(
  dataUrl: string,
  canvasWidth: number,
  canvasHeight: number,
  drawWidth: number,
  drawHeight: number,
  quality: number,
) {
  const image = await loadImageElement(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器无法处理参考图");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvasWidth, canvasHeight);
  context.drawImage(image, (canvasWidth - drawWidth) / 2, (canvasHeight - drawHeight) / 2, drawWidth, drawHeight);
  return canvas.toDataURL("image/jpeg", quality);
}

async function readImageDataUrlMeta(dataUrl: string) {
  const image = await loadImageElement(dataUrl);
  return { width: image.naturalWidth || image.width, height: image.naturalHeight || image.height };
}

function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("参考图读取失败，请换一张图片或重新上传"));
    image.src = src;
  });
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || "");
      if (value.startsWith("data:")) resolve(value);
      else reject(new Error("读取本地参考素材失败"));
    };
    reader.onerror = () => reject(new Error("读取本地参考素材失败"));
    reader.readAsDataURL(file);
  });
}

function isAssetReference(value?: string) {
  return Boolean(value?.startsWith("asset://"));
}

function requiredReferenceFile(file: File | undefined, label: string) {
  if (!file) throw new Error(`${label}读取失败`);
  return file;
}

function dataUrlByteSize(dataUrl: string) {
  const base64 = dataUrl.split(",", 2)[1] || "";
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function assertReferenceDuration(durationMs: number, label: string) {
  if (
    !Number.isFinite(durationMs)
    || durationMs < videoReferenceLimits.mediaMinDurationMs
    || durationMs > videoReferenceLimits.mediaMaxDurationMs
  ) {
    throw new Error(`${label}时长需要在 2-15 秒之间`);
  }
}

function assertReferenceVideoGeometry(reference: VideoGenerationVideoReference, index: number) {
  const label = `参考视频${index + 1}`;
  if (
    !Number.isFinite(reference.width)
    || !Number.isFinite(reference.height)
    || reference.width < videoReferenceLimits.videoMinEdge
    || reference.width > videoReferenceLimits.videoMaxEdge
    || reference.height < videoReferenceLimits.videoMinEdge
    || reference.height > videoReferenceLimits.videoMaxEdge
  ) throw new Error(`${label}宽高需要在 300-6000px 之间`);
  const ratio = reference.width / reference.height;
  if (ratio < videoReferenceLimits.videoMinRatio || ratio > videoReferenceLimits.videoMaxRatio) {
    throw new Error(`${label}宽高比需要在 0.4-2.5 之间`);
  }
  const pixels = reference.width * reference.height;
  if (pixels < videoReferenceLimits.videoMinPixels || pixels > videoReferenceLimits.videoMaxPixels) {
    throw new Error(`${label}像素总量不符合 Seedance 要求，请转成 480p/720p/1080p 后再上传`);
  }
}

function isSupportedImageReference(reference: Pick<VideoGenerationImageReference, "mime" | "name">) {
  return reference.mime.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(reference.name);
}

function isSupportedVideoReference(reference: Pick<VideoGenerationVideoReference, "mime" | "name">) {
  return reference.mime === "video/mp4" || reference.mime === "video/quicktime" || /\.(mp4|mov)$/i.test(reference.name);
}

function isSupportedAudioReference(reference: Pick<VideoGenerationAudioReference, "mime" | "name">) {
  return ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav"].includes(reference.mime)
    || /\.(mp3|wav)$/i.test(reference.name);
}

async function pollOpenAiVideoTask(
  task: VideoGenerationTask,
  options: RequestOptions,
): Promise<VideoGenerationTaskState> {
  if (options.signal?.aborted) throw abortError();
  const job = await getJob(task.id);
  if (options.signal?.aborted) throw abortError();
  options.onProgress?.(job);
  if (job.status === "succeeded") {
    return { status: "completed", result: await videoResultFromCompletedJob(job, options) };
  }
  if (isTerminalJob(job)) {
    return { status: "failed", error: jobErrorMessage(job, "视频生成失败") };
  }
  return { status: "pending", progress: job.progress };
}

async function pollSeedanceTask(
  task: VideoGenerationTask,
  options: RequestOptions,
): Promise<VideoGenerationTaskState> {
  const state = unwrapSeedanceTask(await request<ApiEnvelope<SeedanceTask>>(
    `/api/ai/contents/generations/tasks/${encodeURIComponent(task.id)}`,
    {
      query: { model: task.model },
      signal: options.signal,
      timeoutMs: 30_000,
    },
  ));
  const status = (state.status || state.state || "").toLowerCase();
  if (status === "succeeded" || status === "success" || status === "completed") {
    return {
      status: "completed",
      result: await videoResultFromSeedanceTaskContent(task, seedanceVideoUrl(state), options),
    };
  }
  if (["failed", "cancelled", "canceled", "expired"].includes(status)) {
    return { status: "failed", error: seedanceErrorMessage(state, status) };
  }
  return { status: "pending" };
}

async function videoResultFromCompletedJob(
  job: Job,
  options: RequestOptions,
): Promise<VideoGenerationResult> {
  const output = firstVideoOutput(job.result);
  if (!output) throw new Error("视频任务没有返回可播放结果");
  const scope = job.scope || "personal";
  const mimeType = stringValue(output.content_type) || stringValue(output.mimeType) || "video/mp4";
  const fileName = stringValue(output.file_name)
    || stringValue(output.filename)
    || stringValue(output.name)
    || job.name?.trim()
    || undefined;
  const assetId = stringValue(output.asset_id) || stringValue(output.id);
  const assetUrl = stringValue(output.asset_url);
  const remoteUrl = stringValue(output.remote_url)
    || stringValue(output.provider_url)
    || stringValue(output.video_url)
    || stringValue(output.url);
  if (assetId) {
    const url = await getAssetContentObjectUrl(assetId, scope, undefined, options.signal);
    if (options.signal?.aborted) {
      URL.revokeObjectURL(url);
      throw abortError();
    }
    return { url, mimeType, fileName, assetId, scope, ephemeral: true };
  }
  if (assetUrl) {
    return {
      url: await videoObjectUrlFromAuthenticatedUrl(assetUrl, mimeType, options),
      mimeType,
      fileName,
      scope,
      ephemeral: true,
    };
  }
  if (isTrustedRemoteVideoUrl(remoteUrl)) {
    return { url: remoteUrl, mimeType, fileName, scope, ephemeral: true };
  }
  throw new Error("视频任务没有返回可播放结果");
}

async function videoResultFromSeedanceTaskContent(
  task: VideoGenerationTask,
  fallbackUrl: string,
  options: RequestOptions,
): Promise<VideoGenerationResult> {
  try {
    const url = await videoObjectUrlFromAuthenticatedUrl(
      `/api/ai/contents/generations/tasks/${encodeURIComponent(task.id)}/content?model=${encodeURIComponent(task.model)}`,
      "video/mp4",
      options,
    );
    return { url, mimeType: "video/mp4", scope: "personal", ephemeral: true };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (isTrustedRemoteVideoUrl(fallbackUrl)) {
      return { url: fallbackUrl, mimeType: "video/mp4", scope: "personal", ephemeral: true };
    }
    throw error instanceof Error ? error : new Error("Seedance 视频内容下载失败");
  }
}

export async function videoGenerationResultToBlob(
  result: VideoGenerationResult,
  signal?: AbortSignal,
) {
  if (!result.url) throw new Error("视频结果没有可下载地址");
  const target = new URL(result.url, `${API_BASE_URL}/`);
  const apiOrigin = new URL(API_BASE_URL).origin;
  const authenticated = target.protocol === "http:" || target.protocol === "https:"
    ? target.origin === apiOrigin
    : false;
  const token = authenticated ? getAuthToken() : null;
  const response = await fetch(target, {
    credentials: authenticated ? "include" : "omit",
    signal,
    headers: {
      Accept: "video/*,application/octet-stream;q=0.9,*/*;q=0.1",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`视频内容下载失败：${response.status}`);
  const blob = await response.blob();
  if (signal?.aborted) throw abortError();
  return blob.type ? blob : new Blob([blob], { type: result.mimeType || "video/mp4" });
}

async function videoObjectUrlFromAuthenticatedUrl(
  url: string,
  mimeType: string,
  options: RequestOptions,
) {
  const target = new URL(url, `${API_BASE_URL}/`);
  const apiOrigin = new URL(API_BASE_URL).origin;
  const authenticated = target.origin === apiOrigin;
  const token = authenticated ? getAuthToken() : null;
  const response = await fetch(target, {
    credentials: authenticated ? "include" : "omit",
    signal: options.signal,
    headers: {
      Accept: "video/*,application/octet-stream;q=0.9,*/*;q=0.1",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`视频内容下载失败：${response.status}`);
  const blob = await response.blob();
  if (options.signal?.aborted) throw abortError();
  return URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: mimeType }));
}

function firstVideoOutput(result: unknown): Record<string, unknown> | null {
  if (Array.isArray(result)) return result.find(isRecord) || null;
  if (!isRecord(result)) return null;
  const outputs = Array.isArray(result.outputs) ? result.outputs.filter(isRecord) : [];
  if (outputs.length) return outputs[0];
  const assets = Array.isArray(result.assets) ? result.assets.filter(isRecord) : [];
  if (assets.length) return { ...assets[0], asset_id: assets[0].id, asset_url: assets[0].url };
  return result;
}

function unwrapSeedanceTask(payload: ApiEnvelope<SeedanceTask>) {
  if (!payload) throw new Error("Seedance 接口没有返回任务");
  if (isRecord(payload) && "code" in payload && typeof payload.code === "number") {
    if (payload.code !== 0) throw new Error(seedanceEnvelopeError(payload));
    if (!payload.data || !isRecord(payload.data)) throw new Error("Seedance 接口没有返回任务");
    return payload.data as SeedanceTask;
  }
  return payload as SeedanceTask;
}

function seedanceEnvelopeError(payload: Record<string, unknown>) {
  if (typeof payload.msg === "string" && payload.msg.trim()) return payload.msg;
  const error = payload.error;
  if (typeof error === "string" && error.trim()) return error;
  if (isRecord(error) && typeof error.message === "string" && error.message.trim()) return error.message;
  return "Seedance 请求失败";
}

function seedanceVideoUrl(task: SeedanceTask) {
  const content = task.content || task.result || {};
  return stringValue(content.video_url)
    || stringValue(content.videoUrl)
    || stringValue(content.output_url)
    || stringValue(content.download_url)
    || stringValue(content.url);
}

function seedanceErrorMessage(task: SeedanceTask, status: string) {
  if (task.error_message?.trim()) return task.error_message;
  if (typeof task.error === "string" && task.error.trim()) return task.error;
  if (task.error && typeof task.error === "object") {
    return task.error.message
      || task.error.error
      || task.error.detail
      || task.error.code
      || "Seedance 视频生成失败";
  }
  if (task.message?.trim()) return task.message;
  if (status === "expired") return "Seedance 视频生成超时";
  if (status === "cancelled" || status === "canceled") return "Seedance 视频任务已取消";
  return "Seedance 视频生成失败";
}

function normalizeOpenAiSeconds(value: string) {
  if (String(value).trim() === "-1") return "6";
  const seconds = Math.floor(Number(value) || 6);
  return String(Math.max(1, Math.min(20, seconds)));
}

function isTrustedRemoteVideoUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function abortError() {
  return new DOMException("Aborted", "AbortError");
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
