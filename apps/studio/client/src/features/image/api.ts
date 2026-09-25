import { getJob, isTerminalJob, jobErrorMessage, type Job } from "@/entities/job";
import { API_BASE_URL, ApiError, getAuthToken, request } from "@/shared/api/http";
import { fetchImageModelCatalog, fetchTextModelCatalog, modelLabel } from "@/entities/model";
import type { CapabilityModelCatalog } from "@/entities/model";
import { canvasImageRequestPrompt } from "./outputRequirements";
import { submitWithGenerationAdmission, type GenerationAdmissionOptions } from "@/shared/api/generationAdmission";
import { MAX_IMAGE_GENERATION_COUNT } from "@/shared/config/generation";

export type { AiModelsResponse } from "@/entities/model";
export type ImageModelCatalog = CapabilityModelCatalog;
export type TextModelCatalog = CapabilityModelCatalog;

export type ImageGenerationInput = {
  prompt: string;
  model?: string;
  size?: "auto" | "1:1" | "3:2" | "2:3" | "4:3" | "3:4" | "16:9" | "9:16" | "2:1" | (string & {});
  quality?: "auto" | "low" | "medium" | "high";
  count?: number;
  seed?: number;
  referenceFiles?: File[];
  maskFile?: File;
  scope?: "personal" | "team";
  sourceType?: "image_workbench" | "canvas";
  sourceProjectId?: string;
  sourceNodeId?: string;
};

export type GeneratedImage = {
  id: string;
  assetId?: string;
  src: string;
  name?: string;
  contentType?: string;
};

type JobSubmission = { id?: string; job_id?: string; status?: Job["status"] };
export type GenerationCallbacks = {
  signal?: AbortSignal;
  onWaiting?: GenerationAdmissionOptions["onWaiting"];
  onAccepted?: (job: JobSubmission) => void;
  onProgress?: (job: Job) => void;
};

const imagePollIntervalMs = 2_500;
export function waitForImageAdmission<T>(submit: () => Promise<T>, signal?: AbortSignal, onWaiting?: GenerationAdmissionOptions["onWaiting"]): Promise<T> {
  return submitWithGenerationAdmission("image", submit, { signal, onWaiting });
}

export async function fetchImageModels(): Promise<ImageModelCatalog> {
  return fetchImageModelCatalog({ normalizeMetadata: false });
}

export async function fetchTextModels(): Promise<TextModelCatalog> {
  return fetchTextModelCatalog({ includeGenericModels: false, normalizeMetadata: false });
}

export function imageModelLabel(model: string, catalog?: Pick<ImageModelCatalog, "labels" | "providerNames">) {
  return modelLabel(model, catalog);
}

export async function submitImageGeneration(input: ImageGenerationInput, signal?: AbortSignal, onWaiting?: GenerationAdmissionOptions["onWaiting"]) {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("请输入画面描述");
  const idempotencyKey = globalThis.crypto?.randomUUID?.() || `image_${Date.now()}`;
  return waitForImageAdmission(() => request<JobSubmission>("/api/ai/image/generations", {
    method: "POST",
    query: { scope: input.scope || "personal" },
    timeoutMs: 30_000,
    signal,
    headers: { "Idempotency-Key": idempotencyKey },
    body: {
      model: input.model || "",
      prompt: canvasImageRequestPrompt(input),
      size: input.size || "auto",
      quality: input.quality || "auto",
      n: Math.max(1, Math.min(MAX_IMAGE_GENERATION_COUNT, Math.floor(input.count || 1))),
      ...(imageSeedFromInput(input.seed) !== undefined ? { seed: imageSeedFromInput(input.seed) } : {}),
      response_format: "b64_json",
      output_format: "png",
      asset_context: {
        source_type: input.sourceType || "image_workbench",
        category: "other",
        ...(input.sourceProjectId ? { source_project_id: input.sourceProjectId } : {}),
        ...(input.sourceNodeId ? { source_node_id: input.sourceNodeId } : {}),
      },
    },
  }), signal, onWaiting);
}

export async function submitImageEdit(input: ImageGenerationInput, signal?: AbortSignal, onWaiting?: GenerationAdmissionOptions["onWaiting"]) {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("请输入画面描述");
  const referenceFiles = input.referenceFiles || [];
  if (!referenceFiles.length) throw new Error("图片编辑至少需要一张参考图");
  const body = new FormData();
  body.set("model", input.model || "");
  body.set("prompt", canvasImageRequestPrompt(input));
  body.set("size", input.size || "auto");
  body.set("quality", input.quality || "auto");
  body.set("n", String(Math.max(1, Math.min(MAX_IMAGE_GENERATION_COUNT, Math.floor(input.count || 1)))));
  const seed = imageSeedFromInput(input.seed);
  if (seed !== undefined) body.set("seed", String(seed));
  body.set("response_format", "b64_json");
  body.set("output_format", "png");
  body.set("asset_context", JSON.stringify({
    source_type: input.sourceType || "image_workbench",
    category: "other",
    ...(input.sourceProjectId ? { source_project_id: input.sourceProjectId } : {}),
    ...(input.sourceNodeId ? { source_node_id: input.sourceNodeId } : {}),
  }));
  referenceFiles.forEach((file) => body.append("image", file, file.name));
  if (input.maskFile) body.set("mask", input.maskFile, input.maskFile.name);
  const idempotencyKey = globalThis.crypto?.randomUUID?.() || `image_edit_${Date.now()}`;
  return waitForImageAdmission(() => request<JobSubmission>("/api/ai/image/edits", {
    method: "POST",
    query: { scope: input.scope || "personal" },
    timeoutMs: 120_000,
    signal,
    headers: { "Idempotency-Key": idempotencyKey },
    body,
  }), signal, onWaiting);
}

export async function generateImages(input: ImageGenerationInput, callbacks: GenerationCallbacks = {}) {
  const submitted = input.referenceFiles?.length
    ? await submitImageEdit(input, callbacks.signal, callbacks.onWaiting)
    : await submitImageGeneration(input, callbacks.signal, callbacks.onWaiting);
  const jobId = submitted.job_id || submitted.id || "";
  if (!jobId) throw new Error("图像接口没有返回任务 ID");
  callbacks.onAccepted?.(submitted);
  const job = await waitForImageJob(jobId, callbacks);
  if (job.status !== "succeeded") throw new Error(jobErrorMessage(job, "图片生成失败"));
  return { job, images: await generatedImagesFromJob(job, input.scope || "personal", callbacks.signal) };
}

export async function waitForImageJob(jobId: string, callbacks: Omit<GenerationCallbacks, "onAccepted"> = {}) {
  for (;;) {
    if (callbacks.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    let job: Job;
    try {
      job = await getJob(jobId, callbacks.signal);
    } catch (error) {
      if (callbacks.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      // A polling timeout does not mean the server-owned generation failed.
      if (error instanceof ApiError && (error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500)) {
        await wait(imagePollIntervalMs, callbacks.signal);
        continue;
      }
      throw error;
    }
    callbacks.onProgress?.(job);
    if (isTerminalJob(job)) return job;
    await wait(imagePollIntervalMs, callbacks.signal);
  }
}

export async function generatedImagesFromJob(job: Job, scope: "personal" | "team" = "personal", signal?: AbortSignal) {
  const items = imageItems(job.result);
  const images: GeneratedImage[] = [];
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    const assetId = stringValue(item.asset_id) || (stringValue(item.id).startsWith("asset_") ? stringValue(item.id) : "");
    // A few providers reuse the same delivery URL for multiple outputs. Only
    // asset IDs are stable identities; keep URL/base64 results indexed so a
    // valid batch item cannot be silently removed as a duplicate.
    const key = assetId || `${stringValue(item.asset_url) || stringValue(item.url) || stringValue(item.b64_json)}#${index}`;
    if (!key || seen.has(key)) continue;
    const src = assetId ? "" : await resolveImageSource(item, scope, signal);
    if (!assetId && !src) continue;
    seen.add(key);
    images.push({
      id: assetId || `generated_${images.length + 1}`,
      assetId: assetId || undefined,
      src,
      name: stringValue(item.name) || undefined,
      contentType: stringValue(item.content_type) || undefined,
    });
  }
  if (!images.length) throw new Error("任务已完成，但没有返回可显示的图片");
  return images;
}

export function publicApiError(error: unknown, fallback = "请求失败") {
  if (error instanceof ApiError) {
    return `${error.message}${error.requestId ? `（request_id: ${error.requestId}）` : ""}`;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

function imageItems(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result.filter(isRecord);
  if (!isRecord(result)) return [];
  const assets = Array.isArray(result.assets) ? result.assets.filter(isRecord) : [];
  const outputs = Array.isArray(result.outputs) ? result.outputs.filter(isRecord) : [];
  const images = Array.isArray(result.images) ? result.images.filter(isRecord) : [];
  const data = Array.isArray(result.data) ? result.data.filter(isRecord) : isRecord(result.data) ? imageItems(result.data) : [];
  return [...assets, ...outputs, ...images, ...data];
}

async function resolveImageSource(item: Record<string, unknown>, scope: "personal" | "team", signal?: AbortSignal) {
  const b64 = stringValue(item.b64_json);
  if (b64) return b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`;
  const dataUrl = stringValue(item.data_url);
  if (dataUrl.startsWith("data:")) return dataUrl;

  const assetId = stringValue(item.asset_id) || (stringValue(item.id).startsWith("asset_") ? stringValue(item.id) : "");
  const rawUrl = stringValue(item.asset_url) || stringValue(item.url) || stringValue(item.remote_url);
  const url = assetId
    ? `${API_BASE_URL}/api/assets/${encodeURIComponent(assetId)}/content?scope=${encodeURIComponent(scope)}`
    : rawUrl.startsWith("/")
      ? `${API_BASE_URL}${rawUrl}${rawUrl.includes("?") ? "&" : "?"}scope=${encodeURIComponent(scope)}`
      : rawUrl;
  if (!url) return "";
  if (!url.startsWith(API_BASE_URL) && /^https?:\/\//i.test(url)) return url;

  const token = getAuthToken();
  const response = await fetch(url, {
    credentials: "include",
    signal,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) return "";
  return URL.createObjectURL(await response.blob());
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const finish = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = globalThis.setTimeout(finish, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function imageSeedFromInput(seed: unknown): number | undefined {
  if (typeof seed !== "number" || !Number.isFinite(seed)) return undefined;
  const value = Math.trunc(seed);
  return value >= 0 ? value : undefined;
}
