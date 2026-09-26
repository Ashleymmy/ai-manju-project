// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createComicAnalysisSession } from "./api";

const input = { title: "Script", source_text: "Actor enters", instruction: "List actors", model: "model" };
const json = (status: number, data: unknown, success = true) => new Response(JSON.stringify({ success, data, ...(!success ? { error: "gateway" } : {}) }), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { vi.unstubAllGlobals(); });

it("seals a missing multipart claim and only a later user action creates a fresh key", async () => {
  const file = new File([input.source_text], "script.txt");
  let submittedKey = "";
  vi.mocked(fetch).mockResolvedValueOnce(json(200, { id: "owner" })).mockImplementationOnce(async (_url, init) => {
    submittedKey = (init?.headers as Record<string, string>)["Idempotency-Key"];
    return json(504, null, false);
  }).mockResolvedValueOnce(json(404, null, false))
    .mockImplementationOnce(async () => json(200, { receipt: { kind: "comic_analysis", key: submittedKey, status: "not_submitted" } }))
    .mockResolvedValueOnce(json(200, { status: "not_submitted" }));
  await expect(createComicAnalysisSession(input, file)).rejects.toMatchObject({ status: 504 });
  expect(fetch).toHaveBeenCalledTimes(5);
  expect(String(vi.mocked(fetch).mock.calls[3][0])).toContain(`/receipts/comic_analysis/${submittedKey}/reconcile`);
  expect(vi.mocked(fetch).mock.calls[3][1]?.method).toBe("POST");
  vi.mocked(fetch).mockResolvedValueOnce(json(200, { id: "owner" })).mockResolvedValueOnce(json(202, { session: { id: "analysis", status: "active" }, revisions: [] }));
  await createComicAnalysisSession(input, file);
  const nextKey = (vi.mocked(fetch).mock.calls[6][1]?.headers as Record<string, string>)["Idempotency-Key"];
  expect(nextKey).not.toBe(submittedKey);
});

it("retains the original identity when reconciliation metadata is unbound", async () => {
  const file = new File([input.source_text], "script.txt");
  vi.mocked(fetch).mockResolvedValueOnce(json(200, { id: "owner" })).mockResolvedValueOnce(json(504, null, false))
    .mockResolvedValueOnce(json(404, null, false))
    .mockResolvedValueOnce(json(200, { receipt: { kind: "comic_analysis", key: "foreign", status: "not_submitted" } }));
  await expect(createComicAnalysisSession(input, file)).rejects.toThrow("状态无法确认");
  expect(sessionStorage.length).toBe(1);
  vi.mocked(fetch).mockResolvedValueOnce(json(200, { id: "owner" })).mockResolvedValueOnce(json(200, { status: "ready", session_id: "analysis" }))
    .mockResolvedValueOnce(json(200, { session: { id: "analysis", status: "active" }, revisions: [] }));
  await createComicAnalysisSession(input, file);
  expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.body instanceof FormData)).toHaveLength(1);
});
