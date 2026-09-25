import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isDefinitiveGenerationReceiptFailure, readGenerationReceiptResult } from "./generationReceipt";

vi.mock("./request", async importOriginal => ({
  ...await importOriginal<typeof import("./request")>(),
  getAuthToken: () => "test-token",
  clearAuthToken: vi.fn(),
}));

const receipt = { key: "original-key", scope: "team" as const };
function response(status: number, data?: unknown) {
  return new Response(JSON.stringify({ success: status < 400, data }), {
    status, headers: { "Content-Type": "application/json" },
  });
}
const stored = (status: string, key = receipt.key) => ({ receipt: { key, kind: "text", status } });

describe("generation receipt reconciliation", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("seals a missing identity without generating and exposes authoritative not_submitted", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(404));
    vi.mocked(fetch).mockResolvedValueOnce(response(200, stored("not_submitted")));
    vi.mocked(fetch).mockResolvedValueOnce(response(409, stored("not_submitted")));
    const error = await readGenerationReceiptResult("text", receipt).catch(error => error);
    expect(isDefinitiveGenerationReceiptFailure(error)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
    const [url, options] = vi.mocked(fetch).mock.calls[1];
    expect(String(url)).toContain("/api/ai/receipts/text/original-key/reconcile?scope=team");
    expect(options).toMatchObject({ method: "POST", credentials: "include", cache: "no-store", headers: { Authorization: "Bearer test-token" } });
    expect(options?.body).toBeUndefined();
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).includes("/receipts/"))).toBe(true);
  });

  it("retrieves the original result when original execution wins the race", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValueOnce(response(404));
    vi.mocked(fetch).mockResolvedValueOnce(response(200, stored("running")));
    vi.mocked(fetch).mockResolvedValueOnce(response(202, stored("running")));
    vi.mocked(fetch).mockResolvedValueOnce(response(200, { content: "original result" }));
    const pending = readGenerationReceiptResult("text", receipt);
    await vi.advanceTimersByTimeAsync(1_500);
    expect((await (await pending).json()).data.content).toBe("original result");
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  });

  it.each([401, 403, 404, 503])("keeps a receipt recoverable when reconcile returns %s", async status => {
    vi.mocked(fetch).mockResolvedValueOnce(response(404));
    vi.mocked(fetch).mockResolvedValueOnce(response(status));
    const error = await readGenerationReceiptResult("text", receipt).catch(error => error);
    expect(error.status).toBe(status);
    expect(isDefinitiveGenerationReceiptFailure(error)).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    { receipt: { status: "not_submitted" } },
    stored("not_submitted", "foreign-key"),
    { receipt: { key: receipt.key, kind: "audio", status: "not_submitted" } },
    stored("unrecognized"),
    undefined,
  ])("does not trust malformed or mismatched reconciliation: %j", async data => {
    vi.mocked(fetch).mockResolvedValueOnce(response(404));
    vi.mocked(fetch).mockResolvedValueOnce(response(200, data));
    const error = await readGenerationReceiptResult("text", receipt).catch(error => error);
    expect(error.status).toBe(404);
    expect(isDefinitiveGenerationReceiptFailure(error)).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not loop on a second missing response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(404));
    vi.mocked(fetch).mockResolvedValueOnce(response(200, stored("not_submitted")));
    vi.mocked(fetch).mockResolvedValueOnce(response(404));
    await expect(readGenerationReceiptResult("text", receipt)).rejects.toMatchObject({ status: 404 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each(["reconcile", "result"])("does not clear a request from mismatched %s error metadata", async stage => {
    vi.mocked(fetch).mockResolvedValueOnce(response(404));
    if (stage === "result") vi.mocked(fetch).mockResolvedValueOnce(response(200, stored("running")));
    vi.mocked(fetch).mockResolvedValueOnce(response(409, stored("not_submitted", "another-key")));
    const error = await readGenerationReceiptResult("text", receipt).catch(error => error);
    expect(isDefinitiveGenerationReceiptFailure(error)).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(stage === "result" ? 3 : 2);
  });

  it("does not release a key on reconcile failure even with matching terminal metadata", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(404));
    vi.mocked(fetch).mockResolvedValueOnce(response(503, stored("not_submitted")));
    const error = await readGenerationReceiptResult("text", receipt).catch(error => error);
    expect(isDefinitiveGenerationReceiptFailure(error)).toBe(false);
  });

  it("honors cancellation before reconciling and forwards cancellation during reconciliation", async () => {
    const aborted = new AbortController(); aborted.abort();
    await expect(readGenerationReceiptResult("text", receipt, aborted.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
    const controller = new AbortController();
    vi.mocked(fetch).mockResolvedValueOnce(response(404));
    vi.mocked(fetch).mockImplementationOnce(async (_url, options) => {
      expect(options?.signal).toBe(controller.signal);
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    await expect(readGenerationReceiptResult("text", receipt, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403, 409, 410, 502, 503])("never reconciles an existing or unavailable receipt (%s)", async status => {
    vi.mocked(fetch).mockResolvedValueOnce(response(status, stored(status === 502 ? "failed" : "uncertain")));
    await expect(readGenerationReceiptResult("text", receipt)).rejects.toMatchObject({ status });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
