import { API_BASE_URL } from "../../config/api";
import {
  REQUEST_FAILURE_EVENT,
  RESPONSE_DIAGNOSTIC_LIMIT,
  type RequestFailureDiagnostic,
} from "../../lib/requestDiagnostics";

export { API_BASE_URL };

export type ApiEnvelope<T> =
  | { success: true; data: T; request_id?: string }
  | {
      success: false;
      error?: string | { message?: string; code?: string };
      request_id?: string;
    };

export class ApiError extends Error {
  runtimeReported = false;
  constructor(
    message: string,
    public readonly status: number,
    public readonly requestId?: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type ApiRequestOptions = Omit<RequestInit, "body" | "headers"> & {
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  timeoutMs?: number;
};

const TOKEN_KEY = "ai-manju:auth_token";
const TOKEN_STORE_KEY = "ai-manju:token-store";
const defaultTimeoutMs = 15_000;

function requestId() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  );
}

export function getAuthToken() {
  const preferred =
    localStorage.getItem(TOKEN_STORE_KEY) === "local"
      ? localStorage
      : sessionStorage;
  return (
    preferred.getItem(TOKEN_KEY) ||
    localStorage.getItem(TOKEN_KEY) ||
    sessionStorage.getItem(TOKEN_KEY)
  );
}

export function setAuthToken(token: string, remember: boolean) {
  const store = remember ? localStorage : sessionStorage;
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  store.setItem(TOKEN_KEY, token);
  localStorage.setItem(TOKEN_STORE_KEY, remember ? "local" : "session");
}

export function clearAuthToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_STORE_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
}

export function apiUrl(path: string, query?: ApiRequestOptions["query"]) {
  const url = new URL(
    `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`
  );
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined) url.searchParams.append(key, String(value));
  });
  return url.toString();
}

export async function request<T>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const {
    body,
    headers = {},
    query,
    timeoutMs = defaultTimeoutMs,
    signal,
    ...init
  } = options;
  const controller = new AbortController();
  const started = performance.now();
  let timedOut = false;
  let received: Response | undefined;
  let observedRequestId = "";
  const effectiveTimeoutMs =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0;
  const timer =
    effectiveTimeoutMs > 0
      ? window.setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, effectiveTimeoutMs)
      : undefined;
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener("abort", onExternalAbort, { once: true });
  if (signal?.aborted) controller.abort();
  const id =
    Object.entries(headers).find(
      ([key]) => key.toLowerCase() === "x-request-id"
    )?.[1] || requestId();
  const token = getAuthToken();
  const isFormData = body instanceof FormData;
  const emitFailure = (
    message: string,
    error: unknown,
    stage: RequestFailureDiagnostic["diagnostics"]["stage"],
    responseBody?: string
  ) => {
    if (
      signal?.aborted ||
      token !== getAuthToken() ||
      path.startsWith("/api/monitoring") ||
      typeof window.dispatchEvent !== "function"
    )
      return;
    const detail: RequestFailureDiagnostic = {
      message,
      path: path.split(/[?#]/)[0],
      method: (init.method || "GET").toUpperCase(),
      requestId: observedRequestId || id,
      httpStatus: received?.status || 0,
      durationMs: Math.max(0, Math.round(performance.now() - started)),
      diagnostics: {
        stage,
        page_path: typeof location === "undefined" ? "" : location.pathname,
        response_received: Boolean(received),
        timeout_ms: effectiveTimeoutMs,
        online: typeof navigator === "undefined" ? undefined : navigator.onLine,
        exception_name: error instanceof Error ? error.name : "",
        exception_message:
          error instanceof Error ? error.message : String(error || ""),
        stack: error instanceof Error ? error.stack || "" : "",
        ...(responseBody
          ? { response_body: responseBody.slice(0, RESPONSE_DIAGNOSTIC_LIMIT) }
          : {}),
      },
    };
    window.dispatchEvent(new CustomEvent(REQUEST_FAILURE_EVENT, { detail }));
  };

  try {
    const response = await fetch(apiUrl(path, query), {
      // Local Studio/API use different ports; login cookies also authenticate native media.
      credentials: "include",
      ...init,
      body:
        body === undefined
          ? undefined
          : isFormData
            ? body
            : JSON.stringify(body),
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "X-Request-Id": id,
        ...(body !== undefined && !isFormData
          ? { "Content-Type": "application/json" }
          : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });
    received = response;
    let responseRequestId =
      response.headers.get("X-Request-Id") ||
      response.headers.get("x-request-id") ||
      id;
    observedRequestId = responseRequestId;
    const raw = await response.text();
    let parsed: unknown = undefined;
    try {
      parsed = raw ? JSON.parse(raw) : undefined;
    } catch {
      parsed = raw;
    }
    // Gateways can return HTML/text (not an API envelope). Inspecting `error`
    // with `in` on that string would turn an HTTP 504 into a fake network error.
    const envelope =
      parsed && typeof parsed === "object"
        ? (parsed as Partial<ApiEnvelope<T>>)
        : undefined;
    if (
      !response.headers.get("X-Request-Id") &&
      typeof envelope?.request_id === "string"
    ) {
      responseRequestId = observedRequestId = envelope.request_id;
    }

    if (response.status === 401) {
      clearAuthToken();
      window.dispatchEvent(new CustomEvent("ai-manju:auth-unauthorized"));
    }
    if (!response.ok || envelope?.success === false) {
      const upstreamError =
        envelope && "error" in envelope ? envelope.error : undefined;
      const message =
        (typeof upstreamError === "string"
          ? upstreamError
          : upstreamError?.message) || `请求失败（${response.status}）`;
      // A reverse proxy can fail before the API middleware receives a request.
      if (!envelope || typeof envelope.success !== "boolean")
        emitFailure(message, undefined, "gateway_response", raw);
      throw new ApiError(message, response.status, responseRequestId, parsed);
    }
    return envelope && envelope.success === true
      ? (envelope.data as T)
      : (parsed as T);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const message = signal?.aborted
      ? "请求已取消"
      : timedOut
        ? "请求超时"
        : received
          ? "响应读取失败"
          : "无法连接 API 服务";
    emitFailure(
      message,
      error,
      timedOut
        ? "request_timeout"
        : received
          ? "response_read"
          : "request_transport"
    );
    // Public cancellation wording stays compatible; diagnostics distinguish
    // the actual timeout, transport failure and caller cancellation.
    const publicMessage =
      timedOut ||
      signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
        ? "请求超时或已取消"
        : message;
    const failure = new ApiError(
      publicMessage,
      received?.status || 0,
      observedRequestId || id,
      error
    );
    failure.runtimeReported = true;
    throw failure;
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

export function getCollection(value: unknown): {
  items: unknown[];
  total?: number;
} {
  if (Array.isArray(value)) return { items: value, total: value.length };
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const items = [
      record.items,
      record.data,
      record.projects,
      record.assets,
      record.jobs,
      record.tags,
    ].find(Array.isArray) as unknown[] | undefined;
    return {
      items: items || [],
      total: typeof record.total === "number" ? record.total : items?.length,
    };
  }
  return { items: [] };
}
