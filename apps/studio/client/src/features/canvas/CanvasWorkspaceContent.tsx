import {
  Archive,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eraser,
  Image as ImageIcon,
  Palette,
  Home,
  Loader2,
  MoreHorizontal,
  PanelRight,
  Plus,
  Redo2,
  Save,
  Search,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ApiError, publicApiError } from "@/shared/api/errors";
import type { WorkspaceScope } from "@/shared/config";
import {
  createProject,
  deleteProject,
  getProject,
  getProjects,
  getProjectSnapshot,
  saveProjectSnapshot,
  updateProject,
  type CanvasProject,
} from "@/entities/project";
import {
  createAssetExport,
  downloadAssetExport,
  getAsset,
  getAssetContentObjectUrl,
  getAssetExport,
  getAssetLibrary,
  updateAssetUserState,
  uploadAsset,
  type Asset,
  type AssetCategory,
  type AssetSourceType,
  type SeedanceAsset,
} from "@/entities/asset";
import { cancelJob, getJobs } from "@/entities/job";
import type { PromptPreset } from "@/entities/prompt";
import { fetchAiModels } from "@/services/api/ai";
import { audioFormatOptions, audioVoiceOptions } from "@/services/api/audio";
import type { SeedanceMaterialAsset } from "@/services/api/material";
import {
  fetchImageModels,
  imageModelLabel,
  type ImageModelCatalog,
} from "@/features/image";
import { useProjectCoverUrls } from "@/features/projects";
import { ProjectCoverPickerDialog } from "@/components/ProjectCoverPickerDialog";
import { getPreferences } from "@/features/settings";
import {
  isLongSeedanceVideoModel,
  isSeedanceVideoModel,
  videoModelSettings,
} from "@/features/video";
import type { CanvasImageAnnotationPayload } from "@/components/canvas/CanvasImageAnnotationDialog";
import type { CanvasImageMaskPayload } from "@/components/canvas/CanvasImageMaskDialog";
import type { SelectedSeedanceVolcanoAsset } from "@/components/canvas/CanvasSeedanceAssetDialog";
import {
  type CanvasImageToolMode,
  type CanvasNodeCardActions,
} from "@/features/canvas/ui/CanvasNodeCard";
import { CanvasInspector } from "@/features/canvas/ui/CanvasInspector";
import {
  defaultCanvasImageToolDraft,
  type CanvasImageToolDraft,
} from "@/features/canvas/domain/imageTool";
import { CanvasWorkspaceDialogHost } from "@/features/canvas/ui/CanvasWorkspaceDialogHost";
import { CanvasStage } from "@/features/canvas/ui/CanvasStage";
import { CanvasDialogHost } from "@/features/canvas/ui/CanvasDialogHost";
import {
  useCanvasCommands,
  useLatestCanvasCommandProxy,
  useCanvasStore,
  useCanvasStoreApi,
} from "@/features/canvas/ui/CanvasProvider";
import { commitCanvasAgentState } from "@/features/canvas/model/agentState";
import {
  CanvasAutosaveController,
  type CanvasSnapshotCapture,
} from "@/features/canvas/controllers/autosave";
import { CanvasHistoryController } from "@/features/canvas/controllers/history";
import {
  CanvasProjectSessionController,
  type CanvasProjectSessionLoaded,
} from "@/features/canvas/controllers/project-session";
import {
  CANVAS_STAGE_OFFSET,
  CanvasStageInteractionController,
  useCanvasStageInteraction,
  type CanvasContextMenuState,
  type PendingConnectionCreateState,
} from "@/features/canvas/controllers/stage-interaction";
import { CanvasGenerationJobsController } from "@/features/canvas/controllers/generation-jobs";
import { useCanvasAssetsMentions } from "@/features/canvas/controllers/assets-mentions";
import {
  extractProjectCanvasData,
  extractServerCanvasSnapshotData,
  type CanvasSnapshotBase,
} from "@/features/canvas/domain/snapshotRoundTrip";
import { consumeCanvasBootstrap, peekCanvasBootstrap } from "@/lib/canvas-bootstrap";
import {
  deleteCanvasNodesAndEdges,
  normalizeCanvasSelectionRect,
} from "@/features/canvas/domain/selection";
import { DEFAULT_CANVAS_SHORTCUTS, resolveCanvasShortcuts, type CanvasShortcutBindings } from "@/features/canvas/domain/hotkeys";
import { loadSkills, type CanvasSkill } from "@/lib/skill-library";
import type { StoryboardScene } from "@/components/StoryboardEditorDialog";
import {
  createCanvasClipboard,
  pasteCanvasClipboard,
  type CanvasClipboardPayload,
} from "@/features/canvas/domain/clipboard";
import {
  addCanvasConnection,
  canvasActiveConnectionPath,
  buildCanvasGenerationInputs,
  buildCanvasConnectionLayerBounds,
  connectableCanvasNodesToConfig,
  connectCanvasNodesToConfig,
  createConnectedCanvasGraph,
  isHiddenCanvasBatchChild,
} from "@/features/canvas/domain/connections";
import {
  createCanvasGroup,
  normalizeCanvasGroups,
  removeNodesFromCanvasGroups,
  type CanvasGroupData,
} from "@/features/canvas/domain/groups";
import {
  buildCanvasArchiveProjectRecord,
  canvasArchiveAssetId,
  canvasArchiveProjectSnapshot,
  canvasArchiveStorageKey,
  collectCanvasArchiveAssetReferences,
  parseCanvasProjectArchive,
  remapCanvasArchiveSnapshotAssets,
  type CanvasArchiveUploadedAsset,
  type CanvasProjectArchiveAsset,
  type CanvasProjectArchiveItem,
} from "@/features/canvas/domain/projectArchive";
import { buildCanvasMinimapModel, type CanvasMinimapModel } from "@/features/canvas/domain/minimap";
import {
  buildCanvasFragmentPackage,
  canvasFragmentAssetIds,
  canvasFragmentGroups,
  importCanvasFragmentPackage,
  parseCanvasFragmentPackage,
  serializeCanvasFragmentPackage,
  type CanvasFragmentGroup,
  type CanvasFragmentManifestRow,
  type CanvasFragmentPackage,
} from "@/features/canvas/domain/fragment";
import {
  compressDataUrl,
  composeStoryboardDataUrl,
  createOutpaintMaskDataUrl,
  createOutpaintSourceDataUrl,
  cropDataUrl,
  flipDataUrl,
  splitDataUrl,
  upscaleDataUrl,
} from "@/features/canvas/adapters/imageData";
import {
  canvasAnglePrompt,
  imageCropRectFromDraft,
  imageToolDraftFromCropRect,
  moveImageCropRect,
  resizeImageCropRect,
  type ImageCropRect,
  type ImageCropResizeHandle,
  type StoryboardLayout,
} from "@/features/canvas/domain/imageData";
import {
  canvasTextComposerValue,
  canvasTextDisplayValue,
  isGeneratedCanvasText,
  updateCanvasNodeComposer,
  updateCanvasTextDisplay,
} from "@/features/canvas/domain/text";
import {
  saveCanvasTextAsset,
} from "@/features/canvas/repositories/textAssetsRepository";
import {
  applyCanvasAgentOps,
  type CanvasAgentExecutionResult,
  type CanvasAgentGenerationMode,
  type CanvasAgentGenerationResult,
  type CanvasAgentOp,
  type CanvasAgentSnapshot,
} from "@/lib/canvas-agent";
import { createZip, readZip } from "@/lib/zip";
import {
  buildCanvasSnapshot,
  canvasAgentSnapshotFromCanvas,
} from "@/features/canvas/domain/snapshotCodec";
import {
  assetIdFromNode,
  imageSrcFromNode,
  looksLikeImageSource,
  nodeKindTitle,
  normalizeCanvasEdge,
  normalizeCanvasNode,
  normalizeCanvasNodeKind,
} from "@/features/canvas/domain/nodes";
import {
  batchChildGridPosition,
  refreshImageBatchRoot,
  snapImageBatchChildrenToGrid,
} from "@/features/canvas/domain/batch";
import { isRecord, numberValue, stringValue } from "@/features/canvas/domain/value";
import {
  canvasListHref,
  canvasProjectHref,
  isWorkspaceScope,
  projectScopeFromServer,
  workspaceScopeValue,
} from "@/features/canvas/domain/workspace";
import { scopeFromCanvasLocation as scopeFromLocation } from "@/features/canvas/adapters/workspaceLocation";
import type {
  CanvasBackgroundMode,
  CanvasEdgeData,
  CanvasImageReferenceSnapshot,
  CanvasNodeData,
  CanvasNodeKind,
  CanvasNodeMetadata,
  CanvasSnapshotState,
  ImageQualityValue,
  ImageSizeValue,
} from "@/features/canvas/domain/types";
import {
  assetKindFromFile,
  audioFileExtension,
  canvasGenerationInputsFromVideoSnapshot,
  canvasVideoReferenceSnapshot,
  cloneCanvasEdges,
  cloneCanvasNodes,
  defaultGenerationModeForKind,
  defaultMediaMimeType,
  fragmentMediaFileName,
  fragmentMediaMimeType,
  generationModeFromNode,
  imageCountFromNode,
  imageFileName,
  imageReferenceSnapshots,
  isAbortError,
  isReadableMediaSource,
  mediaFileName,
  mediaKindFromNode,
  mediaKindLabel,
  modelFromNode,
  nodeEditorTextFromNode,
  promptTextFromNode,
  qualityFromNode,
  sizeFromNode,
  toImageSizeValue,
  videoConfigFromNode,
  videoFileName,
  videoProviderFromNode,
  audioConfigFromNode,
} from "@/features/canvas/domain/nodeUtils";
import {
  completeGeneratedAudioTarget,
  completeGeneratedImageTarget,
  completeGeneratedVideoTarget,
  failGeneratedAudioTarget,
  failGeneratedImageTarget,
  failGeneratedTextTarget,
  failGeneratedVideoTarget,
  resolveGeneratedNode,
} from "@/features/canvas/domain/generation";

type CanvasSyncStatus = "loading" | "pending" | "saving" | "synced" | "error";

const defaultPrompt = "雨夜，狭长街道，潮湿沥青反射红色招牌；人物在画面右侧停留，低机位缓慢推近，电影级冷暖对比。";
const IMAGE_PROMPT_REVERSE_PRESET = `请根据参考图片反推一段适合用于 AI 生图的提示词。

要求：
1. 只输出提示词正文，不要解释。
2. 覆盖主体、构图、风格、光线、色彩、材质、镜头和氛围。
3. 尽量写成可直接用于生图模型的完整提示词。`;
const scopeOptions: Array<{ value: WorkspaceScope; label: string }> = [
  { value: "personal", label: "个人空间" },
  { value: "team", label: "团队空间" },
];

const CANVAS_FLOATING_PANEL_WIDTH = 340;
const CANVAS_FLOATING_PANEL_MIN_HEIGHT = 280;
const CANVAS_MINIMAP_WIDTH = 184;
const CANVAS_MINIMAP_HEIGHT = 122;
// 缩略导航关闭时的占位模型，避免 minimapModel 每帧随视口重建
const EMPTY_CANVAS_MINIMAP_MODEL: CanvasMinimapModel = {
  width: CANVAS_MINIMAP_WIDTH,
  height: CANVAS_MINIMAP_HEIGHT,
  world: { x: 0, y: 0, width: 0, height: 0 },
  nodes: [],
  viewport: { x: 0, y: 0, width: 0, height: 0 },
};
function canvasSyncLabel(status: CanvasSyncStatus) {
  const labels: Record<CanvasSyncStatus, string> = {
    loading: "读取同步状态",
    pending: "有待保存修改",
    saving: "正在保存",
    synced: "已同步",
    error: "同步失败",
  };
  return labels[status];
}

function formatCanvasSyncTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN");
}

function starterNodes(): CanvasNodeData[] {
  return [
    {
      id: crypto.randomUUID(),
      kind: "text",
      title: "剧本提示词",
      content: "",
      x: 90,
      y: 130,
      width: 290,
      height: 178,
      metadata: { content: "", prompt: "", composerContent: "", status: "idle", size: "auto", quality: "auto", count: 1 },
    },
    {
      id: crypto.randomUUID(),
      kind: "config",
      title: "生成配置",
      content: "",
      x: 460,
      y: 82,
      width: 300,
      height: 178,
      metadata: { content: "", prompt: "", composerContent: "", status: "idle", size: "auto", quality: "auto", count: 1 },
    },
  ];
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function safeArchiveSegment(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "_").trim() || "canvas";
}

function canvasArchiveMediaFileName(asset: Asset) {
  const name = safeArchiveSegment(asset.name || asset.id);
  if (/\.[a-z0-9]{2,5}$/i.test(name)) return name;
  const mimeType = asset.content_type || "";
  const extension = asset.type === "video"
    ? mimeType.includes("webm") ? "webm" : "mp4"
    : asset.type === "audio"
      ? mimeType.includes("wav") ? "wav" : mimeType.includes("mpeg") ? "mp3" : "m4a"
      : mimeType.includes("jpeg") ? "jpg" : mimeType.includes("webp") ? "webp" : mimeType.includes("gif") ? "gif" : "png";
  return `${name}.${extension}`;
}

function canvasArchiveMediaKind(mimeType: string): "image" | "video" | "audio" {
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "image";
}

export default function CanvasWorkspaceViewContent() {
  const [location, navigate] = useLocation();
  const { user } = useAuth();
  const projectId = location.startsWith("/canvas/") ? decodeURIComponent(location.slice("/canvas/".length).split("?")[0]) : "";
  const canvasCommands = useCanvasCommands();
  const canvasStore = useCanvasStoreApi();
  const scope = useCanvasStore((state) => state.session.scope);
  const setScope = canvasCommands.session.setScope;
  const [projects, setProjects] = useState<CanvasProject[]>([]);
  const [coverProjectId, setCoverProjectId] = useState("");
  /* 画布标题行内重命名：双击标题进入编辑（命名带 project 前缀，避开节点标题编辑的 titleDraft） */
  const [projectTitleEditing, setProjectTitleEditing] = useState(false);
  const [projectTitleDraft, setProjectTitleDraft] = useState("");
  const [projectTitleSaving, setProjectTitleSaving] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(() => new Set());
  const [projectBatchBusy, setProjectBatchBusy] = useState(false);
  const [projectDeleteIds, setProjectDeleteIds] = useState<string[]>([]);
  const [projectDeleteError, setProjectDeleteError] = useState("");
  const projectTitle = useCanvasStore((state) => state.session.projectTitle);
  const setProjectTitle = canvasCommands.session.setProjectTitle;
  const canonicalProjectScope = useCanvasStore((state) => state.session.canonicalProjectScope);
  const setCanonicalProjectScope = canvasCommands.session.setCanonicalProjectScope;
  const nodes = useCanvasStore((state) => state.graph.nodes);
  const setNodes = canvasCommands.graph.setNodes;
  const edges = useCanvasStore((state) => state.graph.edges);
  const setEdges = canvasCommands.graph.setEdges;
  const groups = useCanvasStore((state) => state.graph.groups);
  const setGroups = canvasCommands.graph.setGroups;
  const selectedId = useCanvasStore((state) => state.graph.selectedNodeId);
  const setSelectedId = canvasCommands.graph.setSelectedNodeId;
  const selectedNodeIdValues = useCanvasStore((state) => state.graph.selectedNodeIds);
  const selectedNodeIds = useMemo(() => new Set(selectedNodeIdValues), [selectedNodeIdValues]);
  const setSelectedNodeIds = canvasCommands.graph.setSelectedNodeIds;
  const selectedGroupId = useCanvasStore((state) => state.graph.selectedGroupId);
  const setSelectedGroupId = canvasCommands.graph.setSelectedGroupId;
  const zoom = useCanvasStore((state) => state.viewport.zoom);
  const panX = useCanvasStore((state) => state.viewport.panX);
  const panY = useCanvasStore((state) => state.viewport.panY);
  const backgroundMode = useCanvasStore((state) => state.viewport.backgroundMode);
  const setBackgroundMode = canvasCommands.viewport.setBackgroundMode;
  const showImageInfo = useCanvasStore((state) => state.viewport.showImageInfo);
  const setShowImageInfo = canvasCommands.viewport.setShowImageInfo;
  const loading = useCanvasStore((state) => state.session.loading);
  const setLoading = canvasCommands.session.setLoading;
  const saving = useCanvasStore((state) => state.session.saving);
  const snapshotWriteReady = useCanvasStore((state) => state.session.snapshotWriteReady);
  const setSnapshotWriteReady = canvasCommands.session.setSnapshotWriteReady;
  const syncStatus = useCanvasStore((state) => state.session.syncStatus);
  const setSyncStatus = canvasCommands.session.setSyncStatus;
  const snapshotVersion = useCanvasStore((state) => state.session.snapshotVersion);
  const setSnapshotVersion = canvasCommands.session.setSnapshotVersion;
  const snapshotUpdatedAt = useCanvasStore((state) => state.session.snapshotUpdatedAt);
  const setSnapshotUpdatedAt = canvasCommands.session.setSnapshotUpdatedAt;
  const syncError = useCanvasStore((state) => state.session.syncError);
  const setSyncError = canvasCommands.session.setSyncError;
  const switching = useCanvasStore((state) => state.session.switching);
  const setSwitching = canvasCommands.session.setSwitching;
  const createDialogOpen = useCanvasStore((state) => state.ui.createDialogOpen);
  const setCreateDialogOpen = canvasCommands.ui.setCreateDialogOpen;
  const [createDialogTitle, setCreateDialogTitle] = useState("未命名画布");
  const [createDialogScope, setCreateDialogScope] = useState<WorkspaceScope>(scope);
  const [createDialogBusy, setCreateDialogBusy] = useState(false);
  const [createDialogError, setCreateDialogError] = useState("");
  const deleteProjectOpen = useCanvasStore((state) => state.ui.deleteProjectOpen);
  const setDeleteProjectOpen = canvasCommands.ui.setDeleteProjectOpen;
  const [deleteProjectBusy, setDeleteProjectBusy] = useState(false);
  const [deleteProjectError, setDeleteProjectError] = useState("");
  const clearCanvasOpen = useCanvasStore((state) => state.ui.clearCanvasOpen);
  const setClearCanvasOpen = canvasCommands.ui.setClearCanvasOpen;
  const [clearCanvasBusy, setClearCanvasBusy] = useState(false);
  const [clearCanvasError, setClearCanvasError] = useState("");
  const connectSelectionOpen = useCanvasStore((state) => state.ui.connectSelectionOpen);
  const setConnectSelectionOpen = canvasCommands.ui.setConnectSelectionOpen;
  const agentOpen = useCanvasStore((state) => state.ui.agentOpen);
  const setAgentOpen = canvasCommands.ui.setAgentOpen;
  // 聊天台引导流程：覆盖层从首屏接管（步骤2），用户输入原文在加载完成后交接给 Agent 面板（步骤5）
  const [bootstrapActive, setBootstrapActive] = useState(() => Boolean(projectId && peekCanvasBootstrap(projectId)));
  const [initialPrompt, setInitialPrompt] = useState("");
  const bootstrapPromptRef = useRef("");
  const [agentUndoSnapshot, setAgentUndoSnapshot] = useState<CanvasAgentSnapshot | null>(null);
  const inspectorOpen = useCanvasStore((state) => state.ui.inspectorOpen);
  const setInspectorOpen = canvasCommands.ui.setInspectorOpen;
  const pinnedToolbarNodeId = useCanvasStore((state) => state.ui.pinnedToolbarNodeId);
  const setPinnedToolbarNodeId = canvasCommands.ui.setPinnedToolbarNodeId;
  const shortcutsRef = useRef<CanvasShortcutBindings>({ ...DEFAULT_CANVAS_SHORTCUTS });
  // 快捷键处理器声明在生成逻辑之前，用 ref 间接调用以避免前向引用。
  const runSelectedGenerationRef = useRef<() => Promise<void>>(async () => undefined);
  const promptLibraryNodeId = useCanvasStore((state) => state.ui.promptLibraryNodeId);
  const setPromptLibraryNodeId = canvasCommands.ui.setPromptLibraryNodeId;
  const seedanceAssetNodeId = useCanvasStore((state) => state.ui.seedanceAssetNodeId);
  const setSeedanceAssetNodeId = canvasCommands.ui.setSeedanceAssetNodeId;
  const materialNodeId = useCanvasStore((state) => state.ui.materialNodeId);
  const setMaterialNodeId = canvasCommands.ui.setMaterialNodeId;
  const [modelCatalog, setModelCatalog] = useState<ImageModelCatalog | null>(null);
  const [imageModel, setImageModel] = useState("");
  const [textModels, setTextModels] = useState<string[]>([]);
  const [textModel, setTextModel] = useState("");
  const [videoModels, setVideoModels] = useState<string[]>([]);
  const [videoModel, setVideoModel] = useState("");
  const [audioModels, setAudioModels] = useState<string[]>([]);
  const [audioModel, setAudioModel] = useState("");
  const [textModelLabels, setTextModelLabels] = useState<Record<string, string>>({});
  const [promptPresets, setPromptPresets] = useState<PromptPreset[]>([]);
  const [wheelZoomRequiresCtrl, setWheelZoomRequiresCtrl] = useState(true);
  const runningNodeIdValues = useCanvasStore((state) => state.generation.runningNodeIds);
  const runningNodeIds = useMemo(() => new Set(runningNodeIdValues), [runningNodeIdValues]);
  const setRunningNodeIds = canvasCommands.generation.setRunningNodeIds;
  const runningGroupId = useCanvasStore((state) => state.generation.runningGroupId);
  const setRunningGroupId = canvasCommands.generation.setRunningGroupId;
  const jobProgressByNode = useCanvasStore((state) => state.generation.jobProgressByNode);
  const setJobProgressByNode = canvasCommands.generation.setJobProgressByNode;
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [fragmentBusy, setFragmentBusy] = useState(false);
  const [projectArchiveBusy, setProjectArchiveBusy] = useState(false);
  const [captureFrameNodeId, setCaptureFrameNodeId] = useState("");
  const hoveredId = useCanvasStore((state) => state.ui.hoveredNodeId);
  const setHoveredId = canvasCommands.ui.setHoveredNodeId;
  const hoveredEdgeId = useCanvasStore((state) => state.ui.hoveredEdgeId);
  const setHoveredEdgeId = canvasCommands.ui.setHoveredEdgeId;
  const selectedEdgeId = useCanvasStore((state) => state.graph.selectedEdgeId);
  const setSelectedEdgeId = canvasCommands.graph.setSelectedEdgeId;
  const editingInlineNodeId = useCanvasStore((state) => state.ui.editingInlineNodeId);
  const setEditingInlineNodeId = canvasCommands.ui.setEditingInlineNodeId;
  const titleEditingNodeId = useCanvasStore((state) => state.ui.titleEditingNodeId);
  const setTitleEditingNodeId = canvasCommands.ui.setTitleEditingNodeId;
  const titleDraft = useCanvasStore((state) => state.ui.titleDraft);
  const setTitleDraft = canvasCommands.ui.setTitleDraft;
  const [promptOptimizing, setPromptOptimizing] = useState(false);
  const skillLibraryOpen = useCanvasStore((state) => state.ui.skillLibraryOpen);
  const setSkillLibraryOpen = canvasCommands.ui.setSkillLibraryOpen;
  const presetManagerOpen = useCanvasStore((state) => state.ui.presetManagerOpen);
  const setPresetManagerOpen = canvasCommands.ui.setPresetManagerOpen;
  const [styleCategory, setStyleCategory] = useState<string>("drama");
  const [enabledSkills, setEnabledSkills] = useState<CanvasSkill[]>([]);
  const canvasSwitcherOpen = useCanvasStore((state) => state.ui.canvasSwitcherOpen);
  const setCanvasSwitcherOpen = canvasCommands.ui.setCanvasSwitcherOpen;
  const canvasSwitcherQuery = useCanvasStore((state) => state.ui.canvasSwitcherQuery);
  const setCanvasSwitcherQuery = canvasCommands.ui.setCanvasSwitcherQuery;
  const [contextMenu, setContextMenu] = useState<CanvasContextMenuState | null>(null);
  // 右键/双击菜单的级联子菜单：当前展开的分组 key（空串 = 全部收起）
  const [canvasSubmenuKey, setCanvasSubmenuKey] = useState("");
  const minimapOpen = useCanvasStore((state) => state.ui.minimapOpen);
  const setMinimapOpen = canvasCommands.ui.setMinimapOpen;
  const [imageToolDialog, setImageToolDialog] = useState<{ nodeId: string; mode: CanvasImageToolMode } | null>(null);
  const [imageToolDraft, setImageToolDraft] = useState<CanvasImageToolDraft>(defaultCanvasImageToolDraft);
  const [imageCropLocked, setImageCropLocked] = useState(false);
  const [imageToolBusy, setImageToolBusy] = useState(false);
  const [imageToolError, setImageToolError] = useState("");
  const imageAnnotationNodeId = useCanvasStore((state) => state.ui.imageAnnotationNodeId);
  const setImageAnnotationNodeId = canvasCommands.ui.setImageAnnotationNodeId;
  const imageMaskNodeId = useCanvasStore((state) => state.ui.imageMaskNodeId);
  const setImageMaskNodeId = canvasCommands.ui.setImageMaskNodeId;
  const imagePreviewNodeId = useCanvasStore((state) => state.ui.imagePreviewNodeId);
  const setImagePreviewNodeId = canvasCommands.ui.setImagePreviewNodeId;
  const storyboardNodeId = useCanvasStore((state) => state.ui.storyboardNodeId);
  const setStoryboardNodeId = canvasCommands.ui.setStoryboardNodeId;
  const storyboardEditorNodeId = useCanvasStore((state) => state.ui.storyboardEditorNodeId);
  const setStoryboardEditorNodeId = canvasCommands.ui.setStoryboardEditorNodeId;
  const [storyboardLayout, setStoryboardLayout] = useState<StoryboardLayout>("grid-2x2");
  const [storyboardBusy, setStoryboardBusy] = useState(false);
  const replaceImageNodeId = useCanvasStore((state) => state.ui.replaceImageNodeId);
  const setReplaceImageNodeId = canvasCommands.ui.setReplaceImageNodeId;
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceImageInputRef = useRef<HTMLInputElement>(null);
  const replaceMediaInputRef = useRef<HTMLInputElement>(null);
  const replaceMediaNodeIdRef = useRef("");
  const fragmentInputRef = useRef<HTMLInputElement>(null);
  const projectArchiveInputRef = useRef<HTMLInputElement>(null);
  const toggleCanvasBatchRef = useRef<(nodeId: string) => void>(() => undefined);
  const imageCropStageRef = useRef<HTMLDivElement>(null);
  const [historyController] = useState(() => new CanvasHistoryController());
  const [autosaveController] = useState(() => new CanvasAutosaveController());
  const [projectSessionController] = useState(
    () => new CanvasProjectSessionController(autosaveController, historyController),
  );
  const [stageInteractionController] = useState(
    () => new CanvasStageInteractionController(),
  );
  const [generationController] = useState(() => new CanvasGenerationJobsController());
  const {
    abortAllGenerationRequests,
    cancelForRemovedNodes,
    generateAudioFromNode,
    generateFromNode,
    generateImageFromNode,
    generateTextFromNode,
    generateVideoFromNode,
    optimizeNodePrompt,
    recoverPendingJobs,
    retryAudioNode,
    retryImageNode,
    retryTextNode,
    retryVideoNode,
    runImageTarget,
    runSelectedGeneration,
    stopGenerationByNodeId,
  } = generationController;
  const uploadingRef = useRef(false);
  const stageRef = useRef<HTMLElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const stageInteraction = useCanvasStageInteraction(
    stageInteractionController,
    stageRef,
    { zoom, panX, panY },
  );
  const {
    connectFrom,
    connectHandleType,
    connectionTargetId,
    connectionPreviewPoint,
    pendingConnectionCreate,
    selectionBox,
    stageBounds,
  } = stageInteraction;
  const panelRef = useRef<HTMLElement>(null);
  const panelHeight = useCanvasStore((state) => state.ui.panelHeight);
  const setPanelHeight = canvasCommands.ui.setPanelHeight;
  const viewportRef = useMemo(() => ({
    get current() {
      const current = canvasStore.getState().viewport;
      return { zoom: current.zoom, panX: current.panX, panY: current.panY };
    },
    set current(value: { zoom: number; panX: number; panY: number }) { stageInteractionController.syncViewport(value); },
  }), [canvasStore, stageInteractionController]);
  const nodesRef = useMemo(() => ({
    get current() { return canvasStore.getState().graph.nodes; },
    set current(value: CanvasNodeData[]) { canvasCommands.graph.setNodes(value); },
  }), [canvasCommands, canvasStore]);
  const edgesRef = useMemo(() => ({
    get current() { return canvasStore.getState().graph.edges; },
    set current(value: CanvasEdgeData[]) { canvasCommands.graph.setEdges(value); },
  }), [canvasCommands, canvasStore]);
  const groupsRef = useMemo(() => ({
    get current() { return canvasStore.getState().graph.groups; },
    set current(value: CanvasGroupData[]) { canvasCommands.graph.setGroups(value); },
  }), [canvasCommands, canvasStore]);
  const selectedNodeIdsRef = useMemo(() => ({
    get current() { return new Set(canvasStore.getState().graph.selectedNodeIds); },
    set current(value: Set<string>) { canvasCommands.graph.setSelectedNodeIds(value); },
  }), [canvasCommands, canvasStore]);
  const clipboardRef = useRef<CanvasClipboardPayload<CanvasNodeData, CanvasEdgeData> | null>(null);

  const applyNodeSelection = useCallback((ids: Iterable<string>, primaryId = "", openInspector = false) => {
    const next = new Set(ids);
    const nextPrimary = primaryId && next.has(primaryId) ? primaryId : next.values().next().value || "";
    canvasCommands.commit((state) => ({
      graph: {
        selectedNodeIds: [...next],
        selectedNodeId: nextPrimary,
        selectedGroupId: "",
        selectedEdgeId: "",
      },
      ui: {
        editingInlineNodeId: state.ui.editingInlineNodeId && !next.has(state.ui.editingInlineNodeId)
          ? ""
          : state.ui.editingInlineNodeId,
        // 与旧版一致：选中单个节点即在节点下方打开编辑面板；顶栏「检查器」按钮仍可手动收起。
        inspectorOpen: openInspector || next.size === 1,
      },
    }));
  }, [canvasCommands]);

  const currentMentionScope = projectId ? canonicalProjectScope ?? scope : scope;
  const {
    controller: assetsMentionsController,
    snapshot: assetsMentionsSnapshot,
  } = useCanvasAssetsMentions({
    projectId,
    canonicalScope: canonicalProjectScope,
    fallbackScope: scope,
    mentionScope: currentMentionScope,
    nodes,
    getUserId: () => user?.id || "",
    getProjectId: () => projectId,
    getCanonicalScope: () => projectSessionController.canonicalScope,
    getFallbackScope: () => scope,
    getMentionScope: () => currentMentionScope,
    getNodes: () => nodesRef.current,
    getEdges: () => edgesRef.current,
    setNodes: nextNodes => { nodesRef.current = nextNodes; setNodes(nextNodes); },
    applyNodeSelection,
    getCanvasCenter: stageInteractionController.getCanvasCenter,
    setImagePreviewNodeId,
    toggleCanvasBatch: nodeId => toggleCanvasBatchRef.current(nodeId),
    focusNodeInViewport: stageInteractionController.focusNodeInViewport,
    executeAssets: canvasCommands.services.assets,
    onSuccess: message => toast.success(message),
    onError: message => toast.error(message),
  });
  const {
    assets: canvasAssets,
    previews,
    picker: assetPicker,
    mentionPreview: mentionMediaPreview,
  } = assetsMentionsSnapshot;
  const {
    cancelAssetPicker,
    closeMentionPreview: closeMentionMediaPreview,
    insertAssetPickerSelection,
    locateMentionReference,
    mentionReferencesForNode,
    mentionThumbnailFor,
    mergeAssets: mergeCanvasAssetCatalog,
    openAssetPicker,
    previewMentionReference,
    queueMentionAssetSearch,
    searchAssetPicker,
    setAssetPickerKind,
    setAssetPickerOpen,
    setAssetPickerQuery,
    setAssetPickerScope,
    toggleAssetPickerItem,
  } = assetsMentionsController;
  const {
    open: assetPickerOpen,
    insertBusy: assetPickerInsertBusy,
    scope: assetPickerScope,
    loading: assetPickerLoading,
    query: assetPickerQuery,
    kind: assetPickerKind,
    error: assetPickerError,
    items: assetPickerItems,
    selectedIds: assetPickerSelectedIds,
  } = assetPicker;

  const selectedNode = nodes.find((node) => node.id === selectedId);

  /* 双击画布标题进入行内编辑；Enter/失焦提交，Esc 取消 */
  const beginTitleEdit = () => {
    if (!projectId || projectActionDisabled) return;
    setCanvasSwitcherOpen(false);
    setProjectTitleDraft(projectTitle);
    setProjectTitleEditing(true);
  };
  const commitTitleEdit = async () => {
    if (projectTitleSaving) return;
    const nextTitle = projectTitleDraft.trim();
    if (!nextTitle || nextTitle === projectTitle || !projectId) {
      setProjectTitleEditing(false);
      return;
    }
    setProjectTitleSaving(true);
    try {
      await updateProject(projectId, { title: nextTitle, scope: canonicalProjectScope || "personal" });
      setProjectTitle(nextTitle);
      setProjects((items) => items.map((project) => project.id === projectId ? { ...project, title: nextTitle } : project));
      toast.success("项目已重命名");
      setProjectTitleEditing(false);
    } catch (error) {
      toast.error(publicApiError(error, "重命名项目失败"));
    } finally {
      setProjectTitleSaving(false);
    }
  };
  const selectedGroup = groups.find((group) => group.id === selectedGroupId);
  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const filteredProjects = useMemo(() => {
    const query = canvasSwitcherQuery.trim().toLowerCase();
    if (!query) return projects;
    return projects.filter((project) => project.title.toLowerCase().includes(query));
  }, [canvasSwitcherQuery, projects]);
  const materialNode = materialNodeId ? nodeMap.get(materialNodeId) : undefined;
  const seedanceAssetNode = seedanceAssetNodeId ? nodeMap.get(seedanceAssetNodeId) : undefined;
  const agentSnapshot = useMemo(
    () => canvasAgentSnapshotFromCanvas(projectId, projectTitle || "未命名画布", nodes, edges, selectedNodeIds, { zoom, panX, panY }),
    [edges, nodes, panX, panY, projectId, projectTitle, selectedNodeIds, zoom],
  );
  const visibleNodes = useMemo(() => nodes.filter((node) => !isHiddenCanvasBatchChild(node, nodes)), [nodes]);
  // 视口裁剪（移植自旧优化引擎的可见区剔除思路）：只为"可视范围 + 600px 屏幕缓冲"内的节点挂载 DOM。
  // 缓冲区同时保证节点入场动画在屏外播完，正常平移不会看到节点闪现；缩略图/连线仍用全量 visibleNodes。
  const renderedNodes = useMemo(() => {
    const scale = Math.max(0.05, zoom / 100);
    const margin = 600 / scale;
    const viewLeft = -panX / scale - margin;
    const viewTop = -panY / scale - margin;
    const viewRight = (stageBounds.width - panX) / scale + margin;
    const viewBottom = (stageBounds.height - panY) / scale + margin;
    return visibleNodes.filter((node) =>
      node.x + node.width >= viewLeft && node.x <= viewRight &&
      node.y + node.height >= viewTop && node.y <= viewBottom
    );
  }, [visibleNodes, panX, panY, zoom, stageBounds.width, stageBounds.height]);
  const contextMenuNode = contextMenu?.nodeId ? nodeMap.get(contextMenu.nodeId) : undefined;
  const imageToolNode = imageToolDialog ? nodeMap.get(imageToolDialog.nodeId) : undefined;
  const imageToolPreview = imageToolNode ? imageSrcFromNode(imageToolNode, previews) : "";
  const imageToolCrop = imageCropRectFromDraft(imageToolDraft);
  const imageAnnotationNode = imageAnnotationNodeId ? nodeMap.get(imageAnnotationNodeId) : undefined;
  const imageAnnotationPreview = imageAnnotationNode ? imageSrcFromNode(imageAnnotationNode, previews) : "";
  const imageMaskNode = imageMaskNodeId ? nodeMap.get(imageMaskNodeId) : undefined;
  const imageMaskPreview = imageMaskNode ? imageSrcFromNode(imageMaskNode, previews) : "";
  const imagePreviewNode = imagePreviewNodeId ? nodeMap.get(imagePreviewNodeId) : undefined;
  const imagePreviewSrc = imagePreviewNode ? imageSrcFromNode(imagePreviewNode, previews) : "";
  /** 预览弹窗的兄弟图集合：批次根 → [根, ...子图]；子图 → 同组全部；独立节点 → 自身。 */
  const imagePreviewSiblings = useMemo(() => {
    const node = imagePreviewNode;
    if (!node) return [] as CanvasNodeData[];
    const rootId = stringValue(node.metadata?.batchRootId);
    const root = rootId ? nodes.find((item) => item.id === rootId) : node.metadata?.isBatchRoot ? node : undefined;
    if (!root) return [node];
    const children = (root.metadata?.batchChildIds || [])
      .map((id) => nodes.find((item) => item.id === id))
      .filter((item): item is CanvasNodeData => Boolean(item));
    return [root, ...children];
  }, [imagePreviewNode, nodes]);
  const [previewAssetMeta, setPreviewAssetMeta] = useState<{ createdAt?: string; contentType?: string }>({});

  useEffect(() => {
    const node = imagePreviewNode;
    const assetId = node ? assetIdFromNode(node) : "";
    if (!assetId) {
      setPreviewAssetMeta({});
      return;
    }
    const scope = workspaceScopeValue(node?.metadata?.assetScope) || projectSessionController.canonicalScope || "personal";
    let disposed = false;
    getAsset(assetId, scope).then((asset) => {
      if (disposed) return;
      setPreviewAssetMeta({ createdAt: asset.created_at, contentType: asset.content_type });
    }).catch(() => undefined);
    return () => { disposed = true; };
  }, [imagePreviewNode]);

  useEffect(() => {
    if (!imagePreviewNodeId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      const ids = imagePreviewSiblings.map((item) => item.id);
      const index = ids.indexOf(imagePreviewNodeId);
      if (ids.length < 2 || index < 0) return;
      event.preventDefault();
      const next = ids[(index + (event.key === "ArrowRight" ? 1 : -1) + ids.length) % ids.length];
      setImagePreviewNodeId(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [imagePreviewNodeId, imagePreviewSiblings]);
  const storyboardSelectedCount = nodes.filter((node) => selectedNodeIds.has(node.id) && node.kind === "image" && Boolean(imageSrcFromNode(node, previews))).length || (storyboardNodeId ? 1 : 0);
  // 缩略导航关闭时不重建模型（panX/panY 每帧变化，避免每帧全量计算）
  const minimapModel = useMemo<CanvasMinimapModel>(() => minimapOpen ? buildCanvasMinimapModel(
    visibleNodes,
    { zoom, panX, panY },
    { width: stageBounds.width, height: Math.max(1, stageBounds.height - CANVAS_STAGE_OFFSET) },
    { width: CANVAS_MINIMAP_WIDTH, height: CANVAS_MINIMAP_HEIGHT },
  ) : EMPTY_CANVAS_MINIMAP_MODEL, [minimapOpen, panX, panY, stageBounds.height, stageBounds.width, visibleNodes, zoom]);
  const normalizedSelectionBox = useMemo(
    () => selectionBox ? normalizeCanvasSelectionRect(selectionBox.start, selectionBox.current) : null,
    [selectionBox],
  );
  const selectionBoxStyle = useMemo<CSSProperties | undefined>(() => normalizedSelectionBox ? ({
    position: "absolute",
    left: normalizedSelectionBox.x,
    top: normalizedSelectionBox.y,
    width: normalizedSelectionBox.width,
    height: normalizedSelectionBox.height,
    zIndex: 20,
    pointerEvents: "none",
    border: "1px solid #7dd3fc",
    background: "rgba(125, 211, 252, 0.12)",
  }) : undefined, [normalizedSelectionBox]);
  const canUndo = historyState.canUndo;
  const canRedo = historyState.canRedo;
  const visiblePromptPresets = useMemo(() => sortPromptPresets(promptPresets).slice(0, 8), [promptPresets]);
  const selectedGenerationMode = selectedNode ? generationModeFromNode(selectedNode) : "image";
  const selectedGeneratedText = selectedNode ? isGeneratedCanvasText(selectedNode) : false;
  const selectedGenerationModel = selectedNode
    ? modelFromNode(
      selectedNode,
      selectedGenerationMode === "text" ? textModel : selectedGenerationMode === "image" ? imageModel : selectedGenerationMode === "video" ? videoModel : audioModel,
    )
    : "";
  const selectedVideoConfig = selectedNode && selectedGenerationMode === "video"
    ? videoConfigFromNode(selectedNode, videoModel)
    : null;
  const selectedVideoSeedance = Boolean(selectedVideoConfig && isSeedanceVideoModel(selectedVideoConfig.model));
  const selectedAudioConfig = selectedNode && selectedGenerationMode === "audio"
    ? audioConfigFromNode(selectedNode, audioModel)
    : null;
  const currentProjectDisplayScope = projectId ? canonicalProjectScope ?? scope : scope;
  const projectListScope = projectId ? canonicalProjectScope ?? scope : scope;
  /* 画布选择页的自定义封面缩略图（无封面时保持默认抽象占位） */
  const projectCoverUrls = useProjectCoverUrls(projects, projectListScope);
  const projectScopePending = Boolean(projectId && !canonicalProjectScope);
  const projectActionDisabled = loading || switching || projectScopePending;
  const canvasInteractionBlocked = projectActionDisabled;
  const syncTimestampLabel = formatCanvasSyncTime(snapshotUpdatedAt);
  const syncStatusTitle = [
    canvasSyncLabel(syncStatus),
    snapshotVersion > 0 ? `服务端版本 v${snapshotVersion}` : "服务端版本尚未建立",
    syncTimestampLabel ? `最后同步：${syncTimestampLabel}` : "",
    syncError,
  ].filter(Boolean).join("\n");
  const selectedPanelStyle = useMemo<CSSProperties | undefined>(() => {
    if (!selectedNode) return undefined;
    const scale = Math.max(0.05, zoom / 100);
    // 节点完全移出舞台视野时不显示面板（钳制在边缘会显得悬浮无锚点）。
    const nodeLeft = panX + selectedNode.x * scale;
    const nodeTop = CANVAS_STAGE_OFFSET + panY + selectedNode.y * scale;
    const nodeRight = nodeLeft + selectedNode.width * scale;
    const nodeBottom = nodeTop + selectedNode.height * scale;
    if (nodeRight < 0 || nodeBottom < CANVAS_STAGE_OFFSET || nodeLeft > stageBounds.width || nodeTop > stageBounds.height) return undefined;
    // 面板做成长矩形（宽于节点约 200px，收敛在 560–720），chips/操作行单行不折行；用户拖宽过则以拖宽值为准。
    const savedWidth = numberValue(selectedNode.metadata?.promptPanelWidth);
    const computedWidth = Math.round(selectedNode.width * scale) + 200;
    let width = savedWidth ? Math.min(720, Math.max(340, savedWidth)) : Math.min(720, Math.max(560, computedWidth));
    width = Math.min(width, Math.max(340, stageBounds.width - 24));
    const nodeCenterX = panX + (selectedNode.x + selectedNode.width / 2) * scale;
    // 实测面板高度做钳制，避免估算偏差把面板顶回盖住节点；始终锚在节点正下方。
    const measuredHeight = Math.max(160, panelHeight);
    const minPanelHeight = 140;
    let top = nodeBottom + 12;
    const maxTop = Math.max(CANVAS_STAGE_OFFSET + 8, stageBounds.height - measuredHeight - 12);
    top = Math.min(top, maxTop);
    // 节点太高把面板推出舞台时，改用舞台内可用高度，确保面板总能完整显示在节点下方。
    top = Math.max(CANVAS_STAGE_OFFSET + 8, top);
    const availableHeight = Math.max(minPanelHeight, stageBounds.height - top - 12);
    const left = Math.min(Math.max(12, nodeCenterX - width / 2), Math.max(12, stageBounds.width - width - 12));
    return { left: Math.round(left), top: Math.round(top), width, maxHeight: Math.round(availableHeight) };
  }, [panX, panY, panelHeight, selectedNode, stageBounds.height, stageBounds.width, zoom]);
  const contextMenuStyle = useMemo<CSSProperties | undefined>(() => {
    if (!contextMenu) return undefined;
    const width = 220;
    // 分组级联菜单后图片节点菜单大幅变矮，估算高度用于贴边定位
    const height = contextMenu.edgeId ? 176 : contextMenu.nodeId ? (contextMenuNode?.kind === "image" ? 372 : 292) : 284;
    const left = Math.min(Math.max(12, contextMenu.x), Math.max(12, stageBounds.width - width - 12));
    const top = Math.min(Math.max(CANVAS_STAGE_OFFSET + 8, contextMenu.y), Math.max(CANVAS_STAGE_OFFSET + 8, stageBounds.height - height - 12));
    return { left: Math.round(left), top: Math.round(top), width };
  }, [contextMenu, contextMenuNode?.kind, stageBounds.height, stageBounds.width]);
  // 菜单贴近右边缘时子菜单改为向左弹出（菜单宽 220 + 子面板约 220 + 留白）
  const contextMenuFlipX = useMemo(
    () => Boolean(contextMenu && contextMenu.x > stageBounds.width - 460),
    [contextMenu, stageBounds.width],
  );
  // 菜单关闭/切换时收起所有子菜单
  useEffect(() => { setCanvasSubmenuKey(""); }, [contextMenu]);
  /** 级联子菜单分组：悬停/点击触发展开面板，子项点击后整个菜单关闭（各子项 onClick 自带 setContextMenu(null)） */
  const renderCanvasSubmenu = (key: string, icon: ReactNode, label: string, items: ReactNode) => (
    <div
      key={key}
      className={`canvas-submenu ${canvasSubmenuKey === key ? "open" : ""}`}
      onPointerEnter={() => setCanvasSubmenuKey(key)}
      onPointerLeave={() => setCanvasSubmenuKey((current) => (current === key ? "" : current))}
    >
      <button
        type="button"
        className="full-outline canvas-submenu-trigger"
        onClick={(event) => { event.stopPropagation(); setCanvasSubmenuKey(canvasSubmenuKey === key ? "" : key); }}
      >
        {icon} <span>{label}</span> <ChevronRight size={12} className="submenu-caret" />
      </button>
      <div className="canvas-submenu-panel">{items}</div>
    </div>
  );
  const pendingConnectionMenuStyle = useMemo<CSSProperties | undefined>(() => {
    if (!pendingConnectionCreate) return undefined;
    const width = 224;
    const height = 246;
    const left = Math.min(Math.max(12, pendingConnectionCreate.x), Math.max(12, stageBounds.width - width - 12));
    const top = Math.min(Math.max(CANVAS_STAGE_OFFSET + 8, pendingConnectionCreate.y), Math.max(CANVAS_STAGE_OFFSET + 8, stageBounds.height - height - 12));
    return { left: Math.round(left), top: Math.round(top), width };
  }, [pendingConnectionCreate, stageBounds.height, stageBounds.width]);
  const connectionPreviewPath = useMemo(() => {
    if (!connectFrom) return "";
    const source = nodeMap.get(connectFrom);
    if (!source) return "";
    const target = connectionTargetId ? nodeMap.get(connectionTargetId) : null;
    if (!target && !connectionPreviewPoint) return "";
    return canvasActiveConnectionPath(source, connectHandleType, connectionPreviewPoint || { x: source.x, y: source.y + source.height / 2 }, target);
  }, [connectFrom, connectHandleType, connectionPreviewPoint, connectionTargetId, nodeMap]);
  const connectionLayerBounds = useMemo(() => buildCanvasConnectionLayerBounds(
    visibleNodes,
    edges,
    connectFrom ? {
      nodeId: connectFrom,
      handleType: connectHandleType,
      previewPoint: connectionPreviewPoint,
      targetNodeId: connectionTargetId || undefined,
    } : undefined,
  ), [connectFrom, connectHandleType, connectionPreviewPoint, connectionTargetId, edges, visibleNodes]);
  const {
    activateConnectionMode,
    beginInlineNodeEdit,
    beginConnection,
    cancelActiveCanvasInteractions,
    cancelPendingConnectionCreate,
    chooseNode,
    clientToStagePoint,
    connectNodes,
    endDrag,
    endGroupDrag,
    endGroupResize,
    endResize,
    fitCanvasToContent,
    focusNodeInViewport,
    getCanvasCenter,
    handleCanvasDoubleClick,
    handleCanvasLinesClick,
    handleCanvasLinesContextMenu,
    handleCanvasLinesDoubleClick,
    handleCanvasLinesPointerDown,
    handleCanvasLinesPointerLeave,
    handleCanvasLinesPointerMove,
    handleEdgeClick,
    handleNodeHoverEnd,
    handleNodeHoverStart,
    handleStagePointerDown,
    moveDrag,
    moveGroupDrag,
    moveGroupResize,
    moveResize,
    navigateFromMinimap,
    openCanvasContextMenu,
    openNodeContextMenu,
    registerConnectionHandle,
    screenToCanvasPoint,
    selectCanvasGroup,
    startDrag,
    startGroupDrag,
    startGroupResize,
    startResize,
    zoomCanvasAroundCenter,
  } = stageInteractionController;

  const captureCanvasState = useCallback((): CanvasSnapshotState => ({
    nodes: structuredClone(nodesRef.current),
    edges: structuredClone(edgesRef.current),
    groups: structuredClone(groupsRef.current),
    backgroundMode,
    showImageInfo,
  }), [backgroundMode, showImageInfo]);

  historyController.updateBindings({
    capture: captureCanvasState,
    getSource: () => ({
      nodes: nodesRef.current,
      edges: edgesRef.current,
      groups: groupsRef.current,
      backgroundMode,
      showImageInfo,
    }),
    apply: entry => {
      canvasCommands.commit({
        graph: {
          nodes: entry.nodes,
          edges: entry.edges,
          groups: entry.groups,
          selectedNodeIds: [],
          selectedNodeId: "",
          selectedGroupId: "",
          selectedEdgeId: "",
        },
        viewport: {
          backgroundMode: entry.backgroundMode,
          showImageInfo: entry.showImageInfo,
        },
        ui: { editingInlineNodeId: "", inspectorOpen: false, hoveredEdgeId: "" },
      });
      stageInteractionController.resetConnectionAndPending();
      setContextMenu(null);
    },
    onAvailabilityChange: setHistoryState,
    onResumeChanged: () => setNodes(current => [...current]),
  });

  const undoCanvas = useCallback(
    () => { historyController.undo(); },
    [historyController],
  );
  const redoCanvas = useCallback(
    () => { historyController.redo(); },
    [historyController],
  );
  const pauseCanvasHistory = useCallback(
    () => historyController.pause(),
    [historyController],
  );
  const resumeCanvasHistory = useCallback(
    (changed: boolean) => historyController.resume(changed),
    [historyController],
  );

  const captureCurrentSnapshot = useCallback((): CanvasSnapshotCapture => ({
    nodes: nodesRef.current,
    edges: edgesRef.current,
    groups: groupsRef.current,
    zoom: viewportRef.current.zoom,
    panX: viewportRef.current.panX,
    panY: viewportRef.current.panY,
    backgroundMode,
    showImageInfo,
  }), [backgroundMode, showImageInfo]);

  const copySelectedNodes = useCallback(() => {
    const clipboard = createCanvasClipboard(
      nodesRef.current,
      edgesRef.current,
      selectedNodeIdsRef.current,
      projectSessionController.canonicalKey,
    );
    if (!clipboard) return false;
    clipboardRef.current = clipboard;
    toast.success(`已复制 ${clipboard.nodes.length} 个画布节点`);
    return true;
  }, []);

  const pasteCopiedNodes = useCallback(() => {
    const clipboard = clipboardRef.current;
    const projectKey = projectSessionController.canonicalKey;
    if (clipboard && clipboard.projectKey !== projectKey) {
      toast.warning("剪贴板来自另一张画布，请在当前画布重新复制");
      return false;
    }
    const pasted = pasteCanvasClipboard(clipboard, projectKey, getCanvasCenter(), () => crypto.randomUUID());
    if (!pasted) return false;
    const nextNodes = [...nodesRef.current, ...pasted.nodes];
    const nextEdges = [...edgesRef.current, ...pasted.edges];
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    setNodes(nextNodes);
    setEdges(nextEdges);
    const pastedIds = pasted.nodes.map((node) => node.id);
    applyNodeSelection(pastedIds, pastedIds[0] || "", pastedIds.length === 1);
    setContextMenu(null);
    stageInteractionController.resetConnectionAndPending();
    toast.success(`已粘贴 ${pasted.nodes.length} 个画布节点`);
    return true;
  }, [applyNodeSelection, getCanvasCenter]);

  const removeEdge = useCallback((edgeId: string) => {
    const nextEdges = edgesRef.current.filter((edge) => edge.id !== edgeId);
    edgesRef.current = nextEdges;
    setEdges(nextEdges);
    setSelectedEdgeId((current) => current === edgeId ? "" : current);
    setHoveredEdgeId((current) => current === edgeId ? "" : current);
    setContextMenu(null);
  }, []);

  useEffect(() => {
    setScope(scopeFromLocation(location));
  }, [location]);

  useEffect(() => {
    let disposed = false;
    setProjects([]);
    setSelectedProjectIds(new Set());
    setProjectDeleteIds([]);
    setProjectDeleteError("");
    getProjects(projectListScope)
      .then((result) => {
        if (!disposed) setProjects(Array.isArray(result) ? result : result.items || []);
      })
      .catch(() => {
        if (!disposed) setProjects([]);
    });
    return () => { disposed = true; };
  }, [projectListScope]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") !== "forbidden") return;
    toast.error("当前账号没有访问管理后台的权限");
    params.delete("auth");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  }, []);

  useEffect(() => {
    // 切换选中节点时收起上一个节点打开的弹出层，避免旧节点的对话框残留在新节点面板上方。
    setPromptLibraryNodeId("");
    setImageToolDialog(null);
    setImageAnnotationNodeId("");
    setImageMaskNodeId("");
    setImagePreviewNodeId("");
    setStoryboardNodeId("");
    setSeedanceAssetNodeId("");
    setMaterialNodeId("");
  }, [selectedNode?.id]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height;
      if (height) setPanelHeight(Math.round(height));
    });
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let disposed = false;
    Promise.allSettled([fetchImageModels(), fetchAiModels(), getPreferences()])
      .then(([modelsResult, aiModelsResult, preferencesResult]) => {
        if (disposed) return;
        const preferredModel = preferencesResult.status === "fulfilled" ? preferencesResult.value.generation?.imageModel || "" : "";
        const preferredTextModel = preferencesResult.status === "fulfilled" ? preferencesResult.value.generation?.textModel || "" : "";
        const preferredVideoModel = preferencesResult.status === "fulfilled" ? preferencesResult.value.generation?.videoModel || "" : "";
        const preferredAudioModel = preferencesResult.status === "fulfilled" ? preferencesResult.value.generation?.audioModel || "" : "";
        if (preferencesResult.status === "fulfilled") {
          setPromptPresets(preferencesResult.value.canvas?.promptPresets || []);
          setWheelZoomRequiresCtrl(preferencesResult.value.canvas?.wheelZoomRequiresCtrl !== false);
          shortcutsRef.current = resolveCanvasShortcuts(preferencesResult.value.shortcuts);
        }
        if (modelsResult.status === "fulfilled") {
          const catalog = modelsResult.value;
          setModelCatalog(catalog);
          setImageModel((current) => current || (preferredModel && catalog.models.includes(preferredModel) ? preferredModel : catalog.defaultModel));
        } else {
          toast.error(publicApiError(modelsResult.reason, "读取图像模型失败"));
          if (preferredModel) setImageModel((current) => current || preferredModel);
        }
        if (aiModelsResult.status === "fulfilled") {
          const catalog = aiModelsResult.value;
          setTextModels(catalog.textModels);
          setVideoModels(catalog.videoModels);
          setAudioModels(catalog.audioModels);
          setTextModelLabels(catalog.modelLabels);
          setTextModel((current) => current || (preferredTextModel && catalog.textModels.includes(preferredTextModel)
            ? preferredTextModel
            : catalog.defaultTextModel));
          setVideoModel((current) => current || (preferredVideoModel && catalog.videoModels.includes(preferredVideoModel)
            ? preferredVideoModel
            : catalog.defaultVideoModel));
          setAudioModel((current) => current || (preferredAudioModel && catalog.audioModels.includes(preferredAudioModel)
            ? preferredAudioModel
            : catalog.defaultAudioModel));
        } else {
          toast.error(publicApiError(aiModelsResult.reason, "读取 AI 模型失败"));
          if (preferredTextModel) setTextModel((current) => current || preferredTextModel);
          if (preferredVideoModel) setVideoModel((current) => current || preferredVideoModel);
          if (preferredAudioModel) setAudioModel((current) => current || preferredAudioModel);
        }
      });
    return () => { disposed = true; };
  }, []);

  // 聊天台引导流程：项目切换时消费一次引导信息（步骤5的用户原文），无引导则收起覆盖层
  useEffect(() => {
    // 切换项目时先清掉上一个项目残留的交接内容，避免串项目误发
    setInitialPrompt("");
    if (!projectId) return;
    const prompt = consumeCanvasBootstrap(projectId);
    bootstrapPromptRef.current = prompt;
    if (!prompt) setBootstrapActive(false);
  }, [projectId]);

  useEffect(() => {
    const load = projectSessionController.startLoad(projectId, scope);
    return () => {
      load.cancel();
      abortAllGenerationRequests();
    };
  }, [abortAllGenerationRequests, projectId, projectSessionController, scope]);

  useEffect(() => {
    uploadingRef.current = uploading;
  }, [uploading]);

  useEffect(() => {
    if (editingInlineNodeId && !nodes.some((node) => node.id === editingInlineNodeId)) {
      setEditingInlineNodeId("");
    }
  }, [editingInlineNodeId, nodes]);

  useEffect(() => {
    return historyController.schedule(!loading);
  }, [backgroundMode, edges, groups, historyController, loading, nodes, showImageInfo]);

  useEffect(() => {
    setSelectedNodeIds((current) => {
      if (!selectedId) {
        if (!current.size) return current;
        const next = new Set<string>();
        return next;
      }
      if (current.has(selectedId)) return current;
      const next = new Set([selectedId]);
      return next;
    });
  }, [selectedId]);

  const persistProjectKey = projectSessionController.canonicalKey;
  const persistSnapshot = useCallback(async (
    nextNodes = nodesRef.current,
    nextEdges = edgesRef.current,
    nextZoom = viewportRef.current.zoom,
    options: { quiet?: boolean; panX?: number; panY?: number } = {},
  ): Promise<boolean> => autosaveController.persist({
    nodes: nextNodes,
    edges: nextEdges,
    groups: groupsRef.current,
    zoom: nextZoom,
    panX: options.panX ?? viewportRef.current.panX,
    panY: options.panY ?? viewportRef.current.panY,
    backgroundMode,
    showImageInfo,
  }, {
    quiet: options.quiet,
    expectedKey: persistProjectKey,
  }), [autosaveController, backgroundMode, persistProjectKey, showImageInfo]);

  generationController.updateBindings({
    getProjectId: () => projectId,
    getProjectTitle: () => projectTitle,
    getProjectKey: () => projectSessionController.canonicalKey,
    getScope: () => projectSessionController.canonicalScope,
    isSwitching: () => projectSessionController.switching,
    isLoading: () => loading,
    getNodes: () => nodesRef.current,
    setNodes: nextNodes => { nodesRef.current = nextNodes; setNodes(nextNodes); },
    getEdges: () => edgesRef.current,
    setEdges: nextEdges => { edgesRef.current = nextEdges; setEdges(nextEdges); },
    getSelectedNodeId: () => canvasStore.getState().graph.selectedNodeId,
    getSelectedNodeIds: () => selectedNodeIdsRef.current,
    getCanvasAssets: () => canvasAssets,
    mergeCanvasAssets: mergeCanvasAssetCatalog,
    getImageModel: () => imageModel,
    getTextModel: () => textModel,
    getVideoModel: () => videoModel,
    getAudioModel: () => audioModel,
    isPromptOptimizing: () => promptOptimizing,
    setPromptOptimizing,
    getViewportZoom: () => viewportRef.current.zoom,
    setRunningNodeIds,
    setJobProgressByNode,
    applyNodeSelection,
    persistSnapshot,
    executeGeneration: canvasCommands.services.generation,
    executeAssets: canvasCommands.services.assets,
    onMessage: message => toast(message),
    onSuccess: message => toast.success(message),
    onWarning: message => toast.warning(message),
    onError: message => toast.error(message),
  });

  useEffect(() => {
    runSelectedGenerationRef.current = runSelectedGeneration;
  }, [runSelectedGeneration]);

  useEffect(() => {
    recoverPendingJobs();
  }, [canonicalProjectScope, imageModel, loading, nodes, recoverPendingJobs, switching, videoModel]);

  useEffect(() => {
    return autosaveController.observe(
      Boolean(projectId && !loading && !switching && snapshotWriteReady),
      { nodes, edges, groups, zoom, panX, panY, backgroundMode, showImageInfo },
    );
  }, [autosaveController, backgroundMode, edges, groups, loading, nodes, panX, panY, projectId, showImageInfo, snapshotWriteReady, switching, zoom]);

  autosaveController.updateBindings({
    capture: captureCurrentSnapshot,
    saveSnapshot: (targetProjectId, snapshot, targetScope) => canvasCommands.services.project(
      () => saveProjectSnapshot(targetProjectId, snapshot, targetScope),
    ),
    formatError: publicApiError,
    isSwitching: () => projectSessionController.switching,
    onSessionPatch: patch => canvasCommands.commit({ session: patch }),
    onWarning: message => toast.warning(message),
    onSuccess: message => toast.success(message),
    onError: message => toast.error(message),
  });

  projectSessionController.updateBindings({
    getProject: (targetProjectId, targetScope) => canvasCommands.services.project(
      () => getProject(targetProjectId, targetScope),
    ),
    getSnapshot: (targetProjectId, targetScope) => canvasCommands.services.project(
      () => getProjectSnapshot(targetProjectId, targetScope),
    ),
    isNotFound: error => error instanceof ApiError && error.status === 404,
    formatError: publicApiError,
    createStarterNodes: starterNodes,
    isUploading: () => uploadingRef.current,
    onReset: targetProjectId => {
      abortAllGenerationRequests();
      stageInteractionController.prepareProjectReset();
      setSelectedGroupId("");
      setCanonicalProjectScope(null);
      setSnapshotWriteReady(false);
      setSyncStatus("loading");
      setSnapshotVersion(0);
      setSnapshotUpdatedAt("");
      setSyncError("");
      if (targetProjectId) {
        setLoading(true);
        setProjectTitle("");
        return;
      }
      canvasCommands.commit({
        graph: {
          nodes: [], edges: [], groups: [], selectedNodeIds: [], selectedNodeId: "",
          selectedGroupId: "", selectedEdgeId: "",
        },
        viewport: { backgroundMode: "lines", showImageInfo: false },
        session: { loading: false, projectTitle: "", switching: false },
        ui: { editingInlineNodeId: "", inspectorOpen: false },
      });
    },
    onProjectResolved: project => setProjectTitle(project.title),
    onSnapshotWarning: message => toast.warning(message),
    onLoaded: (result: CanvasProjectSessionLoaded) => {
      const firstVisibleNode = result.nodes.find(
        node => !isHiddenCanvasBatchChild(node, result.nodes),
      );
      viewportRef.current = result.viewport;
      canvasCommands.commit({
        graph: {
          nodes: result.nodes,
          edges: result.edges,
          groups: result.groups,
          selectedNodeIds: firstVisibleNode ? [firstVisibleNode.id] : [],
          selectedNodeId: firstVisibleNode?.id || "",
          selectedGroupId: "",
          selectedEdgeId: "",
        },
        viewport: {
          ...result.viewport,
          backgroundMode: result.backgroundMode,
          showImageInfo: result.showImageInfo,
        },
        ui: {
          editingInlineNodeId: "",
          inspectorOpen: Boolean(firstVisibleNode),
        },
      });
      stageInteractionController.resetConnectionAndPending();
      setCanonicalProjectScope(result.scope);
      setSnapshotWriteReady(result.writeReady);
      setSnapshotVersion(result.snapshotVersion);
      setSnapshotUpdatedAt(result.snapshotUpdatedAt);
      setSyncError(result.snapshotError);
      setSyncStatus(result.snapshotError || !result.writeReady ? "error" : "synced");
      // SOP 步骤 3-5：渲染节点后唤出 Agent，并交接聊天台原始输入。
      const pendingBootstrapPrompt = bootstrapPromptRef.current;
      if (pendingBootstrapPrompt) {
        bootstrapPromptRef.current = "";
        setInitialPrompt(pendingBootstrapPrompt);
        setAgentOpen(true);
      }
      setBootstrapActive(false);
    },
    onLoadError: message => {
      setSyncStatus("error");
      setSyncError(message);
      toast.error(message);
      bootstrapPromptRef.current = "";
      setBootstrapActive(false);
    },
    onSettled: () => {
      setLoading(false);
      setSwitching(false);
    },
    onRedirect: targetScope => {
      navigate(canvasProjectHref(projectId, targetScope), { replace: true });
    },
    onSwitchingChange: setSwitching,
    onLoadingChange: setLoading,
    onBeforeSwitch: () => {
      cancelActiveCanvasInteractions();
      setContextMenu(null);
      setInspectorOpen(false);
      setAgentOpen(false);
      abortAllGenerationRequests();
    },
    onWarning: message => toast.warning(message),
    onError: message => toast.error(message),
    navigate: href => navigate(href),
  });

  useEffect(() => () => {
    generationController.dispose();
    stageInteractionController.dispose();
    void projectSessionController.dispose();
  }, [generationController, projectSessionController, stageInteractionController]);

  const switchCanvasProject = useCallback(async (targetProjectId: string) => {
    const activeScope = projectSessionController.canonicalScope || scope;
    const targetProject = projects.find(project => project.id === targetProjectId);
    await projectSessionController.switchProject(
      targetProjectId,
      canvasProjectHref(
        targetProjectId,
        projectScopeFromServer(targetProject, activeScope),
      ),
    );
  }, [projectSessionController, projects, scope]);

  const switchCanvasScope = useCallback(async (targetScope: WorkspaceScope) => {
    await projectSessionController.switchScope(
      targetScope,
      canvasListHref(targetScope),
    );
  }, [projectSessionController]);

  const openCreateProjectDialog = () => {
    setCreateDialogTitle("未命名画布");
    setCreateDialogScope(scope);
    setCreateDialogError("");
    setCreateDialogOpen(true);
  };

  const submitCreateProject = async () => {
    const title = createDialogTitle.trim();
    if (!title) {
      setCreateDialogError("请输入画布名称");
      return;
    }
    if (createDialogBusy) return;
    setCreateDialogBusy(true);
    setCreateDialogError("");
    try {
      const initialNodes = starterNodes();
      const created = await createProject({ scope: createDialogScope, title, data: buildCanvasSnapshot({}, initialNodes, [], 90, 0, 0) });
      const createdScope = projectScopeFromServer(created, createDialogScope);
      setCreateDialogOpen(false);
      toast.success("画布已创建");
      navigate(canvasProjectHref(created.id, createdScope));
    } catch (error) {
      const message = publicApiError(error, "创建画布失败");
      setCreateDialogError(message);
      toast.error(message);
    } finally {
      setCreateDialogBusy(false);
    }
  };

  const removeCurrentProject = async () => {
    const activeScope = projectSessionController.canonicalScope;
    if (!projectId || !activeScope || deleteProjectBusy) return;
    setDeleteProjectBusy(true);
    setDeleteProjectError("");
    try {
      abortAllGenerationRequests();
      await deleteProject(projectId, activeScope);
      setProjects((items) => items.filter((project) => project.id !== projectId));
      setDeleteProjectOpen(false);
      toast.success("画布已删除");
      navigate(canvasListHref(activeScope));
    } catch (error) {
      const message = publicApiError(error, "删除画布失败");
      setDeleteProjectError(message);
      toast.error(message);
    } finally {
      setDeleteProjectBusy(false);
    }
  };

  const toggleProjectSelection = (targetProjectId: string, checked: boolean) => {
    setSelectedProjectIds((current) => {
      const next = new Set(current);
      if (checked) next.add(targetProjectId);
      else next.delete(targetProjectId);
      return next;
    });
  };

  const openProjectBatchDelete = (ids: Iterable<string>) => {
    const scopedIds = Array.from(new Set(ids)).filter((id) => projects.some((project) => project.id === id));
    if (!scopedIds.length) return;
    setProjectDeleteIds(scopedIds);
    setProjectDeleteError("");
  };

  const removeProjectBatch = async () => {
    if (!projectDeleteIds.length || projectBatchBusy) return;
    const requestedIds = [...projectDeleteIds];
    setProjectBatchBusy(true);
    setProjectDeleteError("");
    const results = await Promise.allSettled(requestedIds.map((id) => deleteProject(id, scope)));
    const deletedIds: string[] = [];
    const failedIds: string[] = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled" || (result.reason instanceof ApiError && result.reason.status === 404)) {
        deletedIds.push(requestedIds[index]);
      } else {
        failedIds.push(requestedIds[index]);
      }
    });
    if (deletedIds.length) {
      const deletedSet = new Set(deletedIds);
      setProjects((items) => items.filter((project) => !deletedSet.has(project.id)));
      setSelectedProjectIds((current) => new Set(Array.from(current).filter((id) => !deletedSet.has(id))));
    }
    if (failedIds.length) {
      setProjectDeleteIds(failedIds);
      setSelectedProjectIds(new Set(failedIds));
      const message = `已删除 ${deletedIds.length} 个画布，${failedIds.length} 个删除失败，请重试`;
      setProjectDeleteError(message);
      toast.error(message);
    } else {
      setProjectDeleteIds([]);
      toast.success(`已删除 ${deletedIds.length} 个画布`);
    }
    setProjectBatchBusy(false);
  };

  const buildCanvasNodeCandidate = (kind: CanvasNodeKind, position?: { x: number; y: number }, nodeCount = nodesRef.current.length): CanvasNodeData => {
    const normalizedKind = normalizeCanvasNodeKind(kind);
    const basePosition = position || { x: 160 + nodeCount * 34, y: 160 + nodeCount * 22 };
    return {
      id: crypto.randomUUID(),
      kind: normalizedKind,
      title: nodeKindTitle(normalizedKind),
      content: "",
      x: basePosition.x,
      y: basePosition.y,
      width: normalizedKind === "image" ? 300 : normalizedKind === "video" ? 420 : 300,
      height: normalizedKind === "audio" ? 120 : normalizedKind === "image" ? 220 : 170,
      metadata: {
        content: "",
        generationMode: defaultGenerationModeForKind(normalizedKind),
        model: normalizedKind === "video" ? videoModel : normalizedKind === "audio" ? audioModel : normalizedKind === "image" ? imageModel : normalizedKind === "text" ? textModel : undefined,
        status: "idle",
        size: "auto",
        resolution: "720p",
        seconds: "5",
        generateAudio: false,
        watermark: false,
        audioVoice: "alloy",
        audioFormat: "mp3",
        audioSpeed: "1",
        audioInstructions: "",
        quality: "auto",
        count: 1,
        ...(normalizedKind === "director" ? {
          directorInstanceId: `director-${crypto.randomUUID()}`,
          directorCanvasId: projectId,
          directorRevision: 0,
          directorOutputKeys: [],
          directorOutputNodeIds: [],
        } : {}),
      },
      };
  };

  const addNode = (kind: CanvasNodeKind, position?: { x: number; y: number }) => {
    const created = buildCanvasNodeCandidate(kind, position);
    const nextNodes = [...nodesRef.current, created];
    nodesRef.current = nextNodes;
    setNodes(nextNodes);
    applyNodeSelection([created.id], created.id, true);
    stageInteractionController.resetConnectionAndPending();
    setContextMenu(null);
    return created;
  };

  const openDirectorNode = async (source: CanvasNodeData) => {
    if (source.kind !== "director") return;
    const activeScope = projectSessionController.canonicalScope;
    if (!activeScope) return toast.warning("正在确认项目工作区，暂不能打开导演台");
    const instanceId = stringValue(source.metadata?.directorInstanceId) || `director-${crypto.randomUUID()}`;
    const nextNodes = nodesRef.current.map((node) => node.id === source.id ? {
      ...node,
      metadata: {
        ...node.metadata,
        directorInstanceId: instanceId,
        directorCanvasId: projectId,
        directorRevision: numberValue(node.metadata?.directorRevision) || 0,
        directorOutputKeys: Array.isArray(node.metadata?.directorOutputKeys) ? node.metadata.directorOutputKeys : [],
        directorOutputNodeIds: Array.isArray(node.metadata?.directorOutputNodeIds) ? node.metadata.directorOutputNodeIds : [],
      },
    } : node);
    nodesRef.current = nextNodes;
    setNodes(nextNodes);
    const saved = await persistSnapshot(nextNodes, edgesRef.current, viewportRef.current.zoom, { quiet: true });
    if (!saved) return;
    const returnTo = canvasProjectHref(projectId, activeScope);
    const query = new URLSearchParams({ instanceId, canvasId: projectId, nodeId: source.id, returnTo, scope: activeScope });
    navigate(`/director?${query.toString()}`);
  };

  const createNodeFromConnectionDraft = (kind: CanvasNodeKind, draft: PendingConnectionCreateState) => {
    const created = buildCanvasNodeCandidate(kind, { x: draft.canvasX, y: draft.canvasY });
    const graph = createConnectedCanvasGraph(
      nodesRef.current,
      edgesRef.current,
      created,
      draft.connection,
      () => crypto.randomUUID(),
    );
    if (!graph) {
      toast.warning("该连接不符合节点规则");
      stageInteractionController.resetConnectionAndPending();
      setContextMenu(null);
      return;
    }
    nodesRef.current = graph.nodes;
    edgesRef.current = graph.edges;
    setNodes(graph.nodes);
    setEdges(graph.edges);
    applyNodeSelection([created.id], created.id, true);
    stageInteractionController.resetConnectionAndPending();
    setContextMenu(null);
  };

  const updateNode = (id: string, patch: Partial<CanvasNodeData>) => {
    const nextNodes = nodesRef.current.map((node) => node.id === id ? { ...node, ...patch } : node);
    nodesRef.current = nextNodes;
    setNodes(nextNodes);
  };

  const updateNodePrompt = (id: string, content: string) => {
    const nextNodes = nodesRef.current.map((node) => node.id === id ? updateCanvasNodeComposer(node, content) : node);
    nodesRef.current = nextNodes;
    setNodes(nextNodes);
  };

  const updateNodeTextContent = (id: string, content: string) => {
    const nextNodes = nodesRef.current.map((node) => node.id === id ? updateCanvasTextDisplay(node, content) : node);
    nodesRef.current = nextNodes;
    setNodes(nextNodes);
  };

  const selectSeedanceMaterial = (asset: SeedanceMaterialAsset) => {
    if (!materialNodeId) return;
    const node = nodesRef.current.find((item) => item.id === materialNodeId);
    if (!node) return;
    const current = node.metadata?.seedanceMaterialAssets || [];
    updateNode(materialNodeId, {
      metadata: {
        ...node.metadata,
        seedanceMaterialAssets: [asset, ...current.filter((item) => item.id !== asset.id)],
      },
    });
  };

  const removeSeedanceMaterial = (assetId: string) => {
    if (!materialNodeId) return;
    const node = nodesRef.current.find((item) => item.id === materialNodeId);
    if (!node) return;
    updateNode(materialNodeId, {
      metadata: {
        ...node.metadata,
        seedanceMaterialAssets: (node.metadata?.seedanceMaterialAssets || []).filter((item) => item.id !== assetId),
      },
    });
  };

  const selectSeedanceVolcanoAsset = (asset: SeedanceAsset) => {
    if (!seedanceAssetNodeId) return;
    const node = nodesRef.current.find((item) => item.id === seedanceAssetNodeId);
    if (!node) return;
    const current = node.metadata?.seedanceVolcanoAssets || [];
    const selected = {
      id: asset.id,
      volcanoAssetId: asset.volcano_asset_id,
      name: asset.name,
      status: asset.status || "Active",
      assetType: asset.asset_type,
    };
    updateNode(seedanceAssetNodeId, {
      metadata: {
        ...node.metadata,
        seedanceVolcanoAssets: [selected, ...current.filter((item) => item.volcanoAssetId !== asset.volcano_asset_id)],
      },
    });
  };

  const removeSeedanceVolcanoAsset = (volcanoAssetId: string) => {
    if (!seedanceAssetNodeId) return;
    const node = nodesRef.current.find((item) => item.id === seedanceAssetNodeId);
    if (!node) return;
    updateNode(seedanceAssetNodeId, {
      metadata: {
        ...node.metadata,
        seedanceVolcanoAssets: (node.metadata?.seedanceVolcanoAssets || []).filter((item) => item.volcanoAssetId !== volcanoAssetId),
      },
    });
  };

  const openImageToolDialog = (nodeId: string, mode: CanvasImageToolMode = "crop") => {
    setImageToolDialog({ nodeId, mode });
    setImageToolDraft({ ...defaultCanvasImageToolDraft });
    setImageCropLocked(false);
    setImageToolError("");
    applyNodeSelection([nodeId], nodeId, true);
  };

  const startImageCropPointer = (
    event: PointerEvent<HTMLDivElement | HTMLButtonElement>,
    mode: "move" | "resize",
    handle: ImageCropResizeHandle = "se",
  ) => {
    const box = imageCropStageRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0 || box.height <= 0 || imageToolBusy) return;
    event.preventDefault();
    event.stopPropagation();
    const start = {
      clientX: event.clientX,
      clientY: event.clientY,
      crop: imageCropRectFromDraft(imageToolDraft),
    };
    const move = (pointer: globalThis.PointerEvent) => {
      const dx = (pointer.clientX - start.clientX) / box.width;
      const dy = (pointer.clientY - start.clientY) / box.height;
      const crop = mode === "move"
        ? moveImageCropRect(start.crop, dx, dy)
        : resizeImageCropRect(start.crop, dx, dy, handle, imageCropLocked, box);
      setImageToolDraft((draft) => ({ ...draft, ...imageToolDraftFromCropRect(crop) }));
    };
    const finish = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", finish);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", finish);
  };

  const imageSourceForNode = async (node: CanvasNodeData) => {
    const activeScope = projectSessionController.canonicalScope;
    if (!activeScope) throw new Error("正在确认项目工作区，暂不能处理图片");
    const assetId = assetIdFromNode(node);
    const sourceScope = workspaceScopeValue(node.metadata?.assetScope) || activeScope;
    let url = assetId
      ? await getAssetContentObjectUrl(assetId, sourceScope)
      : node.imageSrc || stringValue(node.metadata?.content);
    if (!url || (!url.startsWith("data:image/") && !url.startsWith("blob:") && !/^https?:\/\//i.test(url))) {
      throw new Error("当前图片没有可读取的原图内容");
    }
    if (/^https?:\/\//i.test(url)) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`读取图片失败（${response.status}）`);
      url = URL.createObjectURL(await response.blob());
    }
    return {
      url,
      cleanup: () => {
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      },
    };
  };

  const uploadCanvasImageDataUrl = async (
    source: CanvasNodeData,
    dataUrl: string,
    title: string,
    relation: string,
    expectedProjectKey = projectSessionController.canonicalKey,
    expectedScope = projectSessionController.canonicalScope,
  ) => {
    const activeScope = expectedScope;
    if (!activeScope || !expectedProjectKey || projectSessionController.switching || projectSessionController.canonicalKey !== expectedProjectKey) {
      throw new DOMException("Aborted", "AbortError");
    }
    const response = await fetch(dataUrl);
    if (!response.ok) throw new Error(`读取处理结果失败（${response.status}）`);
    const blob = await response.blob();
    const contentType = blob.type.startsWith("image/") ? blob.type : "image/png";
    const file = new File([blob], imageFileName(title, contentType), { type: contentType });
    const asset = await uploadAsset(file, {
      type: "image",
      name: file.name,
      category: "other",
      source_type: "canvas",
      source_project_id: projectId,
      source_project_name: projectTitle,
      source_metadata: JSON.stringify({ canvas_node_id: source.id, relation }),
    }, activeScope);
    if (projectSessionController.switching || projectSessionController.canonicalKey !== expectedProjectKey) {
      throw new DOMException("Aborted", "AbortError");
    }
    return { asset, contentType, bytes: blob.size, scope: activeScope };
  };

  const persistCanvasImageToolResults = async (
    source: CanvasNodeData,
    results: Array<{
      dataUrl: string;
      title: string;
      relation: string;
      width?: number;
      height?: number;
      row?: number;
      column?: number;
      metadata?: Record<string, unknown>;
    }>,
  ) => {
    const projectKey = projectSessionController.canonicalKey;
    const activeScope = projectSessionController.canonicalScope;
    if (!projectKey || !activeScope || projectSessionController.switching) return;
    const created: CanvasNodeData[] = [];
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      if (projectSessionController.switching || projectSessionController.canonicalKey !== projectKey) throw new DOMException("Aborted", "AbortError");
      const archived = await uploadCanvasImageDataUrl(source, result.dataUrl, result.title, result.relation, projectKey, activeScope);
      if (projectSessionController.canonicalKey !== projectKey) return;
      const prompt = stringValue(source.metadata?.prompt) || source.content;
      created.push({
        id: crypto.randomUUID(),
        kind: "image",
        title: archived.asset.name || result.title,
        content: prompt,
        x: source.x + source.width + 96 + (result.column || 0) * ((result.width || source.width) + 16),
        y: source.y + (result.row ?? index) * ((result.height || source.height) + 16),
        width: result.width || source.width,
        height: result.height || source.height,
        imageAssetId: archived.asset.id,
        metadata: {
          content: prompt,
          prompt,
          status: "success",
          generationMode: "image",
          generationType: "edit",
          sourceNodeId: source.id,
          assetId: archived.asset.id,
          assetScope: archived.scope,
          mimeType: archived.asset.content_type || archived.contentType,
          bytes: archived.asset.size || archived.bytes,
          editRelation: result.relation,
          ...(result.metadata || {}),
        },
      });
    }
    if (projectSessionController.switching || projectSessionController.canonicalKey !== projectKey) throw new DOMException("Aborted", "AbortError");
    if (!created.length) return;
    const nextNodes = [...nodesRef.current, ...created];
    const nextEdges = created.reduce(
      (current, node) => addCanvasConnection(current, { from: source.id, to: node.id }, () => crypto.randomUUID()),
      edgesRef.current,
    );
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    setNodes(nextNodes);
    setEdges(nextEdges);
    applyNodeSelection(created.map((node) => node.id), created[0].id, true);
    const saved = await persistSnapshot(nextNodes, nextEdges, viewportRef.current.zoom, { quiet: true });
    if (!saved || projectSessionController.switching || projectSessionController.canonicalKey !== projectKey) throw new DOMException("Aborted", "AbortError");
  };

  const flipCanvasImageNode = async (node: CanvasNodeData, direction: "horizontal" | "vertical") => {
    if (imageToolBusy) return;
    const projectKey = projectSessionController.canonicalKey;
    const activeScope = projectSessionController.canonicalScope;
    if (!projectKey || !activeScope || projectSessionController.switching) return;
    setImageToolBusy(true);
    setImageToolError("");
    let source: Awaited<ReturnType<typeof imageSourceForNode>> | null = null;
    try {
      source = await imageSourceForNode(node);
      const dataUrl = await flipDataUrl(source.url, direction);
      const relation = direction === "horizontal" ? "flip-horizontal" : "flip-vertical";
      const archived = await uploadCanvasImageDataUrl(node, dataUrl, `${node.title}-${direction === "horizontal" ? "水平翻转" : "垂直翻转"}`, relation, projectKey, activeScope);
      if (projectSessionController.canonicalKey !== projectKey) return;
      const nextNodes = nodesRef.current.map((item) => item.id === node.id ? {
        ...item,
        title: archived.asset.name || item.title,
        imageAssetId: archived.asset.id,
        imageSrc: undefined,
        metadata: {
          ...item.metadata,
          assetId: archived.asset.id,
          assetScope: archived.scope,
          mimeType: archived.asset.content_type || archived.contentType,
          bytes: archived.asset.size || archived.bytes,
          editRelation: relation,
        },
      } : item);
      nodesRef.current = nextNodes;
      setNodes(nextNodes);
      const saved = await persistSnapshot(nextNodes, edgesRef.current, viewportRef.current.zoom, { quiet: true });
      if (!saved || projectSessionController.switching || projectSessionController.canonicalKey !== projectKey) throw new DOMException("Aborted", "AbortError");
      toast.success(direction === "horizontal" ? "图片已水平翻转" : "图片已垂直翻转");
    } catch (error) {
      if (isAbortError(error)) return;
      toast.error(publicApiError(error, "翻转图片失败"));
    } finally {
      source?.cleanup();
      setImageToolBusy(false);
    }
  };

  const runCanvasImageTool = async () => {
    if (!imageToolDialog || imageToolBusy) return;
    const sourceNode = nodesRef.current.find((node) => node.id === imageToolDialog.nodeId);
    if (!sourceNode || sourceNode.kind !== "image") {
      setImageToolError("图片节点已不存在");
      return;
    }
    setImageToolBusy(true);
    setImageToolError("");
    let source: Awaited<ReturnType<typeof imageSourceForNode>> | null = null;
    try {
      source = await imageSourceForNode(sourceNode);
      const mode = imageToolDialog.mode;
      let results: Array<{
        dataUrl: string;
        title: string;
        relation: string;
        width?: number;
        height?: number;
        row?: number;
        column?: number;
        metadata?: Record<string, unknown>;
      }> = [];
      if (mode === "crop" || mode === "focus") {
        const x = clamp(imageToolDraft.cropX / 100, 0, 0.99);
        const y = clamp(imageToolDraft.cropY / 100, 0, 0.99);
        const dataUrl = await cropDataUrl(source.url, {
          x,
          y,
          width: clamp(imageToolDraft.cropWidth / 100, 0.01, 1 - x),
          height: clamp(imageToolDraft.cropHeight / 100, 0.01, 1 - y),
        });
        results = [{
          dataUrl,
          title: `${sourceNode.title}-${mode === "focus" ? "聚焦提取" : "裁剪"}`,
          relation: mode === "focus" ? "focus" : "crop",
          width: Math.max(120, sourceNode.width * clamp(imageToolDraft.cropWidth / 100, 0.01, 1 - x)),
          height: Math.max(90, sourceNode.height * clamp(imageToolDraft.cropHeight / 100, 0.01, 1 - y)),
        }];
      }
      if (mode === "split") {
        const rows = clamp(Math.round(imageToolDraft.splitRows), 1, 6);
        const columns = clamp(Math.round(imageToolDraft.splitColumns), 1, 6);
        const pieces = await splitDataUrl(source.url, {
          rows,
          columns,
        });
        results = pieces.map((piece) => ({
          dataUrl: piece.dataUrl,
          title: `${sourceNode.title}-${piece.row + 1}-${piece.column + 1}`,
          relation: "split",
          width: sourceNode.width / columns,
          height: sourceNode.height / rows,
          row: piece.row,
          column: piece.column,
        }));
      }
      if (mode === "upscale") {
        const sourceSize = await readCanvasImageSize(source.url);
        if (Math.max(sourceSize.width, sourceSize.height) >= imageToolDraft.upscaleLongEdge) {
          throw new Error(`原图长边已达到 ${Math.max(sourceSize.width, sourceSize.height)} px，请选择更大的目标尺寸`);
        }
        const dataUrl = await upscaleDataUrl(source.url, {
          targetLongEdge: imageToolDraft.upscaleLongEdge,
          algorithm: imageToolDraft.upscaleAlgorithm,
        });
        results = [{ dataUrl, title: `${sourceNode.title}-放大`, relation: "upscale" }];
      }
      if (mode === "compress") {
        const compressed = await compressDataUrl(source.url, {
          format: imageToolDraft.compressionFormat,
          quality: imageToolDraft.compressionQuality / 100,
          maxDimension: imageToolDraft.compressionMaxDimension,
          targetBytes: imageToolDraft.compressionTargetKb > 0 ? imageToolDraft.compressionTargetKb * 1024 : undefined,
        });
        results = [{
          dataUrl: compressed.dataUrl,
          title: `${sourceNode.title}-压缩`,
          relation: "compress",
          metadata: {
            compressionSourceBytes: compressed.sourceBytes,
            compressionTargetBytes: imageToolDraft.compressionTargetKb > 0 ? imageToolDraft.compressionTargetKb * 1024 : undefined,
            compressionQuality: compressed.quality,
            compressionMaxDimension: imageToolDraft.compressionMaxDimension,
            compressionFormat: compressed.format,
          },
        }];
      }
      if (mode === "outpaint") {
        const margins = {
          top: clamp(imageToolDraft.outpaintTop / 100, 0, 0.75),
          right: clamp(imageToolDraft.outpaintRight / 100, 0, 0.75),
          bottom: clamp(imageToolDraft.outpaintBottom / 100, 0, 0.75),
          left: clamp(imageToolDraft.outpaintLeft / 100, 0, 0.75),
        };
        const sourceDataUrl = await createOutpaintSourceDataUrl(source.url, margins);
        const maskDataUrl = await createOutpaintMaskDataUrl(source.url, margins);
        const width = sourceNode.width * (1 + margins.left + margins.right);
        const height = sourceNode.height * (1 + margins.top + margins.bottom);
        await createAiEditedImageNode(sourceNode, {
          prompt: imageToolDraft.outpaintPrompt.trim() || "延展画面边缘，保持主体、光线、材质和画风一致",
          title: "扩图生成中…",
          relation: "outpaint",
          sourceDataUrl,
          maskDataUrl,
          size: "auto",
          width,
          height,
        });
      } else if (mode === "angle") {
        await createAiEditedImageNode(sourceNode, {
          prompt: canvasAnglePrompt(imageToolDraft),
          title: "多角度生成中…",
          relation: "angle",
        });
      } else {
        await persistCanvasImageToolResults(sourceNode, results);
      }
      setImageToolDialog(null);
      if (mode !== "outpaint" && mode !== "angle") toast.success(`图片${canvasImageToolLabel(mode)}完成`);
    } catch (error) {
      if (isAbortError(error)) return;
      setImageToolError(publicApiError(error, "图片处理失败"));
    } finally {
      source?.cleanup();
      setImageToolBusy(false);
    }
  };

  const canvasImageFile = async (dataUrl: string, title: string) => {
    const response = await fetch(dataUrl);
    if (!response.ok) throw new Error(`读取图片失败（${response.status}）`);
    const blob = await response.blob();
    const contentType = blob.type.startsWith("image/") ? blob.type : "image/png";
    return new File([blob], imageFileName(title, contentType), { type: contentType });
  };

  const createAiEditedImageNode = async (
    sourceNode: CanvasNodeData,
    options: {
      prompt: string;
      title: string;
      relation: string;
      size?: ImageSizeValue;
      sourceDataUrl?: string;
      maskDataUrl?: string;
      width?: number;
      height?: number;
    },
  ) => {
    const activeScope = projectSessionController.canonicalScope;
    const projectKey = projectSessionController.canonicalKey;
    if (!activeScope || !projectKey || projectSessionController.switching) throw new Error("正在确认项目工作区，暂不能编辑图片");
    const model = modelFromNode(sourceNode, imageModel);
    if (!model) throw new Error("当前没有可用图片模型");
    let source: Awaited<ReturnType<typeof imageSourceForNode>> | null = null;
    try {
      const sourceDataUrl = options.sourceDataUrl || (source = await imageSourceForNode(sourceNode)).url;
      const referenceFile = await canvasImageFile(sourceDataUrl, `${sourceNode.title}-reference`);
      const maskFile = options.maskDataUrl ? await canvasImageFile(options.maskDataUrl, `${sourceNode.title}-mask`) : undefined;
      if (projectSessionController.switching || projectSessionController.canonicalKey !== projectKey) throw new DOMException("Aborted", "AbortError");
      const targetNodeId = crypto.randomUUID();
      const prompt = options.prompt.trim();
      const targetNode: CanvasNodeData = {
        id: targetNodeId,
        kind: "image",
        title: options.title,
        content: prompt,
        x: sourceNode.x + sourceNode.width + 96,
        y: sourceNode.y + 24,
        width: options.width || sourceNode.width,
        height: options.height || sourceNode.height,
        metadata: {
          content: prompt,
          prompt,
          status: "loading",
          generationMode: "image",
          generationType: "edit",
          sourceNodeId: sourceNode.id,
          model,
          size: options.size || toImageSizeValue(sizeFromNode(sourceNode)),
          quality: qualityFromNode(sourceNode),
          editRelation: options.relation,
          referenceInputs: assetIdFromNode(sourceNode) ? [{
            nodeId: sourceNode.id,
            title: sourceNode.title,
            assetId: assetIdFromNode(sourceNode),
            name: sourceNode.title,
            contentType: stringValue(sourceNode.metadata?.mimeType) || "image/png",
          }] : undefined,
        },
      };
      const nextNodes = [...nodesRef.current, targetNode];
      const nextEdges = addCanvasConnection(edgesRef.current, { from: sourceNode.id, to: targetNodeId }, () => crypto.randomUUID());
      nodesRef.current = nextNodes;
      edgesRef.current = nextEdges;
      setNodes(nextNodes);
      setEdges(nextEdges);
      applyNodeSelection([targetNodeId], targetNodeId, true);
      const saved = await persistSnapshot(nextNodes, nextEdges, viewportRef.current.zoom, { quiet: true });
      if (!saved || projectSessionController.switching || projectSessionController.canonicalKey !== projectKey) throw new DOMException("Aborted", "AbortError");
      return runImageTarget({
        targetNodeId,
        originNodeId: sourceNode.id,
        runningNodeId: targetNodeId,
        projectKey,
        scope: activeScope,
        prompt,
        model,
        size: options.size || toImageSizeValue(sizeFromNode(sourceNode)),
        quality: qualityFromNode(sourceNode),
        referenceFiles: [referenceFile],
        maskFile,
      });
    } finally {
      source?.cleanup();
    }
  };

  const maskEditCanvasImage = async (payload: CanvasImageMaskPayload) => {
    const sourceNode = nodesRef.current.find((node) => node.id === imageMaskNodeId);
    if (!sourceNode || imageToolBusy) return;
    setImageToolBusy(true);
    setImageToolError("");
    try {
      setImageMaskNodeId("");
      await createAiEditedImageNode(sourceNode, {
        prompt: `只修改蒙版透明区域，其他区域保持不变。${payload.prompt}`,
        title: "局部编辑结果",
        relation: "mask-edit",
        maskDataUrl: payload.maskDataUrl,
      });
    } catch (error) {
      if (isAbortError(error)) return;
      setImageToolError(publicApiError(error, "局部修改失败"));
      setImageMaskNodeId(sourceNode.id);
    } finally {
      setImageToolBusy(false);
    }
  };

  const annotateCanvasImage = async (payload: CanvasImageAnnotationPayload) => {
    const sourceNode = nodesRef.current.find((node) => node.id === imageAnnotationNodeId);
    if (!sourceNode || sourceNode.kind !== "image") throw new Error("图片节点已不存在");
    if (imageToolBusy) throw new Error("另一个图片处理任务仍在进行");
    setImageToolBusy(true);
    try {
      await persistCanvasImageToolResults(sourceNode, [{
        dataUrl: payload.dataUrl,
        title: `${sourceNode.title}-标注`,
        relation: "annotation",
        width: sourceNode.width,
        height: sourceNode.height,
        metadata: { annotation: true },
      }]);
      setImageAnnotationNodeId("");
      toast.success("标注图片已保存为子节点");
    } catch (error) {
      if (!isAbortError(error)) throw error;
    } finally {
      setImageToolBusy(false);
    }
  };

  const generatePanoramaCanvasImage = async (sourceNode: CanvasNodeData) => {
    if (imageToolBusy) return;
    setImageToolBusy(true);
    try {
      await createAiEditedImageNode(sourceNode, {
        prompt: `基于参考图生成一张 2:1 超宽全景图，延展为连贯场景，保持原图主体、光线、色彩和画风一致。${stringValue(sourceNode.metadata?.prompt) ? `\n\n原提示词：${stringValue(sourceNode.metadata?.prompt)}` : ""}`,
        title: "全景图生成中…",
        relation: "panorama",
        size: "2:1",
        width: Math.max(sourceNode.width, 420),
        height: Math.max(180, Math.round(Math.max(sourceNode.width, 420) / 2)),
      });
    } catch (error) {
      if (isAbortError(error)) return;
      toast.error(publicApiError(error, "全景图生成失败"));
    } finally {
      setImageToolBusy(false);
    }
  };

  const createImageReversePromptNodes = async (sourceNode: CanvasNodeData) => {
    if (sourceNode.kind !== "image") return;
    const instruction = buildCanvasNodeCandidate("text", {
      x: sourceNode.x + sourceNode.width + 96,
      y: sourceNode.y,
    });
    instruction.title = "反推提示词";
    instruction.content = IMAGE_PROMPT_REVERSE_PRESET;
    instruction.metadata = {
      ...instruction.metadata,
      content: IMAGE_PROMPT_REVERSE_PRESET,
      prompt: IMAGE_PROMPT_REVERSE_PRESET,
      composerContent: IMAGE_PROMPT_REVERSE_PRESET,
      generationMode: "text",
      model: textModel,
      status: "success",
    };
    const config = buildCanvasNodeCandidate("config", {
      x: instruction.x + instruction.width + 96,
      y: sourceNode.y,
    }, nodesRef.current.length + 1);
    config.title = "反推提示词配置";
    config.content = "";
    config.metadata = {
      ...config.metadata,
      content: "",
      prompt: "",
      composerContent: `参考图片：@[node:${sourceNode.id}]\n任务说明：@[node:${instruction.id}]`,
      generationMode: "text",
      model: textModel,
      status: "idle",
    };
    const nextNodes = [...nodesRef.current, instruction, config];
    let nextEdges = addCanvasConnection(edgesRef.current, { from: sourceNode.id, to: config.id }, () => crypto.randomUUID());
    nextEdges = addCanvasConnection(nextEdges, { from: instruction.id, to: config.id }, () => crypto.randomUUID());
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    setNodes(nextNodes);
    setEdges(nextEdges);
    applyNodeSelection([config.id], config.id, true);
    await persistSnapshot(nextNodes, nextEdges, viewportRef.current.zoom, { quiet: true });
    toast.success("已创建反推提示词配置节点");
  };

  const exportCanvasStoryboard = async () => {
    const source = nodesRef.current.find((node) => node.id === storyboardNodeId);
    if (!source || storyboardBusy) return;
    const selectedImageNodes = nodesRef.current.filter((node) => selectedNodeIdsRef.current.has(node.id) && node.kind === "image" && Boolean(imageSrcFromNode(node, previews)));
    const frameNodes = (selectedImageNodes.length ? selectedImageNodes : [source]).slice(0, storyboardLayout === "grid-3x3" ? 9 : storyboardLayout === "grid-2x2" ? 4 : 6);
    const loaded: Array<{ cleanup: () => void }> = [];
    setStoryboardBusy(true);
    try {
      const frames = [];
      for (const node of frameNodes) {
        const image = await imageSourceForNode(node);
        loaded.push(image);
        frames.push({
          dataUrl: image.url,
          title: node.title,
          note: stringValue(node.metadata?.prompt),
        });
      }
      const dataUrl = await composeStoryboardDataUrl(frames, storyboardLayout);
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      downloadBlob(blob, `storyboard-${Date.now()}.png`);
      setStoryboardNodeId("");
      toast.success(`已导出 ${frames.length} 格故事板`);
    } catch (error) {
      toast.error(publicApiError(error, "故事板导出失败"));
    } finally {
      loaded.forEach((item) => item.cleanup());
      setStoryboardBusy(false);
    }
  };

  const archiveCanvasMediaNode = async (sourceNode: CanvasNodeData) => {
    if (sourceNode.kind !== "image" && sourceNode.kind !== "video" && sourceNode.kind !== "audio") return;
    const activeScope = projectSessionController.canonicalScope;
    if (!activeScope) return toast.warning("正在确认项目工作区，暂不能归档素材");
    const kind = mediaKindFromNode(sourceNode);
    const existingAssetId = assetIdFromNode(sourceNode);
    const sourceScope = workspaceScopeValue(sourceNode.metadata?.assetScope) || activeScope;
    if (existingAssetId && sourceScope === activeScope) {
      toast.success(`该${mediaKindLabel(kind)}已经归档到当前素材库`);
      return;
    }
    let objectUrl = "";
    try {
      const source = existingAssetId
        ? (objectUrl = await getAssetContentObjectUrl(existingAssetId, sourceScope))
        : sourceNode.imageSrc || stringValue(sourceNode.metadata?.content);
      if (!isReadableMediaSource(source)) throw new Error(`当前${mediaKindLabel(kind)}没有可读取的原始内容`);
      const response = await fetch(source);
      if (!response.ok) throw new Error(`读取${mediaKindLabel(kind)}失败（${response.status}）`);
      const blob = await response.blob();
      const contentType = blob.type || stringValue(sourceNode.metadata?.mimeType) || defaultMediaMimeType(kind);
      const fileName = mediaFileName(sourceNode.title, kind, contentType);
      const asset = await uploadAsset(new File([blob], fileName, { type: contentType }), {
        type: kind,
        name: fileName,
        category: "other",
        source_type: "canvas",
        source_project_id: projectId,
        source_project_name: projectTitle,
        source_metadata: JSON.stringify({ canvas_node_id: sourceNode.id, relation: existingAssetId ? "cross_scope_copy" : "archive" }),
      }, activeScope);
      const nextNodes: CanvasNodeData[] = nodesRef.current.map((node) => node.id === sourceNode.id ? {
        ...node,
        imageAssetId: kind === "image" ? asset.id : undefined,
        imageSrc: undefined,
        metadata: {
          ...node.metadata,
          assetId: asset.id,
          assetScope: activeScope,
          mimeType: asset.content_type || contentType,
          bytes: asset.size || blob.size,
        },
      } : node);
      nodesRef.current = nextNodes;
      setNodes(nextNodes);
      await persistSnapshot(nextNodes, edgesRef.current, viewportRef.current.zoom, { quiet: true });
      toast.success(`${mediaKindLabel(kind)}已加入${activeScope === "team" ? "团队" : "个人"}素材库`);
    } catch (error) {
      toast.error(publicApiError(error, `${mediaKindLabel(kind)}归档失败`));
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  };

  const archiveCanvasTextNode = async (sourceNode: CanvasNodeData) => {
    if (sourceNode.kind !== "text") return;
    const activeScope = projectSessionController.canonicalScope;
    if (!activeScope) return toast.warning("正在确认项目工作区，暂不能归档文本");
    if (!user?.id) return toast.error("当前登录用户不可用，无法保存文本资产");
    const content = canvasTextDisplayValue(sourceNode).trim();
    if (!content) return toast.error("没有可保存的文本");
    try {
      const saved = await saveCanvasTextAsset({
        userId: user.id,
        scope: activeScope,
        title: stringValue(sourceNode.metadata?.prompt).slice(0, 24) || sourceNode.title || "画布文本",
        content,
      });
      const nextNodes = nodesRef.current.map((node) => node.id === sourceNode.id ? {
        ...node,
        metadata: {
          ...node.metadata,
          textAssetId: saved.id,
          textAssetScope: activeScope,
        },
      } : node);
      nodesRef.current = nextNodes;
      setNodes(nextNodes);
      await persistSnapshot(nextNodes, edgesRef.current, viewportRef.current.zoom, { quiet: true });
      toast.success(`文本已加入${activeScope === "team" ? "团队" : "个人"}素材库`);
    } catch (error) {
      toast.error(publicApiError(error, "文本归档失败"));
    }
  };

  const captureVideoFrameNode = async (sourceNode: CanvasNodeData) => {
    if (sourceNode.kind !== "video" || captureFrameNodeId) return;
    const activeScope = projectSessionController.canonicalScope;
    const projectKey = projectSessionController.canonicalKey;
    if (!activeScope || !projectKey) return toast.warning("正在确认项目工作区，暂不能截取视频帧");
    const host = Array.from(stageRef.current?.querySelectorAll<HTMLElement>("[data-node-id]") || [])
      .find((element) => element.dataset.nodeId === sourceNode.id);
    const video = host?.querySelector("video");
    const width = Math.max(1, Math.round(video?.videoWidth || 0));
    const height = Math.max(1, Math.round(video?.videoHeight || 0));
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || width <= 1 || height <= 1) {
      toast.warning("视频尚未加载到可截图状态");
      return;
    }

    setCaptureFrameNodeId(sourceNode.id);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("浏览器无法创建视频截图画布");
      context.drawImage(video, 0, 0, width, height);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error("视频帧编码失败")), "image/png");
      });
      const captureTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      const fileName = imageFileName(`${sourceNode.title}-frame-${captureTime.toFixed(2)}s`, "image/png");
      const asset = await uploadAsset(new File([blob], fileName, { type: "image/png" }), {
        type: "image",
        name: fileName,
        category: "other",
        source_type: "canvas",
        source_project_id: projectId,
        source_project_name: projectTitle,
        source_metadata: JSON.stringify({ canvas_node_id: sourceNode.id, relation: "video_frame", capture_time_seconds: captureTime }),
      }, activeScope);
      if (projectSessionController.canonicalKey !== projectKey) return;
      const scale = Math.min(1, sourceNode.width / width, sourceNode.height / height);
      const childId = crypto.randomUUID();
      const child: CanvasNodeData = {
        id: childId,
        kind: "image",
        title: `${sourceNode.title} 当前帧`,
        content: stringValue(sourceNode.metadata?.prompt) || sourceNode.content,
        x: sourceNode.x + sourceNode.width + 96,
        y: sourceNode.y,
        width: Math.max(1, width * scale),
        height: Math.max(1, height * scale),
        imageAssetId: asset.id,
        metadata: {
          assetId: asset.id,
          assetScope: activeScope,
          mimeType: asset.content_type || "image/png",
          bytes: asset.size || blob.size,
          naturalWidth: width,
          naturalHeight: height,
          prompt: stringValue(sourceNode.metadata?.prompt),
          generationMode: "image",
          status: "success",
          sourceNodeId: sourceNode.id,
          editRelation: "video-frame",
          captureTimeSeconds: captureTime,
        },
      };
      const nextNodes = [...nodesRef.current, child];
      const nextEdges = addCanvasConnection(edgesRef.current, { from: sourceNode.id, to: childId }, () => crypto.randomUUID());
      nodesRef.current = nextNodes;
      edgesRef.current = nextEdges;
      setNodes(nextNodes);
      setEdges(nextEdges);
      applyNodeSelection([childId], childId, true);
      await persistSnapshot(nextNodes, nextEdges, viewportRef.current.zoom, { quiet: true });
      toast.success("已从视频当前帧创建图片节点");
    } catch (error) {
      toast.error(publicApiError(error, "视频截图失败：当前视频源不允许读取像素或尚未加载完成"));
    } finally {
      setCaptureFrameNodeId("");
    }
  };

  const uploadMediaToNode = async (nodeId: string, file: File | undefined, kind: "video" | "audio") => {
    const sourceNode = nodesRef.current.find((node) => node.id === nodeId);
    const expected = kind === "video" ? "video/" : "audio/";
    if (!sourceNode || !file || !file.type.startsWith(expected)) return;
    const activeScope = projectSessionController.canonicalScope;
    if (!activeScope) return toast.warning("正在确认项目工作区，暂不能上传媒体");
    try {
      const asset = await uploadAsset(file, {
        type: kind,
        name: file.name,
        category: "reference",
        source_type: "canvas",
        source_project_id: projectId,
        source_project_name: projectTitle,
        source_metadata: JSON.stringify({ canvas_node_id: sourceNode.id, relation: "upload" }),
      }, activeScope);
      const nextNodes = nodesRef.current.map((node) => node.id === sourceNode.id ? {
        ...node,
        title: asset.name || file.name,
        imageAssetId: asset.id,
        imageSrc: undefined,
        metadata: {
          ...node.metadata,
          assetId: asset.id,
          assetScope: activeScope,
          mimeType: asset.content_type || file.type,
          bytes: asset.size || file.size,
          status: "success" as const,
        },
      } : node);
      nodesRef.current = nextNodes;
      setNodes(nextNodes);
      await persistSnapshot(nextNodes, edgesRef.current, viewportRef.current.zoom, { quiet: true });
      toast.success(kind === "video" ? "视频已上传到节点" : "音频已上传到节点");
    } catch (error) {
      toast.error(publicApiError(error, "上传媒体失败"));
    } finally {
      if (replaceMediaInputRef.current) replaceMediaInputRef.current.value = "";
    }
  };

  const replaceCanvasImage = async (file: File | undefined) => {
    const sourceNode = nodesRef.current.find((node) => node.id === replaceImageNodeId);
    setReplaceImageNodeId("");
    if (!sourceNode || !file || !file.type.startsWith("image/")) return;
    const activeScope = projectSessionController.canonicalScope;
    if (!activeScope) return toast.warning("正在确认项目工作区，暂不能替换图片");
    try {
      const asset = await uploadAsset(file, {
        type: "image",
        name: file.name,
        category: "reference",
        source_type: "canvas",
        source_project_id: projectId,
        source_project_name: projectTitle,
        source_metadata: JSON.stringify({ canvas_node_id: sourceNode.id, relation: "replace" }),
      }, activeScope);
      const nextNodes = nodesRef.current.map((node) => node.id === sourceNode.id ? {
        ...node,
        title: asset.name || file.name,
        imageAssetId: asset.id,
        imageSrc: undefined,
        metadata: {
          ...node.metadata,
          assetId: asset.id,
          assetScope: activeScope,
          mimeType: asset.content_type || file.type,
          bytes: asset.size || file.size,
          editRelation: "replace",
          status: "success" as const,
        },
      } : node);
      nodesRef.current = nextNodes;
      setNodes(nextNodes);
      await persistSnapshot(nextNodes, edgesRef.current, viewportRef.current.zoom, { quiet: true });
      toast.success("图片已替换");
    } catch (error) {
      toast.error(publicApiError(error, "替换图片失败"));
    } finally {
      if (replaceImageInputRef.current) replaceImageInputRef.current.value = "";
    }
  };

  const copyCanvasImagePrompt = async (sourceNode: CanvasNodeData) => {
    const prompt = stringValue(sourceNode.metadata?.prompt) || sourceNode.content;
    if (!prompt.trim()) return toast.info("当前图片没有可复制的提示词");
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success("提示词已复制");
    } catch {
      toast.error("浏览器未允许写入剪贴板");
    }
  };

  const updateCanvasGroup = (groupId: string, patch: Partial<Pick<CanvasGroupData, "title" | "color">>) => {
    const nextGroups = groupsRef.current.map((group) => group.id === groupId ? { ...group, ...patch } : group);
    groupsRef.current = nextGroups;
    setGroups(nextGroups);
  };

  const createGroupFromSelected = () => {
    const group = createCanvasGroup(
      nodesRef.current,
      selectedNodeIdsRef.current,
      `group-${crypto.randomUUID()}`,
      `分组 ${groupsRef.current.length + 1}`,
    );
    if (!group) return toast.info("请至少选择 2 个节点后再创建分组");
    const nextGroups = [...groupsRef.current, group];
    groupsRef.current = nextGroups;
    setGroups(nextGroups);
    selectCanvasGroup(group);
  };

  const connectSelectedNodesToConfig = (targetConfigId?: string) => {
    if (selectedNodeIdsRef.current.size < 2) return toast.info("请至少选择 2 个节点后再连接配置");
    const currentNodes = nodesRef.current;
    let nextNodes = currentNodes;
    let targetId = targetConfigId || "";
    if (!targetId) {
      const targetCandidate = buildCanvasNodeCandidate("config", undefined, currentNodes.length);
      const candidateNodes = [...currentNodes, targetCandidate];
      const selectedNodes = connectableCanvasNodesToConfig(candidateNodes, selectedNodeIdsRef.current, targetCandidate.id);
      if (selectedNodes.length < 2) return toast.info("请至少选择 2 个可连接节点后再新建配置");
      const bounds = selectedNodes.reduce((result, node) => ({
        left: Math.min(result.left, node.x),
        top: Math.min(result.top, node.y),
        right: Math.max(result.right, node.x + node.width),
        bottom: Math.max(result.bottom, node.y + node.height),
      }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
      const configNode = {
        ...targetCandidate,
        x: bounds.right + 96,
        y: bounds.top,
      };
      configNode.title = "批量生成配置";
      configNode.y = bounds.top + Math.max(0, (bounds.bottom - bounds.top - configNode.height) / 2);
      targetId = configNode.id;
      nextNodes = [...currentNodes, configNode];
    }
    const result = connectCanvasNodesToConfig(
      nextNodes,
      edgesRef.current,
      selectedNodeIdsRef.current,
      targetId,
      () => crypto.randomUUID(),
    );
    if (!result.addedCount) return toast.warning(targetConfigId ? "没有可新增的有效连线" : "选中的节点无法连接到新的配置节点");
    if (nextNodes !== currentNodes) {
      nodesRef.current = nextNodes;
      setNodes(nextNodes);
    }
    edgesRef.current = result.edges;
    setEdges(result.edges);
    applyNodeSelection([targetId], targetId, true);
    setSelectedGroupId("");
    setSelectedEdgeId("");
    setConnectSelectionOpen(false);
    setContextMenu(null);
    toast.success(`已新增 ${result.addedCount} 条配置连线`);
  };

  const clearCurrentCanvas = async () => {
    if (clearCanvasBusy || projectActionDisabled) return;
    const previousNodes = nodesRef.current;
    const previousEdges = edgesRef.current;
    const previousGroups = groupsRef.current;
    setClearCanvasBusy(true);
    setClearCanvasError("");
    pauseCanvasHistory();
    abortAllGenerationRequests();
    cancelActiveCanvasInteractions();
    nodesRef.current = [];
    edgesRef.current = [];
    groupsRef.current = [];
    setNodes([]);
    setEdges([]);
    setGroups([]);
    applyNodeSelection([]);
    setSelectedGroupId("");
    setSelectedEdgeId("");
    setContextMenu(null);
    setInspectorOpen(false);
    try {
      const saved = await persistSnapshot([], [], viewportRef.current.zoom, { quiet: true });
      if (!saved) throw new Error("服务端快照未保存，画布已恢复原状");
      setClearCanvasOpen(false);
      resumeCanvasHistory(true);
      toast.success("当前画布已清空，项目和资产库内容均已保留");
    } catch (error) {
      nodesRef.current = previousNodes;
      edgesRef.current = previousEdges;
      groupsRef.current = previousGroups;
      setNodes(previousNodes);
      setEdges(previousEdges);
      setGroups(previousGroups);
      resumeCanvasHistory(false);
      const message = publicApiError(error, "清空画布失败");
      setClearCanvasError(message);
      toast.error(message);
    } finally {
      setClearCanvasBusy(false);
    }
  };

  const ungroupCanvasGroup = (groupId: string) => {
    const group = groupsRef.current.find((item) => item.id === groupId);
    const nextGroups = groupsRef.current.filter((item) => item.id !== groupId);
    groupsRef.current = nextGroups;
    setGroups(nextGroups);
    setSelectedGroupId("");
    setInspectorOpen(false);
    if (group) applyNodeSelection(group.nodeIds, group.nodeIds[0] || "", false);
  };

  const removeNodes = (ids: Iterable<string>) => {
    const deleteIds = new Set(ids);
    if (!deleteIds.size) return;
    nodesRef.current.forEach((node) => {
      if (!deleteIds.has(node.id) || !node.metadata?.isBatchRoot || !Array.isArray(node.metadata.batchChildIds)) return;
      node.metadata.batchChildIds.forEach((childId) => {
        if (typeof childId === "string") deleteIds.add(childId);
      });
    });
    const canceledTargetIds = cancelForRemovedNodes(deleteIds);
    const affectedRootIds = new Set<string>();
    let sourceNodes = nodesRef.current.map((node) => {
      const rootId = stringValue(node.metadata?.batchRootId);
      if (rootId && (deleteIds.has(node.id) || canceledTargetIds.has(node.id)) && !deleteIds.has(rootId)) affectedRootIds.add(rootId);
      if (deleteIds.has(node.id) || !canceledTargetIds.has(node.id) || node.metadata?.status !== "loading") return node;
      return {
        ...node,
        title: "生成已停止",
        metadata: { ...node.metadata, status: "error" as const, errorDetails: "关联节点已删除，生成已停止，可重试。", jobId: undefined },
      };
    });
    sourceNodes = sourceNodes.map((node) => {
      if (!affectedRootIds.has(node.id) || !Array.isArray(node.metadata?.batchChildIds)) return node;
      const batchChildIds = node.metadata.batchChildIds.filter((childId) => typeof childId === "string" && !deleteIds.has(childId));
      return {
        ...node,
        metadata: {
          ...node.metadata,
          batchChildIds,
          primaryImageId: deleteIds.has(stringValue(node.metadata.primaryImageId)) ? undefined : node.metadata.primaryImageId,
        },
      };
    });
    const nextGraph = deleteCanvasNodesAndEdges(sourceNodes, edgesRef.current, deleteIds);
    let nextNodes = nextGraph.nodes;
    affectedRootIds.forEach((rootId) => { nextNodes = refreshImageBatchRoot(nextNodes, rootId); });
    nodesRef.current = nextNodes;
    edgesRef.current = nextGraph.edges;
    const nextGroups = removeNodesFromCanvasGroups(groupsRef.current, deleteIds);
    groupsRef.current = nextGroups;
    setNodes(nextNodes);
    setEdges(nextGraph.edges);
    setGroups(nextGroups);
    setSelectedEdgeId((current) => nextGraph.edges.some((edge) => edge.id === current) ? current : "");
    const nextSelected = new Set(Array.from(selectedNodeIdsRef.current).filter((nodeId) => !deleteIds.has(nodeId)));
    const nextPrimary = nextSelected.has(selectedId) ? selectedId : nextSelected.values().next().value || "";
    applyNodeSelection(nextSelected, nextPrimary, inspectorOpen && nextSelected.size === 1);
    stageInteractionController.resetAfterNodesRemoved(deleteIds);
  };

  const removeNode = (id: string) => {
    const selected = selectedNodeIdsRef.current;
    removeNodes(selected.has(id) && selected.size > 1 ? selected : [id]);
  };

  stageInteractionController.updateBindings({
    isSwitching: () => projectSessionController.switching,
    isInteractionBlocked: () => projectSessionController.switching
      || projectSessionController.loading
      || Boolean(projectId && !projectSessionController.canonicalScope),
    isProjectActionDisabled: () => projectActionDisabled,
    getWheelZoomRequiresCtrl: () => wheelZoomRequiresCtrl,
    getShortcuts: () => shortcutsRef.current,
    getMinimapModel: () => minimapModel,
    getNodes: () => nodesRef.current,
    setNodes: nextNodes => { nodesRef.current = nextNodes; setNodes(nextNodes); },
    getEdges: () => edgesRef.current,
    setEdges: nextEdges => { edgesRef.current = nextEdges; setEdges(nextEdges); },
    getGroups: () => groupsRef.current,
    setGroups: nextGroups => { groupsRef.current = nextGroups; setGroups(nextGroups); },
    getSelectedNodeIds: () => selectedNodeIdsRef.current,
    getSelectedGroupId: () => canvasStore.getState().graph.selectedGroupId,
    setSelectedGroupId,
    getSelectedEdgeId: () => canvasStore.getState().graph.selectedEdgeId,
    setSelectedEdgeId,
    setHoveredEdgeId: edgeId => setHoveredEdgeId(current => current === edgeId ? current : edgeId),
    getHoveredNodeId: () => canvasStore.getState().ui.hoveredNodeId,
    setHoveredNodeId: setHoveredId,
    getSelectedNode: () => {
      const state = canvasStore.getState();
      return state.graph.nodes.find(node => node.id === state.graph.selectedNodeId) || null;
    },
    commitViewport: nextViewport => {
      viewportRef.current = nextViewport;
      canvasCommands.commit({ viewport: nextViewport });
    },
    setInspectorOpen,
    setEditingInlineNodeId,
    applyNodeSelection,
    pauseHistory: pauseCanvasHistory,
    resumeHistory: resumeCanvasHistory,
    setContextMenu,
    copySelectedNodes,
    pasteCopiedNodes,
    undoCanvas,
    redoCanvas,
    runSelectedGeneration: () => { void runSelectedGenerationRef.current(); },
    removeNodes,
    removeEdge,
    onInfo: message => toast.info(message),
    onWarning: message => toast.warning(message),
  });

  const commitNodeTitle = (node: CanvasNodeData) => {
    const nextTitle = titleDraft.trim();
    if (nextTitle && nextTitle !== node.title) updateNode(node.id, { title: nextTitle });
    setTitleEditingNodeId("");
  };

  const startPanelWidthResize = (event: PointerEvent, node: CanvasNodeData) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = panelRef.current?.getBoundingClientRect().width || 340;
    const move = (moveEvent: globalThis.PointerEvent) => {
      const width = Math.min(560, Math.max(340, Math.round(startWidth + moveEvent.clientX - startX)));
      updateNode(node.id, { metadata: { ...(node.metadata || {}), promptPanelWidth: width } });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const adjustNodeFontSize = (node: CanvasNodeData, delta: number) => {
    const current = numberValue(node.metadata?.fontSize) || 14;
    const next = Math.max(10, Math.min(32, current + delta));
    updateNode(node.id, { metadata: { ...(node.metadata || {}), fontSize: next } });
  };

  const downloadNodeMedia = async (node: CanvasNodeData) => {
    const assetId = assetIdFromNode(node);
    const directSrc = imageSrcFromNode(node, previews);
    const activeScope = projectSessionController.canonicalScope;
    try {
      if (assetId && activeScope) {
        const sourceScope = workspaceScopeValue(node.metadata?.assetScope) || activeScope;
        const blob = await fetch(await getAssetContentObjectUrl(assetId, sourceScope)).then((response) => response.blob());
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = node.title || assetId;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
        return;
      }
      if (!directSrc) return toast.info("当前节点没有可下载的媒体");
      const blob = await fetch(directSrc).then((response) => response.blob());
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = node.title || node.id;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (error) {
      toast.error(publicApiError(error, "下载媒体失败"));
    }
  };

  const toggleCanvasBatch = (nodeId: string) => {
    const node = nodesRef.current.find((item) => item.id === nodeId);
    if (!node?.metadata?.isBatchRoot) return;
    const expanding = !node.metadata.imageBatchExpanded;
    let nextNodes = nodesRef.current.map((item) => item.id === nodeId
      ? { ...item, metadata: { ...item.metadata, imageBatchExpanded: expanding } }
      : item);
    // 展开时把子图吸附回以基底节点为基点的网格位，消除手动拖动造成的错位
    if (expanding) nextNodes = snapImageBatchChildrenToGrid(nextNodes, nodeId);
    nodesRef.current = nextNodes;
    setNodes(nextNodes);
    void persistSnapshot(nextNodes, edgesRef.current, viewportRef.current.zoom, { quiet: true });
  };
  toggleCanvasBatchRef.current = toggleCanvasBatch;

  const setBatchPrimaryNode = (child: CanvasNodeData) => {
    const rootId = child.metadata?.batchRootId;
    const root = nodesRef.current.find((item) => item.id === rootId);
    if (!rootId || !root || !child.imageAssetId) return;
    updateNode(rootId, {
      imageAssetId: child.imageAssetId,
      width: child.width,
      height: child.height,
      metadata: {
        ...root.metadata,
        primaryImageId: child.id,
        naturalWidth: child.metadata?.naturalWidth,
        naturalHeight: child.metadata?.naturalHeight,
        bytes: child.metadata?.bytes,
      },
    });
    toast.success("已设为图片组主图");
  };

  const generateImageFromTextNode = async (node: CanvasNodeData) => {
    const text = nodeEditorTextFromNode(node).trim();
    if (!text) return toast.warning("先在文本节点里写入内容");
    const created = addNode("image", { x: node.x + node.width + 96, y: node.y });
    connectNodes(node.id, created.id);
    updateNode(created.id, { content: text, metadata: { ...(created.metadata || {}), generationMode: "image" } });
    await generateImageFromNode(created.id);
  };

  const toggleCanvasNodeFavorite = async (node: CanvasNodeData) => {
    const assetId = assetIdFromNode(node);
    if (!assetId) return toast.info("该节点还没有归档资产可收藏");
    const activeScope = projectSessionController.canonicalScope || "personal";
    const nextReaction = node.metadata?.assetFavorited ? "none" : "favorite";
    try {
      await updateAssetUserState(assetId, { reaction: nextReaction }, workspaceScopeValue(node.metadata?.assetScope) || activeScope);
      // 收藏态落到节点 metadata（随快照持久化），星标据此填充
      updateNode(node.id, { metadata: { ...(node.metadata || {}), assetFavorited: nextReaction === "favorite" } });
      toast.success(nextReaction === "favorite" ? "已收藏到素材库" : "已取消收藏");
    } catch (error) {
      toast.error(publicApiError(error, nextReaction === "favorite" ? "收藏失败" : "取消收藏失败"));
    }
  };

  /** 把批次子图从图片组中拆出为独立节点（应用到画布）。 */
  const detachBatchChildToCanvas = (child: CanvasNodeData) => {
    const rootId = child.metadata?.batchRootId;
    const root = nodesRef.current.find((item) => item.id === rootId);
    if (!rootId || !root) return;
    const nextNodes = nodesRef.current.map((node) => {
      if (node.id === child.id) {
        const metadata = { ...(node.metadata || {}) };
        delete metadata.batchRootId;
        return { ...node, metadata };
      }
      if (node.id === rootId) {
        const childIds = (node.metadata?.batchChildIds || []).filter((id) => id !== child.id);
        return {
          ...node,
          metadata: {
            ...node.metadata,
            batchChildIds: childIds,
            isBatchRoot: childIds.length ? node.metadata?.isBatchRoot : false,
          },
        };
      }
      return node;
    });
    nodesRef.current = nextNodes;
    setNodes(nextNodes);
    void persistSnapshot(nextNodes, edgesRef.current, viewportRef.current.zoom, { quiet: true });
    toast.success("已应用为独立节点");
  };

  const runCanvasGroupGeneration = async (groupId: string) => {
    if (!groupId || runningGroupId || projectSessionController.switching) return;
    const group = groupsRef.current.find((item) => item.id === groupId);
    if (!group) return;
    const currentNodes = nodesRef.current;
    const runnable = group.nodeIds
      .map((nodeId) => currentNodes.find((node) => node.id === nodeId))
      .filter((node): node is CanvasNodeData => Boolean(
        node
        && node.kind !== "director"
        && !isHiddenCanvasBatchChild(node, currentNodes)
        && node.metadata?.status !== "loading"
        && !runningNodeIds.has(node.id),
      ));
    if (!runnable.length) return toast.warning("分组内没有可批量执行的节点");

    setRunningGroupId(groupId);
    let executed = 0;
    try {
      for (const node of runnable) {
        if (projectSessionController.switching || projectSessionController.canonicalKey !== `${projectSessionController.canonicalScope}:${projectId}`) break;
        try {
          await generateFromNode(node.id);
          executed += 1;
        } catch {
          // 单个节点的生成函数会维护自身错误状态，分组继续执行后续节点。
        }
      }
      if (executed) toast.success(`已执行 ${executed} 个分组节点`);
    } finally {
      setRunningGroupId("");
    }
  };

  const applyAgentOperations = async (ops: CanvasAgentOp[] = []): Promise<CanvasAgentExecutionResult> => {
    const activeScope = projectSessionController.canonicalScope;
    const projectKey = projectSessionController.canonicalKey;
    if (!activeScope || !projectKey || projectSessionController.switching) throw new Error("当前画布尚未准备好");
    const before = canvasAgentSnapshotFromCanvas(
      projectId,
      projectTitle || "未命名画布",
      nodesRef.current,
      edgesRef.current,
      selectedNodeIdsRef.current,
      viewportRef.current,
    );
    const generationOps = ops.filter((op): op is Extract<CanvasAgentOp, { type: "run_generation" }> => op.type === "run_generation");
    const nextAgentSnapshot = applyCanvasAgentOps(before, ops.filter((op) => op.type !== "run_generation"));
    const nextNodes = nextAgentSnapshot.nodes.map(normalizeCanvasNode).filter((node): node is CanvasNodeData => Boolean(node));
    const nextEdges = nextAgentSnapshot.connections.map(normalizeCanvasEdge).filter((edge): edge is CanvasEdgeData => Boolean(edge));
    const nextSelected = new Set(nextAgentSnapshot.selectedNodeIds.filter((id) => nextNodes.some((node) => node.id === id)));

    setAgentUndoSnapshot(before);
    await commitCanvasAgentState({
      commands: canvasCommands,
      nodes: nextNodes,
      edges: nextEdges,
      selectedNodeIds: [...nextSelected],
      agentViewport: nextAgentSnapshot.viewport,
      viewportRef,
      closeContextMenu: () => setContextMenu(null),
      persistSnapshot,
    });

    const generationResults: CanvasAgentGenerationResult[] = [];
    for (const op of generationOps) {
      const target = nodesRef.current.find((node) => node.id === op.nodeId);
      const mode = op.mode || (target ? generationModeFromNode(target) : "image");
      if (!target) {
        generationResults.push({ nodeId: op.nodeId, mode, status: "blocked", outputNodeIds: [], jobIds: [], error: "目标节点不存在" });
        continue;
      }
      if (op.prompt?.trim()) {
        const prompted = nodesRef.current.map((node) => node.id === op.nodeId ? updateCanvasNodeComposer(node, op.prompt!.trim()) : node);
        nodesRef.current = prompted;
        setNodes(prompted);
      }
      const beforeIds = new Set(nodesRef.current.map((node) => node.id));
      try {
        if (mode === "text") await generateTextFromNode(op.nodeId);
        else if (mode === "image") await generateImageFromNode(op.nodeId);
        else if (mode === "video") await generateVideoFromNode(op.nodeId);
        else await generateAudioFromNode(op.nodeId);
        const outputNodes = nodesRef.current.filter((node) => !beforeIds.has(node.id) || node.id === op.nodeId && node.metadata?.status === "success");
        const failed = nodesRef.current.find((node) => node.id === op.nodeId)?.metadata?.status === "error" && !outputNodes.length;
        generationResults.push({
          nodeId: op.nodeId,
          mode,
          status: failed ? "failed" : "succeeded",
          outputNodeIds: outputNodes.map((node) => node.id),
          jobIds: outputNodes.map((node) => stringValue(node.metadata?.jobId)).filter(Boolean),
          error: failed ? stringValue(nodesRef.current.find((node) => node.id === op.nodeId)?.metadata?.errorDetails) || "生成失败" : undefined,
        });
      } catch (error) {
        generationResults.push({ nodeId: op.nodeId, mode, status: "failed", outputNodeIds: [], jobIds: [], error: publicApiError(error, "生成失败") });
      }
    }

    return {
      snapshot: canvasAgentSnapshotFromCanvas(
        projectId,
        projectTitle || "未命名画布",
        nodesRef.current,
        edgesRef.current,
        selectedNodeIdsRef.current,
        viewportRef.current,
      ),
      generationResults,
    };
  };

  const undoAgentOperations = async () => {
    if (!agentUndoSnapshot) return null;
    const restoredNodes = agentUndoSnapshot.nodes.map(normalizeCanvasNode).filter((node): node is CanvasNodeData => Boolean(node));
    const restoredEdges = agentUndoSnapshot.connections.map(normalizeCanvasEdge).filter((edge): edge is CanvasEdgeData => Boolean(edge));
    const restoredSelection = new Set(agentUndoSnapshot.selectedNodeIds.filter((id) => restoredNodes.some((node) => node.id === id)));
    const restoredViewport = await commitCanvasAgentState({
      commands: canvasCommands,
      nodes: restoredNodes,
      edges: restoredEdges,
      selectedNodeIds: [...restoredSelection],
      agentViewport: agentUndoSnapshot.viewport,
      viewportRef,
      closeContextMenu: () => setContextMenu(null),
      persistSnapshot,
    });
    const restored = canvasAgentSnapshotFromCanvas(
      projectId,
      projectTitle || "未命名画布",
      restoredNodes,
      restoredEdges,
      restoredSelection,
      restoredViewport,
    );
    setAgentUndoSnapshot(null);
    return restored;
  };

  const executeAgentWorkspaceTool = async (name: string, input: Record<string, unknown>) => {
    const activeScope = projectSessionController.canonicalScope;
    if (!activeScope) throw new Error("当前 workspace 尚未确认");
    const text = (key: string) => typeof input[key] === "string" ? input[key].trim() : "";
    const texts = (key: string) => Array.isArray(input[key])
      ? input[key].filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())
      : [];
    const limit = (key: string, fallback: number, maximum: number) => Math.min(maximum, Math.max(1, Math.floor(Number(input[key]) || fallback)));
    if (name === "canvas_search_assets") {
      const assetType = text("assetType");
      const category = text("category");
      const sourceType = text("sourceType");
      const result = await getAssetLibrary(activeScope, {
        keyword: text("keyword") || undefined,
        type: assetType === "image" || assetType === "video" || assetType === "audio" ? assetType : undefined,
        category: category ? category as AssetCategory : undefined,
        sourceType: sourceType ? sourceType as AssetSourceType : undefined,
        page: 1,
        pageSize: limit("limit", 20, 50),
      });
      return {
        ok: true,
        message: `找到 ${result.total} 个资产，本次返回 ${result.items.length} 个。`,
        data: {
          total: result.total,
          items: result.items.map((asset) => ({ id: asset.id, type: asset.type, name: asset.name, category: asset.category, tags: asset.tags, sourceType: asset.source_type, createdAt: asset.created_at })),
        },
      };
    }
    if (name === "canvas_list_jobs") {
      const requestedStatuses = new Set(texts("statuses"));
      const requestedTypes = new Set(texts("types"));
      const response = await getJobs({ scope: activeScope, limit: limit("limit", 50, 100) });
      const jobs = Array.isArray(response) ? response : response.items;
      const filtered = jobs.filter((job) => (!requestedStatuses.size || requestedStatuses.has(job.status)) && (!requestedTypes.size || requestedTypes.has(job.type)));
      return {
        ok: true,
        message: `当前 workspace 有 ${filtered.length} 个匹配任务。`,
        data: filtered.map((job) => ({ id: job.id, type: job.type, status: job.status, progress: job.progress, queuePhase: job.queue_phase, error: job.error, createdAt: job.created_at, updatedAt: job.updated_at })),
      };
    }
    if (name === "canvas_cancel_job") {
      const jobId = text("jobId");
      if (!jobId) throw new Error("jobId 不能为空");
      const job = await cancelJob(jobId, activeScope);
      return { ok: true, message: `任务 ${jobId} 已取消。`, data: job };
    }
    if (name !== "canvas_add_assets") throw new Error(`未知 workspace 工具：${name}`);

    const assetIds = Array.from(new Set(texts("assetIds"))).slice(0, 20);
    if (!assetIds.length) throw new Error("assetIds 不能为空");
    const assets = await Promise.all(assetIds.map((assetId) => getAsset(assetId, activeScope)));
    const viewport = viewportRef.current;
    const baseX = Number.isFinite(Number(input.x)) ? Number(input.x) : Math.round((stageBounds.width / 2 - viewport.panX) / Math.max(0.1, viewport.zoom / 100));
    const baseY = Number.isFinite(Number(input.y)) ? Number(input.y) : Math.round((stageBounds.height / 2 - viewport.panY) / Math.max(0.1, viewport.zoom / 100));
    const direction = input.direction === "column" ? "column" : "row";
    const gap = Math.max(16, Math.min(240, Number(input.gap) || 48));
    let cursor = 0;
    const addedNodes = assets.map((asset, index) => {
      const candidate = buildCanvasNodeCandidate(asset.type, {
        x: baseX + (direction === "row" ? cursor : 0),
        y: baseY + (direction === "column" ? cursor : 0),
      }, nodesRef.current.length + index);
      cursor += (direction === "row" ? candidate.width : candidate.height) + gap;
      return {
        ...candidate,
        title: asset.name || candidate.title,
        content: "",
        imageAssetId: asset.id,
        imageSrc: undefined,
        metadata: {
          ...candidate.metadata,
          assetId: asset.id,
          assetScope: activeScope,
          content: "",
          mimeType: asset.content_type,
          bytes: asset.size,
          status: "success" as const,
          assetCategory: asset.category,
          assetTags: asset.tags,
          assetSourceType: asset.source_type,
        },
      };
    });
    const before = canvasAgentSnapshotFromCanvas(projectId, projectTitle || "未命名画布", nodesRef.current, edgesRef.current, selectedNodeIdsRef.current, viewportRef.current);
    const nextNodes = [...nodesRef.current, ...addedNodes];
    const selected = new Set(addedNodes.map((node) => node.id));
    setAgentUndoSnapshot(before);
    nodesRef.current = nextNodes;
    selectedNodeIdsRef.current = selected;
    setNodes(nextNodes);
    setSelectedNodeIds(selected);
    setSelectedId(addedNodes.at(-1)?.id || "");
    await persistSnapshot(nextNodes, edgesRef.current, viewport.zoom, { quiet: true, panX: viewport.panX, panY: viewport.panY });
    return { ok: true, message: `已将 ${addedNodes.length} 个资产添加到画布。`, data: { nodeIds: addedNodes.map((node) => node.id), assetIds } };
  };

  const uploadFilesAsNodes = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((file) => assetKindFromFile(file) !== null);
    if (!list.length || uploadingRef.current || projectSessionController.switching) return;
    const activeScope = projectSessionController.canonicalScope;
    if (!activeScope) {
      toast.warning("正在确认项目工作区，暂不能上传画布素材");
      return;
    }
    uploadingRef.current = true;
    setUploading(true);
    try {
      const createdNodes: CanvasNodeData[] = [];
      for (const file of list) {
        const kind = assetKindFromFile(file);
        if (!kind) continue;
        const asset = await uploadAsset(file, {
          type: kind,
          name: file.name,
          category: "reference",
          source_type: "canvas",
          source_project_id: projectId,
          source_project_name: projectTitle,
          source_metadata: JSON.stringify({ canvas_node_ingestion: "drag_or_upload" }),
        }, activeScope);
        createdNodes.push({
          id: crypto.randomUUID(),
          kind,
          title: asset.name || file.name,
          content: `从画布拖入 / 上传形成的${kind === "image" ? "图片" : kind === "video" ? "视频" : "音频"}素材节点。`,
          x: 140 + (nodes.length + createdNodes.length) * 34,
          y: 120 + (nodes.length + createdNodes.length) * 26,
          width: kind === "video" ? 420 : 320,
          height: kind === "audio" ? 120 : kind === "video" ? 260 : 238,
          imageAssetId: kind === "image" ? asset.id : undefined,
          metadata: {
            assetId: asset.id,
            assetScope: activeScope,
            content: "",
            prompt: "",
            status: "success",
            generationMode: defaultGenerationModeForKind(kind),
            mimeType: asset.content_type || file.type,
            bytes: asset.size || file.size,
          },
        });
      }
      const baseNodes = nodesRef.current;
      const nextNodes = [...baseNodes, ...createdNodes.map((node, index) => ({
        ...node,
        x: 140 + (baseNodes.length + index) * 34,
        y: 120 + (baseNodes.length + index) * 26,
      }))];
      nodesRef.current = nextNodes;
      setNodes(nextNodes);
      const nextSelectedId = createdNodes.at(-1)?.id || selectedId;
      applyNodeSelection(nextSelectedId ? [nextSelectedId] : [], nextSelectedId, Boolean(nextSelectedId));
      await persistSnapshot(nextNodes, edgesRef.current, viewportRef.current.zoom);
      toast.success(`已添加 ${createdNodes.length} 个媒体节点`);
    } catch (error) {
      toast.error(publicApiError(error, "上传媒体到画布失败"));
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  };

  const duplicateSelectedNode = async (targetId?: string) => {
    const source = targetId ? nodesRef.current.find((node) => node.id === targetId) : selectedNode ? nodesRef.current.find((node) => node.id === selectedNode.id) : null;
    if (!source) return;
    const createdId = crypto.randomUUID();
    const duplicate: CanvasNodeData = {
      ...source,
      id: createdId,
      title: `${source.title} 副本`,
      x: source.x + 36,
      y: source.y + 36,
      metadata: { ...source.metadata },
    };
    const currentEdges = edgesRef.current;
    const incomingEdges = currentEdges
      .filter((edge) => edge.to === source.id)
      .map((edge) => ({ id: `${edge.from}:${createdId}`, from: edge.from, to: createdId }))
      .filter((edge, index, all) => all.findIndex((item) => item.id === edge.id) === index && !currentEdges.some((existing) => existing.from === edge.from && existing.to === edge.to));
    const nextNodes = [...nodesRef.current, duplicate];
    const nextEdges = [...currentEdges, ...incomingEdges];
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    setNodes(nextNodes);
    setEdges(nextEdges);
    applyNodeSelection([createdId], createdId, true);
    await persistSnapshot(nextNodes, nextEdges, viewportRef.current.zoom);
    toast.success("节点已复制：仅保留左侧入边，右侧出边不会继承");
  };

  const imageAssetIds = () => nodesRef.current.map((node) => assetIdFromNode(node)).filter(Boolean) as string[];

  const prepareCanvasFragmentNodes = async (selectedIds: ReadonlySet<string>, activeScope: WorkspaceScope) => {
    let nextNodes = nodesRef.current;
    let changed = false;
    for (const sourceNode of nextNodes.filter((node) => selectedIds.has(node.id))) {
      if (sourceNode.kind !== "image" && sourceNode.kind !== "video" && sourceNode.kind !== "audio") continue;
      const kind = mediaKindFromNode(sourceNode);
      if (assetIdFromNode(sourceNode)) continue;
      const source = sourceNode.imageSrc || stringValue(sourceNode.metadata?.content) || sourceNode.content;
      if (!isReadableMediaSource(source)) throw new Error(`节点“${sourceNode.title}”的媒体无法读取，不能导出选区包`);
      const response = await fetch(source);
      if (!response.ok) throw new Error(`节点“${sourceNode.title}”的媒体读取失败（${response.status}）`);
      const blob = await response.blob();
      const contentType = blob.type || sourceNode.metadata?.mimeType || fragmentMediaMimeType(kind);
      const file = new File([blob], fragmentMediaFileName(sourceNode.title || sourceNode.id, kind, contentType), { type: contentType });
      const asset = await uploadAsset(file, {
        type: kind,
        name: file.name,
        category: "reference",
        source_type: "canvas",
        source_project_id: projectId,
        source_project_name: projectTitle,
        source_metadata: JSON.stringify({ canvas_node_id: sourceNode.id, canvas_fragment_export: true }),
      }, activeScope);
      nextNodes = nextNodes.map((node) => node.id === sourceNode.id ? {
        ...node,
        content: looksLikeImageSource(node.content) || isReadableMediaSource(node.content) ? "" : node.content,
        imageAssetId: asset.id,
        imageSrc: undefined,
        metadata: {
          ...node.metadata,
          assetId: asset.id,
          assetScope: activeScope,
          content: "",
          mimeType: asset.content_type || contentType,
          bytes: asset.size || blob.size,
        },
      } : node);
      changed = true;
    }
    if (changed) {
      nodesRef.current = nextNodes;
      setNodes(nextNodes);
      await persistSnapshot(nextNodes, edgesRef.current, viewportRef.current.zoom, { quiet: true });
    }
    return nextNodes.filter((node) => selectedIds.has(node.id));
  };

  const exportSelectedCanvasFragment = async () => {
    if (fragmentBusy) return;
    const selectedIds = new Set(selectedNodeIdsRef.current);
    if (!selectedIds.size) return toast.info("请先选择要导出的节点");
    const activeScope = projectSessionController.canonicalScope;
    if (!activeScope) return toast.warning("正在确认项目工作区，暂不能导出选区包");
    setFragmentBusy(true);
    try {
      const selectedNodes = await prepareCanvasFragmentNodes(selectedIds, activeScope);
      const fragment = buildCanvasFragmentPackage({
        nodes: selectedNodes,
        edges: edgesRef.current,
        groups: canvasFragmentGroups(groupsRef.current),
        selectedIds,
        projectId,
        projectTitle,
        scope: activeScope,
      });
      const batch = await createAssetExport({
        selection_mode: "selected",
        asset_ids: canvasFragmentAssetIds(fragment.nodes),
        canvas_fragment: serializeCanvasFragmentPackage(fragment) as unknown as Record<string, unknown>,
      }, activeScope);
      toast.message(`选区包任务已创建：${batch.id.slice(-8)}，正在归集媒体...`);
      const ready = await waitForAssetExportReady(batch.id, activeScope);
      const blob = await downloadAssetExport(ready.id, activeScope);
      downloadBlob(blob, ready.file_name || `canvas-fragment-${ready.id.slice(-8)}.zip`);
      toast.success(ready.status === "partial_failed" ? "选区包已下载，部分媒体失败请查看 manifest" : "画布选区包已下载");
    } catch (error) {
      toast.error(publicApiError(error, "导出画布选区包失败"));
    } finally {
      setFragmentBusy(false);
    }
  };

  const importCanvasFragment = async (file?: File) => {
    if (!file || fragmentBusy) return;
    const activeScope = projectSessionController.canonicalScope;
    if (!activeScope) return toast.warning("正在确认项目工作区，暂不能导入选区包");
    setFragmentBusy(true);
    try {
      const zip = await readZip(file);
      const fragmentFile = zip.get("canvas-fragment.json");
      if (!fragmentFile) throw new Error("压缩包缺少 canvas-fragment.json");
      const fragment = parseCanvasFragmentPackage(
        JSON.parse(await fragmentFile.text()),
        () => crypto.randomUUID(),
      );
      const manifestFile = zip.get("manifest.json");
      const manifestPayload = manifestFile ? JSON.parse(await manifestFile.text()) as { assets?: CanvasFragmentManifestRow[] } : { assets: [] };
      const manifestById = new Map((manifestPayload.assets || []).map((row) => [row.asset_id, row]));
      const assets = new Map<string, Asset>();
      for (const oldAssetId of canvasFragmentAssetIds(fragment.nodes)) {
        try {
          assets.set(oldAssetId, await getAsset(oldAssetId, activeScope));
          continue;
        } catch {
          const row = manifestById.get(oldAssetId);
          const archived = row?.archive_path ? zip.get(row.archive_path) : undefined;
          if (!row || !archived) throw new Error(`资产 ${oldAssetId} 无法复用，且 ZIP 中缺少媒体`);
          const contentType = row.content_type || archived.type || "application/octet-stream";
          const file = new File([archived], row.name, { type: contentType });
          const metadata: Record<string, string> = {
            type: row.type,
            name: row.name,
            source_type: "canvas",
            source_project_id: projectId,
            source_project_name: projectTitle,
            source_metadata: JSON.stringify({ imported_asset_id: oldAssetId, canvas_fragment_import: true }),
          };
          if (row.category) metadata.category = row.category;
          if (row.tags?.length) metadata.tag_ids = row.tags.join(",");
          assets.set(oldAssetId, await uploadAsset(file, metadata, activeScope));
        }
      }
      const stage = stageRef.current?.getBoundingClientRect();
      const center = stage
        ? screenToCanvasPoint(stage.left + stage.width / 2, stage.top + stage.height / 2)
        : { x: 0, y: 0 };
      const imported = importCanvasFragmentPackage({
        fragment,
        assets,
        scope: activeScope,
        center,
        createId: (kind, index) => `${kind}-${Date.now()}-${index}-${crypto.randomUUID().slice(0, 6)}`,
        createEdgeId: (index) => `edge-${Date.now()}-${index}-${crypto.randomUUID().slice(0, 6)}`,
        createGroupId: (index) => `group-${Date.now()}-${index}-${crypto.randomUUID().slice(0, 6)}`,
        createDirectorInstanceId: () => `director-${crypto.randomUUID()}`,
      });
      const nextNodes = [...nodesRef.current, ...imported.nodes as CanvasNodeData[]];
      const nextEdges = [...edgesRef.current, ...imported.connections as CanvasEdgeData[]];
      const nextGroups = normalizeCanvasGroups([...groupsRef.current, ...imported.groups], nextNodes);
      nodesRef.current = nextNodes;
      edgesRef.current = nextEdges;
      groupsRef.current = nextGroups;
      setNodes(nextNodes);
      setEdges(nextEdges);
      setGroups(nextGroups);
      applyNodeSelection(imported.nodes.map((node) => node.id), imported.nodes[0]?.id || "", true);
      await persistSnapshot(nextNodes, nextEdges, viewportRef.current.zoom, { quiet: true });
      const omitted = fragment.omitted_external_connections.length;
      toast.success(`已导入 ${imported.nodes.length} 个节点和 ${imported.connections.length} 条内部连线${omitted ? `；${omitted} 条外部断边未恢复` : ""}`);
    } catch (error) {
      toast.error(publicApiError(error, "导入画布选区包失败"));
    } finally {
      setFragmentBusy(false);
      if (fragmentInputRef.current) fragmentInputRef.current.value = "";
    }
  };

  const buildCanvasProjectArchiveItem = async (
    project: CanvasProject,
    projectScope: WorkspaceScope,
    snapshot: Record<string, unknown>,
  ): Promise<{ item: CanvasProjectArchiveItem; zipFiles: Array<{ name: string; data: BlobPart }> }> => {
    const archiveFiles: CanvasProjectArchiveAsset[] = [];
    const zipFiles: Array<{ name: string; data: BlobPart }> = [];
    const storageKeysByAssetId = new Map<string, string>();
    const assetReferences = collectCanvasArchiveAssetReferences(snapshot, projectScope);
    for (const [assetId, sourceScope] of Array.from(assetReferences.entries())) {
      const asset = await getAsset(assetId, sourceScope);
      const objectUrl = await getAssetContentObjectUrl(asset.id, sourceScope);
      let blob: Blob;
      try {
        const response = await fetch(objectUrl);
        if (!response.ok) throw new Error(`读取资产失败（${response.status}）`);
        blob = await response.blob();
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
      const storageKey = canvasArchiveStorageKey(sourceScope, asset.type, asset.id);
      const fileName = canvasArchiveMediaFileName(asset);
      const path = `projects/${safeArchiveSegment(project.id)}/files/${safeArchiveSegment(asset.id.slice(-12))}-${fileName}`;
      storageKeysByAssetId.set(asset.id, storageKey);
      archiveFiles.push({
        storageKey,
        path,
        mimeType: blob.type || asset.content_type || "application/octet-stream",
        bytes: blob.size,
      });
      zipFiles.push({ name: path, data: blob });
    }
    return {
      item: {
        project: buildCanvasArchiveProjectRecord({
          id: project.id,
          title: project.title || "未命名画布",
          createdAt: project.created_at || new Date().toISOString(),
          updatedAt: project.updated_at || new Date().toISOString(),
          scope: projectScope,
          snapshot,
          storageKeysByAssetId,
        }),
        files: archiveFiles,
      },
      zipFiles,
    };
  };

  const exportCurrentCanvasProject = async () => {
    if (!projectId || projectArchiveBusy) return;
    const activeScope = projectSessionController.canonicalScope;
    const snapshotBase = autosaveController.snapshotBase;
    if (!activeScope || !snapshotBase) return toast.warning("正在确认完整画布快照，暂不能导出项目包");
    setProjectArchiveBusy(true);
    try {
      const viewport = viewportRef.current;
      const snapshot = buildCanvasSnapshot(
        snapshotBase,
        nodesRef.current,
        edgesRef.current,
        viewport.zoom,
        viewport.panX,
        viewport.panY,
        groupsRef.current,
        backgroundMode,
        showImageInfo,
      );
      const currentProject = projects.find((project) => project.id === projectId) || {
        id: projectId,
        title: projectTitle || "未命名画布",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const result = await buildCanvasProjectArchiveItem(currentProject, activeScope, snapshot);
      const archive = {
        app: "infinite-canvas" as const,
        version: 3 as const,
        exportedAt: new Date().toISOString(),
        projects: [result.item],
      };
      const zip = await createZip([
        { name: "projects.json", data: JSON.stringify(archive, null, 2) },
        ...result.zipFiles,
      ]);
      downloadBlob(zip, `${safeArchiveSegment(projectTitle || "分镜画布")}.zip`);
      toast.success(`完整项目包已导出，包含 ${result.item.files.length} 个媒体文件`);
    } catch (error) {
      toast.error(publicApiError(error, "导出完整画布项目失败"));
    } finally {
      setProjectArchiveBusy(false);
    }
  };

  const exportSelectedCanvasProjects = async () => {
    if (projectBatchBusy || projectArchiveBusy) return;
    const selected = projects.filter((project) => selectedProjectIds.has(project.id) && projectScopeFromServer(project, scope) === scope);
    if (!selected.length) return toast.info("请先选择要导出的画布");
    setProjectBatchBusy(true);
    try {
      const archiveItems: CanvasProjectArchiveItem[] = [];
      const zipFiles: Array<{ name: string; data: BlobPart }> = [];
      for (const project of selected) {
        let snapshot: CanvasSnapshotBase | null = null;
        try {
          snapshot = extractServerCanvasSnapshotData(await getProjectSnapshot(project.id, scope));
        } catch {
          snapshot = null;
        }
        snapshot ||= extractProjectCanvasData(project.data);
        if (!snapshot) throw new Error(`画布“${project.title || project.id}”没有可安全导出的完整快照`);
        const result = await buildCanvasProjectArchiveItem(project, scope, snapshot);
        archiveItems.push(result.item);
        zipFiles.push(...result.zipFiles);
      }
      const archive = {
        app: "infinite-canvas" as const,
        version: 3 as const,
        exportedAt: new Date().toISOString(),
        projects: archiveItems,
      };
      const zip = await createZip([
        { name: "projects.json", data: JSON.stringify(archive, null, 2) },
        ...zipFiles,
      ]);
      downloadBlob(zip, `分镜画布-${archiveItems.length}个项目.zip`);
      toast.success(`已导出 ${archiveItems.length} 个画布和 ${zipFiles.length} 个媒体文件`);
    } catch (error) {
      toast.error(publicApiError(error, "批量导出画布失败"));
    } finally {
      setProjectBatchBusy(false);
    }
  };

  const importCanvasProjectArchive = async (file?: File) => {
    if (!file || projectArchiveBusy) return;
    const targetScope = projectId ? projectSessionController.canonicalScope : scope;
    if (!targetScope) return toast.warning("正在确认工作区，暂不能导入画布项目包");
    let importedCount = 0;
    setProjectArchiveBusy(true);
    try {
      const zip = await readZip(file);
      const projectsFile = zip.get("projects.json");
      if (!projectsFile) throw new Error("压缩包缺少 projects.json");
      const archive = parseCanvasProjectArchive(JSON.parse(await projectsFile.text()));
      if (!archive.projects.length) throw new Error("画布项目包中没有项目");
      const createdProjects: CanvasProject[] = [];
      for (const item of archive.projects) {
        const uploadedByReference = new Map<string, CanvasArchiveUploadedAsset>();
        for (const archiveFile of item.files) {
          const sourceBlob = zip.get(archiveFile.path);
          if (!sourceBlob) throw new Error(`压缩包缺少媒体文件：${archiveFile.path}`);
          if (archiveFile.bytes > 0 && sourceBlob.size !== archiveFile.bytes) {
            throw new Error(`媒体文件大小校验失败：${archiveFile.path}`);
          }
          const mimeType = archiveFile.mimeType || sourceBlob.type || "application/octet-stream";
          const fileName = archiveFile.path.split("/").pop() || "canvas-asset.bin";
          const uploaded = await uploadAsset(new File([sourceBlob], fileName, { type: mimeType }), {
            type: canvasArchiveMediaKind(mimeType),
            name: fileName,
            source_type: "canvas",
            source_project_name: item.project.title,
          }, targetScope);
          const mapped = { id: uploaded.id, mimeType: uploaded.content_type || mimeType, kind: uploaded.type };
          uploadedByReference.set(archiveFile.storageKey, mapped);
          const originalAssetId = canvasArchiveAssetId(archiveFile.storageKey);
          if (originalAssetId) uploadedByReference.set(originalAssetId, mapped);
        }
        const snapshot = remapCanvasArchiveSnapshotAssets(
          canvasArchiveProjectSnapshot(item.project),
          uploadedByReference,
          targetScope,
        );
        const created = await createProject({
          scope: targetScope,
          title: item.project.title || "导入画布",
          data: snapshot,
        });
        createdProjects.push(created);
        importedCount += 1;
      }
      setProjects((items) => [...createdProjects, ...items]);
      toast.success(`已导入 ${importedCount} 个完整画布项目`);
    } catch (error) {
      const detail = publicApiError(error, "导入完整画布项目失败");
      toast.error(importedCount ? `已导入 ${importedCount} 个项目，后续导入失败：${detail}` : detail);
    } finally {
      setProjectArchiveBusy(false);
      if (projectArchiveInputRef.current) projectArchiveInputRef.current.value = "";
    }
  };

  const exportImageNodes = async () => {
    const assetIds = imageAssetIds();
    if (!assetIds.length || exporting) return toast.info("当前画布没有可导出的图片节点");
    const activeScope = projectSessionController.canonicalScope;
    if (!activeScope) {
      toast.warning("正在确认项目工作区，暂不能导出画布素材");
      return;
    }
    setExporting(true);
    try {
      const batch = await createAssetExport({ selection_mode: "selected", asset_ids: assetIds }, activeScope);
      toast.message(`导出任务已创建：${batch.id.slice(-8)}，正在等待 ZIP...`);
      const ready = await waitForAssetExportReady(batch.id, activeScope);
      const blob = await downloadAssetExport(ready.id, activeScope);
      downloadBlob(blob, ready.file_name || `canvas-assets-${ready.id.slice(-8)}.zip`);
      toast.success(ready.status === "partial_failed" ? "导出包已下载，部分文件失败请查看 manifest" : "画布图片导出包已下载");
    } catch (error) {
      toast.error(publicApiError(error, "创建画布图片导出失败"));
    } finally {
      setExporting(false);
    }
  };

  const downloadSelectedMedia = async () => {
    const assetId = selectedNode ? assetIdFromNode(selectedNode) : "";
    const directSrc = selectedNode ? imageSrcFromNode(selectedNode, previews) : "";
    if (!assetId && !directSrc) return toast.info("当前节点没有可下载的媒体");
    const activeScope = projectSessionController.canonicalScope;
    if (!activeScope) {
      toast.warning("正在确认项目工作区，暂不能下载画布素材");
      return;
    }
    try {
      if (assetId) {
        const sourceScope = selectedNode ? workspaceScopeValue(selectedNode.metadata?.assetScope) || activeScope : activeScope;
        const exportBatch = await createAssetExport({ selection_mode: "selected", asset_ids: [assetId] }, sourceScope);
        const ready = await waitForAssetExportReady(exportBatch.id, sourceScope);
        const blob = await downloadAssetExport(ready.id, sourceScope);
        downloadBlob(blob, ready.file_name || `${selectedNode?.title || assetId}.zip`);
        toast.success("媒体导出包已下载");
        return;
      }
      const response = await fetch(directSrc);
      const blob = await response.blob();
      const mediaKind = selectedNode ? mediaKindFromNode(selectedNode) : "image";
      const extension = mediaKind === "video"
        ? "mp4"
        : mediaKind === "audio"
          ? audioFileExtension(stringValue(selectedNode?.metadata?.mimeType))
          : "png";
      downloadBlob(blob, `${selectedNode?.title || selectedNode?.id || "canvas-media"}.${extension}`);
    } catch (error) {
      toast.error(publicApiError(error, "下载媒体节点失败"));
    }
  };

  /* 画布选择页：设置/清除项目自定义封面，只更新列表内的字段，不整表重拉 */
  const saveProjectCover = async (targetProjectId: string, assetId: string) => {
    try {
      const updated = await updateProject(targetProjectId, { cover_asset_id: assetId, scope: projectListScope });
      setProjects((current) => current.map((item) => (item.id === targetProjectId ? { ...item, cover_asset_id: updated.cover_asset_id } : item)));
      toast.success(assetId ? "封面已更新" : "已恢复默认封面");
      setCoverProjectId("");
    } catch (error) {
      toast.error(publicApiError(error, "设置封面失败"));
    }
  };

  if (!projectId) {
    return (
      <>
        <ProjectCoverPickerDialog
          open={Boolean(coverProjectId)}
          scope={projectListScope}
          currentCoverAssetId={projects.find((item) => item.id === coverProjectId)?.cover_asset_id}
          onClose={() => setCoverProjectId("")}
          onSelect={(assetId) => void saveProjectCover(coverProjectId, assetId)}
        />
        <input ref={projectArchiveInputRef} type="file" accept="application/zip,.zip" hidden disabled={projectArchiveBusy || projectBatchBusy} onChange={(event) => void importCanvasProjectArchive(event.target.files?.[0])} />
        <div className="page-content canvas-workspace-full">
          <div className="canvas-workspace-header">
            <button className="outline-button small" onClick={() => navigate("/dashboard")} disabled={switching}>
              <ChevronLeft size={16} /> 返回
            </button>
            <div className="scope-switch canvas-scope-switch">{scopeOptions.map((item) => <button key={item.value} className={scope === item.value ? "active" : ""} onClick={() => void switchCanvasScope(item.value)} disabled={switching}>{item.label}</button>)}</div>
            <div className="canvas-head-actions canvas-project-list-actions">
              {projects.length ? <button className="outline-button small" onClick={() => setSelectedProjectIds(projects.every((project) => selectedProjectIds.has(project.id)) ? new Set() : new Set(projects.map((project) => project.id)))} disabled={switching || projectArchiveBusy || projectBatchBusy}><Check size={15} /> {projects.every((project) => selectedProjectIds.has(project.id)) ? "取消全选" : "全选"}</button> : null}
              {selectedProjectIds.size ? <button className="outline-button small" onClick={() => void exportSelectedCanvasProjects()} disabled={switching || projectArchiveBusy || projectBatchBusy}><Download size={15} /> {projectBatchBusy ? "处理中" : `导出选中（${selectedProjectIds.size}）`}</button> : null}
              {selectedProjectIds.size ? <button className="outline-button small danger" onClick={() => openProjectBatchDelete(selectedProjectIds)} disabled={switching || projectArchiveBusy || projectBatchBusy}><Trash2 size={15} /> 删除选中</button> : null}
              {projects.length ? <button className="outline-button small danger" onClick={() => openProjectBatchDelete(projects.map((project) => project.id))} disabled={switching || projectArchiveBusy || projectBatchBusy}><Trash2 size={15} /> 删除全部</button> : null}
              <button className="outline-button small" onClick={() => projectArchiveInputRef.current?.click()} disabled={switching || projectArchiveBusy || projectBatchBusy}><Upload size={15} /> {projectArchiveBusy ? "导入中" : "导入画布 ZIP"}</button>
              <button className="create-button" onClick={openCreateProjectDialog} disabled={switching || projectArchiveBusy || projectBatchBusy}><Plus size={17} /> 新建画布</button>
            </div>
          </div>
          <div className="page-intro">
            <div><p className="eyebrow">CANVAS / PROJECTS</p><h1>选择一张真实画布</h1><p>这里会打开 {scope === "team" ? "团队" : "个人"} 工作区的服务端项目快照，不再使用静态样例节点。</p></div>
          </div>
          <div className="project-grid">
            {projects.map((project) => {
              const selected = selectedProjectIds.has(project.id);
              return (
                <article className={`project-card canvas-project-selectable ${selected ? "selected" : ""}`} key={project.id} onClick={() => { if (!switching && !projectBatchBusy) navigate(canvasProjectHref(project.id, projectScopeFromServer(project, scope))); }}>
                  <div className="project-visual">
                    {projectCoverUrls[project.id] ? (
                      <img className="canvas-project-cover" src={projectCoverUrls[project.id]} alt="" />
                    ) : (
                      <div className="abstract-canvas" aria-hidden="true"><span className="abstract-card one" /><span className="abstract-card two" /></div>
                    )}
                    <button type="button" className="canvas-project-cover-btn" title="设置封面" onClick={(event) => { event.stopPropagation(); setCoverProjectId(project.id); }}><ImageIcon size={13} /></button>
                    <label className="canvas-project-check" onClick={(event) => event.stopPropagation()}>
                      <input type="checkbox" checked={selected} disabled={switching || projectBatchBusy} onChange={(event) => toggleProjectSelection(project.id, event.target.checked)} aria-label={`选择 ${project.title}`} />
                      <span>{selected ? <Check size={13} /> : null}</span>
                    </label>
                    <span className="project-code">{project.id.slice(-8)}</span>
                  </div>
                  <div className="project-info">
                    <button type="button" className="canvas-project-open" onClick={(event) => { event.stopPropagation(); navigate(canvasProjectHref(project.id, projectScopeFromServer(project, scope))); }} disabled={switching || projectBatchBusy}>
                      <span><h3>{project.title}</h3><p>{new Date(project.updated_at).toLocaleString("zh-CN")}</p></span>
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </article>
              );
            })}
            {!projects.length && <div className="empty-output"><p>还没有画布项目。</p></div>}
          </div>
        </div>
        <Dialog
          open={createDialogOpen}
          onOpenChange={(open) => {
            if (!open && createDialogBusy) return;
            setCreateDialogOpen(open);
            if (!open) setCreateDialogError("");
          }}
        >
          <DialogContent
            className="sm:max-w-[520px]"
            showCloseButton={!createDialogBusy}
            onEscapeKeyDown={(event) => { if (createDialogBusy) event.preventDefault(); }}
            onPointerDownOutside={(event) => { if (createDialogBusy) event.preventDefault(); }}
            onInteractOutside={(event) => { if (createDialogBusy) event.preventDefault(); }}
          >
            <DialogHeader>
              <DialogTitle>新建分镜画布</DialogTitle>
              <DialogDescription>选择工作空间并命名。创建请求失败时会保留当前表单，不会生成假的本地项目。</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <label className="grid gap-2 text-sm">
                <span>工作空间</span>
                <div className="scope-switch">
                  {scopeOptions.map((item) => (
                    <button key={item.value} type="button" className={createDialogScope === item.value ? "active" : ""} onClick={() => setCreateDialogScope(item.value)} disabled={createDialogBusy}>
                      {item.label}
                    </button>
                  ))}
                </div>
              </label>
              <label className="grid gap-2 text-sm">
                <span>画布名称</span>
                <input
                  autoFocus
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={createDialogTitle}
                  maxLength={120}
                  placeholder="例如：第一集分镜"
                  disabled={createDialogBusy}
                  onChange={(event) => {
                    setCreateDialogTitle(event.target.value);
                    if (createDialogError) setCreateDialogError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void submitCreateProject();
                    }
                  }}
                />
              </label>
              {createDialogError ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{createDialogError}</p> : null}
            </div>
            <DialogFooter>
              <button className="outline-button small" type="button" onClick={() => setCreateDialogOpen(false)} disabled={createDialogBusy}>取消</button>
              <button className="vermilion-button" type="button" onClick={() => void submitCreateProject()} disabled={createDialogBusy || !createDialogTitle.trim()}>
                {createDialogBusy ? "创建中…" : "创建并进入"}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <AlertDialog open={projectDeleteIds.length > 0} onOpenChange={(open) => { if (!open && !projectBatchBusy) { setProjectDeleteIds([]); setProjectDeleteError(""); } }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除画布？</AlertDialogTitle>
              <AlertDialogDescription>将删除当前{scope === "team" ? "团队" : "个人"}空间中的 {projectDeleteIds.length} 个画布及其节点、连线和快照。独立资产不会被删除。</AlertDialogDescription>
            </AlertDialogHeader>
            {projectDeleteError ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{projectDeleteError}</p> : null}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={projectBatchBusy}>取消</AlertDialogCancel>
              <AlertDialogAction disabled={projectBatchBusy} onClick={(event) => { event.preventDefault(); void removeProjectBatch(); }}>
                {projectBatchBusy ? "正在删除" : "确认删除"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }


  // 节点卡片的动作集合：每次渲染新建对象字面量，CanvasNodeCard 的 memo 比较器刻意忽略它
  //（本文件 handler 均基于 ref / 函数式 setState，数据 props 相等时旧闭包行为等价）。
  const nodeCardActions = useLatestCanvasCommandProxy<CanvasNodeCardActions>({
    chooseNode,
    openNodeContextMenu,
    toggleCanvasBatch,
    openDirectorNode,
    applyNodeSelection,
    beginInlineNodeEdit,
    handleNodeHoverStart,
    handleNodeHoverEnd,
    startDrag,
    moveDrag,
    endDrag,
    registerConnectionHandle,
    beginConnection,
    commitNodeTitle,
    setTitleDraft,
    setTitleEditingNodeId,
    setReplaceImageNodeId,
    setImagePreviewNodeId,
    setEditingInlineNodeId,
    setPinnedToolbarNodeId,
    setMaterialNodeId,
    setImageAnnotationNodeId,
    setImageMaskNodeId,
    setImageToolError,
    setStoryboardNodeId,
    replaceMediaNodeIdRef,
    replaceMediaInputRef,
    replaceImageInputRef,
    toggleCanvasNodeFavorite,
    detachBatchChildToCanvas,
    downloadNodeMedia,
    setBatchPrimaryNode,
    captureVideoFrameNode,
    updateNodeTextContent,
    updateNodePrompt,
    mentionReferencesForNode,
    queueMentionAssetSearch,
    mentionThumbnailFor,
    previewMentionReference,
    locateMentionReference,
    startResize,
    moveResize,
    endResize,
    stopGenerationByNodeId,
    duplicateSelectedNode,
    adjustNodeFontSize,
    openImageToolDialog,
    flipCanvasImageNode,
    generatePanoramaCanvasImage,
    createImageReversePromptNodes,
    generateImageFromTextNode,
    archiveCanvasMediaNode,
    archiveCanvasTextNode,
    retryImageNode,
    retryTextNode,
    retryAudioNode,
    retryVideoNode,
    removeNode,
  });

  return (
    <div className="canvas-page real-canvas-page">
      {/* 步骤2：聊天台跳转过来的加载覆盖层 —— 从首屏接管覆盖，直到项目快照加载完成（步骤3-5就绪后撤下） */}
      {bootstrapActive && (
        <div
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-4"
          style={{
            background: "rgba(10, 12, 13, 0.9)",
            backdropFilter: "blur(18px)",
            WebkitBackdropFilter: "blur(18px)",
          }}
        >
          <Loader2 className="spin" size={40} style={{ color: "var(--primary)" }} />
          <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>正在打开画布…</p>
          <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>正在同步画布内容与创作指令</p>
        </div>
      )}
      <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*" multiple hidden disabled={projectActionDisabled} onChange={(event) => event.target.files && void uploadFilesAsNodes(event.target.files)} />
      <input ref={replaceImageInputRef} type="file" accept="image/*" hidden disabled={projectActionDisabled} onChange={(event) => void replaceCanvasImage(event.target.files?.[0])} />
      <input ref={replaceMediaInputRef} type="file" accept="video/*,audio/*" hidden disabled={projectActionDisabled} onChange={(event) => { const file = event.target.files?.[0]; const kind = file?.type.startsWith("video/") ? "video" as const : "audio" as const; void uploadMediaToNode(replaceMediaNodeIdRef.current, file, kind); }} />
      <input ref={fragmentInputRef} type="file" accept="application/zip,.zip" hidden disabled={projectActionDisabled || fragmentBusy} onChange={(event) => void importCanvasFragment(event.target.files?.[0])} />
      <input ref={projectArchiveInputRef} type="file" accept="application/zip,.zip" hidden disabled={projectActionDisabled || projectArchiveBusy} onChange={(event) => void importCanvasProjectArchive(event.target.files?.[0])} />
      <div className="canvas-heading">
        <div className="page-intro">
          <div className="canvas-switcher-container">
            {projectTitleEditing ? (
              <input
                className="canvas-switcher-title-input"
                autoFocus
                value={projectTitleDraft}
                disabled={projectTitleSaving}
                aria-label="画布名称"
                onChange={(event) => setProjectTitleDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void commitTitleEdit();
                  }
                  if (event.key === "Escape") setProjectTitleEditing(false);
                }}
                onBlur={() => void commitTitleEdit()}
              />
            ) : (
            <Popover open={canvasSwitcherOpen} onOpenChange={setCanvasSwitcherOpen}>
              <PopoverTrigger asChild>
                <button className="canvas-switcher-trigger" disabled={projectActionDisabled} title="单击切换画布 · 双击重命名" onDoubleClick={(event) => { event.preventDefault(); beginTitleEdit(); }}>
                  <span className="canvas-switcher-title">{projectTitle || "无限画布"}</span>
                  <ChevronDown size={16} className={canvasSwitcherOpen ? "rotated" : ""} />
                </button>
              </PopoverTrigger>
              <PopoverContent className="canvas-switcher-popover" align="start" sideOffset={8}>
                <div className="canvas-switcher-search">
                  <Search size={14} />
                  <input
                    value={canvasSwitcherQuery}
                    onChange={(event) => setCanvasSwitcherQuery(event.target.value)}
                    placeholder="搜索画布…"
                  />
                </div>
                <div className="canvas-switcher-list">
                  {filteredProjects.map((project) => (
                    <button
                      key={project.id}
                      className={`canvas-switcher-item ${project.id === projectId ? "active" : ""}`}
                      onClick={() => {
                        setCanvasSwitcherOpen(false);
                        setCanvasSwitcherQuery("");
                        void switchCanvasProject(project.id);
                      }}
                      disabled={projectActionDisabled}
                    >
                      <div className="canvas-switcher-item-avatar">
                        <Palette size={14} />
                      </div>
                      <span className="canvas-switcher-item-title">{project.title}</span>
                      {project.id === projectId ? <Check size={14} /> : null}
                    </button>
                  ))}
                  {!filteredProjects.length ? (
                    <div className="canvas-switcher-empty">
                      <p>无匹配画布</p>
                    </div>
                  ) : null}
                </div>
                <div className="canvas-switcher-footer">
                  <button className="canvas-switcher-new" onClick={() => { setCanvasSwitcherOpen(false); setCreateDialogOpen(true); }} disabled={projectActionDisabled}>
                    <Plus size={14} />
                    新建画布
                  </button>
                </div>
              </PopoverContent>
            </Popover>
            )}
            <p className="canvas-switcher-desc">节点、连线和生成结果都会保存到 {currentProjectDisplayScope === "team" ? "团队" : "个人"} 工作区服务端快照。</p>
          </div>
        </div>
        <div className="canvas-head-actions">
          <button className="outline-button small canvas-home-button" onClick={() => navigate("/dashboard")} title="返回首页" aria-label="返回首页"><Home size={15} /> 首页</button>
          <div className="scope-switch mini-scope">{scopeOptions.map((item) => <button key={item.value} className={currentProjectDisplayScope === item.value ? "active" : ""} onClick={() => void switchCanvasScope(item.value)} disabled={projectActionDisabled}>{item.label}</button>)}</div>
          <button className="outline-button small canvas-icon-button" title="撤销" aria-label="撤销" onClick={() => void undoCanvas()} disabled={!canUndo || projectActionDisabled}><Undo2 size={15} /></button>
          <button className="outline-button small canvas-icon-button" title="重做" aria-label="重做" onClick={() => void redoCanvas()} disabled={!canRedo || projectActionDisabled}><Redo2 size={15} /></button>
          <button
            className="outline-button small"
            onClick={() => void persistSnapshot()}
            disabled={saving || syncStatus === "saving" || projectActionDisabled || !snapshotWriteReady}
            title={projectScopePending ? "正在确认项目工作区，保存已暂停以避免写入错误空间" : !snapshotWriteReady ? "未取得完整原始快照，保存已暂停以保护现有画布数据" : undefined}
          >
            <Save size={15} /> {projectScopePending ? "确认工作区" : switching ? "切换中" : saving || syncStatus === "saving" ? "保存中" : snapshotWriteReady ? "保存" : "保存已暂停"}
          </button>
          <button className={`outline-button small inspector-trigger ${inspectorOpen ? "is-active" : ""}`} onClick={() => setInspectorOpen((value) => !value)} disabled={projectActionDisabled}><PanelRight size={15} /> 检查器</button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="outline-button small canvas-icon-button canvas-more-trigger" title="更多操作" aria-label="更多操作" disabled={projectActionDisabled}><MoreHorizontal size={16} /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="canvas-more-menu" align="end" sideOffset={8}>
              <DropdownMenuItem disabled={!selectedNode || projectActionDisabled} onSelect={() => void duplicateSelectedNode()}><Copy size={14} /> 复制节点</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={exporting || projectActionDisabled} onSelect={() => void exportImageNodes()}><Archive size={14} /> 导出图片节点</DropdownMenuItem>
              <DropdownMenuItem disabled={projectArchiveBusy || projectActionDisabled} onSelect={() => void exportCurrentCanvasProject()}><Download size={14} /> 导出完整项目</DropdownMenuItem>
              <DropdownMenuItem disabled={projectArchiveBusy || projectActionDisabled} onSelect={() => projectArchiveInputRef.current?.click()}><Upload size={14} /> 导入完整项目</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!selectedNodeIds.size || fragmentBusy || projectActionDisabled} onSelect={() => void exportSelectedCanvasFragment()}><Download size={14} /> 导出选区包</DropdownMenuItem>
              <DropdownMenuItem disabled={fragmentBusy || projectActionDisabled} onSelect={() => fragmentInputRef.current?.click()}><Upload size={14} /> 导入选区包</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="canvas-more-danger" disabled={projectActionDisabled} onSelect={() => { setDeleteProjectError(""); setDeleteProjectOpen(true); }}><Trash2 size={14} /> 删除画布</DropdownMenuItem>
              <DropdownMenuItem className="canvas-more-danger" disabled={projectActionDisabled || clearCanvasBusy || (!nodes.length && !edges.length && !groups.length)} onSelect={() => { setClearCanvasError(""); setClearCanvasOpen(true); }}><Eraser size={14} /> 清空画布</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className={`canvas-workspace real-canvas-workspace ${inspectorOpen && !projectActionDisabled ? "inspector-open" : ""} ${agentOpen && !projectActionDisabled ? "agent-open" : ""} ${connectFrom ? "connecting" : ""}`}>
        <CanvasStage
          stageRef={stageRef}
          gridRef={gridRef}
          backgroundMode={backgroundMode}
          zoom={zoom}
          panX={panX}
          panY={panY}
          projectActionDisabled={projectActionDisabled}
          topToolbar={{
            disabled: projectActionDisabled,
            connecting: Boolean(connectFrom),
            selectedNodeId: selectedNode?.id,
            canUndo,
            canRedo,
            uploading,
            selectedNodeCount: selectedNodeIds.size,
            selectedGroupId,
            selectedGroupRunning: runningGroupId === selectedGroupId,
            groupRunning: Boolean(runningGroupId),
            fragmentBusy,
            agentOpen,
            onActivateConnection: activateConnectionMode,
            onUndo: () => void undoCanvas(),
            onRedo: () => void redoCanvas(),
            onAddNode: addNode,
            onUpload: () => fileInputRef.current?.click(),
            onOpenAssets: openAssetPicker,
            onCreateGroup: createGroupFromSelected,
            onConnectSelection: () => setConnectSelectionOpen(true),
            onRunGroup: (groupId) => void runCanvasGroupGeneration(groupId),
            onUngroup: ungroupCanvasGroup,
            onExportSelection: () => void exportSelectedCanvasFragment(),
            onRemoveSelection: () => removeNodes(selectedNodeIdsRef.current),
            onOpenSeedanceAssets: setSeedanceAssetNodeId,
            onToggleAgent: () => setAgentOpen((value) => !value),
          }}
          bottomToolbar={{
            disabled: projectActionDisabled,
            saving,
            syncSaving: syncStatus === "saving",
            snapshotWriteReady,
            zoom,
            minimapOpen,
            showImageInfo,
            backgroundMode,
            onPersist: () => void persistSnapshot(),
            onZoomOut: () => zoomCanvasAroundCenter(viewportRef.current.zoom - 10),
            onZoomIn: () => zoomCanvasAroundCenter(viewportRef.current.zoom + 10),
            onToggleMinimap: () => setMinimapOpen((open) => !open),
            onFit: fitCanvasToContent,
            onToggleImageInfo: () => setShowImageInfo((value) => !value),
            onSetBackground: setBackgroundMode,
          }}
          canvasInteractionBlocked={canvasInteractionBlocked}
          switching={switching}
          projectScopePending={projectScopePending}
          groups={groups}
          selectedGroupId={selectedGroupId}
          selectionBoxStyle={selectionBoxStyle}
          connectionLayerBounds={connectionLayerBounds}
          edges={edges}
          nodes={nodes}
          nodeMap={nodeMap}
          selectedEdgeId={selectedEdgeId}
          hoveredEdgeId={hoveredEdgeId}
          connectionPreviewPath={connectionPreviewPath}
          renderedNodes={renderedNodes}
          nodeCardProps={(node) => ({
            node,
            previews,
            isSelected: selectedNodeIds.has(node.id),
            isSelectedSingle: selectedId === node.id,
            isHovered: hoveredId === node.id,
            isConnectionTarget: connectionTargetId === node.id,
            isConnecting: Boolean(connectFrom),
            connectActiveTarget: connectFrom === node.id && connectHandleType === "target",
            connectActiveSource: connectFrom === node.id && connectHandleType === "source",
            isTitleEditing: titleEditingNodeId === node.id,
            titleDraft: titleEditingNodeId === node.id ? titleDraft : "",
            isInlineEditing: editingInlineNodeId === node.id,
            isRunning: runningNodeIds.has(node.id),
            progress: jobProgressByNode[node.id] || 0,
            isPinned: pinnedToolbarNodeId === node.id,
            captureBusy: Boolean(captureFrameNodeId),
            isCapturingFrame: captureFrameNodeId === node.id,
            showImageInfo,
            imageToolBusy,
            storyboardBusy,
            actions: nodeCardActions,
          })}
          agentOpen={agentOpen}
          minimapOpen={minimapOpen}
          visibleNodeCount={visibleNodes.length}
          minimapModel={minimapModel}
          selectedNodeIds={selectedNodeIds}
          contextMenu={contextMenu}
          contextMenuFlipX={contextMenuFlipX}
          contextMenuStyle={contextMenuStyle}
          contextMenuNode={contextMenuNode}
          previews={previews}
          captureFrameNodeId={captureFrameNodeId}
          pendingConnectionCreate={pendingConnectionCreate}
          pendingConnectionMenuStyle={pendingConnectionMenuStyle}
          actions={{
            handleStagePointerDown,
            openCanvasContextMenu,
            handleCanvasDoubleClick,
            uploadFilesAsNodes,
            selectCanvasGroup,
            startGroupDrag,
            moveGroupDrag,
            endGroupDrag,
            startGroupResize,
            moveGroupResize,
            endGroupResize,
            handleCanvasLinesPointerDown,
            handleCanvasLinesPointerMove,
            handleCanvasLinesPointerLeave,
            handleCanvasLinesClick,
            handleCanvasLinesDoubleClick,
            handleCanvasLinesContextMenu,
            handleEdgeClick,
            removeEdge,
            setHoveredEdgeId,
            clientToStagePoint,
            screenToCanvasPoint,
            setContextMenu,
            toggleAgent: () => setAgentOpen((value) => !value),
            navigateFromMinimap,
            node: nodeCardActions,
            activateConnectionMode,
            copySelectedNodes,
            openConnectSelection: () => setConnectSelectionOpen(true),
            generateFromNode,
            renderCanvasSubmenu,
            copyCanvasImagePrompt,
            addNode,
            pasteCopiedNodes,
            createNodeFromConnectionDraft,
            cancelPendingConnectionCreate,
          }}
        />

        <CanvasInspector
          panelRef={panelRef}
          selectedNode={selectedNode}
          selectedGroup={selectedGroup}
          inspectorOpen={inspectorOpen}
          projectActionDisabled={projectActionDisabled}
          selectedPanelStyle={selectedPanelStyle}
          edges={edges}
          nodes={nodes}
          previews={previews}
          visiblePromptPresets={visiblePromptPresets}
          imageToolBusy={imageToolBusy}
          storyboardBusy={storyboardBusy}
          selectedGenerationMode={selectedGenerationMode}
          selectedGenerationModel={selectedGenerationModel}
          selectedGenerationModelLabel={(textModelLabels[selectedGenerationModel] || selectedGenerationModel || "选择模型").split("::").at(-1) || "选择模型"}
          generationModelOptions={selectedGenerationMode === "text"
            ? textModels.map((item) => ({ value: item, label: textModelLabels[item] || item }))
            : selectedGenerationMode === "image"
              ? (modelCatalog?.models || []).map((item) => ({ value: item, label: imageModelLabel(item, modelCatalog || undefined) }))
              : selectedGenerationMode === "video"
                ? videoModels.map((item) => ({ value: item, label: textModelLabels[item] || item }))
                : audioModels.map((item) => ({ value: item, label: textModelLabels[item] || item }))}
          selectedVideoConfig={selectedVideoConfig || null}
          selectedVideoSeedance={selectedVideoSeedance}
          selectedVideoDurations={selectedVideoConfig
            ? selectedVideoSeedance
              ? isLongSeedanceVideoModel(selectedVideoConfig.model)
                ? videoModelSettings.seedanceLongDurations
                : videoModelSettings.seedanceDurations
              : videoModelSettings.openAiDurations
            : []}
          selectedVideoResolutions={selectedVideoSeedance ? videoModelSettings.seedanceResolutions : videoModelSettings.openAiResolutions}
          selectedVideoRatios={selectedVideoSeedance ? videoModelSettings.seedanceRatios : videoModelSettings.openAiSizes.map(sizeToRatioLabel)}
          selectedAudioConfig={selectedAudioConfig || null}
          audioVoiceOptions={audioVoiceOptions}
          audioFormatOptions={audioFormatOptions}
          runningGroupId={runningGroupId}
          runningNodeIds={runningNodeIds}
          captureFrameNodeId={captureFrameNodeId}
          styleCategory={styleCategory}
          promptOptimizing={promptOptimizing}
          enabledSkills={enabledSkills}
          actions={{
            node: nodeCardActions,
            setInspectorOpen,
            activateConnectionMode,
            updateCanvasGroup,
            runCanvasGroupGeneration,
            ungroupCanvasGroup,
            updateNode,
            generateFromNode,
            openAssetPicker,
            selectGenerationModel: (value) => {
              if (!selectedNode) return;
              if (selectedGenerationMode === "text") setTextModel(value);
              if (selectedGenerationMode === "image") setImageModel(value);
              if (selectedGenerationMode === "video") setVideoModel(value);
              if (selectedGenerationMode === "audio") setAudioModel(value);
              updateNode(selectedNode.id, { metadata: { ...(selectedNode.metadata || {}), model: value } });
            },
            setPromptLibraryNodeId,
            setStyleCategory,
            setStoryboardEditorNodeId,
            setPresetManagerOpen,
            onSkillsOpen: () => setEnabledSkills(loadSkills().filter((skill) => skill.enabled)),
            optimizeNodePrompt,
            setSkillLibraryOpen,
            setSeedanceAssetNodeId,
            downloadSelectedMedia,
            startPanelWidthResize,
          }}
        />
        <CanvasWorkspaceDialogHost
          agent={{
            projectId,
            open: agentOpen && !projectActionDisabled,
            onClose: () => setAgentOpen(false),
            snapshot: agentSnapshot,
            canUndoOps: Boolean(agentUndoSnapshot),
            onApplyOps: applyAgentOperations,
            onExecuteWorkspaceTool: executeAgentWorkspaceTool,
            onUndoOps: undoAgentOperations,
            initialPrompt,
          }}
          skillLibrary={{ open: skillLibraryOpen, onOpenChange: setSkillLibraryOpen }}
          presetManager={{ open: presetManagerOpen, onOpenChange: setPresetManagerOpen }}
          storyboardEditor={{
            open: Boolean(storyboardEditorNodeId),
            onOpenChange: (open) => { if (!open) setStoryboardEditorNodeId(""); },
            title: nodes.find((item) => item.id === storyboardEditorNodeId)?.title || "",
            scenes: storyboardScenesFromNode(nodes.find((item) => item.id === storyboardEditorNodeId)),
            onSave: (scenes) => {
              const node = nodes.find((item) => item.id === storyboardEditorNodeId);
              if (node) updateNode(node.id, { metadata: { ...(node.metadata || {}), storyboardScenes: scenes as unknown as Record<string, unknown>[] } });
            },
          }}
          promptLibrary={{
            open: Boolean(promptLibraryNodeId),
            onOpenChange: (open) => { if (!open) setPromptLibraryNodeId(""); },
            onSelect: (prompt) => { if (promptLibraryNodeId) updateNodePrompt(promptLibraryNodeId, prompt); },
          }}
          seedanceMaterial={{
            open: Boolean(materialNodeId),
            selectedAssets: materialNode?.metadata?.seedanceMaterialAssets || [],
            onClose: () => setMaterialNodeId(""),
            onSelect: selectSeedanceMaterial,
            onRemove: removeSeedanceMaterial,
          }}
          seedanceAsset={{
            open: Boolean(seedanceAssetNodeId),
            selectedAssets: seedanceAssetNode?.metadata?.seedanceVolcanoAssets || [],
            onClose: () => setSeedanceAssetNodeId(""),
            onSelect: selectSeedanceVolcanoAsset,
            onRemove: removeSeedanceVolcanoAsset,
          }}
        />
      </div>
      <CanvasDialogHost
        imageTool={{
          dialog: imageToolDialog, busy: imageToolBusy, error: imageToolError, preview: imageToolPreview,
          node: imageToolNode, crop: imageToolCrop, cropStageRef: imageCropStageRef, draft: imageToolDraft,
          cropLocked: imageCropLocked,
          onOpenChange: (open) => {
            if (!open && imageToolBusy) return;
            if (!open) { setImageToolDialog(null); setImageToolError(""); }
          },
          onStartCropPointer: startImageCropPointer,
          onSelectMode: (mode) => setImageToolDialog((current) => current ? { ...current, mode } : current),
          onDraftChange: setImageToolDraft,
          onToggleCropLock: () => setImageCropLocked((locked) => !locked),
          onCancel: () => { setImageToolDialog(null); setImageToolError(""); },
          onRun: () => void runCanvasImageTool(),
        }}
        annotationMask={{
          annotation: {
            dataUrl: imageAnnotationPreview,
            open: Boolean(imageAnnotationNode && imageAnnotationPreview),
            onClose: () => setImageAnnotationNodeId(""),
            onConfirm: annotateCanvasImage,
          },
          mask: {
            dataUrl: imageMaskPreview, open: Boolean(imageMaskNode && imageMaskPreview),
            busy: imageToolBusy, error: imageToolError,
            onClose: () => { setImageMaskNodeId(""); setImageToolError(""); },
            onConfirm: maskEditCanvasImage,
          },
        }}
        storyboard={{
          nodeId: storyboardNodeId, busy: storyboardBusy, layout: storyboardLayout,
          selectedCount: storyboardSelectedCount,
          onClose: () => setStoryboardNodeId(""),
          onLayoutChange: setStoryboardLayout,
          onExport: () => void exportCanvasStoryboard(),
        }}
        imagePreview={{
          node: imagePreviewNode, source: imagePreviewSrc, siblings: imagePreviewSiblings,
          selectedNodeId: imagePreviewNodeId, previews,
          modelLabel: imagePreviewNode ? imageModelLabel(modelFromNode(imagePreviewNode, imageModel), modelCatalog || undefined) : "—",
          createdAt: previewAssetMeta.createdAt,
          creatorLabel: user?.display_name || user?.username || "—",
          onSelectNode: setImagePreviewNodeId,
          onSetBatchPrimary: setBatchPrimaryNode,
          onDetachBatchChild: detachBatchChildToCanvas,
          onDownload: (node) => void downloadNodeMedia(node),
          onClose: () => setImagePreviewNodeId(""),
        }}
        mentionPreview={{ preview: mentionMediaPreview, onClose: closeMentionMediaPreview }}
        assetPicker={{
          open: assetPickerOpen, insertBusy: assetPickerInsertBusy, scopeOptions, scope: assetPickerScope,
          loading: assetPickerLoading, query: assetPickerQuery, kind: assetPickerKind,
          error: assetPickerError, items: assetPickerItems, selectedIds: assetPickerSelectedIds,
          onOpenChange: setAssetPickerOpen,
          onScopeChange: setAssetPickerScope,
          onKindChange: setAssetPickerKind,
          onQueryChange: setAssetPickerQuery,
          onSearch: searchAssetPicker,
          onToggleItem: toggleAssetPickerItem,
          onCancel: cancelAssetPicker,
          onInsert: () => void insertAssetPickerSelection(),
        }}
        connectSelection={{
          open: connectSelectionOpen, selectedNodeCount: selectedNodeIds.size,
          disabled: projectActionDisabled, nodes,
          onOpenChange: setConnectSelectionOpen,
          onConnect: connectSelectedNodesToConfig,
        }}
        destructive={{
          clearOpen: clearCanvasOpen, clearBusy: clearCanvasBusy, clearError: clearCanvasError,
          deleteOpen: deleteProjectOpen, deleteBusy: deleteProjectBusy, deleteError: deleteProjectError,
          projectTitle,
          onClearOpenChange: (open) => {
            if (!clearCanvasBusy) {
              setClearCanvasOpen(open);
              if (!open) setClearCanvasError("");
            }
          },
          onClear: () => void clearCurrentCanvas(),
          onDeleteOpenChange: (open) => { if (!deleteProjectBusy) setDeleteProjectOpen(open); },
          onDelete: () => void removeCurrentProject(),
        }}
      />
    </div>
  );
}

// The route-level provider lives in pages/CanvasWorkspaceView.tsx.
















/** 视频节点的生成方式标签（对应参考的标签组，首位帧替代动作模仿）。 */



/** 读取节点上保存的分镜场景列表。 */
function storyboardScenesFromNode(node: CanvasNodeData | undefined): StoryboardScene[] {
  const raw = node?.metadata?.storyboardScenes;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).map((item) => ({
    id: typeof item.id === "string" ? item.id : crypto.randomUUID(),
    startTime: Math.max(0, Number(item.startTime) || 0),
    endTime: Math.max(0, Number(item.endTime) || 5),
    quality: (item.quality === "标准" || item.quality === "流畅" || item.quality === "高清") ? item.quality : "标准",
    lightEffect: "选择",
    visual: typeof item.visual === "string" ? item.visual : "",
    camera: typeof item.camera === "string" ? item.camera : "",
    materials: typeof item.materials === "string" ? item.materials : "",
    sfx: Boolean(item.sfx),
    bgm: Boolean(item.bgm),
  }));
}

function canvasImageToolLabel(mode: CanvasImageToolMode) {
  return ({ crop: "裁剪", focus: "聚焦提取", split: "切图", upscale: "放大", compress: "压缩", outpaint: "扩图", angle: "AI 多角度" } as const)[mode];
}

function readCanvasImageSize(dataUrl: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({
      width: Math.max(1, image.naturalWidth || image.width),
      height: Math.max(1, image.naturalHeight || image.height),
    });
    image.onerror = () => reject(new Error("无法读取原图尺寸"));
    image.src = dataUrl;
  });
}

function readCanvasFileDataUrl(file: File, signal?: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    const cleanup = () => signal?.removeEventListener("abort", handleAbort);
    const handleAbort = () => {
      reader.abort();
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    reader.onload = () => {
      cleanup();
      resolve(typeof reader.result === "string" ? reader.result : "");
    };
    reader.onerror = () => {
      cleanup();
      reject(reader.error || new Error(`读取图片“${file.name}”失败`));
    };
    if (signal?.aborted) {
      handleAbort();
      return;
    }
    signal?.addEventListener("abort", handleAbort, { once: true });
    reader.readAsDataURL(file);
  });
}


/** 生成时把扩展比例（5:4/全景图等）回落到后端支持的值。 */



















/** 批次展开网格间距（卡片间留白，画布单位） */

/** 批次子图的网格位：根占左下格，子图先向上、再向右按两列铺开（上 → 右上 → 右 → …） */

/** 把批次子图吸附回以基底节点为基点的网格位（展开时调用，防止手动拖动后错位） */








function sortPromptPresets(presets: PromptPreset[]) {
  const rank: Record<PromptPreset["priority"], number> = { pinned: 0, high: 1, normal: 2, low: 3 };
  return [...presets].sort((a, b) => rank[a.priority] - rank[b.priority] || a.sort_order - b.sort_order || a.title.localeCompare(b.title, "zh-CN"));
}

async function waitForAssetExportReady(exportId: string, scope: WorkspaceScope) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const state = await getAssetExport(exportId, scope);
    if (state.status === "succeeded" || state.status === "partial_failed") return state;
    if (state.status === "failed" || state.status === "canceled" || state.status === "expired") {
      throw new Error(state.error || `导出任务已结束：${state.status}`);
    }
    await wait(1_200);
  }
  throw new Error("导出任务等待超时，请稍后到资产库导出面板下载");
}






/** OpenAI 尺寸值转宽高比标签（1280x720 → 16:9）。 */
function sizeToRatioLabel(size: string) {
  if (size === "auto") return "adaptive";
  const [w, h] = size.split("x").map(Number);
  if (!w || !h) return size;
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const d = gcd(w, h);
  return `${w / d}:${h / d}`;
}


function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}


function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}
