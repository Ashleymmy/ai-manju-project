import { describe, expect, it, vi } from "vitest";

import type { Asset } from "@/entities/asset";
import type { CanvasEdgeData, CanvasNodeData } from "@/features/canvas/domain/types";
import { CanvasGenerationJobsController } from "./controller";
import type {
  CanvasGenerationBindings,
  CanvasGenerationServices,
} from "./types";

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
});
