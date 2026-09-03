import { describe, expect, it, vi } from "vitest";

import type { Asset } from "@/entities/asset";
import type { CanvasMentionReference } from "@/features/canvas/domain/mentions";
import type { CanvasEdgeData, CanvasNodeData } from "@/features/canvas/domain/types";
import { CanvasAssetsMentionsController } from "./controller";
import type {
  CanvasAssetsMentionsBindings,
  CanvasAssetsMentionsServices,
} from "./types";

const imageAsset: Asset = {
  id: "asset-1",
  type: "image",
  name: "参考图.png",
  content_type: "image/png",
  size: 128,
};

function canvasNode(id: string, metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData {
  return {
    id,
    kind: "image",
    title: id,
    content: "",
    x: 0,
    y: 0,
    width: 320,
    height: 238,
    metadata,
  };
}

function createServices(overrides: Partial<CanvasAssetsMentionsServices> = {}) {
  let sequence = 0;
  return {
    getAssetLibrary: vi.fn(async () => ({ items: [], total: 0, page: 1, page_size: 60 })),
    getAssetContentObjectUrl: vi.fn(),
    listCanvasTextAssets: vi.fn(async () => []),
    createId: () => `node-${++sequence}`,
    confirm: vi.fn(() => true),
    schedule: vi.fn((callback: () => void) => {
      callback();
      return ++sequence;
    }),
    cancelSchedule: vi.fn(),
    revokeObjectURL: vi.fn(),
    warn: vi.fn(),
    ...overrides,
  } as unknown as CanvasAssetsMentionsServices;
}

function createHarness(
  initialNodes: CanvasNodeData[],
  services: CanvasAssetsMentionsServices,
  initialEdges: CanvasEdgeData[] = [],
) {
  let nodes = initialNodes;
  let edges = initialEdges;
  const applyNodeSelection = vi.fn();
  const setImagePreviewNodeId = vi.fn();
  const toggleCanvasBatch = vi.fn();
  const focusNodeInViewport = vi.fn();
  const onSuccess = vi.fn();
  const onError = vi.fn();
  const controller = new CanvasAssetsMentionsController("personal", services);
  const bindings: CanvasAssetsMentionsBindings = {
    getUserId: () => "user-1",
    getProjectId: () => "project-1",
    getCanonicalScope: () => "personal",
    getFallbackScope: () => "personal",
    getMentionScope: () => "personal",
    getNodes: () => nodes,
    getEdges: () => edges,
    setNodes: value => { nodes = value; },
    applyNodeSelection,
    getCanvasCenter: () => ({ x: 500, y: 300 }),
    setImagePreviewNodeId,
    toggleCanvasBatch,
    focusNodeInViewport,
    executeAssets: operation => operation(),
    onSuccess,
    onError,
  };
  controller.updateBindings(bindings);
  return {
    controller,
    get nodes() { return nodes; },
    set nodes(value: CanvasNodeData[]) { nodes = value; },
    get edges() { return edges; },
    set edges(value: CanvasEdgeData[]) { edges = value; },
    applyNodeSelection,
    setImagePreviewNodeId,
    toggleCanvasBatch,
    focusNodeInViewport,
    onSuccess,
    onError,
  };
}

function mentionReference(values: Partial<CanvasMentionReference> = {}): CanvasMentionReference {
  return {
    id: "asset:asset-1",
    key: "asset:asset-1",
    source: "asset",
    group: "asset-library",
    targetId: "asset-1",
    kind: "image",
    label: "参考图",
    title: "参考图",
    assetId: "asset-1",
    assetScope: "personal",
    ...values,
  };
}

describe("CanvasAssetsMentionsController", () => {
  it("合并服务端与本地文本目录并按原节点结构插入选择项", async () => {
    const getAssetLibrary = vi.fn(async () => ({
      items: [imageAsset],
      total: 1,
      page: 1,
      page_size: 60,
    }));
    const listCanvasTextAssets = vi.fn(async () => [{
      id: "text-1",
      title: "分镜描述",
      content: "角色走进雨夜街道",
      scope: "personal" as const,
      createdAt: "2026-09-03T00:00:00.000Z",
      updatedAt: "2026-09-03T00:00:00.000Z",
    }]);
    const services = createServices({
      getAssetLibrary: getAssetLibrary as CanvasAssetsMentionsServices["getAssetLibrary"],
      listCanvasTextAssets: listCanvasTextAssets as CanvasAssetsMentionsServices["listCanvasTextAssets"],
    });
    const harness = createHarness([], services);

    harness.controller.openAssetPicker();
    await vi.waitFor(() => expect(harness.controller.getSnapshot().picker.loading).toBe(false));

    expect(harness.controller.getSnapshot().picker.items.map(item => item.id)).toEqual([
      "text:text-1",
      "server:asset-1",
    ]);
    expect(harness.controller.getAssets()).toEqual([{ ...imageAsset, scope: "personal" }]);

    harness.controller.toggleAssetPickerItem("server:asset-1");
    await harness.controller.insertAssetPickerSelection();

    expect(harness.nodes).toHaveLength(1);
    expect(harness.nodes[0]).toMatchObject({
      kind: "image",
      title: "参考图.png",
      x: 380,
      y: 220,
      metadata: {
        assetId: "asset-1",
        assetScope: "personal",
        mimeType: "image/png",
        status: "success",
      },
    });
    expect(harness.applyNodeSelection).toHaveBeenCalledWith(
      [harness.nodes[0]?.id],
      harness.nodes[0]?.id,
      true,
    );
    expect(harness.onSuccess).toHaveBeenCalledWith("已插入 1 个资产节点");
  });

  it("按 owner 复用并释放节点预览与 mention 详情 Object URL", async () => {
    const getAssetContentObjectUrl = vi.fn(async (assetId: string) => `blob:${assetId}`);
    const revokeObjectURL = vi.fn();
    const services = createServices({
      getAssetContentObjectUrl: getAssetContentObjectUrl as CanvasAssetsMentionsServices["getAssetContentObjectUrl"],
      revokeObjectURL,
    });
    const harness = createHarness([
      canvasNode("image-node", { assetId: "asset-1", assetScope: "personal" }),
    ], services);

    await harness.controller.syncNodePreviews({
      projectId: "project-1",
      canonicalScope: "personal",
      fallbackScope: "personal",
    });
    expect(harness.controller.getSnapshot().previews).toEqual({ "asset-1": "blob:asset-1" });
    expect(getAssetContentObjectUrl).toHaveBeenCalledTimes(1);

    harness.controller.previewMentionReference(mentionReference({
      id: "asset:asset-2",
      key: "asset:asset-2",
      targetId: "asset-2",
      assetId: "asset-2",
    }));
    await vi.waitFor(() => expect(harness.controller.getSnapshot().mentionPreview?.url).toBe("blob:asset-2"));
    harness.controller.closeMentionPreview();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:asset-2");

    harness.nodes = [];
    await harness.controller.syncNodePreviews({
      projectId: "project-1",
      canonicalScope: "personal",
      fallbackScope: "personal",
    });
    expect(harness.controller.getSnapshot().previews).toEqual({});
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:asset-1");
  });

  it("展开折叠批次后定位 mention 指向的子节点", () => {
    const root = canvasNode("root", {
      isBatchRoot: true,
      batchChildIds: ["child"],
      imageBatchExpanded: false,
    });
    const child = canvasNode("child", { batchRootId: "root" });
    const harness = createHarness([root, child], createServices());
    const reference = mentionReference({
      id: "node:child",
      key: "node:child",
      source: "node",
      group: "canvas-node",
      targetId: "child",
      nodeId: "child",
      assetId: undefined,
    });

    harness.controller.locateMentionReference(reference);

    expect(harness.toggleCanvasBatch).toHaveBeenCalledWith("root");
    expect(harness.focusNodeInViewport).toHaveBeenCalledWith("child");
  });

  it("mention 搜索保持 240ms debounce 并取消上一计时器", () => {
    const scheduled = new Map<number, () => void>();
    let sequence = 0;
    const schedule = vi.fn((callback: () => void, delayMs: number) => {
      expect(delayMs).toBe(240);
      const id = ++sequence;
      scheduled.set(id, callback);
      return id;
    });
    const cancelSchedule = vi.fn((id: number) => scheduled.delete(id));
    const services = createServices({ schedule, cancelSchedule });
    const harness = createHarness([], services);

    harness.controller.queueMentionAssetSearch("雨夜");
    harness.controller.queueMentionAssetSearch("雨夜街道");

    expect(cancelSchedule).toHaveBeenCalledWith(1);
    expect(schedule).toHaveBeenCalledTimes(2);
    expect(scheduled.has(1)).toBe(false);
    expect(scheduled.has(2)).toBe(true);
  });
});
