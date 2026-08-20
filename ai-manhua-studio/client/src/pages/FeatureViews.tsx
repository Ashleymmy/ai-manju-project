/**
 * Style reminder: 影印分镜室 — each production surface is an editorial instrument panel, not a generic dashboard card wall.
 */
import {
  Aperture,
  Archive,
  ArrowUpRight,
  Box,
  Check,
  ChevronRight,
  Clapperboard,
  FileText,
  Film,
  FolderOpen,
  Hash,
  Image as ImageIcon,
  Layers3,
  Lightbulb,
  ListTree,
  Maximize2,
  Move3d,
  PanelRight,
  Pause,
  Play,
  Plus,
  Rotate3d,
  ScanSearch,
  Search,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  WandSparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  createTag,
  createTagAlias,
  deleteTag,
  deleteTagAlias,
  fetchImageModels,
  generateImages,
  getAssetContentObjectUrl,
  getAssetFolders,
  getAssetLibrary,
  getPreferences,
  getTrashedAssetLibrary,
  imageModelLabel,
  listAllTags,
  publicApiError,
  restoreAssets,
  trashAssets,
  updateAssetUserState,
  updatePreferences,
  updateTag,
  uploadAsset,
  type Asset,
  type AssetFolder,
  type GeneratedImage,
  type ImageModelCatalog,
  type PromptPreset,
  type SemanticTag,
} from "@/services/api";

export { ComicAssetsView } from "./ComicAssetsView";

const cityUrl = "";
const desertUrl = "";
const roomUrl = "";

function SurfaceTitle({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return <div className="feature-title"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{actions}</div>;
}

export function DirectorView() {
  const [tool, setTool] = useState("镜头");
  const [view, setView] = useState("perspective");
  return <div className="feature-page director-page"><SurfaceTitle eyebrow="DIRECTOR / SCENE 08" title="3D 导演台" description="先在可控机位里校准构图，再将镜头交还给生成流程。" actions={<><button className="outline-button small" onClick={() => toast.success("镜头构图快照已保存") }><Check size={15} /> 保存构图</button><button className="vermilion-button" onClick={() => toast.message("已将当前构图送入关键帧生成") }><WandSparkles size={16} /> 送入关键帧</button></>} /><div className="director-workspace"><aside className="director-rail"><p className="field-label">SCENE TOOLKIT</p>{[["镜头", Aperture], ["物件", Box], ["角色", Move3d], ["灯光", Lightbulb], ["世界", Rotate3d]].map(([label, Icon]) => <button key={label as string} className={tool === label ? "selected" : ""} onClick={() => setTool(label as string)}><Icon size={18} /><span>{label as string}</span></button>)}<div className="director-rail-foot"><span>SNAP</span><button onClick={() => toast.info("吸附已切换为 0.25m")}>0.25m</button></div></aside><section className="director-stage"><div className="director-toolbar"><div>{["perspective", "front", "side"].map((item) => <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{item === "perspective" ? "透视" : item === "front" ? "正视" : "侧视"}</button>)}</div><span>CAM_A · 35mm · f/2.8</span><button onClick={() => toast.info("已进入全屏预览") }><Maximize2 size={16} /></button></div><div className="scene-view"><img src={cityUrl} alt="雨夜巷口场景构图" /><div className="scene-grid" /><div className="camera-frame"><i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" /><b>SHOT 04 · RAIN SHELTER</b></div><div className="scene-object character"><span>CHR_01</span><i /></div><div className="scene-object prop"><span>PROP_12</span><i /></div><div className="horizon">HORIZON / 1.45m</div></div><div className="director-timeline"><div><button onClick={() => toast.message("预览播放") }><Play size={16} fill="currentColor" /></button><b>00:00:12:08</b></div><div className="shot-strip"><button className="shot-thumb selected"><img src={cityUrl} alt="" /><span>04</span></button><button className="shot-thumb"><img src={roomUrl} alt="" /><span>05</span></button><button className="shot-thumb"><img src={desertUrl} alt="" /><span>06</span></button><button className="add-shot"><Plus size={16} /></button></div></div></section><aside className="director-inspector"><p className="eyebrow">CAMERA INSPECTOR</p><h3>{tool}控制</h3><div className="inspector-preview"><img src={cityUrl} alt="镜头预览" /><span>CAM_A</span></div>{[["焦距", "35 mm"], ["景深", "f / 2.8"], ["高度", "1.65 m"], ["俯仰", "−4°"]].map(([label, value]) => <label key={label}>{label}<b>{value}</b><input type="range" defaultValue="55" /></label>)}<button className="full-outline" onClick={() => toast.message("参数将随当前导演台会话保存")}>应用到当前镜头 <ChevronRight size={16} /></button></aside></div></div>;
}

const candidates = [{ name: "阮澄", type: "主角 · character", image: desertUrl, tag: "待审" }, { name: "雨幕收容所", type: "核心场景 · environment", image: cityUrl, tag: "已识别" }, { name: "避雨亭", type: "关键道具 · prop", image: roomUrl, tag: "待审" }];

function LegacyComicAssetsView() {
  const [stage, setStage] = useState(1);
  const [selected, setSelected] = useState<string[]>(["阮澄", "雨幕收容所"]);
  const toggle = (name: string) => setSelected((items) => items.includes(name) ? items.filter((item) => item !== name) : [...items, name]);
  return <div className="feature-page comic-page"><SurfaceTitle eyebrow="COMIC ASSETS / PRJ-09" title="漫剧资产助手" description="把剧本拆解为可确认、可优化、可批量生成的角色与场景资产。" actions={<button className="vermilion-button" onClick={() => setStage(Math.min(3, stage + 1))}>{stage === 3 ? "创建生成批次" : "进入下一步"} <ChevronRight size={16} /></button>} /><div className="workflow-steps">{[[1, "上传剧本"], [2, "审阅候选"], [3, "批量生成"]].map(([number, label]) => <button key={number} className={stage === number ? "active" : stage > Number(number) ? "done" : ""} onClick={() => setStage(Number(number))}><i>{stage > Number(number) ? <Check size={12} /> : `0${number}`}</i><span>{label}</span></button>)}</div>{stage === 1 && <section className="script-intake"><div className="script-drop"><Upload size={26} /><h2>将剧本放进分镜室</h2><p>支持 PDF、DOCX 与纯文本。系统会提取角色、场景、道具和关键情绪线。</p><button className="outline-button" onClick={() => toast.success("《雨幕收容所_第01集.pdf》已加入分析队列") }><Upload size={16} /> 选择剧本文件</button></div><aside><p className="eyebrow">ANALYSIS SETTINGS</p><label>解析粒度<button>角色 + 场景 + 道具 <ChevronRight size={15} /></button></label><label>视觉基调<button>现实感悬疑 <ChevronRight size={15} /></button></label><div className="source-note"><FileText size={16} /><span>也可以从已有项目导入剧本文本。</span></div></aside></section>}{stage === 2 && <section className="candidate-review"><aside className="candidate-sidebar"><p className="eyebrow">SESSION / 07</p><h2>第 01 集<br />候选资产</h2><div className="analysis-meter"><i style={{ width: "78%" }} /><span>解析置信度 78%</span></div>{[["角色", "03"], ["环境", "06"], ["道具", "12"]].map(([label, count]) => <button key={label}><span>{label}</span><b>{count}</b></button>)}<button className="full-outline" onClick={() => toast.info("已创建新的候选修订版本")}>新建修订版本</button></aside><div className="candidate-grid">{candidates.map((candidate) => <article key={candidate.name} className={selected.includes(candidate.name) ? "candidate selected" : "candidate"}><div><img src={candidate.image} alt="" /><span>{candidate.tag}</span><button onClick={() => toggle(candidate.name)}>{selected.includes(candidate.name) ? <Check size={15} /> : <Plus size={15} />}</button></div><h3>{candidate.name}</h3><p>{candidate.type}</p><div className="candidate-tags"><span>电影感</span><span>雨夜</span></div><button className="prompt-link" onClick={() => toast.message(`已展开 ${candidate.name} 的提示词草稿`) }>审阅提示词 <ArrowUpRight size={14} /></button></article>)}</div><aside className="approval-panel"><p className="eyebrow">BATCH APPROVAL</p><h3>已选择 {selected.length} 项</h3><p>确认后将生成每项资产的标准提示词，并可进入批量图像生成。</p><button className="vermilion-button" onClick={() => setStage(3)}>确认分析结果 <Check size={16} /></button></aside></section>}{stage === 3 && <section className="batch-console"><div className="batch-header"><div><p className="eyebrow">GENERATION BATCH / B-2408</p><h2>第 01 集 · 初始资产批次</h2></div><span className="status-chip running">生成中</span></div>{candidates.map((candidate, index) => <div className="batch-row" key={candidate.name}><img src={candidate.image} alt="" /><div><b>{candidate.name}</b><span>{candidate.type} · G-IMAGE / HIGH</span><div className="job-progress"><i style={{ width: `${index === 0 ? 72 : index === 1 ? 100 : 38}%` }} /></div></div><span>{index === 1 ? "已完成" : `${index === 0 ? 72 : 38}%`}</span><button className="icon-button subtle" onClick={() => toast.info(index === 1 ? "结果已归档到资产库" : "已切换任务暂停状态")}>{index === 1 ? <Check size={16} /> : <Pause size={16} />}</button></div>)}<div className="batch-actions"><button className="outline-button" onClick={() => toast.message("失败项目已加入重试队列")}>重试失败项目</button><button className="outline-button" onClick={() => toast.success("全部结果将归档至资产库")}>查看归档去向</button></div></section>}</div>;
}

export function ImageWorkbenchView() {
  const [model, setModel] = useState("");
  const [modelCatalog, setModelCatalog] = useState<ImageModelCatalog | null>(null);
  const [size, setSize] = useState<"auto" | "1:1" | "16:9" | "9:16">("auto");
  const [count, setCount] = useState(1);
  const [prompt, setPrompt] = useState(() => sessionStorage.getItem("ai-manju:image-prompt") || "雨夜，狭长街道，潮湿沥青反射红色招牌；人物在画面右侧停留，低机位缓慢推近，电影级冷暖对比。");
  const [result, setResult] = useState<GeneratedImage[]>([]);
  const [selectedResult, setSelectedResult] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState(0);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    sessionStorage.removeItem("ai-manju:image-prompt");
    fetchImageModels()
      .then((catalog) => {
        setModelCatalog(catalog);
        setModel(catalog.defaultModel);
      })
      .catch((error) => toast.error(publicApiError(error, "读取图像模型失败")));
  }, []);

  const selectedImage = useMemo(() => result[selectedResult] || result[0], [result, selectedResult]);

  const generate = async () => {
    if (generating) return;
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
        sourceType: "image_workbench",
      }, {
        onAccepted: (job) => {
          setJobId(job.job_id || job.id || null);
          toast.message("已提交图像任务：" + (job.job_id || job.id || "—"));
        },
        onProgress: (job) => {
          setJobId(job.id);
          setJobProgress(job.progress ?? 0);
        },
      });
      setJobId(generated.job.id);
      setJobProgress(100);
      setResult(generated.images);
      toast.success("生成完成，共 " + generated.images.length + " 张");
    } catch (error) {
      toast.error(publicApiError(error, "图像生成失败"));
    } finally {
      setGenerating(false);
    }
  };

  return <div className="feature-page image-page"><SurfaceTitle eyebrow="KEYFRAME / NEW" title="关键帧生成" description="在一张可继续编辑的画面里落下镜头、氛围与人物关系。" actions={<button className="outline-button small" onClick={() => toast.info("草稿会在接入项目快照后保存")}>保存草稿</button>} /><div className="image-workbench"><section className="image-composer"><div className="composer-tabs"><button className="active">文生图</button><button onClick={() => toast.info("图生图将使用 /api/ai/image/edits")}>图生图</button><button onClick={() => toast.info("批量变体会复用当前提示词")}>批量变体</button></div><label className="prompt-editor"><span>SHOT PROMPT</span><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={800} /><small>{prompt.length} / 800 · 使用 / 插入提示词片段</small></label><div className="reference-strip"><div className="reference-card"><img src={cityUrl} alt="" /><span>构图参考（可选）</span><button onClick={() => toast.message("参考图槽位已清空")}>×</button></div><button className="add-reference" onClick={() => toast.info("请使用图生图模式上传参考图")}><Upload size={17} /> 添加参考图</button></div><div className="composer-options"><label>模型<div className="option-select">{model ? imageModelLabel(model, modelCatalog || undefined) : "读取中…"}<ChevronRight size={15} /></div><select value={model} onChange={(event) => setModel(event.target.value)} aria-label="选择图像模型" disabled={!modelCatalog?.models.length}>{modelCatalog?.models.map((item) => <option value={item} key={item}>{imageModelLabel(item, modelCatalog)}</option>)}</select></label><label>画幅<div className="ratio-buttons">{(["auto", "1:1", "16:9", "9:16"] as const).map((ratio) => <button key={ratio} className={size === ratio ? "active" : ""} onClick={() => setSize(ratio)}>{ratio === "auto" ? "AUTO" : ratio}</button>)}</div></label><label>数量<div className="counter"><button onClick={() => setCount((value) => Math.max(1, value - 1))}>−</button><b>{String(count).padStart(2, "0")}</b><button onClick={() => setCount((value) => Math.min(15, value + 1))}>+</button></div></label></div>{generating && <div className="job-progress" aria-label="图像生成进度"><i style={{ width: String(jobProgress) + "%" }} /></div>}<button className="vermilion-button generate-frame" onClick={() => void generate()} disabled={generating || !prompt.trim()}><WandSparkles size={17} /> {generating ? "生成中 " + jobProgress + "%" : "生成关键帧"}</button></section><aside className="generation-output"><div className="output-heading"><div><p className="eyebrow">RESULTS / {String(result.length).padStart(2, "0")}</p><h3>{generating ? "任务执行中" : result.length ? "本次落点" : "等待落点"}</h3>{jobId && <small>JOB · {jobId}</small>}</div><button className="icon-button subtle" onClick={() => selectedImage && window.open(selectedImage.src, "_blank")} disabled={!selectedImage}><SlidersHorizontal size={17} /></button></div>{result.length ? <div className="result-grid">{result.map((image, index) => <button key={image.id} className={index === selectedResult ? "result-card selected" : "result-card"} onClick={() => setSelectedResult(index)}><img src={image.src} alt={image.name || "生成结果"} /><span>V-{String(index + 1).padStart(2, "0")}</span>{index === selectedResult && <i><Check size={14} /></i>}</button>)}</div> : <div className="empty-output"><ImageIcon size={27} /><p>{generating ? "服务端正在生成并归档图片" : <>生成结果会在这里形成<br />可回到画布继续编辑的节点。</>}</p></div>}<div className="output-foot"><button onClick={() => selectedImage ? toast.success("已选结果，可从画布节点继续使用") : toast.info("请先生成并选择结果")}><Layers3 size={15} /> 送入画布</button><button onClick={() => selectedImage?.assetId ? toast.success("资产 " + selectedImage.assetId + " 已归档") : toast.info("结果完成后会由 Worker 自动归档")}><Clapperboard size={15} /> 归档资产</button></div></aside></div></div>;
}

export function AssetLibraryView() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [folders, setFolders] = useState<AssetFolder[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detailTab, setDetailTab] = useState("详情");
  const [smartView, setSmartView] = useState("全部资产");
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});

  const selected = assets.find((asset) => asset.id === selectedId) || assets[0];
  const smartViewKey: "favorite" | "unused" | "" = smartView === "已收藏" ? "favorite" : smartView === "未使用" ? "unused" : "";

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedKeyword(keyword), 250);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  useEffect(() => {
    getAssetFolders().then(setFolders).catch((error) => toast.error(publicApiError(error, "读取资产目录失败")));
  }, [refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const query = { keyword: debouncedKeyword.trim() || undefined, smartView: smartViewKey, page, pageSize: 30, sort: "created_at_desc" as const };
    const task = smartView === "回收站" ? getTrashedAssetLibrary("personal", query, controller.signal) : getAssetLibrary("personal", query, controller.signal);
    task.then((result) => {
      setAssets(result.items || []);
      setTotal(result.total || 0);
      setSelectedId((current) => result.items.some((item) => item.id === current) ? current : result.items[0]?.id || "");
    }).catch((error) => {
      if (!controller.signal.aborted) toast.error(publicApiError(error, "读取资产库失败"));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [debouncedKeyword, page, refreshKey, smartView, smartViewKey]);

  useEffect(() => {
    let disposed = false;
    const urls: Record<string, string> = {};
    Promise.all(assets.filter((asset) => asset.type === "image").map(async (asset) => {
      try {
        const url = await getAssetContentObjectUrl(asset.id, "personal", 320);
        if (disposed) URL.revokeObjectURL(url);
        else urls[asset.id] = url;
      } catch {
        // 单个缩略图失败不阻塞资产列表。
      }
    })).then(() => {
      if (!disposed) setPreviewUrls(urls);
    });
    return () => {
      disposed = true;
      Object.values(urls).forEach(URL.revokeObjectURL);
    };
  }, [assets]);

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length || uploading) return;
    setUploading(true);
    let succeeded = 0;
    for (const file of list) {
      try {
        await uploadAsset(file, { name: file.name, source_type: "manual_upload" });
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

  const toggleFavorite = async () => {
    if (!selected) return;
    const reaction = selected.user_state?.reaction === "favorite" ? "none" : "favorite";
    try {
      const userState = await updateAssetUserState(selected.id, { reaction });
      setAssets((items) => items.map((item) => item.id === selected.id ? { ...item, user_state: userState } : item));
      toast.success(reaction === "favorite" ? "已收藏" : "已取消收藏");
    } catch (error) {
      toast.error(publicApiError(error, "更新收藏状态失败"));
    }
  };

  const removeOrRestore = async () => {
    if (!selected) return;
    try {
      if (smartView === "回收站") {
        await restoreAssets([selected.id]);
        toast.success("资产已恢复");
      } else {
        if (!window.confirm(`将“${selected.name}”移入 30 天回收站？`)) return;
        await trashAssets([selected.id]);
        toast.success("资产已移入回收站");
      }
      refresh();
    } catch (error) {
      toast.error(publicApiError(error, "资产操作失败"));
    }
  };

  const downloadSelected = async () => {
    if (!selected) return;
    try {
      const url = await getAssetContentObjectUrl(selected.id);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = selected.name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (error) {
      toast.error(publicApiError(error, "下载资产失败"));
    }
  };

  return <div className="feature-page asset-library-page">
    <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => event.target.files && void handleFiles(event.target.files)} />
    <SurfaceTitle eyebrow={`LIBRARY / ${total}`} title="资产库" description="角色、环境、道具与参考素材都能追溯来处、关系和使用位置。" actions={<><button className="outline-button small" onClick={() => toast.info("批量选择将在下一阶段接入") }><ListTree size={15} /> 批量操作</button><button className="vermilion-button" disabled={uploading} onClick={() => fileInputRef.current?.click()}><Upload size={16} /> {uploading ? "上传中…" : "导入资产"}</button></>} />
    <div className="library-workspace">
      <aside className="library-tree"><p className="field-label">SMART VIEWS</p>{["全部资产", "已收藏", "未使用", "回收站"].map((label) => <button className={smartView === label ? "selected" : ""} onClick={() => { setSmartView(label); setPage(1); }} key={label}><span>{label === "回收站" ? <Trash2 size={15} /> : label === "已收藏" ? <Sparkles size={15} /> : <Archive size={15} />}{label}</span></button>)}<hr /><p className="field-label">FOLDERS</p>{folders.map((folder) => <button className="folder-row" key={folder.id} onClick={() => toast.info(`目录筛选即将接入：${folder.name}`)}><FolderOpen size={15} /><span>{folder.name}</span><b>{folder.descendant_asset_count ?? folder.asset_count}</b></button>)}</aside>
      <section className="asset-browser" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void handleFiles(event.dataTransfer.files); }}><div className="asset-browser-top"><div><button className="breadcrumb">个人素材 <ChevronRight size={13} /></button><h2>{smartView}</h2></div><div className="tag-search"><Search size={15} /><input value={keyword} onChange={(event) => { setKeyword(event.target.value); setPage(1); }} placeholder="搜索资产名称、来源或标签" /></div></div>{loading ? <div className="empty-output"><p>正在读取资产…</p></div> : assets.length ? <div className="asset-thumb-grid">{assets.map((asset) => <button className={selected?.id === asset.id ? "library-asset selected" : "library-asset"} key={asset.id} onClick={() => setSelectedId(asset.id)}>{previewUrls[asset.id] ? <img src={previewUrls[asset.id]} alt={asset.name} /> : <div className="empty-output"><ImageIcon size={22} /></div>}<span className="asset-category">{asset.category || asset.type}</span><i>{asset.id.slice(-8)}</i><div><b>{asset.name}</b><small>{asset.source_type || "unknown"}</small></div></button>)}</div> : <div className="empty-output"><Archive size={26} /><p>当前筛选下没有资产<br />可直接把文件拖入此区域上传。</p></div>}<div className="batch-actions"><button className="outline-button small" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button><span>{page} / {Math.max(1, Math.ceil(total / 30))}</span><button className="outline-button small" disabled={page * 30 >= total} onClick={() => setPage((value) => value + 1)}>下一页</button></div></section>
      <aside className="asset-detail">{selected ? <><div className="detail-head"><div><p className="eyebrow">ASSET / {selected.id.slice(-8)}</p><h3>{selected.name}</h3></div><button className="icon-button subtle" onClick={() => void removeOrRestore()}>{smartView === "回收站" ? <Archive size={16} /> : <Trash2 size={16} />}</button></div>{previewUrls[selected.id] ? <img className="detail-image" src={previewUrls[selected.id]} alt={selected.name} /> : <div className="empty-output"><ImageIcon size={28} /></div>}<div className="detail-tabs">{["详情", "血缘", "使用"].map((tab) => <button className={detailTab === tab ? "active" : ""} onClick={() => setDetailTab(tab)} key={tab}>{tab}</button>)}</div>{detailTab === "详情" ? <div className="asset-metadata"><div><span>分类</span><b>{selected.category || selected.type}</b></div><div><span>来源</span><b>{selected.source_type || "unknown"}</b></div><div><span>大小</span><b>{selected.size ? `${(selected.size / 1024 / 1024).toFixed(2)} MB` : "—"}</b></div><div><span>标签</span><b>{selected.tags?.join(" · ") || "未绑定"}</b></div></div> : detailTab === "血缘" ? <div className="lineage-flow"><span>{selected.source_type || "来源未知"}</span><i /><strong>{selected.name}</strong></div> : <div className="usage-list"><div><b>生成调用</b><small>{selected.usage_stats?.generation_use_count || 0} 次</small></div><div><b>有效引用</b><small>{selected.usage_stats?.active_reference_count || 0} 处</small></div></div>}<div className="asset-detail-actions"><button onClick={() => void toggleFavorite()}><Sparkles size={15} /> {selected.user_state?.reaction === "favorite" ? "取消收藏" : "收藏"}</button><button onClick={() => void downloadSelected()}><Archive size={15} /> 下载</button></div></> : <div className="empty-output"><p>选择一项资产查看详情</p></div>}</aside>
    </div>
  </div>;
}

export function TagLibraryView() {
  const [tags, setTags] = useState<SemanticTag[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [alias, setAlias] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (preferredId?: string) => {
    setLoading(true);
    try {
      const items = await listAllTags("personal");
      setTags(items);
      setSelectedId((current) => preferredId || (items.some((item) => item.id === current) ? current : items[0]?.id || ""));
    } catch (error) {
      toast.error(publicApiError(error, "读取标签库失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const current = tags.find((tag) => tag.id === selectedId);
  useEffect(() => {
    setDraftName(current?.name || "");
    setDraftDescription(current?.description || "");
  }, [current?.description, current?.id, current?.name]);

  const visibleTags = tags.filter((tag) => !query.trim() || tag.name.toLowerCase().includes(query.trim().toLowerCase()) || tag.aliases?.some((item) => item.alias.toLowerCase().includes(query.trim().toLowerCase())));
  const roots = visibleTags.filter((tag) => !tag.parent_id || !tags.some((parent) => parent.id === tag.parent_id));

  const addRoot = async () => {
    const name = window.prompt("新标签名称");
    if (!name?.trim()) return;
    try {
      const created = await createTag("personal", { name: name.trim(), asset_enabled: true, prompt_enabled: true, inherit_mode: "auto", scope_type: "user" });
      toast.success("标签已创建");
      await reload(created.id);
    } catch (error) {
      toast.error(publicApiError(error, "创建标签失败"));
    }
  };

  const saveCurrent = async () => {
    if (!current || !draftName.trim()) return;
    try {
      const saved = await updateTag("personal", current.id, { name: draftName.trim(), description: draftDescription.trim(), asset_enabled: current.asset_enabled, prompt_enabled: current.prompt_enabled, inherit_mode: current.inherit_mode, status: current.status, sort_order: current.sort_order });
      setTags((items) => items.map((item) => item.id === saved.id ? saved : item));
      toast.success("标签已保存");
    } catch (error) {
      toast.error(publicApiError(error, "保存标签失败"));
    }
  };

  const archiveCurrent = async () => {
    if (!current || !window.confirm(`删除“${current.name}”及其可归档子标签？`)) return;
    try {
      await deleteTag("personal", current.id);
      toast.success("标签已删除");
      await reload();
    } catch (error) {
      toast.error(publicApiError(error, "删除标签失败"));
    }
  };

  const addAlias = async () => {
    if (!current || !alias.trim()) return;
    try {
      await createTagAlias("personal", current.id, alias.trim());
      setAlias("");
      await reload(current.id);
    } catch (error) {
      toast.error(publicApiError(error, "添加别名失败"));
    }
  };

  return <div className="feature-page tag-page"><SurfaceTitle eyebrow={`TAXONOMY / ${tags.length}`} title="标签库" description="让构图、情绪与资产在统一的语义索引里互相找到。" actions={<button className="vermilion-button" onClick={() => void addRoot()}><Plus size={16} /> 新建标签</button>} /><div className="tag-workspace"><aside className="tag-tree"><div className="tag-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="检索标签" /></div><p className="field-label">TAG TREE</p>{loading ? <small>读取中…</small> : roots.map((root) => <div className="tag-group" key={root.id}><button className={selectedId === root.id ? "selected" : ""} onClick={() => setSelectedId(root.id)}><ChevronRight size={13} />{root.name}<span>{root.asset_count || 0}</span></button>{visibleTags.filter((tag) => tag.parent_id === root.id).map((child) => <button className={selectedId === child.id ? "selected" : ""} onClick={() => setSelectedId(child.id)} key={child.id}><Hash size={13} />{child.name}<span>{child.asset_count || 0}</span></button>)}</div>)}</aside><section className="tag-editor">{current ? <><div className="tag-editor-head"><div><p className="eyebrow">{current.scope_type} / SEMANTIC TAG</p><h2>#{current.name}</h2></div><button className="icon-button subtle" onClick={() => void archiveCurrent()} disabled={!current.editable}><Trash2 size={16} /></button></div><div className="tag-description"><span className="field-label">名称</span><input value={draftName} onChange={(event) => setDraftName(event.target.value)} disabled={!current.editable} /><span className="field-label">描述</span><textarea value={draftDescription} onChange={(event) => setDraftDescription(event.target.value)} disabled={!current.editable} /></div><div className="tag-settings"><label>继承模式<div className="tag-select">{current.inherit_mode} <ChevronRight size={14} /></div></label><label>作用范围<div className="tag-select">{current.asset_enabled && current.prompt_enabled ? "资产 + 提示词" : current.asset_enabled ? "资产" : "提示词"} <ChevronRight size={14} /></div></label></div><section className="aliases"><div><span className="field-label">别名</span><small>搜索时会一并匹配</small></div><div className="alias-list">{current.aliases?.map((item) => <span key={item.id}>{item.alias}<button onClick={async () => { await deleteTagAlias("personal", current.id, item.id); await reload(current.id); }}>×</button></span>)}</div><div className="alias-create"><input value={alias} onChange={(event) => setAlias(event.target.value)} placeholder="添加别名" /><button onClick={() => void addAlias()}>添加</button></div></section><button className="vermilion-button save-tag" disabled={!current.editable} onClick={() => void saveCurrent()}><Check size={16} /> 保存标签</button></> : <div className="empty-output"><p>当前没有可编辑标签</p></div>}</section><aside className="tag-relations"><p className="eyebrow">CONNECTIONS</p><div><b>{current?.asset_count || 0}</b><span>关联资产</span><button onClick={() => toast.info("可在资产库使用此标签筛选")}>查看资产 <ArrowUpRight size={14} /></button></div><div><b>{current?.prompt_count || 0}</b><span>提示词模板</span><button onClick={() => toast.info("可在提示词库使用此标签筛选")}>查看提示词 <ArrowUpRight size={14} /></button></div></aside></div></div>;
}

export function PromptLibraryView() {
  const [presets, setPresets] = useState<PromptPreset[]>([]);
  const [activeId, setActiveId] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const active = presets.find((item) => item.id === activeId) || presets[0];
  const visible = presets.filter((item) => !query.trim() || item.priority === query || item.title.includes(query) || item.prompt.includes(query) || item.tags.some((tag) => tag.includes(query)));
  const commonTags = Array.from(new Set(presets.flatMap((item) => item.tags))).slice(0, 8);

  const loadPresets = useCallback(async () => {
    setLoading(true);
    try {
      const preferences = await getPreferences();
      const items = preferences.canvas?.promptPresets || [];
      setPresets(items);
      setActiveId((current) => items.some((item) => item.id === current) ? current : items[0]?.id || "");
    } catch (error) {
      toast.error(publicApiError(error, "读取个人提示词失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadPresets(); }, [loadPresets]);

  const persist = async (next: PromptPreset[], success: string) => {
    try {
      const preferences = await updatePreferences({ canvas: { promptPresets: next } });
      const saved = preferences.canvas?.promptPresets || next;
      setPresets(saved);
      toast.success(success);
    } catch (error) {
      toast.error(publicApiError(error, "保存提示词失败"));
    }
  };

  const createPreset = async () => {
    const now = new Date().toISOString();
    const created: PromptPreset = { id: crypto.randomUUID(), title: "未命名提示词", prompt: "请在此填写提示词内容。", tags: [], priority: "normal", sort_order: presets.length, createdAt: now, updatedAt: now };
    const next = [...presets, created];
    setActiveId(created.id);
    await persist(next, "已创建提示词预设");
  };

  const patchActive = (patch: Partial<PromptPreset>) => {
    if (!active) return;
    setPresets((items) => items.map((item) => item.id === active.id ? { ...item, ...patch } : item));
  };

  const saveActive = async () => {
    if (!active) return;
    await persist(presets.map((item) => item.id === active.id ? { ...item, updatedAt: new Date().toISOString() } : item), "提示词已保存");
  };

  return <div className="feature-page prompt-page"><SurfaceTitle eyebrow={`PROMPTS / ${presets.length}`} title="个人提示词库" description="把反复有效的视觉语言变成下一次镜头的可调用片段。" actions={<button className="vermilion-button" onClick={() => void createPreset()}><Plus size={16} /> 新建预设</button>} /><div className="prompt-workspace"><aside className="prompt-filters"><div className="tag-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="关键词、标签或镜头" /></div><p className="field-label">PRIORITY</p>{[["置顶", "pinned"], ["高", "high"], ["普通", "normal"], ["低", "low"]].map(([name, key]) => <button onClick={() => setQuery(key)} key={key}><span>{name}</span><b>{presets.filter((item) => item.priority === key).length}</b></button>)}<hr /><p className="field-label">常用标签</p>{commonTags.map((tag) => <button className="tag-filter" onClick={() => setQuery(tag)} key={tag}>#{tag}</button>)}</aside><section className="template-list"><div className="template-list-head"><span>{loading ? "读取中…" : `匹配到 ${visible.length} 条视觉片段`}</span></div>{visible.map((item) => <button className={active?.id === item.id ? "template-card selected" : "template-card"} onClick={() => setActiveId(item.id)} key={item.id}><div><span>{item.priority}</span><b>{item.title}</b><p>{item.prompt || "尚未填写提示词"}</p></div><div className="template-card-tags">{item.tags.map((tag) => <i key={tag}>#{tag}</i>)}</div></button>)}</section><aside className="prompt-preview">{active ? <><div><p className="eyebrow">PRESET PREVIEW</p><input value={active.title} onChange={(event) => patchActive({ title: event.target.value })} /></div><div className="preview-tags">{active.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div><textarea value={active.prompt} onChange={(event) => patchActive({ prompt: event.target.value })} /><input value={active.tags.join(", ")} onChange={(event) => patchActive({ tags: event.target.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) })} placeholder="标签，以逗号分隔" /><select value={active.priority} onChange={(event) => patchActive({ priority: event.target.value as PromptPreset["priority"] })}><option value="pinned">置顶</option><option value="high">高</option><option value="normal">普通</option><option value="low">低</option></select><button className="vermilion-button" onClick={() => void saveActive()}><Check size={16} /> 保存预设</button><button className="full-outline" onClick={() => { sessionStorage.setItem("ai-manju:image-prompt", active.prompt); window.location.assign("/image"); }}><WandSparkles size={16} /> 送入关键帧</button><button className="full-outline" onClick={async () => { await navigator.clipboard.writeText(active.prompt); toast.success("提示词已复制"); }}><FileText size={15} /> 复制完整提示词</button><button className="full-outline" onClick={() => { if (window.confirm(`删除“${active.title}”？`)) void persist(presets.filter((item) => item.id !== active.id), "提示词已删除"); }}><Trash2 size={15} /> 删除预设</button></> : <div className="empty-output"><p>暂无个人提示词预设</p></div>}</aside></div></div>;
}
