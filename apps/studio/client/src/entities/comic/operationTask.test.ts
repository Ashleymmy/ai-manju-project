// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/api/http";
import { awaitComicOperation } from "./operationTask";
import { createComicAnalysisRevision, optimizeComicPrompt } from "./api";

const auth = vi.hoisted(() => ({ token: "synthetic-token", userId: "user-one", request: vi.fn() }));
vi.mock("@/shared/api/http", async importOriginal => ({
  ...await importOriginal<typeof import("@/shared/api/http")>(),
  getAuthToken: () => auth.token,
  request: auth.request,
}));
const result = { id: "original-output" };
const payload = { direction: "private prompt", model: "model-one", operation: "optimize" };
const response = (status: number, data: unknown = undefined) => new Response(JSON.stringify({ success: status < 400, data }), {
  status, headers: { "Content-Type": "application/json" },
});
const descriptor = () => JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!) || "null");
function operation(submit: (key: string) => Promise<typeof result>, overrides: Partial<Parameters<typeof awaitComicOperation<typeof result>>[0]> = {}) {
  return awaitComicOperation({ kind: "comic_prompt", scope: "personal", resource: ["project", "asset"], payload,
    validate: value => (value as typeof result)?.id === result.id, submit, ...overrides });
}

beforeEach(() => {
  sessionStorage.clear(); localStorage.clear();
  auth.token = "synthetic-token"; auth.userId = "user-one";
  auth.request.mockReset().mockImplementation(async () => ({ id: auth.userId }));
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("durable comic operations", () => {
  it("persists only a private opaque descriptor before the paid POST", async () => {
    const submit = vi.fn(async key => {
      expect(descriptor()).toMatchObject({ version: 1, key, identity: expect.stringMatching(/^[a-f0-9]{64}$/), payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
      const stored = sessionStorage.getItem(sessionStorage.key(0)!)!;
      expect(stored).not.toContain(payload.direction);
      expect(stored).not.toContain(payload.model);
      expect(stored).not.toContain(auth.token);
      expect(stored).not.toContain(auth.userId);
      return result;
    });
    expect(await operation(submit)).toEqual(result);
    expect(submit).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  it("recovers a disconnected POST by GET without another paid submission", async () => {
    const submit = vi.fn(async () => { throw new ApiError("gateway", 504); });
    vi.mocked(fetch).mockImplementationOnce(async url => {
      expect(String(url)).toContain(`/receipts/comic_prompt/${descriptor().key}/result?scope=personal`);
      return response(200, result);
    });
    expect(await operation(submit)).toEqual(result);
    expect(submit).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledOnce();
    expect(sessionStorage.length).toBe(0);
  });

  it("keeps an uncertain identity across reload and token renewal for the same user", async () => {
    const submit = vi.fn(async () => { throw new ApiError("offline", 0); });
    vi.mocked(fetch).mockRejectedValueOnce(new Error("still offline"));
    await expect(operation(submit)).rejects.toThrow("still offline");
    const saved = descriptor();
    auth.token = "renewed-synthetic-token";
    vi.mocked(fetch).mockResolvedValueOnce(response(200, result));
    expect(await operation(submit, { payload: { operation: "optimize", model: "model-one", direction: "private prompt" } })).toEqual(result);
    expect(submit).toHaveBeenCalledOnce();
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toContain(saved.key);
    expect(sessionStorage.length).toBe(0);
  });

  it("recovers the original receipt even when changed input cannot be submitted yet", async () => {
    const submit = vi.fn(async () => { throw new ApiError("offline", 0); });
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    await expect(operation(submit)).rejects.toThrow("offline");
    const saved = descriptor();
    await expect(operation(submit, { payload: { ...payload, operation: "merge" } })).rejects.toThrow("offline");
    expect(submit).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledTimes(2);
    expect(descriptor()).toEqual(saved);
  });

  it("releases a successful old receipt after the UI version changes without submitting the new input", async () => {
    const submit = vi.fn().mockRejectedValueOnce(new ApiError("offline", 0)).mockResolvedValue(result);
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    await expect(operation(submit, { payload: { ...payload, expected_prompt_version: 1 } })).rejects.toThrow("offline");
    const saved = descriptor();
    vi.mocked(fetch).mockResolvedValueOnce(response(200, result));
    await expect(operation(submit, { payload: { ...payload, expected_prompt_version: 2 } })).rejects.toThrow("原操作已完成");
    expect(submit).toHaveBeenCalledOnce();
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toContain(saved.key);
    expect(sessionStorage.length).toBe(0);
    expect(await operation(submit, { payload: { ...payload, expected_prompt_version: 2 } })).toEqual(result);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1][0]).not.toBe(saved.key);
  });

  it("keeps a successful identity when storage removal fails and safely rereads it", async () => {
    const submit = vi.fn(async () => result);
    const removal = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(await operation(submit)).toEqual(result);
    const saved = descriptor();
    removal.mockRestore();
    vi.mocked(fetch).mockResolvedValueOnce(response(200, result));
    expect(await operation(submit)).toEqual(result);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain(saved.key);
    expect(submit).toHaveBeenCalledOnce(); expect(sessionStorage.length).toBe(0);
  });

  it("coalesces concurrent identical invocations and rejects a concurrent changed input", async () => {
    let resolve!: (value: typeof result) => void;
    const submit = vi.fn(() => new Promise<typeof result>(done => { resolve = done; }));
    const first = operation(submit);
    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
    const second = operation(submit);
    await expect(operation(submit, { payload: { ...payload, direction: "different" } })).rejects.toThrow("保持原输入");
    resolve(result);
    expect(await first).toEqual(result); expect(await second).toEqual(result);
    expect(submit).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  });

  it("never sends if browser storage cannot retain the descriptor", async () => {
    const submit = vi.fn(async () => result);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    await expect(operation(submit)).rejects.toThrow("尚未调用模型");
    expect(submit).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

  it("does not overwrite a malformed existing recovery record", async () => {
    const submit = vi.fn(async () => { throw new ApiError("offline", 0); });
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    await expect(operation(submit)).rejects.toThrow();
    const key = sessionStorage.key(0)!;
    sessionStorage.setItem(key, "broken-json");
    await expect(operation(submit)).rejects.toThrow("原操作记录无法读取");
    expect(submit).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem(key)).toBe("broken-json");
  });

  it.each(["account", "scope", "resource"] as const)("isolates pending descriptors by %s", async boundary => {
    const submit = vi.fn().mockRejectedValueOnce(new ApiError("offline", 0)).mockResolvedValue(result);
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    await expect(operation(submit)).rejects.toThrow("offline");
    const old = descriptor();
    if (boundary === "account") { auth.token = "other-token"; auth.userId = "other-user"; }
    expect(await operation(submit, boundary === "scope" ? { scope: "team" }
      : boundary === "resource" ? { resource: ["project", "another-asset"] } : {})).toEqual(result);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1][0]).not.toBe(old.key);
    expect(descriptor()).toEqual(old);
  });

  it("ignores a late result after the account switches and retains its original descriptor", async () => {
    let resolve!: (value: typeof result) => void;
    const submit = vi.fn(() => new Promise<typeof result>(done => { resolve = done; }));
    const pending = operation(submit);
    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
    const old = descriptor();
    auth.token = "new-account-token"; auth.userId = "new-account";
    resolve(result);
    await expect(pending).rejects.toThrow("账号已切换");
    expect(descriptor()).toEqual(old); expect(fetch).not.toHaveBeenCalled();
  });

  it("stops polling or reconciling after the account changes during a GET", async () => {
    const submit = vi.fn(async () => { throw new ApiError("offline", 0); });
    vi.mocked(fetch).mockImplementationOnce(async () => {
      auth.token = "new-account-token";
      return response(404);
    });
    await expect(operation(submit)).rejects.toThrow("账号已切换");
    expect(submit).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledOnce();
    expect(sessionStorage.length).toBe(1);
  });

  it.each(["failed", "not_submitted"])("only releases a %s receipt for a later deliberate invocation", async status => {
    const submit = vi.fn().mockRejectedValueOnce(new ApiError("gateway", 504)).mockResolvedValue(result);
    let originalKey = "";
    vi.mocked(fetch).mockImplementationOnce(async () => {
      originalKey = descriptor().key;
      return response(409, { receipt: { kind: "comic_prompt", key: originalKey, status } });
    });
    await expect(operation(submit)).rejects.toMatchObject({ status: 409 });
    expect(submit).toHaveBeenCalledOnce(); expect(sessionStorage.length).toBe(0);
    expect(await operation(submit)).toEqual(result);
    expect(submit.mock.calls[1][0]).not.toBe(originalKey);
  });

  it("reconciles missing receipts once without automatically generating another operation", async () => {
    const submit = vi.fn(async () => { throw new ApiError("gateway", 504); });
    vi.mocked(fetch).mockImplementation(async (url, options) => {
      const receipt = { kind: "comic_prompt", key: descriptor().key, status: "not_submitted" };
      return String(url).endsWith("reconcile?scope=personal")
        ? response(200, { receipt })
        : options?.method === "POST" ? response(500) : vi.mocked(fetch).mock.calls.length === 1 ? response(404) : response(409, { receipt });
    });
    await expect(operation(submit)).rejects.toMatchObject({ status: 409 });
    expect(submit).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledTimes(3);
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
    expect(sessionStorage.length).toBe(0);
  });

  it("retains the receipt when a returned result belongs to another resource", async () => {
    const submit = vi.fn(async () => ({ id: "foreign-output" }));
    vi.mocked(fetch).mockResolvedValueOnce(response(200, { id: "foreign-output" }));
    await expect(operation(submit)).rejects.toThrow("未返回可确认");
    expect(sessionStorage.length).toBe(1);
    expect(submit).toHaveBeenCalledOnce();
  });
});

describe("comic API receipt integration", () => {
  it("submits revisions with the correct receipt kind, resource and idempotency header", async () => {
    auth.request.mockImplementation(async (path: string, options?: { headers?: Record<string, string>; body?: unknown }) => {
      if (path === "/api/auth/me") return { id: auth.userId };
      expect(path).toBe("/api/comic-asset-analysis-sessions/session-1/revisions");
      expect(options?.headers?.["Idempotency-Key"]).toBe(descriptor().key);
      expect(options?.body).toMatchObject({ source: "ai", instruction: "private revision" });
      throw new ApiError("gateway", 504);
    });
    vi.mocked(fetch).mockImplementationOnce(async url => {
      expect(String(url)).toContain("/receipts/comic_revision/");
      expect(String(url)).toContain("scope=team");
      return response(200, { session: { id: "session-1" }, revisions: [] });
    });
    const revised = await createComicAnalysisRevision("session-1", {
      instruction: "private revision", model: "text", parent_revision_id: "parent", expected_active_revision_id: "parent",
    }, "team");
    expect(revised.session.id).toBe("session-1");
    expect(sessionStorage.length).toBe(0);
  });

  it.each(["optimize", "merge"] as const)("recovers %s only through its own asset receipt", async operation => {
    auth.request.mockImplementation(async (path: string, options?: { headers?: Record<string, string>; body?: unknown }) => {
      if (path === "/api/auth/me") return { id: auth.userId };
      expect(path).toBe("/api/comic-asset-projects/project/assets/asset/prompt-optimize");
      expect(options?.headers?.["Idempotency-Key"]).toBe(descriptor().key);
      expect(options?.body).toMatchObject({ operation });
      throw new ApiError("gateway", 504);
    });
    vi.mocked(fetch).mockImplementationOnce(async url => {
      expect(String(url)).toContain("/receipts/comic_prompt/");
      return response(200, { asset: { id: "asset", project_id: "project", draft_prompt: "result" } });
    });
    const optimized = await optimizeComicPrompt("project", "asset", { direction: "private", model: "text", operation });
    expect(optimized.asset.draft_prompt).toBe("result");
    expect(sessionStorage.length).toBe(0);
  });
});
