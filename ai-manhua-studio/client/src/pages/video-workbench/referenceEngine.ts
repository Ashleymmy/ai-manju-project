import type {
  VideoGenerationAudioReference,
  VideoGenerationImageReference,
  VideoGenerationReferences,
  VideoGenerationVideoReference,
  VideoProvider,
  WorkspaceScope,
} from "@/services/api";
import { isSeedanceVideoModel, validateVideoGenerationReferences } from "@/services/api";
import type { StoredVideoReference, StoredVideoReferenceSnapshot } from "@/services/video-history";

/* 参考素材摄取管线：从旧版 VideoWorkspaceView 原样抽出的纯逻辑（类型/元数据读取/限额校验）。
   对话式工作台与旧页面共用这一套，保证行为一致。 */

export type WorkbenchReferenceKind = "image" | "video" | "audio";
export type WorkbenchReferenceSource = "local" | "asset";
export type WorkbenchReferenceRole = "reference" | "first_frame" | "last_frame";

export type WorkbenchReferenceBase = {
  id: string;
  name: string;
  mime: string;
  bytes: number;
  previewUrl: string;
  source: WorkbenchReferenceSource;
  role: WorkbenchReferenceRole;
  /** 提示词里的引用 token（@图片1 等），仅 role=reference 时有 */
  token?: string;
  storageKey?: string;
  assetId?: string;
  scope?: WorkspaceScope;
};
export type WorkbenchImageReference = WorkbenchReferenceBase & Omit<VideoGenerationImageReference, "role"> & { kind: "image" };
export type WorkbenchVideoReference = WorkbenchReferenceBase & VideoGenerationVideoReference & { kind: "video" };
export type WorkbenchAudioReference = WorkbenchReferenceBase & VideoGenerationAudioReference & { kind: "audio" };
export type WorkbenchReference = WorkbenchImageReference | WorkbenchVideoReference | WorkbenchAudioReference;

export type WorkbenchReferenceSnapshot = {
  images: WorkbenchImageReference[];
  videos: WorkbenchVideoReference[];
  audios: WorkbenchAudioReference[];
};

export type ReferenceRejection = {
  name: string;
  reason: string;
  item?: WorkbenchReference;
};

export function emptyWorkbenchReferences(): WorkbenchReferenceSnapshot {
  return { images: [], videos: [], audios: [] };
}

export function splitWorkbenchReferences(items: WorkbenchReference[]): WorkbenchReferenceSnapshot {
  return {
    images: items.filter((item): item is WorkbenchImageReference => item.kind === "image"),
    videos: items.filter((item): item is WorkbenchVideoReference => item.kind === "video"),
    audios: items.filter((item): item is WorkbenchAudioReference => item.kind === "audio"),
  };
}

export function generationReferencesFrom(snapshot: WorkbenchReferenceSnapshot): VideoGenerationReferences {
  return {
    images: snapshot.images.map((item) => ({
      id: item.id,
      kind: "image",
      file: item.file,
      name: item.name,
      mime: item.mime,
      bytes: item.bytes,
      width: item.width,
      height: item.height,
      // 首尾帧语义透传给 Seedance content（普通参考图为 reference_image）
      role: item.role === "reference" ? undefined : item.role,
    })),
    videos: snapshot.videos.map((item) => ({
      id: item.id,
      kind: "video",
      file: item.file,
      name: item.name,
      mime: item.mime,
      bytes: item.bytes,
      width: item.width,
      height: item.height,
      durationMs: item.durationMs,
    })),
    audios: snapshot.audios.map((item) => ({
      id: item.id,
      kind: "audio",
      file: item.file,
      name: item.name,
      mime: item.mime,
      bytes: item.bytes,
      durationMs: item.durationMs,
    })),
  };
}

/** 提交时把提示词里的 @[ref:id] token 换成模型可读的素材编号文案。 */
export function resolvePromptWithTokens(prompt: string, snapshot: WorkbenchReferenceSnapshot) {
  const labels = new Map<string, string>();
  snapshot.images.forEach((item, index) => labels.set(item.id, `图片${index + 1}`));
  snapshot.videos.forEach((item, index) => labels.set(item.id, `视频${index + 1}`));
  snapshot.audios.forEach((item, index) => labels.set(item.id, `音频${index + 1}`));
  return prompt.replace(/@\[ref:([^\]]+)\]/g, (raw, id: string) => labels.get(id) || raw);
}

/** 提示词里实际引用到的参考素材 id 集合（首尾帧不算 token 引用）。 */
export function referencedTokenIds(prompt: string) {
  return new Set(Array.from(prompt.matchAll(/@\[ref:([^\]]+)\]/g)).map((match) => match[1]));
}

/** 与旧版一致：逐个试加并调用模型校验，超限/不合规的进入 rejected。 */
export function planWorkbenchReferenceBatch(
  existing: WorkbenchReferenceSnapshot,
  candidates: WorkbenchReference[],
  model: string,
) {
  const accepted: WorkbenchReference[] = [];
  const rejected: ReferenceRejection[] = [];
  const ordered = (["image", "video", "audio"] as const)
    .flatMap((kind) => candidates.filter((item) => item.kind === kind));
  const existingItems = [...existing.images, ...existing.videos, ...existing.audios];

  for (const item of ordered) {
    const snapshot = splitWorkbenchReferences([...existingItems, ...accepted, item]);
    try {
      validateVideoGenerationReferences(generationReferencesFrom(snapshot), model);
      accepted.push(item);
    } catch (error) {
      rejected.push({ name: item.name, reason: referenceRejectionMessage(error), item });
    }
  }
  return { accepted, rejected };
}

export function referenceRejectionMessage(error: unknown, fallback = "不符合当前模型要求") {
  return error instanceof Error && error.message.trim() ? error.message.trim() : fallback;
}

export async function createImageWorkbenchReference(
  file: File,
  createPreviewUrl: (file: File) => string,
  revokePreviewUrl: (url: string) => void,
  role: WorkbenchReferenceRole = "reference",
): Promise<WorkbenchImageReference> {
  const previewUrl = createPreviewUrl(file);
  try {
    const meta = await readImageMeta(previewUrl);
    return {
      id: workbenchRuntimeId("image_ref"),
      kind: "image",
      source: "local",
      role,
      file,
      name: file.name,
      mime: file.type || "image/*",
      bytes: file.size,
      width: meta.width,
      height: meta.height,
      previewUrl,
    };
  } catch (error) {
    revokePreviewUrl(previewUrl);
    throw error;
  }
}

export async function createVideoWorkbenchReference(
  file: File,
  createPreviewUrl: (file: File) => string,
  revokePreviewUrl: (url: string) => void,
  role: WorkbenchReferenceRole = "reference",
): Promise<WorkbenchVideoReference> {
  const previewUrl = createPreviewUrl(file);
  try {
    const meta = await readVideoMeta(previewUrl);
    return {
      id: workbenchRuntimeId("video_ref"),
      kind: "video",
      source: "local",
      role,
      file,
      name: file.name,
      mime: file.type || "video/*",
      bytes: file.size,
      width: meta.width,
      height: meta.height,
      durationMs: meta.durationMs,
      previewUrl,
    };
  } catch (error) {
    revokePreviewUrl(previewUrl);
    throw error;
  }
}

export async function createAudioWorkbenchReference(
  file: File,
  createPreviewUrl: (file: File) => string,
  revokePreviewUrl: (url: string) => void,
  role: WorkbenchReferenceRole = "reference",
): Promise<WorkbenchAudioReference> {
  const previewUrl = createPreviewUrl(file);
  try {
    const meta = await readAudioMeta(previewUrl);
    return {
      id: workbenchRuntimeId("audio_ref"),
      kind: "audio",
      source: "local",
      role,
      file,
      name: file.name,
      mime: file.type || "audio/*",
      bytes: file.size,
      durationMs: meta.durationMs,
      previewUrl,
    };
  } catch (error) {
    revokePreviewUrl(previewUrl);
    throw error;
  }
}

/** 参考素材快照 → 存储记录（草稿媒体 key 由 video-history 的 media store 托管）。 */
export function storedWorkbenchReferences(snapshot: WorkbenchReferenceSnapshot): StoredVideoReferenceSnapshot {
  const toStored = (item: WorkbenchReference): StoredVideoReference => ({
    id: item.id,
    kind: item.kind,
    source: item.source,
    name: item.name,
    mime: item.mime,
    bytes: item.bytes,
    width: "width" in item ? item.width : undefined,
    height: "height" in item ? item.height : undefined,
    durationMs: "durationMs" in item ? item.durationMs : undefined,
    storageKey: item.source === "local" ? item.storageKey : undefined,
    assetId: item.source === "asset" ? item.assetId : undefined,
    scope: item.scope,
  });
  return {
    images: snapshot.images.filter((item) => item.role === "reference").map(toStored),
    videos: snapshot.videos.filter((item) => item.role === "reference").map(toStored),
    audios: snapshot.audios.filter((item) => item.role === "reference").map(toStored),
  };
}

export function isImageWorkbenchFile(file: File) {
  return file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
}

export function isVideoWorkbenchFile(file: File) {
  return file.type === "video/mp4" || file.type === "video/quicktime" || /\.(mp4|mov)$/i.test(file.name);
}

export function isAudioWorkbenchFile(file: File) {
  return ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav"].includes(file.type)
    || /\.(mp3|wav)$/i.test(file.name);
}

export function workbenchFormatBytes(bytes: number) {
  if (!bytes) return "0B";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function workbenchFormatDuration(durationMs: number) {
  return `${Math.round(durationMs / 1000)}s`;
}

export function workbenchVideoFileName(prompt: string, fileName?: string) {
  const storedName = fileName?.trim().replace(/[\\/:*?"<>|]+/g, "-").slice(0, 120);
  if (storedName) return storedName;
  const base = prompt.trim().replace(/[\\/:*?"<>|]+/g, "-").slice(0, 48) || "generated-video";
  return `${base}.mp4`;
}

export function workbenchProviderFromModel(model: string): VideoProvider {
  return isSeedanceVideoModel(model) ? "seedance" : "openai";
}

export function workbenchRuntimeId(prefix: string) {
  return `${prefix}_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`}`;
}

export function workbenchWait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function readImageMeta(url: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
    image.onerror = () => reject(new Error("参考图片读取失败"));
    image.src = url;
  });
}

function readVideoMeta(url: string) {
  return new Promise<{ width: number; height: number; durationMs: number }>((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => resolve({
      width: video.videoWidth,
      height: video.videoHeight,
      durationMs: Math.round((video.duration || 0) * 1000),
    });
    video.onerror = () => reject(new Error("参考视频读取失败"));
    video.src = url;
  });
}

function readAudioMeta(url: string) {
  return new Promise<{ durationMs: number }>((resolve, reject) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.onloadedmetadata = () => resolve({ durationMs: Math.round((audio.duration || 0) * 1000) });
    audio.onerror = () => reject(new Error("参考音频读取失败"));
    audio.src = url;
  });
}
