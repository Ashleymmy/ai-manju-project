import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CanvasEdgeData, CanvasNodeData } from "@/features/canvas/domain/types";
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
) {
  let nodes = initialNodes;
  let edges: CanvasEdgeData[] = [];
  let selectedIds = new Set<string>(initialNodes.slice(0, 1).map(node => node.id));
  let selectedId = initialNodes[0]?.id || "";
  let runningIds = new Set<string>();
  let progress: Record<string, number> = {};
  let promptOptimizing = false;
  const persistSnapshot = vi.fn(async () => true);
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
    getImageModel: () => "image-model",
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
