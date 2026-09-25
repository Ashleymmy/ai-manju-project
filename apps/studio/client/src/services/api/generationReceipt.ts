import { apiUrl, ApiError, clearAuthToken, getAuthToken } from "./request";
import type { WorkspaceScope } from "@/shared/config";

/** Poll stored output only; receipt recovery must never submit a second generation. */
export const GENERATION_RECEIPT_POLL_MS = 1_500;
export type GenerationReceiptOptions = {
  key: string;
  scope?: WorkspaceScope;
  recoverOnly?: boolean;
};

export function canRecoverGenerationReceipt(error: unknown, signal?: AbortSignal) {
  return !signal?.aborted && (!(error instanceof ApiError)
    || (error.status !== 401 && error.status !== 403));
}

export function generationReceiptState(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const record = error as { receiptState?: string; details?: { data?: { receipt?: { status?: string } } } };
  return record.receiptState || record.details?.data?.receipt?.status || "";
}

/** Only server-confirmed terminal outcomes release a pending local identity. */
export function isDefinitiveGenerationReceiptFailure(error: unknown): boolean {
  const state = generationReceiptState(error);
  return state === "failed" || state === "not_submitted";
}

export async function readGenerationReceiptResult(
  kind: "text" | "audio", receipt: GenerationReceiptOptions, signal?: AbortSignal,
): Promise<Response> {
  // Seal a missing key at most once. This endpoint cannot invoke a model, and
  // atomically prevents a delayed original submission from starting afterwards.
  let reconciled = false;
  for (;;) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const token = getAuthToken();
    let response = await fetch(apiUrl(`/api/ai/receipts/${kind}/${encodeURIComponent(receipt.key)}/result`, { scope: receipt.scope }), {
      credentials: "include", signal, cache: "no-store",
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    let reconciliationError = false;
    if (response.status === 404 && !reconciled) {
      reconciled = true;
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const reconciliation = await fetch(apiUrl(`/api/ai/receipts/${kind}/${encodeURIComponent(receipt.key)}/reconcile`, { scope: receipt.scope }), {
        method: "POST", credentials: "include", signal, cache: "no-store",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (reconciliation.ok) {
        const payload = await reconciliation.json().catch(() => undefined);
        const confirmed = payload?.data?.receipt;
        const status = confirmed?.status;
        // A proxy's HTML 200 or an old server's fallback must not authorize a
        // retry. Require the exact scoped receipt returned by the new endpoint.
        if (payload?.success === true && confirmed?.kind === kind && confirmed?.key === receipt.key
          && ["not_submitted", "running", "uncertain", "failed", "succeeded", "expired"].includes(status)) {
          continue;
        }
      } else {
        response = reconciliation;
        reconciliationError = true;
      }
    }
    if (response.status === 202) {
      await waitForReceipt(signal);
      continue;
    }
    if (response.ok) return response;
    if (response.status === 401) {
      clearAuthToken();
      if (typeof window.dispatchEvent === "function") window.dispatchEvent(new CustomEvent("ai-manju:auth-unauthorized"));
    }
    let payload = await response.json().catch(() => undefined);
    const failedReceipt = payload?.data?.receipt;
    if (failedReceipt && (reconciliationError || failedReceipt.kind !== kind || failedReceipt.key !== receipt.key)) {
      // Unbound error metadata cannot release this request's durable identity.
      payload = { ...payload, data: { ...payload.data, receipt: undefined } };
    }
    const fallback = response.status === 404
      ? "未找到原生成回执，请联系管理员确认；未重新提交生成"
      : response.status === 410
        ? "原生成结果已超过恢复期限，请联系管理员；未重新提交生成"
        : "原生成结果暂时无法恢复，请稍后重试；未重新提交生成";
    throw new ApiError(typeof payload?.error === "string" ? payload.error : fallback,
      response.status, response.headers.get("X-Request-Id") || undefined, payload);
  }
}

function waitForReceipt(signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const finish = () => { signal?.removeEventListener("abort", abort); resolve(); };
    const timer = setTimeout(finish, GENERATION_RECEIPT_POLL_MS);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}
