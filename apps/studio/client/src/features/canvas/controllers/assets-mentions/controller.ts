import { publicApiError } from "@/shared/api/errors";
import {
  buildCanvasMentionReferences,
  type CanvasMentionAsset,
  type CanvasMentionReference,
} from "@/features/canvas/domain/mentions";
import { isHiddenCanvasBatchChild } from "@/features/canvas/domain/connections";
import { assetIdFromNode, imageSrcFromNode } from "@/features/canvas/domain/nodes";
import {
  isReadableMediaSource,
  mediaKindFromNode,
} from "@/features/canvas/domain/nodeUtils";
import { stringValue } from "@/features/canvas/domain/value";
import { workspaceScopeValue } from "@/features/canvas/domain/workspace";
import { browserCanvasAssetsMentionsServices } from "./browser-services";
import type {
  CanvasAssetPickerItem,
  CanvasAssetPickerKind,
  CanvasAssetsMentionsBindings,
  CanvasAssetsMentionsServices,
  CanvasAssetsMentionsSnapshot,
  CanvasPreviewSyncInput,
} from "./types";

const directExecutor: CanvasAssetsMentionsBindings["executeAssets"] = operation => operation();

const emptyBindings: CanvasAssetsMentionsBindings = {
  getUserId: () => "",
  getProjectId: () => "",
  getCanonicalScope: () => null,
  getFallbackScope: () => "personal",
  getMentionScope: () => "personal",
  getNodes: () => [],
  getEdges: () => [],
  setNodes: () => undefined,
  applyNodeSelection: () => undefined,
  getCanvasCenter: () => ({ x: 0, y: 0 }),
  setImagePreviewNodeId: () => undefined,
  toggleCanvasBatch: () => undefined,
  focusNodeInViewport: () => undefined,
  executeAssets: directExecutor,
  onSuccess: () => undefined,
  onError: () => undefined,
};

export class CanvasAssetsMentionsController {
  private bindings = emptyBindings;
  private snapshot: CanvasAssetsMentionsSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly previewCache = new Map<string, { assetId: string; url: string }>();
  private catalogAbort: AbortController | null = null;
  private pickerAbort: AbortController | null = null;
  private searchTimer: number | null = null;
  private mentionOwnedUrl = "";
  private previewRevision = 0;
  private mentionPreviewRevision = 0;
  private disposed = false;

  constructor(
    initialScope: "personal" | "team" = "personal",
    private readonly services: CanvasAssetsMentionsServices = browserCanvasAssetsMentionsServices,
  ) {
    this.snapshot = {
      assets: [],
      previews: {},
      picker: {
        open: false,
        insertBusy: false,
        scope: initialScope,
        loading: false,
        query: "",
        kind: "all",
        error: "",
        items: [],
        selectedIds: [],
      },
      mentionPreview: null,
    };
  }

  updateBindings(bindings: CanvasAssetsMentionsBindings) {
    this.bindings = bindings;
  }

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = () => this.snapshot;

  readonly getAssets = () => this.snapshot.assets;

  readonly mergeAssets = (items: import("@/entities/asset").Asset[], scope: "personal" | "team") => {
    if (!items.length) return;
    const byKey = new Map(this.snapshot.assets.map(asset => [`${asset.scope}:${asset.id}`, asset]));
    items.forEach(asset => byKey.set(`${scope}:${asset.id}`, { ...asset, scope }));
    this.patch({ assets: Array.from(byKey.values()) });
  };

  readonly loadMentionCatalog = async (keyword = "", targetScope = this.bindings.getMentionScope()) => {
    this.catalogAbort?.abort();
    const controller = new AbortController();
    this.catalogAbort = controller;
    try {
      const result = await this.assets(() => this.services.getAssetLibrary(targetScope, {
        keyword: keyword.trim() || undefined,
        page: 1,
        pageSize: 100,
        sort: "created_at_desc",
      }, controller.signal));
      if (!controller.signal.aborted) this.mergeAssets(result.items || [], targetScope);
    } catch (error) {
      if (!controller.signal.aborted) this.services.warn("读取画布引用资产失败", error);
    } finally {
      if (this.catalogAbort === controller) this.catalogAbort = null;
    }
  };

  readonly queueMentionAssetSearch = (query: string) => {
    if (this.searchTimer) this.services.cancelSchedule(this.searchTimer);
    this.searchTimer = this.services.schedule(() => {
      this.searchTimer = null;
      void this.loadMentionCatalog(query);
    }, 240);
  };

  readonly openAssetPicker = () => {
    const scope = this.bindings.getCanonicalScope() || this.bindings.getFallbackScope();
    this.patchPicker({
      open: true,
      scope,
      query: "",
      kind: "all",
      error: "",
      selectedIds: [],
    });
    void this.loadAssetPicker(scope, "", "all");
  };

  readonly setAssetPickerOpen = (open: boolean) => {
    if (!open && this.snapshot.picker.insertBusy) return;
    this.patchPicker({ open });
    if (!open) {
      this.pickerAbort?.abort();
      this.patchPicker({ selectedIds: [], error: "" });
    }
  };

  readonly cancelAssetPicker = () => {
    this.patchPicker({ open: false });
  };

  readonly setAssetPickerScope = (scope: "personal" | "team") => {
    this.patchPicker({ scope, selectedIds: [] });
    void this.loadAssetPicker(scope, this.snapshot.picker.query, this.snapshot.picker.kind);
  };

  readonly setAssetPickerKind = (kind: CanvasAssetPickerKind) => {
    this.patchPicker({ kind, selectedIds: [] });
    void this.loadAssetPicker(this.snapshot.picker.scope, this.snapshot.picker.query, kind);
  };

  readonly setAssetPickerQuery = (query: string) => {
    this.patchPicker({ query });
  };

  readonly searchAssetPicker = () => {
    const picker = this.snapshot.picker;
    void this.loadAssetPicker(picker.scope, picker.query, picker.kind);
  };

  readonly toggleAssetPickerItem = (itemId: string) => {
    const selectedIds = this.snapshot.picker.selectedIds;
    this.patchPicker({
      selectedIds: selectedIds.includes(itemId)
        ? selectedIds.filter(id => id !== itemId)
        : [...selectedIds, itemId],
    });
  };

  readonly insertAssetPickerSelection = async () => {
    const picker = this.snapshot.picker;
    if (picker.insertBusy || !picker.selectedIds.length) return;
    const activeScope = this.bindings.getCanonicalScope();
    if (!activeScope) return;
    const selected = picker.items.filter(asset => picker.selectedIds.includes(asset.id));
    if (!selected.length) return;
    const crossScopeText = selected.some(asset => asset.type === "text");
    if (
      picker.scope !== activeScope
      && !this.services.confirm(`将${picker.scope === "team" ? "团队" : "个人"}素材插入当前${activeScope === "team" ? "团队" : "个人"}画布。${crossScopeText ? "文本会复制内容，媒体仍引用原资产。" : "媒体会保留原资产引用。"}是否继续？`)
    ) return;
    this.patchPicker({ insertBusy: true });
    try {
      const center = this.bindings.getCanvasCenter();
      const created = selected.flatMap((item, index) => this.assetPickerNodes(item, index, center));
      if (!created.length) throw new Error("所选资产已失效，请刷新后重试");
      const next = [...this.bindings.getNodes(), ...created];
      this.bindings.setNodes(next);
      this.bindings.applyNodeSelection(created.map(node => node.id), created[0]?.id || "", created.length === 1);
      this.patchPicker({ open: false, selectedIds: [] });
      this.bindings.onSuccess(`已插入 ${created.length} 个资产节点`);
    } catch (error) {
      this.bindings.onError(publicApiError(error, "插入资产失败"));
    } finally {
      this.patchPicker({ insertBusy: false });
    }
  };

  readonly mentionReferencesForNode = (nodeId: string) => {
    const scope = this.bindings.getMentionScope();
    const assets = this.snapshot.assets.filter(asset => asset.scope === scope) as CanvasMentionAsset[];
    return buildCanvasMentionReferences(
      nodeId,
      this.bindings.getNodes(),
      this.bindings.getEdges(),
      assets,
      scope,
    );
  };

  readonly mentionThumbnailFor = (reference: CanvasMentionReference) => {
    if (reference.kind !== "image") return "";
    const node = reference.nodeId
      ? this.bindings.getNodes().find(item => item.id === reference.nodeId)
      : undefined;
    if (node) return imageSrcFromNode(node, this.snapshot.previews);
    return reference.assetId ? this.snapshot.previews[reference.assetId] || "" : "";
  };

  readonly previewMentionReference = (reference: CanvasMentionReference) => {
    const node = reference.nodeId
      ? this.bindings.getNodes().find(item => item.id === reference.nodeId)
      : undefined;
    if (node && node.kind === "image" && imageSrcFromNode(node, this.snapshot.previews)) {
      this.bindings.setImagePreviewNodeId(node.id);
      return;
    }
    const kind = reference.kind === "video" || reference.kind === "audio" ? reference.kind : "image";
    const directUrl = node
      ? imageSrcFromNode(node, this.snapshot.previews)
      : reference.content && isReadableMediaSource(reference.content) ? reference.content : "";
    if (directUrl) {
      this.patch({ mentionPreview: { url: directUrl, title: reference.title, kind } });
      return;
    }
    if (!reference.assetId) return;
    const revision = ++this.mentionPreviewRevision;
    const assetScope = reference.assetScope || this.bindings.getCanonicalScope() || "personal";
    void this.assets(() => this.services.getAssetContentObjectUrl(reference.assetId!, assetScope))
      .then(url => {
        if (this.disposed || revision !== this.mentionPreviewRevision) {
          this.services.revokeObjectURL(url);
          return;
        }
        this.releaseMentionOwnedUrl();
        this.mentionOwnedUrl = url;
        this.patch({ mentionPreview: { url, title: reference.title, kind } });
      })
      .catch(() => this.bindings.onError("读取素材内容失败"));
  };

  readonly closeMentionPreview = () => {
    this.mentionPreviewRevision += 1;
    this.patch({ mentionPreview: null });
    this.releaseMentionOwnedUrl();
  };

  readonly locateMentionReference = (reference: CanvasMentionReference) => {
    if (!reference.nodeId) return;
    const nodes = this.bindings.getNodes();
    const node = nodes.find(item => item.id === reference.nodeId);
    if (!node) return;
    const batchRootId = stringValue(node.metadata?.batchRootId);
    if (batchRootId && isHiddenCanvasBatchChild(node, nodes)) {
      const root = nodes.find(item => item.id === batchRootId);
      if (root && !root.metadata?.imageBatchExpanded) this.bindings.toggleCanvasBatch(batchRootId);
    }
    this.bindings.focusNodeInViewport(reference.nodeId);
  };

  readonly syncNodePreviews = async ({
    projectId,
    canonicalScope,
    fallbackScope,
  }: CanvasPreviewSyncInput) => {
    const revision = ++this.previewRevision;
    if (projectId && !canonicalScope) {
      this.releaseAllPreviewUrls();
      this.patchPreviews({});
      return;
    }
    const needed = new Map<string, {
      id: string;
      kind: "image" | "video" | "audio";
      scope: "personal" | "team";
    }>();
    for (const node of this.bindings.getNodes()) {
      const id = assetIdFromNode(node);
      if (!id) continue;
      const descriptor = {
        id,
        kind: mediaKindFromNode(node),
        scope: workspaceScopeValue(node.metadata?.assetScope) || canonicalScope || fallbackScope,
      };
      const key = `${descriptor.scope}:${descriptor.kind}:${id}`;
      if (!needed.has(key)) needed.set(key, descriptor);
    }
    this.previewCache.forEach((entry, key) => {
      if (needed.has(key)) return;
      this.services.revokeObjectURL(entry.url);
      this.previewCache.delete(key);
    });
    const syncPreviews = () => {
      const next: Record<string, string> = {};
      needed.forEach((descriptor, key) => {
        const entry = this.previewCache.get(key);
        if (entry) next[descriptor.id] = entry.url;
      });
      this.patchPreviews(next);
    };
    const missing = Array.from(needed.entries()).filter(([key]) => !this.previewCache.has(key));
    if (!missing.length) {
      syncPreviews();
      return;
    }
    const items = await Promise.all(missing.map(async ([key, descriptor]) => {
      try {
        const url = await this.assets(() => this.services.getAssetContentObjectUrl(
          descriptor.id,
          descriptor.scope,
          descriptor.kind === "image" ? 640 : undefined,
        ));
        return [key, descriptor.id, url] as const;
      } catch {
        return [key, descriptor.id, ""] as const;
      }
    }));
    if (this.disposed || revision !== this.previewRevision) {
      items.forEach(([, , url]) => { if (url) this.services.revokeObjectURL(url); });
      return;
    }
    items.forEach(([key, assetId, url]) => {
      if (url) this.previewCache.set(key, { assetId, url });
    });
    syncPreviews();
  };

  dispose() {
    this.disposed = true;
    this.previewRevision += 1;
    this.mentionPreviewRevision += 1;
    this.catalogAbort?.abort();
    this.pickerAbort?.abort();
    if (this.searchTimer) this.services.cancelSchedule(this.searchTimer);
    this.searchTimer = null;
    this.releaseAllPreviewUrls();
    this.releaseMentionOwnedUrl();
    this.listeners.clear();
    this.bindings = emptyBindings;
  }

  private async loadAssetPicker(
    scope: "personal" | "team",
    keyword: string,
    kind: CanvasAssetPickerKind,
  ) {
    this.pickerAbort?.abort();
    const controller = new AbortController();
    this.pickerAbort = controller;
    this.patchPicker({ loading: true, error: "" });
    try {
      const [serverResult, textResult] = await Promise.allSettled([
        kind === "text"
          ? Promise.resolve({ items: [] as import("@/entities/asset").Asset[] })
          : this.assets(() => this.services.getAssetLibrary(scope, {
            keyword: keyword.trim() || undefined,
            page: 1,
            pageSize: 60,
            sort: "created_at_desc",
          }, controller.signal)),
        this.bindings.getUserId()
          ? this.assets(() => this.services.listCanvasTextAssets(this.bindings.getUserId(), scope))
          : Promise.resolve([]),
      ]);
      if (controller.signal.aborted) return;
      const query = keyword.trim().toLowerCase();
      const serverAssets = serverResult.status === "fulfilled" ? serverResult.value.items || [] : [];
      const textAssets = textResult.status === "fulfilled" ? textResult.value : [];
      const mediaItems: CanvasAssetPickerItem[] = serverAssets
        .filter(asset => kind === "all" || asset.type === kind)
        .map(asset => ({
          id: `server:${asset.id}`,
          type: asset.type,
          name: asset.name || `资产 ${asset.id.slice(-8)}`,
          scope,
          source: "server",
          serverAsset: asset,
          category: asset.category,
          size: asset.size,
          contentType: asset.content_type,
        }));
      const localTextItems: CanvasAssetPickerItem[] = textAssets
        .filter(() => kind === "all" || kind === "text")
        .filter(asset => !query || `${asset.title} ${asset.content}`.toLowerCase().includes(query))
        .map(asset => ({
          id: `text:${asset.id}`,
          type: "text",
          name: asset.title,
          scope,
          source: "local-text",
          textAsset: asset,
        }));
      this.patchPicker({ items: [...localTextItems, ...mediaItems] });
      if (serverAssets.length) this.mergeAssets(serverAssets, scope);
      if (serverResult.status === "rejected") {
        this.patchPicker({
          error: textAssets.length
            ? "服务端媒体资产读取失败，本地文本资产仍可使用"
            : publicApiError(serverResult.reason, "读取资产库失败"),
        });
      } else if (textResult.status === "rejected") {
        this.patchPicker({ error: "本地文本资产读取失败，服务端媒体资产仍可使用" });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      this.patchPicker({ items: [], error: publicApiError(error, "读取资产库失败") });
    } finally {
      if (this.pickerAbort === controller) this.pickerAbort = null;
      if (!controller.signal.aborted) this.patchPicker({ loading: false });
    }
  }

  private assetPickerNodes(
    item: CanvasAssetPickerItem,
    index: number,
    center: { x: number; y: number },
  ): import("@/features/canvas/domain/types").CanvasNodeData[] {
    const position = {
      x: center.x + (index % 3) * 80 - 120,
      y: center.y + Math.floor(index / 3) * 70 - 80,
    };
    if (item.type === "text" && item.textAsset) {
      return [{
        id: this.services.createId(),
        kind: "text",
        title: item.name || "文本资产",
        content: item.textAsset.content,
        x: position.x,
        y: position.y,
        width: 320,
        height: 190,
        metadata: {
          content: item.textAsset.content,
          prompt: "",
          composerContent: "",
          generationMode: "text",
          status: "success",
          textAssetId: item.textAsset.id,
          textAssetScope: item.scope,
        },
      }];
    }
    const asset = item.serverAsset;
    if (!asset) return [];
    return [{
      id: this.services.createId(),
      kind: asset.type,
      title: item.name,
      content: "",
      x: position.x,
      y: position.y,
      width: asset.type === "video" ? 420 : 320,
      height: asset.type === "audio" ? 120 : asset.type === "video" ? 260 : 238,
      metadata: {
        assetId: asset.id,
        assetScope: item.scope,
        mimeType: item.contentType,
        bytes: item.size,
        generationMode: asset.type,
        status: "success",
        sourceNodeId: undefined,
      },
    }];
  }

  private patch(patch: Partial<CanvasAssetsMentionsSnapshot>) {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach(listener => listener());
  }

  private patchPicker(patch: Partial<CanvasAssetsMentionsSnapshot["picker"]>) {
    this.patch({ picker: { ...this.snapshot.picker, ...patch } });
  }

  private patchPreviews(previews: Record<string, string>) {
    const current = this.snapshot.previews;
    const currentKeys = Object.keys(current);
    const nextKeys = Object.keys(previews);
    if (
      currentKeys.length === nextKeys.length
      && nextKeys.every(assetId => current[assetId] === previews[assetId])
    ) return;
    this.patch({ previews });
  }

  private releaseAllPreviewUrls() {
    this.previewCache.forEach(entry => this.services.revokeObjectURL(entry.url));
    this.previewCache.clear();
  }

  private releaseMentionOwnedUrl() {
    if (!this.mentionOwnedUrl) return;
    this.services.revokeObjectURL(this.mentionOwnedUrl);
    this.mentionOwnedUrl = "";
  }

  private assets<Result>(operation: () => Promise<Result>) {
    return this.bindings.executeAssets(operation);
  }
}
