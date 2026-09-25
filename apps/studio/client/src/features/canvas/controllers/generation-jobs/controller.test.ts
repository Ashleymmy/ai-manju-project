import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/api/http";

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
    bindings,
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
  it("persists a text receipt before the supplier and retrieves it after refresh and failed result save", async () => {
    const node = imageNode({ kind: "text", metadata: { generationMode: "text", prompt: "原提示" } });
    let submitted = 0;
    let savedNodes: CanvasNodeData[] = [node];
    const services = createServices({ requestAiText: vi.fn(async (_body, _signal, _waiting, receipt) => {
      if (!receipt?.recoverOnly) {
        expect(savedNodes[0].metadata?.generationReceipt?.key).toBe(receipt?.key);
        submitted += 1;
      }
      return { content: "原始结果", model: "original-model", toolCalls: [{ id: "tool" }], finishReason: "stop" };
    }) });
    const first = createHarness([node], services);
    first.bindings.getUserId = () => "alice";
    first.persistSnapshot.mockImplementation(async nodes => {
      if (nodes[0].metadata?.status === "success") return false;
      savedNodes = structuredClone(nodes);
      return true;
    });
    await first.controller.runTextTarget({ targetNodeId: node.id, originNodeId: node.id, runningNodeId: node.id,
      projectKey: "personal:project-1", scope: "personal", prompt: "原提示", model: "original-model" });
    const key = savedNodes[0].metadata?.generationReceipt?.key;
    expect(key).toBeTruthy();
    expect(first.nodes[0].metadata?.status).toBe("error");
    first.controller.dispose();
    const refreshed = createHarness(savedNodes, services);
    refreshed.bindings.getUserId = () => "alice";
    await refreshed.controller.retryTextNode(refreshed.nodes[0]);
    expect(submitted).toBe(1);
    expect(vi.mocked(services.requestAiText).mock.calls[1][3]).toMatchObject({ key, recoverOnly: true });
    expect(refreshed.nodes[0]).toMatchObject({ content: "原始结果", metadata: { status: "success", textToolCalls: [{ id: "tool" }], textFinishReason: "stop" } });
    expect(refreshed.nodes[0].metadata?.generationReceipt).toBeUndefined();
  });

  it("restores server audio after refresh when the local Blob was lost and reuses the upload identity", async () => {
    const receipt = { key: "original-audio", kind: "audio" as const, userId: "alice", scope: "personal" as const,
      projectId: "project-1", projectKey: "personal:project-1", nodeId: "audio-1", originNodeId: "audio-1",
      prompt: "original", model: "tts", audioConfig: { model: "tts", format: "mp3" } };
    const uploadKey = "canvas-audio:alice:personal:personal%3Aproject-1:audio-1:original-upload";
    const node = audioNode({ metadata: { generationReceipt: receipt,
      pendingAudioUpload: { key: uploadKey, fileName: "voice.mp3", contentType: "audio/mpeg", bytes: 5, createdAt: "2026-09-25" } } });
    const services = createServices({
      loadPendingAudioUpload: vi.fn(async () => null),
      requestAudioGeneration: vi.fn(async (_config, _prompt, options) => {
        expect(options?.receipt).toEqual({ key: "original-audio", scope: "personal", recoverOnly: true });
        return new Blob(["audio"], { type: "audio/mpeg" });
      }),
      uploadAsset: vi.fn(async () => ({ id: "original-asset", name: "voice.mp3", type: "audio" as const })),
    });
    const refreshed = createHarness([node], services);
    refreshed.bindings.getUserId = () => "alice";
    await refreshed.controller.retryAudioNode(node);
    expect(services.uploadAsset).toHaveBeenCalledOnce();
    expect(vi.mocked(services.uploadAsset).mock.calls[0][1]?.idempotency_key).toBe(uploadKey);
    expect(refreshed.nodes[0].metadata).toMatchObject({ assetId: "original-asset", status: "success" });
    expect(refreshed.nodes[0].metadata?.generationReceipt).toBeUndefined();
  });

  it("only clears a receipt after a confirmed failed result and leaves uncertain receipts recoverable", async () => {
    for (const status of ["failed", "uncertain"]) {
      const receipt = { key: "original", kind: "text" as const, userId: "", scope: "personal" as const,
        projectId: "project-1", projectKey: "personal:project-1", nodeId: "image-1", originNodeId: "image-1", prompt: "original", model: "model" };
      const node = imageNode({ kind: "text", metadata: { generationReceipt: receipt } });
      const services = createServices({ requestAiText: vi.fn(async () => {
        throw new ApiError("failure", 502, undefined, { data: { receipt: { status } } });
      }) });
      const harness = createHarness([node], services);
      await harness.controller.retryTextNode(node);
      expect(vi.mocked(services.requestAiText).mock.calls[0][3]?.recoverOnly).toBe(true);
      expect(Boolean(harness.nodes[0].metadata?.generationReceipt)).toBe(status === "uncertain");
      expect(services.requestAiText).toHaveBeenCalledOnce();
    }
  });

  it("does not submit a synchronous generation when its receipt cannot be saved", async () => {
    const services = createServices();
    const node = imageNode({ kind: "text" });
    const harness = createHarness([node], services);
    harness.persistSnapshot.mockResolvedValue(false);
    await harness.controller.runTextTarget({ targetNodeId: node.id, originNodeId: node.id, runningNodeId: node.id,
      projectKey: "personal:project-1", scope: "personal", prompt: "提示", model: "model" });
    expect(services.requestAiText).not.toHaveBeenCalled();
    expect(harness.nodes[0].metadata?.generationReceipt).toBeUndefined();
  });

  it("does not retrieve another user's private receipt from a shared canvas", async () => {
    const services = createServices();
    const node = imageNode({ kind: "text", metadata: { generationReceipt: {
      key: "private", kind: "text", userId: "alice", scope: "personal", projectId: "project-1",
      projectKey: "personal:project-1", nodeId: "image-1", originNodeId: "image-1", prompt: "original", model: "model",
    } } });
    const harness = createHarness([node], services);
    harness.bindings.getUserId = () => "bob";
    await harness.controller.retryTextNode(node);
    expect(services.requestAiText).not.toHaveBeenCalled();
    expect(harness.onError).toHaveBeenCalledWith(expect.stringContaining("其他账号"));
  });

  it("does not deliver private synchronous output after the authenticated user changes", async () => {
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const services = createServices({ requestAiText: vi.fn(async () => {
      await barrier; return { content: "private output", model: "model" };
    }) });
    const node = imageNode({ kind: "text" });
    const harness = createHarness([node], services);
    let user = "alice";
    harness.bindings.getUserId = () => user;
    const pending = harness.controller.runTextTarget({ targetNodeId: node.id, originNodeId: node.id, runningNodeId: node.id,
      projectKey: "personal:project-1", scope: "personal", prompt: "提示", model: "model" });
    await vi.waitFor(() => expect(services.requestAiText).toHaveBeenCalledOnce());
    user = "bob";
    release();
    expect(await pending).toBe(false);
    expect(harness.nodes[0].content).not.toBe("private output");
  });

  it.each([false, true])("rebuilds text retry image references from source and current edges (source removed=%s)", async sourceRemoved => {
    const source = imageNode({ id: "source", kind: "config", content: "源提示词", metadata: { generationMode: "text", prompt: "源提示词" } });
    const target = imageNode({ id: "text-target", kind: "text", content: "上次内容", metadata: { generationMode: "text", status: "error", prompt: "重试使用的原提示词", sourceNodeId: source.id } });
    const reference = imageNode({ id: "ref-image", imageAssetId: "asset-reference", metadata: { status: "success", assetScope: "team" } });
    const services = createServices({
      getAssetContentObjectUrl: vi.fn(async () => "blob:reference"),
      fetchBlob: vi.fn(async () => new Blob(["reference"], { type: "image/png" })),
      readFileDataUrl: vi.fn(async () => "data:image/png;base64,cmVm"),
      requestAiText: vi.fn(async () => ({ content: "含图片的新文本", model: "text-model" })),
    });
    const harness = createHarness(sourceRemoved ? [target, reference] : [source, target, reference], services);
    harness.setEdges([
      { id: "image-source", from: reference.id, to: source.id },
      { id: "image-target", from: reference.id, to: target.id },
      { id: "source-target", from: source.id, to: target.id },
    ]);
    await harness.controller.retryTextNode(target);
    expect(services.getAssetContentObjectUrl).toHaveBeenCalledTimes(1);
    expect(services.getAssetContentObjectUrl).toHaveBeenCalledWith("asset-reference", "team", undefined, expect.any(AbortSignal));
    expect(services.requestAiText).toHaveBeenCalledWith({ model: "text-model", messages: [{ role: "user", content: [
      { type: "input_text", text: "重试使用的原提示词" }, { type: "input_image", image_url: { url: "data:image/png;base64,cmVm" } },
    ] }] }, expect.any(AbortSignal), expect.any(Function), expect.objectContaining({ key: expect.any(String), scope: "personal", recoverOnly: false }));
    expect(harness.nodes.find(item => item.id === target.id)?.content).toBe("含图片的新文本");
  });

  it("does not submit text retry when its source image fails to load", async () => {
    const source = imageNode({ id: "source", kind: "config", content: "描述图片", metadata: { generationMode: "text" } });
    const target = imageNode({ id: "text-target", kind: "text", metadata: { generationMode: "text", status: "error", prompt: "描述图片", sourceNodeId: source.id } });
    const reference = imageNode({ id: "ref", imageAssetId: "asset-reference" });
    const services = createServices({ getAssetContentObjectUrl: vi.fn(async () => { throw new Error("参考图片读取失败"); }) });
    const harness = createHarness([source, target, reference], services);
    harness.setEdges([{ id: "ref-source", from: reference.id, to: source.id }]);
    await harness.controller.retryTextNode(target);
    expect(services.requestAiText).not.toHaveBeenCalled();
    expect(harness.nodes.find(item => item.id === target.id)?.metadata).toMatchObject({ status: "error", errorDetails: "参考图片读取失败" });
  });

  it("does not submit text retry after canceling slow reference preparation", async () => {
    let release!: (url: string) => void;
    const target = imageNode({ id: "text-target", kind: "text", metadata: { generationMode: "text", status: "error", prompt: "描述图片" } });
    const reference = imageNode({ id: "ref", imageAssetId: "asset-reference" });
    const services = createServices({
      getAssetContentObjectUrl: vi.fn(() => new Promise(resolve => { release = resolve; })),
      fetchBlob: vi.fn(async () => new Blob(["image"], { type: "image/png" })),
      readFileDataUrl: vi.fn(async () => "data:image/png;base64,cmVm"),
    });
    const harness = createHarness([target, reference], services);
    harness.setEdges([{ id: "ref-target", from: reference.id, to: target.id }]);
    const running = harness.controller.retryTextNode(target);
    await vi.waitFor(() => expect(release).toBeDefined());
    await harness.controller.retryTextNode(target);
    expect(services.getAssetContentObjectUrl).toHaveBeenCalledTimes(1);
    await harness.controller.stopGenerationByNodeId(target.id);
    release("blob:late-reference");
    await running;
    expect(services.requestAiText).not.toHaveBeenCalled();
    expect(harness.runningIds.size).toBe(0);
  });

  it.each(["success", "generation-failure", "upload-failure"])("keeps the previous audio asset until a replacement is saved (%s)", async outcome => {
    let finish!: () => void;
    const services = createServices({
      requestAudioGeneration: vi.fn(() => new Promise((resolve, reject) => { finish = () => outcome === "generation-failure" ? reject(new Error("generation failed")) : resolve(new Blob(["new audio"], { type: "audio/mpeg" })); })),
      uploadAsset: vi.fn(async () => {
        if (outcome === "upload-failure") throw new Error("upload failed");
        return { id: "new-asset", name: "new.mp3", type: "audio" as const, content_type: "audio/mpeg", size: 99 };
      }),
    });
    const node = audioNode({ imageAssetId: "old-preview", imageSrc: "blob:old", metadata: { status: "error", prompt: "new audio", assetId: "old-asset", assetScope: "team", mimeType: "audio/wav", bytes: 123 } });
    const harness = createHarness([node], services);
    const running = harness.controller.retryAudioNode(node);
    await vi.waitFor(() => expect(finish).toBeDefined());
    expect(harness.nodes[0]).toMatchObject({ imageAssetId: "old-preview", imageSrc: "blob:old", metadata: { status: "loading", assetId: "old-asset", assetScope: "team", mimeType: "audio/wav", bytes: 123 } });
    finish();
    await running;
    expect(services.requestAudioGeneration).toHaveBeenCalledTimes(1);
    expect(harness.nodes[0].metadata).toMatchObject(outcome === "success"
      ? { status: "success", assetId: "new-asset", mimeType: "audio/mpeg", bytes: 99 }
      : { status: "error", assetId: "old-asset", assetScope: "team", mimeType: "audio/wav", bytes: 123 });
  });

  it("retries a failed audio upload from the retained Blob without regenerating", async () => {
    const retained = new Map<string, Awaited<ReturnType<NonNullable<CanvasGenerationServices["loadPendingAudioUpload"]>>>>();
    let failUpload = true;
    const requestAudioGeneration = vi.fn(async () => new Blob(["generated-once"], { type: "audio/mpeg" }));
    const uploadAsset = vi.fn(async () => {
      if (failUpload) {
        failUpload = false;
        throw new Error("temporary upload failure");
      }
      return { id: "audio-recovered", name: "voice.mp3", type: "audio" as const, content_type: "audio/mpeg", size: 14 };
    });
    const services = createServices({
      requestAudioGeneration,
      uploadAsset,
      savePendingAudioUpload: vi.fn(async pending => { retained.set(pending.key, pending); }),
      loadPendingAudioUpload: vi.fn(async key => retained.get(key) || null),
      removePendingAudioUpload: vi.fn(async key => { retained.delete(key); }),
    });
    const node = audioNode({ metadata: { status: "error", prompt: "旁白" } });
    const harness = createHarness([node], services);

    await harness.controller.retryAudioNode(node);
    expect(requestAudioGeneration).toHaveBeenCalledTimes(1);
    expect(uploadAsset).toHaveBeenCalledTimes(1);
    const failed = harness.nodes[0];
    expect(failed.metadata).toMatchObject({ status: "error", pendingAudioUpload: { key: expect.any(String) } });
    expect(retained.size).toBe(1);

    await harness.controller.retryAudioNode(failed);
    expect(requestAudioGeneration).toHaveBeenCalledTimes(1);
    expect(uploadAsset).toHaveBeenCalledTimes(2);
    expect(harness.nodes[0].metadata).toMatchObject({ status: "success", assetId: "audio-recovered" });
    expect(harness.nodes[0].metadata?.pendingAudioUpload).toBeUndefined();
    expect(retained.size).toBe(0);
  });

  it.each(["text", "audio"] as const)("marks orphan %s submission uncertain without reissuing a request", kind => {
    const node = imageNode({ kind, metadata: { status: "loading", prompt: "original", generationMode: kind } });
    const services = createServices();
    const harness = createHarness([node], services);
    harness.controller.recoverPendingJobs();
    expect(harness.nodes[0].metadata?.status).toBe("error");
    expect(harness.nodes[0].metadata?.errorDetails).toContain("勿重复生成");
    expect(services.requestAiText).not.toHaveBeenCalled();
    expect(services.requestAudioGeneration).not.toHaveBeenCalled();
    expect(services.getJobs).not.toHaveBeenCalled();
  });

  it("keeps the uploaded audio receipt when the final canvas save returns false and recovers after refresh", async () => {
    type Pending = NonNullable<Awaited<ReturnType<NonNullable<CanvasGenerationServices["loadPendingAudioUpload"]>>>>;
    const retained = new Map<string, Pending>();
    const asset = { id: "audio-saved-once", name: "voice.mp3", type: "audio" as const, content_type: "audio/mpeg", size: 5 };
    const services = createServices({
      requestAudioGeneration: vi.fn(async () => new Blob(["audio"], { type: "audio/mpeg" })),
      uploadAsset: vi.fn(async () => asset),
      getAsset: vi.fn(async () => asset),
      savePendingAudioUpload: vi.fn(async pending => { retained.set(pending.key, { ...pending }); }),
      loadPendingAudioUpload: vi.fn(async key => retained.get(key) || null),
      removePendingAudioUpload: vi.fn(async key => { retained.delete(key); }),
    });
    const node = audioNode();
    const first = createHarness([node], services);
    let savedNodes = [node];
    first.persistSnapshot.mockImplementation(async nodes => {
      if (nodes[0].metadata?.status === "success") return false;
      savedNodes = structuredClone(nodes);
      return true;
    });
    await first.controller.retryAudioNode(node);
    expect(first.nodes[0].metadata).toMatchObject({ status: "error", pendingAudioUpload: { key: expect.any(String) } });
    expect([...retained.values()][0].assetId).toBe(asset.id);
    expect(services.removePendingAudioUpload).not.toHaveBeenCalled();
    first.controller.dispose();

    const refreshed = createHarness(savedNodes, services);
    await refreshed.controller.retryAudioNode(refreshed.nodes[0]);
    expect(services.requestAudioGeneration).toHaveBeenCalledTimes(1);
    expect(services.uploadAsset).toHaveBeenCalledTimes(1);
    expect(services.getAsset).toHaveBeenCalledWith(asset.id, "personal");
    expect(refreshed.nodes[0].metadata).toMatchObject({ status: "success", assetId: asset.id });
    expect(retained.size).toBe(0);
  });

  it("recovers an orphan audio Blob without a canvas descriptor before Ctrl+Enter can generate again", async () => {
    type Pending = NonNullable<Awaited<ReturnType<NonNullable<CanvasGenerationServices["loadPendingAudioUpload"]>>>>;
    const retained = new Map<string, Pending>();
    const services = createServices({
      requestAudioGeneration: vi.fn(async () => new Blob(["audio"], { type: "audio/mpeg" })),
      uploadAsset: vi.fn().mockRejectedValueOnce(new Error("upload unavailable")).mockResolvedValue({ id: "orphan-audio", name: "voice.mp3", type: "audio", content_type: "audio/mpeg", size: 5 }),
      savePendingAudioUpload: vi.fn(async pending => { retained.set(pending.key, { ...pending }); }),
      loadPendingAudioUpload: vi.fn(async key => retained.get(key) || null),
      findPendingAudioUpload: vi.fn(async query => [...retained.values()].find(item =>
        item.userId === query.userId && item.projectKey === query.projectKey && item.nodeId === query.nodeId) || null),
      removePendingAudioUpload: vi.fn(async key => { retained.delete(key); }),
    });
    const node = audioNode();
    const first = createHarness([node], services);
    // Allow the durable submission receipt, then fail saves after output exists.
    first.persistSnapshot.mockImplementation(async () => vi.mocked(services.requestAudioGeneration).mock.calls.length === 0);
    await first.controller.retryAudioNode(node);
    const uploadKey = vi.mocked(services.uploadAsset).mock.calls[0][1]?.idempotency_key;
    expect(uploadKey).toBeTruthy();
    expect(retained.size).toBe(1);
    first.controller.dispose();

    // The server still has the original snapshot, with no pending descriptor.
    const refreshed = createHarness([node], services);
    await refreshed.controller.generateFromNode(node.id);
    expect(services.requestAudioGeneration).toHaveBeenCalledTimes(1);
    expect(services.uploadAsset).toHaveBeenCalledTimes(2);
    expect(vi.mocked(services.uploadAsset).mock.calls[1][1]?.idempotency_key).toBe(uploadKey);
    expect(refreshed.nodes[0].metadata).toMatchObject({ status: "success", assetId: "orphan-audio" });
  });

  it("routes Ctrl+Enter through audio upload recovery when a descriptor exists", async () => {
    const services = createServices({
      requestAudioGeneration: vi.fn(async () => new Blob(["audio"], { type: "audio/mpeg" })),
      uploadAsset: vi.fn().mockRejectedValueOnce(new Error("upload unavailable")).mockResolvedValue({ id: "existing-audio", type: "audio", name: "voice.mp3", content_type: "audio/mpeg", size: 5 }),
    });
    const harness = createHarness([audioNode()], services);
    await harness.controller.retryAudioNode(harness.nodes[0]);
    await harness.controller.generateFromNode(harness.nodes[0].id);
    expect(services.requestAudioGeneration).toHaveBeenCalledTimes(1);
    expect(harness.nodes[0].metadata).toMatchObject({ status: "success", assetId: "existing-audio" });
  });

  it("retains audio but does not mutate the new canvas after switching during Blob persistence", async () => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const services = createServices({
      requestAudioGeneration: vi.fn(async () => new Blob(["audio"], { type: "audio/mpeg" })),
      savePendingAudioUpload: vi.fn(async () => held),
    });
    const harness = createHarness([audioNode()], services);
    const running = harness.controller.retryAudioNode(harness.nodes[0]);
    await vi.waitFor(() => expect(services.savePendingAudioUpload).toHaveBeenCalledTimes(1));
    harness.controller.abortAllGenerationRequests();
    const replacement = audioNode({ title: "新的画布音频", metadata: { status: "idle" } });
    harness.bindings.getProjectKey = () => "personal:project-2";
    harness.bindings.setNodes([replacement]);
    harness.persistSnapshot.mockClear();
    release();
    await running;
    expect(harness.nodes).toEqual([replacement]);
    expect(harness.persistSnapshot).not.toHaveBeenCalled();
    expect(services.uploadAsset).not.toHaveBeenCalled();
  });

  it("does not mark a live text request interrupted during a background recovery scan", async () => {
    let finish!: () => void;
    const services = createServices({ requestAiText: vi.fn(() => new Promise(resolve => { finish = () => resolve({ content: "result", model: "text-model" }); })) });
    const node = imageNode({ kind: "text", metadata: { generationMode: "text", status: "error", prompt: "text" } });
    const harness = createHarness([node], services);
    const running = harness.controller.retryTextNode(node);
    await vi.waitFor(() => expect(finish).toBeDefined());
    harness.controller.recoverPendingJobs();
    expect(harness.nodes[0].metadata).toMatchObject({ status: "loading", errorDetails: undefined });
    expect(services.requestAiText).toHaveBeenCalledTimes(1);
    finish();
    await running;
    expect(harness.nodes[0].metadata?.status).toBe("success");
  });

  it.each([false, true])("shows image recovery notices and prevents duplicate generation (restored=%s)", async restored => {
    type Callbacks = NonNullable<Parameters<CanvasGenerationServices["generateImages"]>[1]>;
    let progress!: NonNullable<Callbacks["onProgress"]>;
    let finish!: () => void;
    const images = [{ id: "result", assetId: "result", src: "" }];
    const services = createServices({
      generateImages: vi.fn((_input, callbacks) => new Promise(resolve => {
        callbacks?.onAccepted?.({ id: "job-original" });
        progress = callbacks!.onProgress!;
        finish = () => resolve({ images });
      })),
      waitForImageJob: vi.fn((_id, callbacks) => new Promise(resolve => {
        progress = callbacks!.onProgress!;
        finish = () => resolve({ id: "job-original", type: "image.generate", status: "succeeded", state: "succeeded" });
      })),
      generatedImagesFromJob: vi.fn(async () => images),
    });
    const source = imageNode();
    if (restored) source.metadata = { ...source.metadata, status: "loading", jobId: "job-original" };
    const harness = createHarness([source], services);
    if (restored) harness.controller.recoverPendingJobs();
    else void harness.controller.generateImageFromNode(source.id);
    await vi.waitFor(() => expect(progress).toBeDefined());
    for (const phase of ["image_submission_uncertain", "image_recovery_pending"]) {
      progress({ id: "job-original", type: "image.generate", status: "queued", state: "queued", queue_phase: phase });
      expect(harness.nodes[0].metadata?.generationNotice).toContain(phase === "image_submission_uncertain" ? "勿重复生成" : "正在恢复原图片任务");
      expect(harness.nodes[0].metadata?.status).toBe("loading");
      expect(harness.runningIds.has(source.id)).toBe(true);
      await harness.controller.generateImageFromNode(source.id);
      expect(services.generateImages).toHaveBeenCalledTimes(restored ? 0 : 1);
    }
    finish();
    await vi.waitFor(() => expect(harness.nodes[0].metadata?.status).toBe("success"));
    expect(harness.nodes[0].imageAssetId).toBe("result");
    expect(harness.onError).not.toHaveBeenCalled();
  });

  it.each(["image", "video"] as const)("retains an accepted %s result when completion wins against cancellation", async kind => {
    const services = videoHistoryServices();
    services.cancelJob = vi.fn(async id => ({ id, type: `${kind}.generate`, status: "succeeded" as const, state: "succeeded" as const }));
    let signal: AbortSignal | undefined;
    let complete!: () => void;
    if (kind === "image") {
      services.generateImages = vi.fn((_input, callbacks) => new Promise((resolve, reject) => {
        signal = callbacks!.signal;
        callbacks?.onAccepted?.({ id: "job-image", status: "running" });
        complete = () => resolve({ images: [{ id: "result", assetId: "result", src: "" }] });
        signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }));
    } else {
      services.pollVideoGenerationTask = vi.fn((_config, _task, options) => new Promise((resolve, reject) => {
        signal = options!.signal;
        complete = () => resolve({ status: "completed", result: { url: "", assetId: "result", fileName: "result.mp4", mimeType: "video/mp4" } });
        signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }));
    }
    const source = imageNode({ kind, metadata: { generationMode: kind, prompt: "Generate" } });
    const harness = createHarness([source], services);
    const running = harness.controller.generateFromNode(source.id);
    await vi.waitFor(() => expect(signal).toBeDefined());
    await harness.controller.stopGenerationByNodeId(source.id);
    expect(signal!.aborted).toBe(false);
    expect(harness.nodes[0].metadata?.status).toBe("loading");
    expect(harness.nodes[0].metadata?.jobId).toBeTruthy();
    expect(harness.runningIds.has(source.id)).toBe(true);
    complete();
    await running;
    expect(harness.nodes[0].metadata?.status).toBe("success");
    expect(kind === "image" ? harness.nodes[0].imageAssetId : harness.nodes[0].metadata?.assetId).toBe("result");
    expect(kind === "image" ? services.generateImages : services.createVideoGenerationTask).toHaveBeenCalledOnce();
  });

  it.each(["failed", "network"] as const)("preserves accepted video polling after a %s cancel response", async outcome => {
    const services = videoHistoryServices();
    services.cancelJob = outcome === "network"
      ? vi.fn(async () => { throw new Error("network unavailable"); })
      : vi.fn(async id => ({ id, type: "video.generate", status: "failed" as const, state: "failed" as const }));
    let signal: AbortSignal | undefined;
    let complete!: () => void;
    services.pollVideoGenerationTask = vi.fn((_config, _task, options) => new Promise(resolve => {
      signal = options!.signal;
      complete = () => resolve({ status: "failed", error: "Original provider failure" });
    }));
    const source = videoNode();
    const harness = createHarness([source], services);
    const running = harness.controller.generateFromNode(source.id);
    await vi.waitFor(() => expect(signal).toBeDefined());
    await harness.controller.stopGenerationByNodeId(source.id);
    expect(signal!.aborted).toBe(false);
    expect(harness.nodes[0].metadata?.jobId).toBeTruthy();
    complete();
    await running;
    expect(harness.nodes[0].metadata?.errorDetails).toBe("Original provider failure");
    expect(services.createVideoGenerationTask).toHaveBeenCalledOnce();
  });

  it("ignores a delayed cancellation reply after the original result is applied", async () => {
    const services = videoHistoryServices();
    let respond!: (job: Awaited<ReturnType<CanvasGenerationServices["cancelJob"]>>) => void;
    services.cancelJob = vi.fn(() => new Promise(resolve => { respond = resolve; }));
    let complete!: () => void;
    services.pollVideoGenerationTask = vi.fn(() => new Promise(resolve => {
      complete = () => resolve({ status: "completed", result: { url: "", assetId: "result" } });
    }));
    const harness = createHarness([videoNode()], services);
    const running = harness.controller.generateFromNode("video-1");
    await vi.waitFor(() => expect(services.pollVideoGenerationTask).toHaveBeenCalledOnce());
    const stopping = harness.controller.stopGenerationByNodeId("video-1");
    await harness.controller.stopGenerationByNodeId("video-1");
    expect(services.cancelJob).toHaveBeenCalledOnce();
    complete();
    await running;
    respond({ id: "job-1", type: "video.generate", status: "canceled", state: "canceled" });
    await stopping;
    expect(harness.nodes[0].metadata?.status).toBe("success");
    expect(harness.nodes[0].metadata?.assetId).toBe("result");
  });

  it("retries a transient recovery lookup without failing or resubmitting the accepted video", async () => {
    const services = videoHistoryServices();
    services.getJobs = vi.fn().mockRejectedValueOnce(new ApiError("temporary", 429)).mockResolvedValueOnce({ items: [{
      id: "job-recovered", type: "video.generate", payload: { asset_registration: { source_project_id: "project-1", source_node_id: "video-1" } },
    }] });
    const harness = createHarness([videoNode({ metadata: { generationMode: "video", status: "loading", prompt: "Original" } })], services);
    harness.controller.recoverPendingJobs();
    await vi.waitFor(() => expect(harness.nodes[0].metadata?.status).toBe("success"));
    expect(services.getJobs).toHaveBeenCalledTimes(2);
    expect(services.waitForPoll).toHaveBeenCalledOnce();
    expect(services.createVideoGenerationTask).not.toHaveBeenCalled();
    expect(harness.onError).not.toHaveBeenCalled();
  });

  it.each(["image", "video", "text", "audio"] as const)("cancels a new %s before slow mention lookup finishes", async kind => {
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    const services = createServices({ getAsset: vi.fn(async () => { await ready; return { id: "reference", type: "image", name: "Reference" }; }) });
    const source = imageNode({ kind, content: "@[asset:reference]", metadata: { generationMode: kind, prompt: "@[asset:reference]" } });
    const harness = createHarness([source], services);
    const running = harness.controller.generateFromNode(source.id);
    expect(harness.runningIds.has(source.id)).toBe(true);
    harness.controller.stopGenerationByNodeId(source.id);
    expect(harness.runningIds.size).toBe(0);
    release();
    await running;
    expect(harness.bindings.mergeCanvasAssets).not.toHaveBeenCalled();
    expect(services.getAssetContentObjectUrl).not.toHaveBeenCalled();
    expect(services.generateImages).not.toHaveBeenCalled();
    expect(services.createVideoGenerationTask).not.toHaveBeenCalled();
    expect(services.requestAiText).not.toHaveBeenCalled();
    expect(services.requestAudioGeneration).not.toHaveBeenCalled();
  });

  it.each(["image", "video", "text", "audio"] as const)("cancels %s during snapshot saving and ignores the stale save after a new generation", async kind => {
    let release!: (saved: boolean) => void;
    const saving = new Promise<boolean>(resolve => { release = resolve; });
    const services = videoHistoryServices();
    services.generateImages = vi.fn(async () => ({ images: [{ id: "result", assetId: "result", src: "" }] }));
    services.requestAiText = vi.fn(async () => ({ content: "Text result", model: "text-model" }));
    services.requestAudioGeneration = vi.fn(async () => new Blob(["audio"], { type: "audio/mpeg" }));
    services.uploadAsset = vi.fn(async () => ({ id: "result", name: "result.mp3", type: "audio" as const }));
    const source = imageNode({ kind, metadata: { generationMode: kind, prompt: "Generate" } });
    const harness = createHarness([source], services);
    harness.persistSnapshot.mockImplementationOnce(() => saving);
    const old = harness.controller.generateFromNode(source.id);
    await vi.waitFor(() => expect(harness.persistSnapshot).toHaveBeenCalledOnce());
    harness.controller.stopGenerationByNodeId(source.id);
    expect(harness.runningIds.size).toBe(0);
    expect(harness.nodes[0].metadata?.status).toBe("error");
    await harness.controller.generateFromNode(source.id);
    const completed = structuredClone(harness.nodes);
    expect(completed[0].metadata?.status).toBe("success");
    release(true);
    await old;
    expect(harness.nodes).toEqual(completed);
    const submit = { image: services.generateImages, video: services.createVideoGenerationTask, text: services.requestAiText, audio: services.requestAudioGeneration }[kind];
    expect(submit).toHaveBeenCalledOnce();
    expect(harness.runningIds.size).toBe(0);
  });

  it("recovers a video accepted before its task ID reached the canvas snapshot or local ledger", async () => {
    const services = videoHistoryServices();
    services.getJobs = vi.fn(async () => ({ items: [{ id: "job-video-recovered", type: "video.generate", status: "running", payload: {
      asset_registration: { source_project_id: "project-1", source_node_id: "video-1" },
    } }], total: 1 }));
    const source = videoNode({ metadata: { generationMode: "video", model: "video-model", status: "loading", prompt: "Original" } });
    const harness = createHarness([source], services);
    harness.controller.recoverPendingJobs();
    await vi.waitFor(() => expect(harness.nodes[0].metadata?.status).toBe("success"));
    expect(services.getJobs).toHaveBeenCalledWith(expect.objectContaining({ type: "image.generate,image.edit,video.generate", project_id: "project-1", source_node_ids: "video-1", latest_per_node: true }));
    expect(services.createVideoGenerationTask).not.toHaveBeenCalled();
    expect(services.pollVideoGenerationTask).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: "job-video-recovered" }), expect.anything());
  });

  it("does not declare a loading node failed when its job may be outside the capped recovery page", async () => {
    const services = createServices({ getJobs: vi.fn(async () => ({ items: Array.from({ length: 100 }, (_, index) => ({ id: `job-${index}`, type: "video.generate" })), total: 100 })) });
    const harness = createHarness([videoNode({ metadata: { generationMode: "video", status: "loading" } })], services);
    harness.controller.recoverPendingJobs();
    await vi.waitFor(() => expect(services.getJobs).toHaveBeenCalledOnce());
    expect(harness.nodes[0].metadata?.status).toBe("loading");
    expect(harness.onError).not.toHaveBeenCalled();
  });

  it("bounds recovery by current node IDs in batches even for large canvases", async () => {
    const services = createServices({ getJobs: vi.fn(async () => ({ items: [], total: 0 })) });
    const nodes = Array.from({ length: 47 }, (_, index) => videoNode({ id: `pending-${index}`, metadata: { generationMode: "video", status: "loading" } }));
    const harness = createHarness(nodes, services);
    harness.controller.recoverPendingJobs();
    await vi.waitFor(() => expect(services.getJobs).toHaveBeenCalledTimes(3));
    const ids = vi.mocked(services.getJobs).mock.calls.flatMap(([query]) => String(query?.source_node_ids).split(","));
    expect(new Set(ids)).toEqual(new Set(nodes.map(node => node.id)));
    for (const [query] of vi.mocked(services.getJobs).mock.calls) {
      expect(String(query?.source_node_ids).split(",").length).toBeLessThanOrEqual(20);
      expect(query).toMatchObject({ project_id: "project-1", latest_per_node: true });
    }
    expect(services.createVideoGenerationTask).not.toHaveBeenCalled();
  });

  it("blocks unavailable settings in direct calls but still resumes already accepted jobs", async () => {
    const services = createServices({
      waitForImageJob: vi.fn(async () => ({ id: "accepted", type: "image.generate", status: "succeeded", state: "succeeded" })),
      generatedImagesFromJob: vi.fn(async () => [{ id: "result", assetId: "result", src: "" }]),
    });
    const source = imageNode({ metadata: { status: "loading", imageResolution: "2K" } });
    const harness = createHarness([source], services);
    const input = {
      targetNodeId: source.id, originNodeId: source.id, runningNodeId: source.id,
      projectKey: "personal:project-1", scope: "personal" as const, model: "image-model", prompt: "image",
      size: "2560x1440" as const, quality: "medium" as const, referenceFiles: [],
    };
    expect(await harness.controller.runImageTarget(input)).toBe(false);
    expect(services.generateImages).not.toHaveBeenCalled();
    expect(harness.nodes[0].metadata?.status).toBe("error");
    expect(await harness.controller.runImageTarget({ ...input, existingJobId: "accepted" })).toBe(true);
    expect(services.waitForImageJob).toHaveBeenCalled();
    expect(services.generateImages).not.toHaveBeenCalled();
    expect(harness.nodes[0].metadata?.status).toBe("success");
  });

  it.each(["2K", "4K"])("blocks saved %s settings before generating, uploading references or clearing retry media", async imageResolution => {
    const source = imageNode({ imageAssetId: "original", metadata: { imageResolution, size: "16:9", status: "error", prompt: "@[asset:reference]", referenceInputs: [{ nodeId: "ref", assetId: "reference", title: "参考" }] } });
    const services = createServices();
    const harness = createHarness([source], services);
    await harness.controller.generateFromNode(source.id);
    await harness.controller.retryImageNode(source);
    expect(services.generateImages).not.toHaveBeenCalled();
    expect(services.getAssetContentObjectUrl).not.toHaveBeenCalled();
    expect(services.uploadAsset).not.toHaveBeenCalled();
    expect(harness.nodes).toEqual([source]);
    expect(harness.persistSnapshot).not.toHaveBeenCalled();
    expect(harness.runningIds.size).toBe(0);
    expect(harness.onWarning).toHaveBeenCalledTimes(2);
    expect(harness.onWarning).toHaveBeenLastCalledWith(expect.stringContaining(`暂不支持 ${imageResolution}`));
  });

  it("validates every failed batch target before starting any retries", async () => {
    const root = imageNode({ metadata: { prompt: "image", status: "error", isBatchRoot: true, batchChildIds: ["child"], imageResolution: "1K" } });
    const child = imageNode({ id: "child", metadata: { prompt: "image", status: "error", batchRootId: root.id, imageResolution: "2K" } });
    const services = createServices();
    const harness = createHarness([root, child], services);
    await harness.controller.retryImageNode(root);
    expect(services.generateImages).not.toHaveBeenCalled();
    expect(harness.nodes).toEqual([root, child]);
    expect(harness.runningIds.size).toBe(0);
    expect(harness.onWarning).toHaveBeenCalledWith(expect.stringContaining("暂不支持 2K"));
  });

  it("shows a friendly size failure without exposing provider dimensions in the toast or node", async () => {
    const services = createServices({ generateImages: vi.fn(async () => { throw new Error("图片尺寸不符合所选参数：要求 2560×1440 px，实际返回 1672×941 px。"); }) });
    const harness = createHarness([imageNode()], services);
    await harness.controller.generateFromNode("image-1");
    expect(harness.nodes[0].metadata?.status).toBe("error");
    expect(harness.nodes[0].metadata?.errorDetails).toBe("本次图片未达到所选规格，请调整参数或更换模型后重试。");
    expect(harness.onError).toHaveBeenCalledWith(harness.nodes[0].metadata?.errorDetails);
  });

  it("merges independently when two video preparations and completions finish in reverse order", async () => {
    const pending = new Map<string, () => void>();
    const services = videoHistoryServices();
    services.getAsset = vi.fn(async id => {
      await new Promise<void>(resolve => { pending.set(id, resolve); });
      return { id, type: "image", name: id };
    });
    services.fetchBlob = vi.fn(async () => new Blob(["image"], { type: "image/png" }));
    services.readImageMetadata = vi.fn(async () => ({ width: 512, height: 512 }));
    const first = videoNode({ id: "first", content: "@[asset:ref-a]", metadata: { prompt: "@[asset:ref-a]", generationMode: "video" } });
    const second = videoNode({ id: "second", title: "第二个独立视频", content: "@[asset:ref-b]", metadata: { titleEdited: true, titleMode: "custom", titleBase: "第二个独立视频", prompt: "@[asset:ref-b]", generationMode: "video" } });
    const harness = createHarness([first, second], services);
    const a = harness.controller.generateFromNode(first.id);
    const b = harness.controller.generateFromNode(second.id);
    await vi.waitFor(() => expect(pending.size).toBe(2));
    const added = imageNode({ id: "added" });
    harness.bindings.setNodes([...harness.nodes, added]);
    harness.setEdges([{ id: "added-edge", from: added.id, to: second.id }]);
    pending.get("ref-b")!();
    await b;
    const secondResult = structuredClone(harness.nodes.find(node => node.id === second.id));
    expect(secondResult?.metadata?.status).toBe("success");
    pending.get("ref-a")!();
    await a;
    expect(harness.nodes.map(node => node.id)).toEqual([first.id, second.id, added.id]);
    expect(harness.nodes.find(node => node.id === second.id)).toEqual(secondResult);
    expect(harness.nodes[0].metadata?.status).toBe("success");
    expect(harness.edges).toEqual([{ id: "added-edge", from: added.id, to: second.id }]);
    expect(services.createVideoGenerationTask).toHaveBeenCalledTimes(2);
    expect(harness.runningIds.size).toBe(0);
  });

  it.each(["image", "video", "text", "audio"] as const)("does not submit %s if its pending node was deleted during snapshot saving", async kind => {
    let release!: (saved: boolean) => void;
    const saving = new Promise<boolean>(resolve => { release = resolve; });
    const services = createServices();
    const source = imageNode({ id: "source", kind, metadata: { generationMode: kind, prompt: "生成" } });
    const harness = createHarness([source], services);
    harness.persistSnapshot.mockImplementationOnce(() => saving);
    const running = harness.controller.generateFromNode(source.id);
    await vi.waitFor(() => expect(harness.persistSnapshot).toHaveBeenCalledOnce());
    harness.controller.cancelForRemovedNodes(new Set([source.id]));
    harness.bindings.setNodes([]);
    release(true);
    await running;
    expect(harness.nodes).toEqual([]);
    expect(services.generateImages).not.toHaveBeenCalled();
    expect(services.createVideoGenerationTask).not.toHaveBeenCalled();
    expect(services.requestAiText).not.toHaveBeenCalled();
    expect(services.requestAudioGeneration).not.toHaveBeenCalled();
    expect(harness.runningIds.size).toBe(0);
  });

  it.each(["image", "video", "text", "audio"] as const)("preserves concurrent graph edits while %s references resolve and results arrive", async kind => {
    let release!: () => void;
    const resolving = new Promise<void>(resolve => { release = resolve; });
    const services = videoHistoryServices();
    services.getAsset = vi.fn(async () => { await resolving; return { id: "ref", type: "image", name: "参考图" }; });
    services.fetchBlob = vi.fn(async () => new Blob(["image"], { type: "image/png" }));
    services.readImageMetadata = vi.fn(async () => ({ width: 512, height: 512 }));
    services.readFileDataUrl = vi.fn(async () => "data:image/png;base64,aW1hZ2U=");
    services.generateImages = vi.fn(async () => ({ images: [{ id: "result", assetId: "result", src: "" }] }));
    services.requestAiText = vi.fn(async () => ({ content: "生成结果", model: "text-model" }));
    services.requestAudioGeneration = vi.fn(async () => new Blob(["audio"], { type: "audio/mpeg" }));
    services.uploadAsset = vi.fn(async () => ({ id: "result", type: "audio" as const, name: "audio.mp3" }));
    const source = imageNode({ id: "source", kind, content: "生成 @[asset:ref]", metadata: { generationMode: kind, prompt: "生成 @[asset:ref]" } });
    const edit = imageNode({ id: "edit", title: "保留编辑", metadata: { titleEdited: true, titleBase: "保留编辑", titleMode: "custom" } });
    const removed = imageNode({ id: "removed" });
    const harness = createHarness([source, edit, removed], services);
    harness.setEdges([{ id: "removed-edge", from: removed.id, to: edit.id }]);
    const running = harness.controller.generateFromNode(source.id);
    await vi.waitFor(() => expect(services.getAsset).toHaveBeenCalledOnce());
    const fresh = imageNode({ id: "fresh", title: "等待时新建", metadata: { titleEdited: true, titleBase: "等待时新建", titleMode: "custom" } });
    const edited = { ...edit, x: 777, content: "等待时编辑的内容" };
    harness.bindings.setNodes([
      { ...source, x: 900, y: 600, width: 600, title: "移动后的源节点", metadata: { ...source.metadata, titleEdited: true } },
      edited, fresh,
    ]);
    const edges = [{ id: "new-edge", from: fresh.id, to: edit.id }];
    harness.setEdges(edges);
    harness.bindings.applyNodeSelection([fresh.id], fresh.id);
    release();
    await running;
    expect(harness.onError).not.toHaveBeenCalled();
    expect(harness.nodes.map(node => node.id)).toEqual([source.id, edit.id, fresh.id]);
    expect(harness.nodes.find(node => node.id === edit.id)).toEqual(edited);
    expect(harness.nodes.find(node => node.id === fresh.id)).toEqual(fresh);
    expect(harness.nodes[0]).toMatchObject({ x: 900, y: 600, width: 600, title: "移动后的源节点", metadata: { status: "success" } });
    expect(harness.edges).toEqual(edges);
    expect(harness.bindings.getSelectedNodeId()).toBe(fresh.id);
    for (const [savedNodes, savedEdges] of harness.persistSnapshot.mock.calls) {
      expect(savedNodes.map(node => node.id)).toEqual([source.id, edit.id, fresh.id]);
      expect(savedNodes.find(node => node.id === edit.id)).toEqual(edited);
      expect(savedEdges).toEqual(edges);
    }
  });

  it.each(["image", "video", "text", "audio"] as const)("does not resurrect or submit a %s node deleted while asset mentions resolve", async kind => {
    let release!: () => void;
    const resolving = new Promise<void>(resolve => { release = resolve; });
    const services = createServices({ getAsset: vi.fn(async () => { await resolving; return { id: "ref", type: "image", name: "参考图" }; }) });
    const source = imageNode({ id: "source", kind, content: "生成 @[asset:ref]", metadata: { generationMode: kind, prompt: "生成 @[asset:ref]" } });
    const harness = createHarness([source], services);
    const running = harness.controller.generateFromNode(source.id);
    await vi.waitFor(() => expect(services.getAsset).toHaveBeenCalledOnce());
    harness.controller.cancelForRemovedNodes(new Set([source.id]));
    harness.bindings.setNodes([]);
    release();
    await running;
    expect(harness.nodes).toEqual([]);
    expect(harness.persistSnapshot).not.toHaveBeenCalled();
    expect(services.getAssetContentObjectUrl).not.toHaveBeenCalled();
    expect(services.generateImages).not.toHaveBeenCalled();
    expect(services.createVideoGenerationTask).not.toHaveBeenCalled();
    expect(services.requestAiText).not.toHaveBeenCalled();
    expect(services.requestAudioGeneration).not.toHaveBeenCalled();
  });

  it.each(["image", "video", "text", "audio"] as const)("keeps custom %s names through retry and names default results from the project", async kind => {
    for (const custom of [false, true]) {
      const services = videoHistoryServices();
      services.generateImages = vi.fn(async () => ({ images: [{ id: "asset", assetId: "asset", src: "", name: "provider.png" }] }));
      services.requestAiText = vi.fn(async () => ({ content: "生成的文字不能成为标题", model: "text-model" }));
      services.requestAudioGeneration = vi.fn(async () => new Blob(["audio"], { type: "audio/mpeg" }));
      services.uploadAsset = vi.fn(async () => ({ id: "asset", name: "provider.mp3", type: "audio" as const }));
      const node = imageNode({ kind, title: custom ? "苹果" : "生成失败", metadata: {
        prompt: "新的提示词", generationMode: kind, status: "error",
        ...(custom ? { titleEdited: true, titleBase: "苹果" } : {}),
      } });
      const harness = createHarness([node], services);
      const retry = { image: harness.controller.retryImageNode, video: harness.controller.retryVideoNode,
        text: harness.controller.retryTextNode, audio: harness.controller.retryAudioNode }[kind];
      await retry(node);
      expect(harness.onError).not.toHaveBeenCalled();
      expect(harness.nodes[0]).toMatchObject({ id: node.id, title: custom ? "苹果" : `测试画布${kind}-1`,
        metadata: { status: "success", generatedInCanvas: true } });
      if (custom) expect(harness.persistSnapshot.mock.calls.every(([nodes]) => nodes[0].title === "苹果")).toBe(true);
    }
  });

  it("keeps existing batch children in place when later nodes exist and the batch is regenerated", async () => {
    const services = createServices({ generateImages: vi.fn(async () => ({ images: [{ id: "asset", assetId: "asset", src: "" }] })) });
    const harness = createHarness([imageNode({ metadata: { prompt: "测试", count: 3 } })], services);
    await harness.controller.generateImageFromNode("image-1");
    harness.bindings.setNodes([...harness.nodes, imageNode({ id: "later", title: "后创建的图片", metadata: { generatedInCanvas: true } })]);
    const order = harness.nodes.map(node => node.id);
    await harness.controller.generateImageFromNode("image-1");
    expect(harness.nodes.map(node => node.id)).toEqual(order);
    expect(harness.nodes.map(node => node.title)).toEqual(["测试画布image-1", "测试画布image-2", "测试画布image-3", "测试画布image-4"]);
    harness.bindings.setNodes(harness.nodes.map(node => node.id === "image-1" ? { ...node, metadata: { ...node.metadata, count: 2 } } : node));
    await harness.controller.generateImageFromNode("image-1");
    expect(harness.nodes.map(node => node.id)).toEqual(order);
    expect(harness.nodes.map(node => node.title)).toEqual(["测试画布image-1", "测试画布image-2", "测试画布image-3", "测试画布image-4"]);
  });

  it.each(["generate", "retry"] as const)("keeps slow video references readable after 20 seconds during %s", async entry => {
    vi.useFakeTimers();
    let release!: (url: string) => void;
    let readSignal: AbortSignal | undefined;
    const referenceReady = new Promise<string>(resolve => { release = resolve; });
    const services = videoHistoryServices();
    services.getAssetContentObjectUrl = vi.fn((_id, _scope, _options, signal) => {
      readSignal = signal;
      return referenceReady;
    });
    services.fetchBlob = vi.fn(async () => new Blob(["image"], { type: "image/png" }));
    services.readImageMetadata = vi.fn(async () => ({ width: 512, height: 512 }));
    const target = videoNode({ metadata: { prompt: "animate", generationMode: "video", status: "success", assetId: "previous" } });
    const reference = imageNode({ id: "reference", imageAssetId: "reference-asset" });
    const harness = createHarness([target, reference], services);
    harness.setEdges([{ id: "reference-edge", from: reference.id, to: target.id }]);
    try {
      const running = entry === "generate"
        ? harness.controller.generateVideoFromNode(target.id)
        : harness.controller.retryVideoNode(target);
      await vi.advanceTimersByTimeAsync(0);
      expect(services.getAssetContentObjectUrl).toHaveBeenCalledOnce();
      expect(readSignal).toBeDefined();
      await vi.advanceTimersByTimeAsync(30000);
      expect(readSignal!.aborted).toBe(false);
      expect(harness.onError).not.toHaveBeenCalled();
      expect(harness.onWarning).not.toHaveBeenCalled();
      expect(services.createVideoGenerationTask).not.toHaveBeenCalled();
      release("blob:reference");
      await running;
      expect(services.createVideoGenerationTask).toHaveBeenCalledOnce();
      expect(harness.nodes[0].metadata?.status).toBe("success");
      expect(harness.runningIds.size).toBe(0);
    } finally {
      harness.controller.abortAllGenerationRequests();
      vi.useRealTimers();
    }
  });
  it("checks reference types without downloading media while inspecting a node", async () => {
    const target = videoNode({ metadata: { model: "openai::video", prompt: "animate", generationMode: "video" } });
    const audio = audioNode({ imageSrc: "https://example.test/long.wav" });
    const image = imageNode({ imageSrc: "https://example.test/image.png" });
    const services = createServices({
      fetchBlob: vi.fn(async url => new Blob(["media"], { type: url.endsWith("wav") ? "audio/wav" : "image/png" })),
      readAudioMetadata: vi.fn(async () => ({ durationMs: 20000 })),
      readImageMetadata: vi.fn(async () => ({ width: 512, height: 512 })),
    });
    const harness = createHarness([target, audio, image], services);
    harness.setEdges([{ id: "audio", from: audio.id, to: target.id }, { id: "image", from: image.id, to: target.id }]);
    const inspect = () => harness.controller.preflightVideoNode(target.id, new AbortController().signal);
    await expect(inspect()).rejects.toThrow("仅支持参考图片");
    expect(services.fetchBlob).not.toHaveBeenCalled();
    target.metadata!.model = "seedance-2.0";
    await expect(inspect()).resolves.toEqual([]);
    target.metadata!.model = "seedance-2.5";
    await expect(inspect()).resolves.toEqual([]);
    expect(services.fetchBlob).toHaveBeenCalledTimes(0);
    expect(services.createVideoGenerationTask).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(["image", "video"] as const)("shows %s retry preparation immediately and ignores duplicate clicks while references load", async kind => {
    let release!: (url: string) => void;
    const referenceReady = new Promise<string>(resolve => { release = resolve; });
    const services = videoHistoryServices();
    services.getAssetContentObjectUrl = vi.fn(() => referenceReady);
    services.fetchBlob = vi.fn(async () => new Blob(["image"], { type: "image/png" }));
    services.readImageMetadata = vi.fn(async () => ({ width: 512, height: 512 }));
    services.generateImages = vi.fn(async () => ({ images: [{ id: "result", assetId: "result", src: "" }] }));
    const node = (kind === "image" ? imageNode : videoNode)({ metadata: {
      status: "error", errorDetails: "failed", prompt: "Retry @[node:reference]",
      referenceInputs: [{ nodeId: "reference", title: "Reference", assetId: "reference-asset", assetScope: "personal", name: "reference.png", contentType: "image/png" }],
    } });
    const harness = createHarness([node, imageNode({ id: "reference", imageAssetId: "reference-asset" })], services);
    const retry = kind === "image" ? harness.controller.retryImageNode : harness.controller.retryVideoNode;
    const running = retry(node);
    expect(harness.runningIds).toContain(node.id);
    await vi.waitFor(() => expect(services.getAssetContentObjectUrl).toHaveBeenCalledTimes(1));
    await retry(node);
    await harness.controller.generateFromNode(node.id);
    expect(services.getAssetContentObjectUrl).toHaveBeenCalledTimes(1);
    expect(services.generateImages).not.toHaveBeenCalled();
    expect(services.createVideoGenerationTask).not.toHaveBeenCalled();
    release("blob:reference");
    await running;
    expect(kind === "image" ? services.generateImages : services.createVideoGenerationTask).toHaveBeenCalledTimes(1);
    expect(harness.runningIds.size).toBe(0);
    expect(harness.nodes[0].metadata?.status).toBe("success");
  });

  it.each(["text", "audio", "video"] as const)("allows canceling %s retry during slow persistence without submitting later", async kind => {
    let release!: (saved: boolean) => void;
    const saving = new Promise<boolean>(resolve => { release = resolve; });
    const services = createServices();
    const node = imageNode({ kind, metadata: { status: "error", prompt: "Retry prompt", generationMode: kind } });
    const harness = createHarness([node], services);
    harness.persistSnapshot.mockImplementationOnce(() => saving);
    const retry = { text: harness.controller.retryTextNode, audio: harness.controller.retryAudioNode, video: harness.controller.retryVideoNode }[kind];
    const running = retry(node);
    expect(harness.runningIds).toContain(node.id);
    await vi.waitFor(() => expect(harness.persistSnapshot).toHaveBeenCalledTimes(1));
    await retry(node);
    expect(harness.persistSnapshot).toHaveBeenCalledTimes(1);
    harness.controller.stopGenerationByNodeId(node.id);
    expect(harness.runningIds.size).toBe(0);
    expect(harness.nodes[0].metadata?.status).toBe("error");
    release(true);
    await running;
    expect(services.requestAiText).not.toHaveBeenCalled();
    expect(services.requestAudioGeneration).not.toHaveBeenCalled();
    expect(services.createVideoGenerationTask).not.toHaveBeenCalled();
  });

  it("cancels slow image references immediately and a stale completion cannot release the next retry", async () => {
    const releases: Array<(url: string) => void> = [];
    const signals: AbortSignal[] = [];
    const services = createServices({
      getAssetContentObjectUrl: vi.fn((_id, _scope, _options, signal) => {
        signals.push(signal!);
        return new Promise<string>(resolve => { releases.push(resolve); });
      }),
      fetchBlob: vi.fn(async () => new Blob(["image"], { type: "image/png" })),
      generateImages: vi.fn(async () => ({ images: [{ id: "result", assetId: "result", src: "" }] })),
    });
    const node = imageNode({ metadata: { status: "error", prompt: "Retry", sourceNodeId: "deleted-source",
      referenceInputs: [{ nodeId: "removed-reference", title: "Reference", assetId: "ref", assetScope: "personal", name: "ref.png", contentType: "image/png" }],
    } });
    const harness = createHarness([node], services);
    const old = harness.controller.retryImageNode(node);
    expect(harness.runningIds).toContain(node.id);
    harness.controller.stopGenerationByNodeId(node.id);
    expect(signals[0].aborted).toBe(true);
    expect(harness.runningIds.size).toBe(0);
    const current = harness.controller.retryImageNode(node);
    releases[0]("blob:old");
    await old;
    expect(harness.runningIds).toContain(node.id);
    expect(services.generateImages).not.toHaveBeenCalled();
    releases[1]("blob:current");
    await current;
    expect(services.generateImages).toHaveBeenCalledTimes(1);
    expect(harness.runningIds.size).toBe(0);
  });

  it.each(["text", "audio"] as const)("does not leave %s loading if a canvas switch starts during retry saving", async kind => {
    let release!: (saved: boolean) => void;
    const saving = new Promise<boolean>(resolve => { release = resolve; });
    const services = createServices();
    const node = imageNode({ kind, metadata: { status: "error", prompt: "Retry", generationMode: kind } });
    const harness = createHarness([node], services);
    harness.persistSnapshot.mockImplementationOnce(() => saving);
    const running = (kind === "text" ? harness.controller.retryTextNode : harness.controller.retryAudioNode)(node);
    harness.bindings.isSwitching = () => true;
    harness.controller.abortAllGenerationRequests();
    release(true);
    await running;
    expect(harness.nodes[0].metadata?.status).toBe("error");
    expect(harness.runningIds.size).toBe(0);
    expect(services.requestAiText).not.toHaveBeenCalled();
    expect(services.requestAudioGeneration).not.toHaveBeenCalled();
  });

  it.each(["cancel", "switch", "remove"] as const)("does not submit a video after %s while asset mentions resolve", async action => {
    let release!: () => void;
    const assetReady = new Promise<void>(resolve => { release = resolve; });
    const services = createServices({ getAsset: vi.fn(async () => { await assetReady; return { id: "ref", type: "image", name: "Reference" }; }) });
    const node = videoNode({ metadata: { status: "error", prompt: "Retry @[asset:ref]" } });
    const harness = createHarness([node], services);
    const running = harness.controller.retryVideoNode(node);
    expect(harness.runningIds).toContain(node.id);
    await vi.waitFor(() => expect(services.getAsset).toHaveBeenCalledOnce());
    if (action === "cancel") harness.controller.stopGenerationByNodeId(node.id);
    if (action === "switch") {
      harness.controller.abortAllGenerationRequests();
      harness.bindings.getProjectKey = () => "personal:project-2";
    }
    if (action === "remove") harness.controller.cancelForRemovedNodes(new Set([node.id]));
    expect(harness.runningIds.size).toBe(0);
    release();
    await running;
    expect(services.getAssetContentObjectUrl).not.toHaveBeenCalled();
    expect(services.createVideoGenerationTask).not.toHaveBeenCalled();
    expect(harness.persistSnapshot).toHaveBeenCalledTimes(action === "cancel" ? 1 : 0);
    expect(harness.bindings.mergeCanvasAssets).not.toHaveBeenCalled();
  });

  it("reports failed reference loading, persists the error and releases the retry lock", async () => {
    const services = createServices({ getAssetContentObjectUrl: vi.fn(async () => { throw new Error("Reference unavailable"); }) });
    const node = imageNode({ metadata: { status: "error", prompt: "Retry", referenceInputs: [
      { nodeId: "ref", title: "Reference", assetId: "ref", assetScope: "personal", name: "ref.png", contentType: "image/png" },
    ] } });
    const harness = createHarness([node], services);
    await harness.controller.retryImageNode(node);
    expect(harness.nodes[0].metadata?.errorDetails).toContain("Reference unavailable");
    expect(harness.onError).toHaveBeenCalledOnce();
    expect(harness.persistSnapshot).toHaveBeenCalledOnce();
    expect(harness.runningIds.size).toBe(0);
    await harness.controller.retryImageNode(node);
    expect(services.getAssetContentObjectUrl).toHaveBeenCalledTimes(2);
  });

  it("shows preparation on a batch root and cancels all pending children without changing completed results", async () => {
    let release!: (url: string) => void;
    const referenceReady = new Promise<string>(resolve => { release = resolve; });
    const services = createServices({
      getAssetContentObjectUrl: vi.fn(() => referenceReady),
      fetchBlob: vi.fn(async () => new Blob(["image"], { type: "image/png" })),
    });
    const root = imageNode({ id: "root", imageAssetId: "completed", metadata: { isBatchRoot: true, batchChildIds: ["child"], status: "success", ownAssetId: "completed" } });
    const child = imageNode({ id: "child", metadata: { batchRootId: "root", status: "error", prompt: "Retry", referenceInputs: [
      { nodeId: "ref", title: "Reference", assetId: "ref", assetScope: "personal", name: "ref.png", contentType: "image/png" },
    ] } });
    const harness = createHarness([root, child], services);
    const running = harness.controller.retryImageNode(root);
    expect(harness.runningIds).toEqual(new Set(["child", "root"]));
    await harness.controller.retryImageNode(root);
    expect(services.getAssetContentObjectUrl).toHaveBeenCalledOnce();
    harness.controller.stopGenerationByNodeId(root.id);
    expect(harness.runningIds.size).toBe(0);
    release("blob:reference");
    await running;
    expect(services.generateImages).not.toHaveBeenCalled();
    expect(harness.nodes[0].imageAssetId).toBe("completed");
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
      imageResolution: "1K", size: "16:9", quality: "high",
    } });
    const harness = createHarness([source], services);
    await harness.controller.generateFromNode(source.id);
    const targets = harness.nodes.filter(node => node.kind === "image");
    expect(targets).toHaveLength(2);
    for (const target of targets) {
      expect(target.metadata).toMatchObject({ imageResolution: "1K", size: "16:9", quality: "high", requestedImageSize: "1280x720" });
    }
    await harness.controller.retryImageNode(targets[1]);
    expect(services.generateImages).toHaveBeenCalledTimes(3);
    for (const [input] of vi.mocked(services.generateImages).mock.calls) {
      expect(input).toMatchObject({ size: "1280x720", quality: "high", count: 1 });
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
    expect(services.generateImages).toHaveBeenCalledTimes(1);
    expect(harness.onWarning).toHaveBeenCalledWith(expect.stringContaining("暂不支持 4K"));
    harness.nodes[0] = { ...harness.nodes[0], metadata: { ...harness.nodes[0].metadata, imageResolution: "1K" } };
    await harness.controller.generateFromNode(source.id);
    expect(vi.mocked(services.generateImages).mock.calls[1][0]).toMatchObject({
      size: "1280x720",
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

  it.each(["image", "video", "text", "audio"] as const)("shows queued %s generation and cancels it without submitting another job", async kind => {
    let signal: AbortSignal | undefined;
    const wait = (currentSignal?: AbortSignal, onWaiting?: (waiting: boolean) => void) => new Promise<never>((_resolve, reject) => {
      signal = currentSignal;
      onWaiting?.(true);
      currentSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
    const services = createServices({
      generateImages: vi.fn((_input, options) => wait(options?.signal, options?.onWaiting)),
      createVideoGenerationTask: vi.fn((_config, _prompt, _references, options) => wait(options?.signal, options?.onWaiting)),
      requestAiText: vi.fn((_input, currentSignal, onWaiting) => wait(currentSignal, onWaiting)),
      requestAudioGeneration: vi.fn((_config, _prompt, options) => wait(options?.signal, options?.onWaiting)),
    });
    const node = imageNode({ kind, metadata: { prompt: "海景", generationMode: kind, count: 1 } });
    const harness = createHarness([node], services);
    const pending = harness.controller.generateFromNode(node.id);
    await vi.waitFor(() => expect(harness.nodes.some(item => item.metadata?.generationQueued)).toBe(true));
    expect(harness.onError).not.toHaveBeenCalled();
    harness.controller.stopGenerationByNodeId(node.id);
    await pending;
    expect(signal?.aborted).toBe(true);
    expect(harness.runningIds.size).toBe(0);
    expect(services.cancelJob).not.toHaveBeenCalled();
  });

  it("grows an existing image batch beyond four and retains old results when the next count shrinks", async () => {
    let sequence = 0;
    const generateImages = vi.fn(async () => ({ images: [{ id: `asset-${++sequence}`, assetId: `asset-${sequence}`, src: "" }] }));
    const services = createServices({ generateImages: generateImages as CanvasGenerationServices["generateImages"] });
    const harness = createHarness([imageNode({ metadata: { prompt: "海景", count: 4 } })], services);
    await harness.controller.generateImageFromNode("image-1");
    expect(harness.nodes).toHaveLength(4);
    const initialIds = harness.nodes.map(node => node.id);
    harness.bindings.setNodes(harness.nodes.map(node => node.id === "image-1" ? { ...node, metadata: { ...node.metadata, count: 15 } } : node));
    await harness.controller.generateImageFromNode("image-1");
    expect(generateImages).toHaveBeenCalledTimes(19);
    expect(harness.nodes).toHaveLength(15);
    expect(harness.nodes.every(node => node.metadata?.status === "success")).toBe(true);
    expect(harness.nodes[0].metadata?.batchChildIds).toHaveLength(14);
    for (const id of initialIds) {
      const node = harness.nodes.find(item => item.id === id)!;
      expect(node.metadata?.generationRevisions).toHaveLength(1);
    }
    const previousAssets = new Map(harness.nodes.map(node => [node.id, node.imageAssetId]));
    harness.bindings.setNodes(harness.nodes.map(node => node.id === "image-1" ? { ...node, metadata: { ...node.metadata, count: 1 } } : node));
    await harness.controller.generateImageFromNode("image-1");
    expect(generateImages).toHaveBeenCalledTimes(20);
    expect(harness.nodes).toHaveLength(15);
    expect(harness.nodes[0].metadata?.isBatchRoot).toBeUndefined();
    for (const node of harness.nodes.slice(1)) {
      expect(node.metadata?.batchRootId).toBeUndefined();
      expect(node.imageAssetId).toBe(previousAssets.get(node.id));
    }
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
      title: "测试画布image-1",
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
