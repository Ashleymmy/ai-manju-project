import {
  Archive,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eraser,
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
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent, type ReactNode } from "react";
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
import {
  ApiError,
  audioFileName,
  audioFormatOptions,
  audioMimeType,
  audioVoiceOptions,
  createProject,
  createAssetExport,
  createVideoGenerationTask,
  cancelJob,
  deleteProject,
  downloadAssetExport,
  fetchAiModels,
  fetchImageModels,
  generateImages,
  generatedImagesFromJob,
  getAsset,
  getAssetLibrary,
  getAssetContentObjectUrl,
  getJobs,
  getAssetExport,
  getPreferences,
  getProject,
  getProjects,
  updateProject,
  getProjectSnapshot,
  imageModelLabel,
  isLongSeedanceVideoModel,
  isSeedanceVideoModel,
  jobErrorMessage,
  normalizeVideoGenerationConfig,
  normalizeAudioGenerationConfig,
  pollVideoGenerationTask,
  publicApiError,
  requestAudioGeneration,
  requestAiText,
  saveProjectSnapshot,
  uploadAsset,
  updateAssetUserState,
  videoGenerationResultToBlob,
  videoModelSettings,
  waitForImageJob,
  type Asset,
  type AssetCategory,
  type AssetSourceType,
  type AudioGenerationConfig,
  type CanvasProject,
  type GeneratedImage,
  type ImageModelCatalog,
  type PromptPreset,
  type ResponseInputMessage,
  type SeedanceAsset,
  type SeedanceMaterialAsset,
  type VideoGenerationConfig,
  type VideoGenerationReferences,
  type VideoGenerationResult,
  type VideoGenerationTask,
  type VideoProvider,
  type WorkspaceScope,
} from "@/services/api";
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
} from "@/features/canvas/ui/CanvasDialogs";
import { CanvasWorkspaceDialogHost } from "@/features/canvas/ui/CanvasWorkspaceDialogHost";
import { CanvasStage } from "@/features/canvas/ui/CanvasStage";
import { CanvasDialogHost } from "@/features/canvas/ui/CanvasDialogHost";
import {
  extractProjectCanvasData,
  extractServerCanvasSnapshotData,
  type CanvasSnapshotBase,
} from "@/features/canvas/domain/snapshotRoundTrip";
import { consumeCanvasBootstrap, peekCanvasBootstrap } from "@/lib/canvas-bootstrap";
import {
  canvasNodesInSelectionRect,
  captureCanvasNodeOrigins,
  deleteCanvasNodesAndEdges,
  moveCanvasNodesFromOrigins,
  normalizeCanvasSelectionRect,
  shouldSuppressCanvasNodeClickAfterPointerSelection,
  toggleCanvasNodeSelection,
  type CanvasNodeOrigins,
  type CanvasPoint,
} from "@/features/canvas/domain/selection";
import { DEFAULT_CANVAS_SHORTCUTS, eventMatchesShortcut, resolveCanvasShortcuts, type CanvasShortcutBindings } from "@/features/canvas/domain/hotkeys";
import { isCanvasHotkeyEditingTarget } from "@/features/canvas/adapters/hotkeyTarget";
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
  canvasClientPointToWorld,
  connectableCanvasNodesToConfig,
  connectCanvasNodesToConfig,
  createConnectedCanvasGraph,
  defaultCanvasConnectionHandle,
  findCanvasConnectionDropTarget,
  isActiveCanvasConnectionPointer,
  isHiddenCanvasBatchChild,
  normalizeCanvasConnection,
} from "@/features/canvas/domain/connections";
import {
  CANVAS_ZOOM_MAX,
  CANVAS_ZOOM_MIN,
  captureCanvasHistoryEntry,
  commitCanvasHistory,
  fitCanvasViewport,
  panCanvasViewport,
  redoCanvasHistory,
  undoCanvasHistory,
  zoomCanvasViewportAtPoint,
  type CanvasHistoryEntry,
  type CanvasHistoryStack,
} from "@/features/canvas/domain/history";
import {
  createCanvasGroup,
  normalizeCanvasGroups,
  removeNodesFromCanvasGroups,
  resizeCanvasGroup,
  type CanvasGroupData,
  type CanvasGroupResizeCorner,
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
import { buildCanvasMinimapModel, canvasMinimapWorldPoint, type CanvasMinimapModel } from "@/features/canvas/domain/minimap";
import {
  buildCanvasFragmentPackage,
  canvasFragmentAssetIds,
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
  moveImageCropRect,
  resizeImageCropRect,
  splitDataUrl,
  upscaleDataUrl,
  type ImageCropRect,
  type ImageCropResizeHandle,
  type StoryboardLayout,
} from "@/lib/canvas-image-data";
import {
  buildCanvasTextRequestMessages,
  canvasTextComposerValue,
  canvasTextDisplayValue,
  canvasTextRequestPrompt,
  isGeneratedCanvasText,
  updateCanvasNodeComposer,
  updateCanvasTextDisplay,
} from "@/features/canvas/domain/text";
import {
  listCanvasTextAssets,
  saveCanvasTextAsset,
  type CanvasTextAsset,
} from "@/lib/canvas-text-assets";
import {
  canvasSeedanceVideoReferences,
  hydrateCanvasVideoReferences,
  mergeCanvasVideoReferences,
  videoResultPersistentMetadata,
  type CanvasVideoReferenceSnapshot,
} from "@/features/canvas/domain/video";
import { createBrowserFile } from "@/features/canvas/adapters/browserFile";
import {
  buildCanvasMentionGenerationContext,
  buildCanvasMentionReferences,
  extractCanvasMentionTokens,
  type CanvasMentionAsset,
  type CanvasMentionReference,
} from "@/features/canvas/domain/mentions";
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
  canvasViewportFromAgent,
  parseCanvasSnapshot as parseSnapshot,
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
  resetInterruptedCanvasGenerations,
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
  cubicCanvasPoint,
  distanceToCanvasEdge,
  distanceToCanvasSegment,
  nearestCanvasEdgeIdAtPoint,
} from "@/features/canvas/domain/geometry";
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

type CanvasAssetPickerKind = "all" | "text" | "image" | "video" | "audio";
type CanvasAssetPickerItem = {
  id: string;
  type: Exclude<CanvasAssetPickerKind, "all">;
  name: string;
  scope: WorkspaceScope;
  source: "server" | "local-text";
  serverAsset?: Asset;
  textAsset?: CanvasTextAsset;
  category?: string;
  size?: number;
  contentType?: string;
};
type CanvasSyncStatus = "loading" | "pending" | "saving" | "synced" | "error";

type CanvasGenerationRequest = {
  requestId: string;
  targetNodeId: string;
  originNodeId: string;
  runningNodeId: string;
  projectKey: string;
  scope: WorkspaceScope;
  controller: AbortController;
  jobId?: string;
  provider?: VideoProvider;
};

type CanvasGenerationPreparation = {
  id: string;
  projectKey: string;
  originNodeId: string;
  targetNodeId?: string;
  referenceNodeIds: string[];
  controller: AbortController;
};

type CanvasImageTargetRunInput = {
  targetNodeId: string;
  originNodeId: string;
  runningNodeId: string;
  projectKey: string;
  scope: WorkspaceScope;
  prompt: string;
  model: string;
  size: ImageSizeValue;
  quality: ImageQualityValue;
  referenceFiles: File[];
  maskFile?: File;
  existingJobId?: string;
};

type CanvasTextTargetRunInput = {
  targetNodeId: string;
  originNodeId: string;
  runningNodeId: string;
  projectKey: string;
  scope: WorkspaceScope;
  prompt: string;
  model: string;
  messages?: ResponseInputMessage[];
};

type CanvasVideoTargetRunInput = {
  targetNodeId: string;
  originNodeId: string;
  runningNodeId: string;
  projectKey: string;
  scope: WorkspaceScope;
  prompt: string;
  config: VideoGenerationConfig;
  references: VideoGenerationReferences;
  referenceInputs?: CanvasVideoReferenceSnapshot;
  existingTask?: VideoGenerationTask;
};

type CanvasAudioTargetRunInput = {
  targetNodeId: string;
  originNodeId: string;
  runningNodeId: string;
  projectKey: string;
  scope: WorkspaceScope;
  prompt: string;
  config: AudioGenerationConfig;
};

type CanvasContextMenuState = {
  x: number;
  y: number;
  canvasX: number;
  canvasY: number;
  nodeId?: string;
  edgeId?: string;
};

type ConnectionHandleType = "source" | "target";

type CanvasConnectionDraft = {
  nodeId: string;
  handleType: ConnectionHandleType;
};

type CanvasConnectionDropTarget = {
  nodeId: string;
  isNearNode: boolean;
};

type PendingConnectionCreateState = {
  x: number;
  y: number;
  canvasX: number;
  canvasY: number;
  connection: CanvasConnectionDraft;
};

type CanvasPanMode = "idle" | "hold-pan" | "locked-pan";

type CanvasPanState = {
  mode: CanvasPanMode;
  startClientX: number;
  startClientY: number;
  lastClientX: number;
  lastClientY: number;
  startPanX: number;
  startPanY: number;
  lastMiddleDownAt: number;
};

type CanvasSelectionBoxState = {
  start: CanvasPoint;
  current: CanvasPoint;
  additive: boolean;
  baseIds: Set<string>;
};

type CanvasDragState = {
  id: string;
  startX: number;
  startY: number;
  origins: CanvasNodeOrigins;
  moved: boolean;
  suppressClick: boolean;
};

type CanvasResizeState = {
  id: string;
  startX: number;
  startY: number;
  width: number;
  height: number;
  currentWidth: number;
  currentHeight: number;
  moved: boolean;
};

type CanvasGroupDragState = {
  id: string;
  startX: number;
  startY: number;
  position: { x: number; y: number };
  origins: CanvasNodeOrigins;
  moved: boolean;
};

type CanvasGroupResizeState = {
  id: string;
  corner: CanvasGroupResizeCorner;
  startX: number;
  startY: number;
  group: CanvasGroupData;
  moved: boolean;
};

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

const CANVAS_STAGE_OFFSET = 52;
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
const CONNECTION_NODE_HIT_PADDING = 28;
const CONNECTION_HANDLE_HIT_RADIUS = 18;
const CANVAS_EDGE_HIT_RADIUS = 22;






const MIDDLE_PAN_DOUBLE_CLICK_MS = 260;






async function getProjectFromCanonicalScope(projectId: string, preferredScope: WorkspaceScope) {
  try {
    const project = await getProject(projectId, preferredScope);
    return { project, scope: projectScopeFromServer(project, preferredScope) };
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
  }

  const fallbackScope: WorkspaceScope = preferredScope === "personal" ? "team" : "personal";
  const project = await getProject(projectId, fallbackScope);
  return { project, scope: projectScopeFromServer(project, fallbackScope) };
}

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

function setDocumentPanCursor(active: boolean) {
  if (typeof document === "undefined") return;
  document.body.style.cursor = active ? "grabbing" : "";
}

export default function CanvasWorkspaceView() {
  const [location, navigate] = useLocation();
  const { user } = useAuth();
  const projectId = location.startsWith("/canvas/") ? decodeURIComponent(location.slice("/canvas/".length).split("?")[0]) : "";
  const [scope, setScope] = useState<WorkspaceScope>(() => scopeFromLocation(location));
  const [projects, setProjects] = useState<CanvasProject[]>([]);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(() => new Set());
  const [projectBatchBusy, setProjectBatchBusy] = useState(false);
  const [projectDeleteIds, setProjectDeleteIds] = useState<string[]>([]);
  const [projectDeleteError, setProjectDeleteError] = useState("");
  const [projectTitle, setProjectTitle] = useState("");
  const [canonicalProjectScope, setCanonicalProjectScope] = useState<WorkspaceScope | null>(null);
  const [nodes, setNodes] = useState<CanvasNodeData[]>([]);
  const [edges, setEdges] = useState<CanvasEdgeData[]>([]);
  const [groups, setGroups] = useState<CanvasGroupData[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(() => new Set());
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [connectFrom, setConnectFrom] = useState("");
  const [connectHandleType, setConnectHandleType] = useState<ConnectionHandleType>("source");
  const [zoom, setZoom] = useState(90);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [backgroundMode, setBackgroundMode] = useState<CanvasBackgroundMode>("dots");
  const [showImageInfo, setShowImageInfo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [snapshotWriteReady, setSnapshotWriteReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<CanvasSyncStatus>("loading");
  const [snapshotVersion, setSnapshotVersion] = useState(0);
  const [snapshotUpdatedAt, setSnapshotUpdatedAt] = useState("");
  const [syncError, setSyncError] = useState("");
  const [switching, setSwitching] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createDialogTitle, setCreateDialogTitle] = useState("未命名画布");
  const [createDialogScope, setCreateDialogScope] = useState<WorkspaceScope>(scope);
  const [createDialogBusy, setCreateDialogBusy] = useState(false);
  const [createDialogError, setCreateDialogError] = useState("");
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);
  const [deleteProjectBusy, setDeleteProjectBusy] = useState(false);
  const [deleteProjectError, setDeleteProjectError] = useState("");
  const [clearCanvasOpen, setClearCanvasOpen] = useState(false);
  const [clearCanvasBusy, setClearCanvasBusy] = useState(false);
  const [clearCanvasError, setClearCanvasError] = useState("");
  const [connectSelectionOpen, setConnectSelectionOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  // 聊天台引导流程：覆盖层从首屏接管（步骤2），用户输入原文在加载完成后交接给 Agent 面板（步骤5）
  const [bootstrapActive, setBootstrapActive] = useState(() => Boolean(projectId && peekCanvasBootstrap(projectId)));
  const [initialPrompt, setInitialPrompt] = useState("");
  const bootstrapPromptRef = useRef("");
  const [agentUndoSnapshot, setAgentUndoSnapshot] = useState<CanvasAgentSnapshot | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [pinnedToolbarNodeId, setPinnedToolbarNodeId] = useState("");
  const shortcutsRef = useRef<CanvasShortcutBindings>({ ...DEFAULT_CANVAS_SHORTCUTS });
  // 快捷键处理器声明在生成逻辑之前，用 ref 间接调用以避免前向引用。
  const runSelectedGenerationRef = useRef<() => Promise<void>>(async () => undefined);
  const [promptLibraryNodeId, setPromptLibraryNodeId] = useState("");
  const [seedanceAssetNodeId, setSeedanceAssetNodeId] = useState("");
  const [materialNodeId, setMaterialNodeId] = useState("");
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
  const [runningNodeIds, setRunningNodeIds] = useState<Set<string>>(() => new Set());
  const [runningGroupId, setRunningGroupId] = useState("");
  const [jobProgressByNode, setJobProgressByNode] = useState<Record<string, number>>({});
  const [previews, setPreviews] = useState<Record<string, string>>({});
  // 媒体 Object URL 持久缓存：key = `${scope}:${kind}:${assetId}`。
  // 拖动只改节点坐标、资产集合不变 → 不重新请求、不更换 blob URL，<img>/<video> 的 src 保持稳定。
  const previewObjectUrlCacheRef = useRef(new Map<string, { assetId: string; url: string }>());
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [fragmentBusy, setFragmentBusy] = useState(false);
  const [projectArchiveBusy, setProjectArchiveBusy] = useState(false);
  const [canvasAssets, setCanvasAssets] = useState<Array<Asset & { scope: WorkspaceScope }>>([]);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [assetPickerScope, setAssetPickerScope] = useState<WorkspaceScope>(scope);
  const [assetPickerQuery, setAssetPickerQuery] = useState("");
  const [assetPickerKind, setAssetPickerKind] = useState<CanvasAssetPickerKind>("all");
  const [assetPickerItems, setAssetPickerItems] = useState<CanvasAssetPickerItem[]>([]);
  const [assetPickerSelectedIds, setAssetPickerSelectedIds] = useState<string[]>([]);
  const [assetPickerLoading, setAssetPickerLoading] = useState(false);
  const [assetPickerError, setAssetPickerError] = useState("");
  const [assetPickerInsertBusy, setAssetPickerInsertBusy] = useState(false);
  const [captureFrameNodeId, setCaptureFrameNodeId] = useState("");
  const isSpacePressedRef = useRef(false);
  const [panMode, setPanMode] = useState<CanvasPanMode>("idle");
  const [hoveredId, setHoveredId] = useState("");
  const [hoveredEdgeId, setHoveredEdgeId] = useState("");
  const [selectedEdgeId, setSelectedEdgeId] = useState("");
  const [editingInlineNodeId, setEditingInlineNodeId] = useState("");
  const [titleEditingNodeId, setTitleEditingNodeId] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [promptOptimizing, setPromptOptimizing] = useState(false);
  const [skillLibraryOpen, setSkillLibraryOpen] = useState(false);
  const [presetManagerOpen, setPresetManagerOpen] = useState(false);
  const [styleCategory, setStyleCategory] = useState<string>("drama");
  const [enabledSkills, setEnabledSkills] = useState<CanvasSkill[]>([]);
  const [canvasSwitcherOpen, setCanvasSwitcherOpen] = useState(false);
  const [canvasSwitcherQuery, setCanvasSwitcherQuery] = useState("");
  const [contextMenu, setContextMenu] = useState<CanvasContextMenuState | null>(null);
  // 右键/双击菜单的级联子菜单：当前展开的分组 key（空串 = 全部收起）
  const [canvasSubmenuKey, setCanvasSubmenuKey] = useState("");
  const [connectionTargetId, setConnectionTargetId] = useState("");
  const [connectionPreviewPoint, setConnectionPreviewPoint] = useState<{ x: number; y: number } | null>(null);
  const [pendingConnectionCreate, setPendingConnectionCreate] = useState<PendingConnectionCreateState | null>(null);
  const [selectionBox, setSelectionBox] = useState<CanvasSelectionBoxState | null>(null);
  const [stageBounds, setStageBounds] = useState({ width: 0, height: 0 });
  const [minimapOpen, setMinimapOpen] = useState(false);
  const [imageToolDialog, setImageToolDialog] = useState<{ nodeId: string; mode: CanvasImageToolMode } | null>(null);
  const [imageToolDraft, setImageToolDraft] = useState<CanvasImageToolDraft>(defaultCanvasImageToolDraft);
  const [imageCropLocked, setImageCropLocked] = useState(false);
  const [imageToolBusy, setImageToolBusy] = useState(false);
  const [imageToolError, setImageToolError] = useState("");
  const [imageAnnotationNodeId, setImageAnnotationNodeId] = useState("");
  const [imageMaskNodeId, setImageMaskNodeId] = useState("");
  const [imagePreviewNodeId, setImagePreviewNodeId] = useState("");
  const [storyboardNodeId, setStoryboardNodeId] = useState("");
  const [storyboardEditorNodeId, setStoryboardEditorNodeId] = useState("");
  const [storyboardLayout, setStoryboardLayout] = useState<StoryboardLayout>("grid-2x2");
  const [storyboardBusy, setStoryboardBusy] = useState(false);
  const [replaceImageNodeId, setReplaceImageNodeId] = useState("");
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceImageInputRef = useRef<HTMLInputElement>(null);
  const replaceMediaInputRef = useRef<HTMLInputElement>(null);
  const replaceMediaNodeIdRef = useRef("");
  const fragmentInputRef = useRef<HTMLInputElement>(null);
  const projectArchiveInputRef = useRef<HTMLInputElement>(null);
  const assetCatalogAbortRef = useRef<AbortController | null>(null);
  const assetPickerAbortRef = useRef<AbortController | null>(null);
  const assetSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imageCropStageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<CanvasDragState | null>(null);
  const resizeRef = useRef<CanvasResizeState | null>(null);
  const groupDragRef = useRef<CanvasGroupDragState | null>(null);
  const groupResizeRef = useRef<CanvasGroupResizeState | null>(null);
  const snapshotBaseRef = useRef<CanvasSnapshotBase | null>(null);
  const snapshotBaseKeyRef = useRef("");
  const snapshotWriteReadyRef = useRef(false);
  const snapshotSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const skipNextDirtyEffectRef = useRef(true);
  const canvasRevisionRef = useRef(0);
  const projectLoadKeyRef = useRef("");
  const canonicalProjectScopeRef = useRef<WorkspaceScope | null>(null);
  const canonicalProjectKeyRef = useRef("");
  const switchingRef = useRef(false);
  const loadingRef = useRef(true);
  const generationRequestsRef = useRef(new Map<string, CanvasGenerationRequest>());
  const generationPreparationsRef = useRef(new Map<string, CanvasGenerationPreparation>());
  const recoveredJobIdsRef = useRef(new Set<string>());
  const uploadingRef = useRef(false);
  const stageRef = useRef<HTMLElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [panelHeight, setPanelHeight] = useState(300);
  const panStateRef = useRef<CanvasPanState>({
    mode: "idle",
    startClientX: 0,
    startClientY: 0,
    lastClientX: 0,
    lastClientY: 0,
    startPanX: 0,
    startPanY: 0,
    lastMiddleDownAt: 0,
  });
  const viewportRef = useRef({ zoom: 90, panX: 0, panY: 0 });
  const connectionDragRef = useRef<{
    active: boolean;
    pointerId: number | null;
    startX: number;
    startY: number;
    moved: boolean;
  }>({ active: false, pointerId: null, startX: 0, startY: 0, moved: false });
  const nodesRef = useRef<CanvasNodeData[]>([]);
  const edgesRef = useRef<CanvasEdgeData[]>([]);
  const groupsRef = useRef<CanvasGroupData[]>([]);
  const selectedNodeIdsRef = useRef<Set<string>>(new Set());
  const hoverLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectionHandlesRef = useRef(new Map<string, HTMLElement>());
  const hoveredHandleKeyRef = useRef("");
  const selectionBoxRef = useRef<CanvasSelectionBoxState | null>(null);
  // 框选状态 rAF 合帧句柄：null 表示当前没有待执行的刷新
  const selectionBoxFlushRafRef = useRef<number | null>(null);
  // 视口（平移/缩放）rAF 合帧句柄：高频滚轮/拖拽一帧只提交一次 React 渲染
  // （移植自旧画布 Leafer 优化引擎的 frameRef 合帧模式）
  const viewportFlushRafRef = useRef<number | null>(null);
  const suppressNodeClickRef = useRef("");
  const clipboardRef = useRef<CanvasClipboardPayload<CanvasNodeData, CanvasEdgeData> | null>(null);
  const historyRef = useRef<CanvasHistoryStack<CanvasSnapshotState>>({ past: [], future: [] });
  const lastHistoryRef = useRef<CanvasSnapshotState | null>(null);
  const lastHistorySourceRef = useRef<{ nodes: CanvasNodeData[]; edges: CanvasEdgeData[]; groups: CanvasGroupData[]; backgroundMode: CanvasBackgroundMode; showImageInfo: boolean } | null>(null);
  const historyCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyingHistoryRef = useRef(false);
  const historyPausedRef = useRef(false);
  const connectFromRef = useRef("");
  const connectHandleTypeRef = useRef<ConnectionHandleType>("source");
  const connectionTargetIdRef = useRef("");
  const connectionPreviewPointRef = useRef<{ x: number; y: number } | null>(null);
  const pendingConnectionCreateRef = useRef<PendingConnectionCreateState | null>(null);

  /** 悬停延迟清空：给鼠标跨越节点与悬浮组件（上传按钮/工具条）之间间隙的时间。 */
  const handleNodeHoverStart = useCallback((id: string) => {
    if (hoverLeaveTimerRef.current) {
      clearTimeout(hoverLeaveTimerRef.current);
      hoverLeaveTimerRef.current = null;
    }
    setHoveredId(id);
  }, []);

  const handleNodeHoverEnd = useCallback((id: string) => {
    if (hoverLeaveTimerRef.current) clearTimeout(hoverLeaveTimerRef.current);
    hoverLeaveTimerRef.current = setTimeout(() => {
      setHoveredId((current) => (current === id ? "" : current));
      hoverLeaveTimerRef.current = null;
    }, 180);
  }, []);

  useEffect(() => () => {
    if (hoverLeaveTimerRef.current) clearTimeout(hoverLeaveTimerRef.current);
  }, []);

  /* ---- 连接点磁性吸附：光标靠近时连接点被吸向光标 ---- */
  const CONNECTION_HANDLE_MAGNET_RADIUS = 56;
  const CONNECTION_HANDLE_SNAP_RADIUS = 18;

  const registerConnectionHandle = useCallback((nodeId: string, side: "source" | "target", element: HTMLElement | null) => {
    const key = `${nodeId}:${side}`;
    if (element) connectionHandlesRef.current.set(key, element);
    else connectionHandlesRef.current.delete(key);
  }, []);

  useEffect(() => {
    const resetMagnet = (key: string) => {
      const element = key ? connectionHandlesRef.current.get(key) : undefined;
      if (!element) return;
      element.classList.remove("handle-magnet");
      element.style.transform = "";
    };
    const onMove = (event: globalThis.PointerEvent) => {
      if (connectionDragRef.current.active || panStateRef.current.mode !== "idle") return;
      const { clientX, clientY } = event;
      let nearestKey = "";
      let nearestDistance = Infinity;
      let nearestDx = 0;
      let nearestDy = 0;
      connectionHandlesRef.current.forEach((element, key) => {
        const rect = element.getBoundingClientRect();
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;
        const distance = Math.hypot(clientX - cx, clientY - cy);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestKey = key;
          nearestDx = clientX - cx;
          nearestDy = clientY - cy;
        }
      });
      const next = nearestDistance <= CONNECTION_HANDLE_MAGNET_RADIUS ? nearestKey : "";
      if (next !== hoveredHandleKeyRef.current) {
        resetMagnet(hoveredHandleKeyRef.current);
        hoveredHandleKeyRef.current = next;
        if (next) connectionHandlesRef.current.get(next)?.classList.add("handle-magnet");
      }
      if (!next) return;
      const element = connectionHandlesRef.current.get(next);
      if (!element) return;
      // 距离越近吸力越强：SNAP 半径内完全贴到光标上，边缘处回到节点边缘。
      const strength = nearestDistance <= CONNECTION_HANDLE_SNAP_RADIUS
        ? 1
        : Math.max(0, 1 - (nearestDistance - CONNECTION_HANDLE_SNAP_RADIUS) / (CONNECTION_HANDLE_MAGNET_RADIUS - CONNECTION_HANDLE_SNAP_RADIUS));
      element.style.transform = `translate(${(nearestDx * strength).toFixed(1)}px, ${(nearestDy * strength).toFixed(1)}px) scale(1.4)`;
    };
    window.addEventListener("pointermove", onMove as EventListener, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove as EventListener);
      resetMagnet(hoveredHandleKeyRef.current);
      hoveredHandleKeyRef.current = "";
    };
  }, []);

  const applyNodeSelection = useCallback((ids: Iterable<string>, primaryId = "", openInspector = false) => {
    const next = new Set(ids);
    const nextPrimary = primaryId && next.has(primaryId) ? primaryId : next.values().next().value || "";
    selectedNodeIdsRef.current = next;
    setSelectedNodeIds(next);
    setSelectedId(nextPrimary);
    setSelectedGroupId("");
    setSelectedEdgeId("");
    setEditingInlineNodeId((current) => current && !next.has(current) ? "" : current);
    // 与旧版一致：选中单个节点即在节点下方打开编辑面板；顶栏「检查器」按钮仍可手动收起。
    setInspectorOpen(openInspector || next.size === 1);
  }, []);

  const syncGenerationRequestState = useCallback(() => {
    const running = new Set<string>();
    generationRequestsRef.current.forEach((request) => {
      running.add(request.targetNodeId);
      running.add(request.runningNodeId);
    });
    setRunningNodeIds(running);
    setJobProgressByNode((current) => Object.fromEntries(
      Object.entries(current).filter(([nodeId]) => running.has(nodeId)),
    ));
  }, []);

  const abortGenerationPreparations = useCallback(() => {
    generationPreparationsRef.current.forEach((preparation) => preparation.controller.abort());
    generationPreparationsRef.current.clear();
  }, []);

  const abortAllGenerationRequests = useCallback(() => {
    abortGenerationPreparations();
    generationRequestsRef.current.forEach((request) => request.controller.abort());
    generationRequestsRef.current.clear();
    recoveredJobIdsRef.current.clear();
    setRunningNodeIds(new Set());
    setJobProgressByNode({});
  }, [abortGenerationPreparations]);

  const startGenerationPreparation = useCallback((input: Omit<CanvasGenerationPreparation, "id" | "controller">) => {
    const preparation: CanvasGenerationPreparation = {
      ...input,
      id: crypto.randomUUID(),
      referenceNodeIds: Array.from(new Set(input.referenceNodeIds)),
      controller: new AbortController(),
    };
    generationPreparationsRef.current.set(preparation.id, preparation);
    return preparation;
  }, []);

  const finishGenerationPreparation = useCallback((id: string) => {
    generationPreparationsRef.current.delete(id);
  }, []);

  const generationPreparationIsCurrent = useCallback((preparation: CanvasGenerationPreparation) => {
    if (preparation.controller.signal.aborted || canonicalProjectKeyRef.current !== preparation.projectKey) return false;
    const nodeIds = new Set(nodesRef.current.map((node) => node.id));
    return nodeIds.has(preparation.originNodeId)
      && (!preparation.targetNodeId || nodeIds.has(preparation.targetNodeId))
      && preparation.referenceNodeIds.every((nodeId) => nodeIds.has(nodeId));
  }, []);

  const startGenerationRequest = useCallback((input: Omit<CanvasGenerationRequest, "requestId" | "controller"> & { controller?: AbortController }) => {
    const previous = generationRequestsRef.current.get(input.targetNodeId);
    previous?.controller.abort();
    const request: CanvasGenerationRequest = {
      ...input,
      requestId: crypto.randomUUID(),
      controller: input.controller || new AbortController(),
    };
    generationRequestsRef.current.set(input.targetNodeId, request);
    syncGenerationRequestState();
    return request;
  }, [syncGenerationRequestState]);

  const currentGenerationRequest = useCallback((targetNodeId: string, requestId: string, projectKey: string) => {
    const request = generationRequestsRef.current.get(targetNodeId);
    return request?.requestId === requestId && request.projectKey === projectKey && canonicalProjectKeyRef.current === projectKey
      ? request
      : null;
  }, []);

  const finishGenerationRequest = useCallback((targetNodeId: string, requestId: string, projectKey: string) => {
    if (!currentGenerationRequest(targetNodeId, requestId, projectKey)) return false;
    generationRequestsRef.current.delete(targetNodeId);
    syncGenerationRequestState();
    return true;
  }, [currentGenerationRequest, syncGenerationRequestState]);

  const updateGenerationProgress = useCallback((request: CanvasGenerationRequest, progress: number) => {
    if (!currentGenerationRequest(request.targetNodeId, request.requestId, request.projectKey)) return;
    const normalized = Math.max(0, Math.min(100, Math.round(progress || 0)));
    setJobProgressByNode((current) => ({
      ...current,
      [request.targetNodeId]: normalized,
      [request.runningNodeId]: normalized,
    }));
  }, [currentGenerationRequest]);

  const selectedNode = nodes.find((node) => node.id === selectedId);

  const renameCurrentProject = async () => {
    const nextTitle = window.prompt("重命名画布项目", projectTitle)?.trim();
    if (!nextTitle || nextTitle === projectTitle || !projectId) return;
    try {
      await updateProject(projectId, { title: nextTitle, scope: canonicalProjectScope || "personal" });
      setProjectTitle(nextTitle);
      setProjects((items) => items.map((project) => project.id === projectId ? { ...project, title: nextTitle } : project));
      toast.success("项目已重命名");
    } catch (error) {
      toast.error(publicApiError(error, "重命名项目失败"));
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
    const scope = workspaceScopeValue(node?.metadata?.assetScope) || canonicalProjectScopeRef.current || "personal";
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
  const currentMentionScope = currentProjectDisplayScope;
  const mentionAssets = useMemo<CanvasMentionAsset[]>(
    () => canvasAssets.filter((asset) => asset.scope === currentMentionScope),
    [canvasAssets, currentMentionScope],
  );
  const mentionReferencesForNode = useCallback(
    (nodeId: string) => buildCanvasMentionReferences(nodeId, nodes, edges, mentionAssets, currentMentionScope),
    [currentMentionScope, edges, mentionAssets, nodes],
  );
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
  const screenToCanvasPoint = useCallback((clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    return canvasClientPointToWorld(clientX, clientY, rect, viewportRef.current, CANVAS_STAGE_OFFSET);
  }, []);
  const clientToStagePoint = useCallback((clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }, []);
  const edgeIdAtClientPoint = useCallback((clientX: number, clientY: number) => {
    const scale = Math.max(CANVAS_ZOOM_MIN / 100, viewportRef.current.zoom / 100);
    return nearestCanvasEdgeIdAtPoint(
      screenToCanvasPoint(clientX, clientY),
      edgesRef.current,
      nodesRef.current,
      CANVAS_EDGE_HIT_RADIUS / scale,
    );
  }, [screenToCanvasPoint]);
  const edgeIdFromCanvasEvent = useCallback((event: { clientX: number; clientY: number; target: EventTarget | null }) => {
    const target = event.target instanceof Element ? event.target : null;
    const directEdgeId = target?.closest(".real-canvas-edge-hit")?.getAttribute("data-edge-id") || "";
    return directEdgeId || edgeIdAtClientPoint(event.clientX, event.clientY);
  }, [edgeIdAtClientPoint]);
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
  const applyCanvasViewport = useCallback((next: { zoom: number; panX: number; panY: number }) => {
    const normalized = {
      zoom: Math.round(next.zoom),
      panX: Math.round(next.panX),
      panY: Math.round(next.panY),
    };
    viewportRef.current = normalized;
    setZoom(normalized.zoom);
    setPanX(normalized.panX);
    setPanY(normalized.panY);
    setContextMenu(null);
  }, []);
  // rAF 合帧提交：viewportRef 立即更新（交互数学保持一致），React 状态下一帧统一提交一次。
  // 供滚轮缩放/滚轮平移/拖拽平移等高频路径使用；离散操作（按钮、适配、撤销）仍走上面的同步版本。
  const scheduleViewportCommit = useCallback(() => {
    if (viewportFlushRafRef.current !== null) return;
    viewportFlushRafRef.current = window.requestAnimationFrame(() => {
      viewportFlushRafRef.current = null;
      const v = viewportRef.current;
      setZoom(v.zoom);
      setPanX(v.panX);
      setPanY(v.panY);
    });
  }, []);
  const applyCanvasViewportFrame = useCallback((next: { zoom: number; panX: number; panY: number }) => {
    const normalized = {
      zoom: Math.round(next.zoom),
      panX: Math.round(next.panX),
      panY: Math.round(next.panY),
    };
    viewportRef.current = normalized;
    setContextMenu(null);
    scheduleViewportCommit();
  }, [scheduleViewportCommit]);
  const focusNodeInViewport = useCallback((nodeId: string) => {
    const node = nodesRef.current.find((item) => item.id === nodeId);
    if (!node) return;
    const rect = stageRef.current?.getBoundingClientRect();
    const width = rect?.width ?? stageBounds.width;
    const height = rect?.height ?? stageBounds.height;
    const currentZoom = Math.max(0.05, viewportRef.current.zoom / 100);
    let nextZoom = currentZoom;
    if (width > 0 && height > 0) {
      const availableWidth = Math.max(240, width - 200);
      const availableHeight = Math.max(180, height - CANVAS_STAGE_OFFSET - 140);
      const fitZoom = Math.min(availableWidth / Math.max(node.width, 1), availableHeight / Math.max(node.height, 1));
      if (node.width * currentZoom > availableWidth * 0.8 || node.height * currentZoom > availableHeight * 0.8) {
        nextZoom = clamp(fitZoom * 0.9, 0.05, 5);
      } else if (node.width * currentZoom < availableWidth * 0.15 && node.height * currentZoom < availableHeight * 0.15) {
        nextZoom = clamp(Math.max(currentZoom, fitZoom * 0.75), currentZoom, 5);
      }
    }
    applyCanvasViewport({
      zoom: nextZoom * 100,
      panX: (width > 0 ? width / 2 : 0) - (node.x + node.width / 2) * nextZoom,
      panY: (height > 0 ? (height - CANVAS_STAGE_OFFSET) / 2 : 0) - (node.y + node.height / 2) * nextZoom,
    });
    applyNodeSelection([node.id], node.id, true);
    connectFromRef.current = "";
    connectHandleTypeRef.current = "source";
    connectionTargetIdRef.current = "";
    connectionPreviewPointRef.current = null;
    pendingConnectionCreateRef.current = null;
    setConnectFrom("");
    setConnectHandleType("source");
    setConnectionTargetId("");
    setConnectionPreviewPoint(null);
    setPendingConnectionCreate(null);
  }, [applyCanvasViewport, applyNodeSelection, stageBounds.height, stageBounds.width]);
  const navigateFromMinimap = useCallback((event: ReactMouseEvent<SVGSVGElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const world = canvasMinimapWorldPoint(minimapModel, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    const scale = Math.max(0.05, viewportRef.current.zoom / 100);
    applyCanvasViewport({
      zoom: viewportRef.current.zoom,
      panX: stageBounds.width / 2 - world.x * scale,
      panY: Math.max(1, stageBounds.height - CANVAS_STAGE_OFFSET) / 2 - world.y * scale,
    });
  }, [applyCanvasViewport, minimapModel, stageBounds.height, stageBounds.width]);
  const focusNodeInlineEditor = useCallback((nodeId: string) => {
    requestAnimationFrame(() => {
      const editors = stageRef.current?.querySelectorAll<HTMLTextAreaElement>(".node-inline-editor") ?? [];
      const editor = Array.from(editors).find((item) => item.dataset.nodeInlineEditorId === nodeId);
      editor?.focus();
      editor?.setSelectionRange(editor.value.length, editor.value.length);
    });
  }, []);
  const beginInlineNodeEdit = useCallback((nodeId: string) => {
    setEditingInlineNodeId(nodeId);
    focusNodeInlineEditor(nodeId);
  }, [focusNodeInlineEditor]);
  const getConnectionDropTarget = useCallback((clientX: number, clientY: number, current: CanvasConnectionDraft): CanvasConnectionDropTarget => {
    const world = screenToCanvasPoint(clientX, clientY);
    return findCanvasConnectionDropTarget(nodesRef.current, current, world, {
      padding: CONNECTION_NODE_HIT_PADDING,
      handleRadius: CONNECTION_HANDLE_HIT_RADIUS,
      zoom: viewportRef.current.zoom,
    });
  }, [screenToCanvasPoint]);
  const getConnectionDomDropTargetId = useCallback((clientX: number, clientY: number, current: CanvasConnectionDraft) => {
    const target = document.elementFromPoint(clientX, clientY);
    const nodeId = target?.closest(".real-canvas-node")?.getAttribute("data-node-id") || "";
    if (!nodeId || nodeId === current.nodeId) return "";
    const currentNodes = nodesRef.current;
    const node = currentNodes.find((item) => item.id === nodeId);
    if (!node || isHiddenCanvasBatchChild(node, currentNodes)) return "";
    return normalizeCanvasConnection(current.nodeId, nodeId, currentNodes, current.handleType) ? nodeId : "";
  }, []);

  const captureCanvasState = useCallback((): CanvasSnapshotState => ({
    ...captureCanvasHistoryEntry(nodesRef.current, edgesRef.current),
    groups: structuredClone(groupsRef.current),
    backgroundMode,
    showImageInfo,
  }), [backgroundMode, showImageInfo]);

  const commitCurrentHistory = useCallback(() => {
    if (applyingHistoryRef.current || historyPausedRef.current) return false;
    const source = lastHistorySourceRef.current;
    if (source?.nodes === nodesRef.current && source.edges === edgesRef.current && source.groups === groupsRef.current && source.backgroundMode === backgroundMode && source.showImageInfo === showImageInfo) return false;
    const previous = lastHistoryRef.current;
    const current = captureCanvasState();
    lastHistoryRef.current = current;
    lastHistorySourceRef.current = { nodes: nodesRef.current, edges: edgesRef.current, groups: groupsRef.current, backgroundMode, showImageInfo };
    if (!previous) return false;
    historyRef.current = commitCanvasHistory(historyRef.current, previous);
    setHistoryState({ canUndo: historyRef.current.past.length > 0, canRedo: false });
    return true;
  }, [backgroundMode, captureCanvasState, showImageInfo]);

  const applyHistory = useCallback((entry: CanvasSnapshotState) => {
    if (historyCommitTimerRef.current) {
      clearTimeout(historyCommitTimerRef.current);
      historyCommitTimerRef.current = null;
    }
    applyingHistoryRef.current = true;
    nodesRef.current = entry.nodes;
    edgesRef.current = entry.edges;
    groupsRef.current = entry.groups;
    setNodes(entry.nodes);
    setEdges(entry.edges);
    setGroups(entry.groups);
    setBackgroundMode(entry.backgroundMode);
    setShowImageInfo(entry.showImageInfo);
    applyNodeSelection([]);
    connectionDragRef.current.active = false;
    connectionDragRef.current.pointerId = null;
    connectionDragRef.current.moved = false;
    connectFromRef.current = "";
    connectHandleTypeRef.current = "source";
    connectionTargetIdRef.current = "";
    connectionPreviewPointRef.current = null;
    pendingConnectionCreateRef.current = null;
    setConnectFrom("");
    setConnectHandleType("source");
    setConnectionTargetId("");
    setConnectionPreviewPoint(null);
    setPendingConnectionCreate(null);
    setContextMenu(null);
    setHoveredEdgeId("");
    window.setTimeout(() => {
      lastHistoryRef.current = entry;
      lastHistorySourceRef.current = { nodes: entry.nodes, edges: entry.edges, groups: entry.groups, backgroundMode: entry.backgroundMode, showImageInfo: entry.showImageInfo };
      applyingHistoryRef.current = false;
      setHistoryState({ canUndo: historyRef.current.past.length > 0, canRedo: historyRef.current.future.length > 0 });
    }, 0);
  }, [applyNodeSelection]);

  const undoCanvas = useCallback(() => {
    if (historyPausedRef.current) return;
    if (historyCommitTimerRef.current) {
      clearTimeout(historyCommitTimerRef.current);
      historyCommitTimerRef.current = null;
    }
    commitCurrentHistory();
    const current = lastHistoryRef.current;
    if (!current) return;
    const result = undoCanvasHistory(historyRef.current, current);
    if (!result) return;
    historyRef.current = result.stack;
    applyHistory(result.entry);
  }, [applyHistory, commitCurrentHistory]);

  const redoCanvas = useCallback(() => {
    if (historyPausedRef.current) return;
    if (historyCommitTimerRef.current) {
      clearTimeout(historyCommitTimerRef.current);
      historyCommitTimerRef.current = null;
    }
    commitCurrentHistory();
    const current = lastHistoryRef.current;
    if (!current) return;
    const result = redoCanvasHistory(historyRef.current, current);
    if (!result) return;
    historyRef.current = result.stack;
    applyHistory(result.entry);
  }, [applyHistory, commitCurrentHistory]);

  const pauseCanvasHistory = useCallback(() => {
    if (historyCommitTimerRef.current) {
      clearTimeout(historyCommitTimerRef.current);
      historyCommitTimerRef.current = null;
    }
    commitCurrentHistory();
    historyPausedRef.current = true;
  }, [commitCurrentHistory]);

  const resumeCanvasHistory = useCallback((changed: boolean) => {
    historyPausedRef.current = false;
    if (changed) setNodes((current) => [...current]);
  }, []);

  const getCanvasCenter = useCallback(() => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return screenToCanvasPoint(
      rect.left + rect.width / 2,
      rect.top + CANVAS_STAGE_OFFSET + Math.max(0, rect.height - CANVAS_STAGE_OFFSET) / 2,
    );
  }, [screenToCanvasPoint]);

  const mergeCanvasAssetCatalog = useCallback((items: Asset[], targetScope: WorkspaceScope) => {
    setCanvasAssets((current) => {
      const byKey = new Map(current.map((asset) => [`${asset.scope}:${asset.id}`, asset]));
      items.forEach((asset) => byKey.set(`${targetScope}:${asset.id}`, { ...asset, scope: targetScope }));
      return Array.from(byKey.values());
    });
  }, []);

  const loadMentionAssetCatalog = useCallback(async (keyword = "", targetScope = currentMentionScope) => {
    assetCatalogAbortRef.current?.abort();
    const controller = new AbortController();
    assetCatalogAbortRef.current = controller;
    try {
      const result = await getAssetLibrary(targetScope, {
        keyword: keyword.trim() || undefined,
        page: 1,
        pageSize: 100,
        sort: "created_at_desc",
      }, controller.signal);
      if (!controller.signal.aborted) mergeCanvasAssetCatalog(result.items || [], targetScope);
    } catch (error) {
      if (!controller.signal.aborted) console.warn("读取画布引用资产失败", error);
    } finally {
      if (assetCatalogAbortRef.current === controller) assetCatalogAbortRef.current = null;
    }
  }, [currentMentionScope, mergeCanvasAssetCatalog]);

  const queueMentionAssetSearch = useCallback((query: string) => {
    if (assetSearchTimerRef.current) clearTimeout(assetSearchTimerRef.current);
    assetSearchTimerRef.current = setTimeout(() => {
      assetSearchTimerRef.current = null;
      void loadMentionAssetCatalog(query);
    }, 240);
  }, [loadMentionAssetCatalog]);

  const loadAssetPicker = useCallback(async (
    targetScope = assetPickerScope,
    keyword = assetPickerQuery,
    targetKind = assetPickerKind,
  ) => {
    assetPickerAbortRef.current?.abort();
    const controller = new AbortController();
    assetPickerAbortRef.current = controller;
    setAssetPickerLoading(true);
    setAssetPickerError("");
    try {
      const [serverResult, textResult] = await Promise.allSettled([
        targetKind === "text"
          ? Promise.resolve({ items: [] as Asset[] })
          : getAssetLibrary(targetScope, {
            keyword: keyword.trim() || undefined,
            page: 1,
            pageSize: 60,
            sort: "created_at_desc",
          }, controller.signal),
        user?.id ? listCanvasTextAssets(user.id, targetScope) : Promise.resolve([]),
      ]);
      if (controller.signal.aborted) return;
      const query = keyword.trim().toLowerCase();
      const serverAssets = serverResult.status === "fulfilled" ? serverResult.value.items || [] : [];
      const textAssets = textResult.status === "fulfilled" ? textResult.value : [];
      const mediaItems: CanvasAssetPickerItem[] = serverAssets
        .filter((asset) => targetKind === "all" || asset.type === targetKind)
        .map((asset) => ({
          id: `server:${asset.id}`,
          type: asset.type,
          name: asset.name || `资产 ${asset.id.slice(-8)}`,
          scope: targetScope,
          source: "server",
          serverAsset: asset,
          category: asset.category,
          size: asset.size,
          contentType: asset.content_type,
        }));
      const localTextItems: CanvasAssetPickerItem[] = textAssets
        .filter((asset) => targetKind === "all" || targetKind === "text")
        .filter((asset) => !query || `${asset.title} ${asset.content}`.toLowerCase().includes(query))
        .map((asset) => ({
          id: `text:${asset.id}`,
          type: "text",
          name: asset.title,
          scope: targetScope,
          source: "local-text",
          textAsset: asset,
        }));
      setAssetPickerItems([...localTextItems, ...mediaItems]);
      if (serverAssets.length) mergeCanvasAssetCatalog(serverAssets, targetScope);
      if (serverResult.status === "rejected") {
        setAssetPickerError(textAssets.length ? "服务端媒体资产读取失败，本地文本资产仍可使用" : publicApiError(serverResult.reason, "读取资产库失败"));
      } else if (textResult.status === "rejected") {
        setAssetPickerError("本地文本资产读取失败，服务端媒体资产仍可使用");
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setAssetPickerItems([]);
      setAssetPickerError(publicApiError(error, "读取资产库失败"));
    } finally {
      if (assetPickerAbortRef.current === controller) assetPickerAbortRef.current = null;
      if (!controller.signal.aborted) setAssetPickerLoading(false);
    }
  }, [assetPickerKind, assetPickerQuery, assetPickerScope, mergeCanvasAssetCatalog, user?.id]);

  const openAssetPicker = useCallback(() => {
    const targetScope = canonicalProjectScopeRef.current || scope;
    setAssetPickerScope(targetScope);
    setAssetPickerQuery("");
    setAssetPickerKind("all");
    setAssetPickerSelectedIds([]);
    setAssetPickerOpen(true);
    void loadAssetPicker(targetScope, "", "all");
  }, [loadAssetPicker, scope]);

  const insertAssetPickerSelection = useCallback(async () => {
    if (assetPickerInsertBusy || !assetPickerSelectedIds.length) return;
    const activeScope = canonicalProjectScopeRef.current;
    if (!activeScope) return;
    const selected = assetPickerItems.filter((asset) => assetPickerSelectedIds.includes(asset.id));
    if (!selected.length) return;
    const crossScopeText = selected.some((asset) => asset.type === "text");
    if (assetPickerScope !== activeScope && !window.confirm(`将${assetPickerScope === "team" ? "团队" : "个人"}素材插入当前${activeScope === "team" ? "团队" : "个人"}画布。${crossScopeText ? "文本会复制内容，媒体仍引用原资产。" : "媒体会保留原资产引用。"}是否继续？`)) return;
    setAssetPickerInsertBusy(true);
    try {
      const center = getCanvasCenter();
      const created = selected.flatMap((item, index): CanvasNodeData[] => {
        const position = {
          x: center.x + (index % 3) * 80 - 120,
          y: center.y + Math.floor(index / 3) * 70 - 80,
        };
        if (item.type === "text" && item.textAsset) {
          return [{
            id: crypto.randomUUID(),
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
            },
          }];
        }
        const asset = item.serverAsset;
        if (!asset) return [];
        return [{
          id: crypto.randomUUID(),
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
          },
        }];
      });
      if (!created.length) throw new Error("所选资产已失效，请刷新后重试");
      const next = [...nodesRef.current, ...created];
      nodesRef.current = next;
      setNodes(next);
      applyNodeSelection(created.map((node) => node.id), created[0]?.id || "", created.length === 1);
      setAssetPickerOpen(false);
      setAssetPickerSelectedIds([]);
      toast.success(`已插入 ${created.length} 个资产节点`);
    } finally {
      setAssetPickerInsertBusy(false);
    }
  }, [applyNodeSelection, assetPickerInsertBusy, assetPickerItems, assetPickerScope, assetPickerSelectedIds, getCanvasCenter]);

  const zoomCanvasAroundCenter = useCallback((nextZoom: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    applyCanvasViewport(zoomCanvasViewportAtPoint(
      viewportRef.current,
      { x: rect.width / 2, y: Math.max(0, rect.height - CANVAS_STAGE_OFFSET) / 2 },
      nextZoom,
    ));
  }, [applyCanvasViewport]);

  const fitCanvasToContent = useCallback(() => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const currentNodes = nodesRef.current;
    applyCanvasViewport(fitCanvasViewport(
      currentNodes.filter((node) => !isHiddenCanvasBatchChild(node, currentNodes)),
      { width: rect.width, height: rect.height },
      CANVAS_STAGE_OFFSET,
    ));
  }, [applyCanvasViewport]);

  const copySelectedNodes = useCallback(() => {
    const clipboard = createCanvasClipboard(
      nodesRef.current,
      edgesRef.current,
      selectedNodeIdsRef.current,
      canonicalProjectKeyRef.current,
    );
    if (!clipboard) return false;
    clipboardRef.current = clipboard;
    toast.success(`已复制 ${clipboard.nodes.length} 个画布节点`);
    return true;
  }, []);

  const pasteCopiedNodes = useCallback(() => {
    const clipboard = clipboardRef.current;
    const projectKey = canonicalProjectKeyRef.current;
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
    setPendingConnectionCreate(null);
    connectionDragRef.current.active = false;
    connectionDragRef.current.pointerId = null;
    connectionDragRef.current.moved = false;
    connectFromRef.current = "";
    connectHandleTypeRef.current = "source";
    connectionTargetIdRef.current = "";
    connectionPreviewPointRef.current = null;
    pendingConnectionCreateRef.current = null;
    setConnectFrom("");
    setConnectHandleType("source");
    setConnectionTargetId("");
    setConnectionPreviewPoint(null);
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
    if (projectId && !canonicalProjectScope) return;
    void loadMentionAssetCatalog("", currentMentionScope);
  }, [canonicalProjectScope, currentMentionScope, loadMentionAssetCatalog, projectId]);

  useEffect(() => () => {
    assetCatalogAbortRef.current?.abort();
    assetPickerAbortRef.current?.abort();
    if (assetSearchTimerRef.current) clearTimeout(assetSearchTimerRef.current);
  }, []);

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
    const requestScope = scope;
    const requestKey = `${requestScope}:${projectId}`;
    abortAllGenerationRequests();
    recoveredJobIdsRef.current.clear();
    projectLoadKeyRef.current = projectId ? requestKey : "";
    loadingRef.current = Boolean(projectId);
    dragRef.current = null;
    resizeRef.current = null;
    groupDragRef.current = null;
    groupResizeRef.current = null;
    setSelectedGroupId("");
    connectionDragRef.current.active = false;
    connectionDragRef.current.pointerId = null;
    panStateRef.current.mode = "idle";
    setDocumentPanCursor(false);
    snapshotBaseRef.current = null;
    snapshotBaseKeyRef.current = "";
    snapshotWriteReadyRef.current = false;
    skipNextDirtyEffectRef.current = true;
    canvasRevisionRef.current = 0;
    canonicalProjectScopeRef.current = null;
    canonicalProjectKeyRef.current = "";
    setCanonicalProjectScope(null);
    setSnapshotWriteReady(false);
    setSyncStatus("loading");
    setSnapshotVersion(0);
    setSnapshotUpdatedAt("");
    setSyncError("");
    if (!projectId) {
      loadingRef.current = false;
      setLoading(false);
      setProjectTitle("");
      nodesRef.current = [];
      edgesRef.current = [];
      groupsRef.current = [];
      setNodes([]);
      setEdges([]);
      setGroups([]);
      setBackgroundMode("lines");
      setShowImageInfo(false);
      setSelectedGroupId("");
      setPreviews({});
      switchingRef.current = false;
      setSwitching(false);
      return;
    }
    let disposed = false;
    setLoading(true);
    setProjectTitle("");
    void (async () => {
      try {
        const { project, scope: canonicalScope } = await getProjectFromCanonicalScope(projectId, requestScope);
        if (disposed || projectLoadKeyRef.current !== requestKey) return;
        if (canonicalScope !== requestScope) {
          navigate(canvasProjectHref(projectId, canonicalScope), { replace: true });
          return;
        }

        setProjectTitle(project.title);
        let snapshotData: Awaited<ReturnType<typeof getProjectSnapshot>> | undefined = undefined;
        let snapshotErrorMessage = "";
        try {
          snapshotData = await getProjectSnapshot(projectId, canonicalScope);
        } catch (error) {
          snapshotErrorMessage = publicApiError(error, "读取项目快照失败");
          if (!disposed && projectLoadKeyRef.current === requestKey) {
            toast.warning(`${snapshotErrorMessage}，将尝试项目内嵌数据`);
          }
        }
        if (disposed || projectLoadKeyRef.current !== requestKey) return;

        const canonicalKey = `${canonicalScope}:${projectId}`;
        const snapshotBase = snapshotData === undefined ? null : extractServerCanvasSnapshotData(snapshotData);
        const projectBase = extractProjectCanvasData(project.data);
        const writableBase = snapshotBase ?? projectBase;
        const parsed = writableBase ? parseSnapshot(writableBase) : null;
        const nextNodes = resetInterruptedCanvasGenerations(parsed ? parsed.nodes || [] : starterNodes());
        const nextEdges = parsed?.edges || [];
        const nextGroups = normalizeCanvasGroups(parsed?.groups || [], nextNodes);
        const nextBackgroundMode = parsed?.backgroundMode || "dots";
        const nextShowImageInfo = parsed?.showImageInfo || false;
        const nextViewport = { zoom: parsed?.zoom || 90, panX: parsed?.panX || 0, panY: parsed?.panY || 0 };
        const firstVisibleNode = nextNodes.find((node) => !isHiddenCanvasBatchChild(node, nextNodes));
        nodesRef.current = nextNodes;
        edgesRef.current = nextEdges;
        groupsRef.current = nextGroups;
        viewportRef.current = nextViewport;
        setNodes(nextNodes);
        setEdges(nextEdges);
        setGroups(nextGroups);
        setBackgroundMode(nextBackgroundMode);
        setShowImageInfo(nextShowImageInfo);
        applyNodeSelection(firstVisibleNode ? [firstVisibleNode.id] : [], firstVisibleNode?.id || "", Boolean(firstVisibleNode));
        setZoom(nextViewport.zoom);
        setPanX(nextViewport.panX);
        setPanY(nextViewport.panY);
        connectFromRef.current = "";
        connectHandleTypeRef.current = "source";
        connectionTargetIdRef.current = "";
        connectionPreviewPointRef.current = null;
        pendingConnectionCreateRef.current = null;
        setConnectFrom("");
        setConnectHandleType("source");
        setConnectionTargetId("");
        setConnectionPreviewPoint(null);
        setPendingConnectionCreate(null);
        if (historyCommitTimerRef.current) {
          clearTimeout(historyCommitTimerRef.current);
          historyCommitTimerRef.current = null;
        }
        historyRef.current = { past: [], future: [] };
        lastHistoryRef.current = {
          ...captureCanvasHistoryEntry(nextNodes, nextEdges),
          groups: structuredClone(nextGroups),
          backgroundMode: nextBackgroundMode,
          showImageInfo: nextShowImageInfo,
        };
        lastHistorySourceRef.current = { nodes: nextNodes, edges: nextEdges, groups: nextGroups, backgroundMode: nextBackgroundMode, showImageInfo: nextShowImageInfo };
        applyingHistoryRef.current = false;
        historyPausedRef.current = false;
        setHistoryState({ canUndo: false, canRedo: false });
        canonicalProjectScopeRef.current = canonicalScope;
        canonicalProjectKeyRef.current = canonicalKey;
        setCanonicalProjectScope(canonicalScope);
        snapshotBaseRef.current = writableBase;
        snapshotBaseKeyRef.current = writableBase === null ? "" : canonicalKey;
        snapshotWriteReadyRef.current = writableBase !== null;
        setSnapshotWriteReady(writableBase !== null);
        setSnapshotVersion(snapshotData?.version || 0);
        setSnapshotUpdatedAt(snapshotData?.updated_at || project.updated_at || "");
        setSyncError(snapshotErrorMessage);
        setSyncStatus(snapshotErrorMessage || writableBase === null ? "error" : "synced");
        if (writableBase === null) {
          toast.warning("未取得完整原始快照，保存已暂停以保护现有画布数据");
        }
        // SOP 步骤3-5：相关节点已随画布数据渲染（步骤3）→ 唤出 Agent 对话卡片（步骤4）→ 交接用户输入（步骤5由 AgentPanel 同步发送）
        const pendingBootstrapPrompt = bootstrapPromptRef.current;
        if (pendingBootstrapPrompt) {
          bootstrapPromptRef.current = "";
          setInitialPrompt(pendingBootstrapPrompt);
          setAgentOpen(true);
        }
        setBootstrapActive(false);
      } catch (error) {
        if (!disposed && projectLoadKeyRef.current === requestKey) {
          const message = publicApiError(error, "读取画布项目失败");
          setSyncStatus("error");
          setSyncError(message);
          toast.error(message);
          // 加载失败：放弃本次引导（不自动唤出 Agent），收起覆盖层交还操作
          bootstrapPromptRef.current = "";
          setBootstrapActive(false);
        }
      } finally {
        if (!disposed && projectLoadKeyRef.current === requestKey) {
          loadingRef.current = false;
          setLoading(false);
          switchingRef.current = false;
          setSwitching(false);
        }
      }
    })();
    return () => {
      disposed = true;
      abortAllGenerationRequests();
    };
  }, [abortAllGenerationRequests, applyNodeSelection, navigate, projectId, scope]);

  // 预览加载只依赖"资产集合签名"（assetId + scope + kind），与节点坐标/尺寸无关：
  // 拖动改变 nodes 引用但签名不变，effect 不会重跑，媒体 src 保持稳定。
  const previewAssetSignature = useMemo(() => {
    const keys: string[] = [];
    const seen = new Set<string>();
    for (const node of nodes) {
      const id = assetIdFromNode(node);
      if (!id) continue;
      const assetScope = workspaceScopeValue(node.metadata?.assetScope) || canonicalProjectScope || scope;
      const key = `${assetScope}:${mediaKindFromNode(node)}:${id}`;
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
    return keys.sort().join("|");
  }, [canonicalProjectScope, nodes, scope]);

  useEffect(() => {
    const cache = previewObjectUrlCacheRef.current;
    if (projectId && !canonicalProjectScope) {
      cache.forEach((entry) => URL.revokeObjectURL(entry.url));
      cache.clear();
      setPreviews((prev) => Object.keys(prev).length ? {} : prev);
      return;
    }
    // 用 nodesRef 重建当前资产集合（effect 触发时一定是最新值，避免闭包捕获拖动中的过期 nodes）
    const needed = new Map<string, { id: string; kind: "image" | "video" | "audio"; scope: WorkspaceScope }>();
    for (const node of nodesRef.current) {
      const id = assetIdFromNode(node);
      if (!id) continue;
      const descriptor = {
        id,
        kind: mediaKindFromNode(node),
        scope: workspaceScopeValue(node.metadata?.assetScope) || canonicalProjectScope || scope,
      };
      const key = `${descriptor.scope}:${descriptor.kind}:${id}`;
      if (!needed.has(key)) needed.set(key, descriptor);
    }
    // 只释放已移除资产的 Object URL，其余复用
    cache.forEach((entry, key) => {
      if (!needed.has(key)) {
        URL.revokeObjectURL(entry.url);
        cache.delete(key);
      }
    });
    // 集合无变化时同步一次 previews（去掉已移除项），无变化则保持原引用，memo 缓存不受影响
    const syncPreviews = () => setPreviews((prev) => {
      const next: Record<string, string> = {};
      needed.forEach((descriptor, key) => {
        const entry = cache.get(key);
        if (entry) next[descriptor.id] = entry.url;
      });
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length === nextKeys.length && nextKeys.every((id) => prev[id] === next[id])) return prev;
      return next;
    });
    const missing = Array.from(needed.entries()).filter(([key]) => !cache.has(key));
    if (!missing.length) {
      syncPreviews();
      return;
    }
    let disposed = false;
    Promise.all(missing.map(async ([key, descriptor]) => {
      try {
        const url = await getAssetContentObjectUrl(descriptor.id, descriptor.scope, descriptor.kind === "image" ? 640 : undefined);
        return [key, descriptor.id, url] as const;
      } catch {
        return [key, descriptor.id, ""] as const;
      }
    })).then((items) => {
      if (disposed) {
        items.forEach(([, , url]) => { if (url) URL.revokeObjectURL(url); });
        return;
      }
      items.forEach(([key, assetId, url]) => { if (url) cache.set(key, { assetId, url }); });
      syncPreviews();
    });
    return () => { disposed = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nodes 由 previewAssetSignature 代表，effect 内读取 nodesRef 最新值
  }, [canonicalProjectScope, previewAssetSignature, projectId, scope]);

  // 组件卸载时释放全部缓存的 Object URL
  useEffect(() => {
    const cache = previewObjectUrlCacheRef.current;
    return () => {
      cache.forEach((entry) => URL.revokeObjectURL(entry.url));
      cache.clear();
    };
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (isCanvasHotkeyEditingTarget(target)) return;
      if (switchingRef.current || loadingRef.current || (projectId && !canonicalProjectScopeRef.current)) return;
      if (event.code === "Space") {
        isSpacePressedRef.current = true;
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        connectFromRef.current = "";
        connectHandleTypeRef.current = "source";
        connectionTargetIdRef.current = "";
        connectionPreviewPointRef.current = null;
        pendingConnectionCreateRef.current = null;
        setConnectFrom("");
        setConnectHandleType("source");
        setConnectionTargetId("");
        setConnectionPreviewPoint(null);
        setPendingConnectionCreate(null);
        connectionDragRef.current.active = false;
        connectionDragRef.current.pointerId = null;
        stopPanInteraction();
        setContextMenu(null);
        setInspectorOpen(false);
        applyNodeSelection([]);
        return;
      }
      if (event.code === "Backquote" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const currentNodes = nodesRef.current;
        const hovered = currentNodes.find((item) => item.id === hoveredId && !isHiddenCanvasBatchChild(item, currentNodes))
          || (selectedNode && !isHiddenCanvasBatchChild(selectedNode, currentNodes) ? selectedNode : null)
          || currentNodes.find((item) => !isHiddenCanvasBatchChild(item, currentNodes));
        if (hovered) {
          event.preventDefault();
          focusNodeInViewport(hovered.id);
        }
        return;
      }
      const shortcuts = shortcutsRef.current;
      if (eventMatchesShortcut(event, shortcuts.copy)) {
        event.preventDefault();
        copySelectedNodes();
        return;
      }
      if (eventMatchesShortcut(event, shortcuts.paste)) {
        event.preventDefault();
        pasteCopiedNodes();
        return;
      }
      if (eventMatchesShortcut(event, shortcuts.redo)) {
        event.preventDefault();
        redoCanvas();
        return;
      }
      if (eventMatchesShortcut(event, shortcuts.undo)) {
        event.preventDefault();
        undoCanvas();
        return;
      }
      if (eventMatchesShortcut(event, shortcuts.runSelection)) {
        event.preventDefault();
        void runSelectedGenerationRef.current();
        return;
      }
      if (eventMatchesShortcut(event, shortcuts.selectAll)) {
        event.preventDefault();
        const currentNodes = nodesRef.current;
        const allIds = currentNodes.filter((item) => !isHiddenCanvasBatchChild(item, currentNodes)).map((item) => item.id);
        if (allIds.length) applyNodeSelection(allIds);
        return;
      }
      if (eventMatchesShortcut(event, shortcuts.openSettings)) {
        event.preventDefault();
        setInspectorOpen(true);
        return;
      }
      if (eventMatchesShortcut(event, shortcuts.resetZoom)) {
        event.preventDefault();
        setZoom(90);
        return;
      }
      const matchesDelete = eventMatchesShortcut(event, shortcuts.delete);
      if (matchesDelete && selectedGroupId) {
        event.preventDefault();
        const nextGroups = groupsRef.current.filter((group) => group.id !== selectedGroupId);
        groupsRef.current = nextGroups;
        setGroups(nextGroups);
        setSelectedGroupId("");
        setInspectorOpen(false);
        return;
      }
      if (matchesDelete && selectedNodeIdsRef.current.size) {
        event.preventDefault();
        removeNodes(selectedNodeIdsRef.current);
        return;
      }
      if (matchesDelete && selectedEdgeId) {
        event.preventDefault();
        removeEdge(selectedEdgeId);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        isSpacePressedRef.current = false;
      }
    };
    const releaseState = () => {
      isSpacePressedRef.current = false;
      stopPanInteraction();
      const drag = dragRef.current;
      const resize = resizeRef.current;
      const groupDrag = groupDragRef.current;
      const groupResize = groupResizeRef.current;
      dragRef.current = null;
      resizeRef.current = null;
      groupDragRef.current = null;
      groupResizeRef.current = null;
      if (drag || resize) resumeCanvasHistory(Boolean(drag?.moved || resize?.moved));
      if (groupDrag) resumeCanvasHistory(Boolean(groupDrag.moved));
      if (groupResize) resumeCanvasHistory(Boolean(groupResize.moved));
    };
    window.addEventListener("keydown", handleKey);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", releaseState);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", releaseState);
    };
  }, [applyNodeSelection, copySelectedNodes, focusNodeInViewport, hoveredId, pasteCopiedNodes, projectId, redoCanvas, removeEdge, resumeCanvasHistory, selectedEdgeId, selectedGroupId, selectedId, selectedNode, undoCanvas]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    uploadingRef.current = uploading;
  }, [uploading]);

  useEffect(() => {
    viewportRef.current = { zoom, panX, panY };
  }, [zoom, panX, panY]);

  useEffect(() => {
    nodesRef.current = nodes;
    edgesRef.current = edges;
    groupsRef.current = groups;
  }, [edges, groups, nodes]);

  useEffect(() => {
    if (editingInlineNodeId && !nodes.some((node) => node.id === editingInlineNodeId)) {
      setEditingInlineNodeId("");
    }
  }, [editingInlineNodeId, nodes]);

  useEffect(() => {
    if (loading || applyingHistoryRef.current || historyPausedRef.current) return;
    const source = lastHistorySourceRef.current;
    if (source?.nodes === nodes && source.edges === edges && source.groups === groups && source.backgroundMode === backgroundMode && source.showImageInfo === showImageInfo) return;
    if (historyCommitTimerRef.current) clearTimeout(historyCommitTimerRef.current);
    historyCommitTimerRef.current = setTimeout(() => {
      historyCommitTimerRef.current = null;
      commitCurrentHistory();
    }, 180);
    return () => {
      if (historyCommitTimerRef.current) {
        clearTimeout(historyCommitTimerRef.current);
        historyCommitTimerRef.current = null;
      }
    };
  }, [backgroundMode, commitCurrentHistory, edges, groups, loading, nodes, showImageInfo]);

  useEffect(() => () => {
    if (historyCommitTimerRef.current) clearTimeout(historyCommitTimerRef.current);
  }, []);

  useEffect(() => {
    selectedNodeIdsRef.current = selectedNodeIds;
  }, [selectedNodeIds]);

  useEffect(() => {
    setSelectedNodeIds((current) => {
      if (!selectedId) {
        if (!current.size) return current;
        const next = new Set<string>();
        selectedNodeIdsRef.current = next;
        return next;
      }
      if (current.has(selectedId)) return current;
      const next = new Set([selectedId]);
      selectedNodeIdsRef.current = next;
      return next;
    });
  }, [selectedId]);

  useEffect(() => {
    connectFromRef.current = connectFrom;
    connectHandleTypeRef.current = connectHandleType;
    connectionTargetIdRef.current = connectionTargetId;
    connectionPreviewPointRef.current = connectionPreviewPoint;
    pendingConnectionCreateRef.current = pendingConnectionCreate;
  }, [connectFrom, connectHandleType, connectionPreviewPoint, connectionTargetId, pendingConnectionCreate]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const handleWheel = (event: WheelEvent) => {
      if (switchingRef.current || loadingRef.current || (projectId && !canonicalProjectScopeRef.current)) {
        event.preventDefault();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (isCanvasHotkeyEditingTarget(target) || target?.closest(".node-inline-editor")) {
        if (event.ctrlKey || event.metaKey) event.preventDefault();
        event.stopPropagation();
        return;
      }
      // 悬浮 UI（右键/双击菜单、检查器、工具条等带 data-canvas-ui）内的滚轮交给 UI 自身滚动，不触发画布缩放/平移
      if (target?.closest("[data-canvas-ui]")) return;
      event.preventDefault();
      const current = viewportRef.current;
      if (!wheelZoomRequiresCtrl || event.ctrlKey || event.metaKey) {
        const rect = stage.getBoundingClientRect();
        const factor = Math.pow(1.1, -event.deltaY / 100);
        applyCanvasViewportFrame(zoomCanvasViewportAtPoint(
          current,
          { x: event.clientX - rect.left, y: event.clientY - rect.top - CANVAS_STAGE_OFFSET },
          current.zoom * factor,
        ));
        return;
      }
      applyCanvasViewportFrame(panCanvasViewport(current, event.deltaX, event.deltaY));
    };
    stage.addEventListener("wheel", handleWheel, { passive: false });
    return () => stage.removeEventListener("wheel", handleWheel);
  }, [applyCanvasViewportFrame, projectId, wheelZoomRequiresCtrl]);

  const persistSnapshot = useCallback(async (
    nextNodes = nodesRef.current,
    nextEdges = edgesRef.current,
    nextZoom = viewportRef.current.zoom,
    options: { quiet?: boolean; panX?: number; panY?: number } = {},
  ): Promise<boolean> => {
    if (!projectId) return true;
    if (options.quiet && switchingRef.current) return false;
    const activeScope = canonicalProjectScopeRef.current;
    const snapshotKey = activeScope ? `${activeScope}:${projectId}` : "";
    if (!activeScope || canonicalProjectKeyRef.current !== snapshotKey) {
      if (!options.quiet) toast.warning("正在确认项目工作区，保存已暂停以避免写入错误空间");
      return false;
    }
    if (!snapshotWriteReadyRef.current || snapshotBaseRef.current === null || snapshotBaseKeyRef.current !== snapshotKey) {
      if (!options.quiet) toast.warning("未取得完整原始快照，保存已暂停以保护现有画布数据");
      return false;
    }
    const saveRevision = canvasRevisionRef.current;
    if (!options.quiet) setSaving(true);
    const saveOperation = snapshotSaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const queuedScope = canonicalProjectScopeRef.current;
        const queuedKey = queuedScope ? `${queuedScope}:${projectId}` : "";
        const snapshotBase = snapshotBaseRef.current;
        if (!queuedScope || queuedKey !== snapshotKey || canonicalProjectKeyRef.current !== snapshotKey) {
          if (!options.quiet) toast.warning("正在确认项目工作区，保存已暂停以避免写入错误空间");
          return false;
        }
        if (!snapshotWriteReadyRef.current || snapshotBase === null || snapshotBaseKeyRef.current !== snapshotKey) {
          if (!options.quiet) toast.warning("未取得完整原始快照，保存已暂停以保护现有画布数据");
          return false;
        }
        setSyncStatus("saving");
        setSyncError("");
        const nextSnapshot = buildCanvasSnapshot(
          snapshotBase,
          nextNodes,
          nextEdges,
          nextZoom,
          options.panX ?? viewportRef.current.panX,
          options.panY ?? viewportRef.current.panY,
          groupsRef.current,
          backgroundMode,
          showImageInfo,
        );
        const savedSnapshot = await saveProjectSnapshot(projectId, nextSnapshot, queuedScope);
        if (snapshotBaseKeyRef.current === snapshotKey && canonicalProjectKeyRef.current === snapshotKey) {
          snapshotBaseRef.current = nextSnapshot;
          setSnapshotVersion(savedSnapshot.version || 0);
          setSnapshotUpdatedAt(savedSnapshot.updated_at || "");
          setSyncStatus(canvasRevisionRef.current > saveRevision ? "pending" : "synced");
        }
        if (!options.quiet) toast.success("画布快照已保存");
        return true;
      })
      .catch((error) => {
        const message = publicApiError(error, "保存画布快照失败");
        if (canonicalProjectKeyRef.current === snapshotKey) {
          setSyncStatus("error");
          setSyncError(message);
        }
        if (!options.quiet) toast.error(message);
        return false;
      })
      .finally(() => {
        if (!options.quiet) setSaving(false);
      });
    snapshotSaveQueueRef.current = saveOperation.then(() => undefined, () => undefined);
    return saveOperation;
  }, [backgroundMode, projectId, showImageInfo]);

  useEffect(() => {
    if (!projectId || loading || switching || !snapshotWriteReady) return;
    if (skipNextDirtyEffectRef.current) {
      skipNextDirtyEffectRef.current = false;
      return;
    }
    canvasRevisionRef.current += 1;
    setSyncStatus("pending");
    setSyncError("");
    const timer = window.setTimeout(() => {
      void persistSnapshot(nodesRef.current, edgesRef.current, viewportRef.current.zoom, { quiet: true });
    }, 1_200);
    return () => window.clearTimeout(timer);
  }, [backgroundMode, edges, groups, loading, nodes, panX, panY, persistSnapshot, projectId, showImageInfo, snapshotWriteReady, switching, zoom]);

  const canLeaveCurrentCanvas = useCallback(() => {
    if (loadingRef.current) {
      toast.warning("画布快照仍在读取，请稍后再切换");
      return false;
    }
    const activeScope = canonicalProjectScopeRef.current;
    const activeKey = activeScope ? `${activeScope}:${projectId}` : "";
    if (projectId && (!activeScope || canonicalProjectKeyRef.current !== activeKey)) {
      toast.warning("正在确认项目工作区，请稍后再切换");
      return false;
    }
    if (uploadingRef.current) {
      toast.warning("当前画布仍在上传图片，请等待上传完成后再切换");
      return false;
    }
    return true;
  }, [projectId]);

  const cancelActiveCanvasInteractions = useCallback(() => {
    const drag = dragRef.current;
    const resize = resizeRef.current;
    const groupDrag = groupDragRef.current;
    const groupResize = groupResizeRef.current;
    dragRef.current = null;
    resizeRef.current = null;
    groupDragRef.current = null;
    groupResizeRef.current = null;
    connectionDragRef.current.active = false;
    connectionDragRef.current.pointerId = null;
    connectFromRef.current = "";
    connectHandleTypeRef.current = "source";
    connectionTargetIdRef.current = "";
    connectionPreviewPointRef.current = null;
    pendingConnectionCreateRef.current = null;
    panStateRef.current.mode = "idle";
    isSpacePressedRef.current = false;
    setPanMode("idle");
    setDocumentPanCursor(false);
    setConnectFrom("");
    setConnectHandleType("source");
    setConnectionTargetId("");
    setConnectionPreviewPoint(null);
    setPendingConnectionCreate(null);
    if (drag || resize || groupDrag || groupResize) resumeCanvasHistory(Boolean(drag?.moved || resize?.moved || groupDrag?.moved || groupResize?.moved));
  }, [resumeCanvasHistory]);

  const flushCurrentSnapshotForSwitch = useCallback(async () => {
    const currentViewport = viewportRef.current;
    return persistSnapshot(nodesRef.current, edgesRef.current, currentViewport.zoom, {
      panX: currentViewport.panX,
      panY: currentViewport.panY,
    });
  }, [persistSnapshot]);

  const switchCanvasProject = useCallback(async (targetProjectId: string) => {
    if (!targetProjectId || targetProjectId === projectId || switchingRef.current) return;
    if (!canLeaveCurrentCanvas()) return;
    const activeScope = canonicalProjectScopeRef.current;
    if (!activeScope) {
      toast.warning("正在确认项目工作区，请稍后再切换");
      return;
    }
    switchingRef.current = true;
    setSwitching(true);
    cancelActiveCanvasInteractions();
    setContextMenu(null);
    setInspectorOpen(false);
    setAgentOpen(false);
    abortAllGenerationRequests();
    try {
      const saved = await flushCurrentSnapshotForSwitch();
      if (!saved) {
        toast.warning("切换已取消：当前画布快照保存失败，已留在原项目");
        switchingRef.current = false;
        setSwitching(false);
        return;
      }
      setLoading(true);
      const targetProject = projects.find((project) => project.id === targetProjectId);
      navigate(canvasProjectHref(targetProjectId, projectScopeFromServer(targetProject, activeScope)));
    } catch (error) {
      toast.error(publicApiError(error, "切换画布失败"));
      switchingRef.current = false;
      setSwitching(false);
    }
  }, [abortAllGenerationRequests, canLeaveCurrentCanvas, cancelActiveCanvasInteractions, flushCurrentSnapshotForSwitch, navigate, projectId, projects]);

  const switchCanvasScope = useCallback(async (targetScope: WorkspaceScope) => {
    const activeScope = projectId ? canonicalProjectScopeRef.current : scope;
    if (targetScope === activeScope || switchingRef.current) return;
    if (!projectId) {
      navigate(canvasListHref(targetScope));
      return;
    }
    if (!canLeaveCurrentCanvas()) return;
    switchingRef.current = true;
    setSwitching(true);
    cancelActiveCanvasInteractions();
    setContextMenu(null);
    setInspectorOpen(false);
    setAgentOpen(false);
    abortAllGenerationRequests();
    try {
      const saved = await flushCurrentSnapshotForSwitch();
      if (!saved) {
        toast.warning("切换已取消：当前画布快照保存失败，已留在原项目");
        switchingRef.current = false;
        setSwitching(false);
        return;
      }
      setLoading(true);
      navigate(canvasListHref(targetScope));
    } catch (error) {
      toast.error(publicApiError(error, "切换工作区失败"));
      switchingRef.current = false;
      setSwitching(false);
    }
  }, [abortAllGenerationRequests, canLeaveCurrentCanvas, cancelActiveCanvasInteractions, flushCurrentSnapshotForSwitch, navigate, projectId, scope]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => {
      const rect = stage.getBoundingClientRect();
      setStageBounds({ width: rect.width, height: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

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
    const activeScope = canonicalProjectScopeRef.current;
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
    connectFromRef.current = "";
    connectHandleTypeRef.current = "source";
    connectionTargetIdRef.current = "";
    connectionPreviewPointRef.current = null;
    pendingConnectionCreateRef.current = null;
    setConnectFrom("");
    setConnectHandleType("source");
    setConnectionTargetId("");
    setConnectionPreviewPoint(null);
    setPendingConnectionCreate(null);
    setContextMenu(null);
    return created;
  };

  const openDirectorNode = async (source: CanvasNodeData) => {
    if (source.kind !== "director") return;
    const activeScope = canonicalProjectScopeRef.current;
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
      clearConnectionDraft();
      pendingConnectionCreateRef.current = null;
      setPendingConnectionCreate(null);
      setContextMenu(null);
      return;
    }
    nodesRef.current = graph.nodes;
    edgesRef.current = graph.edges;
    setNodes(graph.nodes);
    setEdges(graph.edges);
    applyNodeSelection([created.id], created.id, true);
    clearConnectionDraft();
    pendingConnectionCreateRef.current = null;
    setPendingConnectionCreate(null);
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
    const activeScope = canonicalProjectScopeRef.current;
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
    expectedProjectKey = canonicalProjectKeyRef.current,
    expectedScope = canonicalProjectScopeRef.current,
  ) => {
    const activeScope = expectedScope;
    if (!activeScope || !expectedProjectKey || switchingRef.current || canonicalProjectKeyRef.current !== expectedProjectKey) {
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
    if (switchingRef.current || canonicalProjectKeyRef.current !== expectedProjectKey) {
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
    const projectKey = canonicalProjectKeyRef.current;
    const activeScope = canonicalProjectScopeRef.current;
    if (!projectKey || !activeScope || switchingRef.current) return;
    const created: CanvasNodeData[] = [];
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      if (switchingRef.current || canonicalProjectKeyRef.current !== projectKey) throw new DOMException("Aborted", "AbortError");
      const archived = await uploadCanvasImageDataUrl(source, result.dataUrl, result.title, result.relation, projectKey, activeScope);
      if (canonicalProjectKeyRef.current !== projectKey) return;
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
    if (switchingRef.current || canonicalProjectKeyRef.current !== projectKey) throw new DOMException("Aborted", "AbortError");
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
    if (!saved || switchingRef.current || canonicalProjectKeyRef.current !== projectKey) throw new DOMException("Aborted", "AbortError");
  };

  const flipCanvasImageNode = async (node: CanvasNodeData, direction: "horizontal" | "vertical") => {
    if (imageToolBusy) return;
    const projectKey = canonicalProjectKeyRef.current;
    const activeScope = canonicalProjectScopeRef.current;
    if (!projectKey || !activeScope || switchingRef.current) return;
    setImageToolBusy(true);
    setImageToolError("");
    let source: Awaited<ReturnType<typeof imageSourceForNode>> | null = null;
    try {
      source = await imageSourceForNode(node);
      const dataUrl = await flipDataUrl(source.url, direction);
      const relation = direction === "horizontal" ? "flip-horizontal" : "flip-vertical";
      const archived = await uploadCanvasImageDataUrl(node, dataUrl, `${node.title}-${direction === "horizontal" ? "水平翻转" : "垂直翻转"}`, relation, projectKey, activeScope);
      if (canonicalProjectKeyRef.current !== projectKey) return;
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
      if (!saved || switchingRef.current || canonicalProjectKeyRef.current !== projectKey) throw new DOMException("Aborted", "AbortError");
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
    const activeScope = canonicalProjectScopeRef.current;
    const projectKey = canonicalProjectKeyRef.current;
    if (!activeScope || !projectKey || switchingRef.current) throw new Error("正在确认项目工作区，暂不能编辑图片");
    const model = modelFromNode(sourceNode, imageModel);
    if (!model) throw new Error("当前没有可用图片模型");
    let source: Awaited<ReturnType<typeof imageSourceForNode>> | null = null;
    try {
      const sourceDataUrl = options.sourceDataUrl || (source = await imageSourceForNode(sourceNode)).url;
      const referenceFile = await canvasImageFile(sourceDataUrl, `${sourceNode.title}-reference`);
      const maskFile = options.maskDataUrl ? await canvasImageFile(options.maskDataUrl, `${sourceNode.title}-mask`) : undefined;
      if (switchingRef.current || canonicalProjectKeyRef.current !== projectKey) throw new DOMException("Aborted", "AbortError");
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
      if (!saved || switchingRef.current || canonicalProjectKeyRef.current !== projectKey) throw new DOMException("Aborted", "AbortError");
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
    const activeScope = canonicalProjectScopeRef.current;
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
    const activeScope = canonicalProjectScopeRef.current;
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
    const activeScope = canonicalProjectScopeRef.current;
    const projectKey = canonicalProjectKeyRef.current;
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
      if (canonicalProjectKeyRef.current !== projectKey) return;
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
    const activeScope = canonicalProjectScopeRef.current;
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
    const activeScope = canonicalProjectScopeRef.current;
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

  const selectCanvasGroup = (group: CanvasGroupData, openInspector = true) => {
    const memberIds = group.nodeIds.filter((nodeId) => nodesRef.current.some((node) => node.id === nodeId));
    applyNodeSelection(memberIds, memberIds[0] || "", false);
    setSelectedGroupId(group.id);
    setInspectorOpen(openInspector);
    setContextMenu(null);
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

  const startGroupDrag = (event: PointerEvent<HTMLElement>, group: CanvasGroupData) => {
    if (switchingRef.current || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (isCanvasHotkeyEditingTarget(target)) return;
    event.preventDefault();
    event.stopPropagation();
    selectCanvasGroup(group, false);
    event.currentTarget.setPointerCapture(event.pointerId);
    groupDragRef.current = {
      id: group.id,
      startX: event.clientX,
      startY: event.clientY,
      position: { ...group.position },
      origins: captureCanvasNodeOrigins(nodesRef.current, new Set(group.nodeIds)),
      moved: false,
    };
    pauseCanvasHistory();
  };

  const moveGroupDrag = (event: PointerEvent<HTMLElement>) => {
    const drag = groupDragRef.current;
    if (!drag || switchingRef.current) return;
    const scale = viewportRef.current.zoom / 100;
    const deltaX = (event.clientX - drag.startX) / scale;
    const deltaY = (event.clientY - drag.startY) / scale;
    if (!drag.moved && Math.abs(deltaX) < 2 && Math.abs(deltaY) < 2) return;
    drag.moved = Math.abs(deltaX) > 0.01 || Math.abs(deltaY) > 0.01;
    const nextGroups = groupsRef.current.map((group) => group.id === drag.id ? {
      ...group,
      position: { x: drag.position.x + deltaX, y: drag.position.y + deltaY },
    } : group);
    const nextNodes = moveCanvasNodesFromOrigins(nodesRef.current, drag.origins, deltaX, deltaY);
    groupsRef.current = nextGroups;
    nodesRef.current = nextNodes;
    setGroups(nextGroups);
    setNodes(nextNodes);
  };

  const endGroupDrag = () => {
    const drag = groupDragRef.current;
    groupDragRef.current = null;
    resumeCanvasHistory(Boolean(drag?.moved));
  };

  const startGroupResize = (event: PointerEvent<HTMLElement>, group: CanvasGroupData, corner: CanvasGroupResizeCorner) => {
    if (switchingRef.current || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    selectCanvasGroup(group, false);
    groupResizeRef.current = {
      id: group.id,
      corner,
      startX: event.clientX,
      startY: event.clientY,
      group: structuredClone(group),
      moved: false,
    };
    pauseCanvasHistory();
  };

  const moveGroupResize = (event: PointerEvent<HTMLElement>) => {
    const resize = groupResizeRef.current;
    if (!resize || switchingRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const scale = viewportRef.current.zoom / 100;
    const deltaX = (event.clientX - resize.startX) / scale;
    const deltaY = (event.clientY - resize.startY) / scale;
    if (!resize.moved && Math.abs(deltaX) < 2 && Math.abs(deltaY) < 2) return;
    resize.moved = Math.abs(deltaX) > 0.01 || Math.abs(deltaY) > 0.01;
    const nextGroups = groupsRef.current.map((group) => group.id === resize.id
      ? resizeCanvasGroup(resize.group, resize.corner, deltaX, deltaY)
      : group);
    groupsRef.current = nextGroups;
    setGroups(nextGroups);
  };

  const endGroupResize = (event: PointerEvent<HTMLElement>) => {
    const resize = groupResizeRef.current;
    if (!resize) return;
    event.preventDefault();
    event.stopPropagation();
    groupResizeRef.current = null;
    resumeCanvasHistory(resize.moved);
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
    generationPreparationsRef.current.forEach((preparation, preparationId) => {
      const relatedNodeDeleted = deleteIds.has(preparation.originNodeId)
        || Boolean(preparation.targetNodeId && deleteIds.has(preparation.targetNodeId))
        || preparation.referenceNodeIds.some((nodeId) => deleteIds.has(nodeId));
      if (!relatedNodeDeleted) return;
      generationPreparationsRef.current.delete(preparationId);
      preparation.controller.abort();
    });
    const canceledTargetIds = new Set<string>();
    Array.from(generationRequestsRef.current.values()).forEach((request) => {
      if (!deleteIds.has(request.targetNodeId) && !deleteIds.has(request.originNodeId) && !deleteIds.has(request.runningNodeId)) return;
      generationRequestsRef.current.delete(request.targetNodeId);
      canceledTargetIds.add(request.targetNodeId);
      request.controller.abort();
      if (request.jobId && request.provider !== "seedance") void cancelJob(request.jobId, request.scope).catch(() => undefined);
    });
    syncGenerationRequestState();
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
    connectionDragRef.current.active = false;
    connectionDragRef.current.pointerId = null;
    connectionDragRef.current.moved = false;
    connectFromRef.current = "";
    connectHandleTypeRef.current = "source";
    connectionTargetIdRef.current = "";
    connectionPreviewPointRef.current = null;
    pendingConnectionCreateRef.current = null;
    setConnectFrom("");
    setConnectHandleType("source");
    setConnectionTargetId("");
    setConnectionPreviewPoint(null);
    setPendingConnectionCreate(null);
    setHoveredId((current) => deleteIds.has(current) ? "" : current);
    setHoveredEdgeId("");
    selectionBoxRef.current = null;
    setSelectionBox(null);
    setContextMenu(null);
  };

  const removeNode = (id: string) => {
    const selected = selectedNodeIdsRef.current;
    removeNodes(selected.has(id) && selected.size > 1 ? selected : [id]);
  };

  const activateConnectionMode = (nodeId: string, handleType?: ConnectionHandleType) => {
    const node = nodesRef.current.find((item) => item.id === nodeId);
    const resolvedHandleType = handleType || defaultCanvasConnectionHandle(node);
    connectFromRef.current = nodeId;
    connectHandleTypeRef.current = resolvedHandleType;
    connectionTargetIdRef.current = "";
    connectionPreviewPointRef.current = null;
    pendingConnectionCreateRef.current = null;
    setConnectFrom(nodeId);
    setConnectHandleType(resolvedHandleType);
    setConnectionTargetId("");
    setConnectionPreviewPoint(null);
    setPendingConnectionCreate(null);
    setContextMenu(null);
    toast.info("已选择连接起点，请点击目标节点完成连线；按 Esc 可取消");
  };

  const connectNodes = (fromId: string, toId: string, handleType: ConnectionHandleType = "source") => {
    const normalized = normalizeCanvasConnection(fromId, toId, nodesRef.current.length ? nodesRef.current : nodes, handleType);
    if (!normalized) {
      toast.warning("该连接不符合节点规则");
      connectFromRef.current = "";
      connectHandleTypeRef.current = "source";
      connectionTargetIdRef.current = "";
      connectionPreviewPointRef.current = null;
      pendingConnectionCreateRef.current = null;
      setConnectFrom("");
      setConnectHandleType("source");
      setConnectionTargetId("");
      setConnectionPreviewPoint(null);
      setPendingConnectionCreate(null);
      return false;
    }
    const nextEdges = addCanvasConnection(edgesRef.current, normalized, () => crypto.randomUUID());
    edgesRef.current = nextEdges;
    setEdges(nextEdges);
    connectFromRef.current = "";
    connectHandleTypeRef.current = "source";
    connectionTargetIdRef.current = "";
    connectionPreviewPointRef.current = null;
    pendingConnectionCreateRef.current = null;
    setConnectFrom("");
    setConnectHandleType("source");
    setConnectionTargetId("");
    setConnectionPreviewPoint(null);
    setPendingConnectionCreate(null);
    setContextMenu(null);
    return true;
  };

  const chooseNode = (id: string, event?: ReactMouseEvent<HTMLElement>): boolean => {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement.matches(".node-inline-editor") && activeElement.dataset.nodeInlineEditorId !== id) {
      activeElement.blur();
    }
    if (suppressNodeClickRef.current === id) {
      suppressNodeClickRef.current = "";
      setContextMenu(null);
      return false;
    }
    const activeConnectFrom = connectFromRef.current;
    const activeConnectHandleType = connectHandleTypeRef.current;
    if (activeConnectFrom && activeConnectFrom !== id) {
      connectNodes(activeConnectFrom, id, activeConnectHandleType);
      return false; // 完成连线后直接返回，不选中节点
    } else if (activeConnectFrom === id) {
      connectFromRef.current = "";
      connectHandleTypeRef.current = "source";
      connectionTargetIdRef.current = "";
      connectionPreviewPointRef.current = null;
      pendingConnectionCreateRef.current = null;
      setConnectFrom("");
      setConnectHandleType("source");
      setConnectionTargetId("");
      setConnectionPreviewPoint(null);
      setPendingConnectionCreate(null);
      return false; // 取消连线后直接返回，不选中节点
    }
    const additive = Boolean(event && (event.shiftKey || event.ctrlKey || event.metaKey));
    if (additive) {
      const current = selectedNodeIdsRef.current;
      const nextSelection = toggleCanvasNodeSelection(current, id, true);
      const primary = nextSelection.has(id) ? id : nextSelection.values().next().value || "";
      applyNodeSelection(nextSelection, primary, nextSelection.size === 1);
    } else {
      applyNodeSelection([id], id, true);
    }
    setContextMenu(null);
    return true;
  };

  const startDrag = (event: PointerEvent<HTMLElement>, node: CanvasNodeData) => {
    if (switchingRef.current) return;
    const target = event.target as HTMLElement;
    if (event.button !== 0) return;
    // 拖拽只排除真正的交互控件（按钮/输入框/行内编辑器/连接锚点）；
    // data-canvas-no-zoom 的媒体内容（video/audio/img）也允许按住拖动节点。
    if (target.closest("button, input, textarea, select, [contenteditable='true'], .node-inline-editor, .canvas-connection-handle, [data-canvas-ui]")) return;
    if (connectFromRef.current || pendingConnectionCreateRef.current) return;
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    const current = selectedNodeIdsRef.current;
    const suppressClick = shouldSuppressCanvasNodeClickAfterPointerSelection(current, node.id, additive);
    const nextSelection = additive
      ? toggleCanvasNodeSelection(current, node.id, true)
      : current.has(node.id) && current.size > 1
        ? new Set(current)
        : toggleCanvasNodeSelection(current, node.id, false);
    const primary = nextSelection.has(node.id) ? node.id : nextSelection.values().next().value || "";
    applyNodeSelection(nextSelection, primary, nextSelection.size === 1);
    if (!nextSelection.has(node.id)) {
      if (suppressClick) suppressNodeClickRef.current = node.id;
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    // 基底节点拖动时，其子图（含折叠隐藏的）作为整体跟随，保持网格不错位
    const dragIds = new Set(nextSelection);
    nodesRef.current.forEach((item) => {
      if (!item.metadata?.isBatchRoot || !dragIds.has(item.id)) return;
      (item.metadata.batchChildIds || []).forEach((childId) => {
        if (typeof childId === "string") dragIds.add(childId);
      });
    });
    dragRef.current = {
      id: node.id,
      startX: event.clientX,
      startY: event.clientY,
      origins: captureCanvasNodeOrigins(nodesRef.current, dragIds),
      moved: false,
      suppressClick,
    };
    pauseCanvasHistory();
  };

  const beginConnection = (event: React.PointerEvent<HTMLElement>, nodeId: string, handleType: ConnectionHandleType) => {
    if (switchingRef.current) return;
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const previewPoint = screenToCanvasPoint(event.clientX, event.clientY);
    connectionDragRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    connectFromRef.current = nodeId;
    connectHandleTypeRef.current = handleType;
    connectionPreviewPointRef.current = previewPoint;
    connectionTargetIdRef.current = "";
    pendingConnectionCreateRef.current = null;
    // 不调用 applyNodeSelection，避免打开 Inspector
    setConnectFrom(nodeId);
    setConnectHandleType(handleType);
    setConnectionPreviewPoint(previewPoint);
    setConnectionTargetId("");
    setPendingConnectionCreate(null);
    setContextMenu(null);
  };

  const moveDrag = (event: PointerEvent<HTMLElement>) => {
    if (switchingRef.current) return;
    const drag = dragRef.current;
    if (!drag) return;
    const scale = viewportRef.current.zoom / 100;
    const deltaX = (event.clientX - drag.startX) / scale;
    const deltaY = (event.clientY - drag.startY) / scale;
    if (!drag.moved && Math.abs(deltaX) < 2 && Math.abs(deltaY) < 2) return;
    drag.moved = Math.abs(deltaX) > 0.01 || Math.abs(deltaY) > 0.01;
    const nextNodes = moveCanvasNodesFromOrigins(nodesRef.current, drag.origins, deltaX, deltaY);
    nodesRef.current = nextNodes;
    setNodes(nextNodes);
  };

  const endDrag = () => {
    const drag = dragRef.current;
    if (drag?.moved || drag?.suppressClick) {
      suppressNodeClickRef.current = drag.id;
      window.setTimeout(() => {
        if (suppressNodeClickRef.current === drag.id) suppressNodeClickRef.current = "";
      }, 0);
    }
    dragRef.current = null;
    resumeCanvasHistory(Boolean(drag?.moved));
  };

  const clearConnectionDraft = useCallback(() => {
    connectionDragRef.current.active = false;
    connectionDragRef.current.pointerId = null;
    connectionDragRef.current.moved = false;
    connectFromRef.current = "";
    connectHandleTypeRef.current = "source";
    connectionTargetIdRef.current = "";
    connectionPreviewPointRef.current = null;
    setConnectFrom("");
    setConnectHandleType("source");
    setConnectionTargetId("");
    setConnectionPreviewPoint(null);
  }, []);

  const cancelPendingConnectionCreate = useCallback(() => {
    clearConnectionDraft();
    pendingConnectionCreateRef.current = null;
    setPendingConnectionCreate(null);
  }, [clearConnectionDraft]);

  const finishConnectionDrag = useCallback((event: { clientX: number; clientY: number }) => {
    if (switchingRef.current) {
      clearConnectionDraft();
      return;
    }
    if (!connectionDragRef.current.active) return;
    const current = connectFromRef.current;
    if (!current) {
      clearConnectionDraft();
      return;
    }
    const handleType = connectHandleTypeRef.current;
    const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, { nodeId: current, handleType });
    const targetNodeId = dropTarget.nodeId || getConnectionDomDropTargetId(event.clientX, event.clientY, { nodeId: current, handleType });
    if (targetNodeId) {
      connectNodes(current, targetNodeId, handleType);
      clearConnectionDraft();
      return;
    }
    if (!connectionDragRef.current.moved) {
      connectionDragRef.current.active = false;
      connectionDragRef.current.pointerId = null;
      connectionTargetIdRef.current = "";
      connectionPreviewPointRef.current = null;
      pendingConnectionCreateRef.current = null;
      setConnectionTargetId("");
      setConnectionPreviewPoint(null);
      setPendingConnectionCreate(null);
      toast.info("已选择连接起点，请点击目标节点完成连线；按 Esc 可取消");
      return;
    }
    if (!dropTarget.isNearNode) {
      const point = screenToCanvasPoint(event.clientX, event.clientY);
      const pendingCreate = {
        x: clientToStagePoint(event.clientX, event.clientY).x,
        y: clientToStagePoint(event.clientX, event.clientY).y,
        canvasX: point.x,
        canvasY: point.y,
        connection: { nodeId: current, handleType },
      };
      pendingConnectionCreateRef.current = pendingCreate;
      setPendingConnectionCreate(pendingCreate);
    }
    connectionDragRef.current.active = false;
    connectionDragRef.current.pointerId = null;
    connectionDragRef.current.moved = false;
    connectFromRef.current = "";
    connectHandleTypeRef.current = "source";
    connectionTargetIdRef.current = "";
    connectionPreviewPointRef.current = null;
    setConnectFrom("");
    setConnectHandleType("source");
    setConnectionTargetId("");
    setConnectionPreviewPoint(null);
  }, [clientToStagePoint, clearConnectionDraft, connectNodes, getConnectionDomDropTargetId, getConnectionDropTarget, screenToCanvasPoint]);

  const startResize = (event: PointerEvent<HTMLButtonElement>, node: CanvasNodeData) => {
    if (switchingRef.current) return;
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = {
      id: node.id,
      startX: event.clientX,
      startY: event.clientY,
      width: node.width,
      height: node.height,
      currentWidth: node.width,
      currentHeight: node.height,
      moved: false,
    };
    pauseCanvasHistory();
  };

  const moveResize = (event: PointerEvent<HTMLButtonElement>) => {
    if (switchingRef.current) return;
    const resize = resizeRef.current;
    if (!resize) return;
    const scale = viewportRef.current.zoom / 100;
    const width = Math.round(clamp(resize.width + (event.clientX - resize.startX) / scale, 220, 960));
    const height = Math.round(clamp(resize.height + (event.clientY - resize.startY) / scale, 120, 720));
    if (width === resize.currentWidth && height === resize.currentHeight) return;
    resize.currentWidth = width;
    resize.currentHeight = height;
    resize.moved = width !== resize.width || height !== resize.height;
    updateNode(resize.id, { width, height });
  };

  const endResize = () => {
    const resize = resizeRef.current;
    resizeRef.current = null;
    resumeCanvasHistory(Boolean(resize?.moved));
  };

  const stopPanInteraction = () => {
    panStateRef.current.mode = "idle";
    setPanMode("idle");
    setDocumentPanCursor(false);
  };

  const clearSelectionBox = useCallback(() => {
    selectionBoxRef.current = null;
    setSelectionBox(null);
  }, []);

  const finishSelectionBox = useCallback(() => {
    const current = selectionBoxRef.current;
    if (!current) return false;
    const rect = normalizeCanvasSelectionRect(current.start, current.current);
    const currentNodes = nodesRef.current;
    const hitIds = canvasNodesInSelectionRect(currentNodes.filter((node) => !isHiddenCanvasBatchChild(node, currentNodes)), rect);
    const next = current.additive ? new Set(current.baseIds) : new Set<string>();
    hitIds.forEach((id) => next.add(id));
    applyNodeSelection(next, hitIds.at(-1) || next.values().next().value || "", false);
    clearSelectionBox();
    setContextMenu(null);
    pendingConnectionCreateRef.current = null;
    setPendingConnectionCreate(null);
    clearConnectionDraft();
    return true;
  }, [applyNodeSelection, clearConnectionDraft, clearSelectionBox]);

  const startSelectionBox = (event: PointerEvent<Element>) => {
    if (switchingRef.current || loadingRef.current || (projectId && !canonicalProjectScopeRef.current) || event.button !== 0 || isSpacePressedRef.current) return false;
    const target = event.target as HTMLElement;
    if (isCanvasHotkeyEditingTarget(target) || target.closest(".real-canvas-node, .real-canvas-edge-hit, .canvas-context-menu, .canvas-connection-create-menu")) return false;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = screenToCanvasPoint(event.clientX, event.clientY);
    const next: CanvasSelectionBoxState = {
      start: point,
      current: point,
      additive: event.shiftKey,
      baseIds: new Set(selectedNodeIdsRef.current),
    };
    selectionBoxRef.current = next;
    setSelectionBox(next);
    return true;
  };

  const startPan = (event: PointerEvent<Element>) => {
    if (switchingRef.current || loadingRef.current || (projectId && !canonicalProjectScopeRef.current)) return false;
    const target = event.target as HTMLElement;
    if (isCanvasHotkeyEditingTarget(target) || target.closest(".real-canvas-node, .canvas-context-menu, .canvas-connection-create-menu")) return false;
    const shouldPan = event.button === 1 || (event.button === 0 && isSpacePressedRef.current);
    if (!shouldPan) return false;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const state = panStateRef.current;
    if (event.button === 1 && state.mode === "locked-pan") {
      stopPanInteraction();
      return true;
    }
    const now = Date.now();
    const shouldLock = event.button === 1 && now - state.lastMiddleDownAt <= MIDDLE_PAN_DOUBLE_CLICK_MS;
    state.lastMiddleDownAt = event.button === 1 ? now : state.lastMiddleDownAt;
    state.mode = shouldLock ? "locked-pan" : "hold-pan";
    state.startClientX = event.clientX;
    state.startClientY = event.clientY;
    state.lastClientX = event.clientX;
    state.lastClientY = event.clientY;
    state.startPanX = viewportRef.current.panX;
    state.startPanY = viewportRef.current.panY;
    setPanMode(state.mode);
    setDocumentPanCursor(true);
    return true;
  };

  const handleStagePointerDown = (event: PointerEvent<HTMLElement>) => {
    if (pendingConnectionCreateRef.current) cancelPendingConnectionCreate();
    if (startPan(event)) return;
    startSelectionBox(event);
  };

  const movePanGrid = (event: { clientX: number; clientY: number }) => {
    if (switchingRef.current) return;
    const pan = panStateRef.current;
    if (pan.mode === "idle") return;
    if (pan.mode === "locked-pan") {
      const dx = event.clientX - pan.lastClientX;
      const dy = event.clientY - pan.lastClientY;
      pan.lastClientX = event.clientX;
      pan.lastClientY = event.clientY;
      const nextViewport = {
        ...viewportRef.current,
        panX: viewportRef.current.panX + dx,
        panY: viewportRef.current.panY + dy,
      };
      viewportRef.current = nextViewport;
      scheduleViewportCommit();
      return;
    }
    const nextViewport = {
      ...viewportRef.current,
      panX: pan.startPanX + event.clientX - pan.startClientX,
      panY: pan.startPanY + event.clientY - pan.startClientY,
    };
    viewportRef.current = nextViewport;
    scheduleViewportCommit();
  };

  const endPanGrid = () => {
    if (panStateRef.current.mode !== "hold-pan") return;
    stopPanInteraction();
  };

  useEffect(() => {
    const handlePointerMove = (event: globalThis.PointerEvent) => {
      if (switchingRef.current) return;
      if (selectionBoxRef.current) {
        const next = { ...selectionBoxRef.current, current: screenToCanvasPoint(event.clientX, event.clientY) };
        selectionBoxRef.current = next;
        // rAF 合帧：一帧内多次 pointermove 只触发一次重渲染，
        // 避免整个画布组件跟随指针高频重绘（在部分 GPU 上会在缩放层留下拖影竖线）
        if (selectionBoxFlushRafRef.current === null) {
          selectionBoxFlushRafRef.current = window.requestAnimationFrame(() => {
            selectionBoxFlushRafRef.current = null;
            if (selectionBoxRef.current) setSelectionBox({ ...selectionBoxRef.current });
          });
        }
        return;
      }
      if (connectionDragRef.current.active && connectFromRef.current) {
        if (!isActiveCanvasConnectionPointer(true, connectionDragRef.current.pointerId, event.pointerId)) return;
        if (!connectionDragRef.current.moved && Math.hypot(
          event.clientX - connectionDragRef.current.startX,
          event.clientY - connectionDragRef.current.startY,
        ) >= 4) {
          connectionDragRef.current.moved = true;
        }
        const handleType = connectHandleTypeRef.current;
        const previewPoint = screenToCanvasPoint(event.clientX, event.clientY);
        const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, { nodeId: connectFromRef.current, handleType });
        connectionPreviewPointRef.current = previewPoint;
        connectionTargetIdRef.current = dropTarget.nodeId;
        setConnectionPreviewPoint(previewPoint);
        setConnectionTargetId(dropTarget.nodeId);
        return;
      }
      movePanGrid(event);
    };
    const handlePointerUp = (event: globalThis.PointerEvent) => {
      if (switchingRef.current) return;
      if (finishSelectionBox()) return;
      if (connectionDragRef.current.active) {
        if (!isActiveCanvasConnectionPointer(true, connectionDragRef.current.pointerId, event.pointerId)) return;
        finishConnectionDrag(event);
        return;
      }
      endPanGrid();
    };
    const cancelInteractions = () => {
      clearConnectionDraft();
      pendingConnectionCreateRef.current = null;
      setPendingConnectionCreate(null);
      clearSelectionBox();
      stopPanInteraction();
    };
    const cancelPointerInteractions = (event: globalThis.PointerEvent) => {
      if (connectionDragRef.current.active && !isActiveCanvasConnectionPointer(true, connectionDragRef.current.pointerId, event.pointerId)) return;
      cancelInteractions();
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", cancelPointerInteractions);
    window.addEventListener("blur", cancelInteractions);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", cancelPointerInteractions);
      window.removeEventListener("blur", cancelInteractions);
    };
  }, [clearConnectionDraft, clearSelectionBox, finishConnectionDrag, finishSelectionBox, getConnectionDropTarget, screenToCanvasPoint]);

  const openCanvasContextMenu = (event: ReactMouseEvent<Element>) => {
    event.preventDefault();
    if (switchingRef.current) return;
    if (isCanvasHotkeyEditingTarget(event.target)) return;
    clearConnectionDraft();
    pendingConnectionCreateRef.current = null;
    setPendingConnectionCreate(null);
    const target = event.target as HTMLElement;
    const nodeEl = target.closest(".real-canvas-node") as HTMLElement | null;
    const edgeEl = target.closest(".real-canvas-edge-hit") as HTMLElement | null;
    const point = clientToStagePoint(event.clientX, event.clientY);
    setContextMenu({
      x: point.x,
      y: point.y,
      canvasX: screenToCanvasPoint(event.clientX, event.clientY).x,
      canvasY: screenToCanvasPoint(event.clientX, event.clientY).y,
      nodeId: nodeEl?.dataset.nodeId || undefined,
      edgeId: edgeEl?.dataset.edgeId || undefined,
    });
    if (!nodeEl) {
      applyNodeSelection([]);
    }
  };

  const handleCanvasDoubleClick = (event: ReactMouseEvent<Element>) => {
    if (switchingRef.current) return;
    const target = event.target as HTMLElement;
    if (isCanvasHotkeyEditingTarget(target) || target.closest(".canvas-node-handle, .canvas-node-label, .real-canvas-edge-hit")) return;
    if (target.closest(".real-canvas-node")) return; // 节点上的双击走节点自身逻辑
    // 双击空白处：唤出空白菜单（新建节点卡片），不再直接创建图片节点
    clearConnectionDraft();
    pendingConnectionCreateRef.current = null;
    setPendingConnectionCreate(null);
    applyNodeSelection([]);
    const point = clientToStagePoint(event.clientX, event.clientY);
    setContextMenu({ x: point.x, y: point.y, canvasX: screenToCanvasPoint(event.clientX, event.clientY).x, canvasY: screenToCanvasPoint(event.clientX, event.clientY).y });
  };

  const openNodeContextMenu = (event: ReactMouseEvent<HTMLElement>, nodeId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const point = clientToStagePoint(event.clientX, event.clientY);
    const current = selectedNodeIdsRef.current;
    applyNodeSelection(current.has(nodeId) ? current : [nodeId], nodeId, current.has(nodeId) ? current.size === 1 : true);
    setContextMenu({ x: point.x, y: point.y, canvasX: screenToCanvasPoint(event.clientX, event.clientY).x, canvasY: screenToCanvasPoint(event.clientX, event.clientY).y, nodeId });
  };

  const handleEdgeClick = (edgeId: string) => {
    applyNodeSelection([]);
    setSelectedEdgeId(edgeId);
    setContextMenu(null);
  };

  const selectEdgeFromCanvasEvent = (event: { clientX: number; clientY: number; target: EventTarget | null; preventDefault: () => void; stopPropagation: () => void }) => {
    if (projectActionDisabled) return "";
    const edgeId = edgeIdFromCanvasEvent(event);
    if (!edgeId) return "";
    event.preventDefault();
    event.stopPropagation();
    handleEdgeClick(edgeId);
    return edgeId;
  };

  const handleCanvasLinesPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    if (selectEdgeFromCanvasEvent(event)) return;
    if (startPan(event)) return;
    startSelectionBox(event);
  };

  const handleCanvasLinesClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    selectEdgeFromCanvasEvent(event);
  };

  const handleCanvasLinesPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (projectActionDisabled) return;
    const edgeId = edgeIdAtClientPoint(event.clientX, event.clientY);
    setHoveredEdgeId((current) => current === edgeId ? current : edgeId);
  };

  const handleCanvasLinesPointerLeave = () => {
    setHoveredEdgeId("");
  };

  const handleCanvasLinesDoubleClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    const edgeId = selectEdgeFromCanvasEvent(event);
    if (edgeId) removeEdge(edgeId);
    else if (!projectActionDisabled) handleCanvasDoubleClick(event);
  };

  const handleCanvasLinesContextMenu = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (projectActionDisabled) {
      event.preventDefault();
      return;
    }
    const edgeId = edgeIdFromCanvasEvent(event);
    if (!edgeId) {
      openCanvasContextMenu(event);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const point = clientToStagePoint(event.clientX, event.clientY);
    const canvasPoint = screenToCanvasPoint(event.clientX, event.clientY);
    handleEdgeClick(edgeId);
    setContextMenu({ x: point.x, y: point.y, canvasX: canvasPoint.x, canvasY: canvasPoint.y, edgeId });
  };

  const updateGenerationNodes = useCallback((updater: (current: CanvasNodeData[]) => CanvasNodeData[]) => {
    const next = updater(nodesRef.current);
    nodesRef.current = next;
    setNodes(next);
    return next;
  }, []);

  const referenceFile = useCallback(async (
    input: { title: string; assetId?: string; assetScope?: WorkspaceScope; content?: string },
    activeScope: WorkspaceScope,
    signal?: AbortSignal,
  ) => {
    let url = input.content || "";
    let objectUrl = "";
    if (input.assetId) {
      objectUrl = await getAssetContentObjectUrl(input.assetId, input.assetScope || activeScope, undefined, signal);
      url = objectUrl;
    }
    if (!url) throw new Error(`参考图“${input.title}”没有可读取内容`);
    // 防御：content 必须是明确的媒体引用/URL，避免把提示词文本 fetch 成 HTML 后以 type=image 上传
    if (!input.assetId && !/^(asset:|data:|blob:|https?:\/\/|\/)/i.test(url)) {
      throw new Error(`参考图“${input.title}”的内容不是可读取的媒体地址`);
    }
    try {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`读取参考图“${input.title}”失败（${response.status}）`);
      const blob = await response.blob();
      const contentType = blob.type || "image/png";
      return new File([blob], imageFileName(input.title, contentType), { type: contentType });
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }, []);

  const prepareImageReferences = useCallback(async (
    inputs: ReturnType<typeof buildCanvasGenerationInputs>,
    activeScope: WorkspaceScope,
    sourceNodeId: string,
    projectKey: string,
    signal?: AbortSignal,
  ) => {
    const files: File[] = [];
    const snapshots: CanvasImageReferenceSnapshot[] = [];
    for (const input of inputs.filter((item) => item.type === "image")) {
      if (signal?.aborted || canonicalProjectKeyRef.current !== projectKey) throw new DOMException("Aborted", "AbortError");
      const file = await referenceFile(input, activeScope, signal);
      let assetId = input.assetId || "";
      let name = file.name;
      let contentType = file.type || "image/png";
      if (!assetId) {
        const asset = await uploadAsset(file, {
          type: "image",
          name: file.name,
          category: "reference",
          source_type: "canvas",
          source_project_id: projectId,
          source_project_name: projectTitle,
          source_metadata: JSON.stringify({ canvas_node_id: input.nodeId, generation_source_node_id: sourceNodeId }),
        }, activeScope, signal);
        assetId = asset.id;
        name = asset.name || name;
        contentType = asset.content_type || contentType;
        if (signal?.aborted || canonicalProjectKeyRef.current !== projectKey) throw new DOMException("Aborted", "AbortError");
        updateGenerationNodes((current) => current.map((node) => node.id === input.nodeId ? {
          ...node,
          content: looksLikeImageSource(node.content) ? "" : node.content,
          imageAssetId: assetId,
          imageSrc: undefined,
          metadata: { ...node.metadata, assetId, content: looksLikeImageSource(node.content) ? "" : node.content },
        } : node));
      }
      if (signal?.aborted || canonicalProjectKeyRef.current !== projectKey) throw new DOMException("Aborted", "AbortError");
      files.push(file);
      snapshots.push({ nodeId: input.nodeId, title: input.title, assetId, assetScope: input.assetScope || activeScope, name, contentType });
    }
    return { files, snapshots };
  }, [projectId, projectTitle, referenceFile, updateGenerationNodes]);

  const prepareVideoReferences = useCallback(async (
    inputs: ReturnType<typeof buildCanvasGenerationInputs>,
    activeScope: WorkspaceScope,
    signal?: AbortSignal,
  ) => hydrateCanvasVideoReferences(inputs, {
    scope: activeScope,
    createFile: createBrowserFile,
    resolveAssetBlob: async (input) => {
      const objectUrl = await getAssetContentObjectUrl(input.assetId, input.assetScope || activeScope, undefined, signal);
      try {
        const response = await fetch(objectUrl, { signal });
        if (!response.ok) throw new Error(`读取引用“${input.title}”失败（${response.status}）`);
        return response.blob();
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    },
    resolveNodeBlob: async (input) => {
      if (!isReadableMediaSource(input.content)) return null;
      const response = await fetch(input.content, { signal });
      if (!response.ok) throw new Error(`读取引用“${input.title}”失败（${response.status}）`);
      return response.blob();
    },
    readImageMetadata: readImageFileMetadata,
    readVideoMetadata: readVideoFileMetadata,
    readAudioMetadata: readAudioFileMetadata,
  }), []);

  const filesFromReferenceSnapshots = useCallback(async (
    snapshots: CanvasImageReferenceSnapshot[],
    activeScope: WorkspaceScope,
    signal?: AbortSignal,
  ) => Promise.all(snapshots.map((snapshot) => referenceFile({
    title: snapshot.title,
    assetId: snapshot.assetId,
    assetScope: snapshot.assetScope,
  }, activeScope, signal))), [referenceFile]);

  const resolveMentionGenerationContext = useCallback(async (
    sourceNode: CanvasNodeData,
    currentNodes: CanvasNodeData[],
    currentEdges: CanvasEdgeData[],
  ) => {
    const activeScope = canonicalProjectScopeRef.current;
    if (!activeScope) throw new Error("正在确认项目工作区");
    const ownPrompt = promptTextFromNode(sourceNode) || sourceNode.title;
    const assetIds = extractCanvasMentionTokens(ownPrompt)
      .filter((token) => token.source === "asset")
      .map((token) => token.targetId);
    const known = new Set(canvasAssets.filter((asset) => asset.scope === activeScope).map((asset) => asset.id));
    const missingAssets = Array.from(new Set(assetIds.filter((id) => !known.has(id))));
    const fetched = (await Promise.allSettled(missingAssets.map((id) => getAsset(id, activeScope))))
      .flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    if (fetched.length) mergeCanvasAssetCatalog(fetched, activeScope);
    const assets = [
      ...canvasAssets.filter((asset) => asset.scope === activeScope),
      ...fetched.map((asset) => ({ ...asset, scope: activeScope })),
    ];
    return buildCanvasMentionGenerationContext(sourceNode.id, currentNodes, currentEdges, ownPrompt, assets, activeScope);
  }, [canvasAssets, mergeCanvasAssetCatalog]);

  const archiveGeneratedImage = useCallback(async (
    generated: GeneratedImage,
    request: CanvasGenerationRequest,
    prompt: string,
  ): Promise<GeneratedImage> => {
    if (generated.assetId) {
      if (generated.src.startsWith("blob:")) URL.revokeObjectURL(generated.src);
      return { ...generated, src: "" };
    }
    if (!generated.src) throw new Error("生成任务没有返回可归档的图片内容");
    const temporaryObjectUrl = generated.src.startsWith("blob:") ? generated.src : "";
    try {
      const response = await fetch(generated.src, { signal: request.controller.signal });
      if (!response.ok) throw new Error(`读取生成结果失败（${response.status}）`);
      const blob = await response.blob();
      const contentType = blob.type || generated.contentType || "image/png";
      const file = new File([blob], imageFileName(generated.name || "generated-image", contentType), { type: contentType });
      const asset = await uploadAsset(file, {
        type: "image",
        name: file.name,
        category: "other",
        source_type: "canvas",
        source_project_id: projectId,
        source_project_name: projectTitle,
        source_metadata: JSON.stringify({ canvas_node_id: request.targetNodeId, prompt }),
      }, request.scope, request.controller.signal);
      return {
        ...generated,
        id: asset.id,
        assetId: asset.id,
        src: "",
        name: asset.name || generated.name,
        contentType: asset.content_type || contentType,
      };
    } finally {
      if (temporaryObjectUrl) URL.revokeObjectURL(temporaryObjectUrl);
    }
  }, [projectId, projectTitle]);

  const runImageTarget = useCallback(async (input: CanvasImageTargetRunInput) => {
    const request = startGenerationRequest({
      targetNodeId: input.targetNodeId,
      originNodeId: input.originNodeId,
      runningNodeId: input.runningNodeId,
      projectKey: input.projectKey,
      scope: input.scope,
      jobId: input.existingJobId,
    });
    const isCurrent = () => currentGenerationRequest(request.targetNodeId, request.requestId, request.projectKey);
    try {
      let generated: GeneratedImage | undefined;
      if (input.existingJobId) {
        const job = await waitForImageJob(input.existingJobId, {
          signal: request.controller.signal,
          onProgress: (state) => updateGenerationProgress(request, state.progress ?? 0),
        });
        if (job.status !== "succeeded") throw new Error(jobErrorMessage(job, job.status === "canceled" ? "生成任务已取消，可重试" : "图片生成失败"));
        generated = (await generatedImagesFromJob(job, input.scope, request.controller.signal))[0];
      } else {
        const result = await generateImages({
          model: input.model,
          prompt: input.prompt,
          size: input.size,
          quality: input.quality,
          count: 1,
          referenceFiles: input.referenceFiles,
          maskFile: input.maskFile,
          scope: input.scope,
          sourceType: "canvas",
          sourceProjectId: projectId,
          sourceNodeId: input.originNodeId,
        }, {
          signal: request.controller.signal,
          onAccepted: (job) => {
            const active = isCurrent();
            if (!active) return;
            const jobId = job.job_id || job.id || "";
            active.jobId = jobId;
            const next = updateGenerationNodes((current) => current.map((node) => node.id === input.targetNodeId ? {
              ...node,
              metadata: { ...node.metadata, jobId, status: "loading", errorDetails: undefined },
            } : node));
            updateGenerationProgress(active, 0);
            void persistSnapshot(next, edgesRef.current, viewportRef.current.zoom, { quiet: true });
          },
          onProgress: (job) => updateGenerationProgress(request, job.progress ?? 0),
        });
        generated = result.images[0];
      }
      const active = isCurrent();
      if (!active || !generated) return false;
      const archived = await archiveGeneratedImage(generated, active, input.prompt);
      if (!isCurrent()) return false;
      const next = updateGenerationNodes((current) => completeGeneratedImageTarget(current, input.targetNodeId, archived, input.prompt));
      await persistSnapshot(next, edgesRef.current, viewportRef.current.zoom, { quiet: true });
      return true;
    } catch (error) {
      if (!isCurrent() || isAbortError(error)) return false;
      const message = publicApiError(error, "画布节点生成失败");
      const next = updateGenerationNodes((current) => failGeneratedImageTarget(current, input.targetNodeId, message));
      await persistSnapshot(next, edgesRef.current, viewportRef.current.zoom, { quiet: true });
      toast.error(message);
      return false;
    } finally {
      finishGenerationRequest(request.targetNodeId, request.requestId, request.projectKey);
    }
  }, [archiveGeneratedImage, currentGenerationRequest, finishGenerationRequest, persistSnapshot, projectId, startGenerationRequest, updateGenerationNodes, updateGenerationProgress]);

  const runTextTarget = useCallback(async (input: CanvasTextTargetRunInput) => {
    const request = startGenerationRequest({
      targetNodeId: input.targetNodeId,
      originNodeId: input.originNodeId,
      runningNodeId: input.runningNodeId,
      projectKey: input.projectKey,
      scope: input.scope,
    });
    const isCurrent = () => currentGenerationRequest(request.targetNodeId, request.requestId, request.projectKey);
    try {
      const response = await requestAiText({
        model: input.model,
        messages: input.messages || buildCanvasTextRequestMessages(input.prompt, []),
      }, request.controller.signal);
      if (!isCurrent()) return false;
      const content = response.content.trim();
      if (!content) throw new Error("文本模型没有返回内容");
      const next = updateGenerationNodes((current) => current.map((node) => node.id === input.targetNodeId ? {
        ...node,
        kind: "text" as const,
        title: content.slice(0, 32) || "生成文本",
        content,
        metadata: {
          ...node.metadata,
          content,
          generationMode: "text" as const,
          model: response.model || input.model,
          prompt: input.prompt,
          sourceNodeId: input.originNodeId,
          status: "success" as const,
          errorDetails: undefined,
          jobId: undefined,
          jobProgress: undefined,
        },
      } : node));
      await persistSnapshot(next, edgesRef.current, viewportRef.current.zoom, { quiet: true });
      return true;
    } catch (error) {
      if (!isCurrent() || isAbortError(error)) return false;
      const message = publicApiError(error, "文本生成失败");
      const next = updateGenerationNodes((current) => failGeneratedTextTarget(current, input.targetNodeId, message));
      await persistSnapshot(next, edgesRef.current, viewportRef.current.zoom, { quiet: true });
      toast.error(message);
      return false;
    } finally {
      finishGenerationRequest(request.targetNodeId, request.requestId, request.projectKey);
    }
  }, [currentGenerationRequest, finishGenerationRequest, persistSnapshot, startGenerationRequest, updateGenerationNodes]);

  const runAudioTarget = useCallback(async (input: CanvasAudioTargetRunInput) => {
    const request = startGenerationRequest({
      targetNodeId: input.targetNodeId,
      originNodeId: input.originNodeId,
      runningNodeId: input.runningNodeId,
      projectKey: input.projectKey,
      scope: input.scope,
    });
    const isCurrent = () => currentGenerationRequest(request.targetNodeId, request.requestId, request.projectKey);
    const config = normalizeAudioGenerationConfig(input.config);
    try {
      const blob = await requestAudioGeneration(config, input.prompt, { signal: request.controller.signal });
      const active = isCurrent();
      if (!active) return false;
      const contentType = blob.type.startsWith("audio/") ? blob.type : audioMimeType(config.format);
      const file = new File([
        blob,
      ], audioFileName(input.prompt.slice(0, 32) || "generated-audio", config.format), { type: contentType });
      const asset = await uploadAsset(file, {
        type: "audio",
        name: file.name,
        category: "other",
        source_type: "canvas",
        source_project_id: projectId,
        source_project_name: projectTitle,
        source_metadata: JSON.stringify({ canvas_node_id: request.targetNodeId, prompt: input.prompt }),
      }, request.scope, request.controller.signal);
      if (!isCurrent()) return false;
      const next = updateGenerationNodes((current) => completeGeneratedAudioTarget(
        current,
        input.targetNodeId,
        asset,
        input.prompt,
        config,
        input.originNodeId,
        input.scope,
      ));
      await persistSnapshot(next, edgesRef.current, viewportRef.current.zoom, { quiet: true });
      return true;
    } catch (error) {
      if (!isCurrent() || isAbortError(error)) return false;
      const message = publicApiError(error, "音频生成失败");
      const next = updateGenerationNodes((current) => failGeneratedAudioTarget(current, input.targetNodeId, message));
      await persistSnapshot(next, edgesRef.current, viewportRef.current.zoom, { quiet: true });
      toast.error(message);
      return false;
    } finally {
      finishGenerationRequest(request.targetNodeId, request.requestId, request.projectKey);
    }
  }, [currentGenerationRequest, finishGenerationRequest, persistSnapshot, projectId, projectTitle, startGenerationRequest, updateGenerationNodes]);

  const archiveGeneratedVideo = useCallback(async (
    result: VideoGenerationResult,
    request: CanvasGenerationRequest,
    prompt: string,
  ): Promise<Asset> => {
    if (result.assetId) {
      if (result.url.startsWith("blob:")) URL.revokeObjectURL(result.url);
      return {
        id: result.assetId,
        type: "video",
        name: result.fileName || "generated-video.mp4",
        content_type: result.mimeType || "video/mp4",
      };
    }
    const temporaryObjectUrl = result.url.startsWith("blob:") ? result.url : "";
    try {
      const blob = await videoGenerationResultToBlob(result, request.controller.signal);
      const contentType = blob.type || result.mimeType || "video/mp4";
      const file = new File([blob], videoFileName(result.fileName || "generated-video", contentType), { type: contentType });
      return uploadAsset(file, {
        type: "video",
        name: file.name,
        category: "other",
        source_type: "canvas",
        source_project_id: projectId,
        source_project_name: projectTitle,
        source_metadata: JSON.stringify({ canvas_node_id: request.targetNodeId, prompt }),
      }, request.scope, request.controller.signal);
    } finally {
      if (temporaryObjectUrl) URL.revokeObjectURL(temporaryObjectUrl);
    }
  }, [projectId, projectTitle]);

  const runVideoTarget = useCallback(async (input: CanvasVideoTargetRunInput) => {
    const request = startGenerationRequest({
      targetNodeId: input.targetNodeId,
      originNodeId: input.originNodeId,
      runningNodeId: input.runningNodeId,
      projectKey: input.projectKey,
      scope: input.scope,
      jobId: input.existingTask?.id,
      provider: input.existingTask?.provider,
    });
    const isCurrent = () => currentGenerationRequest(request.targetNodeId, request.requestId, request.projectKey);
    try {
      let task = input.existingTask;
      if (!task) {
        task = await createVideoGenerationTask(input.config, input.prompt, input.references, { signal: request.controller.signal });
        const active = isCurrent();
        if (!active) return false;
        active.jobId = task.id;
        active.provider = task.provider;
        const accepted = updateGenerationNodes((current) => current.map((node) => node.id === input.targetNodeId ? {
          ...node,
          metadata: {
            ...node.metadata,
            generationMode: "video" as const,
            videoProvider: task!.provider,
            jobId: task!.id,
            jobProgress: 0,
            status: "loading" as const,
            errorDetails: undefined,
          },
        } : node));
        updateGenerationProgress(active, 0);
        await persistSnapshot(accepted, edgesRef.current, viewportRef.current.zoom, { quiet: true });
      }

      let result: VideoGenerationResult | undefined;
      while (isCurrent()) {
        const state = await pollVideoGenerationTask(input.config, task, {
          signal: request.controller.signal,
          onProgress: (job) => updateGenerationProgress(request, job.progress ?? 0),
        });
        if (state.status === "failed") throw new Error(state.error);
        if (state.status === "completed") {
          result = state.result;
          break;
        }
        if (typeof state.progress === "number") updateGenerationProgress(request, state.progress);
        await waitForCanvasPoll(request.controller.signal);
      }
      const active = isCurrent();
      if (!active || !result) return false;
      const asset = await archiveGeneratedVideo(result, active, input.prompt);
      if (!isCurrent()) return false;
      const persistentResult = videoResultPersistentMetadata(result, { ...asset, scope: input.scope });
      const next = updateGenerationNodes((current) => completeGeneratedVideoTarget(
        current,
        input.targetNodeId,
        asset,
        persistentResult,
        input.prompt,
        input.config,
        task!,
        input.originNodeId,
        input.referenceInputs,
        input.scope,
      ));
      await persistSnapshot(next, edgesRef.current, viewportRef.current.zoom, { quiet: true });
      return true;
    } catch (error) {
      if (!isCurrent() || isAbortError(error)) return false;
      const message = publicApiError(error, "视频生成失败");
      const next = updateGenerationNodes((current) => failGeneratedVideoTarget(current, input.targetNodeId, message));
      await persistSnapshot(next, edgesRef.current, viewportRef.current.zoom, { quiet: true });
      toast.error(message);
      return false;
    } finally {
      finishGenerationRequest(request.targetNodeId, request.requestId, request.projectKey);
    }
  }, [archiveGeneratedVideo, currentGenerationRequest, finishGenerationRequest, persistSnapshot, startGenerationRequest, updateGenerationNodes, updateGenerationProgress]);

  const stopGenerationByNodeId = useCallback((nodeId: string) => {
    const requests = Array.from(generationRequestsRef.current.values()).filter((request) => (
      request.targetNodeId === nodeId || request.runningNodeId === nodeId || request.originNodeId === nodeId
    ));
    if (!requests.length) return;
    const affected = new Set(requests.map((request) => request.targetNodeId));
    requests.forEach((request) => {
      generationRequestsRef.current.delete(request.targetNodeId);
      request.controller.abort();
      if (request.jobId && request.provider !== "seedance") void cancelJob(request.jobId, request.scope).catch(() => undefined);
    });
    syncGenerationRequestState();
    const next = updateGenerationNodes((current) => {
      let changed = current.map((node) => affected.has(node.id) && node.metadata?.status === "loading" ? {
        ...node,
        title: "生成已停止",
        metadata: { ...node.metadata, status: "error" as const, errorDetails: "已停止生成，可重试。", jobId: undefined, jobProgress: undefined },
      } : node);
      const roots = new Set(changed.filter((node) => affected.has(node.id)).map((node) => stringValue(node.metadata?.batchRootId)).filter(Boolean));
      roots.forEach((rootId) => { changed = refreshImageBatchRoot(changed, rootId); });
      if (changed.some((node) => node.id === nodeId && node.metadata?.isBatchRoot)) changed = refreshImageBatchRoot(changed, nodeId);
      return changed;
    });
    void persistSnapshot(next, edgesRef.current, viewportRef.current.zoom, { quiet: true });
    toast.message("已停止生成，失败节点可单独重试");
  }, [persistSnapshot, syncGenerationRequestState, updateGenerationNodes]);

  const retryImageNode = useCallback(async (node: CanvasNodeData) => {
    const activeScope = canonicalProjectScopeRef.current;
    const projectKey = canonicalProjectKeyRef.current;
    if (!activeScope || !projectKey || switchingRef.current) return;
    const currentNodes = nodesRef.current;
    // 批次成员模型：基底节点（根）自身也是生成目标之一，重试时要一并纳入
    const targetNodes = node.metadata?.isBatchRoot
      ? currentNodes.filter((item) => (item.id === node.id || node.metadata?.batchChildIds?.includes(item.id)) && item.metadata?.status === "error")
      : [node];
    if (!targetNodes.length) {
      toast.message("没有需要重试的失败结果");
      return;
    }
    await Promise.allSettled(targetNodes.map(async (target) => {
      const snapshots = imageReferenceSnapshots(target.metadata?.referenceInputs);
      const sourceNodeId = stringValue(target.metadata?.sourceNodeId) || target.id;
      let files: File[];
      const preparation = startGenerationPreparation({
        projectKey,
        originNodeId: sourceNodeId,
        targetNodeId: target.id,
        referenceNodeIds: snapshots
          .map((snapshot) => snapshot.nodeId)
          .filter((nodeId) => currentNodes.some((item) => item.id === nodeId)),
      });
      try {
        files = await filesFromReferenceSnapshots(snapshots, activeScope, preparation.controller.signal);
      } catch (error) {
        if (isAbortError(error) || canonicalProjectKeyRef.current !== projectKey) return;
        const message = publicApiError(error, "参考图已失效，无法重试");
        updateGenerationNodes((current) => failGeneratedImageTarget(current, target.id, message));
        return;
      } finally {
        finishGenerationPreparation(preparation.id);
      }
      if (!generationPreparationIsCurrent(preparation)) return;
      const prompt = stringValue(target.metadata?.prompt) || target.content;
      const next = updateGenerationNodes((current) => {
        let mapped = current.map((item) => item.id === target.id ? {
          ...item,
          title: "重新生成中…",
          imageAssetId: undefined,
          imageSrc: undefined,
          metadata: { ...item.metadata, assetId: undefined, content: prompt, status: "loading" as const, errorDetails: undefined, jobId: undefined, ownAssetId: undefined, ownImageSrc: undefined },
        } : item);
        const batchRootId = stringValue(target.metadata?.batchRootId) || (target.metadata?.isBatchRoot ? target.id : "");
        if (batchRootId) mapped = refreshImageBatchRoot(mapped, batchRootId);
        return mapped;
      });
      void persistSnapshot(next, edgesRef.current, viewportRef.current.zoom, { quiet: true });
      await runImageTarget({
        targetNodeId: target.id,
        originNodeId: sourceNodeId,
        runningNodeId: stringValue(target.metadata?.batchRootId) || target.id,
        projectKey,
        scope: activeScope,
        prompt,
        model: stringValue(target.metadata?.model) || imageModel,
        size: toImageSizeValue(sizeFromNode(target)),
        quality: qualityFromNode(target),
        referenceFiles: files,
      });
    }));
  }, [filesFromReferenceSnapshots, finishGenerationPreparation, generationPreparationIsCurrent, imageModel, persistSnapshot, runImageTarget, startGenerationPreparation, updateGenerationNodes]);

  const retryTextNode = useCallback(async (node: CanvasNodeData) => {
    const activeScope = canonicalProjectScopeRef.current;
    const projectKey = canonicalProjectKeyRef.current;
    if (!activeScope || !projectKey || switchingRef.current) return;
    const prompt = stringValue(node.metadata?.prompt) || node.content;
    const model = modelFromNode(node, textModel);
    if (!prompt.trim() || !model) {
      toast.warning(!model ? "请先配置文本模型" : "提示词不能为空");
      return;
    }
    const sourceNodeId = stringValue(node.metadata?.sourceNodeId) || node.id;
    const next = updateGenerationNodes((current) => current.map((item) => item.id === node.id ? {
      ...item,
      title: "重新生成文本中…",
      metadata: {
        ...item.metadata,
        generationMode: "text" as const,
        status: "loading" as const,
        errorDetails: undefined,
        jobId: undefined,
        jobProgress: undefined,
      },
    } : item));
    await persistSnapshot(next, edgesRef.current, viewportRef.current.zoom, { quiet: true });
    if (switchingRef.current || canonicalProjectKeyRef.current !== projectKey) {
      if (canonicalProjectKeyRef.current === projectKey) {
        updateGenerationNodes((current) => failGeneratedTextTarget(current, node.id, "切换画布时生成被中断，可重试。"));
      }
      return;
    }
    await runTextTarget({
      targetNodeId: node.id,
      originNodeId: sourceNodeId,
      runningNodeId: node.id,
      projectKey,
      scope: activeScope,
      prompt,
      model,
    });
  }, [persistSnapshot, runTextTarget, textModel, updateGenerationNodes]);

  const retryAudioNode = useCallback(async (node: CanvasNodeData) => {
    const activeScope = canonicalProjectScopeRef.current;
    const projectKey = canonicalProjectKeyRef.current;
    if (!activeScope || !projectKey || switchingRef.current) return;
    const prompt = stringValue(node.metadata?.prompt) || node.content;
    const config = audioConfigFromNode(node, audioModel);
    if (!prompt.trim() || !config.model) {
      toast.warning(!config.model ? "请先配置音频模型" : "提示词不能为空");
      return;
    }
    const sourceNodeId = stringValue(node.metadata?.sourceNodeId) || node.id;
    const next = updateGenerationNodes((current) => current.map((item) => item.id === node.id ? {
      ...item,
      title: "重新生成音频中…",
      imageAssetId: undefined,
      imageSrc: undefined,
      metadata: {
        ...item.metadata,
        assetId: undefined,
        generationMode: "audio" as const,
        model: config.model,
        audioVoice: config.voice,
        audioFormat: config.format,
        audioSpeed: config.speed,
        audioInstructions: config.instructions,
        status: "loading" as const,
        errorDetails: undefined,
        jobId: undefined,
        jobProgress: undefined,
        mimeType: undefined,
        bytes: undefined,
      },
    } : item));
    await persistSnapshot(next, edgesRef.current, viewportRef.current.zoom, { quiet: true });
    if (switchingRef.current || canonicalProjectKeyRef.current !== projectKey) {
      if (canonicalProjectKeyRef.current === projectKey) {
        updateGenerationNodes((current) => failGeneratedAudioTarget(current, node.id, "切换画布时生成被中断，可重试。"));
      }
      return;
    }
    await runAudioTarget({
      targetNodeId: node.id,
      originNodeId: sourceNodeId,
      runningNodeId: node.id,
      projectKey,
      scope: activeScope,
      prompt,
      config,
    });
  }, [audioModel, persistSnapshot, runAudioTarget, updateGenerationNodes]);

  const retryVideoNode = useCallback(async (node: CanvasNodeData) => {
    const activeScope = canonicalProjectScopeRef.current;
    const projectKey = canonicalProjectKeyRef.current;
    if (!activeScope || !projectKey || switchingRef.current) return;
    const prompt = stringValue(node.metadata?.prompt) || node.content;
    const config = videoConfigFromNode(node, videoModel);
    if (!prompt.trim() || !config.model) {
      toast.warning(!config.model ? "请先配置视频模型" : "提示词不能为空");
      return;
    }
    const snapshot = canvasVideoReferenceSnapshot(node.metadata?.videoReferenceInputs);
    const generationInputs = canvasGenerationInputsFromVideoSnapshot(snapshot, nodesRef.current);
    const sourceNodeId = stringValue(node.metadata?.sourceNodeId) || node.id;
    const preparation = startGenerationPreparation({
      projectKey,
      originNodeId: nodesRef.current.some((item) => item.id === sourceNodeId) ? sourceNodeId : node.id,
      targetNodeId: node.id,
      referenceNodeIds: generationInputs.map((input) => input.nodeId).filter((nodeId) => nodesRef.current.some((item) => item.id === nodeId)),
    });
    let prepared: Awaited<ReturnType<typeof prepareVideoReferences>>;
    try {
      prepared = await prepareVideoReferences(generationInputs, activeScope, preparation.controller.signal);
    } catch (error) {
      if (isAbortError(error) || canonicalProjectKeyRef.current !== projectKey) return;
      const message = publicApiError(error, "视频参考素材已失效，无法重试");
      const next = updateGenerationNodes((current) => failGeneratedVideoTarget(current, node.id, message));
      await persistSnapshot(next, edgesRef.current, viewportRef.current.zoom, { quiet: true });
      toast.error(message);
      return;
    } finally {
      finishGenerationPreparation(preparation.id);
    }
    if (!generationPreparationIsCurrent(preparation)) return;
    const references = mergeCanvasVideoReferences(
      prepared.references,
      canvasSeedanceVideoReferences(
        node.metadata?.seedanceMaterialAssets,
        node.metadata?.seedanceVolcanoAssets,
      ),
    );
    const next = updateGenerationNodes((current) => current.map((item) => item.id === node.id ? {
      ...item,
      title: "重新生成视频中…",
      imageAssetId: undefined,
      imageSrc: undefined,
      metadata: {
        ...item.metadata,
        assetId: undefined,
        generationMode: "video" as const,
        videoProvider: isSeedanceVideoModel(config.model) ? "seedance" : "openai",
        model: config.model,
        size: config.size,
        resolution: config.resolution,
        seconds: config.seconds,
        generateAudio: config.generateAudio,
        watermark: config.watermark,
        videoReferenceInputs: prepared.snapshot,
        status: "loading" as const,
        errorDetails: undefined,
        jobId: undefined,
        jobProgress: 0,
      },
    } : item));
    await persistSnapshot(next, edgesRef.current, viewportRef.current.zoom, { quiet: true });
    if (switchingRef.current || canonicalProjectKeyRef.current !== projectKey) return;
    await runVideoTarget({
      targetNodeId: node.id,
      originNodeId: sourceNodeId,
      runningNodeId: node.id,
      projectKey,
      scope: activeScope,
      prompt,
      config,
      references,
      referenceInputs: prepared.snapshot,
    });
  }, [finishGenerationPreparation, generationPreparationIsCurrent, persistSnapshot, prepareVideoReferences, runVideoTarget, startGenerationPreparation, updateGenerationNodes, videoModel]);

  /** 对选中节点批量重新发起生成（对应旧版 runSelectedGeneration）。 */
  const runSelectedGeneration = useCallback(async () => {
    if (switchingRef.current || loadingRef.current) return;
    const currentNodes = nodesRef.current;
    const candidateIds = Array.from(selectedNodeIdsRef.current);
    const nodesById = new Map(currentNodes.map((node) => [node.id, node]));
    const runners: Record<string, (node: CanvasNodeData) => Promise<void>> = {
      image: retryImageNode,
      text: retryTextNode,
      audio: retryAudioNode,
      video: retryVideoNode,
    };
    const runnable = candidateIds
      .map((id) => nodesById.get(id))
      .filter((node): node is CanvasNodeData => Boolean(
        node
        && runners[node.kind]
        && node.metadata?.status !== "loading"
        && !isHiddenCanvasBatchChild(node, currentNodes),
      ));
    if (!runnable.length) {
      toast.message("没有可运行的选中节点");
      return;
    }
    toast.message(`开始生成 ${runnable.length} 个选中节点`);
    await Promise.allSettled(runnable.map((node) => runners[node.kind](node)));
  }, [retryAudioNode, retryImageNode, retryTextNode, retryVideoNode]);

  useEffect(() => {
    runSelectedGenerationRef.current = runSelectedGeneration;
  }, [runSelectedGeneration]);

  useEffect(() => {
    if (loading || switching || !canonicalProjectScope || !canonicalProjectKeyRef.current) return;
    const projectKey = canonicalProjectKeyRef.current;
    const recoverable = nodesRef.current.filter((node) => (node.kind === "image" || node.kind === "video") && node.metadata?.status === "loading" && stringValue(node.metadata.jobId));
    recoverable.forEach((node) => {
      const jobId = stringValue(node.metadata?.jobId);
      if (!jobId || recoveredJobIdsRef.current.has(jobId) || generationRequestsRef.current.has(node.id)) return;
      recoveredJobIdsRef.current.add(jobId);
      if (node.kind === "video") {
        const config = videoConfigFromNode(node, videoModel);
        const provider = videoProviderFromNode(node, config.model);
        void runVideoTarget({
          targetNodeId: node.id,
          originNodeId: stringValue(node.metadata?.sourceNodeId) || node.id,
          runningNodeId: node.id,
          projectKey,
          scope: canonicalProjectScope,
          prompt: stringValue(node.metadata?.prompt) || node.content,
          config,
          references: { images: [], videos: [], audios: [] },
          referenceInputs: canvasVideoReferenceSnapshot(node.metadata?.videoReferenceInputs),
          existingTask: { id: jobId, provider, model: config.model },
        });
        return;
      }
      void runImageTarget({
        targetNodeId: node.id,
        originNodeId: stringValue(node.metadata?.sourceNodeId) || node.id,
        runningNodeId: stringValue(node.metadata?.batchRootId) || node.id,
        projectKey,
        scope: canonicalProjectScope,
        prompt: stringValue(node.metadata?.prompt) || node.content,
        model: stringValue(node.metadata?.model) || imageModel,
        size: toImageSizeValue(sizeFromNode(node)),
        quality: qualityFromNode(node),
        referenceFiles: [],
        existingJobId: jobId,
      });
    });
  }, [canonicalProjectScope, imageModel, loading, nodes, runImageTarget, runVideoTarget, switching, videoModel]);

  const generateTextFromNode = async (sourceId?: string) => {
    const currentNodes = nodesRef.current;
    const currentEdges = edgesRef.current;
    const sourceNode = (sourceId ? currentNodes.find((node) => node.id === sourceId) : currentNodes.find((node) => node.id === selectedId)) || null;
    if (!sourceNode || switchingRef.current) return;
    const activeScope = canonicalProjectScopeRef.current;
    const projectKey = canonicalProjectKeyRef.current;
    if (!activeScope || !projectKey) {
      toast.warning("正在确认项目工作区，暂不能生成文本节点");
      return;
    }
    let mentionContext: Awaited<ReturnType<typeof resolveMentionGenerationContext>>;
    try {
      mentionContext = await resolveMentionGenerationContext(sourceNode, currentNodes, currentEdges);
    } catch (error) {
      toast.error(publicApiError(error, "解析画布引用失败"));
      return;
    }
    if (mentionContext.missingKeys.length) {
      toast.error(`存在失效引用：${mentionContext.missingKeys.join("、")}`);
      return;
    }
    const prompt = canvasTextRequestPrompt(sourceNode, mentionContext.prompt);
    const model = modelFromNode(sourceNode, textModel);
    if (!prompt.trim() || !model) {
      toast.warning(!model ? "请先配置文本模型" : "提示词不能为空");
      return;
    }
    const generationInputs = mentionContext.inputs;
    const imageInputs = generationInputs.filter((input) => input.type === "image");
    let messages: ResponseInputMessage[] = buildCanvasTextRequestMessages(prompt, []);
    if (imageInputs.length) {
      const preparation = startGenerationPreparation({
        projectKey,
        originNodeId: sourceNode.id,
        referenceNodeIds: imageInputs.filter((input) => !input.assetId).map((input) => input.nodeId),
      });
      try {
        const imageDataUrls: string[] = [];
        for (const input of imageInputs) {
          const file = await referenceFile(input, activeScope, preparation.controller.signal);
          imageDataUrls.push(await readCanvasFileDataUrl(file, preparation.controller.signal));
        }
        if (!generationPreparationIsCurrent(preparation)) return;
        messages = buildCanvasTextRequestMessages(prompt, imageDataUrls);
      } catch (error) {
        if (!isAbortError(error)) toast.error(publicApiError(error, "文本参考图读取失败"));
        return;
      } finally {
        finishGenerationPreparation(preparation.id);
      }
    }
    const isConfigNode = sourceNode.kind === "config";
    const editingTextNode = isGeneratedCanvasText(sourceNode);
    const count = isConfigNode ? imageCountFromNode(sourceNode) : 1;
    const childIds = isConfigNode || editingTextNode ? Array.from({ length: count }, () => crypto.randomUUID()) : [];
    const targetIds = childIds.length ? childIds : [sourceNode.id];
    const childNodes = childIds.map((id, index): CanvasNodeData => ({
      id,
      kind: "text",
      title: `生成文本中${count > 1 ? ` ${index + 1}/${count}` : ""}…`,
      content: "",
      x: sourceNode.x + sourceNode.width + 96,
      y: sourceNode.y + (index - (count - 1) / 2) * 206,
      width: 320,
      height: 170,
      metadata: {
        content: "",
        prompt,
        generationMode: "text",
        model,
        sourceNodeId: sourceNode.id,
        status: "loading",
      },
    }));
    const pendingNodes = childIds.length
      ? [...currentNodes.map((node) => node.id === sourceNode.id && isConfigNode ? {
        ...node,
        metadata: {
          ...node.metadata,
          composerContent: canvasTextComposerValue(sourceNode),
          prompt,
          generationMode: "text" as const,
          model,
          status: "success" as const,
          errorDetails: undefined,
        },
      } : node), ...childNodes]
      : currentNodes.map((node) => node.id === sourceNode.id ? {
        ...node,
        kind: "text" as const,
        title: "生成文本中…",
        content: "",
        metadata: {
          ...node.metadata,
          content: "",
          prompt,
          generationMode: "text" as const,
          model,
          sourceNodeId: sourceNode.id,
          status: "loading" as const,
          errorDetails: undefined,
          jobId: undefined,
          jobProgress: undefined,
        },
      } : node);
    const pendingEdges = childIds.length
      ? [...currentEdges, ...childIds.map((childId): CanvasEdgeData => ({ id: crypto.randomUUID(), from: sourceNode.id, to: childId }))]
      : currentEdges;
    nodesRef.current = pendingNodes;
    edgesRef.current = pendingEdges;
    setNodes(pendingNodes);
    setEdges(pendingEdges);
    applyNodeSelection([childIds[0] || sourceNode.id], childIds[0] || sourceNode.id, true);
    await persistSnapshot(pendingNodes, pendingEdges, viewportRef.current.zoom, { quiet: true });
    if (switchingRef.current || canonicalProjectKeyRef.current !== projectKey) {
      if (canonicalProjectKeyRef.current === projectKey) {
        updateGenerationNodes((current) => targetIds.reduce(
          (next, targetNodeId) => failGeneratedTextTarget(next, targetNodeId, "切换画布时生成被中断，可重试。"),
          current,
        ));
      }
      return;
    }
    const results = await Promise.all(targetIds.map((targetNodeId) => runTextTarget({
      targetNodeId,
      originNodeId: sourceNode.id,
      runningNodeId: sourceNode.id,
      projectKey,
      scope: activeScope,
      prompt,
      model,
      messages,
    })));
    const succeeded = results.filter(Boolean).length;
    if (succeeded && succeeded < targetIds.length) toast.warning(`已生成 ${succeeded}/${targetIds.length} 条文本，失败结果可单独重试`);
  };

  const generateImageFromNode = async (sourceId?: string) => {
    const currentNodes = nodesRef.current;
    const currentEdges = edgesRef.current;
    const sourceNode = (sourceId ? currentNodes.find((node) => node.id === sourceId) : currentNodes.find((node) => node.id === selectedId)) || null;
    if (!sourceNode || switchingRef.current) return;
    const activeScope = canonicalProjectScopeRef.current;
    const projectKey = canonicalProjectKeyRef.current;
    if (!activeScope || !projectKey) {
      toast.warning("正在确认项目工作区，暂不能生成画布节点");
      return;
    }
    let mentionContext: Awaited<ReturnType<typeof resolveMentionGenerationContext>>;
    try {
      mentionContext = await resolveMentionGenerationContext(sourceNode, currentNodes, currentEdges);
    } catch (error) {
      toast.error(publicApiError(error, "解析画布引用失败"));
      return;
    }
    if (mentionContext.missingKeys.length) {
      toast.error(`存在失效引用：${mentionContext.missingKeys.join("、")}`);
      return;
    }
    const prompt = mentionContext.prompt;
    if (!prompt.trim()) {
      toast.warning("请先填写提示词");
      return;
    }
    const generationInputs = mentionContext.inputs;
    const referenceNodeIds = generationInputs.filter((input) => input.type === "image" && !input.assetId).map((input) => input.nodeId);
    let prepared: Awaited<ReturnType<typeof prepareImageReferences>>;
    const preparation = startGenerationPreparation({
      projectKey,
      originNodeId: sourceNode.id,
      referenceNodeIds,
    });
    try {
      prepared = await prepareImageReferences(
        generationInputs,
        activeScope,
        sourceNode.id,
        projectKey,
        preparation.controller.signal,
      );
    } catch (error) {
      if (isAbortError(error) || canonicalProjectKeyRef.current !== projectKey) return;
      toast.error(publicApiError(error, "读取或归档参考图失败"));
      return;
    } finally {
      finishGenerationPreparation(preparation.id);
    }
    if (!generationPreparationIsCurrent(preparation)) return;
    const count = imageCountFromNode(sourceNode);
    // 空图片节点（未上传/未生成内容）直接在自身出图，不再新建衍生节点；
    // 已有结果的图片节点仍走"新建批次根"的衍生链路。批次根/子节点不复用（应由重试入口处理）。
    const reuseSourceNode = sourceNode.kind === "image"
      && !assetIdFromNode(sourceNode)
      && !sourceNode.imageSrc
      && !looksLikeImageSource(stringValue(sourceNode.metadata?.content))
      && !sourceNode.metadata?.isBatchRoot
      && !stringValue(sourceNode.metadata?.batchRootId);
    const rootId = reuseSourceNode ? sourceNode.id : crypto.randomUUID();
    // 基底（根）节点自己生成第 1 张，其余 count-1 张才是子节点：展开后总数 = count，根占网格第一格
    const childIds = count > 1 ? Array.from({ length: count - 1 }, () => crypto.randomUUID()) : [];
    const targetIds = [rootId, ...childIds];
    const model = modelFromNode(sourceNode, imageModel);
    const size = toImageSizeValue(sizeFromNode(sourceNode));
    const quality = qualityFromNode(sourceNode);
    const commonMetadata: CanvasNodeMetadata = {
      content: prompt,
      prompt,
      status: "loading",
      model,
      size,
      quality,
      sourceNodeId: sourceNode.id,
      generationType: prepared.files.length ? "edit" : "generation",
      referenceInputs: prepared.snapshots,
    };
    const rootNode: CanvasNodeData = {
      ...(reuseSourceNode ? sourceNode : {
        id: rootId,
        kind: "image" as const,
        x: sourceNode.x + sourceNode.width + 96,
        y: sourceNode.y + 24,
        width: 320,
        height: 238,
      }),
      id: rootId,
      kind: "image",
      title: "生成中…",
      content: prompt,
      imageAssetId: undefined,
      imageSrc: undefined,
      metadata: {
        ...(reuseSourceNode ? sourceNode.metadata : {}),
        ...commonMetadata,
        count,
        isBatchRoot: count > 1,
        batchChildIds: childIds.length ? childIds : undefined,
        // 成员模型标记：根自身生成第 1 张（旧数据无此标记，加载时会自动迁移）
        batchModelV2: count > 1 ? true : undefined,
        // 复用空节点时清掉可能残留的旧结果引用
        assetId: undefined,
        ownAssetId: undefined,
        ownImageSrc: undefined,
        errorDetails: undefined,
        // 不自动展开：批次生成后保持折叠态，由用户点击徽标手动展开
      },
    };
    // 展开布局以基底节点为基点：根节点占左下格，子图先向上、再向右按两列网格铺开（上 → 右上 → 右 → …）
    const childNodes = childIds.map((id, index): CanvasNodeData => {
      const pos = batchChildGridPosition(rootNode, index);
      return {
        id,
        kind: "image",
        title: `生成中 ${index + 2}/${count}`,
        content: prompt,
        x: pos.x,
        y: pos.y,
        width: 320,
        height: 238,
        metadata: { ...commonMetadata, count: 1, batchRootId: rootId },
      };
    });
    const sourceEdge: CanvasEdgeData = { id: crypto.randomUUID(), from: sourceNode.id, to: rootId };
    // 不再创建根→子连线：批次关系由 metadata.batchChildIds/batchRootId 表达，避免展开时一簇连线
    // 复用空节点时也不新增 source→root 连线（根即源节点自身）
    const pendingNodes = reuseSourceNode
      ? [...nodesRef.current.map((node) => node.id === sourceNode.id ? rootNode : node), ...childNodes]
      : [...nodesRef.current, rootNode, ...childNodes];
    const pendingEdges = reuseSourceNode ? edgesRef.current : [...edgesRef.current, sourceEdge];
    nodesRef.current = pendingNodes;
    edgesRef.current = pendingEdges;
    setNodes(pendingNodes);
    setEdges(pendingEdges);
    applyNodeSelection([rootId], rootId, true);
    await persistSnapshot(pendingNodes, pendingEdges, viewportRef.current.zoom, { quiet: true });
    if (switchingRef.current || canonicalProjectKeyRef.current !== projectKey) {
      if (canonicalProjectKeyRef.current === projectKey) {
        updateGenerationNodes((current) => targetIds.reduce(
          (next, targetNodeId) => failGeneratedImageTarget(next, targetNodeId, "切换画布时生成被中断，可重试。"),
          current,
        ));
      }
      return;
    }
    const results = await Promise.all(targetIds.map((targetNodeId) => runImageTarget({
      targetNodeId,
      originNodeId: sourceNode.id,
      runningNodeId: rootId,
      projectKey,
      scope: activeScope,
      prompt,
      model,
      size,
      quality,
      referenceFiles: prepared.files,
    })));
    if (canonicalProjectKeyRef.current !== projectKey) return;
    const succeeded = results.filter(Boolean).length;
    if (count > 1) {
      const next = updateGenerationNodes((current) => refreshImageBatchRoot(current, rootId));
      await persistSnapshot(next, edgesRef.current, viewportRef.current.zoom, { quiet: true });
      if (succeeded && succeeded < count) toast.warning(`已生成 ${succeeded}/${count} 张，失败结果可单独重试`);
    }
  };

  const generateVideoFromNode = async (sourceId?: string) => {
    const currentNodes = nodesRef.current;
    const currentEdges = edgesRef.current;
    const sourceNode = (sourceId ? currentNodes.find((node) => node.id === sourceId) : currentNodes.find((node) => node.id === selectedId)) || null;
    if (!sourceNode || switchingRef.current) return;
    const activeScope = canonicalProjectScopeRef.current;
    const projectKey = canonicalProjectKeyRef.current;
    if (!activeScope || !projectKey) {
      toast.warning("正在确认项目工作区，暂不能生成视频节点");
      return;
    }
    let mentionContext: Awaited<ReturnType<typeof resolveMentionGenerationContext>>;
    try {
      mentionContext = await resolveMentionGenerationContext(sourceNode, currentNodes, currentEdges);
    } catch (error) {
      toast.error(publicApiError(error, "解析画布引用失败"));
      return;
    }
    if (mentionContext.missingKeys.length) {
      toast.error(`存在失效引用：${mentionContext.missingKeys.join("、")}`);
      return;
    }
    const prompt = mentionContext.prompt;
    const config = videoConfigFromNode(sourceNode, videoModel);
    if (!prompt.trim() || !config.model) {
      toast.warning(!config.model ? "请先配置视频模型" : "提示词不能为空");
      return;
    }
    const generationInputs = mentionContext.inputs;
    const referenceNodeIds = generationInputs.filter((input) => input.type !== "text" && !input.assetId).map((input) => input.nodeId);
    const preparation = startGenerationPreparation({
      projectKey,
      originNodeId: sourceNode.id,
      referenceNodeIds,
    });
    let prepared: Awaited<ReturnType<typeof prepareVideoReferences>>;
    try {
      prepared = await prepareVideoReferences(generationInputs, activeScope, preparation.controller.signal);
    } catch (error) {
      if (isAbortError(error) || canonicalProjectKeyRef.current !== projectKey) return;
      toast.error(publicApiError(error, "读取视频参考素材失败"));
      return;
    } finally {
      finishGenerationPreparation(preparation.id);
    }
    if (!generationPreparationIsCurrent(preparation)) return;
    const references = mergeCanvasVideoReferences(
      prepared.references,
      canvasSeedanceVideoReferences(
        sourceNode.metadata?.seedanceMaterialAssets,
        sourceNode.metadata?.seedanceVolcanoAssets,
      ),
    );

    const reuseSourceNode = sourceNode.kind === "video" && !assetIdFromNode(sourceNode);
    const targetNodeId = reuseSourceNode ? sourceNode.id : crypto.randomUUID();
    const targetNode: CanvasNodeData = {
      id: targetNodeId,
      kind: "video",
      title: "视频生成中…",
      content: prompt,
      x: reuseSourceNode ? sourceNode.x : sourceNode.x + sourceNode.width + 96,
      y: reuseSourceNode ? sourceNode.y : sourceNode.y + 24,
      width: reuseSourceNode ? sourceNode.width : 420,
      height: reuseSourceNode ? sourceNode.height : 260,
      metadata: {
        ...(reuseSourceNode ? sourceNode.metadata : {}),
        assetId: undefined,
        content: prompt,
        prompt,
        generationMode: "video",
        videoProvider: isSeedanceVideoModel(config.model) ? "seedance" : "openai",
        model: config.model,
        size: config.size,
        resolution: config.resolution,
        seconds: config.seconds,
        generateAudio: config.generateAudio,
        watermark: config.watermark,
        sourceNodeId: sourceNode.id,
        videoReferenceInputs: prepared.snapshot,
        seedanceMaterialAssets: sourceNode.metadata?.seedanceMaterialAssets?.map((asset) => ({ ...asset })),
        seedanceVolcanoAssets: sourceNode.metadata?.seedanceVolcanoAssets?.map((asset) => ({ ...asset })),
        status: "loading",
        errorDetails: undefined,
        jobId: undefined,
        jobProgress: 0,
        mimeType: undefined,
        bytes: undefined,
      },
    };
    const pendingNodes = reuseSourceNode
      ? currentNodes.map((node) => node.id === sourceNode.id ? targetNode : node)
      : [...currentNodes, targetNode];
    const pendingEdges = reuseSourceNode
      ? currentEdges
      : [...currentEdges, { id: crypto.randomUUID(), from: sourceNode.id, to: targetNodeId }];
    nodesRef.current = pendingNodes;
    edgesRef.current = pendingEdges;
    setNodes(pendingNodes);
    setEdges(pendingEdges);
    applyNodeSelection([targetNodeId], targetNodeId, true);
    await persistSnapshot(pendingNodes, pendingEdges, viewportRef.current.zoom, { quiet: true });
    if (switchingRef.current || canonicalProjectKeyRef.current !== projectKey) {
      if (canonicalProjectKeyRef.current === projectKey) {
        updateGenerationNodes((current) => failGeneratedVideoTarget(current, targetNodeId, "切换画布时生成被中断，可重试。"));
      }
      return;
    }
    await runVideoTarget({
      targetNodeId,
      originNodeId: sourceNode.id,
      runningNodeId: targetNodeId,
      projectKey,
      scope: activeScope,
      prompt,
      config,
      references,
      referenceInputs: prepared.snapshot,
    });
  };

  const generateAudioFromNode = async (sourceId?: string) => {
    const currentNodes = nodesRef.current;
    const currentEdges = edgesRef.current;
    const sourceNode = (sourceId ? currentNodes.find((node) => node.id === sourceId) : currentNodes.find((node) => node.id === selectedId)) || null;
    if (!sourceNode || switchingRef.current) return;
    const activeScope = canonicalProjectScopeRef.current;
    const projectKey = canonicalProjectKeyRef.current;
    if (!activeScope || !projectKey) {
      toast.warning("正在确认项目工作区，暂不能生成音频节点");
      return;
    }
    let mentionContext: Awaited<ReturnType<typeof resolveMentionGenerationContext>>;
    try {
      mentionContext = await resolveMentionGenerationContext(sourceNode, currentNodes, currentEdges);
    } catch (error) {
      toast.error(publicApiError(error, "解析画布引用失败"));
      return;
    }
    if (mentionContext.missingKeys.length) {
      toast.error(`存在失效引用：${mentionContext.missingKeys.join("、")}`);
      return;
    }
    const prompt = mentionContext.prompt;
    const config = audioConfigFromNode(sourceNode, audioModel);
    if (!prompt.trim() || !config.model) {
      toast.warning(!config.model ? "请先配置音频模型" : "提示词不能为空");
      return;
    }

    const reuseSourceNode = sourceNode.kind === "audio" && !assetIdFromNode(sourceNode);
    const targetNodeId = reuseSourceNode ? sourceNode.id : crypto.randomUUID();
    const targetNode: CanvasNodeData = {
      id: targetNodeId,
      kind: "audio",
      title: "音频生成中…",
      content: prompt,
      x: reuseSourceNode ? sourceNode.x : sourceNode.x + sourceNode.width + 96,
      y: reuseSourceNode ? sourceNode.y : sourceNode.y + Math.max(0, (sourceNode.height - 120) / 2),
      width: reuseSourceNode ? sourceNode.width : 320,
      height: reuseSourceNode ? sourceNode.height : 120,
      metadata: {
        ...(reuseSourceNode ? sourceNode.metadata : {}),
        assetId: undefined,
        content: prompt,
        prompt,
        generationMode: "audio",
        model: config.model,
        audioVoice: config.voice,
        audioFormat: config.format,
        audioSpeed: config.speed,
        audioInstructions: config.instructions,
        sourceNodeId: sourceNode.id,
        status: "loading",
        errorDetails: undefined,
        jobId: undefined,
        jobProgress: undefined,
        mimeType: undefined,
        bytes: undefined,
      },
    };
    const pendingNodes = reuseSourceNode
      ? currentNodes.map((node) => node.id === sourceNode.id ? targetNode : node)
      : [...currentNodes, targetNode];
    const pendingEdges = reuseSourceNode
      ? currentEdges
      : [...currentEdges, { id: crypto.randomUUID(), from: sourceNode.id, to: targetNodeId }];
    nodesRef.current = pendingNodes;
    edgesRef.current = pendingEdges;
    setNodes(pendingNodes);
    setEdges(pendingEdges);
    applyNodeSelection([targetNodeId], targetNodeId, true);
    await persistSnapshot(pendingNodes, pendingEdges, viewportRef.current.zoom, { quiet: true });
    if (switchingRef.current || canonicalProjectKeyRef.current !== projectKey) {
      if (canonicalProjectKeyRef.current === projectKey) {
        updateGenerationNodes((current) => failGeneratedAudioTarget(current, targetNodeId, "切换画布时生成被中断，可重试。"));
      }
      return;
    }
    await runAudioTarget({
      targetNodeId,
      originNodeId: sourceNode.id,
      runningNodeId: targetNodeId,
      projectKey,
      scope: activeScope,
      prompt,
      config,
    });
  };

  const generateFromNode = async (sourceId?: string) => {
    const sourceNode = nodesRef.current.find((node) => node.id === (sourceId || selectedId));
    if (!sourceNode) return;
    const mode = generationModeFromNode(sourceNode);
    if (mode === "text") {
      await generateTextFromNode(sourceNode.id);
      return;
    }
    if (mode === "image") {
      await generateImageFromNode(sourceNode.id);
      return;
    }
    if (mode === "video") {
      await generateVideoFromNode(sourceNode.id);
      return;
    }
    await generateAudioFromNode(sourceNode.id);
  };

  const commitNodeTitle = (node: CanvasNodeData) => {
    const nextTitle = titleDraft.trim();
    if (nextTitle && nextTitle !== node.title) updateNode(node.id, { title: nextTitle });
    setTitleEditingNodeId("");
  };

  const optimizeNodePrompt = async (node: CanvasNodeData, skillPrompt?: string) => {
    const current = promptTextFromNode(node).trim();
    if (!current) return toast.warning("先写点提示词再优化");
    if (promptOptimizing) return;
    if (!textModel) return toast.error("请先配置文本模型");
    setPromptOptimizing(true);
    try {
      const instruction = skillPrompt?.trim() || "你是提示词优化专家。在不改变主体与场景的前提下，补足画面、动作、光影与质感细节，直接返回优化后的提示词本身，不要解释。";
      const result = await requestAiText({
        model: textModel,
        prompt: `${instruction}\n\n待优化的提示词：\n${current}`,
      });
      const optimized = result.content.trim();
      if (!optimized) return toast.warning("优化结果为空");
      updateNodePrompt(node.id, optimized);
      toast.success("提示词已优化");
    } catch (error) {
      toast.error(publicApiError(error, "优化提示词失败"));
    } finally {
      setPromptOptimizing(false);
    }
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
    const activeScope = canonicalProjectScopeRef.current;
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
    const activeScope = canonicalProjectScopeRef.current || "personal";
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
    if (!groupId || runningGroupId || switchingRef.current) return;
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
        if (switchingRef.current || canonicalProjectKeyRef.current !== `${canonicalProjectScopeRef.current}:${projectId}`) break;
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
    const activeScope = canonicalProjectScopeRef.current;
    const projectKey = canonicalProjectKeyRef.current;
    if (!activeScope || !projectKey || switchingRef.current) throw new Error("当前画布尚未准备好");
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
    const nextViewport = canvasViewportFromAgent(nextAgentSnapshot.viewport);
    const nextSelected = new Set(nextAgentSnapshot.selectedNodeIds.filter((id) => nextNodes.some((node) => node.id === id)));

    setAgentUndoSnapshot(before);
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    selectedNodeIdsRef.current = nextSelected;
    setNodes(nextNodes);
    setEdges(nextEdges);
    setSelectedNodeIds(nextSelected);
    setSelectedId(Array.from(nextSelected).at(-1) || "");
    setSelectedGroupId("");
    setSelectedEdgeId("");
    setContextMenu(null);
    applyCanvasViewport(nextViewport);
    await persistSnapshot(nextNodes, nextEdges, nextViewport.zoom, {
      quiet: true,
      panX: nextViewport.panX,
      panY: nextViewport.panY,
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
    const restoredViewport = canvasViewportFromAgent(agentUndoSnapshot.viewport);
    const restoredSelection = new Set(agentUndoSnapshot.selectedNodeIds.filter((id) => restoredNodes.some((node) => node.id === id)));
    nodesRef.current = restoredNodes;
    edgesRef.current = restoredEdges;
    selectedNodeIdsRef.current = restoredSelection;
    setNodes(restoredNodes);
    setEdges(restoredEdges);
    setSelectedNodeIds(restoredSelection);
    setSelectedId(Array.from(restoredSelection).at(-1) || "");
    setSelectedGroupId("");
    setSelectedEdgeId("");
    applyCanvasViewport(restoredViewport);
    await persistSnapshot(restoredNodes, restoredEdges, restoredViewport.zoom, {
      quiet: true,
      panX: restoredViewport.panX,
      panY: restoredViewport.panY,
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
    const activeScope = canonicalProjectScopeRef.current;
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
    if (!list.length || uploadingRef.current || switchingRef.current) return;
    const activeScope = canonicalProjectScopeRef.current;
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
    const activeScope = canonicalProjectScopeRef.current;
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
    const activeScope = canonicalProjectScopeRef.current;
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
    const activeScope = canonicalProjectScopeRef.current;
    const snapshotBase = snapshotBaseRef.current;
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
    const targetScope = projectId ? canonicalProjectScopeRef.current : scope;
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
    const activeScope = canonicalProjectScopeRef.current;
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
    const activeScope = canonicalProjectScopeRef.current;
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

  if (!projectId) {
    return (
      <>
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
                    <div className="abstract-canvas" aria-hidden="true"><span className="abstract-card one" /><span className="abstract-card two" /></div>
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
  /* ---- @ 引用：缩略图 / 详情预览 / 画布定位 ---- */
  // @ 引用的素材详情弹窗（资产库素材或未归档内容用；画布内图片节点直接走带翻页的大图预览）
  const [mentionMediaPreview, setMentionMediaPreview] = useState<{ url: string; title: string; kind: "image" | "video" | "audio" } | null>(null);
  const mentionMediaOwnedUrlRef = useRef(""); // 仅记录本弹窗自己创建的 Object URL，关闭时释放
  const closeMentionMediaPreview = useCallback(() => {
    setMentionMediaPreview(null);
    if (mentionMediaOwnedUrlRef.current) {
      URL.revokeObjectURL(mentionMediaOwnedUrlRef.current);
      mentionMediaOwnedUrlRef.current = "";
    }
  }, []);

  const mentionThumbnailFor = useCallback((reference: CanvasMentionReference) => {
    if (reference.kind !== "image") return "";
    const node = reference.nodeId ? nodesRef.current.find((item) => item.id === reference.nodeId) : undefined;
    if (node) return imageSrcFromNode(node, previews);
    return reference.assetId ? previews[reference.assetId] || "" : "";
  }, [previews]);

  const previewMentionReference = useCallback((reference: CanvasMentionReference) => {
    const node = reference.nodeId ? nodesRef.current.find((item) => item.id === reference.nodeId) : undefined;
    // 画布内图片节点：直接用大图预览弹窗（同组图片可翻页）
    if (node && node.kind === "image" && imageSrcFromNode(node, previews)) {
      setImagePreviewNodeId(node.id);
      return;
    }
    const kind = reference.kind === "video" || reference.kind === "audio" ? reference.kind : "image";
    const directUrl = node
      ? imageSrcFromNode(node, previews)
      : reference.content && isReadableMediaSource(reference.content) ? reference.content : "";
    if (directUrl) {
      setMentionMediaPreview({ url: directUrl, title: reference.title, kind });
      return;
    }
    if (!reference.assetId) return;
    const assetScope = reference.assetScope || canonicalProjectScopeRef.current || "personal";
    void getAssetContentObjectUrl(reference.assetId, assetScope)
      .then((url) => {
        if (mentionMediaOwnedUrlRef.current) URL.revokeObjectURL(mentionMediaOwnedUrlRef.current);
        mentionMediaOwnedUrlRef.current = url;
        setMentionMediaPreview({ url, title: reference.title, kind });
      })
      .catch(() => toast.error("读取素材内容失败"));
  }, [previews]);

  const locateMentionReference = useCallback((reference: CanvasMentionReference) => {
    if (!reference.nodeId) return;
    const currentNodes = nodesRef.current;
    const node = currentNodes.find((item) => item.id === reference.nodeId);
    if (!node) return;
    // 折叠批次里的子图先展开再定位，否则目标不可见
    const batchRootId = stringValue(node.metadata?.batchRootId);
    if (batchRootId && isHiddenCanvasBatchChild(node, currentNodes)) {
      const root = currentNodes.find((item) => item.id === batchRootId);
      if (root && !root.metadata?.imageBatchExpanded) toggleCanvasBatch(batchRootId);
    }
    focusNodeInViewport(reference.nodeId);
  }, [focusNodeInViewport]);

  const nodeCardActions: CanvasNodeCardActions = {
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
  };

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
            <Popover open={canvasSwitcherOpen} onOpenChange={setCanvasSwitcherOpen}>
              <PopoverTrigger asChild>
                <button className="canvas-switcher-trigger" disabled={projectActionDisabled}>
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
          onOpenChange: (open) => {
            if (!open && assetPickerInsertBusy) return;
            setAssetPickerOpen(open);
            if (!open) {
              assetPickerAbortRef.current?.abort();
              setAssetPickerSelectedIds([]);
              setAssetPickerError("");
            }
          },
          onScopeChange: (scope) => {
            setAssetPickerScope(scope);
            setAssetPickerSelectedIds([]);
            void loadAssetPicker(scope, assetPickerQuery, assetPickerKind);
          },
          onKindChange: (kind) => {
            setAssetPickerKind(kind);
            setAssetPickerSelectedIds([]);
            void loadAssetPicker(assetPickerScope, assetPickerQuery, kind);
          },
          onQueryChange: setAssetPickerQuery,
          onSearch: () => void loadAssetPicker(assetPickerScope, assetPickerQuery, assetPickerKind),
          onToggleItem: (itemId) => setAssetPickerSelectedIds((ids) => ids.includes(itemId) ? ids.filter((id) => id !== itemId) : [...ids, itemId]),
          onCancel: () => setAssetPickerOpen(false),
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

function imageCropRectFromDraft(draft: CanvasImageToolDraft): ImageCropRect {
  const x = clamp(draft.cropX / 100, 0, 0.94);
  const y = clamp(draft.cropY / 100, 0, 0.94);
  return {
    x,
    y,
    width: clamp(draft.cropWidth / 100, 0.06, 1 - x),
    height: clamp(draft.cropHeight / 100, 0.06, 1 - y),
  };
}

function imageToolDraftFromCropRect(crop: ImageCropRect) {
  return {
    cropX: Number((crop.x * 100).toFixed(2)),
    cropY: Number((crop.y * 100).toFixed(2)),
    cropWidth: Number((crop.width * 100).toFixed(2)),
    cropHeight: Number((crop.height * 100).toFixed(2)),
  };
}

function canvasFragmentGroups(groups: readonly CanvasGroupData[]): CanvasFragmentGroup[] {
  return groups.map((group) => ({ ...structuredClone(group) } as CanvasFragmentGroup));
}

function fragmentMediaMimeType(kind: "image" | "video" | "audio") {
  if (kind === "video") return "video/mp4";
  if (kind === "audio") return "audio/mpeg";
  return "image/png";
}

function fragmentMediaFileName(title: string, kind: "image" | "video" | "audio", contentType: string) {
  if (kind === "video") return videoFileName(title, contentType);
  if (kind === "audio") return `${safeFileStem(title)}.${audioFileExtension(contentType)}`;
  return imageFileName(title, contentType);
}

function safeFileStem(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").slice(0, 96) || "canvas-media";
}

function canvasAnglePrompt(draft: CanvasImageToolDraft) {
  const horizontal = draft.angleHorizontal < -150 || draft.angleHorizontal > 150
    ? "背面"
    : draft.angleHorizontal < -70
      ? "左侧"
      : draft.angleHorizontal < -15
        ? "左前方"
        : draft.angleHorizontal > 70
          ? "右侧"
          : draft.angleHorizontal > 15
            ? "右前方"
            : "正面";
  const pitch = draft.anglePitch > 35 ? "俯视" : draft.anglePitch < -25 ? "仰视" : "平视";
  const lens = draft.angleLens === "wide" ? "广角" : draft.angleLens === "telephoto" ? "长焦" : "标准";
  return `基于参考图重新生成同一主体的${horizontal}${pitch}视角。保持人物或物体身份、服装、材质、光线、色彩和画风一致；镜头距离 ${draft.angleDistance.toFixed(1)}，使用${lens}镜头。不要把原图做二维拉伸或透视变形，而要生成真实的新机位画面。`;
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



















function waitForCanvasPoll(signal: AbortSignal, delayMs = 1_500) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    const abort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}


function readImageFileMetadata(file: File) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    const cleanup = () => URL.revokeObjectURL(url);
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      cleanup();
      if (!width || !height) reject(new Error("参考图片尺寸读取失败"));
      else resolve({ width, height });
    };
    image.onerror = () => {
      cleanup();
      reject(new Error("参考图片读取失败"));
    };
    image.src = url;
  });
}

function readVideoFileMetadata(file: File) {
  return readTimedMediaMetadata(file, "video").then((metadata) => ({
    width: metadata.width,
    height: metadata.height,
    durationMs: metadata.durationMs,
  }));
}

function readAudioFileMetadata(file: File) {
  return readTimedMediaMetadata(file, "audio").then(({ durationMs }) => ({ durationMs }));
}

function readTimedMediaMetadata(file: File, kind: "video" | "audio") {
  return new Promise<{ width: number; height: number; durationMs: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const media = document.createElement(kind);
    const cleanup = () => {
      media.removeAttribute("src");
      media.load();
      URL.revokeObjectURL(url);
    };
    media.preload = "metadata";
    media.onloadedmetadata = () => {
      const durationMs = Math.round(media.duration * 1000);
      const width = kind === "video" ? (media as HTMLVideoElement).videoWidth : 1;
      const height = kind === "video" ? (media as HTMLVideoElement).videoHeight : 1;
      cleanup();
      if (!Number.isFinite(durationMs) || durationMs <= 0 || width <= 0 || height <= 0) {
        reject(new Error(kind === "video" ? "参考视频元数据读取失败" : "参考音频元数据读取失败"));
      } else {
        resolve({ width, height, durationMs });
      }
    };
    media.onerror = () => {
      cleanup();
      reject(new Error(kind === "video" ? "参考视频读取失败" : "参考音频读取失败"));
    };
    media.src = url;
  });
}





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
