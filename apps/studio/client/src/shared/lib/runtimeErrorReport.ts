import { apiUrl, getAuthToken } from "@/shared/api/http";

// No persistent queue: diagnostics must never cross login sessions.
const MAX_TEXT = 3000;
const MAX_PER_WINDOW = 30;
const RATE_WINDOW_MS = 60_000;
const DEDUP_WINDOW_MS = 10_000;
const REPORT_TIMEOUT_MS = 5000;
let owner = "";
let token: string | null = null;
let sent = 0;
let windowStart = Date.now();
const seen = new Map<string, number>();

export function setRuntimeErrorOwner(userID: string) {
  owner = userID;
  token = getAuthToken();
  sent = 0;
  windowStart = Date.now();
  seen.clear();
}
export function safeRuntimeText(value: string) {
  return value
    .replace(/data:[^\s"']+/gi, "[media redacted]")
    .replace(/https?:\/\/[^\s<>"']+/g, raw => {
      try {
        const url = new URL(raw);
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        return url.toString();
      } catch {
        return "[url redacted]";
      }
    })
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(
      /(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|cookie|token)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,
      "$1[redacted]"
    )
    .replace(/\b(?:sk-|sess-)[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .slice(0, MAX_TEXT);
}
export function reportRuntimeError(
  error: unknown,
  code = "client_error",
  stack = ""
) {
  if (Date.now() - windowStart >= RATE_WINDOW_MS) {
    sent = 0;
    windowStart = Date.now();
    seen.clear();
  }
  if (!owner || token !== getAuthToken() || sent >= MAX_PER_WINDOW) return;
  if (
    error &&
    typeof error === "object" &&
    "name" in error &&
    error.name === "AbortError"
  )
    return;
  // HTTP failures are already recorded by the API middleware.
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    Number(error.status) > 0
  )
    return;
  const message = safeRuntimeText(
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "页面出现未处理异常"
  );
  const key = `${code}:${message}`;
  if (Date.now() - (seen.get(key) || 0) < DEDUP_WINDOW_MS) return;
  seen.set(key, Date.now());
  sent++;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REPORT_TIMEOUT_MS);
  // Use fetch directly to avoid auth side effects and recursive reporting.
  void fetch(apiUrl("/api/monitoring/client-errors"), {
    method: "POST",
    credentials: "include",
    signal: controller.signal,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      id:
        globalThis.crypto?.randomUUID?.() ||
        `client_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      code,
      message,
      detail: safeRuntimeText(
        stack || (error instanceof Error ? error.stack || "" : "")
      ),
      endpoint: location.pathname,
    }),
  })
    .catch(() => {})
    .finally(() => window.clearTimeout(timer));
}
