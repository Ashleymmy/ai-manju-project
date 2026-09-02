import { API_BASE_URL } from "../../config/api";

export { API_BASE_URL };

export type ApiEnvelope<T> =
  | { success: true; data: T; request_id?: string }
  | { success: false; error?: string; request_id?: string };

export class ApiError extends Error {
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
  const effectiveTimeoutMs =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0;
  const timer =
    effectiveTimeoutMs > 0
      ? window.setTimeout(() => controller.abort(), effectiveTimeoutMs)
      : undefined;
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener("abort", onExternalAbort, { once: true });
  const id = requestId();
  const token = getAuthToken();
  const isFormData = body instanceof FormData;

  try {
    const response = await fetch(apiUrl(path, query), {
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
    const responseRequestId =
      response.headers.get("X-Request-Id") ||
      response.headers.get("x-request-id") ||
      id;
    const raw = await response.text();
    let parsed: unknown = undefined;
    try {
      parsed = raw ? JSON.parse(raw) : undefined;
    } catch {
      parsed = raw;
    }
    const envelope = parsed as Partial<ApiEnvelope<T>> | undefined;

    if (response.status === 401) {
      clearAuthToken();
      window.dispatchEvent(new CustomEvent("ai-manju:auth-unauthorized"));
    }
    if (!response.ok || envelope?.success === false) {
      const message =
        (envelope && "error" in envelope && envelope.error) ||
        `请求失败（${response.status}）`;
      throw new ApiError(message, response.status, responseRequestId, parsed);
    }
    return envelope && envelope.success === true
      ? (envelope.data as T)
      : (parsed as T);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const message =
      error instanceof DOMException && error.name === "AbortError"
        ? "请求超时或已取消"
        : "无法连接 API 服务";
    throw new ApiError(message, 0, id, error);
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
