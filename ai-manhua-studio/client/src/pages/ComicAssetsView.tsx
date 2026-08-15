import { ArrowUpRight, Check, ChevronRight, FileText, Image as ImageIcon, Plus, Sparkles, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  confirmComicAnalysisSession,
  bulkApproveComicPrompts,
  controlComicBatch,
  createComicBatch,
  createComicAnalysisRevision,
  createComicAnalysisSession,
  fetchImageModels,
  fetchTextModels,
  getComicBatch,
  getComicProject,
  imageModelLabel,
  listComicBatches,
  listComicProjects,
  optimizeComicPrompt,
  publicApiError,
  retryFailedComicBatchItems,
  saveComicPrompt,
  type ComicAnalysisDetail,
  type ComicAsset,
  type ComicBatchDetail,
  type ComicAssetProject,
  type ComicProjectDetail,
  type ImageModelCatalog,
  type TextModelCatalog,
  type WorkspaceScope,
} from "@/services/api";

const defaultInstruction = "请逐场检查剧本，不要遗漏有视觉特征或连续性要求的角色、场景和道具。";
const scopeOptions: Array<{ value: WorkspaceScope; label: string }> = [
  { value: "personal", label: "个人空间" },
  { value: "team", label: "团队空间" },
];

function SurfaceTitle({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return <div className="feature-title"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{actions}</div>;
}

export function ComicAssetsView() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scope, setScope] = useState<WorkspaceScope>("personal");
  const [stage, setStage] = useState(1);
  const [projects, setProjects] = useState<ComicAssetProject[]>([]);
  const [projectDetail, setProjectDetail] = useState<ComicProjectDetail | null>(null);
  const [analysis, setAnalysis] = useState<ComicAnalysisDetail | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [title, setTitle] = useState("");
  const [stylePreset, setStylePreset] = useState("");
  const [instruction, setInstruction] = useState(defaultInstruction);
  const [revisionInstruction, setRevisionInstruction] = useState("");
  const [models, setModels] = useState<TextModelCatalog | null>(null);
  const [model, setModel] = useState("");
  const [imageModels, setImageModels] = useState<ImageModelCatalog | null>(null);
  const [generationModel, setGenerationModel] = useState("");
  const [generationSize, setGenerationSize] = useState("auto");
  const [optimizeDirection, setOptimizeDirection] = useState("保留原始设定细节，补足可视化特征，避免随意改写人物身份、场景关系和关键道具。");
  const [batchDetail, setBatchDetail] = useState<ComicBatchDetail | null>(null);
  const [promptBusy, setPromptBusy] = useState("");
  const [busy, setBusy] = useState(false);

  const activeRevision = useMemo(
    () => analysis?.revisions.find((item) => item.id === analysis.session.active_revision_id) || analysis?.revisions.at(-1),
    [analysis],
  );
  const candidates = activeRevision?.candidate.assets || projectDetail?.assets || [];
  const projectAssets = projectDetail?.assets || [];
  const selectedProjectAssets = projectAssets.filter((asset) => selected.includes(asset.id));

  const reloadProjects = useCallback(async () => {
    try {
      setProjects(await listComicProjects(scope));
    } catch (error) {
      toast.error(publicApiError(error, "读取漫剧项目失败"));
    }
  }, [scope]);

  useEffect(() => {
    void reloadProjects();
    fetchTextModels().then((catalog) => {
      setModels(catalog);
      setModel(catalog.defaultModel);
    }).catch((error) => toast.error(publicApiError(error, "读取文本模型失败")));
    fetchImageModels().then((catalog) => {
      setImageModels(catalog);
      setGenerationModel(catalog.defaultModel);
    }).catch((error) => toast.error(publicApiError(error, "读取图像模型失败")));
  }, [reloadProjects]);

  const toggle = (id: string) => {
    setSelected((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  };

  const analyze = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return toast.error("请先选择 TXT 或 MD 剧本");
    if (!title.trim()) return toast.error("请填写项目名称");
    if (!model) return toast.error("请先配置并选择文本模型");
    if (!instruction.trim()) return toast.error("请填写首次分析方向");
    const extension = file.name.toLowerCase().split(".").pop();
    if (extension !== "txt" && extension !== "md") {
      return toast.error("重构版当前仅开放 TXT/MD；DOCX 解析器仍在迁移");
    }

    setBusy(true);
    try {
      const sourceText = (await file.text()).trim();
      if (!sourceText) throw new Error("剧本没有可读取的文字内容");
      const detail = await createComicAnalysisSession({
        title: title.trim(),
        style_preset: stylePreset.trim(),
        source_text: sourceText.slice(0, 120_000),
        instruction: instruction.trim(),
        model,
      }, file, scope);
      const revision = detail.revisions.find((item) => item.id === detail.session.active_revision_id) || detail.revisions.at(-1);
      setAnalysis(detail);
      setProjectDetail(null);
      setSelected(revision?.candidate.assets.map((item) => item.name) || []);
      setStage(2);
      toast.success(`已识别 ${revision?.candidate.assets.length || 0} 项候选资产`);
    } catch (error) {
      toast.error(publicApiError(error, "剧本分析失败"));
    } finally {
      setBusy(false);
    }
  };

  const revise = async () => {
    if (!analysis || !activeRevision || !revisionInstruction.trim()) return;
    setBusy(true);
    try {
      const detail = await createComicAnalysisRevision(analysis.session.id, {
        instruction: revisionInstruction.trim(),
        model,
        parent_revision_id: activeRevision.id,
        expected_active_revision_id: analysis.session.active_revision_id,
      }, scope);
      setAnalysis(detail);
      setRevisionInstruction("");
      toast.success("已生成新的分析版本");
    } catch (error) {
      toast.error(publicApiError(error, "再次分析失败"));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!analysis || !activeRevision) return;
    setBusy(true);
    try {
      const detail = await confirmComicAnalysisSession(analysis.session.id, activeRevision.id, scope);
      setProjectDetail(detail);
      setSelected(detail.assets.map((asset) => asset.id));
      setStage(3);
      await reloadProjects();
      toast.success("分析版本已确认并创建项目");
    } catch (error) {
      toast.error(publicApiError(error, "确认分析失败"));
    } finally {
      setBusy(false);
    }
  };

  const openProject = async (projectId: string) => {
    if (!projectId) return;
    setBusy(true);
    try {
      const detail = await getComicProject(projectId, scope);
      setProjectDetail(detail);
      setAnalysis(null);
      setSelected(detail.assets.map((item) => item.id));
      setStage(3);
      void loadLatestBatch(detail.project.id);
    } catch (error) {
      toast.error(publicApiError(error, "读取漫剧项目失败"));
    } finally {
      setBusy(false);
    }
  };

  const loadLatestBatch = useCallback(async (projectId: string) => {
    try {
      const batches = await listComicBatches(projectId, scope);
      const latest = [...batches].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
      setBatchDetail(latest ? await getComicBatch(latest.id, scope) : null);
    } catch (error) {
      toast.error(publicApiError(error, "读取生成批次失败"));
    }
  }, [scope]);

  const refreshProjectDetail = useCallback(async (projectId = projectDetail?.project.id || "") => {
    if (!projectId) return;
    const detail = await getComicProject(projectId, scope);
    setProjectDetail(detail);
    setSelected((items) => items.length ? items.filter((id) => detail.assets.some((asset) => asset.id === id)) : detail.assets.map((asset) => asset.id));
  }, [projectDetail?.project.id, scope]);

  useEffect(() => {
    if (projectDetail?.project.id) void loadLatestBatch(projectDetail.project.id);
  }, [loadLatestBatch, projectDetail?.project.id]);

  useEffect(() => {
    const batchId = batchDetail?.batch.id;
    const status = batchDetail?.batch.status;
    if (!batchId || !["queued", "running", "paused", "stopping"].includes(status || "")) return;
    const timer = window.setInterval(() => {
      void getComicBatch(batchId, scope).then(setBatchDetail).catch(() => undefined);
      if (projectDetail?.project.id) void refreshProjectDetail(projectDetail.project.id).catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [batchDetail?.batch.id, batchDetail?.batch.status, projectDetail?.project.id, refreshProjectDetail, scope]);

  const mergeAsset = (asset: ComicAsset) => {
    setProjectDetail((detail) => detail ? { ...detail, assets: detail.assets.map((item) => item.id === asset.id ? asset : item) } : detail);
  };

  const optimizeAssetPrompt = async (asset: ComicAsset, operation: "optimize" | "merge") => {
    if (!projectDetail) return;
    if (!optimizeDirection.trim()) return toast.error("请先填写优化方向");
    setPromptBusy(asset.id + operation);
    try {
      const result = await optimizeComicPrompt(projectDetail.project.id, asset.id, {
        direction: optimizeDirection.trim(),
        model,
        operation,
        base_content: operation === "merge" ? [asset.source_prompt, asset.draft_prompt, asset.approved_prompt].filter(Boolean).join("\n\n") : undefined,
        expected_prompt_version: asset.prompt_version,
      }, scope);
      mergeAsset(result.asset);
      toast.success(operation === "merge" ? "已生成融合提示词草稿" : "已生成 AI 优化草稿");
    } catch (error) {
      toast.error(publicApiError(error, "优化提示词失败"));
    } finally {
      setPromptBusy("");
    }
  };

  const approveAssetPrompt = async (asset: ComicAsset) => {
    if (!projectDetail) return;
    const content = asset.draft_prompt || asset.approved_prompt || asset.source_prompt;
    if (!content.trim()) return toast.error("此资产没有可批准的提示词");
    setPromptBusy(asset.id + "approve");
    try {
      mergeAsset(await saveComicPrompt(projectDetail.project.id, asset.id, { content, source: "manual", action: "approve" }, scope));
      toast.success("提示词已确认");
    } catch (error) {
      toast.error(publicApiError(error, "确认提示词失败"));
    } finally {
      setPromptBusy("");
    }
  };

  const approveSelectedPrompts = async () => {
    if (!projectDetail) return;
    const approvals = selectedProjectAssets
      .filter((asset) => asset.prompt_status !== "approved")
      .map((asset) => ({ asset_id: asset.id, expected_prompt_version: asset.prompt_version }));
    if (!approvals.length) return toast.info("当前选中资产都已经确认");
    setPromptBusy("bulk-approve");
    try {
      const result = await bulkApproveComicPrompts(projectDetail.project.id, approvals, scope);
      const okAssets = result.results.flatMap((item) => item.asset ? [item.asset] : []);
      setProjectDetail((detail) => detail ? {
        ...detail,
        assets: detail.assets.map((asset) => okAssets.find((item) => item.id === asset.id) || asset),
      } : detail);
      toast.success(`批量确认完成：${result.results.filter((item) => item.ok).length} 成功，${result.results.filter((item) => !item.ok).length} 失败`);
    } catch (error) {
      toast.error(publicApiError(error, "批量确认提示词失败"));
    } finally {
      setPromptBusy("");
    }
  };

  const createGenerationBatch = async () => {
    if (!projectDetail) return;
    const approved = selectedProjectAssets.filter((asset) => asset.prompt_status === "approved");
    if (!approved.length) return toast.error("请先选择已确认提示词的资产");
    if (!generationModel) return toast.error("请先选择图像模型");
    setPromptBusy("batch-create");
    try {
      const detail = await createComicBatch(projectDetail.project.id, {
        asset_ids: approved.map((asset) => asset.id),
        model_selector: generationModel,
        size: generationSize,
        quality: "auto",
        output_format: "png",
        concurrency: 2,
      }, scope);
      setBatchDetail(detail);
      toast.success("批量生成已创建，关闭页面不影响执行");
    } catch (error) {
      toast.error(publicApiError(error, "创建批量生成失败"));
    } finally {
      setPromptBusy("");
    }
  };

  const controlBatch = async (action: "pause" | "resume" | "stop") => {
    if (!batchDetail) return;
    setPromptBusy("batch-control");
    try {
      setBatchDetail(await controlComicBatch(batchDetail.batch.id, action, scope));
    } catch (error) {
      toast.error(publicApiError(error, "控制批次失败"));
    } finally {
      setPromptBusy("");
    }
  };

  const retryFailedBatch = async () => {
    if (!batchDetail) return;
    setPromptBusy("batch-retry");
    try {
      setBatchDetail(await retryFailedComicBatchItems(batchDetail.batch.id, scope));
    } catch (error) {
      toast.error(publicApiError(error, "重试失败项失败"));
    } finally {
      setPromptBusy("");
    }
  };

  const stageAction = stage === 1
    ? <button className="vermilion-button" disabled={busy} onClick={() => void analyze()}>{busy ? "分析中…" : "开始分析"} <ChevronRight size={16} /></button>
    : stage === 2
      ? <button className="vermilion-button" disabled={busy || !analysis} onClick={() => void confirm()}>确认当前版本 <Check size={16} /></button>
      : <button className="vermilion-button" onClick={() => setStage(1)}><Plus size={16} /> 新建分析</button>;

  return <div className="feature-page comic-page">
    <input ref={fileInputRef} hidden type="file" accept=".txt,.md,text/plain,text/markdown" onChange={(event) => setFileName(event.target.files?.[0]?.name || "")} />
    <SurfaceTitle eyebrow={`COMIC ASSETS / ${projects.length}`} title="漫剧资产助手" description="把剧本拆解为可确认、可优化、可批量生成的角色与场景资产。"
      actions={<div className="scope-switch">{scopeOptions.map((item) => <button key={item.value} className={scope === item.value ? "active" : ""} onClick={() => { setScope(item.value); setProjectDetail(null); setAnalysis(null); setBatchDetail(null); setSelected([]); setStage(1); }}>{item.label}</button>)}{stageAction}</div>} />
    <div className="workflow-steps">{[[1, "上传剧本"], [2, "审阅候选"], [3, "项目资产"]].map(([number, label]) => <button key={number} className={stage === number ? "active" : stage > Number(number) ? "done" : ""} onClick={() => Number(number) <= stage && setStage(Number(number))}><i>{stage > Number(number) ? <Check size={12} /> : `0${number}`}</i><span>{label}</span></button>)}</div>

    {stage === 1 && <section className="script-intake">
      <div className="script-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (event.dataTransfer.files[0]) { const transfer = new DataTransfer(); transfer.items.add(event.dataTransfer.files[0]); if (fileInputRef.current) fileInputRef.current.files = transfer.files; setFileName(event.dataTransfer.files[0].name); } }}><Upload size={26} /><h2>将剧本放进分镜室</h2><p>当前支持 TXT 与 MD。首轮分析会带上你填写的方向，不再让模型完全自由发挥。可点击选择，也可直接拖入文件。</p><button className="outline-button" onClick={() => fileInputRef.current?.click()}><Upload size={16} /> {fileName || "选择 / 拖入剧本文件"}</button></div>
      <aside><p className="eyebrow">ANALYSIS SETTINGS</p><label>项目名称<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：雨幕收容所" /></label><label>风格基调<input value={stylePreset} onChange={(event) => setStylePreset(event.target.value)} placeholder="例如：现实感悬疑" /></label><label>文本模型<select value={model} onChange={(event) => setModel(event.target.value)}><option value="">选择文本模型</option>{models?.models.map((item) => <option key={item} value={item}>{imageModelLabel(item, models)}</option>)}</select></label><label>首次分析方向<textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} /></label><hr /><label>打开已有项目<select defaultValue="" onChange={(event) => void openProject(event.target.value)}><option value="">选择项目</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label></aside>
    </section>}

    {stage === 2 && <section className="candidate-review">
      <aside className="candidate-sidebar"><p className="eyebrow">SESSION / {analysis?.session.id.slice(-6)}</p><h2>{analysis?.session.title}<br />候选资产</h2><div className="analysis-meter"><i style={{ width: "100%" }} /><span>v{activeRevision?.version || 1} · {activeRevision?.response_model || "manual"}</span></div>{(["character", "environment", "prop", "ui"] as const).map((item) => <button key={item}><span>{item}</span><b>{String(candidates.filter((asset) => asset.class === item).length).padStart(2, "0")}</b></button>)}<textarea value={revisionInstruction} onChange={(event) => setRevisionInstruction(event.target.value)} placeholder="告诉 AI 哪些资产被遗漏，或需要如何加强" /><button className="full-outline" disabled={busy || !revisionInstruction.trim()} onClick={() => void revise()}>根据意见再分析一版</button></aside>
      <div className="candidate-grid">{candidates.map((candidate) => <article key={`${candidate.code}-${candidate.name}`} className={selected.includes(candidate.name) ? "candidate selected" : "candidate"}><div><div className="empty-output"><ImageIcon size={24} /></div><span>{candidate.archive_status || "待审"}</span><button onClick={() => toggle(candidate.name)}>{selected.includes(candidate.name) ? <Check size={15} /> : <Plus size={15} />}</button></div><h3>{candidate.name}</h3><p>{candidate.class} · {candidate.state}</p><div className="candidate-tags"><span>{candidate.code || "AUTO"}</span></div><button className="prompt-link" onClick={() => toast.message(candidate.source_prompt || candidate.visual_description || "暂无提示词")}>查看提示词 <ArrowUpRight size={14} /></button></article>)}</div>
      <aside className="approval-panel"><p className="eyebrow">VERSION REVIEW</p><h3>当前 v{activeRevision?.version || 1}</h3><p>只有点击“确认当前版本”后才会创建正式项目；这里的勾选仅用于辅助审阅。</p></aside>
    </section>}

    {stage === 3 && <section className="batch-console comic-batch-console">
      <div className="batch-header"><div><p className="eyebrow">PROJECT / {projectDetail?.project.id.slice(-8)}</p><h2>{projectDetail?.project.title || "已确认项目"}</h2></div><span className="status-chip succeeded">{projectAssets.length} 项资产</span></div>
      <div className="comic-console-layout">
        <section className="comic-asset-review-list">
          <div className="comic-toolbar">
            <label><input type="checkbox" checked={projectAssets.length > 0 && selectedProjectAssets.length === projectAssets.length} onChange={(event) => setSelected(event.target.checked ? projectAssets.map((asset) => asset.id) : [])} /> 全选</label>
            <span>已选 {selectedProjectAssets.length} 项</span>
            <button className="outline-button small" onClick={() => void approveSelectedPrompts()} disabled={promptBusy === "bulk-approve"}>批量确认提示词</button>
          </div>
          {projectAssets.map((asset) => {
            const checked = selected.includes(asset.id);
            return <article className={`comic-asset-row ${checked ? "selected" : ""}`} key={asset.id}>
              <label><input type="checkbox" checked={checked} onChange={() => toggle(asset.id)} /><span>{asset.code || asset.id.slice(-6)}</span></label>
              <div><b>{asset.name}</b><small>{asset.class} · {asset.state || "未设置"} · prompt v{asset.prompt_version}</small><p>{asset.draft_prompt || asset.approved_prompt || asset.source_prompt || "暂无提示词"}</p></div>
              <span className={`status-chip ${asset.prompt_status === "approved" ? "succeeded" : "queued"}`}>{asset.prompt_status}</span>
              <div className="comic-row-actions">
                <button onClick={() => void optimizeAssetPrompt(asset, "optimize")} disabled={Boolean(promptBusy)}><Sparkles size={14} /> 优化</button>
                <button onClick={() => void optimizeAssetPrompt(asset, "merge")} disabled={Boolean(promptBusy)}><Plus size={14} /> 融合</button>
                <button onClick={() => void approveAssetPrompt(asset)} disabled={Boolean(promptBusy)}><Check size={14} /> 确认</button>
              </div>
            </article>;
          })}
        </section>
        <aside className="comic-generation-panel">
          <p className="eyebrow">PROMPT DIRECTION</p>
          <textarea value={optimizeDirection} onChange={(event) => setOptimizeDirection(event.target.value)} />
          <label>文本模型<select value={model} onChange={(event) => setModel(event.target.value)}>{models?.models.map((item) => <option key={item} value={item}>{imageModelLabel(item, models)}</option>)}</select></label>
          <hr />
          <p className="eyebrow">BATCH GENERATION</p>
          <label>图像模型<select value={generationModel} onChange={(event) => setGenerationModel(event.target.value)}>{imageModels?.models.map((item) => <option key={item} value={item}>{imageModelLabel(item, imageModels)}</option>)}</select></label>
          <label>尺寸<select value={generationSize} onChange={(event) => setGenerationSize(event.target.value)}><option value="auto">AUTO 自适应</option><option value="1:1">1:1</option><option value="16:9">16:9</option><option value="9:16">9:16</option></select></label>
          <button className="vermilion-button" onClick={() => void createGenerationBatch()} disabled={promptBusy === "batch-create"}>创建批量生成</button>
          {batchDetail && <div className="comic-batch-card">
            <div><span className={`status-chip ${batchDetail.batch.status}`}>{batchDetail.batch.status}</span><b>{batchDetail.batch.succeeded}/{batchDetail.batch.total}</b></div>
            <div className="job-progress"><i style={{ width: `${batchDetail.batch.total ? Math.round((batchDetail.batch.succeeded + batchDetail.batch.failed + batchDetail.batch.canceled) / batchDetail.batch.total * 100) : 0}%` }} /></div>
            <div className="comic-batch-controls">
              <button onClick={() => void controlBatch(batchDetail.batch.status === "paused" ? "resume" : "pause")}>{batchDetail.batch.status === "paused" ? "恢复" : "暂停"}</button>
              <button onClick={() => void controlBatch("stop")}>停止</button>
              <button onClick={() => void retryFailedBatch()}>重试失败</button>
            </div>
            <div className="comic-batch-items">{batchDetail.items.slice(0, 8).map((item) => <div key={item.id}><span>{item.asset_name}</span><b>{item.status}</b><small>{item.job_id ? item.job_id.slice(-8) : item.error?.message || "pending"}</small></div>)}</div>
          </div>}
        </aside>
      </div>
    </section>}
  </div>;
}
