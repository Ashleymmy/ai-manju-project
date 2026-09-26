// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/api/http";
import { createComicBatch, retryComicBatchItem, retryFailedComicBatchItems } from "./api";

const auth = vi.hoisted(() => ({ token: "synthetic-token", userId: "user-one", request: vi.fn() }));
vi.mock("@/shared/api/http", async importOriginal => ({
  ...await importOriginal<typeof import("@/shared/api/http")>(),
  getAuthToken: () => auth.token,
  request: auth.request,
}));
const batch = { batch: { id: "batch-one", project_id: "project-one" }, items: [{ id: "item-one", attempt: 1 }] };
const input = { asset_ids: ["asset-one"], model_selector: "private-model", size: "1024x1024", concurrency: 1 as const };
const descriptor = () => JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!) || "null");
const response = (status: number, data: unknown) => new Response(JSON.stringify({ success: status < 400, data }), {
  status, headers: { "Content-Type": "application/json" },
});
type Options = { method?: string; headers?: Record<string, string>; body?: unknown };

beforeEach(() => {
  sessionStorage.clear(); localStorage.clear();
  auth.token = "synthetic-token"; auth.userId = "user-one";
  auth.request.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("comic batch submission recovery", () => {
  it("persists an opaque key before POST and recovers a lost response from the durable batch", async () => {
    let posts = 0;
    auth.request.mockImplementation(async (path: string, options?: Options) => {
      if (path === "/api/auth/me") return { id: auth.userId };
      if (options?.method === "POST") {
        posts++;
        expect(options.headers?.["Idempotency-Key"]).toBe(descriptor().key);
        expect(sessionStorage.getItem(sessionStorage.key(0)!)).not.toContain(input.model_selector);
        expect(sessionStorage.getItem(sessionStorage.key(0)!)).not.toContain(auth.token);
        throw new ApiError("response disconnected", 504);
      }
      expect(path).toBe(`/api/comic-asset-projects/project-one/generation-batch-submissions/${descriptor().key}`);
      return batch;
    });
    expect(await createComicBatch("project-one", input)).toEqual(batch);
    expect(posts).toBe(1); expect(fetch).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  it("retains unresolved submissions across retry and token renewal without another POST", async () => {
    let posts = 0;
    let available = false;
    auth.request.mockImplementation(async (path: string, options?: Options) => {
      if (path === "/api/auth/me") return { id: auth.userId };
      if (options?.method === "POST") { posts++; throw new ApiError("offline", 0); }
      if (!available) throw new ApiError("still unavailable", 503);
      return batch;
    });
    await expect(createComicBatch("project-one", input)).rejects.toThrow("still unavailable");
    const saved = descriptor();
    auth.token = "renewed-token";
    available = true;
    expect(await createComicBatch("project-one", input)).toEqual(batch);
    expect(posts).toBe(1);
    expect(auth.request.mock.calls.at(-1)?.[0]).toContain(saved.key);
  });

  it("rechecks a batch committed during a failed receipt read", async () => {
    let lookups = 0;
    let posts = 0;
    auth.request.mockImplementation(async (path: string, options?: Options) => {
      if (path === "/api/auth/me") return { id: auth.userId };
      if (options?.method === "POST") { posts++; throw new ApiError("offline", 0); }
      if (++lookups === 1) throw new ApiError("not found yet", 404);
      return batch;
    });
    vi.mocked(fetch).mockImplementationOnce(async () => response(409, {
      receipt: { kind: "comic_batch", key: descriptor().key, status: "uncertain" },
    }));
    expect(await createComicBatch("project-one", input)).toEqual(batch);
    expect(lookups).toBe(2); expect(posts).toBe(1);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("seals a missing original submission and allows only a later deliberate creation", async () => {
    let posts = 0;
    const keys: string[] = [];
    auth.request.mockImplementation(async (path: string, options?: Options) => {
      if (path === "/api/auth/me") return { id: auth.userId };
      if (options?.method === "POST") {
        keys.push(options.headers!["Idempotency-Key"]);
        if (++posts === 1) throw new ApiError("not delivered", 0);
        return batch;
      }
      throw new ApiError("not found", 404);
    });
    vi.mocked(fetch).mockImplementation(async (url, options) => {
      const receipt = { kind: "comic_batch", key: descriptor().key, status: "not_submitted" };
      if (options?.method === "POST") return response(200, { receipt });
      if (vi.mocked(fetch).mock.calls.length === 1) return response(404, undefined);
      return response(409, { receipt });
    });
    await expect(createComicBatch("project-one", input)).rejects.toMatchObject({ status: 409 });
    expect(posts).toBe(1); expect(sessionStorage.length).toBe(0);
    expect(await createComicBatch("project-one", input)).toEqual(batch);
    expect(posts).toBe(2); expect(keys[1]).not.toBe(keys[0]);
  });

  it("recovers changed input first without creating a second batch", async () => {
    let available = false;
    let posts = 0;
    auth.request.mockImplementation(async (path: string, options?: Options) => {
      if (path === "/api/auth/me") return { id: auth.userId };
      if (options?.method === "POST") { posts++; throw new ApiError("offline", 0); }
      if (!available) throw new ApiError("offline", 0);
      return batch;
    });
    await expect(createComicBatch("project-one", input)).rejects.toThrow("offline");
    available = true;
    await expect(createComicBatch("project-one", { ...input, model_selector: "different-model" })).rejects.toThrow("原操作已完成");
    expect(posts).toBe(1); expect(sessionStorage.length).toBe(0);
  });

  it("does not accept a lookup result for another project", async () => {
    let posts = 0;
    auth.request.mockImplementation(async (path: string, options?: Options) => {
      if (path === "/api/auth/me") return { id: auth.userId };
      if (options?.method === "POST") { posts++; throw new ApiError("offline", 0); }
      return { ...batch, batch: { ...batch.batch, project_id: "other-project" } };
    });
    await expect(createComicBatch("project-one", input)).rejects.toThrow("未返回可确认");
    expect(posts).toBe(1); expect(sessionStorage.length).toBe(1);
  });
});

describe("comic batch retries", () => {
  it.each(["single", "all"])("recovers a lost %s retry response without incrementing attempts a second time", async mode => {
    let posts = 0;
    auth.request.mockImplementation(async (path: string, options?: Options) => {
      if (path === "/api/auth/me") return { id: auth.userId };
      posts++;
      expect(options?.method).toBe("POST"); expect(options?.body).toEqual({});
      expect(options?.headers?.["Idempotency-Key"]).toBe(descriptor().key);
      expect(path).toBe(`/api/comic-asset-generation-batches/batch-one/${mode === "single" ? "items/item-one/retry" : "retry-failed"}`);
      throw new ApiError("timeout", 504);
    });
    vi.mocked(fetch).mockImplementationOnce(async url => {
      expect(String(url)).toContain(`/receipts/comic_batch/${descriptor().key}/result`);
      return response(200, batch);
    });
    const recovered = mode === "single" ? await retryComicBatchItem("batch-one", "item-one") : await retryFailedComicBatchItems("batch-one");
    expect(recovered).toEqual(batch); expect(posts).toBe(1); expect(fetch).toHaveBeenCalledOnce();
  });
});
