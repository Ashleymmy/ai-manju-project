import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { request } from "./request";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function successfulResponse() {
  return new Response(JSON.stringify({ success: true, data: { ok: true } }), {
    status: 200,
    headers: { "Content-Type": "application/json", "X-Request-Id": "request-test" },
  });
}

describe("API request timeout contract", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("localStorage", new MemoryStorage());
    vi.stubGlobal("sessionStorage", new MemoryStorage());
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps the Studio default 15 second timeout", async () => {
    let requestSignal: AbortSignal | null = null;
    vi.mocked(fetch).mockImplementation((_url, options) => new Promise<Response>((_resolve, reject) => {
      requestSignal = options?.signal as AbortSignal;
      requestSignal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));

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
    vi.mocked(fetch).mockImplementation((_url, options) => new Promise<Response>((resolve) => {
      requestSignal = options?.signal as AbortSignal;
      resolveRequest = resolve;
    }));

    const result = request<{ ok: boolean }>("/api/slow", { timeoutMs: 0 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(requestSignal?.aborted).toBe(false);
    resolveRequest(successfulResponse());

    await expect(result).resolves.toEqual({ ok: true });
  });

  it("gives requests no timeout when timeoutMs is 0", async () => {
    let requestSignal: AbortSignal | null = null;
    let resolveRequest!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation((_url, options) => new Promise<Response>((resolve) => {
      requestSignal = options?.signal as AbortSignal;
      resolveRequest = resolve;
    }));

    const result = request<{ ok: boolean }>("/api/canvas/slow", { timeoutMs: 0 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(requestSignal?.aborted).toBe(false);
    resolveRequest(successfulResponse());

    await expect(result).resolves.toEqual({ ok: true });
  });
});
