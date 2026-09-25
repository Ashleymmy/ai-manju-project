import { ApiError, getAuthToken } from "@/shared/api/http";
import type { ComicAnalysisDetail } from "./model";
import { sha256Hex } from "@/shared/lib/sha256";

// Short GET requests survive ordinary proxy idle timeouts. Keep one extra
// minute beyond the server's 20-minute task deadline for the final status.
export const COMIC_ANALYSIS_POLL_MS = 2_000;
const COMIC_ANALYSIS_WAIT_MS = 21 * 60_000;
const COMIC_ANALYSIS_READ_RETRIES = 5;
const STORAGE_PREFIX = "ai-manju:comic-analysis:";

function pendingStorage(key: string, value?: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else if (value !== undefined) sessionStorage.setItem(key, value);
    return sessionStorage.getItem(key);
  } catch {
    return null; // Disabled browser storage must not prevent analysis.
  }
}

async function pendingKey(input: unknown) {
  // Persist only an opaque task ID and digest; never store scripts or tokens.
  return STORAGE_PREFIX + await sha256Hex(JSON.stringify([getAuthToken(), input]));
}

function transient(error: unknown) {
  return error instanceof ApiError && (error.status === 0 || error.status === 502 || error.status === 503 || error.status === 504);
}

export async function awaitComicAnalysis(
  submit: () => Promise<ComicAnalysisDetail>,
  read: (id: string) => Promise<ComicAnalysisDetail>,
  input: unknown,
): Promise<ComicAnalysisDetail> {
  const key = await pendingKey(input);
  let id = key ? pendingStorage(key) : null;
  let detail: ComicAnalysisDetail | undefined;
  if (!id) {
    // Never automatically retry submission: a lost response may already have
    // started a billable model request. Only status reads are retried below.
    detail = await submit();
    id = detail.session.id;
    if (key) pendingStorage(key, id);
  }
  const deadline = Date.now() + COMIC_ANALYSIS_WAIT_MS;
  let failures = 0;
  while (Date.now() < deadline) {
    if (detail) {
      if (detail.session.status === "failed") {
        // A timeout may precede durable result repair. Preserve that session
        // so the next explicit click reads it instead of charging a new task.
        if (key && !detail.session.analysis_recovery_pending) pendingStorage(key, null);
        throw new Error(detail.session.analysis_error || "剧本分析未完成，请稍后重试");
      }
      if (detail.session.status !== "processing") {
        if (key) pendingStorage(key, null);
        return detail;
      }
      await new Promise((resolve) => window.setTimeout(resolve, COMIC_ANALYSIS_POLL_MS));
    }
    try {
      detail = await read(id);
      failures = 0;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404 && key) pendingStorage(key, null);
      if (!transient(error)) throw error;
      if (++failures >= COMIC_ANALYSIS_READ_RETRIES) {
        throw new Error("暂时无法获取分析进度，任务仍保留。请保持相同文件和设置，再点“解析并预览”继续查看");
      }
      await new Promise((resolve) => window.setTimeout(resolve, COMIC_ANALYSIS_POLL_MS));
    }
  }
  throw new Error("分析仍未返回结果。请保持相同文件和设置，再点“解析并预览”查看任务状态");
}
