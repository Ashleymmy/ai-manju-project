import { ArrowDownToLine, ArrowUpRight, Check, ChevronRight, FileText, FolderOpen, Image as ImageIcon, Pencil, Plus, RefreshCcw, Search, Sparkles, Trash2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type Asset,
} from "@/entities/asset";
import {
  type ComicAnalysisDetail,
  type ComicAsset,
  type ComicAssetClass,
  type ComicBatchDetail,
  type ComicAssetProject,
  type ComicProjectDetail,
} from "@/entities/comic";
import { modelLabel, type CapabilityModelCatalog } from "@/entities/model";
import { publicApiError } from "@/shared/api/errors";
import type { WorkspaceScope } from "@/shared/config";

import {
  activateComicAnalysisRevision,
  confirmComicAnalysis,
  reviseComicAnalysis,
} from "../controllers/analysis";
import {
  approveComicAssetPrompt,
  approveComicAssetPrompts,
  createComicProjectAsset,
  loadComicPromptTemplate,
  optimizeComicAssetPrompt,
  removeComicProjectAsset,
  saveComicAssetDraft,
} from "../controllers/assets";
import {
  changeComicBatchState,
  createComicGenerationBatch,
  loadLatestComicBatch,
  retryComicGenerationItem,
  retryFailedComicGenerationItems,
} from "../controllers/batch";
import {
  createEmptyComicProject,
  downloadComicSource,
  loadComicProject,
  removeComicProject,
  renameComicProject,
} from "../controllers/project";
import { analyzeComicSource } from "../controllers/source";
import {
  COMIC_CLASS_LABELS,
  COMIC_DEFAULT_INSTRUCTION,
  COMIC_OPTIMIZE_DIRECTION,
  COMIC_PROJECT_ANALYSIS_INSTRUCTION,
  COMIC_REFERENCE_LIMIT,
} from "../model/constants";
import {
  useComicBatchQuery,
  useComicFoldersQuery,
  useComicImageModelsQuery,
  useComicProjectsQuery,
  useComicReferenceAssetsQuery,
  useComicTextModelsQuery,
} from "../model/queries";
import {
  activeComicRevision,
  comicAssetDraft,
  comicBatchProgress,
  filterComicAssets,
  type ComicAssetDraft,
} from "../model/workflow";
import { ComicCreateDialog } from "./ComicCreateDialog";

function SurfaceTitle({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return <div className="feature-title"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{actions}</div>;
}

export function ComicAssetsView() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const appliedBatchUpdateRef = useRef(0);
  const [scope, setScope] = useState<WorkspaceScope>("personal");
  const [stage, setStage] = useState(1);
  const [projectDetail, setProjectDetail] = useState<ComicProjectDetail | null>(null);
  const [analysis, setAnalysis] = useState<ComicAnalysisDetail | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [title, setTitle] = useState("");
  const [stylePreset, setStylePreset] = useState("");
  const [globalArtStyle, setGlobalArtStyle] = useState("");
  const [instruction, setInstruction] = useState(COMIC_DEFAULT_INSTRUCTION);
  const [revisionInstruction, setRevisionInstruction] = useState("");
  const [model, setModel] = useState("");
  const [generationModel, setGenerationModel] = useState("");
  const [generationSize, setGenerationSize] = useState("auto");
  const [generationQuality, setGenerationQuality] = useState("auto");
  const [generationFormat, setGenerationFormat] = useState("png");
  const [generationVariants, setGenerationVariants] = useState(1);
  const [generationConcurrency, setGenerationConcurrency] = useState<1 | 2>(2);
  const [destinationMode, setDestinationMode] = useState<"auto" | "custom">("auto");
  const [destinationFolderId, setDestinationFolderId] = useState("");
  const [categorySubfolders, setCategorySubfolders] = useState(true);
  const [referenceAssets, setReferenceAssets] = useState<Asset[]>([]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [creationMode, setCreationMode] = useState<"script" | "import" | "empty">("script");
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [newProjectStylePreset, setNewProjectStylePreset] = useState("");
  const [newProjectAnalysisModel, setNewProjectAnalysisModel] = useState("gpt-5.6-scl");
  const [newProjectInstruction, setNewProjectInstruction] = useState(COMIC_DEFAULT_INSTRUCTION);
  const [newProjectScriptFile, setNewProjectScriptFile] = useState<File | null>(null);
  const [newProjectWorkbookFile, setNewProjectWorkbookFile] = useState<File | null>(null);
  const [isParsingScript, setIsParsingScript] = useState(false);
  const [parseProgress, setParseProgress] = useState({ current: 0, total: 0, status: "" });
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [referenceKeyword, setReferenceKeyword] = useState("");
  const [optimizeDirection, setOptimizeDirection] = useState(COMIC_OPTIMIZE_DIRECTION);
  const [batchDetail, setBatchDetail] = useState<ComicBatchDetail | null>(null);
  const [promptBusy, setPromptBusy] = useState("");
  const [busy, setBusy] = useState(false);
  const [assetFilterClass, setAssetFilterClass] = useState<ComicAssetClass | "">("");
  const [assetFilterKeyword, setAssetFilterKeyword] = useState("");
  const [editingAssetId, setEditingAssetId] = useState("");
  const [assetDraft, setAssetDraft] = useState<ComicAssetDraft | null>(null);

  const projectsQuery = useComicProjectsQuery(scope);
  const textModelsQuery = useComicTextModelsQuery();
  const imageModelsQuery = useComicImageModelsQuery();
  const foldersQuery = useComicFoldersQuery(scope);
  const referenceAssetsQuery = useComicReferenceAssetsQuery(
    scope,
    referenceKeyword,
    referencePickerOpen
  );
  const batchQuery = useComicBatchQuery(
    scope,
    batchDetail?.batch.id || "",
    batchDetail
  );
  const projects = projectsQuery.data || [];
  const models: CapabilityModelCatalog | null = textModelsQuery.data || null;
  const imageModels: CapabilityModelCatalog | null =
    imageModelsQuery.data || null;
  const folders = foldersQuery.data || [];
  const referenceCandidates = referenceAssetsQuery.data || [];

  const activeRevision = useMemo(() => activeComicRevision(analysis), [analysis]);
  const candidates = activeRevision?.candidate.assets || projectDetail?.assets || [];
  const projectAssets = projectDetail?.assets || [];
  const visibleProjectAssets = filterComicAssets(
    projectAssets,
    assetFilterClass,
    assetFilterKeyword
  );
  const selectedProjectAssets = projectAssets.filter((asset) => selected.includes(asset.id));

  const reloadProjects = useCallback(async () => {
    const result = await projectsQuery.refetch();
    if (result.error) {
      const error = result.error;
      toast.error(publicApiError(error, "读取漫剧项目失败"));
    }
  }, [projectsQuery.refetch]);

  useEffect(() => {
    if (projectsQuery.error)
      toast.error(publicApiError(projectsQuery.error, "读取漫剧项目失败"));
  }, [projectsQuery.error, projectsQuery.errorUpdatedAt]);

  useEffect(() => {
    if (textModelsQuery.error) {
      toast.error(publicApiError(textModelsQuery.error, "读取文本模型失败"));
      return;
    }
    if (textModelsQuery.data) setModel(textModelsQuery.data.defaultModel);
  }, [scope, textModelsQuery.data, textModelsQuery.error, textModelsQuery.errorUpdatedAt]);

  useEffect(() => {
    if (imageModelsQuery.error) {
      toast.error(publicApiError(imageModelsQuery.error, "读取图像模型失败"));
      return;
    }
    if (imageModelsQuery.data)
      setGenerationModel(imageModelsQuery.data.defaultModel);
  }, [imageModelsQuery.data, imageModelsQuery.error, imageModelsQuery.errorUpdatedAt, scope]);

  const toggle = (id: string) => {
    setSelected((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  };

  const analyze = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return toast.error("请先选择剧本或资产表文件");
    if (!title.trim()) return toast.error("请填写项目名称");
    const extension = file.name.toLowerCase().split(".").pop();
    if (extension !== "xlsx" && !model)
      return toast.error("请先配置并选择文本模型");
    if (extension !== "xlsx" && !instruction.trim())
      return toast.error("请填写首次分析方向");

    setBusy(true);
    try {
      const result = await analyzeComicSource({
        file,
        title,
        stylePreset,
        instruction,
        model,
        scope,
      });
      if (result.kind === "project") {
        setProjectDetail(result.detail);
        setAnalysis(null);
        setSelected(result.detail.assets.map(asset => asset.id));
        setStage(3);
        await reloadProjects();
        toast.success(`已从资产表导入 ${result.importedCount} 项资产`);
        return;
      }
      if (result.truncated)
        toast.info("剧本超长，已截断到 12 万字符参与分析");
      const revision = activeComicRevision(result.detail);
      setAnalysis(result.detail);
      setProjectDetail(null);
      setSelected(revision?.candidate.assets.map(item => item.name) || []);
      setStage(2);
      toast.success(`已识别 ${result.candidateCount} 项候选资产`);
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
      const detail = await reviseComicAnalysis(
        analysis,
        activeRevision,
        revisionInstruction,
        model,
        scope
      );
      setAnalysis(detail);
      setRevisionInstruction("");
      toast.success("已生成新的分析版本");
    } catch (error) {
      toast.error(publicApiError(error, "再次分析失败"));
    } finally {
      setBusy(false);
    }
  };

  const switchRevision = async (revisionId: string) => {
    if (!analysis || analysis.session.active_revision_id === revisionId) return;
    setBusy(true);
    try {
      const detail = await activateComicAnalysisRevision(
        analysis,
        revisionId,
        scope
      );
      setAnalysis(detail);
      toast.success("已切换活跃分析版本");
    } catch (error) {
      toast.error(publicApiError(error, "切换分析版本失败"));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!analysis || !activeRevision) return;
    setBusy(true);
    try {
      const detail = await confirmComicAnalysis(analysis, activeRevision, scope);
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
      const detail = await loadComicProject(projectId, scope);
      setProjectDetail(detail);
      setAnalysis(null);
      setSelected(detail.assets.map((item) => item.id));
      setEditingAssetId("");
      setStage(3);
      void loadLatestBatch(detail.project.id);
    } catch (error) {
      toast.error(publicApiError(error, "读取漫剧项目失败"));
    } finally {
      setBusy(false);
    }
  };

  const renameProject = async (project: ComicAssetProject) => {
    const nextTitle = window.prompt("项目名称", project.title)?.trim();
    if (!nextTitle || nextTitle === project.title) return;
    try {
      await renameComicProject(project.id, nextTitle, scope);
      await reloadProjects();
      if (projectDetail?.project.id === project.id) await refreshProjectDetail(project.id);
      toast.success("项目已重命名");
    } catch (error) {
      toast.error(publicApiError(error, "重命名项目失败"));
    }
  };

  const removeProject = async (project: ComicAssetProject) => {
    if (!window.confirm(`删除项目“${project.title}”及其全部资产？此操作不可恢复。`)) return;
    try {
      await removeComicProject(project.id, scope);
      if (projectDetail?.project.id === project.id) {
        setProjectDetail(null);
        setBatchDetail(null);
        setStage(1);
      }
      await reloadProjects();
      toast.success("项目已删除");
    } catch (error) {
      toast.error(publicApiError(error, "删除项目失败"));
    }
  };

  const downloadSource = async (project: ComicAssetProject) => {
    try {
      const { blob, fileName: sourceName } = await downloadComicSource(
        project,
        scope
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = sourceName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (error) {
      toast.error(publicApiError(error, "下载剧本源文件失败"));
    }
  };

  const loadLatestBatch = useCallback(async (projectId: string) => {
    try {
      setBatchDetail(await loadLatestComicBatch(projectId, scope));
    } catch (error) {
      toast.error(publicApiError(error, "读取生成批次失败"));
    }
  }, [scope]);

  const refreshProjectDetail = useCallback(async (projectId = projectDetail?.project.id || "") => {
    if (!projectId) return;
    const detail = await loadComicProject(projectId, scope);
    setProjectDetail(detail);
    setSelected((items) => items.length ? items.filter((id) => detail.assets.some((asset) => asset.id === id)) : detail.assets.map((asset) => asset.id));
  }, [projectDetail?.project.id, scope]);

  useEffect(() => {
    if (projectDetail?.project.id) void loadLatestBatch(projectDetail.project.id);
  }, [loadLatestBatch, projectDetail?.project.id]);

  useEffect(() => {
    if (
      !batchQuery.data ||
      !batchQuery.dataUpdatedAt ||
      batchQuery.dataUpdatedAt <= appliedBatchUpdateRef.current
    )
      return;
    appliedBatchUpdateRef.current = batchQuery.dataUpdatedAt;
    if (batchQuery.data === batchDetail) return;
    setBatchDetail(batchQuery.data);
    if (projectDetail?.project.id)
      void refreshProjectDetail(projectDetail.project.id).catch(
        () => undefined
      );
  }, [
    batchQuery.data,
    batchQuery.dataUpdatedAt,
    projectDetail?.project.id,
    refreshProjectDetail,
  ]);

  const mergeAsset = (asset: ComicAsset) => {
    setProjectDetail((detail) => detail ? { ...detail, assets: detail.assets.map((item) => item.id === asset.id ? asset : item) } : detail);
  };

  const beginEditAsset = (asset: ComicAsset) => {
    setEditingAssetId(asset.id);
    setAssetDraft(comicAssetDraft(asset));
  };

  const saveAssetDraft = async (asset: ComicAsset, approve: boolean) => {
    if (!projectDetail || !assetDraft) return;
    setPromptBusy(asset.id + "edit");
    try {
      mergeAsset(
        await saveComicAssetDraft(
          projectDetail.project.id,
          asset,
          assetDraft,
          approve,
          scope
        )
      );
      setEditingAssetId("");
      setAssetDraft(null);
      toast.success(approve ? "资产已保存并确认提示词" : "资产草稿已保存");
    } catch (error) {
      toast.error(publicApiError(error, "保存资产失败"));
    } finally {
      setPromptBusy("");
    }
  };

  const previewTemplate = async (asset: ComicAsset) => {
    if (!projectDetail) return;
    setPromptBusy(asset.id + "preview");
    try {
      const preview = await loadComicPromptTemplate(
        projectDetail.project.id,
        asset.id,
        scope
      );
      if (editingAssetId === asset.id) {
        setAssetDraft((draft) => draft ? { ...draft, prompt: preview.template || draft.prompt } : draft);
        toast.success("模板提示词已填入编辑框");
      } else {
        beginEditAsset(asset);
        setAssetDraft((draft) => draft ? { ...draft, prompt: preview.template || draft.prompt } : draft);
        toast.success("模板提示词已生成，可在编辑框中调整");
      }
      preview.warnings?.forEach((warning) => toast.warning(warning));
      preview.blockers?.forEach((blocker) => toast.error(blocker));
    } catch (error) {
      toast.error(publicApiError(error, "生成模板提示词失败"));
    } finally {
      setPromptBusy("");
    }
  };

  const createNewAsset = async () => {
    if (!projectDetail) return;
    const name = window.prompt("新资产名称")?.trim();
    if (!name) return;
    try {
      const created = await createComicProjectAsset(
        projectDetail.project.id,
        name,
        assetFilterClass || "character",
        scope
      );
      setProjectDetail((detail) => detail ? { ...detail, assets: [...detail.assets, created] } : detail);
      beginEditAsset(created);
      toast.success("资产已创建，请补全设定与提示词");
    } catch (error) {
      toast.error(publicApiError(error, "创建资产失败"));
    }
  };

  const removeAsset = async (asset: ComicAsset) => {
    if (!projectDetail || !window.confirm(`删除资产“${asset.name}”？`)) return;
    try {
      await removeComicProjectAsset(
        projectDetail.project.id,
        asset.id,
        scope
      );
      setProjectDetail((detail) => detail ? { ...detail, assets: detail.assets.filter((item) => item.id !== asset.id) } : detail);
      setSelected((items) => items.filter((id) => id !== asset.id));
      toast.success("资产已删除");
    } catch (error) {
      toast.error(publicApiError(error, "删除资产失败"));
    }
  };

  const optimizeAssetPrompt = async (asset: ComicAsset, operation: "optimize" | "merge") => {
    if (!projectDetail) return;
    if (!optimizeDirection.trim()) return toast.error("请先填写优化方向");
    setPromptBusy(asset.id + operation);
    try {
      const result = await optimizeComicAssetPrompt(
        projectDetail.project.id,
        asset,
        optimizeDirection,
        model,
        operation,
        scope
      );
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
      mergeAsset(
        await approveComicAssetPrompt(
          projectDetail.project.id,
          asset,
          scope
        )
      );
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
      const result = await approveComicAssetPrompts(
        projectDetail.project.id,
        selectedProjectAssets,
        scope
      );
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
    if (destinationMode === "custom" && !destinationFolderId) return toast.error("请选择落库目录，或切回自动归档");
    setPromptBusy("batch-create");
    try {
      const detail = await createComicGenerationBatch(
        projectDetail.project.id,
        {
          assetIds: approved.map(asset => asset.id),
          modelSelector: generationModel,
          size: generationSize,
          quality: generationQuality,
          outputFormat: generationFormat,
          variantsPerAsset: generationVariants,
          referenceAssetIds: referenceAssets.map(asset => asset.id),
          concurrency: generationConcurrency,
          destinationMode,
          destinationFolderId,
          createCategorySubfolders: categorySubfolders,
        },
        scope
      );
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
      setBatchDetail(
        await changeComicBatchState(batchDetail.batch.id, action, scope)
      );
    } catch (error) {
      toast.error(publicApiError(error, "控制批次失败"));
    } finally {
      setPromptBusy("");
    }
  };

  const retryBatchItem = async (itemId: string) => {
    if (!batchDetail) return;
    setPromptBusy("batch-retry-item");
    try {
      setBatchDetail(
        await retryComicGenerationItem(
          batchDetail.batch.id,
          itemId,
          scope
        )
      );
      toast.success("已重新排队该资产");
    } catch (error) {
      toast.error(publicApiError(error, "重试该资产失败"));
    } finally {
      setPromptBusy("");
    }
  };

  const retryFailedBatch = async () => {
    if (!batchDetail) return;
    setPromptBusy("batch-retry");
    try {
      setBatchDetail(
        await retryFailedComicGenerationItems(batchDetail.batch.id, scope)
      );
    } catch (error) {
      toast.error(publicApiError(error, "重试失败项失败"));
    } finally {
      setPromptBusy("");
    }
  };

  const toggleReferenceAsset = (asset: Asset) => {
    setReferenceAssets((items) => items.some((item) => item.id === asset.id)
      ? items.filter((item) => item.id !== asset.id)
      : items.length >= COMIC_REFERENCE_LIMIT
        ? (toast.error(`参考资产最多 ${COMIC_REFERENCE_LIMIT} 个`), items)
        : [...items, asset]);
  };

  const handleCreateProject = () => {
    setCreateDialogOpen(true);
    setNewProjectTitle("");
    setNewProjectStylePreset("");
    setNewProjectAnalysisModel("gpt-5.6-scl");
    setNewProjectInstruction(COMIC_PROJECT_ANALYSIS_INSTRUCTION);
  };

  const confirmCreateProject = async () => {
    if (!newProjectTitle.trim()) {
      toast.error("请输入项目名称");
      return;
    }

    // 如果是"从剧本创建"或"导入资产表"模式，并且有文件上传，则显示解析进度
    if ((creationMode === "script" && newProjectScriptFile) || (creationMode === "import" && newProjectWorkbookFile)) {
      setIsParsingScript(true);
      setParseProgress({ current: 0, total: 5, status: "正在读取文件..." });

      // 模拟解析进度
      const steps = [
        { current: 1, status: "正在读取文件..." },
        { current: 2, status: "正在提取文本内容..." },
        { current: 3, status: "正在分析资产信息..." },
        { current: 4, status: "正在生成资产列表..." },
        { current: 5, status: "解析完成" }
      ];

      for (let i = 0; i < steps.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        setParseProgress({ current: steps[i].current, total: 5, status: steps[i].status });
      }

      await new Promise(resolve => setTimeout(resolve, 500));
      setIsParsingScript(false);
      toast.success("文件解析完成");
    }

    try {
      await createEmptyComicProject(
        {
          title: newProjectTitle,
          stylePreset: newProjectStylePreset,
        },
        scope
      );
      toast.success("项目创建成功");
      setCreateDialogOpen(false);
      void reloadProjects();
    } catch (error) {
      setIsParsingScript(false);
      toast.error(publicApiError(error, "创建项目失败"));
    }
  };

  const stageAction = stage === 1
    ? <button className="vermilion-button" disabled={busy} onClick={() => void analyze()}>{busy ? "分析中…" : "开始分析"} <ChevronRight size={16} /></button>
    : stage === 2
      ? <button className="vermilion-button" disabled={busy || !analysis} onClick={() => void confirm()}>确认当前版本 <Check size={16} /></button>
      : <button className="vermilion-button" onClick={() => setStage(1)}><Plus size={16} /> 新建分析</button>;

  return <div className="feature-page comic-page">
    <input ref={fileInputRef} hidden type="file" accept=".txt,.md,.docx,.xlsx,text/plain,text/markdown" onChange={(event) => setFileName(event.target.files?.[0]?.name || "")} />

    <div className="comic-hero-header">
      <div className="comic-hero-content">
        <p className="eyebrow">COMIC ASSET PIPELINE</p>
        <h1>漫剧资产助手</h1>
        <p className="comic-hero-description">可从剧本、四 Sheet 资产表或空项目开始；候选资产确认入库后，再处理提示词并创建服务端后台批次。关闭页面不会中断已创建的任务。</p>
        <div className="comic-hero-actions">
          <button className={`comic-tab-button ${scope === "personal" ? "active" : ""}`} onClick={() => setScope("personal")}>个人空间</button>
          <button className={`comic-tab-button ${scope === "team" ? "active" : ""}`} onClick={() => setScope("team")}>团队空间</button>
          <button className="create-button" onClick={handleCreateProject}><Plus size={16} /> 新建资产项目</button>
        </div>
      </div>
      <div className="comic-lets-create-badge">LET'S<br/>CREATE!</div>
    </div>

    <div className="comic-info-banner">
      <div className="comic-info-icon">i</div>
      <div className="comic-info-content">
        <h3>提示词确认与生图队列相互隔离</h3>
        <p>模板和 AI 只写候选草稿；只有「采用并确认」才更新批准提示词。批次创建时会冻结提示词、模型、尺寸和质量，之后编辑不会影响已排队任务。</p>
      </div>
    </div>

    <div className="comic-workspace-layout">
      <aside className="comic-projects-panel">
        <div className="comic-panel-header">
          <h3>{scope === "personal" ? "个人空间项目" : "团队空间项目"}</h3>
          <button className="comic-refresh-button" onClick={() => void reloadProjects()}><RefreshCcw size={14} /></button>
        </div>
        <div className="comic-panel-count">共 {projects.length} 个</div>
        <div className="comic-projects-list">
          {projects.length > 0 ? (
            projects.map((project) => (
              <button key={project.id} className="comic-project-item" onClick={() => void openProject(project.id)}>
                <FolderOpen size={14} />
                <span>{project.title}</span>
              </button>
            ))
          ) : (
            <div className="comic-empty-state">
              <FolderOpen size={48} />
              <p>还没有漫剧资产项目</p>
            </div>
          )}
        </div>
      </aside>

      <main className="comic-main-area">
        {!projectDetail ? (
          <div className="comic-empty-workspace">
            <div className="comic-empty-icon">
              <FolderOpen size={64} />
            </div>
            <h2>先创建一个资产项目</h2>
            <p>上传剧本可由文本模型拆解资产，或直接导入已有XLSX资产表；全部候选都会先预览确认。</p>
            <button className="create-button" onClick={handleCreateProject}><Plus size={16} /> 新建项目</button>
          </div>
        ) : (
          <>
            <div className="workflow-steps">{[[1, "上传剧本"], [2, "审阅候选"], [3, "项目资产"]].map(([number, label]) => <button key={number} className={stage === number ? "active" : stage > Number(number) ? "done" : ""} onClick={() => Number(number) <= stage && setStage(Number(number))}><i>{stage > Number(number) ? <Check size={12} /> : `0${number}`}</i><span>{label}</span></button>)}</div>

    {stage === 1 && <section className="script-intake">
      <div className="script-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (event.dataTransfer.files[0]) { const transfer = new DataTransfer(); transfer.items.add(event.dataTransfer.files[0]); if (fileInputRef.current) fileInputRef.current.files = transfer.files; setFileName(event.dataTransfer.files[0].name); } }}><Upload size={26} /><h2>将剧本放进分镜室</h2><p>支持 TXT / MD / DOCX 剧本走 AI 分析，或直接导入 XLSX 资产表。首轮分析会带上你填写的方向，不再让模型完全自由发挥。</p><button className="outline-button" onClick={() => fileInputRef.current?.click()}><Upload size={16} /> {fileName || "选择 / 拖入剧本文件"}</button></div>
      <aside className="script-settings-panel">
        <div className="settings-scroll-area">
          <p className="eyebrow">ANALYSIS SETTINGS</p>
          <label>项目名称<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：雨幕收容所" /></label>
          <label>风格基调<input value={stylePreset} onChange={(event) => setStylePreset(event.target.value)} placeholder="例如：现实感悬疑" /></label>
          <label>文本模型<select value={model} onChange={(event) => setModel(event.target.value)}><option value="">选择文本模型</option>{models?.models.map((item) => <option key={item} value={item}>{modelLabel(item, models)}</option>)}</select></label>
          <label>全局美术风格<input list="art-style-options" value={globalArtStyle} onChange={(event) => setGlobalArtStyle(event.target.value)} placeholder="选择或输入美术风格" /><datalist id="art-style-options"><option value="3D动漫PBR" /><option value="国风动画" /><option value="二维赛璐璐" /><option value="微写实动画" /><option value="东方赛博水墨" /></datalist></label>
          <label>首次分析方向<textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="请选择性参照某板，不需遵循有规范特性或逻辑性性求的颜色、场景和道具。" /></label>
          <hr />
          <div className="comic-project-list">{projects.map((project) => <div className="comic-project-row" key={project.id}><button className="comic-project-open" onClick={() => void openProject(project.id)}><FolderOpen size={14} /><span>{project.title}</span></button><div className="comic-project-actions"><button title="重命名" onClick={() => void renameProject(project)}><Pencil size={13} /></button><button title="下载剧本源文件" onClick={() => void downloadSource(project)}><ArrowDownToLine size={13} /></button><button title="删除项目" onClick={() => void removeProject(project)}><Trash2 size={13} /></button></div></div>)}{!projects.length && <small>当前空间还没有漫剧项目</small>}</div>
          <div className="template-upload-section">
            <div className="template-upload-item">
              <p className="template-label">人物分类模板（可选）</p>
              <div className="template-upload-box">
                <p className="template-hint">支持《美术风格》、《资产名称》、《资产类别》、《资产设定》、《状态》</p>
                <textarea className="template-input" placeholder="输入分类字段或粘贴模板内容..." rows={3}></textarea>
                <button className="template-upload-button"><Upload size={14} /> 载入人物模板 TXT 选择文件 未选择任何文件</button>
              </div>
            </div>
            <div className="template-upload-item">
              <p className="template-label">场景分类模板（可选）</p>
              <div className="template-upload-box">
                <p className="template-hint">支持《美术风格》、《资产名称》、《资产类别》、《资产设定》、《状态》</p>
                <textarea className="template-input" placeholder="输入分类字段或粘贴模板内容..." rows={3}></textarea>
                <button className="template-upload-button"><Upload size={14} /> 载入场景模板 TXT 选择文件 未选择任何文件</button>
              </div>
            </div>
            <div className="template-upload-item">
              <p className="template-label">道具分类模板（可选）</p>
              <div className="template-upload-box">
                <p className="template-hint">支持《美术风格》、《资产名称》、《资产类别》、《资产设定》、《状态》</p>
                <textarea className="template-input" placeholder="输入分类字段或粘贴模板内容..." rows={3}></textarea>
                <button className="template-upload-button"><Upload size={14} /> 载入道具模板 TXT 选择文件 未选择任何文件</button>
              </div>
            </div>
            <div className="template-upload-item">
              <p className="template-label">UI分类模板（可选）</p>
              <div className="template-upload-box">
                <p className="template-hint">支持《美术风格》、《资产名称》、《资产类别》、《资产设定》、《状态》</p>
                <textarea className="template-input" placeholder="输入分类字段或粘贴模板内容..." rows={3}></textarea>
                <button className="template-upload-button"><Upload size={14} /> 载入UI模板 TXT 选择文件 未选择任何文件</button>
              </div>
            </div>
          </div>
          <div className="script-intake-actions">
            <button className="outline-button">取消</button>
            <button className="vermilion-button">解析并预览</button>
          </div>
        </div>
      </aside>
    </section>}

    {stage === 2 && <section className="candidate-review">
      <aside className="candidate-sidebar"><p className="eyebrow">SESSION / {analysis?.session.id.slice(-6)}</p><h2>{analysis?.session.title}<br />候选资产</h2><div className="analysis-meter"><i style={{ width: "100%" }} /><span>v{activeRevision?.version || 1} · {activeRevision?.response_model || "manual"}</span></div>{(["character", "environment", "prop", "ui"] as const).map((item) => <button key={item}><span>{COMIC_CLASS_LABELS[item]}</span><b>{String(candidates.filter((asset) => asset.class === item).length).padStart(2, "0")}</b></button>)}<textarea value={revisionInstruction} onChange={(event) => setRevisionInstruction(event.target.value)} placeholder="告诉 AI 哪些资产被遗漏，或需要如何加强" /><button className="full-outline" disabled={busy || !revisionInstruction.trim()} onClick={() => void revise()}>根据意见再分析一版</button></aside>
      <div className="candidate-grid">{candidates.map((candidate) => <article key={`${candidate.code}-${candidate.name}`} className={selected.includes(candidate.name) ? "candidate selected" : "candidate"}><div><div className="empty-output"><ImageIcon size={24} /></div><span>{candidate.archive_status || "待审"}</span><button onClick={() => toggle(candidate.name)}>{selected.includes(candidate.name) ? <Check size={15} /> : <Plus size={15} />}</button></div><h3>{candidate.name}</h3><p>{COMIC_CLASS_LABELS[candidate.class] || candidate.class} · {candidate.state}</p><div className="candidate-tags"><span>{candidate.code || "AUTO"}</span></div><button className="prompt-link" onClick={() => toast.message(candidate.source_prompt || candidate.visual_description || "暂无提示词")}>查看提示词 <ArrowUpRight size={14} /></button></article>)}</div>
      <aside className="approval-panel"><p className="eyebrow">VERSION REVIEW</p><h3>当前 v{activeRevision?.version || 1}</h3><p>只有点击“确认当前版本”后才会创建正式项目；这里的勾选仅用于辅助审阅。</p>
        <div className="revision-history"><p className="field-label">全部版本</p>{(analysis?.revisions || []).map((revision) => <button key={revision.id} className={revision.id === analysis?.session.active_revision_id ? "selected" : ""} disabled={busy} onClick={() => void switchRevision(revision.id)}><b>v{revision.version}</b><span>{revision.source === "initial" ? "首轮" : revision.source === "ai" ? "AI 修订" : "手动"} · {revision.candidate.assets.length} 项</span>{revision.id === analysis?.session.active_revision_id && <Check size={13} />}</button>)}</div>
      </aside>
    </section>}

    {stage === 3 && <section className="batch-console comic-batch-console">
      <div className="batch-header"><div><p className="eyebrow">PROJECT / {projectDetail?.project.id.slice(-8)}</p><h2>{projectDetail?.project.title || "已确认项目"}</h2></div><div className="comic-header-actions"><span className="status-chip succeeded">{projectAssets.length} 项资产</span>{projectDetail && <><button className="outline-button small" onClick={() => void renameProject(projectDetail.project)}><Pencil size={13} /> 重命名</button><button className="outline-button small" onClick={() => void downloadSource(projectDetail.project)}><ArrowDownToLine size={13} /> 源文件</button><button className="outline-button small" onClick={() => void removeProject(projectDetail.project)}><Trash2 size={13} /> 删除项目</button></>}</div></div>
      <div className="comic-console-layout">
        <section className="comic-asset-review-list">
          <div className="comic-toolbar">
            <label><input type="checkbox" checked={projectAssets.length > 0 && selectedProjectAssets.length === projectAssets.length} onChange={(event) => setSelected(event.target.checked ? projectAssets.map((asset) => asset.id) : [])} /> 全选</label>
            <span>已选 {selectedProjectAssets.length} 项</span>
            <select value={assetFilterClass} onChange={(event) => setAssetFilterClass(event.target.value as ComicAssetClass | "")}><option value="">全部类别</option>{(Object.keys(COMIC_CLASS_LABELS) as ComicAssetClass[]).map((item) => <option key={item} value={item}>{COMIC_CLASS_LABELS[item]}</option>)}</select>
            <div className="tag-search"><Search size={13} /><input value={assetFilterKeyword} onChange={(event) => setAssetFilterKeyword(event.target.value)} placeholder="搜索资产" /></div>
            <button className="outline-button small" onClick={() => void createNewAsset()}><Plus size={13} /> 新建资产</button>
            <button className="outline-button small" onClick={() => void approveSelectedPrompts()} disabled={promptBusy === "bulk-approve"}>批量确认提示词</button>
          </div>
          {visibleProjectAssets.map((asset) => {
            const checked = selected.includes(asset.id);
            const editing = editingAssetId === asset.id && assetDraft;
            return <article className={`comic-asset-row ${checked ? "selected" : ""}`} key={asset.id}>
              <label><input type="checkbox" checked={checked} onChange={() => toggle(asset.id)} /><span>{asset.code || asset.id.slice(-6)}</span></label>
              <div><b>{asset.name}</b><small>{COMIC_CLASS_LABELS[asset.class] || asset.class} · {asset.state || "未设置"} · prompt v{asset.prompt_version}</small>{!editing && <p>{asset.draft_prompt || asset.approved_prompt || asset.source_prompt || "暂无提示词"}</p>}</div>
              <span className={`status-chip ${asset.prompt_status === "approved" ? "succeeded" : "queued"}`}>{asset.prompt_status}</span>
              <div className="comic-row-actions">
                <button onClick={() => editing ? (setEditingAssetId(""), setAssetDraft(null)) : beginEditAsset(asset)} disabled={Boolean(promptBusy)}>{editing ? <X size={14} /> : <Pencil size={14} />} {editing ? "取消" : "编辑"}</button>
                <button onClick={() => void previewTemplate(asset)} disabled={Boolean(promptBusy)}><FileText size={14} /> 模板</button>
                <button onClick={() => void optimizeAssetPrompt(asset, "optimize")} disabled={Boolean(promptBusy)}><Sparkles size={14} /> 优化</button>
                <button onClick={() => void optimizeAssetPrompt(asset, "merge")} disabled={Boolean(promptBusy)}><Plus size={14} /> 融合</button>
                <button onClick={() => void approveAssetPrompt(asset)} disabled={Boolean(promptBusy)}><Check size={14} /> 确认</button>
                <button onClick={() => void removeAsset(asset)} disabled={Boolean(promptBusy)}><Trash2 size={14} /> 删除</button>
              </div>
              {editing && <div className="comic-asset-editor">
                <div className="comic-asset-editor-grid">
                  <label>名称<input value={assetDraft.name} onChange={(event) => setAssetDraft((draft) => draft ? { ...draft, name: event.target.value } : draft)} /></label>
                  <label>状态 / 版本<input value={assetDraft.state} onChange={(event) => setAssetDraft((draft) => draft ? { ...draft, state: event.target.value } : draft)} /></label>
                  <label>类别<select value={assetDraft.class} onChange={(event) => setAssetDraft((draft) => draft ? { ...draft, class: event.target.value as ComicAssetClass } : draft)}>{(Object.keys(COMIC_CLASS_LABELS) as ComicAssetClass[]).map((item) => <option key={item} value={item}>{COMIC_CLASS_LABELS[item]}</option>)}</select></label>
                </div>
                <label>视觉设定<textarea value={assetDraft.visual_description} onChange={(event) => setAssetDraft((draft) => draft ? { ...draft, visual_description: event.target.value } : draft)} /></label>
                <label>提示词（手动编辑）<textarea className="comic-prompt-editor" value={assetDraft.prompt} onChange={(event) => setAssetDraft((draft) => draft ? { ...draft, prompt: event.target.value } : draft)} /></label>
                <div className="comic-editor-actions"><button className="outline-button small" disabled={promptBusy === asset.id + "edit"} onClick={() => void saveAssetDraft(asset, false)}>保存草稿</button><button className="vermilion-button" disabled={promptBusy === asset.id + "edit"} onClick={() => void saveAssetDraft(asset, true)}><Check size={14} /> 保存并确认</button></div>
              </div>}
            </article>;
          })}
          {!visibleProjectAssets.length && <div className="empty-output"><p>当前筛选没有资产。</p></div>}
        </section>
        <aside className="comic-generation-panel">
          <p className="eyebrow">PROMPT DIRECTION</p>
          <textarea value={optimizeDirection} onChange={(event) => setOptimizeDirection(event.target.value)} />
          <label>文本模型<select value={model} onChange={(event) => setModel(event.target.value)}>{models?.models.map((item) => <option key={item} value={item}>{modelLabel(item, models)}</option>)}</select></label>
          <hr />
          <p className="eyebrow">BATCH GENERATION</p>
          <label>图像模型<select value={generationModel} onChange={(event) => setGenerationModel(event.target.value)}>{imageModels?.models.map((item) => <option key={item} value={item}>{modelLabel(item, imageModels)}</option>)}</select></label>
          <div className="comic-batch-grid">
            <label>尺寸<select value={generationSize} onChange={(event) => setGenerationSize(event.target.value)}><option value="auto">AUTO</option><option value="1:1">1:1</option><option value="16:9">16:9</option><option value="9:16">9:16</option></select></label>
            <label>质量<select value={generationQuality} onChange={(event) => setGenerationQuality(event.target.value)}><option value="auto">AUTO</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
            <label>格式<select value={generationFormat} onChange={(event) => setGenerationFormat(event.target.value)}><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option></select></label>
            <label>每资产张数<select value={generationVariants} onChange={(event) => setGenerationVariants(Number(event.target.value))}>{[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label>并发<select value={generationConcurrency} onChange={(event) => setGenerationConcurrency(Number(event.target.value) === 1 ? 1 : 2)}><option value={1}>1</option><option value={2}>2</option></select></label>
          </div>
          <label>落库目录<select value={destinationMode === "auto" ? "" : destinationFolderId} onChange={(event) => { const value = event.target.value; setDestinationMode(value ? "custom" : "auto"); setDestinationFolderId(value); }}><option value="">自动归档目录</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
          <label className="comic-check-line"><input type="checkbox" checked={categorySubfolders} onChange={(event) => setCategorySubfolders(event.target.checked)} /> 按类别创建子文件夹</label>
          <div className="comic-reference-block">
            <div className="reference-manager-head"><span>参考资产 {referenceAssets.length}/6</span><div><button onClick={() => setReferencePickerOpen((value) => !value)}><ImageIcon size={13} /> {referencePickerOpen ? "收起" : "选择"}</button>{referenceAssets.length > 0 && <button onClick={() => setReferenceAssets([])}>清空</button>}</div></div>
            {referenceAssets.length > 0 && <div className="comic-reference-chips">{referenceAssets.map((asset) => <span key={asset.id}>{asset.name}<button onClick={() => toggleReferenceAsset(asset)}><X size={11} /></button></span>)}</div>}
            {referencePickerOpen && <div className="reference-asset-picker"><div className="tag-search"><Search size={13} /><input value={referenceKeyword} onChange={(event) => setReferenceKeyword(event.target.value)} placeholder="搜索资产库图片" /></div><div className="comic-reference-candidates">{referenceCandidates.map((asset) => <button key={asset.id} className={referenceAssets.some((item) => item.id === asset.id) ? "selected" : ""} onClick={() => toggleReferenceAsset(asset)}>{asset.name}</button>)}{!referenceCandidates.length && <small>没有匹配的图片资产</small>}</div></div>}
          </div>
          <button className="vermilion-button" onClick={() => void createGenerationBatch()} disabled={promptBusy === "batch-create"}>创建批量生成</button>
          {batchDetail && <div className="comic-batch-card">
            <div><span className={`status-chip ${batchDetail.batch.status}`}>{batchDetail.batch.status}</span><b>{batchDetail.batch.succeeded}/{batchDetail.batch.total}</b></div>
            <div className="job-progress"><i style={{ width: `${comicBatchProgress(batchDetail.batch)}%` }} /></div>
            <div className="comic-batch-controls">
              <button onClick={() => void controlBatch(batchDetail.batch.status === "paused" ? "resume" : "pause")}>{batchDetail.batch.status === "paused" ? "恢复" : "暂停"}</button>
              <button onClick={() => void controlBatch("stop")}>停止</button>
              <button onClick={() => void retryFailedBatch()}>重试失败</button>
            </div>
            <div className="comic-batch-items">{batchDetail.items.map((item) => <div key={item.id}><span>{item.asset_name}</span><b>{item.status}</b><small>{item.job_id ? item.job_id.slice(-8) : item.error?.message || "pending"}</small>{item.status === "failed" && <button className="comic-item-retry" disabled={promptBusy === "batch-retry-item"} onClick={() => void retryBatchItem(item.id)}>重试</button>}</div>)}</div>
          </div>}
        </aside>
      </div>
    </section>}
          </>
        )}
      </main>
    </div>

    <ComicCreateDialog
      open={createDialogOpen}
      creationMode={creationMode}
      setCreationMode={setCreationMode}
      projectTitle={newProjectTitle}
      setProjectTitle={setNewProjectTitle}
      stylePreset={newProjectStylePreset}
      setStylePreset={setNewProjectStylePreset}
      analysisModel={newProjectAnalysisModel}
      setAnalysisModel={setNewProjectAnalysisModel}
      instruction={newProjectInstruction}
      setInstruction={setNewProjectInstruction}
      scriptFile={newProjectScriptFile}
      setScriptFile={setNewProjectScriptFile}
      workbookFile={newProjectWorkbookFile}
      setWorkbookFile={setNewProjectWorkbookFile}
      isParsingScript={isParsingScript}
      onClose={() => setCreateDialogOpen(false)}
      onConfirm={() => void confirmCreateProject()}
    />
  </div>;
}
