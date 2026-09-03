import { getAsset, getAssetContentObjectUrl, uploadAsset } from "@/entities/asset";
import { cancelJob } from "@/entities/job";
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

export const browserCanvasGenerationServices: CanvasGenerationServices = {
  getAsset,
  getAssetContentObjectUrl,
  uploadAsset,
  cancelJob,
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
  fetchBlob: async (url, signal, label = "读取资源") => {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`${label}失败（${response.status}）`);
    return response.blob();
  },
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
  readVideoMetadata: async file => {
    const metadata = await readTimedMediaMetadata(file, "video");
    return { width: metadata.width, height: metadata.height, durationMs: metadata.durationMs };
  },
  readAudioMetadata: async file => {
    const metadata = await readTimedMediaMetadata(file, "audio");
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

function readImageMetadata(file: File) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    const cleanup = () => URL.revokeObjectURL(url);
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      cleanup();
      if (!width || !height) reject(new Error("参考图片尺寸读取失败"));
      else resolve({ width, height });
    };
    image.onerror = () => {
      cleanup();
      reject(new Error("参考图片读取失败"));
    };
    image.src = url;
  });
}

function readTimedMediaMetadata(file: File, kind: "video" | "audio") {
  return new Promise<{ width: number; height: number; durationMs: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const media = document.createElement(kind);
    const cleanup = () => {
      media.removeAttribute("src");
      media.load();
      URL.revokeObjectURL(url);
    };
    media.preload = "metadata";
    media.onloadedmetadata = () => {
      const durationMs = Math.round(media.duration * 1_000);
      const width = kind === "video" ? (media as HTMLVideoElement).videoWidth : 1;
      const height = kind === "video" ? (media as HTMLVideoElement).videoHeight : 1;
      cleanup();
      if (!Number.isFinite(durationMs) || durationMs <= 0 || width <= 0 || height <= 0) {
        reject(new Error(kind === "video" ? "参考视频元数据读取失败" : "参考音频元数据读取失败"));
      } else {
        resolve({ width, height, durationMs });
      }
    };
    media.onerror = () => {
      cleanup();
      reject(new Error(kind === "video" ? "参考视频读取失败" : "参考音频读取失败"));
    };
    media.src = url;
  });
}
