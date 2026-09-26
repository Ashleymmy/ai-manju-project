import { ApiError, getAuthToken, request } from "@/shared/api/http";
import { canRecoverGenerationReceipt, isDefinitiveGenerationReceiptFailure, readGenerationReceiptResult } from "@/shared/api/generationReceipt";
import type { WorkspaceScope } from "@/shared/config";
import { createRandomUUID } from "@/shared/lib/cryptoRandomUuid";
import { sha256Hex } from "@/shared/lib/sha256";

const COMIC_OPERATION_STORAGE_PREFIX = "ai-manju:comic-operation:v1:";
type ComicOperationKind = "comic_revision" | "comic_prompt" | "comic_batch";
type ComicOperationReceipt = { version: 1; key: string; identity: string; payloadHash: string };
type ComicOperationInput<T> = {
  kind: ComicOperationKind;
  scope: WorkspaceScope;
  resource: readonly string[];
  payload: unknown;
  submit: (key: string) => Promise<T>;
  validate: (value: unknown) => boolean;
  // Optional lookup of an already durable domain result if saving its HTTP
  // receipt failed. It must be read-only and return undefined only for 404.
  recoverPersisted?: (key: string) => Promise<T | undefined>;
};

// This tab shares one operation per account/resource even if multiple components
// click concurrently. sessionStorage preserves the descriptor across reloads.
const activeOperations = new Map<string, { payloadHash: string; result: Promise<unknown> }>();

/** Resume an existing paid operation instead of silently starting another one. */
export async function awaitComicOperation<T>(input: ComicOperationInput<T>): Promise<T> {
  const token = getAuthToken();
  if (!token) throw new ApiError("请先登录后再提交操作", 401);
  const assertSession = () => {
    if (getAuthToken() !== token) throw new ApiError("登录账号已切换，请返回原账号恢复结果；未重新提交操作", 409);
  };
  const user = await request<{ id?: string }>("/api/auth/me");
  assertSession();
  if (!user?.id) throw new ApiError("无法确认当前账号，尚未提交操作", 401);
  const identity = await sha256Hex(JSON.stringify([user.id, input.scope, input.kind, input.resource]));
  const payloadHash = await sha256Hex(canonicalJson(input.payload));
  assertSession();
  const storageKey = COMIC_OPERATION_STORAGE_PREFIX + identity;
  const active = activeOperations.get(storageKey);
  if (active) {
    if (active.payloadHash !== payloadHash) throw changedPendingInput();
    const result = await active.result as T;
    assertSession();
    return result;
  }
  // Install the guard before running callbacks, including synchronous test and
  // cache adapters. The map holds no credentials, prompts or media payloads.
  const result = Promise.resolve().then(async () => {
    assertSession();
    const existing = readPending(storageKey, identity);
    // Server versions may advance while the first response is lost. Recover
    // the stored key even if refreshed UI now supplies a newer version, but
    // never present that older result as the output of a different request.
    const changedPayload = !!existing && existing.payloadHash !== payloadHash;
    const receipt: ComicOperationReceipt = existing || { version: 1, identity, payloadHash, key: createRandomUUID() };
    if (!existing) savePending(storageKey, receipt);
    const recover = async () => {
      assertSession();
      const recoverPersisted = async () => {
        assertSession();
        const result = await input.recoverPersisted?.(receipt.key);
        assertSession();
        if (result !== undefined && !input.validate(result)) throw new ApiError("原操作未返回可确认的结果，请稍后恢复；未重新提交操作", 502);
        return result;
      };
      const persisted = await recoverPersisted();
      if (persisted !== undefined) return persisted;
      let response: Response;
      try {
        response = await readGenerationReceiptResult(input.kind, { key: receipt.key, scope: input.scope, recoverOnly: true });
      } catch (error) {
        // The batch may commit between the first lookup and receipt recovery.
        // Never replace a committed batch with a second POST on that race.
        const committed = await recoverPersisted();
        if (committed !== undefined) return committed;
        throw error;
      }
      assertSession();
      const payload = await response.json().catch(() => undefined);
      assertSession();
      if (payload?.success !== true || !input.validate(payload.data)) {
        throw new ApiError("原操作未返回可确认的结果，请稍后恢复；未重新提交操作", 502);
      }
      return payload.data as T;
    };
    try {
      const output = existing ? await recover() : await (async () => {
        let submitted: T;
        try { submitted = await input.submit(receipt.key); }
        catch (error) {
          assertSession();
          if (!canRecoverGenerationReceipt(error)) throw error;
          return recover();
        }
        assertSession();
        return input.validate(submitted) ? submitted : recover();
      })();
      assertSession();
      removePending(storageKey, receipt);
      if (changedPayload) throw new Error("原操作已完成，请刷新素材后再提交新的修改；本次新修改尚未提交");
      return output;
    } catch (error) {
      assertSession();
      if (isDefinitiveGenerationReceiptFailure(error)) removePending(storageKey, receipt);
      throw error;
    }
  });
  activeOperations.set(storageKey, { payloadHash, result });
  try { return await result; }
  finally { if (activeOperations.get(storageKey)?.result === result) activeOperations.delete(storageKey); }
}

function readPending(storageKey: string, identity: string): ComicOperationReceipt | undefined {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (raw === null) return undefined;
    const value = JSON.parse(raw) as Partial<ComicOperationReceipt>;
    if (value.version !== 1 || value.identity !== identity || typeof value.key !== "string"
      || !/^[a-zA-Z0-9._:-]{1,128}$/.test(value.key) || !/^[a-f0-9]{64}$/.test(value.payloadHash || "")) throw new Error("invalid receipt");
    return value as ComicOperationReceipt;
  } catch {
    throw new Error("原操作记录无法读取，请恢复浏览器存储后重试；未重新提交操作");
  }
}

function savePending(storageKey: string, receipt: ComicOperationReceipt) {
  try {
    const value = JSON.stringify(receipt);
    sessionStorage.setItem(storageKey, value);
    if (sessionStorage.getItem(storageKey) !== value) throw new Error("receipt not persisted");
  } catch {
    throw new Error("操作记录保存失败，尚未调用模型；请检查浏览器存储后重试");
  }
}

function removePending(storageKey: string, receipt: ComicOperationReceipt) {
  try {
    if (readPending(storageKey, receipt.identity)?.key === receipt.key) sessionStorage.removeItem(storageKey);
  } catch { /* Keeping a completed identity only causes a safe result reread. */ }
}

function changedPendingInput() {
  return new Error("该素材仍有待恢复的操作，请保持原输入和模型恢复结果；尚未提交新的操作");
}

function canonicalJson(value: unknown): string {
  const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort)
    : item && typeof item === "object" ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sort(child)])) : item;
  return JSON.stringify(sort(JSON.parse(JSON.stringify(value))));
}
