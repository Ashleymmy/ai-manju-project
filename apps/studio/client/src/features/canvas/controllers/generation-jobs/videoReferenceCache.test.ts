import { afterEach, expect, it, vi } from "vitest";
import { VideoReferenceCache } from "./videoReferenceCache";
afterEach(() => vi.useRealTimers());
const result = { references: { images: [], videos: [], audios: [] }, snapshot: { items: [] } };
it("reuses reads briefly and isolates project, source changes and canceled work", async () => {
  const cache = new VideoReferenceCache();
  const load = vi.fn(async () => result);
  await cache.read("a", "personal", [], undefined, load);
  await cache.read("a", "personal", [], undefined, load);
  expect(load).toHaveBeenCalledTimes(1);
  await cache.read("b", "personal", [], undefined, load);
  expect(load).toHaveBeenCalledTimes(2);
  const abort = new AbortController(); abort.abort();
  await expect(cache.read("b", "personal", [], abort.signal, load)).rejects.toMatchObject({ name: "AbortError" });
  cache.clear();
  await cache.read("b", "personal", [], undefined, load);
  expect(load).toHaveBeenCalledTimes(3);
});
it("bounds stalled media reads and aborts the underlying request", async () => {
  vi.useFakeTimers();
  const cache = new VideoReferenceCache();
  let signal!: AbortSignal;
  const promise = cache.read("a", "personal", [], undefined, input => { signal = input; return new Promise(() => {}); });
  const assertion = expect(promise).rejects.toThrow("参考素材读取超时，尚未开始生成");
  await vi.advanceTimersByTimeAsync(20_000);
  await assertion;
  expect(signal.aborted).toBe(true);
});
