import { publicApiError } from "@/shared/api/errors";
import { seedanceAssetPreviewSource, seedanceAssetThumbnailSource, type Asset, type AssetFolder } from "@/entities/asset";
import { apiUrl } from "@/shared/api/http";
import { seedanceRegistrationSource } from "@/features/canvas/services/seedanceRegistration";
import type { CanvasNodeData } from "@/features/canvas/domain/types";
import { CANVAS_MENTION_PAGE_SIZE, CANVAS_MENTION_SEARCH_DELAY_MS, emptyCanvasMentionLibrary, mentionLibraryFolderId, type CanvasMentionLibraryTarget } from "@/features/canvas/domain/mentionLibrary";
import { canvasCategoryFolder, isCanvasDateArchiveFolder, visibleCanvasAssetFolders } from "@/features/canvas/domain/assetFolders";
import { collectFolderSubtreeIds, flattenFolderTree, folderPathLabel } from "@/features/assets";
import type { CanvasTextAsset } from "@/features/canvas/repositories/textAssetsRepository";
import {
  buildCanvasMentionReferences,
  type CanvasMentionAsset,
  type CanvasMentionReference,
} from "@/features/canvas/domain/mentions";
import { isHiddenCanvasBatchChild } from "@/features/canvas/domain/connections";
import { collectCanvasPreviewAssetRefs } from "@/features/canvas/domain/generationHistory";
import { imageSrcFromNode } from "@/features/canvas/domain/nodes";
import { isReadableMediaSource } from "@/features/canvas/domain/nodeUtils";
import { stringValue } from "@/features/canvas/domain/value";
import { workspaceScopeValue } from "@/features/canvas/domain/workspace";
import { browserCanvasAssetsMentionsServices } from "./browser-services";
import type {
  CanvasAssetPickerFolderOption,
  CanvasAssetPickerItem,
  CanvasAssetPickerKind,
  CanvasAssetsMentionsBindings,
  CanvasAssetsMentionsServices,
  CanvasAssetsMentionsSnapshot,
  CanvasPreviewSyncInput,
} from "./types";
import type { AssetNameSyncMessage } from "@/entities/asset";
import { ASSET_TYPE_LIBRARY_SORT, compareAssetTypes } from "@/entities/asset/typeOrder";

const PICKER_THUMBNAIL_WIDTH = 320 as const;
// Canvas nodes only need a lightweight preview; full-size files load in the detail dialog.
const CANVAS_THUMBNAIL_WIDTH = 320 as const;
// Local text references must never collide with server media IDs.
const LOCAL_TEXT_MENTION_PREFIX = "local-text:";
// Registered libraries are paged independently for each provider, without truncating at the first page.
const REGISTERED_ASSET_PAGE_SIZE = 100;

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
  private catalogAbort: AbortController | null = null;
  private pickerAbort: AbortController | null = null;
  private searchTimer: number | null = null;
  private mentionOwnedUrl = "";
  private mentionPreviewRevision = 0;
  private disposed = false;
  // Confirmed rename events win over library requests started before the edit.
  private readonly savedNames = new Map<string, string>();

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
        folderId: "",
        folders: [],
        error: "",
        items: [],
        selectedIds: [],
        thumbnails: {},
      },
      mentionPreview: null,
      mentionLibrary: emptyCanvasMentionLibrary("", initialScope),
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

  readonly applyAssetNameChange = (message: AssetNameSyncMessage) => {
    if (this.disposed) return;
    this.savedNames.set(`${message.scope}:${message.assetId}`, message.name);
    this.patch({
      assets: this.snapshot.assets.map(asset => asset.scope === message.scope && asset.id === message.assetId
        ? { ...asset, name: message.name } : asset),
      picker: { ...this.snapshot.picker, items: this.snapshot.picker.items.map(item => {
        const id = item.serverAsset?.id || (item.textAsset ? LOCAL_TEXT_MENTION_PREFIX + item.textAsset.id : "");
        return item.scope === message.scope && id === message.assetId ? { ...item, name: message.name,
          ...(item.serverAsset ? { serverAsset: { ...item.serverAsset, name: message.name } } : {}),
          ...(item.textAsset ? { textAsset: { ...item.textAsset, title: message.name } } : {}),
        } : item;
      }) },
    });
  };

  private savedName(id: string, scope: "personal" | "team", name: string) {
    return this.savedNames.get(`${scope}:${id}`) || name;
  }

  readonly mergeAssets = (items: import("@/entities/asset").Asset[], scope: "personal" | "team") => {
    if (!items.length) return;
    const byKey = new Map(this.snapshot.assets.map(asset => [`${asset.scope}:${asset.id}`, asset]));
    items.forEach(asset => byKey.set(`${scope}:${asset.id}`, { ...asset, name: this.savedName(asset.id, scope, asset.name), scope }));
    this.patch({ assets: Array.from(byKey.values()) });
  };

  readonly loadMentionCatalog = async (
    keyword = "",
    targetScope = this.bindings.getMentionScope(),
    target: CanvasMentionLibraryTarget = "root",
    page = 1,
  ) => {
    if (this.searchTimer) this.services.cancelSchedule(this.searchTimer);
    this.searchTimer = null;
    this.catalogAbort?.abort();
    const controller = new AbortController();
    this.catalogAbort = controller;
    const projectId = this.bindings.getProjectId();
    const previous = this.snapshot.mentionLibrary;
    const sameContext = previous.projectId === projectId && previous.scope === targetScope;
    const append = page > 1 && sameContext && previous.target === target && previous.query === keyword.trim();
    const current = () => !this.disposed && !controller.signal.aborted && this.catalogAbort === controller
      && this.bindings.getProjectId() === projectId && this.bindings.getMentionScope() === targetScope;
    this.patch({ mentionLibrary: {
      ...emptyCanvasMentionLibrary(projectId, targetScope), folders: sameContext ? previous.folders : [],
      target, query: keyword.trim(), loading: true, assetIds: append ? previous.assetIds : [],
      page: append ? previous.page : 0,
    } });
    try {
      const folders = await this.assets(() => this.services.getAssetFolders(targetScope, controller.signal));
      if (!current()) return;
      this.patch({ mentionLibrary: { ...this.snapshot.mentionLibrary, folders } });
      const folderId = mentionLibraryFolderId(target);
      if (folderId !== undefined && !folders.some(folder => folder.id === folderId)) {
        throw new Error("此文件夹已不存在，请返回上一级重新选择");
      }
      // Query the whole folder in one paginated request so hidden date buckets
      // remain accessible, ordered consistently and searchable from their parent.
      const includeDescendants = Boolean(folderId && (keyword.trim()
        || (folders.some(folder => folder.parent_id === folderId && isCanvasDateArchiveFolder(folder))
          && !folders.some(folder => folder.parent_id === folderId && folder.system_key === "canvas_category" && folder.source_ref_id?.endsWith(":other")))));
      const [result, storedTextAssets] = await Promise.all([this.assets(() => this.services.getAssetLibrary(targetScope, {
        keyword: keyword.trim() || undefined,
        folderId,
        includeDescendants: includeDescendants || undefined,
        smartView: target === "favorites" ? "favorite" : undefined,
        page,
        pageSize: CANVAS_MENTION_PAGE_SIZE,
        sort: ASSET_TYPE_LIBRARY_SORT,
      }, controller.signal)), this.bindings.getUserId()
        ? this.assets(() => this.services.listCanvasTextAssets(this.bindings.getUserId(), targetScope)).catch((error): CanvasTextAsset[] => {
          // A browser storage failure must not hide the server's media library
          // or discard text references already loaded during this session.
          this.services.warn("读取本地文本素材失败", error);
          return this.snapshot.assets.filter(asset => asset.type === "text" && asset.scope === targetScope).map(asset => ({
            id: asset.id.slice(LOCAL_TEXT_MENTION_PREFIX.length), title: asset.name, content: asset.text || "",
            scope: targetScope, folderId: asset.folder_id, createdAt: asset.created_at || "", updatedAt: "",
          }));
        })
        : Promise.resolve([])]);
      if (!current()) return;
      const textAssets = resolveTextAssetFolders(storedTextAssets, folders).map(asset => ({ ...asset,
        title: this.savedName(LOCAL_TEXT_MENTION_PREFIX + asset.id, targetScope, asset.title) }));
      this.mergeAssets(result.items || [], targetScope);
      this.patch({ assets: [
        ...this.snapshot.assets.filter(asset => asset.scope !== targetScope || asset.type !== "text"),
        ...textAssets.map(asset => ({ id: LOCAL_TEXT_MENTION_PREFIX + asset.id, name: asset.title, type: "text" as const,
          text: asset.content, folder_id: asset.folderId, category: asset.category, scope: targetScope, created_at: asset.createdAt })),
      ] });
      const matchingText = target === "favorites" ? [] : filterTextAssets(textAssets, keyword, folderId || "", folders, includeDescendants);
      const assetIds = [...new Set([...(append ? previous.assetIds : []), ...matchingText.map(asset => LOCAL_TEXT_MENTION_PREFIX + asset.id), ...(result.items || []).map(asset => asset.id)])];
      this.patch({ mentionLibrary: { ...this.snapshot.mentionLibrary, assetIds, page, hasMore: page * (result.page_size || CANVAS_MENTION_PAGE_SIZE) < result.total } });
    } catch (error) {
      if (current()) {
        this.patch({ mentionLibrary: { ...this.snapshot.mentionLibrary, error: publicApiError(error, "读取引用素材失败，请重试") } });
      }
    } finally {
      if (current()) this.patch({ mentionLibrary: { ...this.snapshot.mentionLibrary, loading: false } });
      if (this.catalogAbort === controller) this.catalogAbort = null;
    }
  };

  readonly queueMentionAssetSearch = (query: string, target: CanvasMentionLibraryTarget = "root", loadMore = false) => {
    if (this.searchTimer) this.services.cancelSchedule(this.searchTimer);
    this.searchTimer = null;
    this.catalogAbort?.abort();
    const previous = this.snapshot.mentionLibrary;
    if (loadMore || target !== previous.target || !query.trim()) {
      void this.loadMentionCatalog(query, this.bindings.getMentionScope(), target, loadMore ? previous.page + 1 : 1);
      return;
    }
    this.patch({ mentionLibrary: { ...previous, target, query: query.trim(), assetIds: [], loading: true, error: "", hasMore: false } });
    this.searchTimer = this.services.schedule(() => {
      this.searchTimer = null;
      void this.loadMentionCatalog(query, this.bindings.getMentionScope(), target);
    }, CANVAS_MENTION_SEARCH_DELAY_MS);
  };

  readonly openAssetPicker = () => {
    const scope = this.bindings.getCanonicalScope() || this.bindings.getFallbackScope();
    this.patchPicker({
      open: true,
      scope,
      query: "",
      kind: "all",
      folderId: "",
      error: "",
      selectedIds: [],
    });
    void this.loadAssetPicker(scope, "", "all", "");
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
    this.setAssetPickerOpen(false);
  };

  readonly setAssetPickerScope = (scope: "personal" | "team") => {
    this.patchPicker({ scope, selectedIds: [], folderId: "", folders: [] });
    void this.loadAssetPicker(scope, this.snapshot.picker.query, this.snapshot.picker.kind, "");
  };

  readonly setAssetPickerKind = (kind: CanvasAssetPickerKind) => {
    this.patchPicker({ kind, selectedIds: [], ...(kind === "registered" ? { folderId: "" } : {}) });
    void this.loadAssetPicker(this.snapshot.picker.scope, this.snapshot.picker.query, kind);
  };

  readonly setAssetPickerFolder = (folderId: string) => {
    this.patchPicker({ folderId, selectedIds: [] });
    void this.loadAssetPicker(this.snapshot.picker.scope, this.snapshot.picker.query, this.snapshot.picker.kind, folderId);
  };

  readonly setAssetPickerQuery = (query: string) => {
    this.patchPicker({ query });
  };

  readonly searchAssetPicker = () => {
    const picker = this.snapshot.picker;
    void this.loadAssetPicker(picker.scope, picker.query, picker.kind, picker.folderId);
  };

  readonly toggleAssetPickerItem = (itemId: string) => {
    if (this.snapshot.picker.loading || !this.snapshot.picker.items.some(item => item.id === itemId && !item.unavailableReason)) return;
    const selectedIds = this.snapshot.picker.selectedIds;
    this.patchPicker({
      selectedIds: selectedIds.includes(itemId)
        ? selectedIds.filter(id => id !== itemId)
        : [...selectedIds, itemId],
    });
  };

  readonly insertAssetPickerSelection = async () => {
    const picker = this.snapshot.picker;
    if (picker.loading || picker.insertBusy || !picker.selectedIds.length) return;
    const activeScope = this.bindings.getCanonicalScope();
    if (!activeScope) return;
    const selected = picker.items.filter(asset => picker.selectedIds.includes(asset.id) && !asset.unavailableReason);
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

  readonly syncNodePreviews = ({ projectId, canonicalScope, fallbackScope }: CanvasPreviewSyncInput) => {
    if (this.disposed) return;
    const previews: Record<string, string> = {};
    if (!projectId || canonicalScope) {
      for (const ref of collectCanvasPreviewAssetRefs(this.bindings.getNodes())) {
        const scope = workspaceScopeValue(ref.scope) || canonicalScope || fallbackScope;
        // Publish URLs immediately. Native images load independently; videos use
        // Range on playback instead of downloading full files on canvas restore.
        previews[ref.id] = this.services.getAssetMediaUrl(ref.id, scope, ref.kind === "image" ? CANVAS_THUMBNAIL_WIDTH : undefined);
      }
    }
    this.patchPreviews(previews);
  };

  dispose() {
    this.disposed = true;
    this.mentionPreviewRevision += 1;
    this.catalogAbort?.abort();
    this.pickerAbort?.abort();
    if (this.searchTimer) this.services.cancelSchedule(this.searchTimer);
    this.searchTimer = null;
    this.releaseMentionOwnedUrl();
    this.listeners.clear();
    this.savedNames.clear();
    this.bindings = emptyBindings;
  }

  private async loadAssetPicker(
    scope: "personal" | "team",
    keyword: string,
    kind: CanvasAssetPickerKind,
    folderId = this.snapshot.picker.folderId,
  ) {
    this.pickerAbort?.abort();
    const controller = new AbortController();
    this.pickerAbort = controller;
    this.patchPicker({ loading: true, error: "", items: [], thumbnails: {}, selectedIds: [] });
    const includeLocalText = kind === "all" || kind === "text";
    const mediaKind = kind === "image" || kind === "video" || kind === "audio" ? kind : undefined;
    try {
      if (kind === "registered") {
        await this.loadRegisteredPicker(scope, keyword, controller.signal);
        return;
      }
      const [serverResult, textResult, foldersResult] = await Promise.allSettled([
        kind === "text"
          ? Promise.resolve({ items: [] as Asset[] })
          : this.assets(() => this.services.getAssetLibrary(scope, {
            keyword: keyword.trim() || undefined,
            type: mediaKind,
            smartView: kind === "favorite" ? "favorite" : undefined,
            folderId: folderId || undefined,
            includeDescendants: folderId ? true : undefined,
            page: 1,
            pageSize: 60,
            sort: ASSET_TYPE_LIBRARY_SORT,
          }, controller.signal)),
        includeLocalText && this.bindings.getUserId()
          ? this.assets(() => this.services.listCanvasTextAssets(this.bindings.getUserId(), scope))
          : Promise.resolve([]),
        this.assets(() => this.services.getAssetFolders(scope)),
      ]);
      if (controller.signal.aborted) return;
      const query = keyword.trim().toLowerCase();
      const serverAssets = (serverResult.status === "fulfilled" ? serverResult.value.items || [] : []).map(asset => ({ ...asset,
        name: this.savedName(asset.id, scope, asset.name) }));
      const textAssets = resolveTextAssetFolders(textResult.status === "fulfilled" ? textResult.value : [], foldersResult.status === "fulfilled" ? foldersResult.value : []).map(asset => ({ ...asset,
        title: this.savedName(LOCAL_TEXT_MENTION_PREFIX + asset.id, scope, asset.title) }));
      const folderPatch = foldersResult.status === "fulfilled"
        ? { folders: pickerFolderOptions(foldersResult.value) }
        : this.snapshot.picker.folders.length
          ? {}
          : { folders: [] as CanvasAssetPickerFolderOption[] };
      const mediaItems: CanvasAssetPickerItem[] = serverAssets
        .filter(asset => !mediaKind || asset.type === mediaKind)
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
      const localTextItems: CanvasAssetPickerItem[] = includeLocalText
        ? filterTextAssets(textAssets, query, folderId, foldersResult.status === "fulfilled" ? foldersResult.value : [], true)
          .map(asset => ({
            id: `text:${asset.id}`,
            type: "text" as const,
            name: asset.title,
            scope,
            source: "local-text" as const,
            textAsset: asset,
          }))
        : [];
      const items = [...localTextItems, ...mediaItems].sort((left, right) => compareAssetTypes(left.type, right.type));
      this.patchPicker({
        items,
        thumbnails: this.pickerThumbnails(items, scope),
        ...folderPatch,
      });
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
      this.patchPicker({ items: [], thumbnails: {}, error: publicApiError(error, "读取资产库失败") });
    } finally {
      if (this.pickerAbort === controller) this.pickerAbort = null;
      if (!controller.signal.aborted) this.patchPicker({ loading: false });
    }
  }

  private async loadRegisteredPicker(scope: "personal" | "team", keyword: string, signal: AbortSignal) {
    // Use the same authenticated user routes as canvas registration, never the admin library.
    const providers = new Set(["", ...(this.bindings.getSeedanceProviderIds?.() || []),
      ...this.bindings.getNodes().flatMap(node => (node.metadata?.seedanceVolcanoAssets || []).map(asset => asset.providerId || ""))]);
    const items = new Map<string, CanvasAssetPickerItem>();
    const errors: string[] = [];
    for (const providerId of providers) {
      let offset = 0;
      try {
        while (!signal.aborted) {
          const result = await this.assets(() => this.services.listUserSeedanceAssets({
            scope, provider_id: providerId || undefined, search: keyword.trim() || undefined,
            limit: REGISTERED_ASSET_PAGE_SIZE, offset,
          }, signal));
          if (signal.aborted) return;
          const rows = result.items || [];
          let added = 0;
          for (const asset of rows) {
            const id = `registered:${providerId}:${asset.id}`;
            if (items.has(id)) continue;
            added += 1;
            const status = asset.status.toLowerCase();
            const unavailableReason = ["failed", "error", "rejected"].includes(status) ? "注册失败"
              : status !== "active" || !asset.volcano_asset_id ? "注册处理中"
              : !seedanceAssetPreviewSource(asset.source_url) ? "素材源文件不可用" : undefined;
            items.set(id, {
              id, type: asset.asset_type.toLowerCase() === "video" ? "video" : "image",
              name: asset.name || asset.volcano_asset_id || asset.id, scope, source: "registered",
              registeredAsset: { ...asset, provider_id: providerId || undefined }, unavailableReason,
              contentType: asset.content_type, size: asset.size,
            });
          }
          offset += rows.length;
          if (!rows.length || !added || offset >= result.total) break;
        }
      } catch (error) {
        if (signal.aborted) return;
        errors.push(publicApiError(error, "读取拟真人素材失败"));
      }
    }
    if (signal.aborted) return;
    const assets = [...items.values()].sort((left, right) => compareAssetTypes(left.type, right.type));
    this.patchPicker({ items: assets, thumbnails: this.pickerThumbnails(assets, scope),
      error: errors.length ? `${assets.length ? "部分拟真人素材库读取失败：" : ""}${[...new Set(errors)].join("；")}` : "" });
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
    if (item.registeredAsset) {
      const asset = item.registeredAsset;
      const source = seedanceAssetPreviewSource(asset.source_url);
      if (item.unavailableReason || !source) return [];
      const node: CanvasNodeData = {
        id: this.services.createId(), kind: item.type, title: item.name, content: "", ...position,
        width: item.type === "video" ? 420 : 320, height: item.type === "video" ? 260 : 238,
        imageSrc: source.startsWith("/api/") ? apiUrl(source) : source,
        metadata: {
          assetScope: item.scope, mimeType: item.contentType, bytes: item.size,
          generationMode: item.type, status: "success", canvasOrigin: "imported",
          seedanceVolcanoAssets: [{ id: asset.id, providerId: asset.provider_id,
            volcanoAssetId: asset.volcano_asset_id, name: asset.name, status: asset.status, assetType: asset.asset_type }],
        },
      };
      node.metadata!.seedanceRegistrationSource = seedanceRegistrationSource(node);
      return [node];
    }
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
          canvasOrigin: "imported",
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
        canvasOrigin: "imported",
      },
    }];
  }

  private pickerThumbnails(items: CanvasAssetPickerItem[], scope: "personal" | "team") {
    const thumbnails: Record<string, string> = {};
    items.forEach(item => {
      if (item.registeredAsset) {
        thumbnails[item.id] = seedanceAssetThumbnailSource(item.registeredAsset.source_url, item.registeredAsset.asset_type);
        return;
      }
      const assetId = item.serverAsset?.id;
      if (item.type === "image" && assetId) {
        thumbnails[item.id] = this.services.getAssetMediaUrl(assetId, scope, PICKER_THUMBNAIL_WIDTH);
      }
    });
    return thumbnails;
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

  private releaseMentionOwnedUrl() {
    if (!this.mentionOwnedUrl) return;
    this.services.revokeObjectURL(this.mentionOwnedUrl);
    this.mentionOwnedUrl = "";
  }

  private assets<Result>(operation: () => Promise<Result>) {
    return this.bindings.executeAssets(operation);
  }
}

function pickerFolderOptions(folders: AssetFolder[]): CanvasAssetPickerFolderOption[] {
  const visibleFolders = visibleCanvasAssetFolders(folders);
  return flattenFolderTree(visibleFolders).map(({ folder }) => ({
    id: folder.id,
    label: folderPathLabel(visibleFolders, folder.id),
  }));
}

function resolveTextAssetFolders(assets: CanvasTextAsset[], folders: AssetFolder[]) {
  return assets.map(asset => asset.folderId || !asset.projectId ? asset : {
    ...asset, folderId: canvasCategoryFolder(folders, asset.projectId, asset.category || "other")?.id,
  });
}

function filterTextAssets(assets: CanvasTextAsset[], keyword: string, folderId: string, folders: AssetFolder[], includeDescendants: boolean) {
  const folderIds = includeDescendants ? collectFolderSubtreeIds(folders, folderId) : new Set([folderId]);
  const query = keyword.trim().toLowerCase();
  return assets.filter(asset => (!folderId || folderIds.has(asset.folderId || ""))
    && (!query || `${asset.title} ${asset.content}`.toLowerCase().includes(query)));
}
