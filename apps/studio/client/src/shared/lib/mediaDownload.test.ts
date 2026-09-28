import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMediaBlob, MEDIA_DOWNLOAD_IDLE_TIMEOUT_MS } from "./mediaDownload";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("reference media transfers", () => {
  it.each(["timeout", "cancel"] as const)("disposes a response arriving after %s without restarting an idle timer", async interruption => {
    vi.useFakeTimers();
    let resolveFetch!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { resolveFetch = resolve; })));
    const controller = new AbortController();
    const result = fetchMediaBlob("https://media.test/file", { signal: controller.signal }).catch(error => error);
    if (interruption === "timeout") await vi.advanceTimersByTimeAsync(MEDIA_DOWNLOAD_IDLE_TIMEOUT_MS);
    else controller.abort();
    await result;
    const canceled = vi.fn();
    resolveFetch(new Response(new ReadableStream<Uint8Array>({ cancel: canceled })));
    await vi.advanceTimersByTimeAsync(0);
    expect(canceled).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores a read that resolves with data after the stalled reader was canceled", async () => {
    vi.useFakeTimers();
    let resolveRead!: (value: ReadableStreamReadResult<Uint8Array>) => void;
    const reader = {
      read: vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(resolve => { resolveRead = resolve; })),
      cancel: vi.fn(async () => undefined),
    };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, body: { getReader: () => reader } }) as unknown as Response));
    const result = fetchMediaBlob("https://media.test/file").catch(error => error);
    await vi.advanceTimersByTimeAsync(MEDIA_DOWNLOAD_IDLE_TIMEOUT_MS);
    expect((await result).message).toContain("传输已停止");
    resolveRead({ done: false, value: new Uint8Array([1]) });
    await vi.advanceTimersByTimeAsync(0);
    expect(reader.cancel).toHaveBeenCalledOnce();
    expect(reader.read).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out a stalled request and aborts its network connection", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetcher);
    const result = fetchMediaBlob("https://media.test/file").catch(error => error);
    await vi.advanceTimersByTimeAsync(MEDIA_DOWNLOAD_IDLE_TIMEOUT_MS);
    expect((await result).message).toContain("传输已停止");
    expect((fetcher.mock.calls[0] as unknown as [unknown, RequestInit])[1].signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("lets progressing files exceed the idle timeout without imposing a batch deadline", async () => {
    vi.useFakeTimers();
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) { source = controller; } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { headers: { "Content-Type": "video/mp4" } })));
    const result = fetchMediaBlob("https://media.test/large");
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(MEDIA_DOWNLOAD_IDLE_TIMEOUT_MS - 1);
      source.enqueue(new Uint8Array([i]));
      await vi.advanceTimersByTimeAsync(0);
    }
    source.close();
    const blob = await result;
    expect(blob.type).toBe("video/mp4");
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0, 1, 2, 3]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a stalled body reader and preserves explicit user cancellation", async () => {
    vi.useFakeTimers();
    const canceled = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel: canceled });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    const controller = new AbortController();
    const result = fetchMediaBlob("https://media.test/file", { signal: controller.signal }).catch(error => error);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect((await result).name).toBe("AbortError");
    expect(canceled).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
