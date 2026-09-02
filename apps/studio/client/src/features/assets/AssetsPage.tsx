import {
  Archive,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  FolderInput,
  FolderOpen,
  Image as ImageIcon,
  Layers3,
  Loader2,
  Music2,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  Video,
  WandSparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

import {
  bulkMoveAssets,
  bulkUpdateAssetTags,
  bindAssetTags,
  cancelAssetExport,
  createAssetExport,
  createAssetFolder,
  deleteAssetFolder,
  downloadAssetExport,
  emptyAssetTrash,
  getAssetContentObjectUrl,
  permanentDeleteAsset,
  preflightAssetTrash,
  restoreAssets,
  removeAssetTag,
  resyncAssetInheritedTags,
  trashAssets,
  updateAssetFolder,
  updateAssetMetadata,
  updateAssetUserState,
  uploadAsset,
  type Asset,
  type AssetCategory,
  type AssetFolder,
  type AssetSourceType,
} from "@/entities/asset";
import {
  createProject,
  getProjectSnapshot,
  saveProjectSnapshot,
  type CanvasProject,
} from "@/entities/project";
import {
  type AssetTagDetail,
  type SemanticTag,
} from "@/entities/tag";
import SeedanceAssetPanel from "@/components/SeedanceAssetPanel";
import { semanticTagPath } from "@/features/tags";
import { publicApiError } from "@/shared/api/errors";
import type { WorkspaceScope } from "@/shared/config";

import {
  assetPackageUploadMetadata,
  createAssetPackage,
  readAssetPackage,
} from "./model/assetPackage";
import {
  collectFolderSubtreeIds,
  flattenFolderTree,
  folderPathLabel,
} from "./model/folderTree";
import {
  useAssetExportsQuery,
  useAssetLibraryPageQuery,
  useAssetLineageQuery,
  useAssetOverviewQuery,
  useAssetProjectOptionsQuery,
  useAssetTagDetailsQuery,
  useAssetUsageQuery,
} from "./model/queries";
import "./styles.css";

type Option<T extends string> = { value: T; label: string };
type SmartView = "all" | "favorite" | "dislike" | "unused" | "frequent" | "seedance" | "trash";

const scopeOptions: Array<Option<WorkspaceScope>> = [
  { value: "personal", label: "个人空间" },
  { value: "team", label: "团队空间" },
];

const assetCategoryOptions: Array<Option<AssetCategory | "">> = [
  { value: "", label: "全部分类" },
  { value: "character", label: "人物" },
  { value: "environment", label: "场景" },
  { value: "costume", label: "服饰" },
  { value: "prop", label: "道具" },
  { value: "ui", label: "UI" },
  { value: "reference", label: "参考" },
  { value: "other", label: "其他" },
];

const sourceTypeOptions: Array<Option<AssetSourceType | "">> = [
  { value: "", label: "全部来源" },
  { value: "manual_upload", label: "手动上传" },
  { value: "image_workbench", label: "生图工作台" },
  { value: "canvas", label: "画布" },
  { value: "comic_batch", label: "漫剧批量" },
  { value: "legacy", label: "历史导入" },
  { value: "unknown", label: "未知" },
];

const smartViews: Array<{ value: SmartView; label: string }> = [
  { value: "all", label: "全部资产" },
  { value: "favorite", label: "已收藏" },
  { value: "dislike", label: "已踩" },
  { value: "unused", label: "未使用" },
  { value: "frequent", label: "高频调用" },
  { value: "seedance", label: "真人素材" },
  { value: "trash", label: "回收站" },
];

function initialScopeFromSearch(): WorkspaceScope {
  return new URLSearchParams(window.location.search).get("scope") === "team" ? "team" : "personal";
}

function canvasProjectHref(projectId: string, scope: WorkspaceScope) {
  return `/canvas/${encodeURIComponent(projectId)}?scope=${encodeURIComponent(scope)}`;
}

function SurfaceTitle({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="feature-title"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{actions}</div>;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function tagChildren(tags: SemanticTag[], parentId: string) {
  return tags.filter((tag) => tag.parent_id === parentId);
}

function formatStatus(status?: string) {
  return ({
    queued: "排队中",
    running: "执行中",
    succeeded: "已完成",
    partial_failed: "部分失败",
    failed: "失败",
    canceled: "已取消",
    expired: "已过期",
  } as Record<string, string>)[status || ""] || status || "—";
}

export function AssetLibraryView() {
  const [, navigate] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const deepLinkAssetRef = useRef<string>(new URLSearchParams(window.location.search).get("asset") || "");
  const [scope, setScope] = useState<WorkspaceScope>(() => initialScopeFromSearch());
  const [assets, setAssets] = useState<Asset[]>([]);
  const [folders, setFolders] = useState<AssetFolder[]>([]);
  const [tags, setTags] = useState<SemanticTag[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [smartView, setSmartView] = useState<SmartView>("all");
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [activeFolderId, setActiveFolderId] = useState("");
  const [moveFolderId, setMoveFolderId] = useState("");
  const [category, setCategory] = useState<AssetCategory | "">("");
  const [sourceType, setSourceType] = useState<AssetSourceType | "">("");
  const [assetType, setAssetType] = useState<Asset["type"] | "">("");
  const [sortOrder, setSortOrder] = useState<"created_at_desc" | "created_at_asc" | "name_asc" | "name_desc">("created_at_desc");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(() => {
    const tag = new URLSearchParams(window.location.search).get("tag");
    return tag ? [tag] : [];
  });
  const [uploadTagIds, setUploadTagIds] = useState<string[]>([]);
  const [uploadCategory, setUploadCategory] = useState<AssetCategory | "">("other");
  const [tagMatch, setTagMatch] = useState<"and" | "or">("and");
  const [showAllFilterTags, setShowAllFilterTags] = useState(false);
  const [showAllUploadTags, setShowAllUploadTags] = useState(false);
  const [detailTab, setDetailTab] = useState("详情");
  const [sendPanelOpen, setSendPanelOpen] = useState(false);
  const [sendProjectId, setSendProjectId] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [exportBusy, setExportBusy] = useState("");
  const [packageBusy, setPackageBusy] = useState("");
  const packageInputRef = useRef<HTMLInputElement>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [detailName, setDetailName] = useState("");
  const [detailCategory, setDetailCategory] = useState<AssetCategory | "">("");
  const [detailMediaUrl, setDetailMediaUrl] = useState("");
  const [folderMoveFor, setFolderMoveFor] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const selected = assets.find((asset) => asset.id === selectedId) || assets[0];
  const selectedIdsFromUi = selectedIds.length ? selectedIds : selected ? [selected.id] : [];
  const roots = tags.filter((tag) => !tag.parent_id || !tags.some((parent) => parent.id === tag.parent_id));
  const activeFolder = folders.find((folder) => folder.id === activeFolderId);
  const filterRoots = showAllFilterTags ? roots : roots.slice(0, 8);
  const uploadTags = showAllUploadTags ? tags : tags.slice(0, 24);
  const folderRows = useMemo(() => flattenFolderTree(folders), [folders]);
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("ai-manju:asset-folder-collapsed") || "[]");
      return Array.isArray(saved) ? saved.filter((item) => typeof item === "string") : [];
    } catch {
      return [];
    }
  });
  const collapsedFolderSet = useMemo(() => new Set(collapsedFolderIds), [collapsedFolderIds]);
  const visibleFolderRows = useMemo(
    () => folderRows.filter((row) => !row.ancestorIds.some((id) => collapsedFolderSet.has(id))),
    [folderRows, collapsedFolderSet],
  );
  const toggleFolderCollapsed = (folderId: string) => {
    setCollapsedFolderIds((current) => {
      const next = current.includes(folderId) ? current.filter((item) => item !== folderId) : [...current, folderId];
      try {
        localStorage.setItem("ai-manju:asset-folder-collapsed", JSON.stringify(next));
      } catch {
        /* localStorage 不可用时静默降级为会话内状态 */
      }
      return next;
    });
  };
  const folderSubtreeForMove = useMemo(() => folderMoveFor ? collectFolderSubtreeIds(folders, folderMoveFor) : new Set<string>(), [folderMoveFor, folders]);

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);
  const smartViewQuery = (smartView === "all" || smartView === "trash" || smartView === "seedance" ? "" : smartView) as "" | "favorite" | "dislike" | "unused" | "frequent";
  const query = useMemo(() => ({
    keyword: debouncedKeyword.trim() || undefined,
    smartView: smartViewQuery,
    folderId: activeFolderId || undefined,
    includeDescendants: true,
    category,
    sourceType,
    type: assetType,
    createdFrom: createdFrom ? new Date(`${createdFrom}T00:00:00`).toISOString() : undefined,
    createdTo: createdTo ? new Date(`${createdTo}T23:59:59`).toISOString() : undefined,
    tagIds: selectedTagIds,
    tagMatch,
    includeTagDescendants: true,
    sort: sortOrder,
    page,
    pageSize: 30,
  }), [activeFolderId, assetType, category, createdFrom, createdTo, debouncedKeyword, page, selectedTagIds, smartViewQuery, sortOrder, sourceType, tagMatch]);
  const overviewQuery = useAssetOverviewQuery(scope, refreshKey);
  const libraryQuery = useAssetLibraryPageQuery(
    scope,
    smartView,
    query,
    refreshKey,
    deepLinkAssetRef.current
  );
  const lineageQuery = useAssetLineageQuery(
    scope,
    selected?.id || "",
    detailTab === "血缘"
  );
  const usageQuery = useAssetUsageQuery(
    scope,
    selected?.id || "",
    detailTab === "使用"
  );
  const projectOptionsQuery = useAssetProjectOptionsQuery(
    scope,
    sendPanelOpen
  );
  const exportsQuery = useAssetExportsQuery(scope, refreshKey);
  const lineage = lineageQuery.data || null;
  const usageEvents = useMemo(
    () => usageQuery.data?.items || [],
    [usageQuery.data?.items]
  );
  const sendProjects = useMemo(
    () => projectOptionsQuery.data || [],
    [projectOptionsQuery.data]
  );
  const exportBatches = useMemo(
    () => exportsQuery.data || [],
    [exportsQuery.data]
  );
  const loading = smartView !== "seedance" && libraryQuery.isFetching;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedKeyword(keyword), 250);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  useEffect(() => {
    setActiveFolderId("");
    setMoveFolderId("");
    setSelectedIds([]);
    setSelectedTagIds([]);
    setUploadTagIds([]);
    setSendPanelOpen(false);
    setSendProjectId("");
  }, [scope]);

  useEffect(() => {
    setPage(1);
  }, [activeFolderId, assetType, category, createdFrom, createdTo, debouncedKeyword, selectedTagIds, smartView, sortOrder, sourceType, tagMatch]);

  useEffect(() => {
    if (!overviewQuery.data) return;
    const { folders: folderResult, tags: tagResult } = overviewQuery.data;
      if (folderResult.status === "fulfilled") setFolders(folderResult.value);
      if (tagResult.status === "fulfilled") setTags(tagResult.value.filter((tag) => tag.asset_enabled));
  }, [overviewQuery.data]);

  useEffect(() => {
    // 「真人素材」选项页走 Seedance 素材接口，不查询资产库
    if (smartView === "seedance") {
      setAssets([]);
      setTotal(0);
      setSelectedId("");
      return;
    }
    if (libraryQuery.error) {
      toast.error(publicApiError(libraryQuery.error, "读取资产库失败"));
      return;
    }
    const result = libraryQuery.data;
    if (!result) return;
    const items = result.items || [];
    const deepLinkId = deepLinkAssetRef.current;
    deepLinkAssetRef.current = "";
    if (result.deepLinkMissing) {
      toast.info("链接指向的资产不存在或不可访问");
    }
    if (deepLinkId) setSelectedId(deepLinkId);
    setAssets(items);
    setTotal(result.total || 0);
    setSelectedId((current) => items.some((item) => item.id === current) ? current : items[0]?.id || "");
    setSelectedIds((ids) => ids.filter((id) => items.some((asset) => asset.id === id)));
  }, [
    libraryQuery.data,
    libraryQuery.error,
    libraryQuery.errorUpdatedAt,
    smartView,
  ]);

  useEffect(() => {
    setNoteDraft(selected?.note || selected?.user_state?.private_note || "");
    setDetailName(selected?.name || "");
    setDetailCategory(selected?.category || "");
    setSendPanelOpen(false);
  }, [selected?.id, selected?.name, selected?.category, selected?.note, selected?.user_state?.private_note]);

  // 视频/音频资产的内嵌预览：读取完整内容 Object URL（图片走缩略图通道）
  useEffect(() => {
    if (!selected || selected.type === "image") {
      setDetailMediaUrl("");
      return;
    }
    let disposed = false;
    let objectUrl = "";
    getAssetContentObjectUrl(selected.id, scope).then((url) => {
      if (disposed) {
        URL.revokeObjectURL(url);
        return;
      }
      objectUrl = url;
      setDetailMediaUrl(url);
    }).catch(() => {
      if (!disposed) setDetailMediaUrl("");
    });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selected?.id, selected?.type, scope]);

  useEffect(() => {
    if (lineageQuery.error) {
      toast.error(publicApiError(lineageQuery.error, "读取资产血缘失败"));
    }
  }, [lineageQuery.error, lineageQuery.errorUpdatedAt]);

  useEffect(() => {
    if (!sendPanelOpen) return;
    if (projectOptionsQuery.error) {
      toast.error(publicApiError(projectOptionsQuery.error, "读取画布项目失败"));
      return;
    }
    if (!sendProjects.length) {
      setSendProjectId("");
      return;
    }
    setSendProjectId((current) =>
      sendProjects.some(project => project.id === current)
        ? current
        : sendProjects[0].id
    );
  }, [
    projectOptionsQuery.error,
    projectOptionsQuery.errorUpdatedAt,
    sendPanelOpen,
    sendProjects,
  ]);

  useEffect(() => {
    const ids = Array.from(new Set(assets.filter((asset) => asset.type === "image").map((asset) => asset.id)));
    let disposed = false;
    const urls: Record<string, string> = {};
    Promise.all(ids.map(async (id) => {
      try {
        const url = await getAssetContentObjectUrl(id, scope, 320);
        if (disposed) URL.revokeObjectURL(url);
        else urls[id] = url;
      } catch {
        undefined;
      }
    })).then(() => { if (!disposed) setPreviewUrls(urls); });
    return () => {
      disposed = true;
      Object.values(urls).forEach(URL.revokeObjectURL);
    };
  }, [assets, scope]);

  const reloadExports = useCallback(() => {
    void exportsQuery.refetch();
  }, [exportsQuery.refetch]);

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length || uploading) return;
    setUploading(true);
    let succeeded = 0;
    for (const file of list) {
      try {
        const metadata: Record<string, string> = { name: file.name, source_type: "manual_upload" };
        if (activeFolderId) metadata.folder_id = activeFolderId;
        if (uploadCategory) metadata.category = uploadCategory;
        if (uploadTagIds.length) metadata.tag_ids = uploadTagIds.join(",");
        await uploadAsset(file, metadata, scope);
        succeeded += 1;
      } catch (error) {
        toast.error(`${file.name}：${publicApiError(error, "上传失败")}`);
      }
    }
    setUploading(false);
    if (succeeded) {
      toast.success(`已上传 ${succeeded} 个资产`);
      refresh();
    }
  };

  const toggleSelectedAsset = (id: string) => setSelectedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  const toggleFilterTag = (id: string) => setSelectedTagIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  const toggleUploadTag = (id: string) => setUploadTagIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  const bulkIds = selectedIdsFromUi.length ? selectedIdsFromUi : [];

  const saveNote = async () => {
    if (!selected) return;
    const saved = await updateAssetMetadata(selected.id, { note: noteDraft }, scope);
    setAssets((items) => items.map((item) => item.id === saved.id ? saved : item));
    toast.success("资产备注已保存");
  };

  const saveMeta = async () => {
    if (!selected) return;
    const name = detailName.trim();
    if (!name) {
      toast.warning("资产名称不能为空");
      return;
    }
    try {
      const saved = await updateAssetMetadata(selected.id, { name, category: detailCategory || "" }, scope);
      setAssets((items) => items.map((item) => item.id === saved.id ? saved : item));
      toast.success("资产名称与分类已保存");
    } catch (error) {
      toast.error(publicApiError(error, "保存资产信息失败"));
    }
  };

  const renameFolder = async (folder: AssetFolder) => {
    const name = window.prompt("重命名文件夹", folder.name)?.trim();
    if (!name || name === folder.name) return;
    try {
      await updateAssetFolder(folder.id, { name, parent_id: folder.parent_id || undefined, sort_order: folder.sort_order }, scope);
      toast.success("文件夹已重命名");
      refresh();
    } catch (error) {
      toast.error(publicApiError(error, "重命名文件夹失败"));
    }
  };

  const moveFolderTo = async (folder: AssetFolder, parentId: string) => {
    if ((folder.parent_id || "") === parentId) return;
    try {
      await updateAssetFolder(folder.id, { name: folder.name, parent_id: parentId || undefined, sort_order: folder.sort_order }, scope);
      toast.success(parentId ? "文件夹层级已调整" : "文件夹已移到根级");
      refresh();
    } catch (error) {
      toast.error(publicApiError(error, "调整文件夹层级失败"));
    }
  };

  const shiftFolder = async (folder: AssetFolder, direction: -1 | 1) => {
    const siblings = folders
      .filter((item) => (item.parent_id || "") === (folder.parent_id || ""))
      .sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name, "zh-CN"));
    const index = siblings.findIndex((item) => item.id === folder.id);
    const target = siblings[index + direction];
    if (!target) return;
    try {
      await updateAssetFolder(folder.id, { name: folder.name, parent_id: folder.parent_id || undefined, sort_order: target.sort_order }, scope);
      await updateAssetFolder(target.id, { name: target.name, parent_id: target.parent_id || undefined, sort_order: folder.sort_order }, scope);
      refresh();
    } catch (error) {
      toast.error(publicApiError(error, "调整文件夹排序失败"));
    }
  };

  const toggleReaction = async (reaction: "favorite" | "dislike") => {
    if (!selected) return;
    const nextReaction = selected.user_state?.reaction === reaction ? "none" : reaction;
    const userState = await updateAssetUserState(selected.id, { reaction: nextReaction }, scope);
    setAssets((items) => items.map((item) => item.id === selected.id ? { ...item, user_state: userState } : item));
  };

  const deleteOrRestore = async () => {
    if (!bulkIds.length) return;
    if (smartView === "trash") {
      await restoreAssets(bulkIds, scope);
      toast.success(`已恢复 ${bulkIds.length} 个资产`);
    } else {
      const preflight = await preflightAssetTrash(bulkIds, scope);
      if (!window.confirm(`将 ${preflight.total || bulkIds.length} 个资产移入回收站，已有引用仍可读。继续？`)) return;
      await trashAssets(bulkIds, scope);
      toast.success(`已移入回收站 ${bulkIds.length} 个资产`);
    }
    setSelectedIds([]);
    refresh();
  };

  const moveSelectedAssets = async () => {
    if (!bulkIds.length || !moveFolderId) return;
    await bulkMoveAssets(bulkIds, moveFolderId, scope);
    toast.success(`已移动 ${bulkIds.length} 个资产`);
    refresh();
  };

  const createFolder = async () => {
    const name = window.prompt("新资产文件夹名称")?.trim();
    if (!name) return;
    try {
      const created = await createAssetFolder({ name, parent_id: activeFolderId || undefined }, scope);
      setFolders((items) => [...items, created]);
      setActiveFolderId(created.id);
      setMoveFolderId(created.id);
      toast.success("资产文件夹已创建");
      refresh();
    } catch (error) {
      toast.error(publicApiError(error, "创建资产文件夹失败"));
    }
  };

  const deleteFolder = async () => {
    if (!activeFolderId) return;
    const folder = folders.find((item) => item.id === activeFolderId);
    if (!window.confirm(`删除文件夹"${folder?.name || activeFolderId}"？其中资产会回到默认归档目录。`)) return;
    try {
      const result = await deleteAssetFolder(activeFolderId, scope);
      setActiveFolderId("");
      setMoveFolderId("");
      toast.success(`文件夹已删除，迁移资产 ${result.moved_assets || 0} 个`);
      refresh();
    } catch (error) {
      toast.error(publicApiError(error, "删除资产文件夹失败"));
    }
  };

  const applySelectedTags = async (action: "add" | "remove") => {
    if (!bulkIds.length || !selectedTagIds.length) return;
    await bulkUpdateAssetTags(bulkIds, selectedTagIds, action, scope);
    toast.success(action === "add" ? "已追加标签" : "已移除标签");
    refresh();
  };

  const permanentDeleteSelected = async () => {
    if (!bulkIds.length || smartView !== "trash") return;
    if (!window.confirm(`永久删除 ${bulkIds.length} 个资产？此操作不可恢复。`)) return;
    try {
      await Promise.all(bulkIds.map((id) => permanentDeleteAsset(id, scope)));
      setSelectedIds([]);
      toast.success("已永久删除选中资产");
      refresh();
    } catch (error) {
      toast.error(publicApiError(error, "永久删除失败"));
    }
  };

  const emptyTrash = async () => {
    if (smartView !== "trash") return;
    if (!window.confirm("清空当前空间回收站？此操作不可恢复。")) return;
    try {
      const result = await emptyAssetTrash(scope);
      setSelectedIds([]);
      toast.success(`回收站已清空：${result.deleted || 0} 个资产`);
      refresh();
    } catch (error) {
      toast.error(publicApiError(error, "清空回收站失败"));
    }
  };

  const createExport = async (mode: "selected" | "filter" | "folder") => {
    setExportBusy(mode);
    try {
      if (mode === "selected") {
        await createAssetExport({ selection_mode: "selected", asset_ids: bulkIds }, scope);
      } else if (mode === "folder") {
        await createAssetExport({ selection_mode: "folder", folder_id: activeFolderId }, scope);
      } else {
        await createAssetExport({
          selection_mode: "filter",
          filter: {
            folderId: activeFolderId || undefined,
            includeDescendants: true,
            smartView: smartViewQuery,
            category,
            sourceType,
            keyword: debouncedKeyword.trim() || undefined,
            tagIds: selectedTagIds,
            tagMatch,
            sort: "created_at_desc",
          },
        }, scope);
      }
      toast.success("导出任务已创建");
      void reloadExports();
    } catch (error) {
      toast.error(publicApiError(error, "创建导出任务失败"));
    } finally {
      setExportBusy("");
    }
  };

  const exportAssetPackage = async () => {
    if (!bulkIds.length) return;
    setPackageBusy("export");
    try {
      const targets = assets.filter((asset) => bulkIds.includes(asset.id));
      const items = await Promise.all(targets.map(async (asset) => {
        let objectUrl = "";
        try {
          objectUrl = await getAssetContentObjectUrl(asset.id, scope);
          return { asset, blob: await fetch(objectUrl).then((response) => response.blob()) };
        } catch {
          return { asset, blob: null };
        } finally {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
        }
      }));
      const zip = await createAssetPackage(items);
      downloadBlob(zip, `资产包-${new Date().toISOString().slice(0, 10)}.zip`);
      toast.success(`已导出 ${items.filter((item) => item.blob).length} 个资产`);
    } catch (error) {
      toast.error(publicApiError(error, "导出资产包失败"));
    } finally {
      setPackageBusy("");
    }
  };

  const importAssetPackage = async (file: File) => {
    setPackageBusy("import");
    try {
      const items = await readAssetPackage(file);
      const uploadable = items.filter((item) => item.file);
      if (!uploadable.length) throw new Error("资产包中没有可导入的文件");
      let succeeded = 0;
      for (const item of uploadable) {
        try {
          await uploadAsset(item.file as File, assetPackageUploadMetadata(item.asset, activeFolderId || undefined), scope);
          succeeded += 1;
        } catch (error) {
          toast.error(`${item.asset.name}：${publicApiError(error, "导入失败")}`);
        }
      }
      if (succeeded) {
        toast.success(`已导入 ${succeeded} 个资产`);
        refresh();
      }
    } catch (error) {
      toast.error(publicApiError(error, "读取资产包失败"));
    } finally {
      setPackageBusy("");
    }
  };

  const openInImageWorkbench = () => {
    if (!selected) return;
    sessionStorage.setItem("ai-manju:image-reference-asset", selected.id);
    navigate(`/image?scope=${encodeURIComponent(scope)}`);
  };

  const assetCanvasNode = (asset: Asset, offset = 0) => ({
    id: crypto.randomUUID(),
    kind: asset.type === "video" ? "video" : asset.type === "audio" ? "audio" : "image",
    title: asset.name || "资产",
    content: asset.note || "",
    x: 160 + (offset % 5) * 48,
    y: 140 + (offset % 5) * 48,
    width: 320,
    height: 240,
    ...(asset.type === "video" ? { videoAssetId: asset.id } : asset.type === "audio" ? { audioAssetId: asset.id } : { imageAssetId: asset.id }),
  });

  const sendToNewCanvas = async () => {
    if (!selected) return;
    try {
      const project = await createProject({
        scope,
        title: `资产 · ${selected.name || selected.id.slice(-6)}`,
        data: { nodes: [assetCanvasNode(selected)], edges: [], zoom: 90 },
      });
      toast.success("已创建画布并放入资产");
      navigate(canvasProjectHref(project.id, scope));
    } catch (error) {
      toast.error(publicApiError(error, "发送到画布失败"));
    }
  };

  const sendToExistingCanvas = async () => {
    if (!selected || !sendProjectId) return;
    try {
      const snapshot = await getProjectSnapshot(sendProjectId, scope).catch(() => null);
      const data = (snapshot?.data && typeof snapshot.data === "object" && !Array.isArray(snapshot.data) ? snapshot.data : {}) as Record<string, unknown>;
      const nodes = Array.isArray(data.nodes) ? data.nodes : [];
      const edges = Array.isArray(data.edges) ? data.edges : [];
      await saveProjectSnapshot(sendProjectId, { ...data, nodes: [...nodes, assetCanvasNode(selected, nodes.length)], edges }, scope);
      toast.success("已把资产加入画布");
      navigate(canvasProjectHref(sendProjectId, scope));
    } catch (error) {
      toast.error(publicApiError(error, "发送到画布失败"));
    }
  };

  return <div className="feature-page asset-library-page">
    <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => event.target.files && void handleFiles(event.target.files)} />
    <input ref={packageInputRef} type="file" accept=".zip,application/zip" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importAssetPackage(file); }} />
    <SurfaceTitle eyebrow={`LIBRARY / ${total}`} title="资产库" description="支持个人 / 团队空间、标签组合筛选、批量删除 / 移动 / 导出，以及拖入文件直接上传。"
      actions={<div className="scope-switch">{scopeOptions.map((item) => <button key={item.value} className={scope === item.value ? "active" : ""} onClick={() => setScope(item.value)}>{item.label}</button>)}</div>} />
    <div className="asset-tag-index"><div className="tag-index-head"><span><Tag size={15} /> 分类标签</span><div><button className={tagMatch === "and" ? "active" : ""} onClick={() => setTagMatch("and")}>交集</button><button className={tagMatch === "or" ? "active" : ""} onClick={() => setTagMatch("or")}>并集</button><button onClick={() => setSelectedTagIds([])}>清空</button>{roots.length > 8 && <button onClick={() => setShowAllFilterTags((value) => !value)}>{showAllFilterTags ? "收起" : `展开 ${roots.length}`}</button>}</div></div><div className="tag-index-body">{filterRoots.map((root) => <div className="tag-index-group" key={root.id}><button className={selectedTagIds.includes(root.id) ? "selected" : ""} onClick={() => toggleFilterTag(root.id)}>{root.name}<b>{root.asset_count || 0}</b></button>{tagChildren(tags, root.id).map((child) => <button key={child.id} className={selectedTagIds.includes(child.id) ? "selected child" : "child"} onClick={() => toggleFilterTag(child.id)}>{child.name}<b>{child.asset_count || 0}</b></button>)}</div>)}</div></div>
    <div className="library-workspace">
      <aside className="library-tree">
        <p className="field-label">SMART VIEWS</p>
        {smartViews.map((view) => <button className={smartView === view.value ? "selected" : ""} onClick={() => setSmartView(view.value)} key={view.value}>{view.label}</button>)}
        <hr />
        <p className="field-label">FOLDERS</p>
        <button className={!activeFolderId ? "selected" : ""} onClick={() => setActiveFolderId("")}>全部目录</button>
        {visibleFolderRows.map(({ folder, depth, hasChildren, ancestorLast }) => {
          const siblings = folders.filter((item) => (item.parent_id || "") === (folder.parent_id || ""));
          const siblingIndex = siblings.findIndex((item) => item.id === folder.id);
          const editable = folder.kind !== "system";
          const collapsed = collapsedFolderSet.has(folder.id);
          return (
            <div key={folder.id} className="folder-row-wrap">
              <button className={activeFolderId === folder.id ? "folder-row selected" : "folder-row"} style={{ paddingLeft: 6 + depth * 14 }} title={folderPathLabel(folders, folder.id)} onClick={() => { setActiveFolderId(folder.id); setMoveFolderId(folder.id); }}>
                {ancestorLast.map((isLast, level) => (isLast ? null : <i key={level} className="folder-guide" style={{ left: 6 + level * 14 + 6 }} />))}
                {hasChildren ? (
                  <span
                    className="folder-toggle"
                    role="button"
                    aria-label={collapsed ? "展开子目录" : "收起子目录"}
                    title={collapsed ? "展开子目录" : "收起子目录"}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleFolderCollapsed(folder.id);
                    }}
                  >
                    <ChevronRight size={11} className={collapsed ? "" : "open"} />
                  </span>
                ) : (
                  <span className="folder-toggle placeholder" />
                )}
                <FolderOpen size={12} className="folder-icon" />
                <span className="folder-name">{folder.name}</span>
                <b className="folder-count">{folder.descendant_asset_count ?? folder.asset_count}</b>
              </button>
              {editable ? (
                <span className="folder-row-actions">
                  <button type="button" title="重命名文件夹" onClick={() => void renameFolder(folder)}><Pencil size={11} /></button>
                  <button type="button" title="上移" disabled={siblingIndex <= 0} onClick={() => void shiftFolder(folder, -1)}><ArrowUp size={11} /></button>
                  <button type="button" title="下移" disabled={siblingIndex < 0 || siblingIndex >= siblings.length - 1} onClick={() => void shiftFolder(folder, 1)}><ArrowDown size={11} /></button>
                  <button type="button" title="调整层级" onClick={() => setFolderMoveFor((current) => current === folder.id ? "" : folder.id)}><FolderInput size={11} /></button>
                </span>
              ) : null}
              {folderMoveFor === folder.id ? (
                <select
                  className="folder-move-select"
                  autoFocus
                  value=""
                  onBlur={() => setFolderMoveFor("")}
                  onChange={(event) => {
                    const target = event.target.value;
                    setFolderMoveFor("");
                    if (target !== "__cancel") void moveFolderTo(folder, target);
                  }}
                >
                  <option value="__cancel">选择目标父级…</option>
                  <option value="">根级</option>
                  {folders.filter((candidate) => candidate.kind !== "system" && candidate.id !== folder.id && !folderSubtreeForMove.has(candidate.id)).map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{folderPathLabel(folders, candidate.id)}</option>
                  ))}
                </select>
              ) : null}
            </div>
          );
        })}
        <hr />
        <button onClick={() => void createFolder()}><Plus size={14} /> 新建文件夹</button>
        <button onClick={() => void deleteFolder()} disabled={!activeFolderId}>删除当前文件夹</button>
      </aside>
      <section className="asset-browser" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (smartView !== "seedance") void handleFiles(event.dataTransfer.files); }}>{smartView === "seedance" ? <SeedanceAssetPanel scope={scope} /> : <>
        <div className="asset-browser-top"><div><button className="breadcrumb">{scope === "personal" ? "个人素材" : "团队素材"} <ChevronRight size={13} /></button><h2>{activeFolder?.name || smartViews.find((item) => item.value === smartView)?.label}</h2></div><div className="tag-search"><Search size={15} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索资产名称、来源或标签" /></div></div>
        <div className="asset-filter-bar">
          <select value={category} onChange={(event) => setCategory(event.target.value as AssetCategory | "")}>{assetCategoryOptions.map((item) => <option key={item.value || "all"} value={item.value}>{item.label}</option>)}</select>
          <select value={sourceType} onChange={(event) => setSourceType(event.target.value as AssetSourceType | "")}>{sourceTypeOptions.map((item) => <option key={item.value || "all"} value={item.value}>{item.label}</option>)}</select>
          <select value={assetType} onChange={(event) => setAssetType(event.target.value as Asset["type"] | "")}><option value="">全部类型</option><option value="image">图片</option><option value="video">视频</option><option value="audio">音频</option></select>
          <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as typeof sortOrder)}><option value="created_at_desc">最新优先</option><option value="created_at_asc">最早优先</option><option value="name_asc">名称 A-Z</option><option value="name_desc">名称 Z-A</option></select>
          <input className="asset-date-input" type="date" value={createdFrom} onChange={(event) => setCreatedFrom(event.target.value)} title="创建时间起" />
          <input className="asset-date-input" type="date" value={createdTo} onChange={(event) => setCreatedTo(event.target.value)} title="创建时间止" />
          <select value={uploadCategory} onChange={(event) => setUploadCategory(event.target.value as AssetCategory | "")}><option value="">上传不指定分类</option>{assetCategoryOptions.filter((item) => item.value).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          <button className="outline-button small" disabled={uploading} onClick={() => fileInputRef.current?.click()}><Upload size={15} /> {uploading ? "上传中…" : "导入资产"}</button>
        </div>
        <div className="upload-tag-row"><span>上传默认标签</span>{uploadTags.map((tag) => <button key={tag.id} className={uploadTagIds.includes(tag.id) ? "selected" : ""} onClick={() => toggleUploadTag(tag.id)}>#{tag.name}</button>)}{tags.length > 24 && <button className="more-tag-button" onClick={() => setShowAllUploadTags((value) => !value)}>{showAllUploadTags ? "收起标签" : `展开全部 ${tags.length}`}</button>}</div>
        <div className="asset-bulk-bar"><label><input type="checkbox" checked={assets.length > 0 && selectedIds.length === assets.length} onChange={(event) => setSelectedIds(event.target.checked ? assets.map((asset) => asset.id) : [])} /> 本页全选</label><span>已选 {bulkIds.length} 项</span><select value={moveFolderId} onChange={(event) => setMoveFolderId(event.target.value)}><option value="">移动到目录…</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select><button onClick={() => void moveSelectedAssets()} disabled={!moveFolderId || !bulkIds.length}>移动</button><button onClick={() => void deleteOrRestore()} disabled={!bulkIds.length}>{smartView === "trash" ? "恢复" : "删除"}</button>{smartView === "trash" && <button onClick={() => void permanentDeleteSelected()} disabled={!bulkIds.length}>永久删除</button>}{smartView === "trash" && <button onClick={() => void emptyTrash()}>清空回收站</button>}<button onClick={() => void applySelectedTags("add")} disabled={!selectedTagIds.length || !bulkIds.length}>追加筛选标签</button><button onClick={() => void applySelectedTags("remove")} disabled={!selectedTagIds.length || !bulkIds.length}>移除筛选标签</button><button onClick={() => void createExport("selected")} disabled={exportBusy === "selected" || !bulkIds.length}>导出选中</button><button onClick={() => void createExport("filter")} disabled={exportBusy === "filter"}>导出筛选</button><button onClick={() => void createExport("folder")} disabled={!activeFolderId || exportBusy === "folder"}>导出目录</button><button onClick={() => void exportAssetPackage()} disabled={!bulkIds.length || packageBusy === "export"}>{packageBusy === "export" ? "打包中…" : "打包选中"}</button><button onClick={() => packageInputRef.current?.click()} disabled={packageBusy === "import"}>{packageBusy === "import" ? "导入中…" : "导入资产包"}</button></div>
        {loading ? <div className="empty-output"><Loader2 className="spin" size={26} /><p>正在读取资产…</p></div> : assets.length ? <div className="asset-thumb-grid">{assets.map((asset) => <article key={asset.id} className={selected?.id === asset.id ? "library-asset selected" : "library-asset"}><label className="asset-check"><input type="checkbox" checked={selectedIds.includes(asset.id)} onChange={() => toggleSelectedAsset(asset.id)} /></label><button onClick={() => setSelectedId(asset.id)}>{previewUrls[asset.id] ? <img src={previewUrls[asset.id]} alt={asset.name} /> : <div className="empty-output"><ImageIcon size={22} /></div>}<span className="asset-category">{asset.category || asset.type}</span><i>{asset.id.slice(-8)}</i><div><b>{asset.name}</b><small>{asset.source_type || "unknown"}</small></div></button></article>)}</div> : <div className="empty-output"><Archive size={26} /><p>当前筛选下没有资产<br />可直接把文件拖入此区域上传。</p></div>}
        <div className="batch-actions"><button className="outline-button small" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button><span>{page} / {Math.max(1, Math.ceil(total / 30))}</span><button className="outline-button small" disabled={page * 30 >= total} onClick={() => setPage((value) => value + 1)}>下一页</button></div>
      </>}</section>
      <aside className="asset-detail">{selected ? <><div className="detail-head"><div><p className="eyebrow">ASSET / {selected.id.slice(-8)}</p><h3>{selected.name}</h3></div><button className="icon-button subtle" onClick={() => void deleteOrRestore()}>{smartView === "trash" ? <Archive size={16} /> : <Trash2 size={16} />}</button></div>{selected.type === "video" ? (detailMediaUrl ? <video className="detail-image detail-media" src={detailMediaUrl} controls preload="metadata" /> : <div className="empty-output"><Video size={28} /><p>读取视频预览…</p></div>) : selected.type === "audio" ? (detailMediaUrl ? <div className="detail-audio"><Music2 size={22} /><audio src={detailMediaUrl} controls preload="metadata" /></div> : <div className="empty-output"><Music2 size={28} /><p>读取音频预览…</p></div>) : previewUrls[selected.id] ? <img className="detail-image" src={previewUrls[selected.id]} alt={selected.name} /> : <div className="empty-output"><ImageIcon size={28} /></div>}<div className="detail-tabs">{["详情", "标签", "血缘", "使用", "导出"].map((tab) => <button className={detailTab === tab ? "active" : ""} onClick={() => setDetailTab(tab)} key={tab}>{tab}</button>)}</div>{detailTab === "详情" ? <div className="asset-metadata"><div className="asset-meta-edit"><span>名称</span><input value={detailName} onChange={(event) => setDetailName(event.target.value)} placeholder="资产名称" /><span>分类</span><select value={detailCategory} onChange={(event) => setDetailCategory(event.target.value as AssetCategory | "")}><option value="">不指定分类</option>{assetCategoryOptions.filter((item) => item.value).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><button className="outline-button small" onClick={() => void saveMeta()}>保存</button></div><div><span>来源</span><b>{selected.source_type || "unknown"}</b></div><div><span>体积</span><b>{selected.size ? `${(selected.size / 1024 / 1024).toFixed(2)} MB` : "—"}</b></div><div><span>标签</span><b>{selected.tags?.join(" · ") || "未绑定"}</b></div><label className="asset-note-editor"><span>备注</span><textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} /><button onClick={() => void saveNote()}>保存备注</button></label></div> : detailTab === "标签" ? <AssetTagManager assetId={selected.id} scope={scope} allTags={tags} refreshKey={refreshKey} /> : detailTab === "血缘" ? <div className="lineage-detail"><div className="lineage-flow"><span>{selected.source_type || "来源未知"}</span><i /><strong>{selected.name}</strong></div>{lineage ? <>{lineage.parents?.length ? <div className="lineage-group"><p className="field-label">上游来源 {lineage.parents.length}</p>{lineage.parents.map((entry, index) => <button key={entry.id || index} onClick={() => entry.parent_asset_id && setSelectedId(entry.parent_asset_id)}><b>{entry.parent_asset_id?.slice(-8) || "—"}</b><span>{entry.relation_type || "derived"}</span></button>)}</div> : <small className="lineage-empty">没有上游来源记录</small>}{lineage.children?.length ? <div className="lineage-group"><p className="field-label">下游产物 {lineage.children.length}</p>{lineage.children.map((entry, index) => <button key={entry.id || index} onClick={() => entry.child_asset_id && setSelectedId(entry.child_asset_id)}><b>{entry.child_asset_id?.slice(-8) || "—"}</b><span>{entry.relation_type || "derived"}</span></button>)}</div> : <small className="lineage-empty">没有派生产物记录</small>}</> : <small className="lineage-empty">读取血缘中…</small>}</div> : detailTab === "使用" ? <div className="usage-list"><div><b>生成调用</b><small>{selected.usage_stats?.generation_use_count || 0} 次</small></div><div><b>有效引用</b><small>{selected.usage_stats?.active_reference_count || 0} 处</small></div><div><b>下载导出</b><small>{(selected.usage_stats?.download_count || 0) + (selected.usage_stats?.export_count || 0)} 次</small></div>{usageEvents.length > 0 && <div className="usage-events"><p className="field-label">最近事件</p>{usageEvents.slice(0, 8).map((event) => <div key={event.id}><span>{event.event_type}</span><small>{event.source_type || "—"}{event.created_at ? ` · ${new Date(event.created_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}</small></div>)}</div>}</div> :<div className="export-list">{exportBatches.slice(0, 5).map((batch) => <div key={batch.id}><span className={`status-chip ${batch.status}`}>{formatStatus(batch.status)}</span><b>{batch.succeeded}/{batch.total}</b><small>{batch.file_name || batch.id.slice(-8)}</small>{batch.status === "succeeded" || batch.status === "partial_failed" ? <button onClick={() => void downloadAssetExport(batch.id, scope).then((blob) => downloadBlob(blob, batch.file_name || `${batch.id}.zip`))}>下载</button> : batch.status === "queued" || batch.status === "running" ? <button onClick={() => void cancelAssetExport(batch.id, scope).then(reloadExports)}>取消</button> : null}</div>)}</div>}<div className="asset-detail-actions"><button onClick={() => void toggleReaction("favorite")}><Sparkles size={15} /> {selected.user_state?.reaction === "favorite" ? "取消收藏" : "收藏"}</button><button onClick={() => void toggleReaction("dislike")}><Trash2 size={15} /> {selected.user_state?.reaction === "dislike" ? "取消踩" : "踩"}</button><button onClick={() => void getAssetContentObjectUrl(selected.id, scope).then((url) => fetch(url).then((resp) => resp.blob()).then((blob) => { downloadBlob(blob, selected.name); URL.revokeObjectURL(url); }))}><Archive size={15} /> 下载</button></div><div className="asset-detail-actions"><button onClick={() => void sendToNewCanvas()}><Layers3 size={15} /> 发送到新画布</button><button onClick={() => setSendPanelOpen((value) => !value)}><FolderOpen size={15} /> 发送到已有画布</button>{selected.type === "image" && <button onClick={openInImageWorkbench}><WandSparkles size={15} /> 在生图工作台打开</button>}</div>{sendPanelOpen && <div className="asset-send-panel"><select value={sendProjectId} onChange={(event) => setSendProjectId(event.target.value)}>{sendProjects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}{!sendProjects.length && <option value="">暂无画布项目</option>}</select><button className="outline-button small" disabled={!sendProjectId} onClick={() => void sendToExistingCanvas()}>加入画布</button></div>}</> : <div className="empty-output"><p>选择一项资产查看详情</p></div>}</aside>
    </div>
  </div>;
}

/** 单资产语义标签管理：绑定/解绑直接标签、展示继承来源、重同步继承标签。 */
function AssetTagManager({ assetId, scope, allTags, refreshKey }: { assetId: string; scope: WorkspaceScope; allTags: SemanticTag[]; refreshKey: number }) {
  const [busy, setBusy] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const detailsQuery = useAssetTagDetailsQuery(
    scope,
    assetId,
    refreshKey,
    reloadKey
  );
  const details: AssetTagDetail[] = detailsQuery.data?.items || [];
  const loading = detailsQuery.isFetching;

  useEffect(() => {
    if (detailsQuery.error) {
      toast.error(publicApiError(detailsQuery.error, "读取资产标签失败"));
    }
  }, [detailsQuery.error, detailsQuery.errorUpdatedAt]);

  const boundTagIds = new Set(details.map((detail) => detail.tag.id));
  const candidates = allTags.filter((tag) => tag.asset_enabled && !boundTagIds.has(tag.id));

  const bind = async (tagId: string) => {
    setBusy(tagId);
    try {
      await bindAssetTags(assetId, [tagId], scope);
      setReloadKey((value) => value + 1);
      toast.success("标签已绑定");
    } catch (error) {
      toast.error(publicApiError(error, "绑定标签失败"));
    } finally {
      setBusy("");
    }
  };

  const unbind = async (tagId: string) => {
    setBusy(tagId);
    try {
      await removeAssetTag(assetId, tagId, scope);
      setReloadKey((value) => value + 1);
      toast.success("标签已移除");
    } catch (error) {
      toast.error(publicApiError(error, "移除标签失败"));
    } finally {
      setBusy("");
    }
  };

  const resync = async () => {
    setBusy("resync");
    try {
      await resyncAssetInheritedTags(assetId, scope);
      setReloadKey((value) => value + 1);
      toast.success("继承标签已按最新规则重同步");
    } catch (error) {
      toast.error(publicApiError(error, "重同步继承标签失败"));
    } finally {
      setBusy("");
    }
  };

  if (loading) return <div className="empty-output"><Loader2 className="spin" size={18} /><p>读取标签绑定…</p></div>;

  return (
    <div className="asset-tag-manager">
      <p className="field-label">已绑定（{details.length}）</p>
      <div className="asset-tag-bound">
        {details.map((detail) => {
          const direct = detail.origins.some((origin) => origin.origin_type === "direct");
          const inherited = !direct && detail.origins.some((origin) => origin.origin_type === "inherited");
          const suppressed = detail.binding.state === "suppressed";
          const originLabel = direct ? "直接" : inherited ? "继承" : "系统";
          return (
            <span key={detail.binding.id} className={suppressed ? "asset-tag-chip suppressed" : "asset-tag-chip"} title={detail.tag.description || detail.tag.name}>
              #{detail.tag.name}
              <i>{suppressed ? "已屏蔽" : originLabel}</i>
              {direct && !suppressed ? <button type="button" title="移除该标签" disabled={busy === detail.tag.id} onClick={() => void unbind(detail.tag.id)}><X size={10} /></button> : null}
            </span>
          );
        })}
        {!details.length ? <small>尚未绑定语义标签</small> : null}
      </div>
      <p className="field-label">可绑定标签</p>
      <div className="asset-tag-pool">
        {candidates.slice(0, 30).map((tag) => (
          <button key={tag.id} type="button" disabled={Boolean(busy)} onClick={() => void bind(tag.id)} title={semanticTagPath(tag.id, allTags)}>#{tag.name}</button>
        ))}
        {!candidates.length ? <small>标签库中没有更多可绑定的资产标签</small> : null}
      </div>
      <button type="button" className="outline-button small" disabled={Boolean(busy)} onClick={() => void resync()}>
        {busy === "resync" ? <Loader2 className="spin" size={13} /> : <RefreshCcw size={13} />} 重同步继承标签
      </button>
    </div>
  );
}

export default AssetLibraryView;
