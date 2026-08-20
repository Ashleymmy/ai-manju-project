import {
  Archive,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  Clapperboard,
  FileText,
  FolderOpen,
  Hash,
  Image as ImageIcon,
  ImagePlus,
  Layers3,
  Loader2,
  Plus,
  RefreshCcw,
  Search,
  Sparkles,
  Square,
  Tag,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
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
  createWorkspaceTag,
  createTagAlias,
  deleteAssetFolder,
  deleteTag,
  deleteTagAlias,
  downloadAssetExport,
  emptyAssetTrash,
  fetchImageModels,
  generateImages,
  getAsset,
  getAssetContentObjectUrl,
  getAssetFolders,
  getAssetLibrary,
  getAssetLineage,
  getAssetUsageEvents,
  getPreferences,
  getProject,
  getProjects,
  getProjectSnapshot,
  getPromptLibrary,
  getTrashedAssetLibrary,
  imageModelLabel,
  listAllTags,
  listTagAssets,
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
  type AssetLineageView,
  type AssetSourceType,
  type AssetUsageEvent,
  type CanvasProject,
  type GeneratedImage,
  type ImageModelCatalog,
  type PromptPreset,
  type SemanticTag,
  type SystemPrompt,
  type WorkspaceScope,
} from "@/services/api";
import { collectTagSubtreeIds, filterTagsWithAncestors, flattenTagTree, semanticTagPath } from "@/lib/tag-tree";
import { assetPackageUploadMetadata, createAssetPackage, readAssetPackage } from "@/lib/asset-transfer";
import PromptLibraryDialog from "@/components/PromptLibraryDialog";

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

const MAX_REFERENCE_IMAGES = 11;

type ReferenceImage = { id: string; file: File; previewUrl: string };

const qualityOptions: Array<Option<"auto" | "low" | "medium" | "high">> = [
  { value: "auto", label: "AUTO" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];

export function ImageWorkbenchView() {
  const [, navigate] = useLocation();
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [scope, setScope] = useState<WorkspaceScope>(() => initialScopeFromSearch());
  const [model, setModel] = useState("");
  const [catalog, setCatalog] = useState<ImageModelCatalog | null>(null);
  const [size, setSize] = useState<"auto" | "1:1" | "16:9" | "9:16">("auto");
  const [quality, setQuality] = useState<"auto" | "low" | "medium" | "high">("auto");
  const [count, setCount] = useState(1);
  const [prompt, setPrompt] = useState("雨夜，狭长街道，潮湿沥青反射红色招牌；人物在画面右侧停留，低机位缓慢推近，电影级冷暖对比。");
  const [promptPresets, setPromptPresets] = useState<PromptPreset[]>([]);
  const [promptLibraryOpen, setPromptLibraryOpen] = useState(false);
  const [references, setReferences] = useState<ReferenceImage[]>([]);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [assetPickerKeyword, setAssetPickerKeyword] = useState("");
  const [assetPickerItems, setAssetPickerItems] = useState<Asset[]>([]);
  const [assetPickerUrls, setAssetPickerUrls] = useState<Record<string, string>>({});
  const [result, setResult] = useState<GeneratedImage[]>([]);
  const [resultUrls, setResultUrls] = useState<Record<string, string>>({});
  const [selectedResult, setSelectedResult] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [history, setHistory] = useState<Asset[]>([]);
  const [historyUrls, setHistoryUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchImageModels().then((next) => { setCatalog(next); setModel(next.defaultModel); }).catch((error) => toast.error(publicApiError(error, "读取图像模型失败")));
    getPreferences().then((preferences) => {
      setPromptPresets(preferences.canvas?.promptPresets || []);
      const generation = preferences.generation || {};
      if (generation.imageModel) setModel((current) => current || generation.imageModel || "");
      if (generation.size && ["auto", "1:1", "16:9", "9:16"].includes(generation.size)) setSize(generation.size as typeof size);
      if (generation.count) setCount(Math.max(1, Math.min(15, Number(generation.count) || 1)));
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const presetPrompt = sessionStorage.getItem("ai-manju:image-prompt");
    if (presetPrompt) {
      setPrompt(presetPrompt);
      sessionStorage.removeItem("ai-manju:image-prompt");
    }
  }, []);

  const addReferenceFiles = useCallback((files: FileList | File[]) => {
    const list = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (!list.length) return;
    setReferences((current) => {
      const room = MAX_REFERENCE_IMAGES - current.length;
      if (room <= 0) {
        toast.error(`参考图最多 ${MAX_REFERENCE_IMAGES} 张`);
        return current;
      }
      if (list.length > room) toast.info(`参考图达到上限，仅加入前 ${room} 张`);
      return [...current, ...list.slice(0, room).map((file) => ({ id: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file) }))];
    });
  }, []);

  const addAssetAsReference = useCallback(async (asset: Pick<Asset, "id" | "name">) => {
    try {
      const url = await getAssetContentObjectUrl(asset.id, scope);
      const blob = await fetch(url).then((response) => response.blob());
      URL.revokeObjectURL(url);
      addReferenceFiles([new File([blob], asset.name || `${asset.id}.png`, { type: blob.type || "image/png" })]);
    } catch (error) {
      toast.error(publicApiError(error, "读取资产内容失败"));
    }
  }, [addReferenceFiles, scope]);

  useEffect(() => {
    const referenceAssetId = sessionStorage.getItem("ai-manju:image-reference-asset");
    if (!referenceAssetId) return;
    sessionStorage.removeItem("ai-manju:image-reference-asset");
    void addAssetAsReference({ id: referenceAssetId, name: `${referenceAssetId}.png` });
  }, [addAssetAsReference]);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!generating) return;
    setElapsedSeconds(0);
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1_000);
    return () => window.clearInterval(timer);
  }, [generating]);

  const reloadHistory = useCallback(() => {
    getAssetLibrary(scope, { sourceType: "image_workbench", sort: "created_at_desc", page: 1, pageSize: 12 })
      .then((response) => setHistory(response.items || []))
      .catch(() => undefined);
  }, [scope]);

  useEffect(() => { reloadHistory(); }, [reloadHistory]);

  useEffect(() => {
    let disposed = false;
    const urls: Record<string, string> = {};
    Promise.all(history.map(async (asset) => {
      try {
        const url = await getAssetContentObjectUrl(asset.id, scope, 320);
        if (disposed) URL.revokeObjectURL(url);
        else urls[asset.id] = url;
      } catch {
        undefined;
      }
    })).then(() => { if (!disposed) setHistoryUrls(urls); });
    return () => {
      disposed = true;
      Object.values(urls).forEach(URL.revokeObjectURL);
    };
  }, [history, scope]);

  useEffect(() => {
    const pending = result.filter((image) => !image.src && image.assetId);
    if (!pending.length) return;
    let disposed = false;
    const urls: Record<string, string> = {};
    Promise.all(pending.map(async (image) => {
      try {
        const url = await getAssetContentObjectUrl(image.assetId as string, scope, 640);
        if (disposed) URL.revokeObjectURL(url);
        else urls[image.assetId as string] = url;
      } catch {
        undefined;
      }
    })).then(() => { if (!disposed) setResultUrls(urls); });
    return () => {
      disposed = true;
      Object.values(urls).forEach(URL.revokeObjectURL);
    };
  }, [result, scope]);

  useEffect(() => {
    if (!assetPickerOpen) return;
    const controller = new AbortController();
    getAssetLibrary(scope, {
      keyword: assetPickerKeyword.trim() || undefined,
      sort: "created_at_desc",
      page: 1,
      pageSize: 12,
    }, controller.signal).then((response) => {
      setAssetPickerItems((response.items || []).filter((asset) => asset.type === "image"));
    }).catch(() => undefined);
    return () => controller.abort();
  }, [assetPickerKeyword, assetPickerOpen, scope]);

  useEffect(() => {
    let disposed = false;
    const urls: Record<string, string> = {};
    Promise.all(assetPickerItems.map(async (asset) => {
      try {
        const url = await getAssetContentObjectUrl(asset.id, scope, 320);
        if (disposed) URL.revokeObjectURL(url);
        else urls[asset.id] = url;
      } catch {
        undefined;
      }
    })).then(() => { if (!disposed) setAssetPickerUrls(urls); });
    return () => {
      disposed = true;
      Object.values(urls).forEach(URL.revokeObjectURL);
    };
  }, [assetPickerItems, scope]);

  const selectedImage = useMemo(() => result[selectedResult] || result[0], [result, selectedResult]);
  const visiblePromptPresets = useMemo(() => [...promptPresets]
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.sort_order - b.sort_order || a.title.localeCompare(b.title, "zh-CN"))
    .slice(0, 8), [promptPresets]);
  const resultSrc = useCallback((image: GeneratedImage) => image.src || (image.assetId ? resultUrls[image.assetId] || "" : ""), [resultUrls]);

  const removeReference = (id: string) => setReferences((items) => {
    const target = items.find((item) => item.id === id);
    if (target) URL.revokeObjectURL(target.previewUrl);
    return items.filter((item) => item.id !== id);
  });

  const moveReference = (id: string, direction: -1 | 1) => setReferences((items) => {
    const index = items.findIndex((item) => item.id === id);
    const swap = index + direction;
    if (index < 0 || swap < 0 || swap >= items.length) return items;
    const next = [...items];
    [next[index], next[swap]] = [next[swap], next[index]];
    return next;
  });

  const generate = async (overrideCount?: number) => {
    if (generating || !model) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setGenerating(true);
    setResult([]);
    setResultUrls({});
    setSelectedResult(0);
    setJobProgress(0);
    try {
      const generated = await generateImages({
        model,
        prompt,
        size,
        quality,
        count: overrideCount ?? count,
        referenceFiles: references.map((item) => item.file),
        scope,
        sourceType: "image_workbench",
      }, {
        signal: controller.signal,
        onAccepted: (job) => setJobId(job.job_id || job.id || null),
        onProgress: (job) => { setJobId(job.id); setJobProgress(job.progress ?? 0); },
      });
      setResult(generated.images);
      setJobProgress(100);
      toast.success(`生成完成，共 ${generated.images.length} 张`);
      reloadHistory();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") toast.info("已停止本次生成");
      else toast.error(publicApiError(error, "图像生成失败"));
    } finally {
      abortRef.current = null;
      setGenerating(false);
    }
  };

  const stopGeneration = () => {
    abortRef.current?.abort();
  };

  const downloadResult = async (image: GeneratedImage) => {
    try {
      let src = image.src;
      let revoke = false;
      if (!src && image.assetId) {
        src = await getAssetContentObjectUrl(image.assetId, scope);
        revoke = true;
      }
      if (!src) return toast.info("此结果暂无可下载内容");
      const blob = await fetch(src).then((response) => response.blob());
      downloadBlob(blob, image.name || `${image.assetId || image.id}.png`);
      if (revoke) URL.revokeObjectURL(src);
    } catch (error) {
      toast.error(publicApiError(error, "下载失败"));
    }
  };

  const addResultAsReference = async (image: GeneratedImage) => {
    if (image.assetId) return addAssetAsReference({ id: image.assetId, name: image.name || `${image.assetId}.png` });
    if (!image.src) return;
    const blob = await fetch(image.src).then((response) => response.blob());
    addReferenceFiles([new File([blob], image.name || `${image.id}.png`, { type: blob.type || "image/png" })]);
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
    <input ref={referenceInputRef} type="file" accept="image/*" multiple hidden onChange={(event) => { if (event.target.files) addReferenceFiles(event.target.files); event.target.value = ""; }} />
    <PromptLibraryDialog open={promptLibraryOpen} onOpenChange={setPromptLibraryOpen} onSelect={(value) => { setPrompt(value); setPromptLibraryOpen(false); }} />
    <SurfaceTitle eyebrow="KEYFRAME / NEW" title="关键帧生成" description="走真实模型与队列，支持参考图编辑，把结果直接送回画布。"
      actions={<div className="scope-switch">{scopeOptions.map((item) => <button key={item.value} className={scope === item.value ? "active" : ""} onClick={() => setScope(item.value)}>{item.label}</button>)}</div>} />
    <div className="image-workbench">
      <section className="image-composer" onPaste={(event) => {
        const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith("image/"));
        if (files.length) { event.preventDefault(); addReferenceFiles(files); }
      }}>
        <div className="composer-tabs"><button className={references.length ? "" : "active"} onClick={() => references.length && toast.info("移除全部参考图即可回到文生图")}>文生图</button><button className={references.length ? "active" : ""} onClick={() => !references.length && toast.info("添加参考图后自动切换为图生图")}>图生图 {references.length ? `· ${references.length}` : ""}</button></div>
        <label className="prompt-editor"><span>SHOT PROMPT</span><textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} /><small>{prompt.length} 字符</small></label>
        <div className="workbench-preset-strip"><span>提示词</span><button onClick={() => setPromptLibraryOpen(true)}><BookOpen size={13} /> 提示词库</button>{visiblePromptPresets.map((preset) => <button key={preset.id} title={preset.prompt} onClick={() => setPrompt(preset.prompt)}>{priorityLabel(preset.priority)} · {preset.title}</button>)}</div>
        <div className="reference-manager">
          <div className="reference-manager-head"><span>参考图 {references.length}/{MAX_REFERENCE_IMAGES}</span><div><button onClick={() => referenceInputRef.current?.click()}><Upload size={13} /> 上传</button><button onClick={() => setAssetPickerOpen((value) => !value)}><ImagePlus size={13} /> 从资产库</button>{references.length > 0 && <button onClick={() => { references.forEach((item) => URL.revokeObjectURL(item.previewUrl)); setReferences([]); }}>清空</button>}</div></div>
          {references.length ? <div className="reference-strip">{references.map((reference, index) => <div className="reference-thumb" key={reference.id}><img src={reference.previewUrl} alt={reference.file.name} /><span>{index + 1}</span><div className="reference-thumb-actions"><button title="前移" disabled={index === 0} onClick={() => moveReference(reference.id, -1)}><ArrowUp size={12} /></button><button title="后移" disabled={index === references.length - 1} onClick={() => moveReference(reference.id, 1)}><ArrowDown size={12} /></button><button title="移除" onClick={() => removeReference(reference.id)}><X size={12} /></button></div></div>)}</div> : <p className="reference-empty">粘贴、上传或从资产库选择参考图后，会自动走图生图编辑链路。</p>}
          {assetPickerOpen && <div className="reference-asset-picker"><div className="tag-search"><Search size={14} /><input value={assetPickerKeyword} onChange={(event) => setAssetPickerKeyword(event.target.value)} placeholder="搜索资产库图片" /></div><div className="reference-asset-grid">{assetPickerItems.map((asset) => <button key={asset.id} title={asset.name} onClick={() => void addAssetAsReference(asset)}>{assetPickerUrls[asset.id] ? <img src={assetPickerUrls[asset.id]} alt={asset.name} /> : <ImageIcon size={18} />}<span>{asset.name}</span></button>)}{!assetPickerItems.length && <small>没有匹配的图片资产</small>}</div></div>}
        </div>
        <div className="composer-options">
          <label>模型<select value={model} onChange={(e) => setModel(e.target.value)}>{catalog?.models.map((item) => <option key={item} value={item}>{imageModelLabel(item, catalog)}</option>)}</select></label>
          <label>画幅<div className="ratio-buttons">{(["auto", "1:1", "16:9", "9:16"] as const).map((ratio) => <button key={ratio} className={size === ratio ? "active" : ""} onClick={() => setSize(ratio)}>{ratio === "auto" ? "AUTO" : ratio}</button>)}</div></label>
          <label>质量<div className="ratio-buttons">{qualityOptions.map((item) => <button key={item.value} className={quality === item.value ? "active" : ""} onClick={() => setQuality(item.value)}>{item.label}</button>)}</div></label>
          <label>数量<div className="counter"><button onClick={() => setCount((v) => Math.max(1, v - 1))}>−</button><b>{String(count).padStart(2, "0")}</b><button onClick={() => setCount((v) => Math.min(15, v + 1))}>+</button></div></label>
        </div>
        {generating && <div className="job-progress"><i style={{ width: `${jobProgress}%` }} /></div>}
        <div className="generate-row">
          <button className="vermilion-button generate-frame" disabled={generating || !model} onClick={() => void generate()}><WandSparkles size={17} /> {generating ? `生成中 ${jobProgress}% · ${elapsedSeconds}s` : references.length ? "生成编辑结果" : "生成关键帧"}</button>
          {generating && <button className="outline-button small" onClick={stopGeneration}><Square size={14} /> 停止</button>}
        </div>
      </section>
      <aside className="generation-output">
        <div className="output-heading"><div><p className="eyebrow">RESULTS / {String(result.length).padStart(2, "0")}</p><h3>{generating ? "任务执行中" : result.length ? "本次落点" : "等待落点"}</h3>{jobId && <small>JOB · {jobId}</small>}</div>{result.length > 0 && !generating && <button className="outline-button small" onClick={() => void generate(1)}><RefreshCcw size={13} /> 重试一张</button>}</div>
        {result.length ? <div className="result-grid">{result.map((image, index) => <button key={image.id} className={index === selectedResult ? "result-card selected" : "result-card"} onClick={() => setSelectedResult(index)}>{resultSrc(image) ? <img src={resultSrc(image)} alt={image.name || "结果"} /> : <div className="empty-output"><Loader2 className="spin" size={18} /></div>}<span>V-{String(index + 1).padStart(2, "0")}</span>{index === selectedResult && <i><Check size={14} /></i>}</button>)}</div> : <div className="empty-output"><ImageIcon size={27} /><p>生成结果会在这里形成。</p></div>}
        {selectedImage && <div className="result-actions"><button onClick={() => void downloadResult(selectedImage)}><ArrowDownToLine size={14} /> 下载</button><button onClick={() => void addResultAsReference(selectedImage)}><ImagePlus size={14} /> 设为参考图</button></div>}
        <div className="output-foot"><button onClick={() => void sendToCanvas()} disabled={!selectedImage?.assetId}><Layers3 size={15} /> 送入画布</button><button onClick={() => window.location.assign(`/assets?scope=${encodeURIComponent(scope)}`)}><Clapperboard size={15} /> 查看归档</button></div>
        <div className="workbench-history">
          <div className="section-line"><span className="eyebrow">近期归档</span><button onClick={reloadHistory}><RefreshCcw size={13} /> 刷新</button></div>
          {history.length ? <div className="workbench-history-grid">{history.map((asset) => <div className="workbench-history-item" key={asset.id}>{historyUrls[asset.id] ? <img src={historyUrls[asset.id]} alt={asset.name} /> : <div className="empty-output"><ImageIcon size={16} /></div>}<div className="workbench-history-actions"><button title="设为参考图" onClick={() => void addAssetAsReference(asset)}><ImagePlus size={13} /></button><button title="下载" onClick={() => void getAssetContentObjectUrl(asset.id, scope).then(async (url) => { const blob = await fetch(url).then((response) => response.blob()); downloadBlob(blob, asset.name); URL.revokeObjectURL(url); })}><ArrowDownToLine size={13} /></button></div></div>)}</div> : <p className="reference-empty">生成成功后会自动归档到资产库，并展示在这里。</p>}
        </div>
      </aside>
    </div>
  </div>;
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
  const [lineage, setLineage] = useState<AssetLineageView | null>(null);
  const [usageEvents, setUsageEvents] = useState<AssetUsageEvent[]>([]);
  const [sendPanelOpen, setSendPanelOpen] = useState(false);
  const [sendProjects, setSendProjects] = useState<CanvasProject[]>([]);
  const [sendProjectId, setSendProjectId] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [exportBatches, setExportBatches] = useState<AssetExportBatch[]>([]);
  const [exportBusy, setExportBusy] = useState("");
  const [packageBusy, setPackageBusy] = useState("");
  const packageInputRef = useRef<HTMLInputElement>(null);
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
    setSendProjects([]);
    setSendProjectId("");
  }, [scope]);

  useEffect(() => {
    setPage(1);
  }, [activeFolderId, assetType, category, createdFrom, createdTo, debouncedKeyword, selectedTagIds, smartView, sortOrder, sourceType, tagMatch]);

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
    task.then(async (result) => {
      let items = result.items || [];
      const deepLinkId = deepLinkAssetRef.current;
      if (deepLinkId) {
        deepLinkAssetRef.current = "";
        if (!items.some((item) => item.id === deepLinkId)) {
          try {
            items = [await getAsset(deepLinkId, scope), ...items];
          } catch {
            toast.info("链接指向的资产不存在或不可访问");
          }
        }
        setSelectedId(deepLinkId);
      }
      setAssets(items);
      setTotal(result.total || 0);
      setSelectedId((current) => items.some((item) => item.id === current) ? current : items[0]?.id || "");
      setSelectedIds((ids) => ids.filter((id) => items.some((asset) => asset.id === id)));
    }).catch((error) => {
      if (!controller.signal.aborted) toast.error(publicApiError(error, "读取资产库失败"));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [query, refreshKey, scope, smartView]);

  useEffect(() => {
    setNoteDraft(selected?.note || selected?.user_state?.private_note || "");
    setLineage(null);
    setUsageEvents([]);
    setSendPanelOpen(false);
  }, [selected?.id, selected?.note, selected?.user_state?.private_note]);

  useEffect(() => {
    if (!selected?.id) return;
    if (detailTab === "血缘") {
      getAssetLineage(selected.id, scope).then(setLineage).catch((error) => toast.error(publicApiError(error, "读取资产血缘失败")));
    } else if (detailTab === "使用") {
      getAssetUsageEvents(selected.id, scope).then((result) => setUsageEvents(result.items || [])).catch(() => setUsageEvents([]));
    }
  }, [detailTab, scope, selected?.id]);

  useEffect(() => {
    if (!sendPanelOpen || sendProjects.length) return;
    getProjects(scope).then((result) => {
      const items = Array.isArray(result) ? result : result.items || [];
      setSendProjects(items);
      setSendProjectId(items[0]?.id || "");
    }).catch((error) => toast.error(publicApiError(error, "读取画布项目失败")));
  }, [scope, sendPanelOpen, sendProjects.length]);

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
      </section>
      <aside className="asset-detail">{selected ? <><div className="detail-head"><div><p className="eyebrow">ASSET / {selected.id.slice(-8)}</p><h3>{selected.name}</h3></div><button className="icon-button subtle" onClick={() => void deleteOrRestore()}>{smartView === "trash" ? <Archive size={16} /> : <Trash2 size={16} />}</button></div>{previewUrls[selected.id] ? <img className="detail-image" src={previewUrls[selected.id]} alt={selected.name} /> : <div className="empty-output"><ImageIcon size={28} /></div>}<div className="detail-tabs">{["详情", "血缘", "使用", "导出"].map((tab) => <button className={detailTab === tab ? "active" : ""} onClick={() => setDetailTab(tab)} key={tab}>{tab}</button>)}</div>{detailTab === "详情" ? <div className="asset-metadata"><div><span>分类</span><b>{selected.category || selected.type}</b></div><div><span>来源</span><b>{selected.source_type || "unknown"}</b></div><div><span>体积</span><b>{selected.size ? `${(selected.size / 1024 / 1024).toFixed(2)} MB` : "—"}</b></div><div><span>标签</span><b>{selected.tags?.join(" · ") || "未绑定"}</b></div><label className="asset-note-editor"><span>备注</span><textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} /><button onClick={() => void saveNote()}>保存备注</button></label></div> : detailTab === "血缘" ? <div className="lineage-detail"><div className="lineage-flow"><span>{selected.source_type || "来源未知"}</span><i /><strong>{selected.name}</strong></div>{lineage ? <>{lineage.parents?.length ? <div className="lineage-group"><p className="field-label">上游来源 {lineage.parents.length}</p>{lineage.parents.map((entry, index) => <button key={entry.id || index} onClick={() => entry.parent_asset_id && setSelectedId(entry.parent_asset_id)}><b>{entry.parent_asset_id?.slice(-8) || "—"}</b><span>{entry.relation_type || "derived"}</span></button>)}</div> : <small className="lineage-empty">没有上游来源记录</small>}{lineage.children?.length ? <div className="lineage-group"><p className="field-label">下游产物 {lineage.children.length}</p>{lineage.children.map((entry, index) => <button key={entry.id || index} onClick={() => entry.child_asset_id && setSelectedId(entry.child_asset_id)}><b>{entry.child_asset_id?.slice(-8) || "—"}</b><span>{entry.relation_type || "derived"}</span></button>)}</div> : <small className="lineage-empty">没有派生产物记录</small>}</> : <small className="lineage-empty">读取血缘中…</small>}</div> : detailTab === "使用" ? <div className="usage-list"><div><b>生成调用</b><small>{selected.usage_stats?.generation_use_count || 0} 次</small></div><div><b>有效引用</b><small>{selected.usage_stats?.active_reference_count || 0} 处</small></div><div><b>下载导出</b><small>{(selected.usage_stats?.download_count || 0) + (selected.usage_stats?.export_count || 0)} 次</small></div>{usageEvents.length > 0 && <div className="usage-events"><p className="field-label">最近事件</p>{usageEvents.slice(0, 8).map((event) => <div key={event.id}><span>{event.event_type}</span><small>{event.source_type || "—"}{event.created_at ? ` · ${new Date(event.created_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}</small></div>)}</div>}</div> :<div className="export-list">{exportBatches.slice(0, 5).map((batch) => <div key={batch.id}><span className={`status-chip ${batch.status}`}>{formatStatus(batch.status)}</span><b>{batch.succeeded}/{batch.total}</b><small>{batch.file_name || batch.id.slice(-8)}</small>{batch.status === "succeeded" || batch.status === "partial_failed" ? <button onClick={() => void downloadAssetExport(batch.id, scope).then((blob) => downloadBlob(blob, batch.file_name || `${batch.id}.zip`))}>下载</button> : batch.status === "queued" || batch.status === "running" ? <button onClick={() => void cancelAssetExport(batch.id, scope).then(reloadExports)}>取消</button> : null}</div>)}</div>}<div className="asset-detail-actions"><button onClick={() => void toggleReaction("favorite")}><Sparkles size={15} /> {selected.user_state?.reaction === "favorite" ? "取消收藏" : "收藏"}</button><button onClick={() => void toggleReaction("dislike")}><Trash2 size={15} /> {selected.user_state?.reaction === "dislike" ? "取消踩" : "踩"}</button><button onClick={() => void getAssetContentObjectUrl(selected.id, scope).then((url) => fetch(url).then((resp) => resp.blob()).then((blob) => { downloadBlob(blob, selected.name); URL.revokeObjectURL(url); }))}><Archive size={15} /> 下载</button></div><div className="asset-detail-actions"><button onClick={() => void sendToNewCanvas()}><Layers3 size={15} /> 发送到新画布</button><button onClick={() => setSendPanelOpen((value) => !value)}><FolderOpen size={15} /> 发送到已有画布</button>{selected.type === "image" && <button onClick={openInImageWorkbench}><WandSparkles size={15} /> 在生图工作台打开</button>}</div>{sendPanelOpen && <div className="asset-send-panel"><select value={sendProjectId} onChange={(event) => setSendProjectId(event.target.value)}>{sendProjects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}{!sendProjects.length && <option value="">暂无画布项目</option>}</select><button className="outline-button small" disabled={!sendProjectId} onClick={() => void sendToExistingCanvas()}>加入画布</button></div>}</> : <div className="empty-output"><p>选择一项资产查看详情</p></div>}</aside>
    </div>
  </div>;
}

export function TagLibraryView() {
  const locationSearch = useSearch();
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
  const [tagAssets, setTagAssets] = useState<Asset[]>([]);
  const [tagAssetTotal, setTagAssetTotal] = useState(0);
  const [tagAssetPage, setTagAssetPage] = useState(1);
  const [tagAssetPreviewUrls, setTagAssetPreviewUrls] = useState<Record<string, string>>({});

  const reload = useCallback(async (preferredId?: string) => {
    setLoading(true);
    try {
      const items = await listAllTags(scope);
      setTags(items);
      setSelectedId((current) => {
        if (preferredId && items.some((item) => item.id === preferredId)) return preferredId;
        return items.some((item) => item.id === current) ? current : items[0]?.id || "";
      });
      setSelectedIds((ids) => ids.filter((id) => items.some((item) => item.id === id)));
    } catch (error) {
      toast.error(publicApiError(error, "读取标签库失败"));
    } finally {
      setLoading(false);
    }
  }, [scope]);

  const searchTag = new URLSearchParams(locationSearch).get("tag") || "";
  const deepLinkTagId = new URLSearchParams(locationSearch).get("tag_id") || "";

  useEffect(() => {
    setQuery(searchTag);
  }, [searchTag]);

  useEffect(() => { void reload(deepLinkTagId || undefined); }, [deepLinkTagId, reload]);
  const current = tags.find((tag) => tag.id === selectedId);
  const visibleTags = useMemo(() => filterTagsWithAncestors(tags, query), [query, tags]);
  const tagRows = useMemo(() => flattenTagTree(visibleTags), [visibleTags]);
  const currentBlockedIds = useMemo(() => collectTagSubtreeIds(tags, current ? [current.id] : []), [current, tags]);
  const bulkBlockedIds = useMemo(() => collectTagSubtreeIds(tags, selectedIds), [selectedIds, tags]);
  const currentParentOptions = tags.filter((tag) => tag.editable && !currentBlockedIds.has(tag.id));
  const bulkParentOptions = tags.filter((tag) => tag.editable && !bulkBlockedIds.has(tag.id));
  useEffect(() => { setDraftName(current?.name || ""); setDraftDescription(current?.description || ""); setMoveParentId(current?.parent_id || ""); }, [current?.description, current?.id, current?.name, current?.parent_id]);

  useEffect(() => { setTagAssetPage(1); }, [scope, selectedId]);
  useEffect(() => {
    if (!selectedId) {
      setTagAssets([]);
      setTagAssetTotal(0);
      return;
    }
    const controller = new AbortController();
    listTagAssets(scope, selectedId, tagAssetPage, 24, controller.signal).then((result) => {
      setTagAssets(result.items || []);
      setTagAssetTotal(result.total || 0);
    }).catch((error) => {
      if (!controller.signal.aborted) toast.error(publicApiError(error, "读取标签关联资产失败"));
    });
    return () => controller.abort();
  }, [scope, selectedId, tagAssetPage]);

  useEffect(() => {
    let disposed = false;
    const urls: Record<string, string> = {};
    Promise.all(tagAssets.filter((asset) => asset.type === "image").map(async (asset) => {
      try {
        const url = await getAssetContentObjectUrl(asset.id, scope, 320);
        if (disposed) URL.revokeObjectURL(url);
        else urls[asset.id] = url;
      } catch {
        undefined;
      }
    })).then(() => { if (!disposed) setTagAssetPreviewUrls(urls); });
    return () => {
      disposed = true;
      Object.values(urls).forEach(URL.revokeObjectURL);
    };
  }, [scope, tagAssets]);

  const toggle = (id: string) => setSelectedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  const addTag = async (parentId = "") => { const name = window.prompt(parentId ? "新子标签名称" : "新标签名称"); if (!name?.trim()) return; const created = await createWorkspaceTag(scope, { parent_id: parentId || undefined, name: name.trim(), asset_enabled: true, prompt_enabled: true, inherit_mode: "auto" }); await reload(created.id); };
  const saveCurrent = async () => { if (!current || !draftName.trim()) return; const saved = await updateTag(scope, current.id, { name: draftName.trim(), description: draftDescription.trim(), asset_enabled: current.asset_enabled, prompt_enabled: current.prompt_enabled, inherit_mode: current.inherit_mode, status: current.status, sort_order: current.sort_order }); setTags((items) => items.map((item) => item.id === saved.id ? saved : item)); };
  const moveCurrent = async () => { if (!current || !current.editable) return; if (moveParentId && currentBlockedIds.has(moveParentId)) { toast.error("不能移动到自身或自身后代"); return; } await bulkMoveTags(scope, [current.id], moveParentId || undefined); await reload(current.id); };
  const archiveCurrent = async () => { if (!current || !window.confirm(`删除“${current.name}”及其可归档子标签？`)) return; await deleteTag(scope, current.id); await reload(); };
  const bulkMoveSelected = async () => { if (!selectedIds.length) return; if (moveParentId && bulkBlockedIds.has(moveParentId)) { toast.error("不能移动到选中标签或其后代"); return; } await bulkMoveTags(scope, selectedIds, moveParentId || undefined); setSelectedIds([]); await reload(); };
  const bulkDeleteSelected = async () => { if (!selectedIds.length || !window.confirm(`删除 ${selectedIds.length} 个标签及其可归档子标签？`)) return; await bulkDeleteTags(scope, selectedIds); setSelectedIds([]); await reload(); };
  const addAlias = async () => { if (!current || !alias.trim()) return; await createTagAlias(scope, current.id, alias.trim()); setAlias(""); await reload(current.id); };
  const renderTag = ({ tag, depth }: ReturnType<typeof flattenTagTree>[number]) => <button key={tag.id} className={`${selectedId === tag.id ? "selected" : ""} ${depth ? "child" : ""}`} style={{ paddingLeft: 9 + depth * 14 }} onClick={() => setSelectedId(tag.id)}><input type="checkbox" checked={selectedIds.includes(tag.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(tag.id)} />{depth ? <Hash size={13} /> : <ChevronRight size={13} />}{tag.name}<span>{tag.asset_count || tag.prompt_count || 0}</span></button>;

  return <div className="feature-page tag-page">
    <SurfaceTitle eyebrow={`TAXONOMY / ${tags.length}`} title="标签库" description="标签可同时服务资产与提示词，并支持删除、批量删除、移动和批量移动。"
      actions={<div className="scope-switch">{scopeOptions.map((item) => <button key={item.value} className={scope === item.value ? "active" : ""} onClick={() => setScope(item.value)}>{item.label}</button>)}<button className="vermilion-button" onClick={() => void addTag()}><Plus size={16} /> 新建标签</button></div>} />
    <div className="tag-bulk-toolbar"><span>已选 {selectedIds.length} 个标签</span><select value={moveParentId} onChange={(e) => setMoveParentId(e.target.value)}><option value="">移动到根级</option>{bulkParentOptions.map((tag) => <option key={tag.id} value={tag.id}>{semanticTagPath(tag.id, tags)}</option>)}</select><button onClick={() => void bulkMoveSelected()} disabled={!selectedIds.length}>批量移动</button><button onClick={() => void bulkDeleteSelected()} disabled={!selectedIds.length}>批量删除</button></div>
    <div className="tag-workspace"><aside className="tag-tree"><div className="tag-search"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="检索标签" /></div>{loading ? <small>读取中…</small> : <div className="tag-group">{tagRows.map(renderTag)}</div>}</aside><section className="tag-editor">{current ? <><div className="tag-editor-head"><div><p className="eyebrow">{current.scope_type} / SEMANTIC TAG</p><h2>#{current.name}</h2></div><div><button className="icon-button subtle" onClick={() => void addTag(current.id)} disabled={!current.editable}><Plus size={16} /></button><button className="icon-button subtle" onClick={() => void archiveCurrent()} disabled={!current.editable}><Trash2 size={16} /></button></div></div><div className="tag-description"><span className="field-label">名称</span><input value={draftName} onChange={(e) => setDraftName(e.target.value)} disabled={!current.editable} /><span className="field-label">描述</span><textarea value={draftDescription} onChange={(e) => setDraftDescription(e.target.value)} disabled={!current.editable} /></div><div className="tag-settings"><label>移动到<select value={moveParentId} onChange={(e) => setMoveParentId(e.target.value)} disabled={!current.editable}><option value="">根级</option>{currentParentOptions.map((tag) => <option key={tag.id} value={tag.id}>{semanticTagPath(tag.id, tags)}</option>)}</select></label><label>作用范围<div className="tag-select">{current.asset_enabled && current.prompt_enabled ? "资产 + 提示词" : current.asset_enabled ? "资产" : "提示词"} <ChevronRight size={14} /></div></label></div><section className="aliases"><div><span className="field-label">别名</span><small>搜索时一并匹配</small></div><div className="alias-list">{current.aliases?.map((item) => <span key={item.id}>{item.alias}<button onClick={async () => { await deleteTagAlias(scope, current.id, item.id); await reload(current.id); }}>×</button></span>)}</div><div className="alias-create"><input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="添加别名" /><button onClick={() => void addAlias()}>添加</button></div></section><div className="tag-editor-actions"><button className="outline-button" disabled={!current.editable} onClick={() => void moveCurrent()}>移动标签</button><button className="vermilion-button" disabled={!current.editable} onClick={() => void saveCurrent()}><Check size={16} /> 保存标签</button></div></> : <div className="empty-output"><p>当前没有可编辑标签</p></div>}</section><aside className="tag-relations"><p className="eyebrow">CONNECTIONS</p><div><b>{tagAssetTotal || current?.asset_count || 0}</b><span>关联资产（含后代）</span><button onClick={() => current && window.location.assign(`/assets?scope=${encodeURIComponent(scope)}&tag=${encodeURIComponent(current.id)}`)}>查看资产 <ArrowUpRight size={14} /></button></div><div><b>{current?.prompt_count || 0}</b><span>提示词模板</span><button onClick={() => current && window.location.assign(`/prompts?tag=${encodeURIComponent(current.name)}`)}>查看提示词 <ArrowUpRight size={14} /></button></div>{current && <section><p className="field-label">关联资产预览</p>{tagAssets.map((asset) => <button key={asset.id} onClick={() => window.location.assign(`/assets?scope=${encodeURIComponent(scope)}&tag=${encodeURIComponent(current.id)}`)}>{tagAssetPreviewUrls[asset.id] ? <img src={tagAssetPreviewUrls[asset.id]} alt="" style={{ width: 34, height: 34, objectFit: "cover", flex: "0 0 34px" }} /> : <ImageIcon size={18} />}<span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{asset.name}</span></button>)}{!tagAssets.length && <small>暂无关联资产</small>}<div className="batch-actions"><button disabled={tagAssetPage <= 1} onClick={() => setTagAssetPage((page) => Math.max(1, page - 1))}>上一页</button><span>{tagAssetPage} / {Math.max(1, Math.ceil(tagAssetTotal / 24))}</span><button disabled={tagAssetPage * 24 >= tagAssetTotal} onClick={() => setTagAssetPage((page) => page + 1)}>下一页</button></div></section>}</aside></div>
  </div>;
}

export function PromptLibraryView() {
  const [mode, setMode] = useState<"personal" | "system">("personal");
  const [presets, setPresets] = useState<PromptPreset[]>([]);
  const [activeId, setActiveId] = useState("");
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get("tag") || "");
  const [loading, setLoading] = useState(true);
  const [systemItems, setSystemItems] = useState<SystemPrompt[]>([]);
  const [systemTotal, setSystemTotal] = useState(0);
  const [systemTags, setSystemTags] = useState<string[]>([]);
  const [systemCategories, setSystemCategories] = useState<string[]>([]);
  const [systemKeyword, setSystemKeyword] = useState("");
  const [systemDebouncedKeyword, setSystemDebouncedKeyword] = useState("");
  const [systemCategory, setSystemCategory] = useState("");
  const [systemTagFilter, setSystemTagFilter] = useState<string[]>([]);
  const [systemPage, setSystemPage] = useState(1);
  const [systemLoading, setSystemLoading] = useState(false);
  const [systemActiveId, setSystemActiveId] = useState("");
  const active = presets.find((item) => item.id === activeId) || presets[0];
  const systemActive = systemItems.find((item) => item.id === systemActiveId) || systemItems[0];
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

  useEffect(() => {
    const timer = window.setTimeout(() => setSystemDebouncedKeyword(systemKeyword), 300);
    return () => window.clearTimeout(timer);
  }, [systemKeyword]);

  useEffect(() => {
    setSystemPage(1);
  }, [systemCategory, systemDebouncedKeyword, systemTagFilter]);

  useEffect(() => {
    if (mode !== "system") return;
    let disposed = false;
    setSystemLoading(true);
    getPromptLibrary(systemPage, 20, { keyword: systemDebouncedKeyword, category: systemCategory, tags: systemTagFilter }).then((result) => {
      if (disposed) return;
      setSystemItems((current) => systemPage === 1 ? result.items || [] : [...current, ...(result.items || [])]);
      setSystemTotal(result.total || 0);
      setSystemTags(result.tags || []);
      setSystemCategories(result.categories || []);
      if (systemPage === 1) setSystemActiveId(result.items?.[0]?.id || "");
    }).catch((error) => {
      if (!disposed) toast.error(publicApiError(error, "读取系统提示词库失败"));
    }).finally(() => {
      if (!disposed) setSystemLoading(false);
    });
    return () => { disposed = true; };
  }, [mode, systemCategory, systemDebouncedKeyword, systemPage, systemTagFilter]);

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

  const saveSystemPromptAsPreset = async (item: SystemPrompt) => {
    const now = new Date().toISOString();
    const created: PromptPreset = { id: crypto.randomUUID(), title: item.title, prompt: item.prompt, tags: item.tags.slice(0, 6), priority: "normal", sort_order: presets.length, createdAt: now, updatedAt: now };
    await persist([...presets, created], "系统提示词已存为个人预设");
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

  const toggleSystemTag = (tag: string) => setSystemTagFilter((tags) => tags.includes(tag) ? tags.filter((item) => item !== tag) : [...tags, tag]);

  return <div className="feature-page prompt-page">
    <SurfaceTitle eyebrow={mode === "personal" ? `PROMPTS / ${presets.length}` : `LIBRARY / ${systemTotal}`} title="提示词中心" description="个人预设与偏好共用一份数据；系统库聚合公开提示词仓库，可直接检索复用。"
      actions={<div className="scope-switch"><button className={mode === "personal" ? "active" : ""} onClick={() => setMode("personal")}>个人预设</button><button className={mode === "system" ? "active" : ""} onClick={() => setMode("system")}>系统库</button>{mode === "personal" && <button className="vermilion-button" onClick={() => void createPreset()}><Plus size={16} /> 新建预设</button>}</div>} />
    {mode === "personal" ? <div className="prompt-workspace"><aside className="prompt-filters"><div className="tag-search"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="关键词、标签或优先级" /></div><p className="field-label">PRIORITY</p>{[["置顶", "pinned"], ["高", "high"], ["普通", "normal"], ["低", "low"]].map(([name, key]) => <button onClick={() => setQuery(key)} key={key}><span>{name}</span><b>{presets.filter((item) => item.priority === key).length}</b></button>)}<hr /><p className="field-label">常用标签</p>{commonTags.map((tag) => <button className="tag-filter" onClick={() => setQuery(tag)} key={tag}>#{tag}</button>)}</aside><section className="template-list"><div className="template-list-head"><span>{loading ? "读取中…" : `匹配到 ${visible.length} 条视觉片段`}</span></div>{visible.map((item) => <button className={active?.id === item.id ? "template-card selected" : "template-card"} onClick={() => setActiveId(item.id)} key={item.id}><div><span>{priorityLabel(item.priority)}</span><b>{item.title}</b><p>{item.prompt || "尚未填写提示词"}</p></div><div className="template-card-tags">{item.tags.map((tag) => <i key={tag}>#{tag}</i>)}</div></button>)}</section><aside className="prompt-preview">{active ? <><div><p className="eyebrow">PRESET PREVIEW</p><input value={active.title} onChange={(e) => patchActive({ title: e.target.value })} /></div><div className="preview-tags">{active.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div><textarea value={active.prompt} onChange={(e) => patchActive({ prompt: e.target.value })} /><input value={active.tags.join(", ")} onChange={(e) => patchActive({ tags: e.target.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) })} placeholder="标签，以逗号分隔" /><select value={active.priority} onChange={(e) => patchActive({ priority: e.target.value as PromptPreset["priority"] })}><option value="pinned">置顶</option><option value="high">高</option><option value="normal">普通</option><option value="low">低</option></select><div className="prompt-order-actions"><button onClick={() => void moveActive(-1)}>上移</button><button onClick={() => void moveActive(1)}>下移</button></div><button className="vermilion-button" onClick={() => void persist(presets.map((item) => item.id === active.id ? { ...item, updatedAt: new Date().toISOString() } : item), "提示词已保存")}><Check size={16} /> 保存预设</button><button className="full-outline" onClick={() => { sessionStorage.setItem("ai-manju:image-prompt", active.prompt); window.location.assign("/image"); }}><WandSparkles size={16} /> 送入关键帧</button><button className="full-outline" onClick={async () => { await navigator.clipboard.writeText(active.prompt); toast.success("提示词已复制"); }}><FileText size={15} /> 复制完整提示词</button><button className="full-outline" onClick={() => { if (window.confirm(`删除“${active.title}”？`)) void persist(presets.filter((item) => item.id !== active.id), "提示词已删除"); }}><Trash2 size={15} /> 删除预设</button></> : <div className="empty-output"><p>暂无个人提示词预设</p></div>}</aside></div>
      : <div className="prompt-workspace">
        <aside className="prompt-filters">
          <div className="tag-search"><Search size={15} /><input value={systemKeyword} onChange={(e) => setSystemKeyword(e.target.value)} placeholder="搜索标题、正文或标签" /></div>
          <p className="field-label">CATEGORY</p>
          <button className={!systemCategory ? "tag-filter selected" : "tag-filter"} onClick={() => setSystemCategory("")}>全部分类</button>
          {systemCategories.map((category) => <button className={systemCategory === category ? "tag-filter selected" : "tag-filter"} onClick={() => setSystemCategory(category)} key={category}>{category}</button>)}
          <hr />
          <p className="field-label">TAGS {systemTagFilter.length ? `· 已选 ${systemTagFilter.length}` : ""}</p>
          <div className="system-tag-cloud">{systemTags.slice(0, 40).map((tag) => <button className={systemTagFilter.includes(tag) ? "tag-filter selected" : "tag-filter"} onClick={() => toggleSystemTag(tag)} key={tag}>#{tag}</button>)}</div>
        </aside>
        <section className="template-list">
          <div className="template-list-head"><span>{systemLoading && systemPage === 1 ? "读取中…" : `共 ${systemTotal} 条系统提示词`}</span></div>
          {systemItems.map((item) => <button className={systemActive?.id === item.id ? "template-card selected" : "template-card"} onClick={() => setSystemActiveId(item.id)} key={item.id}><div><span>{item.category}</span><b>{item.title}</b><p>{item.prompt}</p></div><div className="template-card-tags">{item.tags.slice(0, 5).map((tag) => <i key={tag}>#{tag}</i>)}</div></button>)}
          {!systemItems.length && !systemLoading && <div className="empty-output"><p>没有匹配的系统提示词；提示词库需要服务端能访问 GitHub。</p></div>}
          {systemItems.length < systemTotal && <button className="full-outline" disabled={systemLoading} onClick={() => setSystemPage((page) => page + 1)}>{systemLoading ? "加载中…" : `加载更多（${systemItems.length}/${systemTotal}）`}</button>}
        </section>
        <aside className="prompt-preview">{systemActive ? <><div><p className="eyebrow">{systemActive.category}</p><h3 className="system-prompt-title">{systemActive.title}</h3></div>{systemActive.coverUrl && <img className="system-prompt-cover" src={systemActive.coverUrl} alt={systemActive.title} loading="lazy" />}<div className="preview-tags">{systemActive.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div><textarea value={systemActive.prompt} readOnly /><button className="vermilion-button" onClick={async () => { await navigator.clipboard.writeText(systemActive.prompt); toast.success("提示词已复制"); }}><FileText size={15} /> 复制完整提示词</button><button className="full-outline" onClick={() => { sessionStorage.setItem("ai-manju:image-prompt", systemActive.prompt); window.location.assign("/image"); }}><WandSparkles size={16} /> 送入关键帧</button><button className="full-outline" onClick={() => void saveSystemPromptAsPreset(systemActive)}><Plus size={15} /> 存为个人预设</button>{systemActive.githubUrl && <button className="full-outline" onClick={() => window.open(systemActive.githubUrl, "_blank", "noopener")}><ArrowUpRight size={15} /> 查看来源仓库</button>}</> : <div className="empty-output"><p>选择一条系统提示词查看详情</p></div>}</aside>
      </div>}
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
