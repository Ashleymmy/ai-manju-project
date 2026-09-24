import { describe, expect, it, vi } from "vitest";

import type { Asset, AssetFolder, AssetLibraryQuery, SeedanceAsset } from "@/entities/asset";
import { savedSeedanceRegistration } from "@/features/canvas/services/seedanceRegistration";
import type { CanvasMentionReference } from "@/features/canvas/domain/mentions";
import { buildCanvasMentionGenerationContext } from "@/features/canvas/domain/mentions";
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

const archiveFolders: AssetFolder[] = [
  { id: "mine", parent_id: "", name: "当前画布", system_key: "canvas_project", source_ref_id: "project-1" },
  { id: "day-1", parent_id: "mine", name: "2026-09-15", system_key: "canvas_project_date" },
  { id: "day-2", parent_id: "mine", name: "2026-09-16", system_key: "canvas_project_date" },
  { id: "roles", parent_id: "mine", name: "角色", system_key: "canvas_category" },
].map(folder => ({ ...folder, kind: "system", asset_count: 0, descendant_asset_count: 0, sort_order: 0 }));

function canvasNode(id: string, metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData {
  return {
    listUserSeedanceAssets: vi.fn(async () => ({ items: [], total: 0 })),
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
    getAssetFolders: vi.fn(async () => []),
    getAssetMediaUrl: vi.fn((id: string, scope: string, width?: number) => `/api/assets/${id}/content?scope=${scope}${width ? `&thumbnail=${width}` : ""}`),
    getAssetContentObjectUrl: vi.fn(async (assetId: string) => `blob:thumb-${assetId}`),
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
    bindings,
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
  it("requests type order before pagination and sorts mixed picker entries without removing name indices", async () => {
    const media: Asset[] = [
      { id: "a", type: "audio", name: "台词（2）" }, { id: "v", type: "video", name: "镜头（1）" },
      { id: "i", type: "image", name: "苹果（1）" }, { id: "i2", type: "image", name: "苹果（2）" },
    ];
    const api = createServices({ getAssetLibrary: vi.fn(async (_scope, query) => ({ items: query?.page === 2 ? media.slice(2) : media, total: 8, page: query?.page || 1, page_size: 4 })),
      listCanvasTextAssets: vi.fn(async () => [{ id: "t", title: "剧本（1）", content: "内容", scope: "personal", createdAt: "", updatedAt: "" }]) });
    const { controller } = createHarness([], api);
    await controller.loadMentionCatalog("", "personal", "favorites");
    await controller.loadMentionCatalog("", "personal", "favorites", 2);
    expect(api.getAssetLibrary).toHaveBeenLastCalledWith("personal", expect.objectContaining({ sort: "type_created_at_desc", page: 2, smartView: "favorite" }), expect.any(AbortSignal));
    expect(controller.getSnapshot().mentionLibrary.assetIds).toEqual(["a", "v", "i", "i2"]);
    controller.openAssetPicker();
    await vi.waitFor(() => expect(controller.getSnapshot().picker.loading).toBe(false));
    expect(controller.getSnapshot().picker.items.map(item => item.name)).toEqual(["剧本（1）", "苹果（1）", "苹果（2）", "镜头（1）", "台词（2）"]);
    expect(api.getAssetLibrary).toHaveBeenLastCalledWith("personal", expect.objectContaining({ sort: "type_created_at_desc", page: 1 }), expect.any(AbortSignal));
    controller.dispose();
  });
  it("keeps confirmed renames in mentions and picker when an older list request finishes later", async () => {
    let release!: (value: any) => void;
    const services = createServices({ getAssetLibrary: vi.fn(() => new Promise(resolve => { release = resolve; })) as CanvasAssetsMentionsServices["getAssetLibrary"] });
    const { controller } = createHarness([], services);
    controller.mergeAssets([imageAsset], "personal");
    controller.mergeAssets([imageAsset], "team");
    const reading = controller.loadMentionCatalog();
    await vi.waitFor(() => expect(services.getAssetLibrary).toHaveBeenCalled());
    controller.applyAssetNameChange({ assetId: imageAsset.id, name: "新名称", scope: "personal" });
    release({ items: [imageAsset], total: 1, page: 1, page_size: 60 });
    await reading;
    expect(controller.getAssets().find(asset => asset.scope === "personal")?.name).toBe("新名称");
    expect(controller.getAssets().find(asset => asset.scope === "team")?.name).toBe("参考图.png");
    controller.openAssetPicker();
    await vi.waitFor(() => expect(services.getAssetLibrary).toHaveBeenCalledTimes(2));
    controller.applyAssetNameChange({ assetId: imageAsset.id, name: "再次改名", scope: "personal" });
    release({ items: [imageAsset], total: 1, page: 1, page_size: 60 });
    await vi.waitFor(() => expect(controller.getSnapshot().picker.loading).toBe(false));
    expect(controller.getSnapshot().picker.items[0].name).toBe("再次改名");
    expect(controller.getSnapshot().picker.items[0].serverAsset?.name).toBe("再次改名");
    controller.applyAssetNameChange({ assetId: imageAsset.id, name: "最终名", scope: "personal" });
    expect(controller.getSnapshot().picker.items[0].name).toBe("最终名");
    controller.dispose();
  });
  const registered: SeedanceAsset = {
    id: "registered-1", name: "拟真人角色", status: "Active", asset_type: "Image",
    volcano_asset_id: "upstream-1", source_url: "/api/sd-video/volcano/assets/registered-1/content?scope=personal",
  };

  it("loads real registered assets across pages/providers and inserts independent nodes with generation references", async () => {
    const listUserSeedanceAssets = vi.fn<CanvasAssetsMentionsServices["listUserSeedanceAssets"]>(async params => ({
      items: params?.provider_id ? [{ ...registered, id: "official-1", source_url: "https://cdn.example/actor.png" }]
        : params?.offset ? [{ ...registered, id: "registered-2", asset_type: "Video", volcano_asset_id: "upstream-2" }]
        : [registered], total: params?.provider_id ? 1 : 2,
    }));
    const services = createServices({ listUserSeedanceAssets });
    const harness = createHarness([], services);
    harness.controller.updateBindings({ ...harness.bindings, getSeedanceProviderIds: () => ["official", "official"] });
    harness.controller.setAssetPickerKind("registered");
    await vi.waitFor(() => expect(harness.controller.getSnapshot().picker.loading).toBe(false));
    const picker = harness.controller.getSnapshot().picker;
    expect(picker.items).toHaveLength(3);
    expect(listUserSeedanceAssets).toHaveBeenCalledTimes(3);
    expect(listUserSeedanceAssets).toHaveBeenNthCalledWith(2, expect.objectContaining({ scope: "personal", limit: 100, offset: 1 }), expect.any(AbortSignal));
    expect(services.getAssetLibrary).not.toHaveBeenCalled();
    expect(picker.thumbnails["registered::registered-1"]).toContain("/registered-1/thumbnail?scope=personal");
    picker.items.forEach(item => harness.controller.toggleAssetPickerItem(item.id));
    await harness.controller.insertAssetPickerSelection();
    expect(harness.nodes.map(node => node.kind)).toEqual(["image", "image", "video"]);
    expect(new Set(harness.nodes.map(node => node.id)).size).toBe(3);
    expect(harness.nodes[0].imageSrc).toContain("/registered-1/content?scope=personal");
    expect(harness.nodes[0].imageSrc).not.toMatch(/^blob:/);
    expect(harness.nodes[0].metadata?.assetId).toBeUndefined();
    expect(savedSeedanceRegistration(harness.nodes[0])).toMatchObject({ id: "registered-1", volcano_asset_id: "upstream-1" });
    expect(harness.nodes[1].metadata?.seedanceVolcanoAssets?.[0].providerId).toBe("official");
    const context = buildCanvasMentionGenerationContext("target", harness.nodes, [], `参考 @[node:${harness.nodes[0].id}] @[node:${harness.nodes[2].id}]`, [], "personal");
    expect(context.missingKeys).toEqual([]);
    expect(context.inputs).toHaveLength(2);
    expect(context.inputs[0].seedanceVolcanoAssets?.[0].volcanoAssetId).toBe("upstream-1");
    expect(context.inputs[1].seedanceVolcanoAssets?.[0].volcanoAssetId).toBe("upstream-2");
    expect(registered).not.toHaveProperty("provider_id");
  });

  it("shows pending/failed registrations but prevents inserting them or missing source files", async () => {
    const harness = createHarness([], createServices({ listUserSeedanceAssets: async () => ({ items: [
      { ...registered, id: "pending", status: "Processing", volcano_asset_id: "" },
      { ...registered, id: "failed", status: "Failed" },
      { ...registered, id: "missing", source_url: "" },
    ], total: 3 }) }));
    harness.controller.setAssetPickerKind("registered");
    await vi.waitFor(() => expect(harness.controller.getSnapshot().picker.loading).toBe(false));
    const items = harness.controller.getSnapshot().picker.items;
    expect(items.map(item => item.unavailableReason)).toEqual(["注册处理中", "注册失败", "素材源文件不可用"]);
    items.forEach(item => harness.controller.toggleAssetPickerItem(item.id));
    await harness.controller.insertAssetPickerSelection();
    expect(harness.controller.getSnapshot().picker.selectedIds).toEqual([]);
    expect(harness.nodes).toEqual([]);
  });

  it("searches the user workspace, ignores normal folders, refreshes registrations and reports failures", async () => {
    const listUserSeedanceAssets = vi.fn<CanvasAssetsMentionsServices["listUserSeedanceAssets"]>()
      .mockResolvedValueOnce({ items: [registered], total: 1 })
      .mockResolvedValueOnce({ items: [], total: 0 })
      .mockRejectedValueOnce(new Error("素材服务暂不可用"))
      .mockResolvedValueOnce({ items: [registered], total: 1 });
    const harness = createHarness([], createServices({ listUserSeedanceAssets }));
    harness.controller.setAssetPickerFolder("normal-folder");
    await vi.waitFor(() => expect(harness.controller.getSnapshot().picker.loading).toBe(false));
    harness.controller.setAssetPickerKind("registered");
    await vi.waitFor(() => expect(harness.controller.getSnapshot().picker.loading).toBe(false));
    expect(harness.controller.getSnapshot().picker.folderId).toBe("");
    harness.controller.setAssetPickerQuery(" 新角色 ");
    harness.controller.setAssetPickerScope("team");
    await vi.waitFor(() => expect(harness.controller.getSnapshot().picker.loading).toBe(false));
    expect(listUserSeedanceAssets).toHaveBeenLastCalledWith(expect.objectContaining({ scope: "team", search: "新角色" }), expect.any(AbortSignal));
    expect(harness.controller.getSnapshot().picker.items).toEqual([]);
    harness.controller.searchAssetPicker();
    await vi.waitFor(() => expect(harness.controller.getSnapshot().picker.error).toContain("素材服务暂不可用"));
    harness.controller.searchAssetPicker();
    await vi.waitFor(() => expect(harness.controller.getSnapshot().picker.items).toHaveLength(1));
    expect(harness.controller.getSnapshot().picker.error).toBe("");
  });

  it("aborts stale registered queries when changing category or closing the picker", async () => {
    let resolve!: (value: { items: SeedanceAsset[]; total: number }) => void;
    const listUserSeedanceAssets = vi.fn(() => new Promise<{ items: SeedanceAsset[]; total: number }>(done => { resolve = done; }));
    const services = createServices({ listUserSeedanceAssets });
    const harness = createHarness([], services);
    harness.controller.setAssetPickerKind("registered");
    harness.controller.setAssetPickerKind("image");
    await vi.waitFor(() => expect(harness.controller.getSnapshot().picker.loading).toBe(false));
    resolve({ items: [registered], total: 1 });
    await Promise.resolve();
    expect(harness.controller.getSnapshot().picker.items).toEqual([]);
    expect(listUserSeedanceAssets).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ aborted: true }));
    harness.controller.setAssetPickerKind("registered");
    harness.controller.cancelAssetPicker();
    resolve({ items: [registered], total: 1 });
    await Promise.resolve();
    expect(harness.controller.getSnapshot().picker.items).toEqual([]);
  });

  it("preserves usable provider records when another library fails", async () => {
    const harness = createHarness([], createServices({ listUserSeedanceAssets: async params => {
      if (!params?.provider_id) throw new Error("SD-video 暂不可用");
      return { items: [registered], total: 1 };
    } }));
    harness.controller.updateBindings({ ...harness.bindings, getSeedanceProviderIds: () => ["official"] });
    harness.controller.setAssetPickerKind("registered");
    await vi.waitFor(() => expect(harness.controller.getSnapshot().picker.loading).toBe(false));
    expect(harness.controller.getSnapshot().picker.items).toHaveLength(1);
    expect(harness.controller.getSnapshot().picker.error).toContain("部分拟真人素材库读取失败");
  });

  it("publishes all preview URLs immediately without queueing original downloads", () => {
    const services = createServices({ getAssetContentObjectUrl: vi.fn(() => new Promise(() => undefined)) });
    const image = { ...canvasNode("image"), imageAssetId: "image-original" };
    const video = { ...canvasNode("video"), kind: "video" as const, imageAssetId: "video-original" };
    const { controller } = createHarness([image, video], services);
    controller.syncNodePreviews({ projectId: "project-1", canonicalScope: "personal", fallbackScope: "personal" });
    expect(controller.getSnapshot().previews).toEqual({
      "image-original": "/api/assets/image-original/content?scope=personal&thumbnail=320",
      "video-original": "/api/assets/video-original/content?scope=personal",
    });
    expect(services.getAssetContentObjectUrl).not.toHaveBeenCalled();
    controller.syncNodePreviews({ projectId: "project-1", canonicalScope: "team", fallbackScope: "personal" });
    expect(controller.getSnapshot().previews["image-original"]).toContain("scope=team");
    controller.syncNodePreviews({ projectId: "project-2", canonicalScope: null, fallbackScope: "personal" });
    expect(controller.getSnapshot().previews).toEqual({});
    controller.dispose();
    expect(services.revokeObjectURL).not.toHaveBeenCalled();
  });
  it("shows automatic text in its own canvas other folder without flattening categories into the canvas root", async () => {
    const folders: AssetFolder[] = [...archiveFolders, {
      id: "other", parent_id: "mine", name: "其他", system_key: "canvas_category", source_ref_id: "project-1:other",
      kind: "system", asset_count: 0, descendant_asset_count: 0, sort_order: 0,
    }];
    const services = createServices({
      getAssetFolders: vi.fn(async () => folders),
      listCanvasTextAssets: vi.fn(async () => [
        { id: "auto", title: "未分类文本", content: "真实正文", scope: "personal", projectId: "project-1", category: "other", automatic: true, createdAt: "", updatedAt: "" },
        { id: "outside", title: "另一画布", content: "不应该出现", scope: "personal", projectId: "project-2", category: "other", automatic: true, createdAt: "", updatedAt: "" },
      ]),
    });
    const { controller } = createHarness([], services);
    await controller.loadMentionCatalog("", "personal", "folder:other");
    expect(controller.getSnapshot().mentionLibrary.assetIds).toEqual(["local-text:auto"]);
    expect(controller.getAssets().find(asset => asset.id === "local-text:auto")).toMatchObject({ folder_id: "other", text: "真实正文" });
    await controller.loadMentionCatalog("", "personal", "folder:mine");
    expect(services.getAssetLibrary).toHaveBeenLastCalledWith("personal", expect.objectContaining({ folderId: "mine", includeDescendants: undefined }), expect.anything());
    expect(controller.getSnapshot().mentionLibrary.assetIds).toEqual([]);
  });
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
    await vi.waitFor(() => {
      expect(harness.controller.getSnapshot().picker.thumbnails).toEqual({
        "server:asset-1": "/api/assets/asset-1/content?scope=personal&thumbnail=320",
      });
    });
    expect(services.getAssetMediaUrl).toHaveBeenCalledWith("asset-1", "personal", 320);
    expect(services.getAssetContentObjectUrl).not.toHaveBeenCalled();

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

  it("收藏夹视图按 smart_view 拉取且不含本地文本", async () => {
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
    const harness = createHarness([], createServices({
      getAssetLibrary: getAssetLibrary as CanvasAssetsMentionsServices["getAssetLibrary"],
      listCanvasTextAssets: listCanvasTextAssets as CanvasAssetsMentionsServices["listCanvasTextAssets"],
    }));

    harness.controller.openAssetPicker();
    await vi.waitFor(() => expect(harness.controller.getSnapshot().picker.loading).toBe(false));
    harness.controller.setAssetPickerKind("favorite");
    await vi.waitFor(() => expect(getAssetLibrary).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(harness.controller.getSnapshot().picker.loading).toBe(false));

    expect(getAssetLibrary).toHaveBeenLastCalledWith(
      "personal",
      expect.objectContaining({ smartView: "favorite", pageSize: 60 }),
      expect.anything(),
    );
    expect(harness.controller.getSnapshot().picker.items.map(item => item.id)).toEqual(["server:asset-1"]);
    expect(listCanvasTextAssets).toHaveBeenCalledTimes(1);
  });

  it("位置筛选把 folderId 传给资产库并列出文件夹选项", async () => {
    const getAssetLibrary = vi.fn(async () => ({
      items: [imageAsset],
      total: 1,
      page: 1,
      page_size: 60,
    }));
    const getAssetFolders = vi.fn(async () => [{
      id: "folder-role",
      parent_id: "",
      name: "角色",
      kind: "user" as const,
      asset_count: 2,
      descendant_asset_count: 2,
      sort_order: 0,
    }]);
    const harness = createHarness([], createServices({
      getAssetLibrary: getAssetLibrary as CanvasAssetsMentionsServices["getAssetLibrary"],
      getAssetFolders: getAssetFolders as CanvasAssetsMentionsServices["getAssetFolders"],
    }));

    harness.controller.openAssetPicker();
    await vi.waitFor(() => expect(harness.controller.getSnapshot().picker.loading).toBe(false));
    expect(harness.controller.getSnapshot().picker.folders).toEqual([
      { id: "folder-role", label: "角色" },
    ]);

    harness.controller.setAssetPickerFolder("folder-role");
    await vi.waitFor(() => expect(getAssetLibrary).toHaveBeenCalledTimes(2));
    expect(getAssetLibrary).toHaveBeenLastCalledWith(
      "personal",
      expect.objectContaining({
        folderId: "folder-role",
        includeDescendants: true,
      }),
      expect.anything(),
    );
  });

  it("节点预览保留空间鉴权，mention 详情独立释放 Object URL", async () => {
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
    expect(harness.controller.getSnapshot().previews).toEqual({ "asset-1": "/api/assets/asset-1/content?scope=personal&thumbnail=320" });
    expect(getAssetContentObjectUrl).not.toHaveBeenCalled();

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
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
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

  it("按真实文件夹加载 mention 资产目录，收藏使用当前用户的 smart_view", async () => {
    const getAssetLibrary = vi.fn(async () => ({ items: [], total: 0, page: 1, page_size: 100 }));
    const getAssetFolders = vi.fn(async () => [{ id: "roles", parent_id: "mine", name: "角色", kind: "system" as const, asset_count: 0, descendant_asset_count: 0, sort_order: 0 }]);
    const harness = createHarness([], createServices({ getAssetLibrary, getAssetFolders }));
    await harness.controller.loadMentionCatalog("", "personal", "folder:roles");
    expect(getAssetLibrary).toHaveBeenCalledWith(
      "personal",
      expect.objectContaining({ folderId: "roles", includeDescendants: undefined, pageSize: 100 }),
      expect.anything(),
    );
    await harness.controller.loadMentionCatalog("", "personal", "favorites");
    expect(getAssetLibrary).toHaveBeenLastCalledWith("personal", expect.objectContaining({ smartView: "favorite", folderId: undefined }), expect.anything());
    await harness.controller.loadMentionCatalog("街道", "personal", "folder:roles");
    expect(getAssetLibrary).toHaveBeenLastCalledWith("personal", expect.objectContaining({ folderId: "roles", keyword: "街道", includeDescendants: true }), expect.anything());
  });

  it("无效目录不请求资产列表，也不显示旧目录的资产", async () => {
    const getAssetLibrary = vi.fn(async () => ({ items: [imageAsset], total: 1, page: 1, page_size: 60 }));
    const harness = createHarness([], createServices({ getAssetLibrary }));
    await harness.controller.loadMentionCatalog();
    await harness.controller.loadMentionCatalog("", "personal", "folder:deleted");
    expect(getAssetLibrary).toHaveBeenCalledTimes(1);
    expect(harness.controller.getSnapshot().mentionLibrary).toMatchObject({ assetIds: [], loading: false, hasMore: false });
    expect(harness.controller.getSnapshot().mentionLibrary.error).toContain("文件夹");
    expect(harness.controller.getAssets()).toHaveLength(1);
  });

  it("日期归档素材直接从画布文件夹读取，跨日期分页和搜索不会丢失素材", async () => {
    const archivedAssets = [
      { ...imageAsset, id: "new-image", folder_id: "day-2", name: "新参考图" },
      { ...imageAsset, id: "old-image", folder_id: "day-1", name: "旧参考图" },
    ];
    const getAssetLibrary = vi.fn(async (_scope: "personal" | "team", query: AssetLibraryQuery = {}) => {
      const items = archivedAssets.filter(asset => (
        asset.folder_id === query.folderId
        || (query.includeDescendants && archiveFolders.some(folder => folder.id === asset.folder_id && folder.parent_id === query.folderId))
      ) && (!query.keyword || asset.name.includes(query.keyword)));
      const page = query.page || 1;
      return { items: items.slice(page - 1, page), total: items.length, page, page_size: 1 };
    });
    const harness = createHarness([], createServices({ getAssetLibrary, getAssetFolders: async () => archiveFolders }));
    await harness.controller.loadMentionCatalog("", "personal", "folder:mine");
    expect(harness.controller.getSnapshot().mentionLibrary).toMatchObject({ assetIds: ["new-image"], hasMore: true });
    await harness.controller.loadMentionCatalog("", "personal", "folder:mine", 2);
    expect(harness.controller.getSnapshot().mentionLibrary).toMatchObject({ assetIds: ["new-image", "old-image"], hasMore: false });
    expect(harness.controller.mentionReferencesForNode("target").map(ref => ref.assetId)).toEqual(["new-image", "old-image"]);
    await harness.controller.loadMentionCatalog("旧", "personal", "folder:mine");
    expect(harness.controller.getSnapshot().mentionLibrary).toMatchObject({ assetIds: ["old-image"], hasMore: false });
  });

  it("画布素材选择器同样省去日期层级并保留分类入口", async () => {
    const services = createServices({ getAssetFolders: async () => archiveFolders });
    const harness = createHarness([], services);
    harness.controller.openAssetPicker();
    await vi.waitFor(() => expect(harness.controller.getSnapshot().picker.loading).toBe(false));
    expect(harness.controller.getSnapshot().picker.folders).toEqual([
      { id: "mine", label: "当前画布" }, { id: "roles", label: "当前画布 / 角色" },
    ]);
    harness.controller.setAssetPickerFolder("mine");
    await vi.waitFor(() => expect(harness.controller.getSnapshot().picker.loading).toBe(false));
    expect(services.getAssetLibrary).toHaveBeenLastCalledWith("personal", expect.objectContaining({ folderId: "mine", includeDescendants: true }), expect.anything());
  });

  it("分类保存的文本在对应文件夹可被引用，生成时带入正文而不是虚假的媒体 ID", async () => {
    const services = createServices({
      getAssetFolders: async () => archiveFolders,
      listCanvasTextAssets: async () => [
        { id: "local", title: "角色背景", content: "主角是邮递员", folderId: "roles", scope: "personal", createdAt: "", updatedAt: "" },
        { id: "elsewhere", title: "其他画布", content: "不属于当前分类", folderId: "another-folder", scope: "personal", createdAt: "", updatedAt: "" },
      ],
    });
    const harness = createHarness([], services);
    await harness.controller.loadMentionCatalog("", "personal", "folder:roles");
    expect(harness.controller.getSnapshot().mentionLibrary.assetIds).toEqual(["local-text:local"]);
    const context = buildCanvasMentionGenerationContext("target", [], [], "参考 @[asset:local-text:local]", harness.controller.getAssets(), "personal");
    expect(context.prompt).toContain("主角是邮递员");
    expect(context.inputs[0]).toMatchObject({ type: "text", text: "主角是邮递员", assetId: undefined });
    expect(context.missingKeys).toEqual([]);
    harness.controller.setAssetPickerFolder("roles");
    await vi.waitFor(() => expect(harness.controller.getSnapshot().picker.loading).toBe(false));
    expect(harness.controller.getSnapshot().picker.items.map(item => item.name)).toEqual(["角色背景"]);
  });

  it("本地文本存储故障不会阻止服务端图片的读取", async () => {
    const services = createServices({
      getAssetFolders: async () => archiveFolders,
      getAssetLibrary: async () => ({ items: [imageAsset], total: 1, page: 1, page_size: 100 }),
      listCanvasTextAssets: async () => { throw new Error("browser storage unavailable"); },
    });
    const harness = createHarness([], services);
    await harness.controller.loadMentionCatalog("", "personal", "folder:roles");
    expect(harness.controller.getSnapshot().mentionLibrary).toMatchObject({ error: "", assetIds: ["asset-1"], loading: false });
  });

  it("延迟到达的旧查询不会覆盖收藏，分页追加且不截断收藏列表", async () => {
    let resolveOld!: (value: { items: Asset[]; total: number; page: number; page_size: number }) => void;
    const getAssetLibrary = vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ items: [imageAsset], total: 2, page: 1, page_size: 1 })
      .mockResolvedValueOnce({ items: [{ ...imageAsset, id: "asset-2" }], total: 2, page: 2, page_size: 1 });
    const harness = createHarness([], createServices({ getAssetLibrary }));
    const old = harness.controller.loadMentionCatalog("旧查询");
    await vi.waitFor(() => expect(getAssetLibrary).toHaveBeenCalledTimes(1));
    await harness.controller.loadMentionCatalog("", "personal", "favorites");
    expect(harness.controller.getSnapshot().mentionLibrary).toMatchObject({ target: "favorites", assetIds: ["asset-1"], hasMore: true });
    resolveOld({ items: [{ ...imageAsset, id: "old" }], total: 1, page: 1, page_size: 60 });
    await old;
    expect(harness.controller.getSnapshot().mentionLibrary.assetIds).toEqual(["asset-1"]);
    await harness.controller.loadMentionCatalog("", "personal", "favorites", 2);
    expect(harness.controller.getSnapshot().mentionLibrary).toMatchObject({ assetIds: ["asset-1", "asset-2"], hasMore: false, page: 2 });
    expect(harness.controller.getAssets().some(asset => asset.id === "old")).toBe(false);
  });
});
