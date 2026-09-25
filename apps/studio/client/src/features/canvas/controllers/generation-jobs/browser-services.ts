import { getAsset, getAssetContentObjectUrl, uploadAsset } from "@/entities/asset";
import { cancelJob, getJobs } from "@/entities/job";
import {
  generateImages,
  generatedImagesFromJob,
  waitForImageJob,
} from "@/features/image";
import {
  createVideoGenerationTask,
  pollVideoGenerationTask,
  videoGenerationResultToBlob,
} from "@/features/video";
import { requestAiText } from "@/services/api/ai";
import { requestAudioGeneration } from "@/services/api/audio";
import type { CanvasGenerationServices } from "./types";
import { fetchMediaBlob } from "@/shared/lib/mediaDownload";

// Local metadata decoders can fail to emit load/error; bound each decode only.
export const MEDIA_METADATA_TIMEOUT_MS = 30_000;

export const browserCanvasGenerationServices: CanvasGenerationServices = {
  getAsset,
  getAssetContentObjectUrl,
  uploadAsset,
  cancelJob,
  getJobs,
  generateImages,
  generatedImagesFromJob,
  waitForImageJob,
  requestAiText,
  requestAudioGeneration,
  createVideoGenerationTask,
  pollVideoGenerationTask,
  videoGenerationResultToBlob,
  createId: () => crypto.randomUUID(),
  createAbortController: () => new AbortController(),
  createFile: (parts, name, options) => new File(parts, name, options),
  fetchBlob: (url, signal, label = "读取资源") => fetchMediaBlob(url, { signal }, label),
  readFileDataUrl: (file, signal) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const abort = () => {
      reader.abort();
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    reader.onload = () => {
      cleanup();
      resolve(typeof reader.result === "string" ? reader.result : "");
    };
    reader.onerror = () => {
      cleanup();
      reject(reader.error || new Error(`读取图片“${file.name}”失败`));
    };
    reader.readAsDataURL(file);
  }),
  readImageMetadata: readImageMetadata,
  readVideoMetadata: async (file, signal) => {
    const metadata = await readTimedMediaMetadata(file, "video", signal);
    return { width: metadata.width, height: metadata.height, durationMs: metadata.durationMs };
  },
  readAudioMetadata: async (file, signal) => {
    const metadata = await readTimedMediaMetadata(file, "audio", signal);
    return { durationMs: metadata.durationMs };
  },
  revokeObjectURL: url => URL.revokeObjectURL(url),
  waitForPoll: (signal) => new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, 1_500);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  }),
};

function readImageMetadata(file: File, signal?: AbortSignal) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    const timer = setTimeout(() => { cleanup(); image.src = ""; reject(new Error(`参考图片“${file.name}”解析超时，请重新上传可读取的图片`)); }, MEDIA_METADATA_TIMEOUT_MS);
    const cleanup = () => { clearTimeout(timer); image.onload = null; image.onerror = null; signal?.removeEventListener("abort", abort); URL.revokeObjectURL(url); };
    const abort = () => { cleanup(); image.src = ""; reject(new DOMException("Aborted", "AbortError")); };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      cleanup();
      if (!width || !height) reject(new Error(`参考图片“${file.name}”尺寸读取失败，请重新上传可读取的图片`));
      else resolve({ width, height });
    };
    image.onerror = () => {
      cleanup();
      reject(new Error(`参考图片“${file.name}”读取失败，请重新上传可读取的图片`));
    };
    image.src = url;
  });
}

function readTimedMediaMetadata(file: File, kind: "video" | "audio", signal?: AbortSignal) {
  return new Promise<{ width: number; height: number; durationMs: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const media = document.createElement(kind);
    const timer = setTimeout(() => { cleanup(); reject(new Error(`参考${kind === "video" ? "视频" : "音频"}“${file.name}”解析超时，请确认素材可播放后重新上传`)); }, MEDIA_METADATA_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timer);
      media.onloadedmetadata = null;
      media.onerror = null;
      signal?.removeEventListener("abort", abort);
      media.removeAttribute("src");
      media.load();
      URL.revokeObjectURL(url);
    };
    const abort = () => { cleanup(); reject(new DOMException("Aborted", "AbortError")); };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    media.preload = "metadata";
    media.onloadedmetadata = () => {
      const durationMs = Math.round(media.duration * 1_000);
      const width = kind === "video" ? (media as HTMLVideoElement).videoWidth : 1;
      const height = kind === "video" ? (media as HTMLVideoElement).videoHeight : 1;
      cleanup();
      if (!Number.isFinite(durationMs) || durationMs <= 0 || width <= 0 || height <= 0) {
        reject(new Error(`参考${kind === "video" ? "视频" : "音频"}“${file.name}”时长或尺寸读取失败，请确认素材可播放后重新上传`));
      } else {
        resolve({ width, height, durationMs });
      }
    };
    media.onerror = () => {
      cleanup();
      reject(new Error(`参考${kind === "video" ? "视频" : "音频"}“${file.name}”读取失败，请确认素材可播放后重新上传`));
    };
    media.src = url;
  });
}
