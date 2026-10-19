import { apiUrl, ApiError, clearAuthToken, getAuthToken } from "./request";
import {
  canRecoverGenerationReceipt,
  isDefinitiveGenerationReceiptFailure,
  readGenerationReceiptResult,
  type GenerationReceiptOptions,
} from "./generationReceipt";
import {
  submitWithGenerationAdmission,
  type GenerationAdmissionOptions,
} from "@/shared/api/generationAdmission";

export * from "@/shared/config/audio";
import {
  normalizeAudioGenerationConfig,
  audioMimeType,
  type AudioGenerationConfig,
} from "@/shared/config/audio";

type RequestAudioGenerationOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  receipt?: GenerationReceiptOptions;
  onWaiting?: GenerationAdmissionOptions["onWaiting"];
};

export async function requestAudioGeneration(
  config: AudioGenerationConfig,
  prompt: string,
  options: RequestAudioGenerationOptions = {}
): Promise<Blob> {
  if (options.receipt?.recoverOnly)
    return recoverAudioGeneration(config, options);
  return submitWithGenerationAdmission(
    "audio",
    async () => {
      let result: Blob | null;
      try {
        result = await requestAudioGenerationOnce(config, prompt, options);
      } catch (error) {
        if (
          options.receipt &&
          canRecoverGenerationReceipt(error, options.signal)
        ) {
          try {
            return await recoverAudioGeneration(config, options);
          } catch (recoveryError) {
            // The receipt only stores a generic failure text. Once it confirms the
            // request failed, show the original response's reason and request ID.
            if (
              error instanceof ApiError &&
              isDefinitiveGenerationReceiptFailure(recoveryError)
            ) {
              throw new ApiError(
                error.message,
                error.status,
                error.requestId,
                (recoveryError as ApiError).details
              );
            }
            throw recoveryError;
          }
        }
        throw error;
      }
      // Recover outside the submission catch so a recovery failure is not read
      // or reconciled again within the same user action.
      return result ?? recoverAudioGeneration(config, options);
    },
    options
  );
}

async function requestAudioGenerationOnce(
  config: AudioGenerationConfig,
  prompt: string,
  options: RequestAudioGenerationOptions
): Promise<Blob | null> {
  const normalized = normalizeAudioGenerationConfig(config);
  if (!normalized.model) throw new Error("请先配置音频模型");
  const input = prompt.trim();
  if (!input) throw new Error("请输入音频提示词");

  const controller = new AbortController();
  const timeout = options.timeoutMs
    ? window.setTimeout(() => controller.abort(), options.timeoutMs)
    : undefined;
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const requestId =
    globalThis.crypto?.randomUUID?.() ||
    `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const token = getAuthToken();

  try {
    const response = await fetch(
      apiUrl("/api/ai/audio/speech", { scope: options.receipt?.scope }),
      {
        method: "POST",
        credentials: "include",
        signal: controller.signal,
        headers: {
          Accept:
            "audio/*,application/octet-stream;q=0.9,application/json;q=0.8,*/*;q=0.1",
          "Content-Type": "application/json",
          "X-Request-Id": requestId,
          ...(options.receipt
            ? { "Idempotency-Key": options.receipt.key }
            : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          model: normalized.model,
          input,
          voice: normalized.voice,
          response_format: normalized.format,
          speed: Number(normalized.speed),
          ...(normalized.instructions
            ? { instructions: normalized.instructions }
            : {}),
          ...(normalized.emotion ? { emotion: normalized.emotion } : {}),
          ...(normalized.lyrics ? { lyrics: normalized.lyrics } : {}),
          ...(normalized.gender ? { gender: normalized.gender } : {}),
          ...(typeof normalized.isInstrumental === "boolean"
            ? { is_instrumental: normalized.isInstrumental }
            : {}),
        }),
      }
    );
    const responseRequestId =
      response.headers.get("X-Request-Id") ||
      response.headers.get("x-request-id") ||
      requestId;
    if (response.status === 401) {
      clearAuthToken();
      window.dispatchEvent(new CustomEvent("ai-manju:auth-unauthorized"));
    }
    if (response.status === 202 && options.receipt) return null;
    if (!response.ok) {
      throw new ApiError(
        await readAudioErrorResponse(
          response,
          statusMessage(response.status, "音频生成失败")
        ),
        response.status,
        responseRequestId
      );
    }
    const blob = await response.blob();
    await assertAudioBlob(blob, response.status, responseRequestId);
    const fallbackType = audioMimeType(normalized.format);
    return blob.type.startsWith("audio/")
      ? blob
      : new Blob([blob], { type: fallbackType });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("请求超时或已取消", 0, requestId, error);
    }
    throw new ApiError(
      error instanceof Error ? error.message : "音频生成失败",
      0,
      requestId,
      error
    );
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

async function assertAudioBlob(blob: Blob, status: number, requestId: string) {
  const invalid = "音频服务没有返回可用音频，请联系管理员检查模型配置";
  if (!blob.size) throw new ApiError(invalid, status, requestId);
  const type = blob.type.toLowerCase().split(";", 1)[0];
  if (type.includes("json")) {
    throw new ApiError(
      (await readJsonBlobError(blob)) || invalid,
      status,
      requestId
    );
  }
  if (
    type &&
    !type.startsWith("audio/") &&
    ![
      "application/octet-stream",
      "binary/octet-stream",
      "application/ogg",
    ].includes(type)
  ) {
    throw new ApiError(invalid, status, requestId);
  }
  // Error pages are sometimes mislabeled as audio or generic binary data.
  const prefix = (await blob.slice(0, 512).text()).trimStart();
  if (/^(?:<!doctype\s+html|<html\b|<\?xml\b)/i.test(prefix)) {
    throw new ApiError(invalid, status, requestId);
  }
}

async function readAudioErrorResponse(response: Response, fallback: string) {
  const contentType =
    response.headers.get("Content-Type") ||
    response.headers.get("content-type") ||
    "";
  if (contentType.includes("json")) {
    try {
      const payload = await response.json();
      return errorMessageFromPayload(payload) || fallback;
    } catch {
      return fallback;
    }
  }
  const text = await response.text().catch(() => "");
  return text.trim() || fallback;
}

async function readJsonBlobError(blob: Blob) {
  try {
    return errorMessageFromPayload(JSON.parse(await blob.text())) || "";
  } catch {
    return "";
  }
}

function errorMessageFromPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  if (
    typeof record.code === "number" &&
    record.code === 0 &&
    record.success !== false &&
    !record.error
  ) {
    return "";
  }
  if (typeof record.error === "string") return record.error;
  if (record.error && typeof record.error === "object") {
    const error = record.error as Record<string, unknown>;
    if (typeof error.message === "string") return error.message;
    if (typeof error.error === "string") return error.error;
  }
  if (typeof record.msg === "string") return record.msg;
  if (typeof record.message === "string") return record.message;
  return "";
}

function statusMessage(status: number, fallback: string) {
  if (status === 400) return "请联系管理员配置音频模型服务";
  if (status === 401 || status === 403)
    return "模型服务暂不可用，请联系管理员检查权限或模型服务";
  if (status === 429) return "请求被限流或额度不足，请稍后重试";
  return status ? `${fallback}（${status}）` : fallback;
}

async function recoverAudioGeneration(
  config: AudioGenerationConfig,
  options: RequestAudioGenerationOptions
): Promise<Blob> {
  const response = await readGenerationReceiptResult(
    "audio",
    options.receipt!,
    options.signal
  );
  const blob = await response.blob();
  await assertAudioBlob(
    blob,
    response.status,
    response.headers.get("X-Request-Id") || ""
  );
  return blob.type.startsWith("audio/")
    ? blob
    : new Blob([blob], { type: audioMimeType(config.format || "mp3") });
}
