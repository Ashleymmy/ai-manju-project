// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/api/http";
import { listComicAnalysisHistory, resumeComicAnalysis } from "./analysisHistory";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/shared/api/http", async original => ({
  ...await original<typeof import("@/shared/api/http")>(), request: mocks.request,
}));
const session = (status = "active", id = "session-one") => ({ session: { id, status }, revisions: [] });

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); mocks.request.mockReset(); vi.stubGlobal("crypto", {}); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("analysis discovery transport", () => {
  it("uses only scoped GET requests to discover and recover an existing analysis", async () => {
    const controller = new AbortController();
    mocks.request.mockResolvedValueOnce({ items: [], next_cursor: "next" })
      .mockResolvedValueOnce(session("processing")).mockResolvedValueOnce(session());
    await listComicAnalysisHistory("team", "cursor", controller.signal);
    const pending = resumeComicAnalysis("session-one", "team", controller.signal);
    await vi.runAllTimersAsync();
    expect((await pending).session.id).toBe("session-one");
    expect(mocks.request.mock.calls.every(([, options]) => !options.method || options.method === "GET")).toBe(true);
    expect(mocks.request).toHaveBeenNthCalledWith(1, "/api/comic-asset-analysis-sessions", {
      query: { scope: "team", cursor: "cursor" }, signal: controller.signal,
    });
    expect(mocks.request).toHaveBeenLastCalledWith("/api/comic-asset-analysis-sessions/session-one", {
      query: { scope: "team" }, signal: controller.signal,
    });
    expect(sessionStorage.length).toBe(0);
  });

  it("never replaces a missing discovered session with a paid submission", async () => {
    mocks.request.mockRejectedValueOnce(new ApiError("missing", 404));
    const pending = expect(resumeComicAnalysis("session-one", "personal")).rejects.toMatchObject({ status: 404 });
    await vi.runAllTimersAsync(); await pending;
    expect(mocks.request).toHaveBeenCalledOnce();
    expect(mocks.request.mock.calls[0][1].method).toBeUndefined();
  });

  it("rejects a different session returned by a stale response", async () => {
    mocks.request.mockResolvedValue(session("active", "other-session"));
    const pending = expect(resumeComicAnalysis("session-one", "personal")).rejects.toThrow();
    await vi.runAllTimersAsync(); await pending;
    expect(mocks.request.mock.calls.every(([path]) => path.endsWith("/session-one"))).toBe(true);
  });
});
