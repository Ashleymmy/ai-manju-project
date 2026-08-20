import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateImages,
  generatedImagesFromJob,
  submitImageEdit,
  submitImageGeneration,
} from "./image";
import type { Job } from "./jobs";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function apiResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: status < 400, data }), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-Id": "test-request" },
  });
}

describe("image API", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const NativeURL = globalThis.URL;
    class TestURL extends NativeURL {
      static createObjectURL = vi.fn(() => "blob:test-image");
      static revokeObjectURL = vi.fn();
    }
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("localStorage", new MemoryStorage());
    vi.stubGlobal("sessionStorage", new MemoryStorage());
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("URL", TestURL);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("submits generation with the production JSON contract", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(apiResponse({ job_id: "job-generation", status: "queued" }));

    await submitImageGeneration({
      prompt: "雨夜街道",
      model: "provider::image-v1",
      size: "16:9",
      quality: "high",
      count: 3,
      scope: "team",
      sourceType: "canvas",
      sourceProjectId: "project-1",
      sourceNodeId: "node-1",
    });

    const [url, options] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/api/ai/image/generations");
    expect(new URL(url).searchParams.get("scope")).toBe("team");
    expect(options.method).toBe("POST");
    expect((options.headers as Record<string, string>)["Idempotency-Key"]).toBeTruthy();
    expect(JSON.parse(String(options.body))).toMatchObject({
      model: "provider::image-v1",
      prompt: "雨夜街道",
      size: "16:9",
      quality: "high",
      n: 3,
      response_format: "b64_json",
      output_format: "png",
      asset_context: {
        source_type: "canvas",
        source_project_id: "project-1",
        source_node_id: "node-1",
      },
    });
  });

  it("submits references to the image edit endpoint", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(apiResponse({ job_id: "job-edit", status: "queued" }));
    const first = new File(["first"], "first.png", { type: "image/png" });
    const second = new File(["second"], "second.webp", { type: "image/webp" });
    const mask = new File(["mask"], "mask.png", { type: "image/png" });

    await submitImageEdit({
      prompt: "保持人物并改成侧光",
      model: "provider::image-edit",
      size: "1:1",
      quality: "medium",
      referenceFiles: [first, second],
      maskFile: mask,
      scope: "personal",
      sourceType: "canvas",
      sourceProjectId: "project-2",
      sourceNodeId: "node-2",
    });

    const [url, options] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/api/ai/image/edits");
    const body = options.body as FormData;
    expect(body.get("model")).toBe("provider::image-edit");
    expect(body.get("prompt")).toBe("保持人物并改成侧光");
    expect(body.getAll("image")).toEqual([first, second]);
    expect(body.get("mask")).toMatchObject({ name: "mask.png", size: mask.size, type: "image/png" });
    expect(JSON.parse(String(body.get("asset_context")))).toMatchObject({
      source_type: "canvas",
      source_project_id: "project-2",
      source_node_id: "node-2",
    });
  });

  it("reports accepted and progress before surfacing a terminal error", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(apiResponse({ job_id: "job-failed", status: "queued" }))
      .mockResolvedValueOnce(apiResponse({ id: "job-failed", type: "image.generate", status: "running", progress: 35 }))
      .mockResolvedValueOnce(apiResponse({ id: "job-failed", type: "image.generate", status: "failed", progress: 35, error: "provider rejected" }));
    const accepted = vi.fn();
    const progress = vi.fn();

    const result = generateImages({ prompt: "失败测试" }, { onAccepted: accepted, onProgress: progress });
    const rejection = expect(result).rejects.toThrow("provider rejected");
    await vi.advanceTimersByTimeAsync(2_500);

    await rejection;
    expect(accepted).toHaveBeenCalledWith(expect.objectContaining({ job_id: "job-failed" }));
    expect(progress).toHaveBeenNthCalledWith(1, expect.objectContaining({ status: "running", progress: 35 }));
    expect(progress).toHaveBeenNthCalledWith(2, expect.objectContaining({ status: "failed" }));
  });

  it("does not continue polling after abort", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(apiResponse({ job_id: "job-abort", status: "queued" }))
      .mockResolvedValueOnce(apiResponse({ id: "job-abort", type: "image.generate", status: "running", progress: 10 }));
    const controller = new AbortController();

    const result = generateImages({ prompt: "取消测试" }, {
      signal: controller.signal,
      onProgress: () => controller.abort(),
    });
    const rejection = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    await rejection;
    await vi.advanceTimersByTimeAsync(10_000);

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("deduplicates repeated asset IDs", async () => {
    const job = {
      id: "job-assets",
      type: "image.generate",
      status: "succeeded",
      state: "succeeded",
      result: {
        assets: [
          { asset_id: "asset-1", name: "first.png", content_type: "image/png" },
          { asset_id: "asset-1", name: "duplicate.png", content_type: "image/png" },
        ],
      },
    } as Job;

    const images = await generatedImagesFromJob(job, "personal");

    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ assetId: "asset-1", name: "first.png" });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
