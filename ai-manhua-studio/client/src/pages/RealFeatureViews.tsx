import {
  Archive,
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  ChevronRight,
  Clapperboard,
  FileText,
  FolderOpen,
  Hash,
  Image as ImageIcon,
  Layers3,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  WandSparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useWorkspaceDashboardData } from "@/hooks/useWorkspaceDashboardData";
import {
  bulkDeleteTags,
  bulkMoveAssets,
  bulkMoveTags,
  bulkUpdateAssetTags,
  cancelAssetExport,
  createAssetExport,
  createAssetFolder,
  createProject,
  createTag,
  createTagAlias,
  deleteAssetFolder,
  deleteTag,
  deleteTagAlias,
  downloadAssetExport,
  emptyAssetTrash,
  fetchImageModels,
  generateImages,
  getAssetContentObjectUrl,
  getAssetFolders,
  getAssetLibrary,
  getPreferences,
  getProject,
  getProjectSnapshot,
  getTrashedAssetLibrary,
  imageModelLabel,
  listAllTags,
  listAssetExports,
  preflightAssetTrash,
  publicApiError,
  restoreAssets,
  permanentDeleteAsset,
  trashAssets,
  updateAssetMetadata,
  updateAssetUserState,
  updatePreferences,
  updateTag,
  uploadAsset,
  saveProjectSnapshot,
  type Asset,
  type AssetCategory,
  type AssetExportBatch,
  type AssetFolder,
  type AssetSourceType,
  type GeneratedImage,
  type ImageModelCatalog,
  type PromptPreset,
  type SemanticTag,
  type WorkspaceScope,
} from "@/services/api";

export { ComicAssetsView } from "./ComicAssetsView";

type Option<T extends string> = { value: T; label: string };
type SmartView = "all" | "favorite" | "dislike" | "unused" | "frequent" | "trash";

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

function priorityRank(value: PromptPreset["priority"]) {
  return { pinned: 0, high: 1, normal: 2, low: 3 }[value] ?? 2;
}

function priorityLabel(value: PromptPreset["priority"]) {
  return { pinned: "置顶", high: "高", normal: "普通", low: "低" }[value] ?? value;
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

export function ImageWorkbenchView() {
  const [, navigate] = useLocation();
  const [scope, setScope] = useState<WorkspaceScope>(() => initialScopeFromSearch());
  const [model, setModel] = useState("");
  const [catalog, setCatalog] = useState<ImageModelCatalog | null>(null);
  const [size, setSize] = useState<"auto" | "1:1" | "16:9" | "9:16">("auto");
  const [count, setCount] = useState(1);
  const [prompt, setPrompt] = useState("雨夜，狭长街道，潮湿沥青反射红色招牌；人物在画面右侧停留，低机位缓慢推近，电影级冷暖对比。");
  const [promptPresets, setPromptPresets] = useState<PromptPreset[]>([]);
  const [result, setResult] = useState<GeneratedImage[]>([]);
  const [selectedResult, setSelectedResult] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState(0);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    fetchImageModels().then((next) => { setCatalog(next); setModel(next.defaultModel); }).catch((error) => toast.error(publicApiError(error, "读取图像模型失败")));
    getPreferences().then((preferences) => setPromptPresets(preferences.canvas?.promptPresets || [])).catch(() => undefined);
  }, []);

  useEffect(() => {
    const presetPrompt = sessionStorage.getItem("ai-manju:image-prompt");
    if (presetPrompt) {
      setPrompt(presetPrompt);
      sessionStorage.removeItem("ai-manju:image-prompt");
    }
  }, []);

  const selectedImage = useMemo(() => result[selectedResult] || result[0], [result, selectedResult]);
  const visiblePromptPresets = useMemo(() => [...promptPresets]
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.sort_order - b.sort_order || a.title.localeCompare(b.title, "zh-CN"))
    .slice(0, 8), [promptPresets]);

  const generate = async () => {
    if (generating || !model) return;
    setGenerating(true);
    setResult([]);
    setSelectedResult(0);
    setJobProgress(0);
    try {
      const generated = await generateImages({
        model,
        prompt,
        size,
        quality: "auto",
        count,
        scope,
        sourceType: "image_workbench",
      }, {
        onAccepted: (job) => setJobId(job.job_id || job.id || null),
        onProgress: (job) => { setJobId(job.id); setJobProgress(job.progress ?? 0); },
      });
      setResult(generated.images);
      setJobProgress(100);
      toast.success(`生成完成，共 ${generated.images.length} 张`);
    } catch (error) {
      toast.error(publicApiError(error, "图像生成失败"));
    } finally {
      setGenerating(false);
    }
  };

  const sendToCanvas = async () => {
    if (!selectedImage?.assetId) return toast.info("先从生成结果中选择一个已归档图片");
    try {
      const project = await createProject({
        scope,
        title: `关键帧 · ${new Date().toLocaleDateString("zh-CN")}`,
        data: {
          nodes: [{
            id: crypto.randomUUID(),
            kind: "image",
            title: selectedImage.name || "生图结果",
            content: prompt,
            x: 160,
            y: 140,
            width: 320,
            height: 240,
            imageAssetId: selectedImage.assetId,
          }],
          edges: [],
          zoom: 90,
        },
      });
      navigate(canvasProjectHref(project.id, scope));
    } catch (error) {
      toast.error(publicApiError(error, "送入画布失败"));
    }
  };

  return <div className="feature-page image-page">
    <SurfaceTitle eyebrow="KEYFRAME / NEW" title="关键帧生成" description="走真实模型与队列，把结果直接送回画布。"
      actions={<div className="scope-switch">{scopeOptions.map((item) => <button key={item.value} className={scope === item.value ? "active" : ""} onClick={() => setScope(item.value)}>{item.label}</button>)}</div>} />
    <div className="image-workbench">
      <section className="image-composer">
        <div className="composer-tabs"><button className="active">文生图</button></div>
        <label className="prompt-editor"><span>SHOT PROMPT</span><textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} /><small>{prompt.length} 字符</small></label>
        {visiblePromptPresets.length ? <div className="workbench-preset-strip"><span>个人提示词</span>{visiblePromptPresets.map((preset) => <button key={preset.id} title={preset.prompt} onClick={() => setPrompt(preset.prompt)}>{priorityLabel(preset.priority)} · {preset.title}</button>)}</div> : null}
        <div className="composer-options">
          <label>模型<select value={model} onChange={(e) => setModel(e.target.value)}>{catalog?.models.map((item) => <option key={item} value={item}>{imageModelLabel(item, catalog)}</option>)}</select></label>
          <label>画幅<div className="ratio-buttons">{(["auto", "1:1", "16:9", "9:16"] as const).map((ratio) => <button key={ratio} className={size === ratio ? "active" : ""} onClick={() => setSize(ratio)}>{ratio === "auto" ? "AUTO" : ratio}</button>)}</div></label>
          <label>数量<div className="counter"><button onClick={() => setCount((v) => Math.max(1, v - 1))}>−</button><b>{String(count).padStart(2, "0")}</b><button onClick={() => setCount((v) => Math.min(15, v + 1))}>+</button></div></label>
        </div>
        {generating && <div className="job-progress"><i style={{ width: `${jobProgress}%` }} /></div>}
        <button className="vermilion-button generate-frame" disabled={generating || !model} onClick={() => void generate()}><WandSparkles size={17} /> {generating ? `生成中 ${jobProgress}%` : "生成关键帧"}</button>
      </section>
      <aside className="generation-output">
        <div className="output-heading"><div><p className="eyebrow">RESULTS / {String(result.length).padStart(2, "0")}</p><h3>{generating ? "任务执行中" : result.length ? "本次落点" : "等待落点"}</h3>{jobId && <small>JOB · {jobId}</small>}</div></div>
        {result.length ? <div className="result-grid">{result.map((image, index) => <button key={image.id} className={index === selectedResult ? "result-card selected" : "result-card"} onClick={() => setSelectedResult(index)}><img src={image.src} alt={image.name || "结果"} /><span>V-{String(index + 1).padStart(2, "0")}</span>{index === selectedResult && <i><Check size={14} /></i>}</button>)}</div> : <div className="empty-output"><ImageIcon size={27} /><p>生成结果会在这里形成。</p></div>}
        <div className="output-foot"><button onClick={() => void sendToCanvas()} disabled={!selectedImage?.assetId}><Layers3 size={15} /> 送入画布</button><button onClick={() => selectedImage?.assetId ? toast.success(`资产 ${selectedImage.assetId} 已归档`) : toast.info("结果完成后会自动归档")}><Clapperboard size={15} /> 查看归档</button></div>
      </aside>
    </div>
  </div>;
}

export function AssetLibraryView() {
  const fileInputRef = useRef<HTMLInputElement>(null);
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
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [exportBatches, setExportBatches] = useState<AssetExportBatch[]>([]);
  const [exportBusy, setExportBusy] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const selected = assets.find((asset) => asset.id === selectedId) || assets[0];
  const selectedIdsFromUi = selectedIds.length ? selectedIds : selected ? [selected.id] : [];
  const roots = tags.filter((tag) => !tag.parent_id || !tags.some((parent) => parent.id === tag.parent_id));
  const activeFolder = folders.find((folder) => folder.id === activeFolderId);
  const filterRoots = showAllFilterTags ? roots : roots.slice(0, 8);
  const uploadTags = showAllUploadTags ? tags : tags.slice(0, 24);

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);
  const smartViewQuery = (smartView === "all" || smartView === "trash" ? "" : smartView) as "" | "favorite" | "dislike" | "unused" | "frequent";
  const query = useMemo(() => ({
    keyword: debouncedKeyword.trim() || undefined,
    smartView: smartViewQuery,
    folderId: activeFolderId || undefined,
    includeDescendants: true,
    category,
    sourceType,
    tagIds: selectedTagIds,
    tagMatch,
    includeTagDescendants: true,
    sort: "created_at_desc" as const,
    page,
    pageSize: 30,
  }), [activeFolderId, category, debouncedKeyword, page, selectedTagIds, smartViewQuery, sourceType, tagMatch]);

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
  }, [scope]);

  useEffect(() => {
    setPage(1);
  }, [activeFolderId, category, debouncedKeyword, selectedTagIds, smartView, sourceType, tagMatch]);

  useEffect(() => {
    Promise.allSettled([getAssetFolders(scope), listAllTags(scope, "asset"), listAssetExports(scope)]).then(([folderResult, tagResult, exportResult]) => {
      if (folderResult.status === "fulfilled") setFolders(folderResult.value);
      if (tagResult.status === "fulfilled") setTags(tagResult.value.filter((tag) => tag.asset_enabled));
      if (exportResult.status === "fulfilled") setExportBatches(exportResult.value);
    }).catch((error) => toast.error(publicApiError(error, "读取资产目录失败")));
  }, [refreshKey, scope]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const task = smartView === "trash" ? getTrashedAssetLibrary(scope, query, controller.signal) : getAssetLibrary(scope, query, controller.signal);
    task.then((result) => {
      setAssets(result.items || []);
      setTotal(result.total || 0);
      setSelectedId((current) => result.items.some((item) => item.id === current) ? current : result.items[0]?.id || "");
      setSelectedIds((ids) => ids.filter((id) => result.items.some((asset) => asset.id === id)));
    }).catch((error) => {
      if (!controller.signal.aborted) toast.error(publicApiError(error, "读取资产库失败"));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [query, refreshKey, scope, smartView]);

  useEffect(() => {
    setNoteDraft(selected?.note || selected?.user_state?.private_note || "");
  }, [selected?.id, selected?.note, selected?.user_state?.private_note]);

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

  const reloadExports = useCallback(() => listAssetExports(scope).then(setExportBatches).catch(() => undefined), [scope]);

  useEffect(() => {
    if (!exportBatches.some((batch) => batch.status === "queued" || batch.status === "running")) return;
    const timer = window.setInterval(() => void reloadExports(), 3000);
    return () => window.clearInterval(timer);
  }, [exportBatches, reloadExports]);

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
    if (!window.confirm(`删除文件夹“${folder?.name || activeFolderId}”？其中资产会回到默认归档目录。`)) return;
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

  return <div className="feature-page asset-library-page">
    <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => event.target.files && void handleFiles(event.target.files)} />
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
        {folders.map((folder) => <button key={folder.id} className={activeFolderId === folder.id ? "folder-row selected" : "folder-row"} onClick={() => { setActiveFolderId(folder.id); setMoveFolderId(folder.id); }}>{folder.name}<b>{folder.descendant_asset_count ?? folder.asset_count}</b></button>)}
        <hr />
        <button onClick={() => void createFolder()}><Plus size={14} /> 新建文件夹</button>
        <button onClick={() => void deleteFolder()} disabled={!activeFolderId}>删除当前文件夹</button>
      </aside>
      <section className="asset-browser" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void handleFiles(event.dataTransfer.files); }}>
        <div className="asset-browser-top"><div><button className="breadcrumb">{scope === "personal" ? "个人素材" : "团队素材"} <ChevronRight size={13} /></button><h2>{activeFolder?.name || smartViews.find((item) => item.value === smartView)?.label}</h2></div><div className="tag-search"><Search size={15} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索资产名称、来源或标签" /></div></div>
        <div className="asset-filter-bar">
          <select value={category} onChange={(event) => setCategory(event.target.value as AssetCategory | "")}>{assetCategoryOptions.map((item) => <option key={item.value || "all"} value={item.value}>{item.label}</option>)}</select>
          <select value={sourceType} onChange={(event) => setSourceType(event.target.value as AssetSourceType | "")}>{sourceTypeOptions.map((item) => <option key={item.value || "all"} value={item.value}>{item.label}</option>)}</select>
          <select value={uploadCategory} onChange={(event) => setUploadCategory(event.target.value as AssetCategory | "")}><option value="">上传不指定分类</option>{assetCategoryOptions.filter((item) => item.value).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          <button className="outline-button small" disabled={uploading} onClick={() => fileInputRef.current?.click()}><Upload size={15} /> {uploading ? "上传中…" : "导入资产"}</button>
        </div>
        <div className="upload-tag-row"><span>上传默认标签</span>{uploadTags.map((tag) => <button key={tag.id} className={uploadTagIds.includes(tag.id) ? "selected" : ""} onClick={() => toggleUploadTag(tag.id)}>#{tag.name}</button>)}{tags.length > 24 && <button className="more-tag-button" onClick={() => setShowAllUploadTags((value) => !value)}>{showAllUploadTags ? "收起标签" : `展开全部 ${tags.length}`}</button>}</div>
        <div className="asset-bulk-bar"><label><input type="checkbox" checked={assets.length > 0 && selectedIds.length === assets.length} onChange={(event) => setSelectedIds(event.target.checked ? assets.map((asset) => asset.id) : [])} /> 本页全选</label><span>已选 {bulkIds.length} 项</span><select value={moveFolderId} onChange={(event) => setMoveFolderId(event.target.value)}><option value="">移动到目录…</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select><button onClick={() => void moveSelectedAssets()} disabled={!moveFolderId || !bulkIds.length}>移动</button><button onClick={() => void deleteOrRestore()} disabled={!bulkIds.length}>{smartView === "trash" ? "恢复" : "删除"}</button>{smartView === "trash" && <button onClick={() => void permanentDeleteSelected()} disabled={!bulkIds.length}>永久删除</button>}{smartView === "trash" && <button onClick={() => void emptyTrash()}>清空回收站</button>}<button onClick={() => void applySelectedTags("add")} disabled={!selectedTagIds.length || !bulkIds.length}>追加筛选标签</button><button onClick={() => void applySelectedTags("remove")} disabled={!selectedTagIds.length || !bulkIds.length}>移除筛选标签</button><button onClick={() => void createExport("selected")} disabled={exportBusy === "selected" || !bulkIds.length}>导出选中</button><button onClick={() => void createExport("filter")} disabled={exportBusy === "filter"}>导出筛选</button><button onClick={() => void createExport("folder")} disabled={!activeFolderId || exportBusy === "folder"}>导出目录</button></div>
        {loading ? <div className="empty-output"><Loader2 className="spin" size={26} /><p>正在读取资产…</p></div> : assets.length ? <div className="asset-thumb-grid">{assets.map((asset) => <article key={asset.id} className={selected?.id === asset.id ? "library-asset selected" : "library-asset"}><label className="asset-check"><input type="checkbox" checked={selectedIds.includes(asset.id)} onChange={() => toggleSelectedAsset(asset.id)} /></label><button onClick={() => setSelectedId(asset.id)}>{previewUrls[asset.id] ? <img src={previewUrls[asset.id]} alt={asset.name} /> : <div className="empty-output"><ImageIcon size={22} /></div>}<span className="asset-category">{asset.category || asset.type}</span><i>{asset.id.slice(-8)}</i><div><b>{asset.name}</b><small>{asset.source_type || "unknown"}</small></div></button></article>)}</div> : <div className="empty-output"><Archive size={26} /><p>当前筛选下没有资产<br />可直接把文件拖入此区域上传。</p></div>}
        <div className="batch-actions"><button className="outline-button small" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button><span>{page} / {Math.max(1, Math.ceil(total / 30))}</span><button className="outline-button small" disabled={page * 30 >= total} onClick={() => setPage((value) => value + 1)}>下一页</button></div>
      </section>
      <aside className="asset-detail">{selected ? <><div className="detail-head"><div><p className="eyebrow">ASSET / {selected.id.slice(-8)}</p><h3>{selected.name}</h3></div><button className="icon-button subtle" onClick={() => void deleteOrRestore()}>{smartView === "trash" ? <Archive size={16} /> : <Trash2 size={16} />}</button></div>{previewUrls[selected.id] ? <img className="detail-image" src={previewUrls[selected.id]} alt={selected.name} /> : <div className="empty-output"><ImageIcon size={28} /></div>}<div className="detail-tabs">{["详情", "血缘", "使用", "导出"].map((tab) => <button className={detailTab === tab ? "active" : ""} onClick={() => setDetailTab(tab)} key={tab}>{tab}</button>)}</div>{detailTab === "详情" ? <div className="asset-metadata"><div><span>分类</span><b>{selected.category || selected.type}</b></div><div><span>来源</span><b>{selected.source_type || "unknown"}</b></div><div><span>体积</span><b>{selected.size ? `${(selected.size / 1024 / 1024).toFixed(2)} MB` : "—"}</b></div><div><span>标签</span><b>{selected.tags?.join(" · ") || "未绑定"}</b></div><label className="asset-note-editor"><span>备注</span><textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} /><button onClick={() => void saveNote()}>保存备注</button></label></div> : detailTab === "血缘" ? <div className="lineage-flow"><span>{selected.source_type || "来源未知"}</span><i /><strong>{selected.name}</strong></div> : detailTab === "使用" ? <div className="usage-list"><div><b>生成调用</b><small>{selected.usage_stats?.generation_use_count || 0} 次</small></div><div><b>有效引用</b><small>{selected.usage_stats?.active_reference_count || 0} 处</small></div><div><b>下载导出</b><small>{(selected.usage_stats?.download_count || 0) + (selected.usage_stats?.export_count || 0)} 次</small></div></div> : <div className="export-list">{exportBatches.slice(0, 5).map((batch) => <div key={batch.id}><span className={`status-chip ${batch.status}`}>{formatStatus(batch.status)}</span><b>{batch.succeeded}/{batch.total}</b><small>{batch.file_name || batch.id.slice(-8)}</small>{batch.status === "succeeded" || batch.status === "partial_failed" ? <button onClick={() => void downloadAssetExport(batch.id, scope).then((blob) => downloadBlob(blob, batch.file_name || `${batch.id}.zip`))}>下载</button> : batch.status === "queued" || batch.status === "running" ? <button onClick={() => void cancelAssetExport(batch.id, scope).then(reloadExports)}>取消</button> : null}</div>)}</div>}<div className="asset-detail-actions"><button onClick={() => void toggleReaction("favorite")}><Sparkles size={15} /> {selected.user_state?.reaction === "favorite" ? "取消收藏" : "收藏"}</button><button onClick={() => void toggleReaction("dislike")}><Trash2 size={15} /> {selected.user_state?.reaction === "dislike" ? "取消踩" : "踩"}</button><button onClick={() => void getAssetContentObjectUrl(selected.id, scope).then((url) => fetch(url).then((resp) => resp.blob()).then((blob) => { downloadBlob(blob, selected.name); URL.revokeObjectURL(url); }))}><Archive size={15} /> 下载</button></div></> : <div className="empty-output"><p>选择一项资产查看详情</p></div>}</aside>
    </div>
  </div>;
}

export function TagLibraryView() {
  const [scope, setScope] = useState<WorkspaceScope>(() => initialScopeFromSearch());
  const [tags, setTags] = useState<SemanticTag[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get("tag") || "");
  const [alias, setAlias] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [moveParentId, setMoveParentId] = useState("");
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (preferredId?: string) => {
    setLoading(true);
    try {
      const items = await listAllTags(scope);
      setTags(items);
      setSelectedId((current) => preferredId || (items.some((item) => item.id === current) ? current : items[0]?.id || ""));
      setSelectedIds((ids) => ids.filter((id) => items.some((item) => item.id === id)));
    } catch (error) {
      toast.error(publicApiError(error, "读取标签库失败"));
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { void reload(); }, [reload]);
  const current = tags.find((tag) => tag.id === selectedId);
  const visibleTags = tags.filter((tag) => !query.trim() || tag.name.toLowerCase().includes(query.trim().toLowerCase()) || tag.aliases?.some((item) => item.alias.toLowerCase().includes(query.trim().toLowerCase())));
  const roots = visibleTags.filter((tag) => !tag.parent_id || !tags.some((parent) => parent.id === tag.parent_id));
  const parentOptions = tags.filter((tag) => tag.id !== current?.id);
  useEffect(() => { setDraftName(current?.name || ""); setDraftDescription(current?.description || ""); setMoveParentId(current?.parent_id || ""); }, [current?.description, current?.id, current?.name, current?.parent_id]);

  const toggle = (id: string) => setSelectedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  const addTag = async (parentId = "") => { const name = window.prompt(parentId ? "新子标签名称" : "新标签名称"); if (!name?.trim()) return; const created = await createTag(scope, { parent_id: parentId || undefined, name: name.trim(), asset_enabled: true, prompt_enabled: true, inherit_mode: "auto", scope_type: scope === "team" ? "workspace" : "user" }); await reload(created.id); };
  const saveCurrent = async () => { if (!current || !draftName.trim()) return; const saved = await updateTag(scope, current.id, { name: draftName.trim(), description: draftDescription.trim(), asset_enabled: current.asset_enabled, prompt_enabled: current.prompt_enabled, inherit_mode: current.inherit_mode, status: current.status, sort_order: current.sort_order }); setTags((items) => items.map((item) => item.id === saved.id ? saved : item)); };
  const moveCurrent = async () => { if (!current || !current.editable) return; await bulkMoveTags(scope, [current.id], moveParentId || undefined); await reload(current.id); };
  const archiveCurrent = async () => { if (!current || !window.confirm(`删除“${current.name}”及其可归档子标签？`)) return; await deleteTag(scope, current.id); await reload(); };
  const bulkMoveSelected = async () => { if (!selectedIds.length) return; await bulkMoveTags(scope, selectedIds, moveParentId || undefined); setSelectedIds([]); await reload(); };
  const bulkDeleteSelected = async () => { if (!selectedIds.length || !window.confirm(`删除 ${selectedIds.length} 个标签及其可归档子标签？`)) return; await bulkDeleteTags(scope, selectedIds); setSelectedIds([]); await reload(); };
  const addAlias = async () => { if (!current || !alias.trim()) return; await createTagAlias(scope, current.id, alias.trim()); setAlias(""); await reload(current.id); };
  const renderTag = (tag: SemanticTag, child = false) => <button key={tag.id} className={`${selectedId === tag.id ? "selected" : ""} ${child ? "child" : ""}`} onClick={() => setSelectedId(tag.id)}><input type="checkbox" checked={selectedIds.includes(tag.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(tag.id)} />{child ? <Hash size={13} /> : <ChevronRight size={13} />}{tag.name}<span>{tag.asset_count || tag.prompt_count || 0}</span></button>;

  return <div className="feature-page tag-page">
    <SurfaceTitle eyebrow={`TAXONOMY / ${tags.length}`} title="标签库" description="标签可同时服务资产与提示词，并支持删除、批量删除、移动和批量移动。"
      actions={<div className="scope-switch">{scopeOptions.map((item) => <button key={item.value} className={scope === item.value ? "active" : ""} onClick={() => setScope(item.value)}>{item.label}</button>)}<button className="vermilion-button" onClick={() => void addTag()}><Plus size={16} /> 新建标签</button></div>} />
    <div className="tag-bulk-toolbar"><span>已选 {selectedIds.length} 个标签</span><select value={moveParentId} onChange={(e) => setMoveParentId(e.target.value)}><option value="">移动到根级</option>{parentOptions.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select><button onClick={() => void bulkMoveSelected()} disabled={!selectedIds.length}>批量移动</button><button onClick={() => void bulkDeleteSelected()} disabled={!selectedIds.length}>批量删除</button></div>
    <div className="tag-workspace"><aside className="tag-tree"><div className="tag-search"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="检索标签" /></div>{loading ? <small>读取中…</small> : roots.map((root) => <div className="tag-group" key={root.id}>{renderTag(root)}{tagChildren(visibleTags, root.id).map((child) => renderTag(child, true))}</div>)}</aside><section className="tag-editor">{current ? <><div className="tag-editor-head"><div><p className="eyebrow">{current.scope_type} / SEMANTIC TAG</p><h2>#{current.name}</h2></div><div><button className="icon-button subtle" onClick={() => void addTag(current.id)} disabled={!current.editable}><Plus size={16} /></button><button className="icon-button subtle" onClick={() => void archiveCurrent()} disabled={!current.editable}><Trash2 size={16} /></button></div></div><div className="tag-description"><span className="field-label">名称</span><input value={draftName} onChange={(e) => setDraftName(e.target.value)} disabled={!current.editable} /><span className="field-label">描述</span><textarea value={draftDescription} onChange={(e) => setDraftDescription(e.target.value)} disabled={!current.editable} /></div><div className="tag-settings"><label>移动到<select value={moveParentId} onChange={(e) => setMoveParentId(e.target.value)} disabled={!current.editable}><option value="">根级</option>{parentOptions.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label><label>作用范围<div className="tag-select">{current.asset_enabled && current.prompt_enabled ? "资产 + 提示词" : current.asset_enabled ? "资产" : "提示词"} <ChevronRight size={14} /></div></label></div><section className="aliases"><div><span className="field-label">别名</span><small>搜索时一并匹配</small></div><div className="alias-list">{current.aliases?.map((item) => <span key={item.id}>{item.alias}<button onClick={async () => { await deleteTagAlias(scope, current.id, item.id); await reload(current.id); }}>×</button></span>)}</div><div className="alias-create"><input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="添加别名" /><button onClick={() => void addAlias()}>添加</button></div></section><div className="tag-editor-actions"><button className="outline-button" disabled={!current.editable} onClick={() => void moveCurrent()}>移动标签</button><button className="vermilion-button" disabled={!current.editable} onClick={() => void saveCurrent()}><Check size={16} /> 保存标签</button></div></> : <div className="empty-output"><p>当前没有可编辑标签</p></div>}</section><aside className="tag-relations"><p className="eyebrow">CONNECTIONS</p><div><b>{current?.asset_count || 0}</b><span>关联资产</span><button onClick={() => current && window.location.assign(`/assets?scope=${encodeURIComponent(scope)}&tag=${encodeURIComponent(current.id)}`)}>查看资产 <ArrowUpRight size={14} /></button></div><div><b>{current?.prompt_count || 0}</b><span>提示词模板</span><button onClick={() => current && window.location.assign(`/prompts?tag=${encodeURIComponent(current.name)}`)}>查看提示词 <ArrowUpRight size={14} /></button></div></aside></div>
  </div>;
}

export function PromptLibraryView() {
  const [presets, setPresets] = useState<PromptPreset[]>([]);
  const [activeId, setActiveId] = useState("");
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get("tag") || "");
  const [loading, setLoading] = useState(true);
  const active = presets.find((item) => item.id === activeId) || presets[0];
  const visible = presets.filter((item) => !query.trim() || item.priority === query || item.title.includes(query) || item.prompt.includes(query) || item.tags.some((tag) => tag.includes(query))).sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.sort_order - b.sort_order || a.title.localeCompare(b.title, "zh-CN"));
  const commonTags = Array.from(new Set(presets.flatMap((item) => item.tags))).slice(0, 12);

  useEffect(() => {
    setLoading(true);
    getPreferences().then((preferences) => {
      const items = preferences.canvas?.promptPresets || [];
      setPresets(items);
      setActiveId(items[0]?.id || "");
    }).catch((error) => toast.error(publicApiError(error, "读取个人提示词失败"))).finally(() => setLoading(false));
  }, []);

  const persist = async (next: PromptPreset[], success: string) => {
    const normalized = next.map((item, index) => ({ ...item, sort_order: item.sort_order ?? index }));
    const preferences = await updatePreferences({ canvas: { promptPresets: normalized } });
    const saved = preferences.canvas?.promptPresets || normalized;
    setPresets(saved);
    setActiveId(saved[0]?.id || "");
    toast.success(success);
  };

  const createPreset = async () => {
    const now = new Date().toISOString();
    const created: PromptPreset = { id: crypto.randomUUID(), title: "未命名提示词", prompt: "请在此填写提示词内容。", tags: [], priority: "normal", sort_order: presets.length, createdAt: now, updatedAt: now };
    setActiveId(created.id);
    await persist([...presets, created], "已创建提示词预设");
  };

  const patchActive = (patch: Partial<PromptPreset>) => active && setPresets((items) => items.map((item) => item.id === active.id ? { ...item, ...patch } : item));
  const moveActive = async (direction: -1 | 1) => {
    if (!active) return;
    const samePriority = presets
      .filter((item) => item.priority === active.priority)
      .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title, "zh-CN"));
    const index = samePriority.findIndex((item) => item.id === active.id);
    const target = samePriority[index + direction];
    if (!target) return;
    await persist(presets.map((item) => {
      if (item.id === active.id) return { ...item, sort_order: target.sort_order };
      if (item.id === target.id) return { ...item, sort_order: active.sort_order };
      return item;
    }), "提示词顺序已更新");
    setActiveId(active.id);
  };

  return <div className="feature-page prompt-page">
    <SurfaceTitle eyebrow={`PROMPTS / ${presets.length}`} title="个人提示词库" description="私人提示词和个人主页共用同一份偏好数据。"
      actions={<button className="vermilion-button" onClick={() => void createPreset()}><Plus size={16} /> 新建预设</button>} />
    <div className="prompt-workspace"><aside className="prompt-filters"><div className="tag-search"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="关键词、标签或优先级" /></div><p className="field-label">PRIORITY</p>{[["置顶", "pinned"], ["高", "high"], ["普通", "normal"], ["低", "low"]].map(([name, key]) => <button onClick={() => setQuery(key)} key={key}><span>{name}</span><b>{presets.filter((item) => item.priority === key).length}</b></button>)}<hr /><p className="field-label">常用标签</p>{commonTags.map((tag) => <button className="tag-filter" onClick={() => setQuery(tag)} key={tag}>#{tag}</button>)}</aside><section className="template-list"><div className="template-list-head"><span>{loading ? "读取中…" : `匹配到 ${visible.length} 条视觉片段`}</span></div>{visible.map((item) => <button className={active?.id === item.id ? "template-card selected" : "template-card"} onClick={() => setActiveId(item.id)} key={item.id}><div><span>{priorityLabel(item.priority)}</span><b>{item.title}</b><p>{item.prompt || "尚未填写提示词"}</p></div><div className="template-card-tags">{item.tags.map((tag) => <i key={tag}>#{tag}</i>)}</div></button>)}</section><aside className="prompt-preview">{active ? <><div><p className="eyebrow">PRESET PREVIEW</p><input value={active.title} onChange={(e) => patchActive({ title: e.target.value })} /></div><div className="preview-tags">{active.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div><textarea value={active.prompt} onChange={(e) => patchActive({ prompt: e.target.value })} /><input value={active.tags.join(", ")} onChange={(e) => patchActive({ tags: e.target.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) })} placeholder="标签，以逗号分隔" /><select value={active.priority} onChange={(e) => patchActive({ priority: e.target.value as PromptPreset["priority"] })}><option value="pinned">置顶</option><option value="high">高</option><option value="normal">普通</option><option value="low">低</option></select><div className="prompt-order-actions"><button onClick={() => void moveActive(-1)}>上移</button><button onClick={() => void moveActive(1)}>下移</button></div><button className="vermilion-button" onClick={() => void persist(presets.map((item) => item.id === active.id ? { ...item, updatedAt: new Date().toISOString() } : item), "提示词已保存")}><Check size={16} /> 保存预设</button><button className="full-outline" onClick={() => { sessionStorage.setItem("ai-manju:image-prompt", active.prompt); window.location.assign("/image"); }}><WandSparkles size={16} /> 送入关键帧</button><button className="full-outline" onClick={async () => { await navigator.clipboard.writeText(active.prompt); toast.success("提示词已复制"); }}><FileText size={15} /> 复制完整提示词</button><button className="full-outline" onClick={() => { if (window.confirm(`删除“${active.title}”？`)) void persist(presets.filter((item) => item.id !== active.id), "提示词已删除"); }}><Trash2 size={15} /> 删除预设</button></> : <div className="empty-output"><p>暂无个人提示词预设</p></div>}</aside></div>
  </div>;
}

export function ProfileView() {
  const { user } = useAuth();
  const { data } = useWorkspaceDashboardData();
  const [preferences, setPreferences] = useState<PromptPreset[]>([]);
  const [activePresetId, setActivePresetId] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    getPreferences().then((result) => {
      const presets = result.canvas?.promptPresets || [];
      setPreferences(presets);
      setActivePresetId(presets[0]?.id || "");
    }).catch(() => undefined);
  }, []);
  const promptCount = preferences.length;
  const activePreset = preferences.find((item) => item.id === activePresetId) || preferences[0];
  const persistProfilePresets = async (next: PromptPreset[], message: string) => {
    setSaving(true);
    try {
      const normalized = next.map((item, index) => ({ ...item, sort_order: item.sort_order ?? index, updatedAt: item.updatedAt || new Date().toISOString() }));
      const saved = await updatePreferences({ canvas: { promptPresets: normalized } });
      const presets = saved.canvas?.promptPresets || normalized;
      setPreferences(presets);
      setActivePresetId((current) => presets.some((item) => item.id === current) ? current : presets[0]?.id || "");
      toast.success(message);
    } catch (error) {
      toast.error(publicApiError(error, "保存个人提示词失败"));
    } finally {
      setSaving(false);
    }
  };
  const createProfilePreset = async () => {
    const now = new Date().toISOString();
    const preset: PromptPreset = { id: crypto.randomUUID(), title: "未命名提示词", prompt: "", tags: [], priority: "normal", sort_order: preferences.length, createdAt: now, updatedAt: now };
    setActivePresetId(preset.id);
    await persistProfilePresets([...preferences, preset], "个人提示词已创建");
  };
  const patchProfilePreset = (patch: Partial<PromptPreset>) => activePreset && setPreferences((items) => items.map((item) => item.id === activePreset.id ? { ...item, ...patch } : item));
  return <div className="feature-page profile-page">
    <SurfaceTitle eyebrow="PROFILE / YOU" title="个人主页" description="把常用模型、提示词预设和工作区状态集中放在一个页面里。"
      actions={<button className="outline-button small" onClick={() => window.location.assign("/prompts")}>打开提示词库</button>} />
    <div className="profile-workspace">
      <section className="profile-card"><p className="eyebrow">ACCOUNT</p><h2>{user?.display_name || user?.username || "—"}</h2><p>{user?.role}</p><div className="profile-stats"><div><b>{data.projects.total ?? "—"}</b><span>项目</span></div><div><b>{data.assets.total ?? "—"}</b><span>资产</span></div><div><b>{data.jobs.total ?? "—"}</b><span>运行中</span></div><div><b>{promptCount}</b><span>提示词预设</span></div></div></section>
      <section className="profile-card"><p className="eyebrow">SHORTCUTS</p><button onClick={() => window.location.assign("/prompts")}>进入完整提示词库</button><button onClick={() => window.location.assign("/assets")}>进入资产库</button><button onClick={() => window.location.assign("/canvas")}>打开画布</button><button onClick={() => window.location.assign("/image")}>打开关键帧生成</button></section>
      <section className="profile-card profile-prompt-manager">
        <div className="profile-card-head"><div><p className="eyebrow">PRIVATE PROMPTS</p><h2>个人提示词预设</h2></div><button className="outline-button small" onClick={() => void createProfilePreset()}><Plus size={15} /> 新建</button></div>
        <div className="profile-prompt-grid">
          <div className="profile-prompt-list">{preferences.length ? [...preferences].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.sort_order - b.sort_order).map((preset) => <button key={preset.id} className={activePreset?.id === preset.id ? "selected" : ""} onClick={() => setActivePresetId(preset.id)}><span>{priorityLabel(preset.priority)}</span><b>{preset.title}</b><small>{preset.tags.join(" / ") || preset.prompt.slice(0, 40) || "未填写"}</small></button>) : <div className="empty-output"><p>暂无个人提示词，点击新建开始。</p></div>}</div>
          <div className="profile-prompt-editor">{activePreset ? <><input value={activePreset.title} onChange={(event) => patchProfilePreset({ title: event.target.value })} placeholder="标题" /><textarea value={activePreset.prompt} onChange={(event) => patchProfilePreset({ prompt: event.target.value })} placeholder="提示词内容" /><input value={activePreset.tags.join(", ")} onChange={(event) => patchProfilePreset({ tags: event.target.value.split(/[,，]/).map((item) => item.trim()).filter(Boolean) })} placeholder="标签，以逗号分隔" /><select value={activePreset.priority} onChange={(event) => patchProfilePreset({ priority: event.target.value as PromptPreset["priority"] })}><option value="pinned">置顶</option><option value="high">高</option><option value="normal">普通</option><option value="low">低</option></select><div className="profile-prompt-actions"><button className="vermilion-button" disabled={saving} onClick={() => void persistProfilePresets(preferences, "个人提示词已保存")}><Check size={15} /> 保存</button><button className="outline-button small" onClick={() => { sessionStorage.setItem("ai-manju:image-prompt", activePreset.prompt); window.location.assign("/image"); }}><WandSparkles size={15} /> 送入关键帧</button><button className="outline-button small" onClick={() => void navigator.clipboard.writeText(activePreset.prompt).then(() => toast.success("提示词已复制"))}><FileText size={15} /> 复制</button><button className="outline-button small" onClick={() => window.confirm(`删除“${activePreset.title}”？`) && void persistProfilePresets(preferences.filter((item) => item.id !== activePreset.id), "个人提示词已删除")}><Trash2 size={15} /> 删除</button></div></> : <div className="empty-output"><p>选择一个提示词进行编辑。</p></div>}</div>
        </div>
      </section>
    </div>
  </div>;
}
