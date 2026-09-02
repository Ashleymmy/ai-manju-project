import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  BookOpen,
  Check,
  Clapperboard,
  Image as ImageIcon,
  ImagePlus,
  Layers3,
  Loader2,
  Plus,
  RefreshCcw,
  Search,
  Square,
  Upload,
  WandSparkles,
  X,
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

function priorityRank(value: PromptPreset["priority"]) {
  return { pinned: 0, high: 1, normal: 2, low: 3 }[value] ?? 2;
}

function priorityLabel(value: PromptPreset["priority"]) {
  return { pinned: "置顶", high: "高", normal: "普通", low: "低" }[value] ?? value;
}

const MAX_REFERENCE_IMAGES = 11;

type ReferenceImage = { id: string; file: File; previewUrl: string };

export function ImageWorkbenchView() {
  const [, navigate] = useLocation();
  const referenceInputRef = useRef<HTMLInputElement>(null);
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
            <div className="history-sidebar-list">
              {history.map((asset) => (
                <div className="history-sidebar-item" key={asset.id}>
                  <div className="history-item-thumbnail">
                    {historyUrls[asset.id] ? (
                      <img src={historyUrls[asset.id]} alt={asset.name} />
                    ) : (
                      <div className="empty-thumbnail"><ImageIcon size={20} /></div>
                    )}
                  </div>
                  <div className="history-item-info">
                    <p className="history-item-name">{asset.name}</p>
                    <small className="history-item-meta">{new Date(asset.created_at || Date.now()).toLocaleDateString()}</small>
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

export default ImageWorkbenchView;
