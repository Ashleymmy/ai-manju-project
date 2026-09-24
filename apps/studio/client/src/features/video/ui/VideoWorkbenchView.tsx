import { resolveModel } from "@/shared/lib/modelSelection";
import { videoModelCapabilities, videoOptionAvailable } from "@/entities/model/videoCapabilities";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

import {
  ensureSeedanceAssetsActive,
  getAssetContentObjectUrl,
  getAssetMediaUrl,
  getAssetLibrary,
  getSeedanceAssetPreviewUrl,
  seedanceAssetPreviewSource,
  uploadAsset,
  type Asset,
  type SeedanceAsset,
} from "@/entities/asset";
import { cancelJob } from "@/entities/job";

import { publicApiError, toastGenerationError } from "@/shared/api/errors";
import type { WorkspaceScope } from "@/shared/config";

import {
  createVideoGenerationTask,
  fetchVideoModelCatalog,
  normalizeVideoGenerationConfig,
  pollVideoGenerationTask,
  validateVideoGenerationReferences,
  videoGenerationResultToBlob,
  type VideoGenerationConfig,
} from "../services/generationGateway";
import {
  createVideoWorkbenchConversation,
  createVideoWorkbenchMessage,
  removeWorkbenchMediaByPrefix,
  storeWorkbenchMedia,
  loadWorkbenchMedia,
  workbenchResultMediaKey,
  type VideoWorkbenchAttachment,
  type VideoWorkbenchConversation,
  type VideoWorkbenchMessage,
} from "../repositories/conversationRepository";
import { createCloudConversationRepository } from "../repositories/cloudConversationRepository";
import { Composer, type MentionCandidate } from "./Composer";
import { ConversationSidebar, type WorkbenchView } from "./ConversationSidebar";
import { HistoryPanel } from "./HistoryPanel";
import { MediaLightbox } from "./MediaLightbox";
import { MediaPickerDialog } from "./MediaPickerDialog";
import { MessageFeed, useWorkbenchThumbCache, type WorkbenchTaskRuntime } from "./MessageFeed";
import { ParamsBar } from "./ParamsBar";
import { ToolkitPanel } from "./ToolkitPanel";
import {
  createAudioWorkbenchReference,
  createImageWorkbenchReference,
  createVideoWorkbenchReference,
  createVolcanoWorkbenchReference,
  emptyWorkbenchReferences,
  generationReferencesFrom,
  isAudioWorkbenchFile,
  isImageWorkbenchFile,
  isVideoWorkbenchFile,
  planWorkbenchReferenceBatch,
  referenceRejectionMessage,
  referencedTokenIds,
  resolvePromptWithTokens,
  splitWorkbenchReferences,
  workbenchProviderFromModel,
  workbenchVideoFileName,
  workbenchWait,
  type WorkbenchImageReference,
  type WorkbenchReference,
} from "../model/referenceEngine";

/* 对话式视频工作台：移植 SD-video 的三栏交互（对话列表 + 消息流 + 输入/参数区）。
   对话与消息本地 IndexedDB 持久化；任务执行走既有 Go API，不改后端。 */

type SubmitPayload = {
  text: string;
  config: VideoGenerationConfig;
  references: WorkbenchReference[];
};

export default function VideoWorkbenchView({ ownerId }: { ownerId: string }) {
  const repositoryRef = useRef<ReturnType<typeof createCloudConversationRepository> | null>(null);
  const [, navigate] = useLocation();
  // 定价规则（参数栏展示约扣积分；pricing_rules 缺失时按文档默认值兜底）。

  const [models, setModels] = useState<string[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [providerNames, setProviderNames] = useState<Record<string, string>>({});
  const [config, setConfig] = useState<VideoGenerationConfig>({ model: "", size: "1280x720", resolution: "720p", seconds: "6", generateAudio: true, watermark: false });
  const [conversations, setConversations] = useState<VideoWorkbenchConversation[]>([]);
  const [currentId, setCurrentId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [editingMessageId, setEditingMessageId] = useState("");
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const editRequestRef = useRef(0);
  const [references, setReferences] = useState<WorkbenchReference[]>([]);
  const [firstFrame, setFirstFrame] = useState<WorkbenchImageReference | null>(null);
  const [lastFrame, setLastFrame] = useState<WorkbenchImageReference | null>(null);
  const [framesEnabled, setFramesEnabled] = useState(false);
  const [view, setView] = useState<WorkbenchView>("generator");
  const [ready, setReady] = useState(false);
  const [taskRuntime, setTaskRuntime] = useState<Record<string, WorkbenchTaskRuntime>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerScope, setPickerScope] = useState<WorkspaceScope>("personal");
  const [pickerBusy, setPickerBusy] = useState(false);
  const [lightbox, setLightbox] = useState<{ url: string; kind: "image" | "video" } | null>(null);
  const [mentionCandidates, setMentionCandidates] = useState<MentionCandidate[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);

  const mountedRef = useRef(false);
  const conversationsRef = useRef<VideoWorkbenchConversation[]>([]);
  const pollingRef = useRef(new Map<string, AbortController>());
  const objectUrlsRef = useRef(new Set<string>());
  const assetMentionCacheRef = useRef<{ at: number; items: MentionCandidate[] }>({ at: 0, items: [] });
  const resultUrlsRef = useRef<Record<string, string>>({});
  const resultLoadsRef = useRef(new Set<string>());
  const [resultUrlsVersion, setResultUrlsVersion] = useState(0);

  const { resolveThumb } = useWorkbenchThumbCache();

  const currentConversation = useMemo(
    () => conversations.find((item) => item.id === currentId) || null,
    [conversations, currentId],
  );
  const messages = currentConversation?.messages || [];
  const generating = Object.values(taskRuntime).some((item) => item.status === "queued" || item.status === "running");
  const effectiveConfig = useMemo(() => normalizeVideoGenerationConfig(config), [config]);

  useEffect(() => {
    // 切换对话后，旧消息的异步附件恢复不能覆盖当前输入。
    editRequestRef.current += 1;
    setEditingMessageId("");
  }, [currentId]);

  const trackUrl = useCallback((url: string) => {
    if (url.startsWith("blob:")) objectUrlsRef.current.add(url);
    return url;
  }, []);

  const revokeUrl = useCallback((url: string) => {
    if (!url.startsWith("blob:")) return;
    objectUrlsRef.current.delete(url);
    URL.revokeObjectURL(url);
  }, []);

  /* ---------- 初始化：模型目录 + 本地对话 ---------- */
  useEffect(() => {
    mountedRef.current = true;
    const repository = createCloudConversationRepository(ownerId);
    repositoryRef.current = repository;
    let active = true;
    void (async () => {
      try {
        const catalog = await fetchVideoModelCatalog();
        if (!mountedRef.current) return;
        setModels(catalog.videoModels);
        setLabels(catalog.modelLabels || {});
        setProviderNames(catalog.modelProviderNames || {});
        const selected = catalog.defaultVideoModel || catalog.videoModels[0] || "";
        if (selected) setConfig((current) => normalizeVideoGenerationConfig({ ...current, model: resolveModel(catalog.videoModels, current.model) || selected }));
      } catch (error) {
        if (mountedRef.current) toast.error(publicApiError(error, "读取视频模型失败"));
      }
      try {
        const stored = await repository.load();
        if (!active) return;
        const next = stored.length ? stored : [createVideoWorkbenchConversation()];
        conversationsRef.current = next;
        setConversations(next);
        setCurrentId(next[0].id);
        // 恢复未完成的任务轮询
        next.forEach((conversation) => conversation.messages.forEach((message) => {
          if (!repository.isLegacy(conversation.id) && message.role === "system" && message.taskId && (message.taskStatus === "queued" || message.taskStatus === "running")) {
            void resumeTaskPolling(conversation.id, message);
          }
        }));
      } catch (error) {
        if (!active) return;
        console.warn("读取视频对话失败", error);
        toast.error(publicApiError(error, "服务端对话加载失败，请刷新后重试"));
        const fallback = [createVideoWorkbenchConversation()];
        conversationsRef.current = fallback;
        if (mountedRef.current) {
          setConversations(fallback);
          setCurrentId(fallback[0].id);
        }
      } finally {
        if (mountedRef.current) setReady(true);
      }
    })();
    return () => {
      active = false;
      repository.dispose();
      mountedRef.current = false;
      pollingRef.current.forEach((controller) => controller.abort());
      pollingRef.current.clear();
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current.clear();
      Object.values(resultUrlsRef.current).forEach((url) => { if (url.startsWith("blob:")) URL.revokeObjectURL(url); });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- 对话持久化 ---------- */
  const commitConversations = useCallback((next: VideoWorkbenchConversation[]) => {
    conversationsRef.current = next;
    if (mountedRef.current) setConversations(next);
    void repositoryRef.current?.write(next).catch((error) => {
      if (mountedRef.current) toast.error(publicApiError(error, "对话未同步，可能存在版本冲突，请刷新后重试"));
    });
  }, []);

  const patchConversation = useCallback((conversationId: string, patch: (conversation: VideoWorkbenchConversation) => VideoWorkbenchConversation) => {
    commitConversations(conversationsRef.current.map((item) => item.id === conversationId ? patch(item) : item));
  }, [commitConversations]);

  const patchMessage = useCallback((conversationId: string, messageId: string, patch: Partial<VideoWorkbenchMessage>) => {
    patchConversation(conversationId, (conversation) => ({
      ...conversation,
      updatedAt: Date.now(),
      messages: conversation.messages.map((message) => message.id === messageId ? { ...message, ...patch } : message),
    }));
  }, [patchConversation]);

  /* ---------- 对话操作 ---------- */
  const handleCreateConversation = useCallback(() => {
    const conversation = createVideoWorkbenchConversation();
    commitConversations([conversation, ...conversationsRef.current]);
    setCurrentId(conversation.id);
    setView("generator");
  }, [commitConversations]);

  const handleRenameConversation = useCallback((conversation: VideoWorkbenchConversation) => {
    const title = window.prompt("重命名对话", conversation.title)?.trim();
    if (!title || title === conversation.title) return;
    patchConversation(conversation.id, (item) => ({ ...item, title, updatedAt: Date.now() }));
  }, [patchConversation]);

  const handleDeleteConversation = useCallback((conversation: VideoWorkbenchConversation) => {
    if (!window.confirm(`确认删除对话“${conversation.title}”？其中的任务记录与本机媒体会一并清理。`)) return;
    conversation.messages.forEach((message) => {
      pollingRef.current.get(message.id)?.abort();
      pollingRef.current.delete(message.id);
    });
    // 附件媒体键以消息 id 为第二段，逐条清理
    conversation.messages.forEach((message) => {
      void removeWorkbenchMediaByPrefix(`wb:${message.id}:`).catch(() => undefined);
      void removeWorkbenchMediaByPrefix(`wbresult:${message.id}`).catch(() => undefined);
    });
    const next = conversationsRef.current.filter((item) => item.id !== conversation.id);
    const ensured = next.length ? next : [createVideoWorkbenchConversation()];
    commitConversations(ensured);
    setCurrentId((current) => current === conversation.id ? ensured[0].id : current);
    toast.success("对话已删除");
  }, [commitConversations]);

  /* ---------- 附件摄取 ---------- */
  const ingestFiles = useCallback(async (files: readonly File[]) => {
    if (!files.length) return;
    const created: WorkbenchReference[] = [];
    const rejected: { name: string; reason: string; item?: WorkbenchReference }[] = [];
    for (const file of files) {
      try {
        if (isImageWorkbenchFile(file)) {
          created.push(await createImageWorkbenchReference(file, (item) => trackUrl(URL.createObjectURL(item)), revokeUrl));
        } else if (isVideoWorkbenchFile(file)) {
          created.push(await createVideoWorkbenchReference(file, (item) => trackUrl(URL.createObjectURL(item)), revokeUrl));
        } else if (isAudioWorkbenchFile(file)) {
          created.push(await createAudioWorkbenchReference(file, (item) => trackUrl(URL.createObjectURL(item)), revokeUrl));
        } else {
          rejected.push({ name: file.name, reason: "格式不支持（图片/mp4/mov/mp3/wav）" });
        }
      } catch (error) {
        rejected.push({ name: file.name, reason: referenceRejectionMessage(error, "读取失败") });
      }
    }
    const existing = splitWorkbenchReferences(references);
    const plan = planWorkbenchReferenceBatch(existing, created, effectiveConfig.model);
    plan.rejected.forEach((entry) => { if (entry.item) revokeUrl(entry.item.previewUrl); });
    rejected.push(...plan.rejected.map((entry) => ({ name: entry.name, reason: entry.reason })));
    if (plan.accepted.length) {
      setReferences((current) => {
        const next = [...current, ...plan.accepted];
        return assignReferenceTokens(next);
      });
      toast.success(`已添加 ${plan.accepted.length} 个参考素材`);
    }
    rejected.forEach((entry) => toast.warning(`${entry.reason}：${entry.name}`));
  }, [effectiveConfig.model, references, revokeUrl, trackUrl]);

  const handleRemoveReference = useCallback((id: string) => {
    setReferences((current) => {
      const target = current.find((item) => item.id === id);
      if (target) revokeUrl(target.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }, [revokeUrl]);

  const handleFrameSelect = useCallback(async (role: "first_frame" | "last_frame", file: File) => {
    if (!isImageWorkbenchFile(file)) {
      toast.warning("首尾帧只支持图片");
      return;
    }
    try {
      const frame = await createImageWorkbenchReference(file, (item) => trackUrl(URL.createObjectURL(item)), revokeUrl, role);
      if (role === "first_frame") {
        if (firstFrame) revokeUrl(firstFrame.previewUrl);
        setFirstFrame(frame);
      } else {
        if (lastFrame) revokeUrl(lastFrame.previewUrl);
        setLastFrame(frame);
      }
    } catch (error) {
      toast.error(referenceRejectionMessage(error, "帧图片读取失败"));
    }
  }, [firstFrame, lastFrame, revokeUrl, trackUrl]);

  const handleRemoveFrame = useCallback((role: "first_frame" | "last_frame") => {
    if (role === "first_frame") {
      if (firstFrame) revokeUrl(firstFrame.previewUrl);
      setFirstFrame(null);
    } else {
      if (lastFrame) revokeUrl(lastFrame.previewUrl);
      setLastFrame(null);
    }
  }, [firstFrame, lastFrame, revokeUrl]);

  /* ---------- @ 引用候选 ---------- */
  const refreshMentionCandidates = useCallback(async (query: string) => {
    const shelfCandidates: MentionCandidate[] = references.map((reference) => ({
      id: reference.id,
      kind: reference.kind,
      label: `${reference.token || reference.name}`,
      source: "shelf",
    }));
    let assetCandidates = assetMentionCacheRef.current.items;
    if (!assetCandidates.length || Date.now() - assetMentionCacheRef.current.at > 60_000) {
      setMentionLoading(true);
      try {
        const result = await getAssetLibrary(pickerScope, { page: 1, pageSize: 50, sort: "created_at_desc" });
        assetCandidates = (result.items || [])
          .filter((asset) => asset.type === "image" || asset.type === "video" || asset.type === "audio")
          .map((asset) => ({
            id: asset.id,
            kind: asset.type as "image" | "video" | "audio",
            label: asset.name || asset.id.slice(-8),
            source: "asset" as const,
            assetId: asset.id,
            scope: pickerScope,
          }));
        assetMentionCacheRef.current = { at: Date.now(), items: assetCandidates };
      } catch {
        assetCandidates = [];
      } finally {
        setMentionLoading(false);
      }
    }
    const normalized = query.trim().toLowerCase();
    const filter = (item: MentionCandidate) => !normalized || item.label.toLowerCase().includes(normalized);
    setMentionCandidates([...shelfCandidates.filter(filter), ...assetCandidates.filter(filter)]);
  }, [pickerScope, references]);

  const handleInsertAssetMention = useCallback(async (candidate: MentionCandidate): Promise<string> => {
    if (!candidate.assetId) return "";
    try {
      toast.message(`正在引用素材：${candidate.label}`);
      const url = await getAssetContentObjectUrl(candidate.assetId, candidate.scope || "personal");
      trackUrl(url);
      const blob = await fetch(url).then((response) => {
        if (!response.ok) throw new Error("素材读取失败");
        return response.blob();
      });
      const file = new File([blob], candidate.label, { type: blob.type || `${candidate.kind}/*` });
      let reference: WorkbenchReference;
      if (candidate.kind === "image") reference = await createImageWorkbenchReference(file, () => url, revokeUrl);
      else if (candidate.kind === "video") reference = await createVideoWorkbenchReference(file, () => url, revokeUrl);
      else reference = await createAudioWorkbenchReference(file, () => url, revokeUrl);
      reference.source = "asset";
      reference.assetId = candidate.assetId;
      reference.scope = candidate.scope || "personal";
      const existing = splitWorkbenchReferences(references);
      const plan = planWorkbenchReferenceBatch(existing, [reference], effectiveConfig.model);
      if (!plan.accepted.length) {
        revokeUrl(url);
        toast.warning(plan.rejected[0]?.reason || "素材不符合当前模型要求");
        return "";
      }
      const added = plan.accepted[0];
      setReferences((current) => assignReferenceTokens([...current, added]));
      toast.success(`已引用 ${candidate.label}`);
      return added.id;
    } catch (error) {
      toast.error(publicApiError(error, "引用素材失败"));
      return "";
    }
  }, [effectiveConfig.model, references, revokeUrl, trackUrl]);

  /* ---------- 提交生成 ---------- */
  const handleSubmit = useCallback(async () => {
    if (!ready || !currentConversation || editingMessageId) return;
    const text = prompt.trim();
    if (!text) {
      toast.warning("请输入视频描述");
      return;
    }
    const configSnapshot = effectiveConfig;
    if (!configSnapshot.model) {
      toast.error("请先在管理后台配置可用的视频模型");
      return;
    }
    const snapshot = splitWorkbenchReferences(references);
    try {
      validateVideoGenerationReferences(generationReferencesFrom(snapshot), configSnapshot.model);
    } catch (error) {
      toast.error(publicApiError(error, "参考素材不符合要求"));
      return;
    }
    const dangling = [...referencedTokenIds(text)].filter((id) => !references.some((item) => item.id === id));
    if (dangling.length) toast.warning("提示词里有已失效的 @ 引用，生成时会按原文发送");

    const resolvedText = resolvePromptWithTokens(text, snapshot);
    const conversationId = currentConversation.id;

    const userMessage = createVideoWorkbenchMessage("user", text);
    const systemMessage = createVideoWorkbenchMessage("system", resolvedText, {
      taskStatus: "queued",
      config: configSnapshot,
      model: configSnapshot.model,
    });

    // 附件媒体入库（本地文件复制到工作台媒体仓；资产引用只记 assetId）
    const attachments: VideoWorkbenchAttachment[] = [];
    try {
      for (const reference of references) {
        attachments.push(await repositoryRef.current!.persistAttachment(userMessage.id, attachmentFromReference(reference), reference.file));
      }
      if (framesEnabled && firstFrame) {
        attachments.push(await repositoryRef.current!.persistAttachment(userMessage.id, attachmentFromReference(firstFrame), firstFrame.file));
      }
      if (framesEnabled && lastFrame) {
        attachments.push(await repositoryRef.current!.persistAttachment(userMessage.id, attachmentFromReference(lastFrame), lastFrame.file));
      }
    } catch (error) {
      toast.error(publicApiError(error, "附件本地保存失败，请重试"));
      return;
    }
    userMessage.attachments = attachments;

    patchConversation(conversationId, (conversation) => ({
      ...conversation,
      title: conversation.messages.some((item) => item.role === "user") ? conversation.title : (text.replace(/\s+/g, " ").slice(0, 24) || "新对话"),
      updatedAt: Date.now(),
      messages: [...conversation.messages, userMessage, systemMessage],
    }));

    const payload: SubmitPayload = {
      text: resolvedText,
      config: configSnapshot,
      references: framesEnabled ? [...references, ...(firstFrame ? [firstFrame] : []), ...(lastFrame ? [lastFrame] : [])] : [...references],
    };
    // 清空输入区（附件草稿媒体已入库，可在消息里回溯）
    setPrompt("");
    references.forEach((reference) => revokeUrl(reference.previewUrl));
    setReferences([]);
    setFirstFrame(null);
    setLastFrame(null);

    void runVideoTask(conversationId, systemMessage, payload);
  }, [ready, currentConversation, editingMessageId, prompt, effectiveConfig, references, framesEnabled, firstFrame, lastFrame, patchConversation, revokeUrl]);

  /* ---------- 任务执行与轮询 ---------- */
  const setRuntime = useCallback((messageId: string, patch: Partial<WorkbenchTaskRuntime>) => {
    setTaskRuntime((current) => ({ ...current, [messageId]: { ...current[messageId], ...patch } }));
  }, []);

  const clearRuntime = useCallback((messageId: string) => {
    setTaskRuntime((current) => {
      if (!(messageId in current)) return current;
      const next = { ...current };
      delete next[messageId];
      return next;
    });
  }, []);

  const runVideoTask = useCallback(async (conversationId: string, message: VideoWorkbenchMessage, payload: SubmitPayload) => {
    const controller = new AbortController();
    pollingRef.current.set(message.id, controller);
    setRuntime(message.id, { status: "queued", progress: 0 });
    try {
      const references = generationReferencesFrom(splitWorkbenchReferences(payload.references));
      await repositoryRef.current!.flush();
      if (repositoryRef.current!.isLegacy(conversationId)) throw new Error("旧本地对话仅保留读取，请新建对话后生成");
      const task = await createVideoGenerationTask(payload.config, payload.text, references, { signal: controller.signal, conversationId, messageId: message.id });
      patchMessage(conversationId, message.id, { taskId: task.id, taskProvider: task.provider, taskStatus: "running" });
      setRuntime(message.id, { status: "running" });

      const intervalMs = task.provider === "seedance" ? 5_000 : 2_500;
      // The durable server task owns the complete retry/timeout budget.
      while (!controller.signal.aborted) {
        if (controller.signal.aborted) return;
        const state = await pollVideoGenerationTask(payload.config, task, {
          signal: controller.signal,
          onProgress: (job) => setRuntime(message.id, { progress: job.progress }),
        });
        if (controller.signal.aborted) return;
        if (state.status === "completed") {
          await completeVideoTask(conversationId, message, payload, state.result, controller.signal);
          return;
        }
        if (state.status === "failed") {
          patchMessage(conversationId, message.id, { taskStatus: "failed", taskError: state.error });
          setRuntime(message.id, { status: "failed", error: state.error });
          toast.error(state.error || "视频生成失败");
          return;
        }
        if (typeof state.progress === "number") {
          setRuntime(message.id, { progress: state.progress });
          patchMessage(conversationId, message.id, { taskProgress: state.progress });
        }
        await workbenchWait(intervalMs, controller.signal);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const errorText = publicApiError(error, "视频生成失败");
      patchMessage(conversationId, message.id, { taskStatus: "failed", taskError: errorText });
      setRuntime(message.id, { status: "failed", error: errorText });
      toastGenerationError(error, "视频生成失败", () => navigate("/member/plans"));
    } finally {
      pollingRef.current.delete(message.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patchMessage, setRuntime]);

  const completeVideoTask = useCallback(async (
    conversationId: string,
    message: VideoWorkbenchMessage,
    payload: SubmitPayload,
    result: { url: string; mimeType?: string; fileName?: string; assetId?: string; scope?: WorkspaceScope },
    signal: AbortSignal,
  ) => {
    const fileName = workbenchVideoFileName(payload.text, result.fileName);
    let resultStorageKey: string | undefined;
    let assetId = result.assetId;
    let scope: WorkspaceScope = result.scope || "personal";
    try {
      // The server already archived this result; don't download and save it again.
      if (assetId) {
        const url = getAssetMediaUrl(assetId, scope);
        resultUrlsRef.current[message.id] = url;
        patchMessage(conversationId, message.id, { taskStatus: "succeeded", resultAssetId: assetId, resultScope: scope, fileName });
        setRuntime(message.id, { status: "succeeded", url });
        setResultUrlsVersion(version => version + 1);
        toast.success("视频生成完成");
        return;
      }
      const blob = await videoGenerationResultToBlob(result, signal);
      if (signal.aborted) return;
      resultStorageKey = workbenchResultMediaKey(message.id);
      await storeWorkbenchMedia(resultStorageKey, blob);
      resultUrlsRef.current[message.id] = trackUrl(URL.createObjectURL(blob));
      setResultUrlsVersion((version) => version + 1);
      // 结果自动归档到资产库（画布/素材库可复用）
      if (!assetId) {
        try {
          const file = new File([blob], fileName, { type: blob.type || result.mimeType || "video/mp4" });
          const asset = await uploadAsset(file, {
            type: "video",
            name: fileName,
            category: "generated",
            source_type: "canvas",
            source_metadata: JSON.stringify({ source: "video_workbench", message_id: message.id }),
          }, scope, signal);
          assetId = asset.id;
          scope = pickerScope;
        } catch (archiveError) {
          console.warn("视频归档失败", archiveError);
        }
      }
      patchMessage(conversationId, message.id, {
        taskStatus: "succeeded",
        resultAssetId: assetId,
        resultScope: scope,
        resultStorageKey,
        fileName,
      });
      setRuntime(message.id, { status: "succeeded" });
      toast.success("视频生成完成");
    } catch (error) {
      if (signal.aborted) return;
      const text = publicApiError(error, "视频已生成，但结果保存失败");
      patchMessage(conversationId, message.id, { taskStatus: "failed", taskError: text });
      setRuntime(message.id, { status: "failed", error: text });
      toast.error(text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patchMessage, pickerScope, setRuntime, trackUrl]);

  /** 页面刷新后恢复未完成任务的轮询（本地消息里留有 taskId/config）。 */
  const resumeTaskPolling = useCallback(async (conversationId: string, message: VideoWorkbenchMessage) => {
    if (!message.taskId || !message.config || pollingRef.current.has(message.id)) return;
    const controller = new AbortController();
    pollingRef.current.set(message.id, controller);
    setRuntime(message.id, { status: "running" });
    const task = { id: message.taskId, provider: message.taskProvider || workbenchProviderFromModel(message.model || message.config.model), model: message.model || message.config.model };
    try {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        if (controller.signal.aborted) return;
        const state = await pollVideoGenerationTask(message.config, task, {
          signal: controller.signal,
          onProgress: (job) => setRuntime(message.id, { progress: job.progress }),
        });
        if (controller.signal.aborted) return;
        if (state.status === "completed") {
          await completeVideoTask(conversationId, message, { text: message.text, config: message.config, references: [] }, state.result, controller.signal);
          return;
        }
        if (state.status === "failed") {
          patchMessage(conversationId, message.id, { taskStatus: "failed", taskError: state.error });
          setRuntime(message.id, { status: "failed", error: state.error });
          return;
        }
        await workbenchWait(task.provider === "seedance" ? 5_000 : 2_500, controller.signal);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      console.warn("恢复任务轮询失败", error);
    } finally {
      pollingRef.current.delete(message.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completeVideoTask, patchMessage, setRuntime]);

  const handleCancelTask = useCallback(async (message: VideoWorkbenchMessage) => {
    if (!currentConversation) return;
    setRuntime(message.id, { cancelling: true });
    pollingRef.current.get(message.id)?.abort();
    pollingRef.current.delete(message.id);
    if (message.taskId && (message.taskProvider === "openai" || message.taskId.startsWith("job_"))) {
      try {
        await cancelJob(message.taskId, pickerScope);
      } catch (error) {
        toast.error(publicApiError(error, "取消任务失败，任务仍可恢复"));
        setRuntime(message.id, { cancelling: false });
        return;
      }
    }
    patchMessage(currentConversation.id, message.id, { taskStatus: "canceled", taskError: "已手动取消" });
    setRuntime(message.id, { status: "canceled", cancelling: false });
    toast.message("已取消生成");
  }, [currentConversation, patchMessage, pickerScope, setRuntime]);

  /** 从消息附件恢复可提交的参考素材（本地仓/资产库读回文件）。 */
  const restorePayloadFromMessages = useCallback(async (userMessage: VideoWorkbenchMessage, systemMessage?: VideoWorkbenchMessage): Promise<SubmitPayload> => {
    const restored: WorkbenchReference[] = [];
    for (const attachment of userMessage.attachments || []) {
      restored.push(await referenceFromAttachment(attachment, trackUrl));
    }
    const normalized = assignReferenceTokens(restored);
    return {
      text: userMessage.text,
      config: normalizeVideoGenerationConfig(systemMessage?.config || effectiveConfig),
      references: normalized,
    };
  }, [effectiveConfig, trackUrl]);

  const handleRetryTask = useCallback(async (conversationId: string, message: VideoWorkbenchMessage) => {
    const conversation = conversationsRef.current.find((item) => item.id === conversationId);
    if (!conversation) return;
    const index = conversation.messages.findIndex((item) => item.id === message.id);
    const userMessage = [...conversation.messages.slice(0, index)].reverse().find((item) => item.role === "user");
    if (!userMessage) {
      toast.warning("找不到该任务的原始描述，无法重试");
      return;
    }
    try {
      const payload = await restorePayloadFromMessages(userMessage, message);
      const systemMessage = createVideoWorkbenchMessage("system", payload.text, {
        taskStatus: "queued",
        config: payload.config,
        model: payload.config.model,
      });
      patchConversation(conversationId, (current) => ({
        ...current,
        updatedAt: Date.now(),
        messages: [...current.messages, systemMessage],
      }));
      void runVideoTask(conversationId, systemMessage, payload);
    } catch (error) {
      toast.error(publicApiError(error, "恢复任务参考素材失败"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patchConversation, restorePayloadFromMessages, runVideoTask]);

  const handleEditMessage = useCallback(async (userMessage: VideoWorkbenchMessage) => {
    if (!currentConversation || editingMessageId) return;
    const request = ++editRequestRef.current;
    setEditingMessageId(userMessage.id);
    const attachments = userMessage.attachments || [];
    const results = await Promise.allSettled(attachments.map((attachment) => referenceFromAttachment(attachment, trackUrl)));
    const restored = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    if (!mountedRef.current || request !== editRequestRef.current) {
      restored.forEach((reference) => revokeUrl(reference.previewUrl));
      return;
    }
    const index = currentConversation.messages.findIndex((message) => message.id === userMessage.id);
    const originalTask = currentConversation.messages[index + 1];
    [...references, ...(firstFrame ? [firstFrame] : []), ...(lastFrame ? [lastFrame] : [])].forEach((reference) => revokeUrl(reference.previewUrl));
    setPrompt(userMessage.text);
    if (originalTask?.role === "system" && originalTask.config) setConfig(originalTask.config);
    const normalized = assignReferenceTokens(restored);
    setReferences(normalized.filter((reference) => reference.role === "reference"));
    setFirstFrame(normalized.find((reference): reference is WorkbenchImageReference => reference.kind === "image" && reference.role === "first_frame") || null);
    setLastFrame(normalized.find((reference): reference is WorkbenchImageReference => reference.kind === "image" && reference.role === "last_frame") || null);
    setFramesEnabled(attachments.some((attachment) => attachment.role === "first_frame" || attachment.role === "last_frame"));
    setView("generator");
    setEditingMessageId("");
    setComposerFocusRequest((value) => value + 1);
    const missing = attachments.filter((_, index) => results[index].status === "rejected");
    if (missing.length) toast.warning(`描述已恢复，以下素材读取失败，请重新添加：${missing.map((item) => item.name).join("、")}`);
    else toast.success("已恢复到编辑区，修改后点击生成");
  }, [currentConversation, editingMessageId, references, firstFrame, lastFrame, trackUrl, revokeUrl]);

  /* ---------- 结果播放地址 ---------- */
  const resultUrlFor = useCallback((message: VideoWorkbenchMessage) => {
    const runtime = taskRuntime[message.id];
    if (runtime?.url) return runtime.url;
    const cached = resultUrlsRef.current[message.id];
    if (cached) return cached;
    if (message.taskStatus === "succeeded") {
      if (message.resultAssetId) {
        const url = getAssetMediaUrl(message.resultAssetId, message.resultScope || "personal");
        resultUrlsRef.current[message.id] = url;
        return url;
      } else if (message.resultStorageKey && !resultLoadsRef.current.has(message.id)) {
        resultLoadsRef.current.add(message.id);
        void loadWorkbenchMedia(message.resultStorageKey)
          .then((blob) => {
            resultUrlsRef.current[message.id] = trackUrl(URL.createObjectURL(blob));
            setResultUrlsVersion((version) => version + 1);
          })
          .catch(() => undefined)
          .finally(() => resultLoadsRef.current.delete(message.id));
      }
    }
    return "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskRuntime, trackUrl]);

  // 结果 URL 就绪后回填到 runtime，驱动任务卡显示视频
  useEffect(() => {
    Object.entries(resultUrlsRef.current).forEach(([messageId, url]) => {
      if (url && !taskRuntime[messageId]?.url) setRuntime(messageId, { url });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultUrlsVersion, taskRuntime, setRuntime]);

  /** 侧栏对话缩略图：取对话里最新一条成功任务的结果地址。 */
  const sidebarThumbnails = useMemo(() => {
    const map: Record<string, string> = {};
    conversations.forEach((conversation) => {
      const latest = [...conversation.messages].reverse().find((message) => message.role === "system" && message.taskStatus === "succeeded");
      if (latest) {
        const url = resultUrlsRef.current[latest.id] || taskRuntime[latest.id]?.url || "";
        if (url) map[conversation.id] = url;
      }
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, taskRuntime, resultUrlsVersion]);

  const handleOpenMedia = useCallback((url: string, kind: "image" | "video") => {
    setLightbox({ url, kind });
  }, []);

  const handlePickerConfirm = useCallback(async (assets: Asset[], volcanoAssets: SeedanceAsset[] = []) => {
    setPickerBusy(true);
    try {
      const failedAssets: string[] = [];
      let addedCount = 0;
      // React state is a render snapshot; each batch check must include earlier accepted media.
      let importedReferences = references;
      // 火山真人素材：先确保 Active，再以 asset:// 引用加入（无本地文件）
      if (volcanoAssets.length) {
        await ensureSeedanceAssetsActive(volcanoAssets.map((asset) => asset.volcano_asset_id), "personal");
        for (const asset of volcanoAssets) {
          const reference = createVolcanoWorkbenchReference(asset);
          reference.scope = "personal";
          reference.previewUrl = trackUrl(await getSeedanceAssetPreviewUrl(reference.previewSourceUrl));
          const plan = planWorkbenchReferenceBatch(splitWorkbenchReferences(importedReferences), [reference], effectiveConfig.model);
          if (plan.accepted.length) {
            importedReferences = [...importedReferences, plan.accepted[0]];
            setReferences((current) => assignReferenceTokens([...current, plan.accepted[0]]));
            addedCount += 1;
          } else {
            toast.warning(`${reference.name}：${plan.rejected[0]?.reason || "不符合当前模型要求"}`);
          }
        }
      }
      const orderedAssets = (["image", "video", "audio"] as const).flatMap(kind => assets.filter(asset => asset.type === kind));
      for (const asset of orderedAssets) {
        try {
          const kind = asset.type === "image" || asset.type === "video" || asset.type === "audio" ? asset.type : null;
          if (!kind) continue;
          const url = await getAssetContentObjectUrl(asset.id, pickerScope);
          trackUrl(url);
          const blob = await fetch(url).then((response) => {
            if (!response.ok) throw new Error(`${asset.name} 读取失败`);
            return response.blob();
          });
          const file = new File([blob], asset.name || `${asset.id}.${kind}`, { type: asset.content_type || blob.type });
          let reference: WorkbenchReference;
          if (kind === "image") reference = await createImageWorkbenchReference(file, () => url, revokeUrl);
          else if (kind === "video") reference = await createVideoWorkbenchReference(file, () => url, revokeUrl);
          else reference = await createAudioWorkbenchReference(file, () => url, revokeUrl);
          reference.source = "asset";
          reference.assetId = asset.id;
          reference.scope = pickerScope;
          const plan = planWorkbenchReferenceBatch(splitWorkbenchReferences(importedReferences), [reference], effectiveConfig.model);
          if (plan.accepted.length) {
            importedReferences = [...importedReferences, plan.accepted[0]];
            setReferences((current) => assignReferenceTokens([...current, plan.accepted[0]]));
            addedCount += 1;
          } else {
            revokeUrl(url);
            toast.warning(`${asset.name}：${plan.rejected[0]?.reason || "不符合当前模型要求"}`);
          }
        } catch (error) {
          failedAssets.push(`${asset.name || asset.id}（${referenceRejectionMessage(error, "读取失败")}）`);
        }
      }
      setPickerOpen(false);
      if (addedCount) toast.success(`已引用 ${addedCount} 个素材`);
      if (failedAssets.length) toast.warning(`以下资产内容不可读取，请重新上传或换一张：${failedAssets.join("、")}`);
    } catch (error) {
      toast.error(publicApiError(error, "引用资产失败"));
    } finally {
      setPickerBusy(false);
    }
  }, [effectiveConfig.model, pickerScope, references, revokeUrl, trackUrl]);

  const handleDownload = useCallback(async (message: VideoWorkbenchMessage) => {
    try {
      let blob: Blob;
      if (message.resultAssetId) {
        const url = await getAssetContentObjectUrl(message.resultAssetId, message.resultScope || "personal");
        try {
          blob = await fetch(url).then((response) => {
            if (!response.ok) throw new Error(`视频内容下载失败：${response.status}`);
            return response.blob();
          });
        } finally {
          URL.revokeObjectURL(url);
        }
      } else if (message.resultStorageKey) {
        blob = await loadWorkbenchMedia(message.resultStorageKey);
      } else {
        throw new Error("该任务没有可下载的视频结果");
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = message.fileName || workbenchVideoFileName(message.text);
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (error) {
      toast.error(publicApiError(error, "下载视频失败"));
    }
  }, []);

  const handleHistoryRetry = useCallback((conversationId: string, message: VideoWorkbenchMessage) => {
    setCurrentId(conversationId);
    setView("generator");
    void handleRetryTask(conversationId, message);
  }, [handleRetryTask]);

  if (!ready) {
    return <div className="wb-page"><div className="wb-loading"><Loader2 className="spin" size={24} /><p>正在读取视频工作台…</p></div></div>;
  }

  return (
    <div className="wb-page">
      <ConversationSidebar
        conversations={conversations}
        currentId={currentId}
        view={view}
        thumbnails={sidebarThumbnails}
        onSelect={(id) => {
          setCurrentId(id);
          setView("generator");
        }}
        onCreate={handleCreateConversation}
        onRename={handleRenameConversation}
        onDelete={handleDeleteConversation}
        onViewChange={setView}
      />
      {view === "generator" ? (
        <main className="wb-main">
          <section className="wb-feed-column">
            <div className="wb-feed-head">
              <b>AI Director</b>
              <span>{currentConversation?.title || "新对话"}</span>
              <button
                type="button"
                className="wb-icon-button"
                title="刷新模型目录"
                onClick={() => void fetchVideoModelCatalog().then((catalog) => {
                  setModels(catalog.videoModels);
                  setConfig(current => normalizeVideoGenerationConfig({ ...current, model: resolveModel(catalog.videoModels, current.model) || catalog.defaultVideoModel }));
                  setLabels(catalog.modelLabels || {});
                  setProviderNames(catalog.modelProviderNames || {});
                }).catch((error) => toast.error(publicApiError(error, "读取视频模型失败")))}
              ><RefreshCcw size={13} /></button>
            </div>
            <MessageFeed
              messages={messages}
              taskRuntime={taskRuntime}
              resultUrlFor={resultUrlFor}
              resolveThumb={resolveThumb}
              onOpenMedia={handleOpenMedia}
              onCancelTask={(message) => void handleCancelTask(message)}
              onRetryTask={(message) => void handleRetryTask(currentId, message)}
              onEditMessage={(message) => void handleEditMessage(message)}
              editingMessageId={editingMessageId}
              onDownload={(message) => void handleDownload(message)}
              empty="输入描述并提交，生成记录会沉淀到当前对话"
            />
          </section>
          <section className="wb-editor-column">
            <Composer
              config={effectiveConfig}
              prompt={prompt}
              onPromptChange={setPrompt}
              references={references}
              firstFrame={firstFrame}
              lastFrame={lastFrame}
              framesEnabled={framesEnabled}
              generating={generating}
              disabled={!ready || Boolean(editingMessageId)}
              focusRequest={composerFocusRequest}
              mentionCandidates={mentionCandidates}
              mentionLoading={mentionLoading}
              onMentionQuery={(query) => {
                void refreshMentionCandidates(query);
              }}
              onInsertAssetMention={(candidate) => handleInsertAssetMention(candidate)}
              onUploadFiles={(files) => void ingestFiles(Array.from(files))}
              onPasteFiles={(files) => void ingestFiles(files)}
              onRemoveReference={handleRemoveReference}
              onRemoveFrame={handleRemoveFrame}
              onFrameSelect={(role, file) => void handleFrameSelect(role, file)}
              onSubmit={() => void handleSubmit()}
              onOpenMedia={handleOpenMedia}
              thumbUrlFor={(reference) => reference.previewUrl}
            />
            <div className="wb-editor-tools">
              <button type="button" className={framesEnabled ? "wb-toggle active" : "wb-toggle"}
                disabled={!framesEnabled && ((!videoOptionAvailable(effectiveConfig.model, "supports", "first_frame") && !videoOptionAvailable(effectiveConfig.model, "supports", "last_frame")) || (videoModelCapabilities(effectiveConfig.model).frames_exclusive && references.length > 0))}
                title="首尾帧按当前模型能力开放；Wan 的首尾帧与普通参考素材不能混用"
                onClick={() => setFramesEnabled((value) => !value)}>
                首尾帧控制
              </button>
              <button type="button" className="wb-toggle" onClick={() => setPickerOpen(true)}>
                从资产库选择
              </button>
            </div>
            <ParamsBar
              models={models}
              labels={labels}
              providerNames={providerNames}
              config={config}
              onChange={setConfig}
              disabled={!ready}
            />
          </section>
        </main>
      ) : view === "history" ? (
        <main className="wb-main">
          <HistoryPanel
            conversations={conversations}
            onOpenConversation={(id) => {
              setCurrentId(id);
              setView("generator");
            }}
            onRetry={handleHistoryRetry}
          />
        </main>
      ) : (
        <main className="wb-main">
          <ToolkitPanel />
        </main>
      )}
      <MediaPickerDialog
        open={pickerOpen}
        scope={pickerScope}
        onScopeChange={setPickerScope}
        onClose={() => setPickerOpen(false)}
        onConfirm={(assets, volcanoAssets) => void handlePickerConfirm(assets, volcanoAssets)}
        busy={pickerBusy}
      />
      <MediaLightbox url={lightbox?.url || ""} kind={lightbox?.kind || "image"} onClose={() => setLightbox(null)} />
    </div>
  );
}

/** 参考素材 → 消息附件记录（token/角色随消息持久化）。 */
function attachmentFromReference(reference: WorkbenchReference): VideoWorkbenchAttachment {
  return {
    id: reference.id,
    kind: reference.kind,
    role: reference.role,
    token: reference.token,
    name: reference.name,
    mime: reference.mime,
    bytes: reference.bytes,
    width: "width" in reference ? reference.width : undefined,
    height: "height" in reference ? reference.height : undefined,
    durationMs: "durationMs" in reference ? reference.durationMs : undefined,
    assetId: reference.assetId,
    assetRef: reference.url,
    previewUrl: seedanceAssetPreviewSource(reference.previewSourceUrl || reference.previewUrl) || undefined,
    scope: reference.scope,
  };
}

/** 参考素材编号 token：@图片N / @视频N / @音频N（按类型顺序分配，删除不重排）。 */
function assignReferenceTokens(references: WorkbenchReference[]) {
  const counters = { image: 0, video: 0, audio: 0 };
  const used = { image: new Set<string>(), video: new Set<string>(), audio: new Set<string>() };
  return references.map((reference) => {
    if (reference.token && !used[reference.kind].has(reference.token)) {
      used[reference.kind].add(reference.token);
      return reference;
    }
    do {
      counters[reference.kind] += 1;
    } while (used[reference.kind].has(`@${reference.kind === "image" ? "图片" : reference.kind === "video" ? "视频" : "音频"}${counters[reference.kind]}`));
    const label = reference.kind === "image" ? "图片" : reference.kind === "video" ? "视频" : "音频";
    const token = `@${label}${counters[reference.kind]}`;
    used[reference.kind].add(token);
    return { ...reference, token };
  });
}

/** 消息附件 → 可提交的参考素材（本地媒体仓 / 资产库读回文件）。 */
async function referenceFromAttachment(
  attachment: VideoWorkbenchAttachment,
  trackUrl: (url: string) => string,
): Promise<WorkbenchReference> {
  // 火山素材保持 asset:// 引用，同源预览通过鉴权重新读取。
  if (attachment.assetRef) {
    const volcanoBase = {
      id: attachment.id,
      role: attachment.role,
      token: attachment.token,
      name: attachment.name,
      mime: attachment.mime,
      bytes: attachment.bytes || 0,
      url: attachment.assetRef,
      previewSourceUrl: attachment.previewUrl,
      previewUrl: trackUrl(await getSeedanceAssetPreviewUrl(attachment.previewUrl)),
      source: "asset" as const,
      scope: attachment.scope,
    };
    if (attachment.kind === "image") {
      return { ...volcanoBase, kind: "image", width: attachment.width || 0, height: attachment.height || 0 } as WorkbenchReference;
    }
    if (attachment.kind === "video") {
      return { ...volcanoBase, kind: "video", width: attachment.width || 0, height: attachment.height || 0, durationMs: attachment.durationMs || 0 } as WorkbenchReference;
    }
    return { ...volcanoBase, kind: "audio", durationMs: attachment.durationMs || 0 } as WorkbenchReference;
  }
  let blob: Blob;
  let previewUrl: string;
  if (attachment.assetId) {
    previewUrl = await getAssetContentObjectUrl(attachment.assetId, attachment.scope || "personal");
    trackUrl(previewUrl);
    blob = await fetch(previewUrl).then((response) => {
      if (!response.ok) throw new Error(`${attachment.name} 读取失败`);
      return response.blob();
    });
  } else {
    if (!attachment.storageKey) throw new Error(`${attachment.name} 缺少本地媒体`);
    blob = await loadWorkbenchMedia(attachment.storageKey);
    previewUrl = trackUrl(URL.createObjectURL(blob));
  }
  const file = new File([blob], attachment.name, { type: attachment.mime || blob.type });
  const base = {
    id: attachment.id,
    kind: attachment.kind,
    role: attachment.role,
    token: attachment.token,
    file,
    name: attachment.name,
    mime: attachment.mime || file.type,
    bytes: attachment.bytes || file.size,
    previewUrl,
    source: (attachment.assetId ? "asset" : "local") as "asset" | "local",
    assetId: attachment.assetId,
    scope: attachment.scope,
  };
  if (attachment.kind === "image") {
    return { ...base, kind: "image", width: attachment.width || 0, height: attachment.height || 0 } as WorkbenchReference;
  }
  if (attachment.kind === "video") {
    return { ...base, kind: "video", width: attachment.width || 0, height: attachment.height || 0, durationMs: attachment.durationMs || 0 } as WorkbenchReference;
  }
  return { ...base, kind: "audio", durationMs: attachment.durationMs || 0 } as WorkbenchReference;
}
