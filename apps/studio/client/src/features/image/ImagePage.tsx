import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  BookOpen,
  Check,
  Clapperboard,
  Crop,
  Expand,
  Image as ImageIcon,
  ImagePlus,
  Layers3,
  Loader2,
  Maximize2,
  PenLine,
  Plus,
  RefreshCcw,
  Search,
  Sparkles,
  Square,
  Trash2,
  Upload,
  WandSparkles,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

import { getAssetContentObjectUrl, type Asset } from "@/entities/asset";
import { createProject } from "@/entities/project";
import type { PromptPreset } from "@/entities/prompt";
import { usePreferencesQuery } from "@/features/settings";
import { publicApiError } from "@/shared/api/errors";
import type { WorkspaceScope } from "@/shared/config";
import PromptLibraryDialog from "@/components/PromptLibraryDialog";
import { CanvasImageAnnotationDialog } from "@/components/canvas/CanvasImageAnnotationDialog";
import {
  createOutpaintMaskDataUrl,
  createOutpaintSourceDataUrl,
  cropDataUrl,
  upscaleDataUrl,
  type ImageCropRect,
  type ImageUpscaleAlgorithm,
  type OutpaintMargins,
} from "@/lib/canvas-image-data";

import { CropDialog, HistoryPreviewDialog, OutpaintDialog, UpscaleDialog } from "./ui/ImageEditDialogs";

import {
  generateImages,
  imageModelLabel,
  type GeneratedImage,
  type ImageModelCatalog,
} from "./api";
import {
  IMAGE_WORKBENCH_SIZE_OPTIONS,
  resolveImageWorkbenchRequestOptions,
  type ImageWorkbenchQuality,
  type ImageWorkbenchSizeOption,
} from "./model/options";
import {
  useImageAssetPickerQuery,
  useImageHistoryQuery,
  useImageModelCatalogQuery,
} from "./model/queries";
import "./styles.css";

type Option<T extends string> = { value: T; label: string };

const scopeOptions: Array<Option<WorkspaceScope>> = [
  { value: "personal", label: "个人空间" },
  { value: "team", label: "团队空间" },
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

async function dataUrlToFile(dataUrl: string, name: string) {
  const blob = await fetch(dataUrl).then((response) => response.blob());
  return new File([blob], name, { type: blob.type || "image/png" });
}

function priorityRank(value: PromptPreset["priority"]) {
  return { pinned: 0, high: 1, normal: 2, low: 3 }[value] ?? 2;
}

function priorityLabel(value: PromptPreset["priority"]) {
  return { pinned: "置顶", high: "高", normal: "普通", low: "低" }[value] ?? value;
}

const MAX_REFERENCE_IMAGES = 11;
/* 放大查看（lightbox）缩放边界与步进：0.25x–4x，滚轮/按钮均按 0.25 步进 */
const LIGHTBOX_ZOOM_MIN = 0.25;
const LIGHTBOX_ZOOM_MAX = 4;
const LIGHTBOX_ZOOM_STEP = 0.25;
const clampLightboxZoom = (value: number) => Math.min(LIGHTBOX_ZOOM_MAX, Math.max(LIGHTBOX_ZOOM_MIN, Math.round(value * 100) / 100));

type ReferenceImage = { id: string; file: File; previewUrl: string };

export function ImageWorkbenchView() {
  const [, navigate] = useLocation();
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const lightboxStageRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const catalogInitializedRef = useRef(false);
  const preferencesInitializedRef = useRef(false);
  const [scope, setScope] = useState<WorkspaceScope>(() => initialScopeFromSearch());
  const [model, setModel] = useState("");
  const [catalog, setCatalog] = useState<ImageModelCatalog | null>(null);
  const [size, setSize] = useState<ImageWorkbenchSizeOption>("auto");
  const [quality, setQuality] = useState<ImageWorkbenchQuality>("auto");
  const [count, setCount] = useState(1);
  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(1024);
  const [align16, setAlign16] = useState(true);
  const [prompt, setPrompt] = useState("雨夜，狭长街道，潮湿沥青反射红色招牌；人物在画面右侧停留，低机位缓慢推近，电影级冷暖对比。");
  const [promptPresets, setPromptPresets] = useState<PromptPreset[]>([]);
  const [promptLibraryOpen, setPromptLibraryOpen] = useState(false);
  const [references, setReferences] = useState<ReferenceImage[]>([]);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [assetPickerKeyword, setAssetPickerKeyword] = useState("");
  const [assetPickerUrls, setAssetPickerUrls] = useState<Record<string, string>>({});
  const [result, setResult] = useState<GeneratedImage[]>([]);
  const [resultUrls, setResultUrls] = useState<Record<string, string>>({});
  const [selectedResult, setSelectedResult] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxZoom, setLightboxZoom] = useState(1);
  const [historyPreview, setHistoryPreview] = useState<Asset | null>(null);
  const [historyPreviewUrl, setHistoryPreviewUrl] = useState("");
  const [annotateOpen, setAnnotateOpen] = useState(false);
  const [upscaleOpen, setUpscaleOpen] = useState(false);
  const [outpaintOpen, setOutpaintOpen] = useState(false);
  const [cropOpen, setCropOpen] = useState(false);
  const [editUrl, setEditUrl] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [historyUrls, setHistoryUrls] = useState<Record<string, string>>({});
  const catalogQuery = useImageModelCatalogQuery();
  const preferencesQuery = usePreferencesQuery();
  const historyQuery = useImageHistoryQuery(scope);
  const assetPickerQuery = useImageAssetPickerQuery(
    scope,
    assetPickerKeyword,
    assetPickerOpen
  );
  const history = useMemo(
    () => historyQuery.data?.items || [],
    [historyQuery.data?.items]
  );
  const assetPickerItems = useMemo(
    () => assetPickerQuery.data || [],
    [assetPickerQuery.data]
  );

  useEffect(() => {
    if (catalogInitializedRef.current || catalogQuery.isPending) return;
    catalogInitializedRef.current = true;
    if (catalogQuery.error || !catalogQuery.data) {
      toast.error(publicApiError(catalogQuery.error, "读取图像模型失败"));
      return;
    }
    setCatalog(catalogQuery.data);
    setModel(catalogQuery.data.defaultModel);
  }, [catalogQuery.data, catalogQuery.error, catalogQuery.isPending]);

  useEffect(() => {
    if (preferencesInitializedRef.current || preferencesQuery.isPending) return;
    preferencesInitializedRef.current = true;
    const preferences = preferencesQuery.data;
    if (!preferences) return;
    setPromptPresets(preferences.canvas?.promptPresets || []);
    const generation = preferences.generation || {};
    if (generation.imageModel) setModel((current) => current || generation.imageModel || "");
    if (generation.size && ["auto", "1:1", "16:9", "9:16"].includes(generation.size)) setSize(generation.size as typeof size);
    if (generation.count) setCount(Math.max(1, Math.min(15, Number(generation.count) || 1)));
  }, [
    preferencesQuery.data,
    preferencesQuery.isPending,
    size,
  ]);

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
    void historyQuery.refetch();
  }, [historyQuery.refetch]);

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

  const selectedIndex = useMemo(() => (result[selectedResult] ? selectedResult : 0), [result, selectedResult]);
  const selectedImage = useMemo(() => result[selectedResult] || result[0], [result, selectedResult]);
  const visiblePromptPresets = useMemo(() => [...promptPresets]
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.sort_order - b.sort_order || a.title.localeCompare(b.title, "zh-CN"))
    .slice(0, 8), [promptPresets]);
  const resultSrc = useCallback((image: GeneratedImage) => image.src || (image.assetId ? resultUrls[image.assetId] || "" : ""), [resultUrls]);
  const selectedSrc = selectedImage ? resultSrc(selectedImage) : "";
  const openLightbox = useCallback(() => {
    if (!selectedSrc) return;
    setLightboxZoom(1);
    setLightboxOpen(true);
  }, [selectedSrc]);
  /* 放大查看：Esc 关闭 */
  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setLightboxOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxOpen]);
  /* 放大查看：滚轮缩放（原生非 passive 监听，避免页面跟着滚动） */
  useEffect(() => {
    const node = lightboxStageRef.current;
    if (!lightboxOpen || !node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setLightboxZoom((z) => clampLightboxZoom(z + (event.deltaY < 0 ? LIGHTBOX_ZOOM_STEP : -LIGHTBOX_ZOOM_STEP)));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [lightboxOpen]);

  /* 历史记录小弹窗：打开时拉取 640px 预览图（先展示侧栏缩略图兜底），关闭时回收 object URL */
  useEffect(() => {
    if (!historyPreview) {
      setHistoryPreviewUrl("");
      return;
    }
    setHistoryPreviewUrl(historyUrls[historyPreview.id] || "");
    let disposed = false;
    let objectUrl = "";
    getAssetContentObjectUrl(historyPreview.id, scope, 640)
      .then((url) => { if (disposed) URL.revokeObjectURL(url); else { objectUrl = url; setHistoryPreviewUrl(url); } })
      .catch(() => { if (!disposed) setHistoryPreviewUrl(""); });
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [historyPreview, historyUrls, scope]);

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
      const requestOptions = resolveImageWorkbenchRequestOptions(size, quality);
      const generated = await generateImages({
        model,
        prompt,
        ...requestOptions,
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

  /* 读取选中图片的完整可用 URL（优先内存 data/blob，归档图片回源拉取） */
  const resolveFullImageUrl = useCallback(async (image: GeneratedImage) => {
    if (image.src) return image.src;
    if (image.assetId) return getAssetContentObjectUrl(image.assetId, scope);
    return "";
  }, [scope]);

  /* 本地编辑（标注/超分/裁剪）产物：追加到结果区并选中，走与生成结果一致的预览/下载链路 */
  const pushLocalResult = (dataUrl: string, name: string) => {
    setResult((current) => [...current, { id: crypto.randomUUID(), src: dataUrl, name }]);
    setSelectedResult(result.length);
    toast.success("已加入预览区域");
  };

  const openEditor = async (kind: "annotate" | "upscale" | "crop") => {
    if (!selectedImage || generating) return;
    try {
      const url = await resolveFullImageUrl(selectedImage);
      if (!url) return toast.info("当前图片还没有可用内容");
      setEditUrl(url);
      if (kind === "annotate") setAnnotateOpen(true);
      else if (kind === "upscale") setUpscaleOpen(true);
      else setCropOpen(true);
    } catch (error) {
      toast.error(publicApiError(error, "读取图片失败"));
    }
  };

  const runUpscale = async (targetLongEdge: number, algorithm: ImageUpscaleAlgorithm) => {
    if (!selectedImage || editBusy) return;
    setEditBusy(true);
    try {
      const url = editUrl || await resolveFullImageUrl(selectedImage);
      const dataUrl = await upscaleDataUrl(url, { targetLongEdge, algorithm });
      pushLocalResult(dataUrl, `${selectedImage.name || "结果"}-超分${targetLongEdge}`);
      setUpscaleOpen(false);
    } catch (error) {
      toast.error(publicApiError(error, "超分失败"));
    } finally {
      setEditBusy(false);
    }
  };

  const runCrop = async (rect: ImageCropRect) => {
    if (!selectedImage || editBusy) return;
    setEditBusy(true);
    try {
      const url = editUrl || await resolveFullImageUrl(selectedImage);
      const dataUrl = await cropDataUrl(url, rect);
      pushLocalResult(dataUrl, `${selectedImage.name || "结果"}-裁剪`);
      setCropOpen(false);
    } catch (error) {
      toast.error(publicApiError(error, "裁剪失败"));
    } finally {
      setEditBusy(false);
    }
  };

  /* 扩图：外扩画布 + 遮罩走 /edits 生成链路，与画布扩图同一套数据来源 */
  const runOutpaint = async (margins: OutpaintMargins, promptText: string) => {
    if (generating || !model || !selectedImage) return;
    setOutpaintOpen(false);
    const controller = new AbortController();
    abortRef.current = controller;
    setGenerating(true);
    setResult([]);
    setResultUrls({});
    setSelectedResult(0);
    setJobProgress(0);
    try {
      const url = await resolveFullImageUrl(selectedImage);
      if (!url) throw new Error("当前图片还没有可用内容");
      const referenceFile = await dataUrlToFile(await createOutpaintSourceDataUrl(url, margins), "outpaint-source.png");
      const maskFile = await dataUrlToFile(await createOutpaintMaskDataUrl(url, margins), "outpaint-mask.png");
      const generated = await generateImages({
        model,
        prompt: promptText,
        size: "auto",
        quality,
        count: 1,
        referenceFiles: [referenceFile],
        maskFile,
        scope,
        sourceType: "image_workbench",
      }, {
        signal: controller.signal,
        onAccepted: (job) => setJobId(job.job_id || job.id || null),
        onProgress: (job) => { setJobId(job.id); setJobProgress(job.progress ?? 0); },
      });
      setResult(generated.images);
      setJobProgress(100);
      toast.success("扩图完成");
      reloadHistory();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") toast.info("已停止本次扩图");
      else toast.error(publicApiError(error, "扩图失败"));
    } finally {
      abortRef.current = null;
      setGenerating(false);
    }
  };

  /* 历史记录（侧栏 / 近期归档）右键：重新载入预览区域，载入后底部编辑按钮变为可用 */
  const loadAssetIntoPreview = (asset: Asset) => {
    if (generating) return toast.info("任务执行中，完成后再载入");
    setHistoryPreview(null);
    setResult([{ id: asset.id, assetId: asset.id, src: historyUrls[asset.id] || "", name: asset.name }]);
    setSelectedResult(0);
    toast.info("已载入预览区域，可使用下方编辑功能");
  };

  const downloadHistoryAsset = async (asset: Asset) => {
    try {
      const url = await getAssetContentObjectUrl(asset.id, scope);
      const blob = await fetch(url).then((response) => response.blob());
      downloadBlob(blob, asset.name);
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(publicApiError(error, "下载失败"));
    }
  };

  /* 从预览区域移除单张结果：仅移出当前预览，不影响已归档的资产；清空后自动回到等待落点态 */
  const removeResult = (index: number) => {
    const target = result[index];
    const next = result.filter((_, itemIndex) => itemIndex !== index);
    if (target?.src?.startsWith("blob:") && !Object.values(resultUrls).includes(target.src)) URL.revokeObjectURL(target.src);
    setResult(next);
    setSelectedResult((current) => (current >= next.length ? Math.max(0, next.length - 1) : current));
    toast.info("已从预览区域移除");
  };

  const canEditPreview = Boolean(selectedImage) && !generating;

  return <div className="feature-page image-page">
    <input ref={referenceInputRef} type="file" accept="image/*" multiple hidden onChange={(event) => { if (event.target.files) addReferenceFiles(event.target.files); event.target.value = ""; }} />
    <PromptLibraryDialog open={promptLibraryOpen} onOpenChange={setPromptLibraryOpen} onSelect={(value) => { setPrompt(value); setPromptLibraryOpen(false); }} />
    <SurfaceTitle eyebrow="KEYFRAME / NEW" title="关键帧生成" description="走真实模型与队列，支持参考图编辑，把结果直接送回画布。"
      actions={<div className="scope-switch">{scopeOptions.map((item) => <button key={item.value} className={scope === item.value ? "active" : ""} onClick={() => setScope(item.value)}>{item.label}</button>)}</div>} />
    <div className="image-workbench">
      <aside className="generation-history-sidebar">
        <div className="history-sidebar-header">
          <h2 className="eyebrow">生成记录</h2>
          <span>{history.length}</span>
        </div>
        <div className="history-sidebar-actions">
          <button className="outline-button small"><Plus size={14} /> 新建项目</button>
          <button className="outline-button small">全选</button>
          <button className="outline-button small">删除</button>
        </div>
        <div className="history-sidebar-content">
          {history.length > 0 ? (
            <div className="history-card-list">
              {history.map((asset) => (
                <div
                  className="history-card"
                  key={asset.id}
                  role="button"
                  tabIndex={0}
                  title="左键放大预览 · 右键载入预览区域"
                  onClick={() => setHistoryPreview(asset)}
                  onKeyDown={(event) => { if (event.key === "Enter") setHistoryPreview(asset); }}
                  onContextMenu={(event) => { event.preventDefault(); loadAssetIntoPreview(asset); }}
                >
                  {historyUrls[asset.id] ? (
                    <img src={historyUrls[asset.id]} alt={asset.name} />
                  ) : (
                    <div className="empty-thumbnail"><ImageIcon size={20} /></div>
                  )}
                  <div className="history-card-overlay">
                    <b>{asset.name}</b>
                    <small>{new Date(asset.created_at || Date.now()).toLocaleDateString()}</small>
                    <span>左键预览 · 右键载入预览区</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="history-empty">
              <ImageIcon size={32} />
              <p>还没有生成记录</p>
            </div>
          )}
        </div>
      </aside>
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
        </div>
        <div className="composer-options">
          <label>质量<div className="ratio-buttons">{(["auto", "high", "medium", "low"] as const).map((q) => <button key={q} className={quality === q ? "active" : ""} onClick={() => setQuality(q)}>{q === "auto" ? "自动" : q === "high" ? "高" : q === "medium" ? "中" : "低"}</button>)}</div></label>
          <label>数量<div className="counter"><button onClick={() => setCount((v) => Math.max(1, v - 1))}>−</button><input type="number" value={count} onChange={(e) => setCount(Math.max(1, Math.min(15, Number(e.target.value) || 1)))} min="1" max="15" /><button onClick={() => setCount((v) => Math.min(15, v + 1))}>+</button></div></label>
        </div>
        <div className="composer-size-settings">
          <label>尺寸<div className="size-inputs"><span>W</span><input type="number" value={width} onChange={(e) => setWidth(Number(e.target.value))} min="256" max="2048" step={align16 ? "16" : "1"} /><button className="swap-size" onClick={() => { const tmp = width; setWidth(height); setHeight(tmp); }}>⇄</button><span>H</span><input type="number" value={height} onChange={(e) => setHeight(Number(e.target.value))} min="256" max="2048" step={align16 ? "16" : "1"} /><label className="align-toggle"><input type="checkbox" checked={align16} onChange={(e) => setAlign16(e.target.checked)} /><span>16倍数对齐</span></label></div></label>
        </div>
        <div className="composer-ratio-grid">
          <label>宽高比</label>
          <div className="ratio-grid">{IMAGE_WORKBENCH_SIZE_OPTIONS.map((ratio) => <button key={ratio} className={size === ratio ? "active" : ""} onClick={() => setSize(ratio)}>{ratio}</button>)}</div>
        </div>
        {generating && <div className="job-progress"><i style={{ width: `${jobProgress}%` }} /></div>}
        <div className="generate-row">
          <button className="vermilion-button generate-frame" disabled={generating || !model} onClick={() => void generate()}><WandSparkles size={17} /> {generating ? `生成中 ${jobProgress}% · ${elapsedSeconds}s` : references.length ? "生成编辑结果" : "生成关键帧"}</button>
          {generating && <button className="outline-button small" onClick={stopGeneration}><Square size={14} /> 停止</button>}
        </div>
      </section>
      <aside className="generation-output">
        <div className="output-heading"><div><p className="eyebrow">RESULTS / {String(result.length).padStart(2, "0")}</p><h3>{generating ? "任务执行中" : result.length ? "本次落点" : "等待落点"}</h3>{jobId && <small>JOB · {jobId}</small>}</div>{result.length > 0 && !generating && <button className="outline-button small" onClick={() => void generate(1)}><RefreshCcw size={13} /> 重试一张</button>}</div>
        {generating ? (
          <div className="result-stage generating">
            <div className="generation-waiting">
              <span className="waiting-ring"><Loader2 className="spin" size={24} /></span>
              <p>关键帧生成中</p>
              <small>{jobProgress}% · 已等待 {elapsedSeconds}s</small>
              <div className="waiting-progress"><i style={{ width: `${Math.max(jobProgress, 6)}%` }} /></div>
            </div>
          </div>
        ) : result.length ? (
          <>
            <div className="result-stage">
              {selectedImage && resultSrc(selectedImage) ? (
                <img className="result-stage-image" src={resultSrc(selectedImage)} alt={selectedImage.name || "结果"} title="点击放大查看" onClick={openLightbox} />
              ) : (
                <div className="empty-output"><Loader2 className="spin" size={20} /><p>正在读取生成结果…</p></div>
              )}
              {selectedImage && <span className="result-stage-tag">V-{String(selectedIndex + 1).padStart(2, "0")} / {String(result.length).padStart(2, "0")}</span>}
              {selectedSrc && <button className="result-stage-zoom" title="放大查看" onClick={openLightbox}><Maximize2 size={13} /></button>}
              {selectedImage && <button className="result-stage-remove" title="从预览区域移除" onClick={() => removeResult(selectedIndex)}><Trash2 size={13} /></button>}
            </div>
            {result.length > 1 && (
              <div className="result-strip">
                {result.map((image, index) => (
                  <button key={image.id} className={index === selectedResult ? "result-thumb selected" : "result-thumb"} title={image.name || `V-${index + 1}`} onClick={() => setSelectedResult(index)}>
                    {resultSrc(image) ? <img src={resultSrc(image)} alt={image.name || "结果"} /> : <Loader2 className="spin" size={14} />}
                    <span>V-{String(index + 1).padStart(2, "0")}</span>
                    {index === selectedResult && <i><Check size={11} /></i>}
                    <b className="result-thumb-remove" title="从预览区域移除" onClick={(event) => { event.stopPropagation(); removeResult(index); }}><X size={10} /></b>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="empty-output"><ImageIcon size={27} /><p>生成结果会在这里形成。</p></div>
        )}
        <div className="edit-toolbar">
          <span className="eyebrow">编辑</span>
          <div className="edit-toolbar-buttons">
            <button disabled={!canEditPreview} title={canEditPreview ? "在图片上绘制标注" : "预览区域没有图片"} onClick={() => void openEditor("annotate")}><PenLine size={13} /> 标注</button>
            <button disabled={!canEditPreview} title={canEditPreview ? "本地超分放大" : "预览区域没有图片"} onClick={() => void openEditor("upscale")}><Sparkles size={13} /> 超分</button>
            <button disabled={!canEditPreview || !model} title={canEditPreview ? "AI 外扩画布并补全" : "预览区域没有图片"} onClick={() => setOutpaintOpen(true)}><Expand size={13} /> 扩图</button>
            <button disabled={!canEditPreview} title={canEditPreview ? "裁剪图片" : "预览区域没有图片"} onClick={() => void openEditor("crop")}><Crop size={13} /> 裁剪</button>
          </div>
        </div>
        {selectedImage && <div className="result-actions"><button onClick={() => void downloadResult(selectedImage)}><ArrowDownToLine size={14} /> 下载</button><button onClick={() => void addResultAsReference(selectedImage)}><ImagePlus size={14} /> 设为参考图</button></div>}
        <div className="output-foot compact"><button onClick={() => void sendToCanvas()} disabled={!selectedImage?.assetId}><Layers3 size={13} /> 送入画布</button><button onClick={() => window.location.assign(`/assets?scope=${encodeURIComponent(scope)}`)}><Clapperboard size={13} /> 查看归档</button></div>
      </aside>
    </div>
    {annotateOpen && editUrl && (
      <CanvasImageAnnotationDialog
        dataUrl={editUrl}
        open={annotateOpen}
        onClose={() => setAnnotateOpen(false)}
        onConfirm={(payload) => { setAnnotateOpen(false); pushLocalResult(payload.dataUrl, `${selectedImage?.name || "结果"}-标注`); }}
      />
    )}
    <UpscaleDialog open={upscaleOpen} busy={editBusy} onClose={() => setUpscaleOpen(false)} onRun={(targetLongEdge, algorithm) => void runUpscale(targetLongEdge, algorithm)} />
    <OutpaintDialog open={outpaintOpen} busy={generating} onClose={() => setOutpaintOpen(false)} onRun={(margins, promptText) => void runOutpaint(margins, promptText)} />
    <CropDialog open={cropOpen} imageUrl={editUrl} busy={editBusy} onClose={() => setCropOpen(false)} onRun={(rect) => void runCrop(rect)} />
    <HistoryPreviewDialog
      asset={historyPreview}
      imageUrl={historyPreviewUrl}
      onClose={() => setHistoryPreview(null)}
      onLoadIntoPreview={loadAssetIntoPreview}
      onAddReference={(asset) => { setHistoryPreview(null); void addAssetAsReference(asset); }}
      onDownload={(asset) => void downloadHistoryAsset(asset)}
    />
    {lightboxOpen && selectedSrc && (
      <div className="image-lightbox" role="presentation" onClick={() => setLightboxOpen(false)}>
        <div className="image-lightbox-toolbar" onClick={(event) => event.stopPropagation()}>
          <span className="image-lightbox-title">V-{String(selectedIndex + 1).padStart(2, "0")} · {selectedImage?.name || "生成结果"}</span>
          <div className="image-lightbox-controls">
            <button title="缩小" disabled={lightboxZoom <= LIGHTBOX_ZOOM_MIN} onClick={() => setLightboxZoom((z) => clampLightboxZoom(z - LIGHTBOX_ZOOM_STEP))}><ZoomOut size={14} /></button>
            <b>{Math.round(lightboxZoom * 100)}%</b>
            <button title="放大" disabled={lightboxZoom >= LIGHTBOX_ZOOM_MAX} onClick={() => setLightboxZoom((z) => clampLightboxZoom(z + LIGHTBOX_ZOOM_STEP))}><ZoomIn size={14} /></button>
            <button title="适配窗口" onClick={() => setLightboxZoom(1)}>适配</button>
            {selectedImage && <button title="下载" onClick={() => void downloadResult(selectedImage)}><ArrowDownToLine size={14} /></button>}
            <button title="关闭 (Esc)" onClick={() => setLightboxOpen(false)}><X size={15} /></button>
          </div>
        </div>
        <div className="image-lightbox-stage" ref={lightboxStageRef} onClick={() => setLightboxOpen(false)}>
          <img
            src={selectedSrc}
            alt={selectedImage?.name || "生成结果"}
            style={lightboxZoom === 1 ? undefined : { maxWidth: "none", maxHeight: "none", width: `${Math.round(lightboxZoom * 100)}%` }}
            onClick={(event) => { event.stopPropagation(); setLightboxZoom((z) => (z === 1 ? 2 : 1)); }}
          />
        </div>
      </div>
    )}
  </div>;
}

export default ImageWorkbenchView;
