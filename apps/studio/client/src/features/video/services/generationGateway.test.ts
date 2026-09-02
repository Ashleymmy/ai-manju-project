import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createVideoGenerationTask,
  normalizeVideoGenerationConfig,
  pollVideoGenerationTask,
  videoGenerationResultToBlob,
  type VideoGenerationConfig,
} from "./generationGateway";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const config: VideoGenerationConfig = {
  model: "provider::video-v1",
  size: "1280x720",
  resolution: "720p",
  seconds: "6",
  generateAudio: true,
  watermark: false,
};

function apiResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: status < 400, data }), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-Id": "video-request" },
  });
}

describe("video API", () => {
  beforeEach(() => {
    const NativeURL = globalThis.URL;
    class TestURL extends NativeURL {
      static createObjectURL = vi.fn(() => "blob:video-result");
      static revokeObjectURL = vi.fn();
    }
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("localStorage", new MemoryStorage());
    vi.stubGlobal("sessionStorage", new MemoryStorage());
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("URL", TestURL);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("submits an OpenAI-compatible video task with the production form contract", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(apiResponse({ job_id: "video-job" }));
    const reference = new File(["image"], "reference.png", { type: "image/png" });

    const task = await createVideoGenerationTask(config, "镜头缓慢推近", {
      images: [{
        id: "image-1",
        kind: "image",
        file: reference,
        name: reference.name,
        mime: reference.type,
        bytes: reference.size,
        width: 1280,
        height: 720,
      }],
      videos: [],
      audios: [],
    });

    const [url, options] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const body = options.body as FormData;
    expect(new URL(url).pathname).toBe("/api/ai/videos");
    expect(options.method).toBe("POST");
    expect(body.get("model")).toBe(config.model);
    expect(body.get("prompt")).toBe("镜头缓慢推近");
    expect(body.get("seconds")).toBe("6");
    expect(body.get("size")).toBe("1280x720");
    expect(body.getAll("input_reference[]")).toEqual([reference]);
    expect(task).toEqual({ id: "video-job", provider: "openai", model: config.model });
  });

  it("passes asset references through the Seedance content contract", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(apiResponse({ id: "seedance-task" }));
    const seedanceConfig = { ...config, model: "provider::doubao-seedance-2-5-pro" };

    const task = await createVideoGenerationTask(seedanceConfig, "保持人物一致并转身", {
      images: [{
        id: "material-person",
        kind: "image",
        url: "asset://material-person",
        name: "授权人物",
        mime: "image/png",
        bytes: 0,
        width: 0,
        height: 0,
      }],
      videos: [{
        id: "volcano-motion",
        kind: "video",
        url: "asset://volcano-motion",
        name: "动作参考",
        mime: "video/mp4",
        bytes: 0,
        width: 0,
        height: 0,
        durationMs: 0,
      }],
      audios: [],
    });

    const [url, options] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(options.body)) as { content: Array<Record<string, unknown>> };
    expect(new URL(url).pathname).toBe("/api/ai/contents/generations/tasks");
    expect(body.content).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "image_url",
        image_url: { url: "asset://material-person" },
        role: "reference_image",
      }),
      expect.objectContaining({
        type: "video_url",
        video_url: { url: "asset://volcano-motion" },
        role: "reference_video",
      }),
    ]));
    expect(task).toEqual({ id: "seedance-task", provider: "seedance", model: seedanceConfig.model });
  });

  it("rejects asset references before an OpenAI-compatible request is sent", async () => {
    await expect(createVideoGenerationTask(config, "不应发送", {
      images: [{
        id: "material-person",
        kind: "image",
        url: "asset://material-person",
        name: "授权人物",
        mime: "image/png",
        bytes: 0,
        width: 0,
        height: 0,
      }],
      videos: [],
      audios: [],
    })).rejects.toThrow("asset:// 素材引用仅支持 Seedance / 火山视频模型");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports running progress and terminal provider errors", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(apiResponse({ id: "video-job", type: "video.generate", status: "running", progress: 42 }))
      .mockResolvedValueOnce(apiResponse({ id: "video-job", type: "video.generate", status: "failed", progress: 42, error: "provider rejected" }));
    const progress = vi.fn();
    const task = { id: "video-job", provider: "openai" as const, model: config.model };

    await expect(pollVideoGenerationTask(config, task, { onProgress: progress })).resolves.toEqual({ status: "pending", progress: 42 });
    await expect(pollVideoGenerationTask(config, task)).resolves.toEqual({ status: "failed", error: "provider rejected" });
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ status: "running", progress: 42 }));
  });

  it("normalizes a completed asset-backed result", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(apiResponse({
        id: "video-job",
        type: "video.generate",
        status: "succeeded",
        scope: "team",
        result: { assets: [{ id: "asset-video", name: "result.mp4", content_type: "video/mp4" }] },
      }))
      .mockResolvedValueOnce(new Response(new Blob(["video"], { type: "video/mp4" }), { status: 200 }));

    const state = await pollVideoGenerationTask(config, { id: "video-job", provider: "openai", model: config.model });

    expect(state).toEqual({
      status: "completed",
      result: {
        url: "blob:video-result",
        mimeType: "video/mp4",
        fileName: "result.mp4",
        assetId: "asset-video",
        scope: "team",
        ephemeral: true,
      },
    });
    expect(new URL(String(vi.mocked(fetch).mock.calls[1][0])).pathname).toBe("/api/assets/asset-video/content");
  });

  it("forwards abort signals during task creation and result download", async () => {
    const createController = new AbortController();
    vi.mocked(fetch).mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const createResult = createVideoGenerationTask(config, "取消任务", undefined, { signal: createController.signal });
    createController.abort();
    await expect(createResult).rejects.toMatchObject({ name: "ApiError", message: "请求超时或已取消", status: 0 });

    const downloadController = new AbortController();
    vi.mocked(fetch).mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const downloadResult = videoGenerationResultToBlob({ url: "/api/assets/video/content", mimeType: "video/mp4" }, downloadController.signal);
    downloadController.abort();
    await expect(downloadResult).rejects.toMatchObject({ name: "AbortError" });
  });

  it("保留 OpenAI-compatible 自定义宽高、清晰度和时长", () => {
    expect(normalizeVideoGenerationConfig({
      ...config,
      size: "1536x864",
      resolution: "900",
      seconds: "13",
    })).toEqual({
      ...config,
      size: "1536x864",
      resolution: "900p",
      seconds: "13",
    });
  });
});
