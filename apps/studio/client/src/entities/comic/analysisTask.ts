import { ApiError, getAuthToken } from "@/shared/api/http";
import type { ComicAnalysisDetail } from "./model";
import { sha256Hex } from "@/shared/lib/sha256";
import { createRandomUUID } from "@/shared/lib/cryptoRandomUuid";

// Short GET requests survive ordinary proxy idle timeouts. Keep one extra
// minute beyond the server's 20-minute task deadline for the final status.
export const COMIC_ANALYSIS_POLL_MS = 2_000;
const COMIC_ANALYSIS_WAIT_MS = 21 * 60_000;
const COMIC_ANALYSIS_READ_RETRIES = 5;
const STORAGE_PREFIX = "ai-manju:comic-analysis:";
const SUBMISSION_SUFFIX = ":submission";
// Storage-disabled browsers retain recovery identities for the current page.
const memoryPending = new Map<string, string>();

function pendingStorage(key: string, value?: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else if (value !== undefined) sessionStorage.setItem(key, value);
    return sessionStorage.getItem(key);
  } catch {
    if (value === null) memoryPending.delete(key);
    else if (value !== undefined) memoryPending.set(key, value);
    return memoryPending.get(key) || null;
  }
}

async function pendingKey(token: string | null, input: unknown, ownerID?: string) {
  // Persist only an opaque task ID and digest; never store scripts or tokens.
  return STORAGE_PREFIX + (ownerID ? "owner:" : "") + await sha256Hex(JSON.stringify([ownerID || token, input]));
}

function transient(error: unknown) {
  return error instanceof ApiError && (error.status === 0 || error.status === 502 || error.status === 503 || error.status === 504);
}

export async function awaitComicAnalysis(
  submit: (idempotencyKey?: string) => Promise<ComicAnalysisDetail>,
  read: (id: string) => Promise<ComicAnalysisDetail>,
  input: unknown,
  recoverSubmission?: (idempotencyKey: string) => Promise<{ status: string; session_id?: string }>,
  options?: { ownerID?: string; resumeSessionID?: string; signal?: AbortSignal },
): Promise<ComicAnalysisDetail> {
  const token = getAuthToken();
  const assertAccount = () => {
    if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (getAuthToken() !== token) throw new Error("账号已切换，原分析任务仍保留；请返回原账号查看");
  };
  const key = await pendingKey(token, input, options?.ownerID);
  assertAccount();
  // Migrate a descriptor from the previous token-scoped tab format while the
  // original login is still available. New descriptors survive token renewal.
  if (options?.ownerID && !pendingStorage(key + SUBMISSION_SUFFIX)) {
    const legacyKey = await pendingKey(token, input);
    assertAccount();
    const legacySubmission = pendingStorage(legacyKey + SUBMISSION_SUFFIX);
    if (legacySubmission) {
      pendingStorage(key + SUBMISSION_SUFFIX, legacySubmission);
      const legacyID = pendingStorage(legacyKey);
      if (legacyID) pendingStorage(key, legacyID);
      pendingStorage(legacyKey, null); pendingStorage(legacyKey + SUBMISSION_SUFFIX, null);
    }
  }
  const submissionStorageKey = key + SUBMISSION_SUFFIX;
  const previousSubmission = pendingStorage(submissionStorageKey);
  const idempotencyKey = options?.resumeSessionID ? "" : previousSubmission || `comic-${createRandomUUID()}`;
  if (!options?.resumeSessionID) pendingStorage(submissionStorageKey, idempotencyKey);
  let id = options?.resumeSessionID || pendingStorage(key);
  const clear = () => { pendingStorage(key, null); pendingStorage(submissionStorageKey, null); };
  let detail: ComicAnalysisDetail | undefined;
  const recover = async (originalError: unknown): Promise<string> => {
    if (!recoverSubmission) throw originalError;
    let failures = 0;
    const recoveryDeadline = Date.now() + COMIC_ANALYSIS_WAIT_MS;
    while (Date.now() < recoveryDeadline) {
      assertAccount();
      let recovered: Awaited<ReturnType<typeof recoverSubmission>>;
      try {
        recovered = await recoverSubmission(idempotencyKey);
        assertAccount();
        failures = 0;
      } catch (error) {
        // A missing receipt alone is not proof of non-submission. The API
        // callback seals it atomically before returning not_submitted.
        if (!transient(error) && !(error instanceof ApiError && error.status === 404)) throw error;
        if (++failures >= COMIC_ANALYSIS_READ_RETRIES) throw new Error("暂时无法确认分析任务，任务未重新提交；请稍后重试");
        await waitForAnalysis(options?.signal);
        continue;
      }
      if (recovered.status === "ready" && recovered.session_id) return recovered.session_id;
      if (recovered.status === "not_submitted" || recovered.status === "failed") {
        clear();
        // Do not throw inside the retry catch: terminal confirmation must end
        // this action even if its original network error was transient.
        throw originalError;
      }
      if (recovered.status === "expired" || recovered.status === "uncertain") {
        throw new Error("原分析任务结果尚未取回，请联系管理员核查；未重复提交");
      }
      if (recovered.status !== "preparing") throw new Error("分析任务状态无法确认；未重复提交");
      await waitForAnalysis(options?.signal);
    }
    throw new Error("分析任务仍在提交中，请稍后查看原任务；未重复提交");
  };
  if (!id) {
    // Never automatically retry submission: a lost response may already have
    // started a billable model request. Only status reads are retried below.
    if (previousSubmission) {
      id = await recover(new Error("原分析请求未完成，可重新发起分析"));
    } else {
      try {
        assertAccount();
        detail = await submit(idempotencyKey);
        assertAccount();
      } catch (error) {
        assertAccount();
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) throw error;
        id = await recover(error);
      }
    }
    if (!detail && !id) throw new Error("分析任务未能提交，请稍后重试");
    if (!detail && id) {
      pendingStorage(key, id);
      detail = await read(id);
      assertAccount();
    }
    id = detail?.session.id || id;
    if (!id) throw new Error("分析任务未能提交，请稍后重试");
    if (key) pendingStorage(key, id);
  }
  const deadline = Date.now() + COMIC_ANALYSIS_WAIT_MS;
  let failures = 0;
  while (Date.now() < deadline) {
    assertAccount();
    if (detail) {
      if (detail.session.status === "failed") {
        // A timeout may precede durable result repair. Preserve that session
        // so the next explicit click reads it instead of charging a new task.
        if (key && !detail.session.analysis_recovery_pending) {
          clear();
        }
        throw new Error(detail.session.analysis_error || "剧本分析未完成，请稍后重试");
      }
      if (detail.session.status !== "processing") {
        clear();
        return detail;
      }
      await waitForAnalysis(options?.signal);
    }
    try {
      detail = await read(id);
      assertAccount();
      failures = 0;
    } catch (error) {
      // A disappeared accepted session is not permission to pay again.
      if (!transient(error)) throw error;
      if (++failures >= COMIC_ANALYSIS_READ_RETRIES) {
        throw new Error("暂时无法获取分析进度，任务仍保留。请保持相同文件和设置，再点“解析并预览”继续查看");
      }
      await waitForAnalysis(options?.signal);
    }
  }
  throw new Error("分析仍未返回结果。请保持相同文件和设置，再点“解析并预览”查看任务状态");
}

function waitForAnalysis(signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, COMIC_ANALYSIS_POLL_MS);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}
