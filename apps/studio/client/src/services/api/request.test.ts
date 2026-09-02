import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiError as SharedApiError,
  request as sharedRequest,
} from "@/shared/api/http";
import {
  ApiError,
  clearAuthToken,
  getAuthToken,
  request,
  setAuthToken,
} from "./request";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function successfulResponse() {
  return new Response(JSON.stringify({ success: true, data: { ok: true } }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": "request-test",
    },
  });
}

describe("API request contract", () => {
  const dispatchEvent = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    dispatchEvent.mockReset();
    vi.stubGlobal("window", {
      clearTimeout: globalThis.clearTimeout,
      dispatchEvent,
      setTimeout: globalThis.setTimeout,
    });
    vi.stubGlobal("localStorage", new MemoryStorage());
    vi.stubGlobal("sessionStorage", new MemoryStorage());
    vi.stubGlobal("fetch", vi.fn());
  });

  it("keeps the legacy request module as an explicit compatibility forwarder", () => {
    expect(request).toBe(sharedRequest);
    expect(ApiError).toBe(SharedApiError);
  });

  it("keeps the token keys and selected storage semantics", () => {
    setAuthToken("session-token", false);
    expect(sessionStorage.getItem("ai-manju:auth_token")).toBe("session-token");
    expect(localStorage.getItem("ai-manju:auth_token")).toBeNull();
    expect(localStorage.getItem("ai-manju:token-store")).toBe("session");
    expect(getAuthToken()).toBe("session-token");

    setAuthToken("local-token", true);
    expect(localStorage.getItem("ai-manju:auth_token")).toBe("local-token");
    expect(sessionStorage.getItem("ai-manju:auth_token")).toBeNull();
    expect(localStorage.getItem("ai-manju:token-store")).toBe("local");
    expect(getAuthToken()).toBe("local-token");

    clearAuthToken();
    expect(localStorage.getItem("ai-manju:auth_token")).toBeNull();
    expect(localStorage.getItem("ai-manju:token-store")).toBeNull();
    expect(sessionStorage.getItem("ai-manju:auth_token")).toBeNull();
  });

  it("keeps the response envelope, query, JSON body and auth headers", async () => {
    setAuthToken("token-value", true);
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: { id: "asset-1" } }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": "server-request",
        },
      })
    );

    await expect(
      request<{ id: string }>("api/assets", {
        body: { title: "测试" },
        method: "POST",
        query: { archived: false, page: 2, skipped: undefined },
      })
    ).resolves.toEqual({ id: "asset-1" });

    const [url, options] = vi.mocked(fetch).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const parsedUrl = new URL(url);
    expect(parsedUrl.pathname).toBe("/api/assets");
    expect(parsedUrl.searchParams.get("archived")).toBe("false");
    expect(parsedUrl.searchParams.get("page")).toBe("2");
    expect(parsedUrl.searchParams.has("skipped")).toBe(false);
    expect(options.body).toBe(JSON.stringify({ title: "测试" }));
    expect(options.headers).toMatchObject({
      Accept: "application/json",
      Authorization: "Bearer token-value",
      "Content-Type": "application/json",
    });
  });

  it("preserves ApiError status, requestId and envelope details", async () => {
    const details = {
      success: false,
      error: "参数无效",
      request_id: "body-request",
    };
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(details), {
        status: 422,
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": "header-request",
        },
      })
    );

    await expect(request("/api/assets")).rejects.toMatchObject({
      details,
      message: "参数无效",
      name: "ApiError",
      requestId: "header-request",
      status: 422,
    });
  });

  it("clears authentication and emits the same unauthorized event on 401", async () => {
    setAuthToken("expired-token", true);
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    );

    await expect(request("/api/session")).rejects.toMatchObject({
      status: 401,
    });
    expect(localStorage.getItem("ai-manju:auth_token")).toBeNull();
    expect(localStorage.getItem("ai-manju:token-store")).toBeNull();
    expect(dispatchEvent).toHaveBeenCalledOnce();
    expect(dispatchEvent.mock.calls[0]?.[0]).toMatchObject({
      type: "ai-manju:auth-unauthorized",
    });
  });

  it("forwards an external AbortSignal to the transport controller", async () => {
    const controller = new AbortController();
    vi.mocked(fetch).mockImplementationOnce(
      (_url, options) =>
        new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        })
    );

    const result = request("/api/slow", {
      signal: controller.signal,
      timeoutMs: 0,
    });
    controller.abort();

    await expect(result).rejects.toMatchObject({
      message: "请求超时或已取消",
      name: "ApiError",
      status: 0,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps the Studio default 15 second timeout", async () => {
    let requestSignal: AbortSignal | null = null;
    vi.mocked(fetch).mockImplementation(
      (_url, options) =>
        new Promise<Response>((_resolve, reject) => {
          requestSignal = options?.signal as AbortSignal;
          requestSignal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError"))
          );
        })
    );

    const result = request("/api/slow");
    const rejection = expect(result).rejects.toMatchObject({ status: 0 });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(requestSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await rejection;
    expect(requestSignal?.aborted).toBe(true);
  });

  it("treats timeoutMs zero as no timeout", async () => {
    let requestSignal: AbortSignal | null = null;
    let resolveRequest!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(
      (_url, options) =>
        new Promise<Response>(resolve => {
          requestSignal = options?.signal as AbortSignal;
          resolveRequest = resolve;
        })
    );

    const result = request<{ ok: boolean }>("/api/slow", { timeoutMs: 0 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(requestSignal?.aborted).toBe(false);
    resolveRequest(successfulResponse());

    await expect(result).resolves.toEqual({ ok: true });
  });

  it("gives requests no timeout when timeoutMs is 0", async () => {
    let requestSignal: AbortSignal | null = null;
    let resolveRequest!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(
      (_url, options) =>
        new Promise<Response>(resolve => {
          requestSignal = options?.signal as AbortSignal;
          resolveRequest = resolve;
        })
    );

    const result = request<{ ok: boolean }>("/api/canvas/slow", {
      timeoutMs: 0,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(requestSignal?.aborted).toBe(false);
    resolveRequest(successfulResponse());

    await expect(result).resolves.toEqual({ ok: true });
  });
});
