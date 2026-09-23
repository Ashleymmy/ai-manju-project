import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CanvasEdgeData, CanvasNodeData } from "@/features/canvas/domain/types";
import { buildCanvasMentionEditorModel, buildCanvasMentionReferences } from "@/features/canvas/domain/mentions";
import { promptTextFromNode } from "@/features/canvas/domain/nodeUtils";
import { normalizeCanvasNode, serializeCanvasNode } from "@/features/canvas/domain/nodes";
import { cloneCanvasNodeFromGenerationRevision, collectCanvasGenerationHistory, collectCanvasPreviewAssetRefs } from "@/features/canvas/domain/generationHistory";
import { CanvasGenerationJobsController } from "./controller";
import { rememberPendingCanvasJob } from "./pendingJobStore";
import type {
  CanvasGenerationBindings,
  CanvasGenerationServices,
} from "./types";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function imageNode(overrides: Partial<CanvasNodeData> = {}): CanvasNodeData {
  return {
    id: "image-1",
    kind: "image",
    title: "空图片节点",
    content: "一只橘猫",
    x: 10,
    y: 20,
    width: 320,
    height: 238,
    metadata: {
      content: "一只橘猫",
      prompt: "一只橘猫",
      generationMode: "image",
      status: "idle",
      count: 1,
    },
    ...overrides,
  };
}

function videoNode(overrides: Partial<CanvasNodeData> = {}): CanvasNodeData {
  return {
    id: "video-1",
    kind: "video",
    title: "空视频节点",
    content: "镜头缓慢推近",
    x: 10,
    y: 20,
    width: 420,
    height: 260,
    metadata: {
      content: "镜头缓慢推近",
      prompt: "镜头缓慢推近",
      generationMode: "video",
      status: "idle",
    },
    ...overrides,
  };
}

function audioNode(overrides: Partial<CanvasNodeData> = {}): CanvasNodeData {
  return {
    id: "audio-1",
    kind: "audio",
    title: "空音频节点",
    content: "平静的环境音",
    x: 10,
    y: 20,
    width: 320,
    height: 120,
    metadata: {
      content: "平静的环境音",
      prompt: "平静的环境音",
      generationMode: "audio",
      status: "idle",
    },
    ...overrides,
  };
}

function storedVideoNode(appliedFromHistory = false): CanvasNodeData {
  return videoNode({
    title: "Original video",
    metadata: {
      prompt: "Original prompt", content: "Original prompt", generationMode: "video",
      status: "success", assetId: "video-old", assetScope: "team", mimeType: "video/mp4",
      generatedAt: "2026-09-10T08:00:00.000Z", seconds: "5", appliedFromHistory,
    },
  });
}

function videoHistoryServices() {
  let resultIndex = 0;
  return createServices({
    cancelJob: vi.fn(async id => ({ id, type: "video.generate", status: "canceled" as const, state: "canceled" as const })),
    createVideoGenerationTask: vi.fn(async () => ({ id: `job-${++resultIndex}`, provider: "openai" as const, model: "video-model" })),
    pollVideoGenerationTask: vi.fn(async () => ({
      status: "completed" as const,
      result: { url: "", assetId: `video-${resultIndex}`, fileName: `Video ${resultIndex}`, mimeType: "video/mp4" },
    })),
    getAssetContentObjectUrl: vi.fn(async () => "blob:video"),
    fetchBlob: vi.fn(async () => new Blob(["video"], { type: "video/mp4" })),
    readVideoMetadata: vi.fn(async () => ({ width: 1920, height: 1080, durationMs: 5000 })),
  });
}

function createServices(overrides: Partial<CanvasGenerationServices> = {}) {
  let sequence = 0;
  return {
    getAsset: vi.fn(),
    getAssetContentObjectUrl: vi.fn(),
    uploadAsset: vi.fn(),
    cancelJob: vi.fn(),
    getJobs: vi.fn(async () => ({ items: [], total: 0 })),
    generateImages: vi.fn(),
    generatedImagesFromJob: vi.fn(),
    waitForImageJob: vi.fn(),
    requestAiText: vi.fn(),
    requestAudioGeneration: vi.fn(),
    createVideoGenerationTask: vi.fn(),
    pollVideoGenerationTask: vi.fn(),
    videoGenerationResultToBlob: vi.fn(),
    createId: () => `generated-${++sequence}`,
    createAbortController: () => new AbortController(),
    createFile: (parts: BlobPart[], name: string, options?: FilePropertyBag) => new File(parts, name, options),
    fetchBlob: vi.fn(),
    readFileDataUrl: vi.fn(),
    readImageMetadata: vi.fn(),
    readVideoMetadata: vi.fn(),
    readAudioMetadata: vi.fn(),
    revokeObjectURL: vi.fn(),
    waitForPoll: vi.fn(),
    ...overrides,
  } as unknown as CanvasGenerationServices;
}

function createHarness(
  initialNodes: CanvasNodeData[],
  services: CanvasGenerationServices,
  defaultImageModel = "image-model",
) {
  let nodes = initialNodes;
  let edges: CanvasEdgeData[] = [];
  let selectedIds = new Set<string>(initialNodes.slice(0, 1).map(node => node.id));
  let selectedId = initialNodes[0]?.id || "";
  let runningIds = new Set<string>();
  let progress: Record<string, number> = {};
  let promptOptimizing = false;
  const persistSnapshot = vi.fn<CanvasGenerationBindings["persistSnapshot"]>(async () => true);
  const onError = vi.fn();
  const onSuccess = vi.fn();
  const onWarning = vi.fn();
  const controller = new CanvasGenerationJobsController(services);
  const bindings: CanvasGenerationBindings = {
    getProjectId: () => "project-1",
    getProjectTitle: () => "测试画布",
    getProjectKey: () => "personal:project-1",
    getScope: () => "personal",
    isSwitching: () => false,
    isLoading: () => false,
    getNodes: () => nodes,
    setNodes: value => { nodes = value; },
    getEdges: () => edges,
    setEdges: value => { edges = value; },
    getSelectedNodeId: () => selectedId,
    getSelectedNodeIds: () => new Set(selectedIds),
    getCanvasAssets: () => [],
    mergeCanvasAssets: vi.fn(),
    getImageModel: () => defaultImageModel,
    getTextModel: () => "text-model",
    getVideoModel: () => "video-model",
    getAudioModel: () => "audio-model",
    isPromptOptimizing: () => promptOptimizing,
    setPromptOptimizing: value => { promptOptimizing = value; },
    getViewportZoom: () => 90,
    setRunningNodeIds: value => { runningIds = value; },
    setJobProgressByNode: update => {
      progress = typeof update === "function" ? update(progress) : update;
    },
    applyNodeSelection: (ids, primaryId = "") => {
      selectedIds = new Set(ids);
      selectedId = primaryId || selectedIds.values().next().value || "";
    },
    persistSnapshot,
    executeGeneration: operation => operation(),
    executeAssets: operation => operation(),
    onMessage: vi.fn(),
    onSuccess,
    onWarning,
    onError,
  };
  controller.updateBindings(bindings);
  return {
    controller,
    get nodes() { return nodes; },
    get edges() { return edges; },
    setEdges(next: CanvasEdgeData[]) { edges = next; },
    get runningIds() { return runningIds; },
    get progress() { return progress; },
    get promptOptimizing() { return promptOptimizing; },
    onError,
    onSuccess,
    onWarning,
    persistSnapshot,
  };
}

describe("CanvasGenerationJobsController", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps explicit image choices separate from default nodes and Agent batches", async () => {
    const services = createServices({
      generateImages: vi.fn(async () => ({ images: [{ id: "result", assetId: "result", src: "", name: "result.png" }] })),
    });
    const explicit = imageNode({ id: "chosen", metadata: { prompt: "猫", model: "a::gpt-image-2" } });
    const standard = imageNode({ id: "standard" });
    const config = imageNode({ id: "agent-config", kind: "config", metadata: { prompt: "海", generationMode: "image", count: 4 } });
    const harness = createHarness([explicit, standard, config], services, "b::gpt-image-2.5-flare");

    await harness.controller.generateFromNode(explicit.id);
    await harness.controller.generateFromNode(standard.id);
    await harness.controller.generateFromNode(config.id);

    const models = vi.mocked(services.generateImages).mock.calls.map(([input]) => input.model);
    expect(models).toEqual(["a::gpt-image-2", ...Array(5).fill("b::gpt-image-2.5-flare")]);
    expect(harness.nodes.find(node => node.id === explicit.id)?.metadata?.model).toBe("a::gpt-image-2");
    expect(harness.onError).not.toHaveBeenCalled();
  });

  it("sends resolution and detail for every batch child and retains them on retry", async () => {
    const services = createServices({
      generateImages: vi.fn(async () => ({ images: [{ id: "result", assetId: "result", src: "", name: "result.png" }] })),
    });
    const source = imageNode({ kind: "config", metadata: {
      prompt: "人物发丝清晰", generationMode: "image", count: 2,
      imageResolution: "4K", size: "16:9", quality: "high",
    } });
    const harness = createHarness([source], services);
    await harness.controller.generateFromNode(source.id);
    const targets = harness.nodes.filter(node => node.kind === "image");
    expect(targets).toHaveLength(2);
    for (const target of targets) {
      expect(target.metadata).toMatchObject({ imageResolution: "4K", size: "16:9", quality: "high", requestedImageSize: "3840x2160" });
    }
    await harness.controller.retryImageNode(targets[1]);
    expect(services.generateImages).toHaveBeenCalledTimes(3);
    for (const [input] of vi.mocked(services.generateImages).mock.calls) {
      expect(input).toMatchObject({ size: "3840x2160", quality: "high", count: 1 });
    }
    expect(harness.onError).not.toHaveBeenCalled();
  });

  it("does not submit an empty model or mutate nodes before the catalog is ready", async () => {
    const source = imageNode();
    const services = createServices();
    const harness = createHarness([source], services, "");

    await harness.controller.generateFromNode(source.id);

    expect(services.generateImages).not.toHaveBeenCalled();
    expect(harness.nodes).toEqual([source]);
    expect(harness.persistSnapshot).not.toHaveBeenCalled();
    expect(harness.runningIds.size).toBe(0);
    expect(harness.onWarning).toHaveBeenCalledWith("图片模型尚未就绪，请稍后重试");
  });

  it("freezes the clicked parameters while references load, then uses new choices on the next run", async () => {
    let resolveReference!: (url: string) => void;
    const referenceReady = new Promise<string>(resolve => {
      resolveReference = resolve;
    });
    const services = createServices({
      getAssetContentObjectUrl: vi.fn(() => referenceReady),
      fetchBlob: vi.fn(async () => new Blob(["image"], { type: "image/png" })),
      generateImages: vi.fn(async () => ({
        images: [{ id: "result", assetId: "result", src: "" }],
      })),
    });
    const source = imageNode({
      metadata: {
        prompt: "苹果 @[node:reference]",
        composerContent: "苹果 @[node:reference]",
        size: "1:1",
        imageResolution: "1K",
        quality: "low",
      },
    });
    const reference = imageNode({
      id: "reference",
      metadata: { assetId: "reference-asset" },
    });
    const harness = createHarness([source, reference], services);
    const pending = harness.controller.generateFromNode(source.id);
    await vi.waitFor(() =>
      expect(services.getAssetContentObjectUrl).toHaveBeenCalled()
    );
    harness.nodes[0] = {
      ...source,
      metadata: {
        ...source.metadata,
        size: "16:9",
        imageResolution: "4K",
        quality: "high",
      },
    };
    resolveReference("blob:reference");
    await pending;
    expect(vi.mocked(services.generateImages).mock.calls[0][0]).toMatchObject({
      size: "1024x1024",
      quality: "low",
    });
    expect(harness.nodes[0].metadata).toMatchObject({
      size: "16:9", imageResolution: "4K", quality: "high", requestedImageSize: "1024x1024",
    });
    await harness.controller.generateFromNode(source.id);
    expect(vi.mocked(services.generateImages).mock.calls[1][0]).toMatchObject({
      size: "3840x2160",
      quality: "high",
    });
  });

  it("marks a generation intent immediately and ignores duplicate clicks", async () => {
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const services = createServices({
      generateImages: vi.fn(async () => {
        await waiting;
        return { images: [{ id: "result", assetId: "result", src: "", name: "result.png" }] };
      }),
    });
    const harness = createHarness([imageNode()], services);
    const running = harness.controller.generateFromNode("image-1");

    expect(harness.runningIds).toContain("image-1");
    await vi.waitFor(() => expect(services.generateImages).toHaveBeenCalledTimes(1));
    await harness.controller.generateFromNode("image-1");
    expect(services.generateImages).toHaveBeenCalledTimes(1);

    release();
    await running;
    expect(harness.runningIds).toEqual(new Set());
  });

  it.each([
    { source: "node", kind: "image", count: 1 },
    { source: "asset", kind: "image", count: 1 },
    { source: "node", kind: "image", count: 4 },
    { source: "asset", kind: "config", count: 4 },
  ] as const)("$source 引用在 $kind 节点生成 $count 张图片时持续显示缩略图", async ({ source, kind, count }) => {
    const token = `@[${source}:reference]`;
    const composer = `参考 ${token} 画一片海`;
    const assets = [{ id: "reference", name: "素材图片", type: "image" as const, scope: "personal" as const }];
    let sequence = 0;
    let release!: () => void;
    const completion = new Promise<void>(resolve => { release = resolve; });
    const generateImages = vi.fn(async () => {
      const id = `result-${++sequence}`;
      await completion;
      return { images: [{ id, assetId: id, src: "", name: "result.png", contentType: "image/png" }] };
    });
    const services = createServices({
      generateImages: generateImages as CanvasGenerationServices["generateImages"],
      getAsset: vi.fn(async () => assets[0]),
      getAssetContentObjectUrl: vi.fn(async () => "blob:reference"),
      fetchBlob: vi.fn(async () => new Blob(["reference"], { type: "image/png" })),
    });
    const harness = createHarness([
      imageNode({ kind, content: composer, metadata: { prompt: composer, count, generationMode: "image" } }),
      imageNode({ id: "reference", title: "参考图", imageAssetId: "reference" }),
    ], services);
    const assertMentions = (nodes: CanvasNodeData[]) => {
      const targets = nodes.filter(node => node.kind === "image" && node.id !== "reference");
      expect(targets).toHaveLength(count);
      for (const target of targets) {
        expect(promptTextFromNode(target)).toBe(composer);
        const references = buildCanvasMentionReferences(target.id, nodes, harness.edges, assets, "personal");
        const editor = buildCanvasMentionEditorModel(promptTextFromNode(target), references);
        expect(editor.segments).toEqual([expect.objectContaining({ token, key: `${source}:reference` })]);
        expect(editor.displayValue).not.toContain(source === "node" ? "图片1" : "素材图片");
        expect(references.find(reference => reference.key === `${source}:reference`)).toMatchObject({ kind: "image", assetId: "reference" });
      }
    };
    const running = harness.controller.generateImageFromNode("image-1");
    await vi.waitFor(() => expect(generateImages).toHaveBeenCalledTimes(count));
    assertMentions(harness.nodes);
    expect(harness.nodes.filter(node => node.metadata?.status === "loading")).toHaveLength(count);
    release();
    await running;
    assertMentions(harness.nodes);
    expect(harness.nodes.filter(node => node.metadata?.status === "success")).toHaveLength(count);
    expect(harness.onError).not.toHaveBeenCalled();
    for (const [input] of vi.mocked(services.generateImages).mock.calls) {
      expect(input.prompt).toContain(source === "node" ? "图片1" : "素材图片");
      expect(input.prompt).not.toContain("@[");
      expect(input.referenceFiles).toHaveLength(1);
    }
    const restored = JSON.parse(JSON.stringify(harness.nodes.map(serializeCanvasNode)))
      .map(normalizeCanvasNode) as CanvasNodeData[];
    assertMentions(restored);
    if (count === 1) {
      await harness.controller.generateImageFromNode("image-1");
      expect(services.getAssetContentObjectUrl).toHaveBeenCalledTimes(2);
      assertMentions(harness.nodes);
    }
  });

  it("图片失败和重试保留引用缩略图，同时继续向模型发送解析后的提示词与参考图", async () => {
    const composer = "@[node:reference] 换成夜景";
    const generateImages = vi.fn()
      .mockRejectedValueOnce(new Error("暂时不可用"))
      .mockResolvedValueOnce({ images: [{ id: "result", assetId: "result", src: "", name: "night.png" }] });
    const services = createServices({
      generateImages,
      getAssetContentObjectUrl: vi.fn(async () => "blob:reference"),
      fetchBlob: vi.fn(async () => new Blob(["reference"], { type: "image/png" })),
    });
    const harness = createHarness([
      imageNode({ content: composer, metadata: { prompt: composer } }),
      imageNode({ id: "reference", imageAssetId: "reference" }),
    ], services);
    await harness.controller.generateImageFromNode("image-1");
    expect(harness.nodes[0].metadata?.status).toBe("error");
    expect(promptTextFromNode(harness.nodes[0])).toBe(composer);
    await harness.controller.retryImageNode(harness.nodes[0]);
    expect(harness.nodes[0].metadata?.status).toBe("success");
    expect(promptTextFromNode(harness.nodes[0])).toBe(composer);
    expect(generateImages.mock.calls[1][0]).toMatchObject({ prompt: "图片1 换成夜景", referenceFiles: [expect.any(File)] });
  });

  it("批次子图先完成时仍能取消和重试主图，已完成的结果不会被覆盖", async () => {
    const completions: Array<() => void> = [];
    const generateImages = vi.fn((
      input: Parameters<CanvasGenerationServices["generateImages"]>[0],
      callbacks?: Parameters<CanvasGenerationServices["generateImages"]>[1],
    ) => new Promise<{ images: Array<{ id: string; assetId: string; src: string }> }>((resolve, reject) => {
      const id = `asset-${input.sourceNodeId}`;
      callbacks?.onAccepted?.({ id: `job-${input.sourceNodeId}`, status: "queued" });
      completions.push(() => resolve({ images: [{ id, assetId: id, src: "" }] }));
      callbacks?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const services = createServices({
      generateImages: generateImages as CanvasGenerationServices["generateImages"],
      cancelJob: vi.fn(async () => ({ id: "canceled", type: "image.generate", status: "canceled", state: "canceled" })) as CanvasGenerationServices["cancelJob"],
    });
    const harness = createHarness([imageNode({ metadata: { prompt: "四幅海景", count: 4 } })], services);
    const running = harness.controller.generateImageFromNode("image-1");
    await vi.waitFor(() => expect(completions).toHaveLength(4));
    completions[1]();
    await vi.waitFor(() => expect(harness.nodes[1].metadata?.status).toBe("success"));
    const completedAssetId = harness.nodes[1].imageAssetId;
    expect(harness.nodes[0].metadata).toMatchObject({ status: "loading", jobId: "job-image-1" });
    harness.controller.stopGenerationByNodeId("image-1");
    await running;
    expect(harness.nodes.filter(node => node.metadata?.status === "error")).toHaveLength(3);
    expect(harness.nodes[0].imageAssetId).toBeUndefined();
    expect(services.cancelJob).toHaveBeenCalledWith("job-image-1", "personal");

    generateImages.mockImplementation(async input => {
      const id = `retry-${input.sourceNodeId}`;
      return { images: [{ id, assetId: id, src: "" }] };
    });
    await harness.controller.retryImageNode(harness.nodes[0]);
    expect(generateImages).toHaveBeenCalledTimes(7);
    expect(harness.nodes.every(node => node.metadata?.status === "success")).toBe(true);
    expect(harness.nodes[1].imageAssetId).toBe(completedAssetId);
    expect(new Set(harness.nodes.map(node => node.imageAssetId)).size).toBe(4);
    expect(harness.nodes[0].metadata?.batchStatus).toBe("success");
  });

  it("空图片节点无需参考图即可在原节点完成生成", async () => {
    const generateImages = vi.fn(async (
      input: Parameters<CanvasGenerationServices["generateImages"]>[0],
      callbacks?: Parameters<CanvasGenerationServices["generateImages"]>[1],
    ) => {
      callbacks?.onAccepted?.({ id: "job-1", status: "queued" });
      callbacks?.onProgress?.({
        id: "job-1",
        type: "image.generate",
        status: "running",
        state: "running",
        progress: 45,
      });
      return {
        images: [{
          id: "asset-1",
          assetId: "asset-1",
          src: "",
          name: "cat.png",
          contentType: "image/png",
        }],
      };
    });
    const services = createServices({ generateImages: generateImages as CanvasGenerationServices["generateImages"] });
    const harness = createHarness([imageNode()], services);

    await harness.controller.generateImageFromNode("image-1");

    expect(generateImages).toHaveBeenCalledTimes(1);
    expect(generateImages.mock.calls[0]?.[0]).toMatchObject({
      model: "image-model",
      prompt: "一只橘猫",
      count: 1,
      referenceFiles: [],
      scope: "personal",
      sourceType: "canvas",
      sourceProjectId: "project-1",
      sourceNodeId: "image-1",
    });
    expect(harness.nodes).toHaveLength(1);
    expect(harness.nodes[0]).toMatchObject({
      id: "image-1",
      kind: "image",
      title: "cat",
      imageAssetId: "asset-1",
      metadata: { assetId: "asset-1", status: "success" },
    });
    expect(harness.runningIds.size).toBe(0);
    expect(harness.progress).toEqual({});
    expect(harness.onError).not.toHaveBeenCalled();
  });

  it("已有图片的节点再次生成会覆盖原节点并保留历史版本", async () => {
    const generateImages = vi.fn(async () => ({
      images: [{
        id: "asset-2",
        assetId: "asset-2",
        src: "",
        name: "tree.png",
        contentType: "image/png",
      }],
    }));
    const services = createServices({ generateImages: generateImages as CanvasGenerationServices["generateImages"] });
    const harness = createHarness([imageNode({
      title: "圣诞节",
      content: "圣诞树",
      imageAssetId: "asset-1",
      metadata: {
        content: "圣诞树",
        prompt: "圣诞树",
        generationMode: "image",
        status: "success",
        assetId: "asset-1",
        generatedAt: "2026-09-10T08:00:00.000Z",
        count: 1,
      },
    })], services);

    await harness.controller.generateImageFromNode("image-1");

    expect(generateImages).toHaveBeenCalledTimes(1);
    expect(harness.nodes).toHaveLength(1);
    expect(harness.nodes[0]).toMatchObject({
      id: "image-1",
      imageAssetId: "asset-2",
      metadata: { assetId: "asset-2", status: "success" },
    });
    expect(harness.nodes[0]?.metadata?.generationRevisions).toEqual([
      expect.objectContaining({ assetId: "asset-1", prompt: "圣诞树" }),
    ]);
  });

  it("用户导入的图片节点生成时创建新节点并保留原素材", async () => {
    const generateImages = vi.fn(async () => ({
      images: [{ id: "asset-generated", assetId: "asset-generated", src: "", name: "result.png", contentType: "image/png" }],
    }));
    const services = createServices({ generateImages: generateImages as CanvasGenerationServices["generateImages"] });
    const harness = createHarness([imageNode({
      title: "导入图片",
      imageAssetId: "asset-imported",
      metadata: {
        content: "",
        prompt: "生成一张海报",
        generationMode: "image",
        status: "success",
        assetId: "asset-imported",
        canvasOrigin: "imported",
      },
    })], services);

    await harness.controller.generateImageFromNode("image-1");

    expect(generateImages).toHaveBeenCalledTimes(1);
    expect(harness.nodes).toHaveLength(2);
    expect(harness.nodes[0]).toMatchObject({ id: "image-1", imageAssetId: "asset-imported" });
    expect(harness.nodes[1]).toMatchObject({ kind: "image", metadata: { status: "success" } });
    expect(harness.edges).toEqual([expect.objectContaining({ from: "image-1", to: harness.nodes[1]?.id })]);
  });

  it("已有视频的节点修改提示词后重新生成会覆盖原节点，生成期间保留旧视频", async () => {
    let resolveTask: ((task: { id: string; provider: "openai"; model: string }) => void) | undefined;
    const createVideoGenerationTask = vi.fn(() => new Promise<{ id: string; provider: "openai"; model: string }>(resolve => { resolveTask = resolve; }));
    const pollVideoGenerationTask = vi.fn(async () => ({
      status: "completed" as const,
      result: {
        url: "https://cdn.example.com/video-2.mp4",
        assetId: "asset-video-2",
        fileName: "video-2.mp4",
        mimeType: "video/mp4",
      },
    }));
    const services = createServices({
      createVideoGenerationTask: createVideoGenerationTask as CanvasGenerationServices["createVideoGenerationTask"],
      pollVideoGenerationTask: pollVideoGenerationTask as CanvasGenerationServices["pollVideoGenerationTask"],
      // 重新生成时节点会把自身旧视频作为参考素材（视频流既有行为），需要可读回的媒体内容。
      getAssetContentObjectUrl: vi.fn(async () => "blob:asset-video-1"),
      fetchBlob: vi.fn(async () => new Blob(["video"], { type: "video/mp4" })),
      readVideoMetadata: vi.fn(async () => ({ width: 1920, height: 1080, durationMs: 6000 })),
    });
    const harness = createHarness([videoNode({
      title: "旧视频",
      metadata: {
        content: "镜头缓慢推近",
        prompt: "镜头缓慢推近",
        generationMode: "video",
        status: "success",
        assetId: "asset-video-1",
        mimeType: "video/mp4",
        naturalWidth: 1920,
        naturalHeight: 1080,
      },
    })], services);

    const running = harness.controller.generateVideoFromNode("video-1");
    // 任务尚未被供应商受理时，节点已进入 loading，但仍挂着旧视频资产（与图片节点一致）。
    await vi.waitFor(() => expect(harness.nodes[0]?.metadata?.status).toBe("loading"));
    expect(harness.nodes).toHaveLength(1);
    expect(harness.nodes[0]).toMatchObject({
      id: "video-1",
      title: "旧视频",
      metadata: { assetId: "asset-video-1", mimeType: "video/mp4" },
    });
    expect(harness.edges).toEqual([]);

    expect(harness.runningIds.has("video-1")).toBe(true);
    expect(harness.onSuccess).not.toHaveBeenCalled();
    expect(collectCanvasGenerationHistory(harness.nodes).map(item => item.assetId)).toEqual(["asset-video-1"]);
    const pending = normalizeCanvasNode(JSON.parse(JSON.stringify(serializeCanvasNode(harness.nodes[0]!))))!;
    expect(pending.metadata?.generationRevisions).toEqual([expect.objectContaining({ kind: "video", assetId: "asset-video-1" })]);

    resolveTask?.({ id: "job-video-1", provider: "openai", model: "video-model" });
    await running;

    expect(createVideoGenerationTask).toHaveBeenCalledTimes(1);
    expect(harness.nodes).toHaveLength(1);
    expect(harness.nodes[0]).toMatchObject({
      id: "video-1",
      kind: "video",
      metadata: { assetId: "asset-video-2", status: "success" },
    });
    expect(harness.nodes[0].metadata?.naturalWidth).toBeUndefined();
    expect(harness.nodes[0].metadata?.naturalHeight).toBeUndefined();
    expect(harness.nodes[0].metadata?.generationRevisions?.[0]).toMatchObject({ naturalWidth: 1920, naturalHeight: 1080 });
    expect(harness.runningIds.has("video-1")).toBe(false);
    expect(harness.onSuccess).toHaveBeenCalledWith("视频生成完成，节点结果已更新");
    expect(createVideoGenerationTask).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.anything(),
      expect.objectContaining({ projectId: "project-1", nodeId: "video-1", scope: "personal" }));
    expect(harness.onError).not.toHaveBeenCalled();
  });

  it("视频再次生成失败时保留旧视频并显示节点错误和反馈", async () => {
    const services = createServices({
      createVideoGenerationTask: vi.fn(async () => ({ id: "job_new", provider: "seedance", model: "seedance-2.5" })),
      pollVideoGenerationTask: vi.fn(async () => ({ status: "failed", error: "本次视频生成失败" })),
      getAssetContentObjectUrl: vi.fn(async () => "blob:old-video"),
      fetchBlob: vi.fn(async () => new Blob(["video"], { type: "video/mp4" })),
      readVideoMetadata: vi.fn(async () => ({ width: 1280, height: 720, durationMs: 6000 })),
    });
    const harness = createHarness([videoNode({ metadata: {
      assetId: "old-video", status: "success", prompt: "重新生成", generationMode: "video", model: "seedance-2.5",
    } })], services);
    await harness.controller.generateFromNode("video-1");
    expect(harness.nodes).toHaveLength(1);
    expect(harness.nodes[0].metadata).toMatchObject({ assetId: "old-video", status: "error", errorDetails: "本次视频生成失败" });
    expect(harness.onError).toHaveBeenCalledWith("本次视频生成失败");
    expect(harness.onSuccess).not.toHaveBeenCalled();
    expect(harness.runningIds.size).toBe(0);
  });

  it("用户导入的视频节点生成时创建新节点并保留原素材", async () => {
    const createVideoGenerationTask = vi.fn(async () => ({ id: "job-video-1", provider: "openai" as const, model: "video-model" }));
    const pollVideoGenerationTask = vi.fn(async () => ({
      status: "completed" as const,
      result: {
        url: "https://cdn.example.com/video-generated.mp4",
        assetId: "asset-video-generated",
        fileName: "generated.mp4",
        mimeType: "video/mp4",
      },
    }));
    const services = createServices({
      createVideoGenerationTask: createVideoGenerationTask as CanvasGenerationServices["createVideoGenerationTask"],
      pollVideoGenerationTask: pollVideoGenerationTask as CanvasGenerationServices["pollVideoGenerationTask"],
      getAssetContentObjectUrl: vi.fn(async () => "blob:asset-video-imported"),
      fetchBlob: vi.fn(async () => new Blob(["video"], { type: "video/mp4" })),
      readVideoMetadata: vi.fn(async () => ({ width: 1920, height: 1080, durationMs: 6000 })),
    });
    const harness = createHarness([videoNode({
      title: "导入视频",
      metadata: {
        content: "",
        prompt: "让画面动起来",
        generationMode: "video",
        status: "success",
        assetId: "asset-video-imported",
        canvasOrigin: "imported",
      },
    })], services);

    await harness.controller.generateVideoFromNode("video-1");

    expect(createVideoGenerationTask).toHaveBeenCalledTimes(1);
    expect(harness.nodes).toHaveLength(2);
    expect(harness.nodes[0]).toMatchObject({ id: "video-1", metadata: { assetId: "asset-video-imported" } });
    expect(harness.nodes[1]).toMatchObject({ kind: "video", metadata: { assetId: "asset-video-generated", status: "success" } });
    expect(harness.edges).toEqual([expect.objectContaining({ from: "video-1", to: harness.nodes[1]?.id })]);
  });

  it.each(["generate", "retry", "selected"] as const)("retains overwritten videos through %s, persistence and history application", async entry => {
    const services = videoHistoryServices();
    const harness = createHarness([storedVideoNode()], services);
    const run = () => entry === "generate"
      ? harness.controller.generateVideoFromNode("video-1")
      : entry === "retry" ? harness.controller.retryVideoNode(harness.nodes[0]!) : harness.controller.runSelectedGeneration();
    await run();
    await run();

    expect(harness.onError).not.toHaveBeenCalled();
    expect(harness.nodes).toHaveLength(1);
    const current = harness.nodes[0]!;
    expect(current.metadata?.generationRevisions?.map(revision => revision.assetId)).toEqual(["video-1", "video-old"]);
    expect(current.metadata?.generatedAt).not.toBe("2026-09-10T08:00:00.000Z");
    const persisted = harness.persistSnapshot.mock.calls.at(-1)?.[0];
    expect(persisted).toEqual(harness.nodes);
    const restored = normalizeCanvasNode(JSON.parse(JSON.stringify(serializeCanvasNode(current))))!;
    const previews = { "video-old": "blob:old", "video-1": "blob:one", "video-2": "blob:two" };
    const history = collectCanvasGenerationHistory([restored], previews);
    expect(history.map(item => item.assetId).sort()).toEqual(["video-1", "video-2", "video-old"]);
    expect(history.every(item => item.kind === "video" && Boolean(item.previewUrl))).toBe(true);
    expect(collectCanvasPreviewAssetRefs([restored])).toContainEqual({ id: "video-old", kind: "video", scope: "team" });
    const revision = restored.metadata!.generationRevisions!.find(item => item.assetId === "video-old")!;
    const applied = cloneCanvasNodeFromGenerationRevision(restored, revision, { id: "applied", x: 100, y: 100 });
    expect(applied).toMatchObject({ kind: "video", metadata: { assetId: "video-old", assetScope: "team", seconds: "5", appliedFromHistory: true } });
    expect(current.metadata?.assetId).toBe("video-2");
  });

  it("does not submit a standalone video's existing output as a retry reference", async () => {
    const services = videoHistoryServices();
    const createVideoGenerationTask = vi.fn(async () => ({ id: "job-video-retry", provider: "openai" as const, model: "video-model" }));
    services.createVideoGenerationTask = createVideoGenerationTask as CanvasGenerationServices["createVideoGenerationTask"];
    const harness = createHarness([videoNode({
      title: "Original video",
      metadata: {
        prompt: "Original prompt",
        content: "Original prompt",
        generationMode: "video",
        status: "success",
        assetId: "video-old",
        assetScope: "team",
        mimeType: "video/mp4",
        seconds: "5",
        videoReferenceInputs: {
          items: [{ nodeId: "video-1", type: "video", title: "旧输出", source: "node", scope: "team", name: "old.mp4", mime: "video/mp4", bytes: 10 }],
        },
      },
    })], services);

    await harness.controller.retryVideoNode(harness.nodes[0]!);

    expect(createVideoGenerationTask).toHaveBeenCalledTimes(1);
    expect(createVideoGenerationTask.mock.calls[0]?.[2]).toEqual({ images: [], videos: [], audios: [] });
  });

  it.each(["generate", "retry"] as const)("records newly generated videos from a history copy via %s", async entry => {
    const harness = createHarness([storedVideoNode(true)], videoHistoryServices());
    if (entry === "generate") await harness.controller.generateVideoFromNode("video-1");
    else await harness.controller.retryVideoNode(harness.nodes[0]!);
    expect(harness.nodes[0]?.metadata?.appliedFromHistory).toBeUndefined();
    expect(collectCanvasGenerationHistory(harness.nodes).map(item => item.assetId).sort()).toEqual(["video-1", "video-old"]);
  });

  it("keeps the previous video in history after a failed overwrite and a retry without duplicates", async () => {
    const services = videoHistoryServices();
    vi.mocked(services.pollVideoGenerationTask).mockResolvedValueOnce({ status: "failed", error: "provider unavailable" });
    const harness = createHarness([storedVideoNode()], services);
    await harness.controller.generateVideoFromNode("video-1");
    expect(harness.nodes[0]?.metadata?.status).toBe("error");
    expect(collectCanvasGenerationHistory(harness.nodes).map(item => item.assetId)).toEqual(["video-old"]);
    await harness.controller.retryVideoNode(harness.nodes[0]!);
    expect(harness.nodes[0]?.metadata?.generationRevisions).toHaveLength(1);
    expect(collectCanvasGenerationHistory(harness.nodes).map(item => item.assetId).sort()).toEqual(["video-2", "video-old"]);
  });

  it("does not archive prompts as video results when generating or retrying an empty node", async () => {
    const services = videoHistoryServices();
    vi.mocked(services.pollVideoGenerationTask).mockResolvedValueOnce({ status: "failed", error: "provider unavailable" });
    const harness = createHarness([videoNode()], services);
    await harness.controller.generateVideoFromNode("video-1");
    expect(collectCanvasGenerationHistory(harness.nodes)).toEqual([]);
    await harness.controller.retryVideoNode(harness.nodes[0]!);
    expect(harness.nodes[0]?.metadata?.generationRevisions || []).toEqual([]);
    expect(collectCanvasGenerationHistory(harness.nodes).map(item => item.assetId)).toEqual(["video-2"]);
  });

  it("retains video history when an overwrite is stopped and when its saved job resumes", async () => {
    const services = videoHistoryServices();
    vi.mocked(services.pollVideoGenerationTask).mockImplementationOnce((_config, _task, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const harness = createHarness([storedVideoNode()], services);
    const running = harness.controller.generateVideoFromNode("video-1");
    await vi.waitFor(() => expect(services.pollVideoGenerationTask).toHaveBeenCalledTimes(1));
    const saved = normalizeCanvasNode(JSON.parse(JSON.stringify(serializeCanvasNode(harness.nodes[0]!))))!;
    harness.controller.stopGenerationByNodeId("video-1");
    await running;
    expect(collectCanvasGenerationHistory(harness.nodes).map(item => item.assetId)).toEqual(["video-old"]);
    const restored = createHarness([saved], services);
    restored.controller.recoverPendingJobs();
    await vi.waitFor(() => expect(restored.nodes[0]?.metadata?.status).toBe("success"));
    expect(services.createVideoGenerationTask).toHaveBeenCalledTimes(1);
    expect(collectCanvasGenerationHistory(restored.nodes).map(item => item.assetId).sort()).toEqual(["video-1", "video-old"]);
  });

  it("已有音频的节点再次生成会覆盖原节点", async () => {
    const requestAudioGeneration = vi.fn(async () => new Blob(["audio"], { type: "audio/mpeg" }));
    const uploadAsset = vi.fn(async () => ({
      id: "asset-audio-2",
      type: "audio",
      name: "audio-2.mp3",
      content_type: "audio/mpeg",
      size: 6,
    }));
    const services = createServices({
      requestAudioGeneration: requestAudioGeneration as CanvasGenerationServices["requestAudioGeneration"],
      uploadAsset: uploadAsset as CanvasGenerationServices["uploadAsset"],
    });
    const harness = createHarness([audioNode({
      title: "旧音频",
      metadata: {
        content: "平静的环境音",
        prompt: "平静的环境音",
        generationMode: "audio",
        status: "success",
        assetId: "asset-audio-1",
      },
    })], services);

    await harness.controller.generateAudioFromNode("audio-1");

    expect(requestAudioGeneration).toHaveBeenCalledTimes(1);
    expect(harness.nodes).toHaveLength(1);
    expect(harness.nodes[0]).toMatchObject({
      id: "audio-1",
      kind: "audio",
      metadata: { assetId: "asset-audio-2", status: "success" },
    });
    expect(harness.onError).not.toHaveBeenCalled();
  });

  it("删除关联节点会按 request identity 中止请求并取消已入队 Job", async () => {
    let requestSignal: AbortSignal | undefined;
    const generateImages = vi.fn((
      _input: Parameters<CanvasGenerationServices["generateImages"]>[0],
      callbacks?: Parameters<CanvasGenerationServices["generateImages"]>[1],
    ) => {
      requestSignal = callbacks?.signal;
      callbacks?.onAccepted?.({ id: "job-cancel", status: "queued" });
      return new Promise<never>((_resolve, reject) => {
        callbacks?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      });
    });
    const cancelJob = vi.fn(async () => ({ id: "job-cancel", type: "image.generate", status: "canceled", state: "canceled" }));
    const services = createServices({
      generateImages: generateImages as CanvasGenerationServices["generateImages"],
      cancelJob: cancelJob as CanvasGenerationServices["cancelJob"],
    });
    const target = imageNode({
      id: "target-1",
      title: "生成中…",
      metadata: { generationMode: "image", status: "loading" },
    });
    const harness = createHarness([target], services);

    const running = harness.controller.runImageTarget({
      targetNodeId: "target-1",
      originNodeId: "source-1",
      runningNodeId: "target-1",
      projectKey: "personal:project-1",
      scope: "personal",
      prompt: "测试",
      model: "image-model",
      size: "auto",
      quality: "auto",
      referenceFiles: [],
    });
    await vi.waitFor(() => expect(requestSignal).toBeDefined());
    const canceled = harness.controller.cancelForRemovedNodes(new Set(["source-1"]));

    expect(canceled).toEqual(new Set(["target-1"]));
    expect(requestSignal?.aborted).toBe(true);
    await expect(running).resolves.toBe(false);
    await vi.waitFor(() => expect(cancelJob).toHaveBeenCalledWith("job-cancel", "personal"));
    expect(harness.runningIds.size).toBe(0);
  });

  it("取消原生视频会取消后台 Job，停止供应商重试", async () => {
    let signal: AbortSignal | undefined;
    const services = createServices({
      cancelJob: vi.fn(async () => ({ id: "job_native", type: "video.generate", status: "canceled", state: "canceled" })),
      createVideoGenerationTask: vi.fn(async () => ({ id: "job_native", provider: "seedance" as const, model: "wan3.0-video" })),
      pollVideoGenerationTask: vi.fn((_config, _task, options) => {
        signal = options?.signal;
        return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
      }),
    });
    const harness = createHarness([imageNode()], services);
    const running = harness.controller.runVideoTarget({
      targetNodeId: "image-1", originNodeId: "image-1", runningNodeId: "image-1",
      projectKey: "personal:project-1", scope: "personal", prompt: "test",
      config: { model: "wan3.0-video", size: "16:9", resolution: "720p", seconds: "5", generateAudio: true, watermark: false },
      references: { images: [], videos: [], audios: [] },
    });
    await vi.waitFor(() => expect(signal).toBeDefined());
    harness.controller.stopGenerationByNodeId("image-1");
    await expect(running).resolves.toBe(false);
    expect(signal?.aborted).toBe(true);
    await vi.waitFor(() => expect(services.cancelJob).toHaveBeenCalledWith("job_native", "personal"));
  });

  it("只恢复一次刷新前已入队的图片 Job", async () => {
    const waitForImageJob = vi.fn(async () => ({
      id: "job-recover",
      type: "image.generate",
      status: "succeeded",
      state: "succeeded",
      progress: 100,
    }));
    const generatedImagesFromJob = vi.fn(async () => [{
      id: "asset-recover",
      assetId: "asset-recover",
      src: "",
      name: "recovered.png",
      contentType: "image/png",
    }]);
    const services = createServices({
      waitForImageJob: waitForImageJob as CanvasGenerationServices["waitForImageJob"],
      generatedImagesFromJob: generatedImagesFromJob as CanvasGenerationServices["generatedImagesFromJob"],
    });
    const harness = createHarness([imageNode({
      metadata: {
        prompt: "恢复图片",
        composerContent: "@[node:reference] 恢复图片",
        generationMode: "image",
        model: "image-model",
        status: "loading",
        jobId: "job-recover",
      },
    })], services);

    harness.controller.recoverPendingJobs();
    harness.controller.recoverPendingJobs();

    await vi.waitFor(() => expect(harness.nodes[0]?.metadata?.status).toBe("success"));
    expect(waitForImageJob).toHaveBeenCalledTimes(1);
    expect(generatedImagesFromJob).toHaveBeenCalledTimes(1);
    expect(harness.nodes[0]?.imageAssetId).toBe("asset-recover");
    expect(promptTextFromNode(harness.nodes[0])).toBe("@[node:reference] 恢复图片");
  });

  it("提示词优化通过生成服务更新 composer 且正确释放 busy 状态", async () => {
    const requestAiText = vi.fn(async () => ({ content: "优化后的提示词", model: "text-model" }));
    const services = createServices({ requestAiText: requestAiText as CanvasGenerationServices["requestAiText"] });
    const source = imageNode();
    const harness = createHarness([source], services);

    await harness.controller.optimizeNodePrompt(source, "保持主体");

    expect(requestAiText).toHaveBeenCalledWith({
      model: "text-model",
      prompt: "保持主体\n\n待优化的提示词：\n一只橘猫",
    });
    expect(harness.nodes[0]?.metadata?.composerContent).toBe("优化后的提示词");
    expect(harness.promptOptimizing).toBe(false);
    expect(harness.onSuccess).toHaveBeenCalledWith("提示词已优化");
  });

  it("批量生图时每张图使用不同提示词和种子", async () => {
    let sequence = 0;
    const generateImages = vi.fn(async (
      _input: Parameters<CanvasGenerationServices["generateImages"]>[0],
    ) => {
      sequence += 1;
      return {
        images: [{
          id: `asset-${sequence}`,
          assetId: `asset-${sequence}`,
          src: "",
          name: `img-${sequence}.png`,
          contentType: "image/png",
        }],
      };
    });
    const services = createServices({ generateImages: generateImages as CanvasGenerationServices["generateImages"] });
    const harness = createHarness([
      imageNode({
        content: "四个不一样的苹果",
        metadata: {
          content: "四个不一样的苹果",
          prompt: "四个不一样的苹果",
          generationMode: "image",
          status: "idle",
          count: 4,
        },
      }),
    ], services);

    await harness.controller.generateImageFromNode("image-1");

    expect(generateImages).toHaveBeenCalledTimes(4);
    const payloads = generateImages.mock.calls.map(call => call[0]);
    const prompts = payloads.map(item => item.prompt);
    const seeds = payloads.map(item => item.seed);
    expect(new Set(prompts).size).toBe(4);
    expect(new Set(seeds).size).toBe(4);
    expect(prompts.every(item => item.includes("四个不一样的苹果"))).toBe(true);
    expect(prompts.some(item => item === "四个不一样的苹果")).toBe(false);
    expect(harness.nodes).toHaveLength(4);
    expect(harness.nodes.every(node => node.metadata?.prompt === "四个不一样的苹果")).toBe(true);
    const storedAssetIds = harness.nodes.map(node => (
      node.metadata?.isBatchRoot ? node.metadata.ownAssetId : node.imageAssetId
    ));
    expect(new Set(storedAssetIds).size).toBe(4);
  });

  it("生图任务按目标节点登记，刷新后可用本地账本接回", async () => {
    const generateImages = vi.fn(async (
      _input: Parameters<CanvasGenerationServices["generateImages"]>[0],
      callbacks?: Parameters<CanvasGenerationServices["generateImages"]>[1],
    ) => {
      callbacks?.onAccepted?.({ id: "job-target", status: "queued" });
      return {
        images: [{
          id: "asset-target",
          assetId: "asset-target",
          src: "",
          name: "target.png",
          contentType: "image/png",
        }],
      };
    });
    const services = createServices({ generateImages: generateImages as CanvasGenerationServices["generateImages"] });
    const harness = createHarness([imageNode({
      id: "target-1",
      metadata: { generationMode: "image", status: "idle", prompt: "测试" },
    })], services);

    await harness.controller.runImageTarget({
      targetNodeId: "target-1",
      originNodeId: "source-1",
      runningNodeId: "target-1",
      projectKey: "personal:project-1",
      scope: "personal",
      prompt: "测试",
      model: "image-model",
      size: "auto",
      quality: "auto",
      referenceFiles: [],
    });

    expect(generateImages.mock.calls[0]?.[0]).toMatchObject({ sourceNodeId: "target-1" });
    expect(harness.nodes[0]?.metadata?.status).toBe("success");
  });

  it("刷新后即使快照没有 jobId 也能从本地账本接回生图", async () => {
    rememberPendingCanvasJob({
      nodeId: "image-1",
      jobId: "job-ledger",
      kind: "image",
      projectKey: "personal:project-1",
      savedAt: Date.now(),
    });
    const waitForImageJob = vi.fn(async () => ({
      id: "job-ledger",
      type: "image.generate",
      status: "succeeded",
      state: "succeeded",
      progress: 100,
    }));
    const generatedImagesFromJob = vi.fn(async () => [{
      id: "asset-ledger",
      assetId: "asset-ledger",
      src: "",
      name: "ledger.png",
      contentType: "image/png",
    }]);
    const services = createServices({
      waitForImageJob: waitForImageJob as CanvasGenerationServices["waitForImageJob"],
      generatedImagesFromJob: generatedImagesFromJob as CanvasGenerationServices["generatedImagesFromJob"],
    });
    const harness = createHarness([imageNode({
      title: "生成中…",
      metadata: {
        prompt: "恢复图片",
        generationMode: "image",
        model: "image-model",
        status: "loading",
      },
    })], services);

    harness.controller.recoverPendingJobs();

    await vi.waitFor(() => expect(harness.nodes[0]?.metadata?.status).toBe("success"));
    expect(waitForImageJob).toHaveBeenCalledTimes(1);
    expect(harness.nodes[0]?.imageAssetId).toBe("asset-ledger");
    expect(harness.nodes[0]?.metadata?.errorDetails).toBeUndefined();
  });

  it("刷新后快照没有 jobId 时按服务端任务的目标节点接回", async () => {
    const waitForImageJob = vi.fn(async () => ({
      id: "job-listed",
      type: "image.generate",
      status: "succeeded",
      state: "succeeded",
      progress: 100,
    }));
    const generatedImagesFromJob = vi.fn(async () => [{
      id: "asset-listed",
      assetId: "asset-listed",
      src: "",
      name: "listed.png",
      contentType: "image/png",
    }]);
    const getJobs = vi.fn(async () => ({
      items: [{
        id: "job-listed",
        type: "image.generate",
        status: "running",
        state: "running",
        payload: {
          asset_registration: {
            source_project_id: "project-1",
            source_node_id: "image-1",
          },
        },
      }],
      total: 1,
    }));
    const services = createServices({
      getJobs: getJobs as CanvasGenerationServices["getJobs"],
      waitForImageJob: waitForImageJob as CanvasGenerationServices["waitForImageJob"],
      generatedImagesFromJob: generatedImagesFromJob as CanvasGenerationServices["generatedImagesFromJob"],
    });
    const harness = createHarness([imageNode({
      title: "生成中…",
      metadata: {
        prompt: "恢复图片",
        generationMode: "image",
        model: "image-model",
        status: "loading",
      },
    })], services);

    harness.controller.recoverPendingJobs();

    await vi.waitFor(() => expect(harness.nodes[0]?.metadata?.status).toBe("success"));
    expect(getJobs).toHaveBeenCalledTimes(1);
    expect(waitForImageJob).toHaveBeenCalledWith("job-listed", expect.anything());
    expect(harness.nodes[0]?.imageAssetId).toBe("asset-listed");
  });

  it("刷新后找不到进行中的任务才把图片节点标失败", async () => {
    const getJobs = vi.fn(async () => ({ items: [], total: 0 }));
    const services = createServices({
      getJobs: getJobs as CanvasGenerationServices["getJobs"],
    });
    const harness = createHarness([imageNode({
      title: "生成中…",
      metadata: {
        prompt: "风景",
        generationMode: "image",
        status: "loading",
      },
    })], services);

    harness.controller.recoverPendingJobs();

    await vi.waitFor(() => expect(harness.nodes[0]?.metadata?.status).toBe("error"));
    expect(harness.nodes[0]?.metadata?.errorDetails).toContain("未找到进行中的生成任务");
    expect(getJobs).toHaveBeenCalledTimes(1);
  });

  it("当前页正在生图时不会被恢复扫描标成失败", async () => {
    const getJobs = vi.fn(async () => ({ items: [], total: 0 }));
    const generateImages = vi.fn((
      _input: Parameters<CanvasGenerationServices["generateImages"]>[0],
      callbacks?: Parameters<CanvasGenerationServices["generateImages"]>[1],
    ) => {
      return new Promise<never>((_resolve, reject) => {
        callbacks?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      });
    });
    const services = createServices({
      getJobs: getJobs as CanvasGenerationServices["getJobs"],
      generateImages: generateImages as CanvasGenerationServices["generateImages"],
    });
    const harness = createHarness([imageNode({
      title: "生成中…",
      metadata: { generationMode: "image", status: "loading", prompt: "风景" },
    })], services);

    const running = harness.controller.runImageTarget({
      targetNodeId: "image-1",
      originNodeId: "image-1",
      runningNodeId: "image-1",
      projectKey: "personal:project-1",
      scope: "personal",
      prompt: "风景",
      model: "image-model",
      size: "auto",
      quality: "auto",
      referenceFiles: [],
    });
    harness.controller.recoverPendingJobs();
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.nodes[0]?.metadata?.status).toBe("loading");
    expect(getJobs).not.toHaveBeenCalled();
    harness.controller.abortAllGenerationRequests();
    await expect(running).resolves.toBe(false);
  });

  it("生图时连线前置图片不会自动作为参考图", async () => {
    const generateImages = vi.fn(async () => ({
      images: [{
        id: "asset-stall-2",
        assetId: "asset-stall-2",
        src: "",
        name: "stall.png",
        contentType: "image/png",
      }],
    }));
    const getAssetContentObjectUrl = vi.fn(async () => "blob:landscape");
    const services = createServices({
      generateImages: generateImages as CanvasGenerationServices["generateImages"],
      getAssetContentObjectUrl: getAssetContentObjectUrl as CanvasGenerationServices["getAssetContentObjectUrl"],
    });
    const landscape = imageNode({
      id: "landscape",
      title: "风景",
      imageAssetId: "asset-land",
      metadata: {
        prompt: "湖边树",
        generationMode: "image",
        status: "success",
        assetId: "asset-land",
        count: 1,
      },
    });
    const stall = imageNode({
      id: "stall",
      title: "水果摊",
      content: "水果摊",
      imageAssetId: "asset-stall",
      metadata: {
        content: "水果摊",
        prompt: "水果摊",
        generationMode: "image",
        status: "success",
        assetId: "asset-stall",
        count: 1,
      },
    });
    const harness = createHarness([landscape, stall], services);
    harness.setEdges([{ id: "e-land", from: "landscape", to: "stall" }]);

    await harness.controller.generateImageFromNode("stall");

    expect(generateImages).toHaveBeenCalledTimes(1);
    expect(generateImages.mock.calls[0]?.[0]).toMatchObject({
      prompt: "水果摊",
      referenceFiles: [],
      sourceNodeId: "stall",
    });
    expect(getAssetContentObjectUrl).not.toHaveBeenCalled();
    expect(harness.nodes.find(node => node.id === "stall")).toMatchObject({
      id: "stall",
      imageAssetId: "asset-stall-2",
    });
    expect(harness.nodes).toHaveLength(2);
  });

  it("生图提示词 @ 前置节点时才会把它作为参考图", async () => {
    const generateImages = vi.fn(async () => ({
      images: [{
        id: "asset-stall-2",
        assetId: "asset-stall-2",
        src: "",
        name: "stall.png",
        contentType: "image/png",
      }],
    }));
    const getAssetContentObjectUrl = vi.fn(async () => "blob:landscape");
    const fetchBlob = vi.fn(async () => new Blob(["img"], { type: "image/png" }));
    const services = createServices({
      generateImages: generateImages as CanvasGenerationServices["generateImages"],
      getAssetContentObjectUrl: getAssetContentObjectUrl as CanvasGenerationServices["getAssetContentObjectUrl"],
      fetchBlob: fetchBlob as CanvasGenerationServices["fetchBlob"],
    });
    const landscape = imageNode({
      id: "landscape",
      title: "风景",
      imageAssetId: "asset-land",
      metadata: {
        prompt: "湖边树",
        generationMode: "image",
        status: "success",
        assetId: "asset-land",
        count: 1,
      },
    });
    const stall = imageNode({
      id: "stall",
      title: "水果摊",
      content: "根据 @[node:landscape] 生成水果摊",
      imageAssetId: "asset-stall",
      metadata: {
        content: "根据 @[node:landscape] 生成水果摊",
        prompt: "根据 @[node:landscape] 生成水果摊",
        generationMode: "image",
        status: "success",
        assetId: "asset-stall",
        count: 1,
      },
    });
    const harness = createHarness([landscape, stall], services);
    harness.setEdges([{ id: "e-land", from: "landscape", to: "stall" }]);

    await harness.controller.generateImageFromNode("stall");

    expect(getAssetContentObjectUrl).toHaveBeenCalledWith("asset-land", "personal", undefined, expect.any(AbortSignal));
    expect(generateImages).toHaveBeenCalledTimes(1);
    const payload = generateImages.mock.calls[0]?.[0];
    expect(payload?.referenceFiles).toHaveLength(1);
    expect(payload?.prompt).toContain("图片1");
  });
});
