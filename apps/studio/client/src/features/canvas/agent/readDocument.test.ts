import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readAgentDocument } from "./readDocument";
import { AGENT_DOCUMENT_LIMITS } from "./documents";

let worker: FakeWorker;
class FakeWorker {
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: { preventDefault: () => void }) => void;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() { worker = this; }
}
const file = () => ({ name: "a.txt", size: 4, arrayBuffer: async () => new ArrayBuffer(4) }) as File;
beforeEach(() => { vi.stubGlobal("Worker", FakeWorker); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it("returns parsed content and terminates its worker", async () => {
  const promise = readAgentDocument(file(), new AbortController().signal);
  await Promise.resolve();
  worker.onmessage!({ data: { text: "document body" } });
  expect(await promise).toBe("document body");
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it.each(["abort", "timeout", "error", "parser"])("terminates and rejects on %s", async event => {
  const controller = new AbortController();
  const promise = readAgentDocument(file(), controller.signal);
  const assertion = expect(promise).rejects.toThrow();
  await Promise.resolve();
  if (event === "abort") controller.abort();
  if (event === "timeout") await vi.advanceTimersByTimeAsync(AGENT_DOCUMENT_LIMITS.timeoutMs);
  if (event === "error") worker.onerror!({ preventDefault: vi.fn() });
  if (event === "parser") worker.onmessage!({ data: { error: "Bad document" } });
  await assertion;
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
