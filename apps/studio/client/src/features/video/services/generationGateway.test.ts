import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { replaceVideoModelDurations } from "@/entities/model/videoDuration";

import {
  createVideoGenerationTask,
  fetchVideoModelCatalog,
  h3VideoSettings,
  isSeedanceVideoModel,
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
  it.each(["sdvideo/seedance-2.0", "provider::video-v1"])("waits for %s admission using the same idempotency key", async model => {
    vi.useFakeTimers();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: false, error: "当前视频任务并发已达上限，请等待进行中的任务完成后重试" }), { status: 429 }))
      .mockResolvedValueOnce(apiResponse({ id: "job-admitted", job_id: "job-admitted" }));
    const onWaiting = vi.fn();
    const result = createVideoGenerationTask({ ...config, model }, "镜头", undefined, { onWaiting });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await result).toMatchObject({ id: "job-admitted" });
    const keys = vi.mocked(fetch).mock.calls.map(([, init]) => new Headers(init?.headers).get("Idempotency-Key"));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect(onWaiting).toHaveBeenCalledWith(true);
    expect(onWaiting).toHaveBeenLastCalledWith(false);
  });
  it.each(["provider::doubao-seedance-2-5-pro", config.model, "sdvideo/seedance-2.0"])(
    "persists canvas source and workspace when submitting %s", async model => {
      vi.mocked(fetch).mockResolvedValue(apiResponse({ id: "job_accepted" }));
      await createVideoGenerationTask({ ...config, model }, "镜头", undefined,
        { projectId: "canvas", nodeId: "node", scope: "team" });
      const [url, init] = vi.mocked(fetch).mock.calls[0];
      expect(String(url)).toContain("scope=team");
      const body = init?.body instanceof FormData ? Object.fromEntries(init.body.entries()) : JSON.parse(String(init?.body));
      expect(body).toMatchObject({ project_id: "canvas", node_id: "node" });
    });
  beforeEach(() => {
    // Adapter fixtures have a loaded catalog with unknown duration metadata.
    replaceVideoModelDurations({});
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

  afterEach(async () => {
    vi.mocked(fetch).mockReset().mockResolvedValueOnce(apiResponse({}));
    await fetchVideoModelCatalog();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each(["provider::doubao-seedance-2-5-pro", config.model, "sdvideo/seedance-2.0", "sdvideo/vidu-q2"])(
    "same-parameter regeneration creates a new %s task, while retransmission can reuse its key", async model => {
      const jobs = new Map<string, string>();
      vi.mocked(fetch).mockImplementation(async (_url, init) => {
        // Match the server's fallback: without a submission key, identical
        // payloads would return the same old task, including a completed one.
        const fingerprint = init?.body instanceof FormData
          ? JSON.stringify(Array.from(init.body.entries())) : String(init?.body);
        const key = new Headers(init?.headers).get("Idempotency-Key") || fingerprint;
        if (!jobs.has(key)) jobs.set(key, `job_${jobs.size + 1}`);
        return apiResponse({ id: jobs.get(key), job_id: jobs.get(key) });
      });
      const first = await createVideoGenerationTask({ ...config, model }, "同一提示词");
      const second = await createVideoGenerationTask({ ...config, model }, "同一提示词");
      expect(second.id).not.toBe(first.id);
      const firstKey = new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).get("Idempotency-Key");
      const secondKey = new Headers(vi.mocked(fetch).mock.calls[1][1]?.headers).get("Idempotency-Key");
      expect(firstKey).toMatch(/^video-[0-9a-f-]{36}$/);
      expect(secondKey).not.toBe(firstKey);
      const repeated = await createVideoGenerationTask({ ...config, model }, "同一提示词", undefined, { idempotencyKey: secondKey! });
      expect(repeated.id).toBe(second.id);
      expect(jobs.size).toBe(2);
      expect(fetch).toHaveBeenCalledTimes(3);
    },
  );

  it.each([7, 23, 30])("routes configured Ark endpoints with registered references at %i seconds", async seconds => {
    const model = "official::ep-test";
    vi.mocked(fetch)
      .mockResolvedValueOnce(apiResponse({ video_models: [model], video_model_protocols: { [model]: "seedance", "other::ep-test": "openai" } }))
      .mockResolvedValueOnce(apiResponse({ id: "job_official" }));
    await fetchVideoModelCatalog();
    expect(isSeedanceVideoModel(model)).toBe(true);
    expect(isSeedanceVideoModel("other::ep-test")).toBe(false);
    const task = await createVideoGenerationTask({ ...config, model, seconds: String(seconds), size: "16:9" }, "人物转身", {
      images: [{ id: "person", kind: "image", url: "asset://person", name: "角色", mime: "image/png", bytes: 0, width: 0, height: 0 }],
      videos: [], audios: [],
    });
    const [url, options] = vi.mocked(fetch).mock.calls[1];
    expect(new URL(String(url)).pathname).toBe("/api/ai/contents/generations/tasks");
    expect(JSON.parse(String(options?.body))).toMatchObject({
      model, duration: seconds, ratio: "16:9",
      content: expect.arrayContaining([{ type: "image_url", image_url: { url: "asset://person" }, role: "reference_image" }]),
    });
    expect(task).toMatchObject({ provider: "seedance", id: "job_official" });
  });

  it("uses catalog duration choices and sends the selected value unchanged", async () => {
    const model = "provider::seedance-2.0";
    const longModel = "provider::seedance-2.5";
    const discreteModel = "sdvideo/vidu-custom";
    vi.mocked(fetch).mockResolvedValueOnce(apiResponse({
      video_models: [model, longModel, discreteModel],
      video_model_durations: {
        [model]: [-1, ...Array.from({ length: 12 }, (_, i) => i + 4)],
        [longModel]: [-1, ...Array.from({ length: 27 }, (_, i) => i + 4)],
        [discreteModel]: [5, 10, 25],
      },
    }));
    await fetchVideoModelCatalog();
    expect(normalizeVideoGenerationConfig({ ...config, model, seconds: "30" }).seconds).toBe("15");
    expect(normalizeVideoGenerationConfig({ ...config, model: longModel, seconds: "30" }).seconds).toBe("30");
    expect(normalizeVideoGenerationConfig({ ...config, model: discreteModel, seconds: "-1" }).seconds).toBe("5");
    await expect(createVideoGenerationTask({ ...config, model, seconds: "30" }, "镜头")).rejects.toThrow("重新选择时长");
    expect(fetch).toHaveBeenCalledTimes(1);
    for (const [selectedModel, seconds] of [[model, "15"], [model, "-1"], [discreteModel, "25"]]) {
      vi.mocked(fetch).mockResolvedValueOnce(apiResponse({ id: "job_duration" }));
      await createVideoGenerationTask({ ...config, model: selectedModel, seconds }, "镜头");
      const body = vi.mocked(fetch).mock.calls.at(-1)![1]?.body;
      expect(body instanceof FormData ? body.get("seconds") : String(JSON.parse(String(body)).duration)).toBe(seconds);
    }
  });

  it.each(["official::ep-seedance25", "sdvideo/seedance-2.5"])("submits every 2.5 reference through %s without truncation", async model => {
    const opaque = model.includes("::ep-");
    if (opaque) vi.mocked(fetch).mockResolvedValueOnce(apiResponse({
      video_models: [model], video_model_protocols: { [model]: "seedance" }, model_labels: { [model]: "seedance 2.5" },
      video_model_capabilities: { [model]: { references: { images: 30, videos: 10, audios: 10, audio_only: true,
        media_min_duration_ms: 2000, media_max_duration_ms: 30000, media_max_total_duration_ms: 30000 } } },
    }));
    vi.mocked(fetch).mockResolvedValueOnce(apiResponse({ id: "job_full_refs" }));
    const image = { id: "image", kind: "image" as const, name: "image", mime: "image/png", bytes: 0, width: 0, height: 0 };
    const references = {
      images: Array.from({ length: 30 }, (_, i) => ({ ...image, url: `asset://image-${i}` })),
      videos: Array.from({ length: 10 }, (_, i) => ({ ...image, kind: "video" as const, mime: "video/mp4", durationMs: 0, url: `asset://video-${i}` })),
      audios: Array.from({ length: 10 }, (_, i) => ({ ...image, kind: "audio" as const, mime: "audio/mpeg", durationMs: 0, url: `asset://audio-${i}` })),
    };
    // Cold endpoint lookup must populate the protocol and actual service limits.
    await createVideoGenerationTask({ ...config, model }, "参考全部素材", references);
    const call = vi.mocked(fetch).mock.calls[opaque ? 1 : 0];
    const body = JSON.parse(String(call[1]?.body));
    expect(new URL(String(call[0])).pathname).toBe("/api/ai/contents/generations/tasks");
    for (const [kind, count] of [["image", 30], ["video", 10], ["audio", 10]] as const) {
      const items = body.content.filter((item: { type: string }) => item.type === `${kind}_url`);
      expect(items).toHaveLength(count);
      expect(items[count - 1][`${kind}_url`].url).toBe(`asset://${kind}-${count - 1}`);
      expect(items[count - 1].role).toBe(`reference_${kind}`);
    }
    references.images.push(references.images[0]);
    const callsBeforeInvalid = vi.mocked(fetch).mock.calls.length;
    await expect(createVideoGenerationTask({ ...config, model }, "超限", references)).rejects.toThrow("参考图片最多 30 张");
    expect(fetch).toHaveBeenCalledTimes(callsBeforeInvalid);
  });

  it.each(["sdvideo/seedance-2.0", "sdvideo/vidu-q2"])("等待 %s 参考媒体上传超过 30 秒后返回原任务", async (model) => {
    vi.useFakeTimers();
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce((_url, options) => new Promise((resolve, reject) => {
      finish = resolve;
      options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const outcome = createVideoGenerationTask({ ...config, model }, "镜头缓慢推近")
      .then(task => ({ task }), error => ({ error }));

    await vi.advanceTimersByTimeAsync(37_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(false);
    finish(apiResponse({ id: "job_existing", job_id: "job_existing" }));
    await expect(outcome).resolves.toMatchObject({ task: { id: "job_existing", model } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("SD-video 提交等待期间仍可主动取消", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    vi.mocked(fetch).mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const result = createVideoGenerationTask({ ...config, model: "sdvideo/seedance-2.0" }, "取消任务", undefined, { signal: controller.signal });
    const rejection = expect(result).rejects.toMatchObject({ status: 0, message: "请求超时或已取消" });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejection;
    expect(fetch).toHaveBeenCalledTimes(1);
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

  it.each(["480p", "768p"])("submits all nine H3 references with fixed %s settings", async resolution => {
    const model = `zizi::zzdh-minimax-h3-限时优惠-多参考图生-${resolution}`;
    replaceVideoModelDurations({ [model]: Array.from({ length: 15 }, (_, i) => i + 1) });
    const file = new File(["image"], "ref.png", { type: "image/png" });
    const image = { id: "ref", kind: "image" as const, file, name: file.name, mime: file.type, bytes: file.size, width: 1280, height: 720 };
    const refs = { images: Array.from({ length: 9 }, () => ({ ...image })), videos: [], audios: [] };
    vi.mocked(fetch).mockResolvedValueOnce(apiResponse({ job_id: "h3" }));
    await expect(createVideoGenerationTask({ ...config, model, seconds: "30" }, "镜头", refs)).rejects.toThrow("时长不在当前模型支持范围内");
    expect(fetch).not.toHaveBeenCalled();
    const normalized = normalizeVideoGenerationConfig({ ...config, model, seconds: "30", size: "9:16" });
    expect(normalized.seconds).toBe("15");
    await createVideoGenerationTask(normalized, "镜头", refs);
    const body = vi.mocked(fetch).mock.calls[0][1]?.body as FormData;
    expect(body.getAll("input_reference[]")).toHaveLength(9);
    expect(body.get("seconds")).toBe("15");
    expect(body.get("resolution_name")).toBe(resolution);
    expect(body.get("size")).toBe("720x1280");
    expect(h3VideoSettings(model)).toEqual({ resolutions: [resolution], ratios: ["16:9", "9:16"] });
    await expect(createVideoGenerationTask({ ...config, model }, "缺图")).rejects.toThrow("至少 1 张");
    await expect(createVideoGenerationTask({ ...config, model }, "超限", { ...refs, images: [...refs.images, image] })).rejects.toThrow("最多 9 张");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(normalizeVideoGenerationConfig({ ...config, model, seconds: "1", generateAudio: true })).toMatchObject({ seconds: "1", resolution, generateAudio: false });
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

  it.each([408, 429, 503])("polls native videos through their durable job and ignores HTTP %s status failures", async status => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(apiResponse({ id: "job_native", job_id: "job_native" }))
      .mockResolvedValueOnce(apiResponse(null, status))
      .mockResolvedValueOnce(apiResponse({ id: "job_native", type: "video.generate", status: "running", progress: 35 }))
      .mockResolvedValueOnce(apiResponse({ id: "job_native", type: "video.generate", status: "failed", error: { message: "当前模型暂时不可用，请稍后重试" } }));
    const selected = { ...config, model: "removed::wan3.0-video" };
    const task = await createVideoGenerationTask(selected, "test");
    expect(task.model).toBe(selected.model);
    await expect(pollVideoGenerationTask(selected, task)).resolves.toEqual({ status: "pending" });
    await expect(pollVideoGenerationTask(selected, task)).resolves.toEqual({ status: "pending", progress: 35 });
    await expect(pollVideoGenerationTask(selected, task)).resolves.toEqual({ status: "failed", error: "当前模型暂时不可用，请稍后重试" });
    for (const [url] of vi.mocked(fetch).mock.calls.slice(1)) {
      expect(new URL(String(url)).pathname).toBe("/api/jobs/job_native");
    }
  });

  it("does not hide authorization failures or restart an aborted native job", async () => {
    const task = { id: "job_native", provider: "seedance" as const, model: "wan3.0-video" };
    vi.mocked(fetch).mockResolvedValueOnce(apiResponse(null, 403));
    await expect(pollVideoGenerationTask(config, task)).rejects.toMatchObject({ status: 403 });
    const controller = new AbortController();
    controller.abort();
    await expect(pollVideoGenerationTask(config, task, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledTimes(1);
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
        url: expect.stringContaining("/api/assets/asset-video/content?scope=team"),
        mimeType: "video/mp4",
        fileName: "result.mp4",
        assetId: "asset-video",
        scope: "team",
        ephemeral: false,
      },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
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
