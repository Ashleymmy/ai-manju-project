import { Archive, ArrowLeft, ArrowRight, BookOpen, ClipboardPaste, Download, Film, FolderOpen, History, Loader2, Music2, Plus, RefreshCcw, RotateCcw, Search, SlidersHorizontal, Trash2, Upload, WandSparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import PromptLibraryDialog from "@/components/PromptLibraryDialog";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createVideoGenerationTask,
  fetchAiModels,
  getAssetContentObjectUrl,
  getAssetLibrary,
  isLongSeedanceVideoModel,
  isSeedanceFastVideoModel,
  isSeedanceVideoModel,
  isWanVideoModel,
  modelOptionName,
  normalizeVideoGenerationConfig,
  pollVideoGenerationTask,
  publicApiError,
  uploadAsset,
  validateVideoGenerationReferences,
  videoGenerationResultToBlob,
  videoReferenceLimits,
  videoModelSettings,
  type Asset,
  type VideoGenerationAudioReference,
  type VideoGenerationConfig,
  type VideoGenerationImageReference,
  type VideoGenerationReferences,
  type VideoGenerationResult,
  type VideoGenerationVideoReference,
  type VideoProvider,
  type WorkspaceScope,
} from "@/services/api";
import {
  emptyStoredVideoReferences,
  loadStoredVideoHistory,
  loadStoredVideoMedia,
  paginateStoredVideoHistory,
  persistHistoryThenCleanup,
  privatizeVideoReferences,
  queueStoredVideoHistoryWrite,
  removeDraftVideoMedia,
  removeStoredHistoryResult,
  storeDraftVideoMedia,
  storeVideoHistoryResult,
  type StoredVideoHistoryItem,
  type StoredVideoReference,
  type StoredVideoReferenceSnapshot,
} from "@/services/video-history";

type VideoHistoryItem = StoredVideoHistoryItem & {
  runtimeUrl?: string;
};

type ReferenceKind = "image" | "video" | "audio";
type RuntimeReferenceSource = "local" | "asset";
type RuntimeReferenceMetadata = {
  previewUrl: string;
  source: RuntimeReferenceSource;
  storageKey?: string;
  assetId?: string;
  scope?: WorkspaceScope;
};
type ImageReferenceItem = VideoGenerationImageReference & RuntimeReferenceMetadata;
type VideoReferenceItem = VideoGenerationVideoReference & RuntimeReferenceMetadata;
type AudioReferenceItem = VideoGenerationAudioReference & RuntimeReferenceMetadata;
type ReferenceItem = ImageReferenceItem | VideoReferenceItem | AudioReferenceItem;
type RuntimeReferenceSnapshot = {
  images: ImageReferenceItem[];
  videos: VideoReferenceItem[];
  audios: AudioReferenceItem[];
};
type ReferenceBatchRejection = {
  name: string;
  reason: string;
  item?: ReferenceItem;
};

const historyPageSize = 20;

export default function VideoWorkspaceView() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const referenceAddBusyRef = useRef(false);
  const submitAbortRef = useRef<AbortController | null>(null);
  const pollingControllersRef = useRef<Map<string, AbortController>>(new Map());
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const activePreviewUrlRef = useRef("");
  const historyRef = useRef<VideoHistoryItem[]>([]);
  const activeTaskRef = useRef<VideoHistoryItem | null>(null);
  const historyReadyRef = useRef(false);
  const previewRequestRef = useRef(0);
  const draftReferencesRef = useRef<ReferenceItem[]>([]);
  const archiveBusyRef = useRef("");
  const archiveAbortRef = useRef<AbortController | null>(null);
  const deleteBusyRef = useRef(false);
  const assetRequestRef = useRef<AbortController | null>(null);
  const assetConfirmBusyRef = useRef(false);
  const assetConfirmAbortRef = useRef<AbortController | null>(null);
  const sessionResetBusyRef = useRef(false);
  const mountedRef = useRef(false);
  const persistenceWarningRef = useRef(false);
  const [models, setModels] = useState<string[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [seconds, setSeconds] = useState("6");
  const [size, setSize] = useState("1280x720");
  const [resolution, setResolution] = useState("720p");
  const [generateAudio, setGenerateAudio] = useState(true);
  const [watermark, setWatermark] = useState(false);
  const [running, setRunning] = useState(false);
  const [historyReady, setHistoryReady] = useState(false);
  const [activeTask, setActiveTask] = useState<VideoHistoryItem | null>(null);
  const [history, setHistory] = useState<VideoHistoryItem[]>([]);
  const [imageReferences, setImageReferences] = useState<ImageReferenceItem[]>([]);
  const [videoReferences, setVideoReferences] = useState<VideoReferenceItem[]>([]);
  const [audioReferences, setAudioReferences] = useState<AudioReferenceItem[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [archiveBusyId, setArchiveBusyId] = useState("");
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([]);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [promptLibraryOpen, setPromptLibraryOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [elapsedNow, setElapsedNow] = useState(() => Date.now());
  const [assetScope, setAssetScope] = useState<WorkspaceScope>(() => initialScopeFromSearch());
  const [assetQuery, setAssetQuery] = useState("");
  const [assetItems, setAssetItems] = useState<Asset[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [assetLoading, setAssetLoading] = useState(false);
  const [assetConfirmBusy, setAssetConfirmBusy] = useState(false);
  const [assetError, setAssetError] = useState("");
  const [sessionResetBusy, setSessionResetBusy] = useState(false);
  const [referenceAddBusy, setReferenceAddBusy] = useState(false);

  const effectiveConfig = useMemo(
    () => normalizeVideoGenerationConfig({ model, size, resolution, seconds, generateAudio, watermark }),
    [model, size, resolution, seconds, generateAudio, watermark],
  );
  const effectiveModelRef = useRef(effectiveConfig.model);
  effectiveModelRef.current = effectiveConfig.model;
  const seedanceModel = isSeedanceVideoModel(effectiveConfig.model);
  const fastSeedance = isSeedanceFastVideoModel(effectiveConfig.model);
  const selectedModelLabel = useMemo(
    () => labels[model] || labels[modelOptionName(model)] || modelOptionName(model) || model || "未配置",
    [labels, model],
  );
  activeTaskRef.current = activeTask;

  useEffect(() => {
    if (activeTask?.status !== "queued" && activeTask?.status !== "running") return;
    setElapsedNow(Date.now());
    const timer = window.setInterval(() => setElapsedNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [activeTask?.id, activeTask?.status]);

  useEffect(() => {
    mountedRef.current = true;
    void refreshModels();
    void initializeHistory();
    return () => {
      mountedRef.current = false;
      previewRequestRef.current += 1;
      submitAbortRef.current?.abort();
      archiveAbortRef.current?.abort();
      assetRequestRef.current?.abort();
      assetConfirmAbortRef.current?.abort();
      pollingControllersRef.current.forEach((controller) => controller.abort());
      pollingControllersRef.current.clear();
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current.clear();
      draftReferencesRef.current.forEach((reference) => {
        if (reference.source === "local") {
          void removeDraftVideoMedia(reference.storageKey).catch((error) => {
            console.warn("清理视频草稿媒体失败", error);
          });
        }
      });
    };
  }, []);

  useEffect(() => {
    draftReferencesRef.current = [...imageReferences, ...videoReferences, ...audioReferences];
  }, [audioReferences, imageReferences, videoReferences]);

  async function initializeHistory() {
    try {
      const stored = await loadStoredVideoHistory();
      if (!mountedRef.current) return;
      historyRef.current = stored;
      historyReadyRef.current = true;
      setHistory(stored);
      setHistoryReady(true);
      const first = stored[0] || null;
      setActiveTask(first);
      if (first) void previewHistoryItem(first);
      stored
        .filter((item) => item.task && (item.status === "queued" || item.status === "running"))
        .forEach((item) => beginPolling(item));
    } catch (error) {
      if (!mountedRef.current) return;
      historyReadyRef.current = true;
      setHistoryReady(true);
      toast.warning(publicApiError(error, "视频任务记录暂时无法读取，将仅保留本次页面记录"));
    }
  }

  function warnHistoryPersistence(error: unknown) {
    console.warn("保存视频任务记录失败", error);
    if (persistenceWarningRef.current || !mountedRef.current) return;
    persistenceWarningRef.current = true;
    toast.warning("视频任务记录暂时无法保存到本机");
  }

  function commitHistory(next: VideoHistoryItem[], removed: VideoHistoryItem[] = []) {
    historyRef.current = next;
    if (mountedRef.current) setHistory(next);
    const operation = removed.length
      ? persistHistoryThenCleanup(next, removed)
      : queueStoredVideoHistoryWrite(next);
    void operation.catch(warnHistoryPersistence);
  }

  async function refreshModels() {
    try {
      const catalog = await fetchAiModels();
      if (!mountedRef.current) return;
      setModels(catalog.videoModels);
      setLabels(catalog.modelLabels || {});
      const selected = model && catalog.videoModels.includes(model)
        ? model
        : catalog.defaultVideoModel || catalog.videoModels[0] || "";
      if (selected) applyConfig({ ...effectiveConfig, model: selected });
    } catch (error) {
      if (mountedRef.current) toast.error(publicApiError(error, "读取视频模型失败"));
    }
  }

  function applyConfig(config: VideoGenerationConfig) {
    const normalized = normalizeVideoGenerationConfig(config);
    setModel(normalized.model);
    setSize(normalized.size);
    setResolution(normalized.resolution);
    setSeconds(normalized.seconds);
    setGenerateAudio(normalized.generateAudio);
    setWatermark(normalized.watermark);
  }

  async function generateVideo(override?: {
    prompt: string;
    config: VideoGenerationConfig;
    references?: RuntimeReferenceSnapshot;
  }) {
    if (!historyReadyRef.current) {
      toast.warning("视频任务记录仍在初始化，请稍候");
      return;
    }
    if (referenceAddBusyRef.current || sessionResetBusyRef.current) {
      if (sessionResetBusyRef.current) {
        toast.warning("正在新建视频会话，请稍候");
        return;
      }
      toast.warning("正在读取参考素材，请稍候");
      return;
    }
    if (deleteBusyRef.current || running || submitAbortRef.current || pollingControllersRef.current.size > 0) {
      toast.warning("已有视频任务正在运行，请等待当前任务完成");
      return;
    }
    const text = (override?.prompt ?? prompt).trim();
    const requestConfig = normalizeVideoGenerationConfig(override?.config || effectiveConfig);
    if (!text) {
      toast.error("请输入视频提示词");
      return;
    }
    if (!requestConfig.model) {
      toast.error("请先在管理后台配置可用的视频模型");
      return;
    }
    if (override) {
      setPrompt(text);
      applyConfig(requestConfig);
    }
    const runtimeReferences = override?.references || buildRuntimeReferenceSnapshot();
    const references = generationReferences(runtimeReferences);
    try {
      validateVideoGenerationReferences(references, requestConfig.model);
    } catch (error) {
      toast.error(publicApiError(error, "参考素材不符合要求"));
      return;
    }

    previewRequestRef.current += 1;
    setPreviewLoading(false);
    const previousPreview = activePreviewUrlRef.current;
    activePreviewUrlRef.current = "";
    if (previousPreview) revokeObjectUrl(previousPreview);

    const controller = new AbortController();
    const logId = runtimeId("video_log");
    let privateReferences: StoredVideoReferenceSnapshot | undefined;
    submitAbortRef.current = controller;
    setRunning(true);

    try {
      privateReferences = await privatizeVideoReferences(logId, storedReferences(runtimeReferences));
      const task = await createVideoGenerationTask(requestConfig, text, references, { signal: controller.signal });
      const item: VideoHistoryItem = {
        id: logId,
        model: task.model,
        prompt: text,
        status: "queued",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        provider: task.provider,
        config: requestConfig,
        task,
        references: privateReferences,
      };
      setActiveTask(item);
      upsertHistory(item);
      toast.success("视频任务已提交");
      beginPolling(item);
    } catch (error) {
      if (controller.signal.aborted) {
        if (privateReferences) {
          const temporary: VideoHistoryItem = {
            id: logId,
            model: requestConfig.model,
            prompt: text,
            status: "failed",
            createdAt: Date.now(),
            provider: providerFromModel(requestConfig.model),
            config: requestConfig,
            references: privateReferences,
          };
          void persistHistoryThenCleanup(historyRef.current, [temporary]).catch(warnHistoryPersistence);
        }
        return;
      }
      const message = publicApiError(error, "视频生成失败");
      const failed: VideoHistoryItem = {
        id: logId,
        model: requestConfig.model,
        prompt: text,
        status: "failed",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        provider: providerFromModel(requestConfig.model),
        config: requestConfig,
        references: privateReferences,
        error: message,
      };
      setActiveTask(failed);
      upsertHistory(failed);
      toast.error(message);
    } finally {
      if (submitAbortRef.current === controller) submitAbortRef.current = null;
      if (!pollingControllersRef.current.size) setRunning(false);
    }
  }

  function beginPolling(item: VideoHistoryItem) {
    if (!item.task || pollingControllersRef.current.has(item.id)) return;
    const controller = new AbortController();
    pollingControllersRef.current.set(item.id, controller);
    if (mountedRef.current) setRunning(true);
    updateHistory(item.id, { status: "running", error: undefined, updatedAt: Date.now() });
    void pollTask(item, controller.signal).finally(() => {
      pollingControllersRef.current.delete(item.id);
      if (mountedRef.current && !pollingControllersRef.current.size && !submitAbortRef.current) setRunning(false);
    });
  }

  async function pollTask(item: VideoHistoryItem, signal: AbortSignal) {
    if (!item.task) return;
    const maxAttempts = isWanVideoModel(item.task.model) ? 360 : 120;
    const intervalMs = item.task.provider === "seedance" ? 5_000 : 2_500;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (signal.aborted) return;
      try {
        const state = await pollVideoGenerationTask(item.config, item.task, {
          signal,
          onProgress: (job) => updateHistory(item.id, { progress: job.progress, updatedAt: Date.now() }),
        });
        if (signal.aborted || !mountedRef.current) {
          if (state.status === "completed") revokeObjectUrl(state.result.url);
          return;
        }
        if (state.status === "completed") {
          await completeHistoryItem(item, state.result, signal);
          return;
        }
        if (state.status === "failed") {
          updateHistory(item.id, { status: "failed", error: state.error, updatedAt: Date.now() });
          toast.error(state.error || "视频生成失败");
          return;
        }
        updateHistory(item.id, { status: "running", progress: state.progress, updatedAt: Date.now() });
        if (attempt === maxAttempts - 1) break;
        await wait(intervalMs, signal);
      } catch (error) {
        if (signal.aborted) return;
        const message = publicApiError(error, "视频任务查询失败");
        updateHistory(item.id, { status: "failed", error: message, updatedAt: Date.now() });
        toast.error(message);
        return;
      }
    }
    if (signal.aborted || !mountedRef.current) return;
    const timeoutMessage = isWanVideoModel(item.task.model)
      ? `Wan 视频任务已提交（任务 ID：${item.task.id}），但等待上游生成超过 30 分钟，请稍后查询任务状态`
      : `${item.task.provider === "seedance" ? "Seedance " : ""}视频生成超时，请稍后重试`;
    updateHistory(item.id, { status: "failed", error: timeoutMessage, updatedAt: Date.now() });
    toast.error(timeoutMessage);
  }

  function trackRuntimeUrl(url: string) {
    if (url.startsWith("blob:")) objectUrlsRef.current.add(url);
  }

  async function completeHistoryItem(item: VideoHistoryItem, result: VideoGenerationResult, signal: AbortSignal) {
    if (signal.aborted || !mountedRef.current) {
      revokeObjectUrl(result.url);
      return;
    }
    const fileName = videoFileName({ ...item, fileName: result.fileName || item.fileName });
    const shouldShowPreview = !sessionResetBusyRef.current && activeTaskRef.current?.id === item.id;
    if (result.assetId) {
      if (shouldShowPreview) replaceActivePreview(item.id, result.url);
      try {
        await updateHistoryAndPersist(item.id, {
          status: "succeeded",
          assetId: result.assetId,
          scope: result.scope || "personal",
          mimeType: result.mimeType || "video/mp4",
          fileName,
          archiveState: "archived",
          archiveError: undefined,
          error: undefined,
          updatedAt: Date.now(),
        });
      } catch (error) {
        warnHistoryPersistence(error);
      }
      if (!shouldShowPreview) revokeObjectUrl(result.url);
      if (mountedRef.current && !signal.aborted) toast.success("视频生成完成");
      return;
    }

    if (shouldShowPreview) replaceActivePreview(item.id, result.url);
    let blob: Blob;
    try {
      blob = await videoGenerationResultToBlob(result, signal);
    } catch (error) {
      if (signal.aborted || !mountedRef.current) {
        revokeObjectUrl(result.url);
        return;
      }
      const message = publicApiError(error, "视频已生成，但结果暂时无法保存到本机或资产库");
      if (!shouldShowPreview) revokeObjectUrl(result.url);
      try {
        await updateHistoryAndPersist(item.id, {
          status: "succeeded",
          scope: result.scope || "personal",
          mimeType: result.mimeType || "video/mp4",
          fileName,
          archiveState: "failed",
          archiveError: message,
          error: undefined,
          updatedAt: Date.now(),
        });
      } catch (persistError) {
        warnHistoryPersistence(persistError);
      }
      if (mountedRef.current) toast.warning(message);
      return;
    }
    if (signal.aborted || !mountedRef.current) {
      revokeObjectUrl(result.url);
      return;
    }

    let resultStorageKey: string | undefined;
    try {
      resultStorageKey = await storeVideoHistoryResult(
        item.id,
        blob,
        fileName,
        result.mimeType || blob.type || "video/mp4",
      );
    } catch (error) {
      const message = publicApiError(error, "视频已生成，但本地结果保存失败；刷新页面后可能无法恢复");
      if (!shouldShowPreview) revokeObjectUrl(result.url);
      warnHistoryPersistence(error);
      try {
        await updateHistoryAndPersist(item.id, {
          status: "succeeded",
          scope: result.scope || "personal",
          mimeType: result.mimeType || blob.type || "video/mp4",
          fileName,
          archiveState: "failed",
          archiveError: message,
          error: undefined,
          updatedAt: Date.now(),
        });
      } catch (persistError) {
        warnHistoryPersistence(persistError);
      }
      if (mountedRef.current) toast.warning(message);
      return;
    }
    try {
      await updateHistoryAndPersist(item.id, {
        status: "succeeded",
        scope: result.scope || "personal",
        mimeType: result.mimeType || blob.type || "video/mp4",
        fileName,
        resultStorageKey,
        archiveState: "pending",
        archiveError: undefined,
        error: undefined,
        updatedAt: Date.now(),
      });
    } catch (error) {
      warnHistoryPersistence(error);
      if (!shouldShowPreview) revokeObjectUrl(result.url);
      if (mountedRef.current) toast.warning("视频已生成，但本地任务记录写入失败；暂不自动归档");
      return;
    }
    if (signal.aborted || !mountedRef.current) return;
    if (!shouldShowPreview) revokeObjectUrl(result.url);
    toast.success("视频生成完成");
    await archiveHistoryItem(item.id, blob);
  }

  function replaceActivePreview(id: string, url = "") {
    const previous = activePreviewUrlRef.current;
    if (previous && previous !== url) revokeObjectUrl(previous);
    activePreviewUrlRef.current = url;
    if (url) trackRuntimeUrl(url);
    const item = historyRef.current.find((entry) => entry.id === id);
    if (item && mountedRef.current) setActiveTask({ ...item, runtimeUrl: url || undefined });
  }

  async function previewHistoryItem(item: VideoHistoryItem) {
    if (sessionResetBusyRef.current) return;
    const requestId = ++previewRequestRef.current;
    replaceActivePreview(item.id);
    setPreviewLoading(true);
    try {
      let url = "";
      if (item.assetId) {
        url = await getAssetContentObjectUrl(item.assetId, item.scope || "personal");
        trackRuntimeUrl(url);
      } else if (item.resultStorageKey) {
        const media = await loadStoredVideoMedia(item.resultStorageKey);
        url = createTrackedObjectUrl(media.blob);
      }
      if (!mountedRef.current || requestId !== previewRequestRef.current) {
        if (url) revokeObjectUrl(url);
        return;
      }
      replaceActivePreview(item.id, url);
    } catch (error) {
      if (mountedRef.current && requestId === previewRequestRef.current) {
        toast.error(publicApiError(error, "读取视频结果失败"));
      }
    } finally {
      if (mountedRef.current && requestId === previewRequestRef.current) setPreviewLoading(false);
    }
  }

  async function retryStoredHistoryItem(item: VideoHistoryItem) {
    if (restoreBusy || running || referenceAddBusyRef.current || sessionResetBusyRef.current) {
      if (sessionResetBusyRef.current) toast.warning("正在新建视频会话，请稍候");
      if (referenceAddBusyRef.current) toast.warning("正在读取参考素材，请稍候");
      return;
    }
    setRestoreBusy(true);
    let references: RuntimeReferenceSnapshot | undefined;
    try {
      references = await restoreHistoryReferences(item.references, item.config.model);
      if (!mountedRef.current) {
        await cleanupRuntimeReferences(references);
        references = undefined;
        return;
      }
      await generateVideo({ prompt: item.prompt, config: item.config, references });
    } catch (error) {
      if (mountedRef.current) toast.error(publicApiError(error, "恢复视频任务参考素材失败"));
    } finally {
      if (references) await cleanupRuntimeReferences(references);
      if (mountedRef.current) setRestoreBusy(false);
    }
  }

  async function restoreHistoryToEditor(item: VideoHistoryItem) {
    if (restoreBusy || referenceAddBusyRef.current || sessionResetBusyRef.current) {
      if (sessionResetBusyRef.current) toast.warning("正在新建视频会话，请稍候");
      if (referenceAddBusyRef.current) toast.warning("正在读取参考素材，请稍候");
      return;
    }
    setRestoreBusy(true);
    try {
      const references = await restoreHistoryReferences(item.references, item.config.model);
      if (!mountedRef.current) {
        await cleanupRuntimeReferences(references);
        return;
      }
      await replaceEditorReferences(references);
      setPrompt(item.prompt);
      applyConfig(item.config);
      toast.success("已恢复该记录的参数与参考素材");
    } catch (error) {
      if (mountedRef.current) toast.error(publicApiError(error, "恢复视频任务参考素材失败"));
    } finally {
      if (mountedRef.current) setRestoreBusy(false);
    }
  }

  function upsertHistory(item: VideoHistoryItem) {
    const previous = historyRef.current;
    const next = [item, ...previous.filter((entry) => entry.id !== item.id)];
    commitHistory(next);
  }

  function updateHistory(id: string, patch: Partial<VideoHistoryItem>) {
    void updateHistoryAndPersist(id, patch).catch(warnHistoryPersistence);
  }

  async function updateHistoryAndPersist(id: string, patch: Partial<VideoHistoryItem>) {
    let updated: VideoHistoryItem | undefined;
    const next = historyRef.current.map((item) => {
      if (item.id !== id) return item;
      updated = { ...item, ...patch };
      return updated;
    });
    if (!updated) return undefined;
    historyRef.current = next;
    if (mountedRef.current) {
      setHistory(next);
      setActiveTask((current) => current?.id === id
        ? { ...(updated || current), runtimeUrl: current.runtimeUrl }
        : current);
    }
    await queueStoredVideoHistoryWrite(next);
    return updated;
  }

  function retryHistoryItem(item: VideoHistoryItem) {
    void retryStoredHistoryItem(item);
  }

  function buildRuntimeReferenceSnapshot(): RuntimeReferenceSnapshot {
    return {
      images: [...imageReferences],
      videos: [...videoReferences],
      audios: [...audioReferences],
    };
  }

  async function restoreHistoryReferences(
    stored = emptyStoredVideoReferences(),
    targetModel = effectiveConfig.model,
  ): Promise<RuntimeReferenceSnapshot> {
    const created: ReferenceItem[] = [];
    try {
      const restoreOne = async (reference: StoredVideoReference) => {
        let blob: Blob;
        let previewUrl = "";
        let storageKey: string | undefined;
        try {
          if (reference.source === "asset") {
            if (!reference.assetId) throw new Error(`${reference.name} 缺少资产 ID`);
            previewUrl = await getAssetContentObjectUrl(reference.assetId, reference.scope || "personal");
            trackRuntimeUrl(previewUrl);
            blob = await fetch(previewUrl).then((response) => {
              if (!response.ok) throw new Error(`${reference.name} 读取失败`);
              return response.blob();
            });
          } else {
            if (!reference.storageKey) throw new Error(`${reference.name} 缺少本地媒体`);
            const media = await loadStoredVideoMedia(reference.storageKey);
            blob = media.blob;
            previewUrl = createTrackedObjectUrl(blob);
            const file = new File([blob], reference.name, { type: reference.mime || blob.type });
            storageKey = await storeDraftVideoMedia(file, {
              kind: reference.kind,
              width: reference.width,
              height: reference.height,
              durationMs: reference.durationMs,
            });
          }
          const file = new File([blob], reference.name, { type: reference.mime || blob.type });
          const runtime = runtimeReferenceFromStored(reference, file, previewUrl, storageKey);
          created.push(runtime);
        } catch (error) {
          if (previewUrl) revokeObjectUrl(previewUrl);
          if (storageKey) {
            await removeDraftVideoMedia(storageKey).catch((cleanupError) => {
              console.warn("清理视频草稿媒体失败", cleanupError);
            });
          }
          throw error;
        }
      };
      for (const reference of stored.images) await restoreOne(reference);
      for (const reference of stored.videos) await restoreOne(reference);
      for (const reference of stored.audios) await restoreOne(reference);
      const result = splitRuntimeReferences(created);
      validateVideoGenerationReferences(generationReferences(result), targetModel);
      return result;
    } catch (error) {
      await cleanupRuntimeReferences(splitRuntimeReferences(created));
      throw error;
    }
  }

  async function cleanupRuntimeReferences(references: RuntimeReferenceSnapshot) {
    const items = [...references.images, ...references.videos, ...references.audios];
    items.forEach((reference) => revokeObjectUrl(reference.previewUrl));
    const results = await Promise.allSettled(items.map((reference) => reference.source === "local"
      ? removeDraftVideoMedia(reference.storageKey)
      : Promise.resolve()));
    let failures = 0;
    results.forEach((result) => {
      if (result.status === "rejected") console.warn("清理视频草稿媒体失败", result.reason);
      if (result.status === "rejected") failures += 1;
    });
    return failures;
  }

  async function replaceEditorReferences(references: RuntimeReferenceSnapshot) {
    await cleanupRuntimeReferences(buildRuntimeReferenceSnapshot());
    setImageReferences(references.images);
    setVideoReferences(references.videos);
    setAudioReferences(references.audios);
  }

  async function archiveHistoryItem(id: string, providedBlob?: Blob) {
    const item = historyRef.current.find((entry) => entry.id === id);
    if (!item || item.assetId || deleteBusyRef.current || archiveBusyRef.current) return;
    const controller = new AbortController();
    archiveBusyRef.current = id;
    archiveAbortRef.current = controller;
    if (mountedRef.current) setArchiveBusyId(id);
    try {
      const storedResultKey = item.resultStorageKey;
      const blob = providedBlob || (storedResultKey
        ? (await loadStoredVideoMedia(storedResultKey)).blob
        : undefined);
      if (controller.signal.aborted) return;
      if (!blob) throw new Error("本地视频结果已丢失，无法加入资产库");
      await updateHistoryAndPersist(id, {
        archiveState: "pending",
        archiveError: undefined,
        updatedAt: Date.now(),
      });
      const fileName = videoFileName(item);
      const file = new File([blob], fileName, { type: blob.type || item.mimeType || "video/mp4" });
      const scope = item.scope || "personal";
      const asset = await uploadAsset(file, {
        type: "video",
        name: fileName,
        category: "reference",
        source_type: "manual_upload",
        note: `视频工作台生成：${item.prompt.trim().slice(0, 160)}`,
        source_metadata: JSON.stringify({ source: "video_workbench", log_id: item.id }),
      }, scope, controller.signal);
      await updateHistoryAndPersist(id, {
        assetId: asset.id,
        scope,
        mimeType: asset.content_type || file.type,
        fileName: asset.name || fileName,
        resultStorageKey: undefined,
        archiveState: "archived",
        archiveError: undefined,
        updatedAt: Date.now(),
      });
      if (mountedRef.current) toast.success("视频已加入资产库");
      if (storedResultKey) {
        try {
          await removeStoredHistoryResult(id, storedResultKey);
        } catch (cleanupError) {
          console.warn("清理已归档的本地视频结果失败", cleanupError);
          if (mountedRef.current) toast.warning("视频已加入资产库，但本机缓存清理失败");
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = publicApiError(error, "视频归档失败，可稍后重试");
      try {
        await updateHistoryAndPersist(id, {
          status: "succeeded",
          archiveState: "failed",
          archiveError: message,
          updatedAt: Date.now(),
        });
      } catch (persistError) {
        warnHistoryPersistence(persistError);
      }
      if (mountedRef.current) toast.warning(message);
    } finally {
      if (archiveAbortRef.current === controller) archiveAbortRef.current = null;
      if (archiveBusyRef.current === id) archiveBusyRef.current = "";
      if (mountedRef.current) setArchiveBusyId("");
    }
  }

  async function downloadHistoryItem(item: VideoHistoryItem) {
    if (sessionResetBusyRef.current) return;
    try {
      let blob: Blob;
      if (item.assetId) {
        const url = await getAssetContentObjectUrl(item.assetId, item.scope || "personal");
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`视频内容下载失败：${response.status}`);
          blob = await response.blob();
        } finally {
          URL.revokeObjectURL(url);
        }
      } else if (item.resultStorageKey) {
        blob = (await loadStoredVideoMedia(item.resultStorageKey)).blob;
      } else if (item.runtimeUrl) {
        blob = await videoGenerationResultToBlob({
          url: item.runtimeUrl,
          mimeType: item.mimeType,
          scope: item.scope,
        });
      } else {
        throw new Error("该记录没有可下载的视频结果");
      }
      downloadBlob(blob, videoFileName(item), item.mimeType);
    } catch (error) {
      toast.error(publicApiError(error, "下载视频失败"));
    }
  }

  async function deleteSelectedHistory() {
    if (deleteBusyRef.current || sessionResetBusyRef.current) return;
    if (submitAbortRef.current || pollingControllersRef.current.size || archiveBusyRef.current) {
      toast.warning("视频任务或归档仍在进行，请等待完成后再删除记录");
      return;
    }
    const selected = new Set(selectedHistoryIds);
    const removed = historyRef.current.filter((item) => selected.has(item.id));
    if (!removed.length) return;
    if (removed.some((item) => item.status === "queued" || item.status === "running")) {
      toast.warning("运行中的视频任务不能删除，请等待任务结束");
      return;
    }
    if (removed.some((item) => item.id === archiveBusyRef.current)) {
      toast.warning("视频正在加入资产库，请等待归档结束后再删除记录");
      return;
    }
    deleteBusyRef.current = true;
    setDeleteBusy(true);
    try {
      const next = historyRef.current.filter((item) => !selected.has(item.id));
      const cleanupErrors = await persistHistoryThenCleanup(next, removed);
      historyRef.current = next;
      setHistory(next);
      setSelectedHistoryIds([]);
      setDeleteConfirmOpen(false);
      const activeRemoved = activeTask ? selected.has(activeTask.id) : false;
      if (activeRemoved) {
        previewRequestRef.current += 1;
        const previous = activePreviewUrlRef.current;
        activePreviewUrlRef.current = "";
        if (previous) revokeObjectUrl(previous);
        const fallback = next[0] || null;
        setActiveTask(fallback);
        if (fallback) void previewHistoryItem(fallback);
      }
      if (cleanupErrors.length) {
        toast.warning("记录已删除，但部分本机媒体清理失败；服务器资产保持不变");
      } else {
        toast.success("视频记录已删除，服务器资产保持不变");
      }
    } catch (error) {
      warnHistoryPersistence(error);
      toast.error(publicApiError(error, "删除视频记录失败"));
    } finally {
      deleteBusyRef.current = false;
      if (mountedRef.current) setDeleteBusy(false);
    }
  }

  async function createSession() {
    if (sessionResetBusyRef.current || submitAbortRef.current || referenceAddBusyRef.current || assetConfirmBusyRef.current || deleteBusyRef.current || restoreBusy) {
      toast.warning("当前操作尚未完成，请稍候再新建会话");
      return;
    }
    sessionResetBusyRef.current = true;
    setSessionResetBusy(true);
    previewRequestRef.current += 1;
    setPreviewLoading(false);
    const previousPreview = activePreviewUrlRef.current;
    activePreviewUrlRef.current = "";
    if (previousPreview) revokeObjectUrl(previousPreview);
    activeTaskRef.current = null;
    setActiveTask(null);
    try {
      const cleanupFailures = await cleanupRuntimeReferences(buildRuntimeReferenceSnapshot());
      if (!mountedRef.current) return;
      setPrompt("");
      setImageReferences([]);
      setVideoReferences([]);
      setAudioReferences([]);
      setSelectedHistoryIds([]);
      setDeleteConfirmOpen(false);
      setHistoryDialogOpen(false);
      if (cleanupFailures) {
        toast.warning("已新建视频会话，但部分本机草稿媒体清理失败；历史任务保持不变");
      } else {
        toast.success("已新建视频会话，历史任务与后台轮询保持不变");
      }
    } finally {
      sessionResetBusyRef.current = false;
      if (mountedRef.current) setSessionResetBusy(false);
    }
  }

  async function addReferencesFromClipboard() {
    if (!navigator.clipboard?.read) {
      toast.error("当前浏览器不支持读取剪贴板图片");
      return;
    }
    if (referenceAddBusyRef.current || sessionResetBusyRef.current) {
      toast.warning(sessionResetBusyRef.current ? "正在新建视频会话，请稍候" : "正在读取参考素材，请稍候");
      return;
    }
    referenceAddBusyRef.current = true;
    setReferenceAddBusy(true);
    try {
      const items = await navigator.clipboard.read();
      const files: File[] = [];
      for (const item of items) {
        const mime = item.types.find((type) => type.startsWith("image/"));
        if (!mime) continue;
        const blob = await item.getType(mime);
        files.push(new File([blob], `clipboard-${files.length + 1}.${clipboardImageExtension(mime)}`, {
          type: blob.type || mime,
          lastModified: Date.now(),
        }));
      }
      if (!files.length) {
        toast.error("剪贴板里没有可读取的图片");
        return;
      }
      await ingestReferenceFiles(files);
    } catch (error) {
      if (mountedRef.current) toast.error(publicApiError(error, "读取剪贴板图片失败"));
    } finally {
      referenceAddBusyRef.current = false;
      if (mountedRef.current) setReferenceAddBusy(false);
    }
  }

  async function addReferenceFiles(files: FileList | readonly File[] | null) {
    const selected = Array.from(files || []);
    if (!selected.length) return;
    if (referenceAddBusyRef.current || sessionResetBusyRef.current) {
      toast.warning(sessionResetBusyRef.current ? "正在新建视频会话，请稍候" : "正在读取参考素材，请稍候");
      return;
    }
    referenceAddBusyRef.current = true;
    setReferenceAddBusy(true);
    try {
      await ingestReferenceFiles(selected);
    } finally {
      referenceAddBusyRef.current = false;
      if (mountedRef.current) setReferenceAddBusy(false);
    }
  }

  async function ingestReferenceFiles(selected: readonly File[]) {
    const created: ReferenceItem[] = [];
    const rejected: ReferenceBatchRejection[] = [];

    try {
      for (const file of selected) {
        if (!mountedRef.current) throw new Error("页面已关闭");
        try {
          if (isImageFile(file)) {
            if (file.size > videoReferenceLimits.imageMaxBytes) throw new Error("超过 30MB");
            created.push(await createImageReference(file, createTrackedObjectUrl, revokeObjectUrl));
            continue;
          }
          if (isVideoFile(file)) {
            if (file.size > videoReferenceLimits.videoMaxBytes) throw new Error("超过 50MB");
            created.push(await createVideoReference(file, createTrackedObjectUrl, revokeObjectUrl));
            continue;
          }
          if (isAudioFile(file)) {
            if (file.size > videoReferenceLimits.audioMaxBytes) throw new Error("超过 15MB");
            created.push(await createAudioReference(file, createTrackedObjectUrl, revokeObjectUrl));
            continue;
          }
          throw new Error("格式不支持，请使用图片、mp4/mov 视频或 mp3/wav 音频");
        } catch (error) {
          rejected.push({ name: file.name, reason: referenceRejectionMessage(error) });
        }
      }

      const plan = planReferenceBatch(buildRuntimeReferenceSnapshot(), created, effectiveModelRef.current);
      rejected.push(...plan.rejected);
      revokeReferenceItems(plan.rejected.flatMap((entry) => entry.item ? [entry.item] : []), revokeObjectUrl);
      const accepted: ReferenceItem[] = [];
      for (const reference of plan.accepted) {
        if (!reference.file) {
          rejected.push({ name: reference.name, reason: "本地文件已失效，请重新选择" });
          continue;
        }
        try {
          reference.storageKey = await storeDraftVideoMedia(reference.file, {
            kind: reference.kind,
            width: "width" in reference ? reference.width : undefined,
            height: "height" in reference ? reference.height : undefined,
            durationMs: "durationMs" in reference ? reference.durationMs : undefined,
          });
          accepted.push(reference);
        } catch (error) {
          revokeObjectUrl(reference.previewUrl);
          rejected.push({ name: reference.name, reason: referenceRejectionMessage(error, "本地保存失败") });
        }
      }
      if (!mountedRef.current) {
        await cleanupRuntimeReferences(splitRuntimeReferences(accepted));
        return;
      }
      const batch = splitRuntimeReferences(accepted);
      if (accepted.length) {
        setImageReferences([...imageReferences, ...batch.images]);
        setVideoReferences([...videoReferences, ...batch.videos]);
        setAudioReferences([...audioReferences, ...batch.audios]);
        toast.success(`已添加 ${accepted.length} 个参考素材`);
      }
      warnReferenceRejections(rejected);
    } catch (error) {
      await cleanupRuntimeReferences(splitRuntimeReferences(created));
      if (mountedRef.current) toast.error(publicApiError(error, "参考素材读取失败"));
    }
  }

  async function openAssetPicker() {
    if (sessionResetBusyRef.current || referenceAddBusyRef.current) {
      toast.warning(sessionResetBusyRef.current ? "正在新建视频会话，请稍候" : "正在读取参考素材，请稍候");
      return;
    }
    setAssetPickerOpen(true);
    setSelectedAssetIds([]);
    await loadAssetPicker(assetScope, assetQuery);
  }

  async function loadAssetPicker(scope = assetScope, keyword = assetQuery) {
    assetRequestRef.current?.abort();
    const controller = new AbortController();
    assetRequestRef.current = controller;
    setAssetLoading(true);
    setAssetError("");
    try {
      const response = await getAssetLibrary(scope, {
        keyword: keyword.trim() || undefined,
        page: 1,
        pageSize: 60,
        sort: "created_at_desc",
      }, controller.signal);
      if (!mountedRef.current || controller.signal.aborted) return;
      setAssetItems(response.items.filter((asset) => asset.type === "image" || asset.type === "video" || asset.type === "audio"));
    } catch (error) {
      if (controller.signal.aborted || !mountedRef.current) return;
      const message = publicApiError(error, "读取资产库失败");
      setAssetError(message);
      setAssetItems([]);
    } finally {
      if (assetRequestRef.current === controller) assetRequestRef.current = null;
      if (mountedRef.current && !controller.signal.aborted) setAssetLoading(false);
    }
  }

  function toggleAssetSelection(id: string) {
    setSelectedAssetIds((ids) => ids.includes(id)
      ? ids.filter((item) => item !== id)
      : [...ids, id]);
  }

  async function confirmAssetSelection() {
    if (assetConfirmBusyRef.current || referenceAddBusyRef.current || sessionResetBusyRef.current) return;
    const existingAssetIds = new Set(
      [...imageReferences, ...videoReferences, ...audioReferences]
        .map((reference) => reference.assetId)
        .filter((id): id is string => Boolean(id)),
    );
    const duplicateAssets = assetItems.filter((asset) => selectedAssetIds.includes(asset.id) && existingAssetIds.has(asset.id));
    const selected = assetItems.filter((asset) => selectedAssetIds.includes(asset.id) && !existingAssetIds.has(asset.id));
    if (!selected.length && selectedAssetIds.length) {
      toast.warning("所选资产已经在参考素材中");
      return;
    }
    if (!selected.length) return;
    assetConfirmBusyRef.current = true;
    referenceAddBusyRef.current = true;
    setReferenceAddBusy(true);
    const controller = new AbortController();
    assetConfirmAbortRef.current = controller;
    setAssetConfirmBusy(true);
    const created: ReferenceItem[] = [];
    const rejected: ReferenceBatchRejection[] = duplicateAssets.map((asset) => ({
      name: asset.name,
      reason: "已在参考素材中",
    }));
    try {
      for (const asset of selected) {
        if (controller.signal.aborted || !mountedRef.current) {
          revokeReferenceItems(created, revokeObjectUrl);
          return;
        }
        let previewUrl = "";
        try {
          previewUrl = await getAssetContentObjectUrl(asset.id, assetScope, undefined, controller.signal);
          trackRuntimeUrl(previewUrl);
          const response = await fetch(previewUrl, { signal: controller.signal });
          if (!response.ok) throw new Error(`${asset.name} 读取失败`);
          const blob = await response.blob();
          const file = new File([blob], asset.name || `${asset.id}.${asset.type}`, {
            type: asset.content_type || blob.type || `${asset.type}/*`,
          });
          let reference: ReferenceItem;
          if (asset.type === "image") {
            reference = await createImageReference(file, () => previewUrl, revokeObjectUrl);
          } else if (asset.type === "video") {
            reference = await createVideoReference(file, () => previewUrl, revokeObjectUrl);
          } else {
            reference = await createAudioReference(file, () => previewUrl, revokeObjectUrl);
          }
          reference.source = "asset";
          reference.assetId = asset.id;
          reference.scope = assetScope;
          reference.storageKey = undefined;
          created.push(reference);
        } catch (error) {
          if (previewUrl) revokeObjectUrl(previewUrl);
          if (controller.signal.aborted) {
            revokeReferenceItems(created, revokeObjectUrl);
            return;
          }
          rejected.push({ name: asset.name, reason: referenceRejectionMessage(error, "读取失败") });
        }
      }
      const plan = planReferenceBatch(buildRuntimeReferenceSnapshot(), created, effectiveModelRef.current);
      rejected.push(...plan.rejected);
      revokeReferenceItems(plan.rejected.flatMap((entry) => entry.item ? [entry.item] : []), revokeObjectUrl);
      if (controller.signal.aborted || !mountedRef.current) {
        revokeReferenceItems(plan.accepted, revokeObjectUrl);
        return;
      }
      const batch = splitRuntimeReferences(plan.accepted);
      if (plan.accepted.length) {
        setImageReferences([...imageReferences, ...batch.images]);
        setVideoReferences([...videoReferences, ...batch.videos]);
        setAudioReferences([...audioReferences, ...batch.audios]);
        setAssetPickerOpen(false);
        setSelectedAssetIds([]);
        toast.success(`已引用 ${plan.accepted.length} 个资产`);
      }
      warnReferenceRejections(rejected);
    } catch (error) {
      revokeReferenceItems(created, revokeObjectUrl);
      if (mountedRef.current && !controller.signal.aborted) toast.error(publicApiError(error, "引用资产失败"));
    } finally {
      if (assetConfirmAbortRef.current === controller) assetConfirmAbortRef.current = null;
      assetConfirmBusyRef.current = false;
      referenceAddBusyRef.current = false;
      if (mountedRef.current) setReferenceAddBusy(false);
      if (mountedRef.current) setAssetConfirmBusy(false);
    }
  }

  function createTrackedObjectUrl(blob: Blob) {
    const url = URL.createObjectURL(blob);
    objectUrlsRef.current.add(url);
    return url;
  }

  function revokeObjectUrl(url: string) {
    if (!url.startsWith("blob:")) return;
    objectUrlsRef.current.delete(url);
    URL.revokeObjectURL(url);
  }

  function removeReference(kind: ReferenceKind, id: string) {
    if (referenceAddBusyRef.current || sessionResetBusyRef.current) {
      toast.warning(sessionResetBusyRef.current ? "正在新建视频会话，请稍候" : "正在读取参考素材，请稍候");
      return;
    }
    const reference = [...imageReferences, ...videoReferences, ...audioReferences].find((item) => item.id === id);
    if (reference?.source === "local") {
      void removeDraftVideoMedia(reference.storageKey).catch((error) => {
        console.warn("清理视频草稿媒体失败", error);
      });
    }
    if (kind === "image") setImageReferences((items) => removeReferenceItem(items, id, revokeObjectUrl));
    if (kind === "video") setVideoReferences((items) => removeReferenceItem(items, id, revokeObjectUrl));
    if (kind === "audio") setAudioReferences((items) => removeReferenceItem(items, id, revokeObjectUrl));
  }

  function moveReference(kind: ReferenceKind, id: string, offset: number) {
    if (referenceAddBusyRef.current || sessionResetBusyRef.current) {
      toast.warning(sessionResetBusyRef.current ? "正在新建视频会话，请稍候" : "正在读取参考素材，请稍候");
      return;
    }
    if (kind === "image") setImageReferences((items) => moveReferenceItem(items, id, offset));
    if (kind === "video") setVideoReferences((items) => moveReferenceItem(items, id, offset));
    if (kind === "audio") setAudioReferences((items) => moveReferenceItem(items, id, offset));
  }

  const preview = activeTask?.runtimeUrl || "";
  const durationOptions = seedanceModel
    ? isLongSeedanceVideoModel(effectiveConfig.model)
      ? videoModelSettings.seedanceLongDurations
      : videoModelSettings.seedanceDurations
    : videoModelSettings.openAiDurations;
  const pagedHistory = paginateStoredVideoHistory(history, historyPage, historyPageSize);
  const openAiDimensions = readVideoDimensions(effectiveConfig.size);

  useEffect(() => {
    if (historyPage !== pagedHistory.page) setHistoryPage(pagedHistory.page);
  }, [historyPage, pagedHistory.page]);

  const renderSettingsControls = (mode: "inline" | "dialog" = "inline") => (
    <div className={`video-settings-grid video-settings-${mode}`}>
      <label className="video-settings-control">
        <span>模型</span>
        <select value={model} onChange={(event) => applyConfig({ ...effectiveConfig, model: event.target.value })} disabled={!models.length}>
          {!models.length && <option value="">未配置</option>}
          {models.map((item) => <option value={item} key={item}>{labels[item] || item}</option>)}
        </select>
      </label>
      <label className="video-settings-control">
        <span>{seedanceModel ? "比例" : "尺寸"}</span>
        <select value={effectiveConfig.size} onChange={(event) => applyConfig({ ...effectiveConfig, size: event.target.value })}>
          {(seedanceModel ? videoModelSettings.seedanceRatios : videoModelSettings.openAiSizes).map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
      </label>
      <label className="video-settings-control">
        <span>{seedanceModel ? "分辨率" : "清晰度"}</span>
        {seedanceModel ? (
          <select value={effectiveConfig.resolution} onChange={(event) => applyConfig({ ...effectiveConfig, resolution: event.target.value })}>
            {videoModelSettings.seedanceResolutions.map((item) => (
              <option key={item} value={item} disabled={fastSeedance && item === "1080p"}>{item}</option>
            ))}
          </select>
        ) : (
          <input type="number" min={1} value={effectiveConfig.resolution.replace(/p$/i, "")} onChange={(event) => applyConfig({ ...effectiveConfig, resolution: `${event.target.value || "720"}p` })} />
        )}
      </label>
      <label className="video-settings-control">
        <span>时长</span>
        <select value={effectiveConfig.seconds} onChange={(event) => applyConfig({ ...effectiveConfig, seconds: event.target.value })}>
          {durationOptions.map((item) => (
            <option key={item} value={String(item)}>{item === -1 ? "智能" : `${item}s`}</option>
          ))}
        </select>
      </label>
      {!seedanceModel && (
        <>
          <label className="video-settings-control">
            <span>自定义宽度</span>
            <input type="number" min={1} value={openAiDimensions.width} disabled={effectiveConfig.size === "auto"} onChange={(event) => applyConfig({ ...effectiveConfig, size: `${Math.max(1, Number(event.target.value) || openAiDimensions.width)}x${openAiDimensions.height}` })} />
          </label>
          <label className="video-settings-control">
            <span>自定义高度</span>
            <input type="number" min={1} value={openAiDimensions.height} disabled={effectiveConfig.size === "auto"} onChange={(event) => applyConfig({ ...effectiveConfig, size: `${openAiDimensions.width}x${Math.max(1, Number(event.target.value) || openAiDimensions.height)}` })} />
          </label>
        </>
      )}
      <label className="video-settings-control">
        <span>自定义时长</span>
        <input type="number" min={seedanceModel ? -1 : 1} max={seedanceModel ? (isLongSeedanceVideoModel(effectiveConfig.model) ? 30 : 15) : 20} value={effectiveConfig.seconds} onChange={(event) => applyConfig({ ...effectiveConfig, seconds: event.target.value })} />
      </label>
      {seedanceModel && (
        <div className="video-settings-toggles">
          <div className="segmented" aria-label="Seedance 音频选项">
            <button type="button" className={effectiveConfig.generateAudio ? "selected" : ""} onClick={() => applyConfig({ ...effectiveConfig, generateAudio: true })}>生成音频</button>
            <button type="button" className={!effectiveConfig.generateAudio ? "selected" : ""} onClick={() => applyConfig({ ...effectiveConfig, generateAudio: false })}>静音</button>
          </div>
          <button type="button" className={effectiveConfig.watermark ? "outline-button small active" : "outline-button small"} onClick={() => applyConfig({ ...effectiveConfig, watermark: !effectiveConfig.watermark })}>
            水印 {effectiveConfig.watermark ? "ON" : "OFF"}
          </button>
        </div>
      )}
    </div>
  );

  const renderHistoryList = (mode: "inline" | "dialog" = "inline") => (
    <div className={`video-history-panel video-history-${mode}`}>
      <div className="filter-line">
        <b>{historyReady ? `任务记录 ${history.length}` : "正在读取任务记录"}</b>
        <div className="video-history-actions">
          <button type="button" className="outline-button small" disabled={sessionResetBusy} onClick={() => void createSession()}>
            {sessionResetBusy ? <Loader2 className="spin" size={15} /> : <Plus size={15} />} 新会话
          </button>
          <button type="button" className="outline-button small" disabled={!selectedHistoryIds.length || deleteBusy || sessionResetBusy} onClick={() => setDeleteConfirmOpen(true)}>
            <Trash2 size={15} /> 删除所选
          </button>
        </div>
      </div>
      <div className="job-list video-history-list">
        {pagedHistory.items.map((item) => (
          <div
            key={item.id}
            className="job-row"
            role="button"
            tabIndex={0}
            onClick={() => void previewHistoryItem(item)}
            onKeyDown={(event) => {
              if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
                event.preventDefault();
                void previewHistoryItem(item);
              }
            }}
          >
            <input
              type="checkbox"
              aria-label={`选择视频记录 ${item.id}`}
              checked={selectedHistoryIds.includes(item.id)}
              onClick={(event) => event.stopPropagation()}
              onChange={() => setSelectedHistoryIds((ids) => ids.includes(item.id)
                ? ids.filter((id) => id !== item.id)
                : [...ids, item.id])}
            />
            <div className={`job-icon ${item.status}`}><Film size={17} /></div>
            <div className="job-copy">
              <div>
                <b>{item.prompt.slice(0, 42) || item.model}</b>
                <span>{item.provider || providerFromModel(item.model)} · {item.model} · {item.id}</span>
              </div>
            </div>
            <span className={`status-chip ${item.status}`}>{statusLabel(item.status)}</span>
            {item.status === "failed" && (
              <button
                type="button"
                className="outline-button small"
                disabled={sessionResetBusy}
                onClick={(event) => {
                  event.stopPropagation();
                  retryHistoryItem(item);
                }}
              >
                重试
              </button>
            )}
          </div>
        ))}
        {!history.length && (
          <div className="empty-output video-history-empty">
            <History size={26} />
            <p>{historyReady ? "暂无视频任务记录" : "正在读取本机任务记录…"}</p>
          </div>
        )}
      </div>
      {pagedHistory.pageCount > 1 && (
        <div className="batch-actions">
          <button type="button" className="outline-button small" disabled={pagedHistory.page <= 1} onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}>上一页</button>
          <span>{pagedHistory.page} / {pagedHistory.pageCount}</span>
          <button type="button" className="outline-button small" disabled={pagedHistory.page >= pagedHistory.pageCount} onClick={() => setHistoryPage((page) => page + 1)}>下一页</button>
        </div>
      )}
    </div>
  );

  const renderResultState = () => {
    if (previewLoading) {
      return <div className="empty-output"><Loader2 className="spin" size={27} /><p>读取视频结果…</p></div>;
    }
    if (!activeTask) {
      return <div className="empty-output"><Film size={27} /><p>提交任务后，结果会显示在这里</p></div>;
    }
    const progress = normalizedProgress(activeTask.progress);
    if (activeTask.status === "queued" || activeTask.status === "running") {
      return (
        <div className="video-state-card running">
          <Loader2 className="spin" size={26} />
          <div className="video-state-copy">
            <b>{statusLabel(activeTask.status)}</b>
            <p>已运行 {formatElapsedSince(activeTask, elapsedNow)}</p>
            {progress !== null && (
              <div
                className="video-progress"
                role="progressbar"
                aria-label="视频生成进度"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
              >
                <span style={{ width: `${progress}%` }} />
                <b>{progress}%</b>
              </div>
            )}
          </div>
        </div>
      );
    }
    if (activeTask.status === "failed") {
      return (
        <div className="video-state-card failed">
          <Film size={26} />
          <div className="video-state-copy">
            <b>生成失败</b>
            <p>{activeTask.error || "视频任务失败，请稍后重试"}</p>
            <button type="button" className="outline-button small" disabled={running || sessionResetBusy} onClick={() => retryHistoryItem(activeTask)}>
              <RotateCcw size={15} /> 重试该记录
            </button>
          </div>
        </div>
      );
    }
    if (preview) {
      return <video className="detail-image" src={preview} controls />;
    }
    return (
      <div className="video-state-card succeeded">
        <Film size={26} />
        <div className="video-state-copy">
          <b>视频已生成</b>
          <p>{activeTask.assetId || activeTask.resultStorageKey ? "结果可下载；选择记录时会重新读取可播放预览。" : "结果记录已完成，但当前没有可播放预览。"}</p>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="feature-page video-page">
      <div className="feature-title">
        <div>
          <p className="eyebrow">VIDEO</p>
          <h1>视频生成</h1>
        </div>
        <div className="video-title-actions">
          <button type="button" className="outline-button small" onClick={() => void refreshModels()}>
            <RefreshCcw size={15} /> 刷新模型
          </button>
          <button type="button" className="outline-button small video-compact-action" onClick={() => setSettingsDialogOpen(true)}>
            <SlidersHorizontal size={15} /> 参数
          </button>
          <button type="button" className="outline-button small video-compact-action" onClick={() => setHistoryDialogOpen(true)}>
            <History size={15} /> 记录 {history.length}
          </button>
        </div>
      </div>
      <div className="image-workbench">
        <section className="image-composer">
          <label className="prompt-editor">
            <span>VIDEO PROMPT</span>
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={1200} disabled={sessionResetBusy} placeholder="描述镜头动作、角色状态、场景变化与风格要求" />
            <small>{prompt.length} / 1200 · 当前模型：{selectedModelLabel}</small>
          </label>
          <div className="filter-line">
            <button type="button" className="outline-button small" onClick={() => setPromptLibraryOpen(true)} disabled={sessionResetBusy}>
              <BookOpen size={15} /> 提示词库
            </button>
            <button type="button" className="outline-button small" onClick={() => fileInputRef.current?.click()} disabled={referenceAddBusy || sessionResetBusy}>
              <Upload size={15} /> 上传参考素材
            </button>
            <button type="button" className="outline-button small" onClick={() => void addReferencesFromClipboard()} disabled={referenceAddBusy || sessionResetBusy}>
              <ClipboardPaste size={15} /> 剪贴板图片
            </button>
            <button type="button" className="outline-button small" onClick={() => void openAssetPicker()} disabled={referenceAddBusy || sessionResetBusy}>
              <FolderOpen size={15} /> 从资产库选择
            </button>
          </div>
          <ReferenceStrip
            title={`参考图片 ${imageReferences.length}/${seedanceModel ? videoReferenceLimits.images : videoReferenceLimits.openAiImages}`}
            kind="image"
            items={imageReferences}
            emptyText="暂无参考图片"
            onMove={moveReference}
            onRemove={removeReference}
          />
          <ReferenceStrip
            title={`参考视频 ${videoReferences.length}/${videoReferenceLimits.videos}`}
            kind="video"
            items={videoReferences}
            emptyText="暂无参考视频"
            onMove={moveReference}
            onRemove={removeReference}
          />
          <ReferenceStrip
            title={`参考音频 ${audioReferences.length}/${videoReferenceLimits.audios}`}
            kind="audio"
            items={audioReferences}
            emptyText="暂无参考音频"
            onMove={moveReference}
            onRemove={removeReference}
          />
          <div className="video-settings-inline">
            {renderSettingsControls()}
          </div>
          <button type="button" className="vermilion-button generate-frame" onClick={() => void generateVideo()} disabled={!historyReady || running || referenceAddBusy || sessionResetBusy || !prompt.trim() || !model}>
            {running ? <Loader2 className="spin" size={17} /> : <WandSparkles size={17} />}
            {running ? "视频任务运行中" : "生成视频"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/mp4,video/quicktime,audio/mpeg,audio/mp3,audio/wav,audio/x-wav,.mp4,.mov,.mp3,.wav"
            multiple
            className="hidden"
            disabled={referenceAddBusy || sessionResetBusy}
            onChange={(event) => {
              void addReferenceFiles(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
        </section>
        <aside className="generation-output">
          <div className="output-heading">
            <div>
              <p className="eyebrow">RESULT / {activeTask?.status || "idle"}</p>
              <h3>{activeTask ? activeTask.id : "等待提交"}</h3>
            </div>
            {activeTask && (activeTask.assetId || activeTask.resultStorageKey || preview) && (
              <button type="button" className="icon-button subtle" aria-label="下载视频" disabled={sessionResetBusy} onClick={() => void downloadHistoryItem(activeTask)}>
                <Download size={17} />
              </button>
            )}
          </div>
          {renderResultState()}
          {activeTask && (
            <div className="filter-line">
              <button type="button" className="outline-button small" disabled={restoreBusy || running || sessionResetBusy} onClick={() => void restoreHistoryToEditor(activeTask)}>
                <RotateCcw size={15} /> 恢复参数
              </button>
              {activeTask.status === "succeeded" && (
                <span className={`status-chip ${activeTask.archiveState === "failed" ? "failed" : activeTask.assetId ? "succeeded" : "queued"}`}>
                  {activeTask.assetId ? "已归档到资产库" : activeTask.archiveState === "failed" ? "归档失败" : "待归档"}
                </span>
              )}
              {activeTask.status === "succeeded" && !activeTask.assetId && activeTask.resultStorageKey && (
                <button type="button" className="outline-button small" disabled={archiveBusyId === activeTask.id} onClick={() => void archiveHistoryItem(activeTask.id)}>
                  {archiveBusyId === activeTask.id ? <Loader2 className="spin" size={15} /> : <Archive size={15} />}
                  {activeTask.archiveState === "failed" ? "重试归档" : "加入资产库"}
                </button>
              )}
            </div>
          )}
          {activeTask?.archiveError && <small>{activeTask.archiveError}</small>}
          <div className="video-history-inline">
            {renderHistoryList()}
          </div>
        </aside>
      </div>
      </div>
      <PromptLibraryDialog open={promptLibraryOpen} onOpenChange={setPromptLibraryOpen} onSelect={setPrompt} />
      <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
        <DialogContent className="video-compact-dialog">
          <DialogHeader>
            <DialogTitle>视频参数</DialogTitle>
            <DialogDescription>调整当前模型、画幅、分辨率和时长；切换模型时会自动归一化非法组合。</DialogDescription>
          </DialogHeader>
          <div className="video-compact-dialog-body">
            {renderSettingsControls("dialog")}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={historyDialogOpen}
        onOpenChange={(open) => {
          if (deleteBusy) return;
          setHistoryDialogOpen(open);
        }}
      >
        <DialogContent
          className="video-compact-dialog video-history-dialog"
          showCloseButton={!deleteBusy}
          onEscapeKeyDown={(event) => {
            if (deleteBusy) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (deleteBusy) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (deleteBusy) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>任务记录</DialogTitle>
            <DialogDescription>选择、预览、恢复或删除本机视频任务记录。</DialogDescription>
          </DialogHeader>
          <div className="video-compact-dialog-body">
            {renderHistoryList("dialog")}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={assetPickerOpen}
        onOpenChange={(open) => {
          if (assetConfirmBusy) return;
          setAssetPickerOpen(open);
          if (!open) {
            assetRequestRef.current?.abort();
            setSelectedAssetIds([]);
          }
        }}
      >
        <DialogContent
          className="video-asset-dialog"
          showCloseButton={!assetConfirmBusy}
          onEscapeKeyDown={(event) => {
            if (assetConfirmBusy) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (assetConfirmBusy) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (assetConfirmBusy) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>从资产库选择参考素材</DialogTitle>
            <DialogDescription>列表仅加载元数据；确认引用时才读取所选资产内容。</DialogDescription>
          </DialogHeader>
          <div className="video-asset-dialog-body">
          <div className="filter-line">
            <select
              value={assetScope}
              disabled={assetLoading || assetConfirmBusy}
              onChange={(event) => {
                const scope = event.target.value as WorkspaceScope;
                setAssetScope(scope);
                setSelectedAssetIds([]);
                void loadAssetPicker(scope, assetQuery);
              }}
            >
              <option value="personal">个人空间</option>
              <option value="team">团队空间</option>
            </select>
            <label className="tag-search">
              <Search size={15} />
              <input
                value={assetQuery}
                disabled={assetConfirmBusy}
                onChange={(event) => setAssetQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void loadAssetPicker();
                  }
                }}
                placeholder="搜索资产名称、来源或标签"
              />
            </label>
            <button type="button" className="outline-button small" disabled={assetLoading || assetConfirmBusy} onClick={() => void loadAssetPicker()}>
              {assetLoading ? <Loader2 className="spin" size={15} /> : <Search size={15} />} 搜索
            </button>
          </div>
          {assetError && <div className="empty-output"><p>{assetError}</p></div>}
          <div className="job-list video-asset-list">
            {assetItems.map((asset) => (
              <div className="job-row" key={asset.id}>
                <input
                  type="checkbox"
                  aria-label={`选择资产 ${asset.name}`}
                  checked={selectedAssetIds.includes(asset.id)}
                  disabled={assetConfirmBusy}
                  onChange={() => toggleAssetSelection(asset.id)}
                />
                <div className="job-icon running">
                  {asset.type === "audio" ? <Music2 size={17} /> : <Film size={17} />}
                </div>
                <div className="job-copy">
                  <div>
                    <b>{asset.name}</b>
                    <span>{asset.type} · {asset.size ? formatBytes(asset.size) : "未知体积"} · {asset.id}</span>
                  </div>
                </div>
                <span className="status-chip queued">{assetScope === "team" ? "团队" : "个人"}</span>
              </div>
            ))}
            {!assetLoading && !assetItems.length && !assetError && (
              <div className="empty-output"><FolderOpen size={24} /><p>暂无可引用的图片、视频或音频资产</p></div>
            )}
          </div>
          </div>
          <DialogFooter>
            <button
              type="button"
              className="outline-button"
              disabled={assetConfirmBusy}
              onClick={() => {
                assetRequestRef.current?.abort();
                setSelectedAssetIds([]);
                setAssetPickerOpen(false);
              }}
            >
              取消
            </button>
            <button type="button" className="vermilion-button" disabled={!selectedAssetIds.length || assetConfirmBusy} onClick={() => void confirmAssetSelection()}>
              {assetConfirmBusy ? <Loader2 className="spin" size={15} /> : <FolderOpen size={15} />}
              {assetConfirmBusy ? "正在读取所选资产" : `引用所选 ${selectedAssetIds.length} 项`}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={deleteConfirmOpen}
        onOpenChange={(open) => {
          if (!deleteBusy) setDeleteConfirmOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除视频任务记录</AlertDialogTitle>
            <AlertDialogDescription>
              将删除 {selectedHistoryIds.length} 条本机记录及各自私有参考媒体；已归档到服务器资产库的文件不会被删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteBusy}
              onClick={(event) => {
                event.preventDefault();
                void deleteSelectedHistory();
              }}
            >
              {deleteBusy ? "正在删除" : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function initialScopeFromSearch(): WorkspaceScope {
  return new URLSearchParams(window.location.search).get("scope") === "team" ? "team" : "personal";
}

function runtimeReferenceFromStored(
  reference: StoredVideoReference,
  file: File,
  previewUrl: string,
  storageKey?: string,
): ReferenceItem {
  const common = {
    id: reference.id,
    file,
    name: reference.name,
    mime: reference.mime || file.type,
    bytes: reference.bytes || file.size,
    previewUrl,
    source: reference.source,
    storageKey: reference.source === "local" ? storageKey : undefined,
    assetId: reference.source === "asset" ? reference.assetId : undefined,
    scope: reference.scope || "personal",
  } as const;
  if (reference.kind === "image") {
    return { ...common, kind: "image", width: reference.width || 0, height: reference.height || 0 };
  }
  if (reference.kind === "video") {
    return {
      ...common,
      kind: "video",
      width: reference.width || 0,
      height: reference.height || 0,
      durationMs: reference.durationMs || 0,
    };
  }
  return { ...common, kind: "audio", durationMs: reference.durationMs || 0 };
}

function videoFileName(item: VideoHistoryItem) {
  const storedName = item.fileName?.trim().replace(/[\\/:*?"<>|]+/g, "-").slice(0, 120);
  if (storedName) return storedName;
  const base = item.prompt.trim().replace(/[\\/:*?"<>|]+/g, "-").slice(0, 48) || "generated-video";
  return `${base}.mp4`;
}

function downloadBlob(blob: Blob, fileName: string, mimeType?: string) {
  const normalized = blob.type ? blob : new Blob([blob], { type: mimeType || "application/octet-stream" });
  const url = URL.createObjectURL(normalized);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function providerFromModel(model: string): VideoProvider {
  return isSeedanceVideoModel(model) ? "seedance" : "openai";
}

function statusLabel(status: StoredVideoHistoryItem["status"]) {
  if (status === "succeeded") return "成功";
  if (status === "failed") return "失败";
  if (status === "running") return "运行中";
  return "排队中";
}

function normalizedProgress(progress?: number) {
  if (typeof progress !== "number" || !Number.isFinite(progress)) return null;
  return Math.max(0, Math.min(100, Math.round(progress)));
}

function formatElapsedSince(item: VideoHistoryItem, now: number) {
  const end = item.status === "queued" || item.status === "running"
    ? now
    : typeof item.updatedAt === "number" ? item.updatedAt : now;
  const seconds = Math.max(0, Math.round((end - item.createdAt) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainder}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function generationReferences(snapshot: RuntimeReferenceSnapshot): VideoGenerationReferences {
  return {
    images: snapshot.images.map((item) => ({
      id: item.id,
      kind: "image",
      file: item.file,
      name: item.name,
      mime: item.mime,
      bytes: item.bytes,
      width: item.width,
      height: item.height,
    })),
    videos: snapshot.videos.map((item) => ({
      id: item.id,
      kind: "video",
      file: item.file,
      name: item.name,
      mime: item.mime,
      bytes: item.bytes,
      width: item.width,
      height: item.height,
      durationMs: item.durationMs,
    })),
    audios: snapshot.audios.map((item) => ({
      id: item.id,
      kind: "audio",
      file: item.file,
      name: item.name,
      mime: item.mime,
      bytes: item.bytes,
      durationMs: item.durationMs,
    })),
  };
}

function storedReferences(snapshot: RuntimeReferenceSnapshot): StoredVideoReferenceSnapshot {
  const toStored = (item: ReferenceItem): StoredVideoReference => ({
    id: item.id,
    kind: item.kind,
    source: item.source,
    name: item.name,
    mime: item.mime,
    bytes: item.bytes,
    width: "width" in item ? item.width : undefined,
    height: "height" in item ? item.height : undefined,
    durationMs: "durationMs" in item ? item.durationMs : undefined,
    storageKey: item.source === "local" ? item.storageKey : undefined,
    assetId: item.source === "asset" ? item.assetId : undefined,
    scope: item.scope,
  });
  return {
    images: snapshot.images.map(toStored),
    videos: snapshot.videos.map(toStored),
    audios: snapshot.audios.map(toStored),
  };
}

function planReferenceBatch(
  existing: RuntimeReferenceSnapshot,
  candidates: ReferenceItem[],
  model: string,
) {
  const accepted: ReferenceItem[] = [];
  const rejected: ReferenceBatchRejection[] = [];
  const ordered = (["image", "video", "audio"] as const)
    .flatMap((kind) => candidates.filter((item) => item.kind === kind));
  const existingItems = [...existing.images, ...existing.videos, ...existing.audios];

  for (const item of ordered) {
    const snapshot = splitRuntimeReferences([...existingItems, ...accepted, item]);
    try {
      validateVideoGenerationReferences(generationReferences(snapshot), model);
      accepted.push(item);
    } catch (error) {
      rejected.push({ name: item.name, reason: referenceRejectionMessage(error), item });
    }
  }
  return { accepted, rejected };
}

function referenceRejectionMessage(error: unknown, fallback = "不符合当前模型要求") {
  return error instanceof Error && error.message.trim() ? error.message.trim() : fallback;
}

function warnReferenceRejections(rejections: ReferenceBatchRejection[]) {
  const groups = new Map<string, string[]>();
  rejections.forEach(({ name, reason }) => {
    const names = groups.get(reason) || [];
    names.push(name);
    groups.set(reason, names);
  });
  groups.forEach((names, reason) => {
    const shown = names.slice(0, 3).join("、");
    const remainder = names.length > 3 ? ` 等 ${names.length} 项` : "";
    toast.warning(`${reason}：${shown}${remainder}`);
  });
}

function splitRuntimeReferences(items: ReferenceItem[]): RuntimeReferenceSnapshot {
  return {
    images: items.filter((item): item is ImageReferenceItem => item.kind === "image"),
    videos: items.filter((item): item is VideoReferenceItem => item.kind === "video"),
    audios: items.filter((item): item is AudioReferenceItem => item.kind === "audio"),
  };
}

async function createImageReference(
  file: File,
  createPreviewUrl: (file: File) => string,
  revokePreviewUrl: (url: string) => void,
): Promise<ImageReferenceItem> {
  const previewUrl = createPreviewUrl(file);
  try {
    const meta = await readImageMeta(previewUrl);
    return {
      id: runtimeId("image_ref"),
      kind: "image",
      source: "local",
      file,
      name: file.name,
      mime: file.type || "image/*",
      bytes: file.size,
      width: meta.width,
      height: meta.height,
      previewUrl,
    };
  } catch (error) {
    revokePreviewUrl(previewUrl);
    throw error;
  }
}

async function createVideoReference(
  file: File,
  createPreviewUrl: (file: File) => string,
  revokePreviewUrl: (url: string) => void,
): Promise<VideoReferenceItem> {
  const previewUrl = createPreviewUrl(file);
  try {
    const meta = await readVideoMeta(previewUrl);
    return {
      id: runtimeId("video_ref"),
      kind: "video",
      source: "local",
      file,
      name: file.name,
      mime: file.type || "video/*",
      bytes: file.size,
      width: meta.width,
      height: meta.height,
      durationMs: meta.durationMs,
      previewUrl,
    };
  } catch (error) {
    revokePreviewUrl(previewUrl);
    throw error;
  }
}

async function createAudioReference(
  file: File,
  createPreviewUrl: (file: File) => string,
  revokePreviewUrl: (url: string) => void,
): Promise<AudioReferenceItem> {
  const previewUrl = createPreviewUrl(file);
  try {
    const meta = await readAudioMeta(previewUrl);
    return {
      id: runtimeId("audio_ref"),
      kind: "audio",
      source: "local",
      file,
      name: file.name,
      mime: file.type || "audio/*",
      bytes: file.size,
      durationMs: meta.durationMs,
      previewUrl,
    };
  } catch (error) {
    revokePreviewUrl(previewUrl);
    throw error;
  }
}

function revokeReferenceItems(items: ReferenceItem[], revoke: (url: string) => void) {
  items.forEach((item) => revoke(item.previewUrl));
}

function removeReferenceItem<T extends ReferenceItem>(items: T[], id: string, revoke: (url: string) => void) {
  return items.filter((item) => {
    if (item.id !== id) return true;
    revoke(item.previewUrl);
    return false;
  });
}

function moveReferenceItem<T extends ReferenceItem>(items: T[], id: string, offset: number) {
  const index = items.findIndex((item) => item.id === id);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function ReferenceStrip({
  title,
  kind,
  items,
  emptyText,
  onMove,
  onRemove,
}: {
  title: string;
  kind: ReferenceKind;
  items: ReferenceItem[];
  emptyText: string;
  onMove: (kind: ReferenceKind, id: string, offset: number) => void;
  onRemove: (kind: ReferenceKind, id: string) => void;
}) {
  return (
    <div className="reference-strip-block">
      <div className="filter-line"><b>{title}</b></div>
      <div className="job-list">
        {items.map((item, index) => (
          <div key={item.id} className="job-row">
            <ReferencePreview item={item} index={index} />
            <div className="job-copy">
              <div>
                <b>{referenceLabel(kind, index)}</b>
                <span>
                  {item.name} · {formatBytes(item.bytes)}
                  {"durationMs" in item ? ` · ${formatDuration(item.durationMs)}` : ""}
                </span>
              </div>
            </div>
            <button type="button" className="icon-button subtle" title="左移" aria-label={`${referenceLabel(kind, index)}左移`} disabled={index === 0} onClick={() => onMove(kind, item.id, -1)}>
              <ArrowLeft size={15} />
            </button>
            <button type="button" className="icon-button subtle" title="右移" aria-label={`${referenceLabel(kind, index)}右移`} disabled={index === items.length - 1} onClick={() => onMove(kind, item.id, 1)}>
              <ArrowRight size={15} />
            </button>
            <button type="button" className="icon-button subtle" title="移除" aria-label={`移除${referenceLabel(kind, index)}`} onClick={() => onRemove(kind, item.id)}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        {!items.length && <div className="empty-output"><p>{emptyText}</p></div>}
      </div>
    </div>
  );
}

function ReferencePreview({ item, index }: { item: ReferenceItem; index: number }) {
  const label = referenceLabel(item.kind, index);
  if (item.kind === "image") return <img src={item.previewUrl} alt={label} className="job-icon" />;
  if (item.kind === "video") {
    return <video src={item.previewUrl} className="job-icon" muted preload="metadata" title={label} aria-label={label} />;
  }
  return <audio src={item.previewUrl} controls className="reference-audio-preview" title={label} aria-label={label} />;
}

function referenceLabel(kind: ReferenceKind, index: number) {
  if (kind === "image") return `图片${index + 1}`;
  if (kind === "video") return `视频${index + 1}`;
  return `音频${index + 1}`;
}

function readImageMeta(url: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
    image.onerror = () => reject(new Error("参考图片读取失败"));
    image.src = url;
  });
}

function readVideoMeta(url: string) {
  return new Promise<{ width: number; height: number; durationMs: number }>((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => resolve({
      width: video.videoWidth,
      height: video.videoHeight,
      durationMs: Math.round((video.duration || 0) * 1000),
    });
    video.onerror = () => reject(new Error("参考视频读取失败"));
    video.src = url;
  });
}

function readAudioMeta(url: string) {
  return new Promise<{ durationMs: number }>((resolve, reject) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.onloadedmetadata = () => resolve({ durationMs: Math.round((audio.duration || 0) * 1000) });
    audio.onerror = () => reject(new Error("参考音频读取失败"));
    audio.src = url;
  });
}

function isImageFile(file: File) {
  return file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
}

function isVideoFile(file: File) {
  return file.type === "video/mp4" || file.type === "video/quicktime" || /\.(mp4|mov)$/i.test(file.name);
}

function isAudioFile(file: File) {
  return ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav"].includes(file.type)
    || /\.(mp3|wav)$/i.test(file.name);
}

function formatBytes(bytes: number) {
  if (!bytes) return "0B";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function clipboardImageExtension(mime: string) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "png";
}

function formatDuration(durationMs: number) {
  return `${Math.round(durationMs / 1000)}s`;
}

function readVideoDimensions(size: string) {
  const match = size.match(/^(\d+)x(\d+)$/);
  return {
    width: Math.max(1, Number(match?.[1]) || 1280),
    height: Math.max(1, Number(match?.[2]) || 720),
  };
}

function runtimeId(prefix: string) {
  return globalThis.crypto?.randomUUID?.() || `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
