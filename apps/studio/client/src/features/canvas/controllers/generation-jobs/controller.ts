import type { Asset } from "@/entities/asset";
import { jobErrorMessage } from "@/entities/job";
import { publicApiError } from "@/shared/api/errors";
import {
  audioFileName,
  audioMimeType,
  normalizeAudioGenerationConfig,
} from "@/services/api/audio";
import {
  isSeedanceVideoModel,
  type VideoGenerationResult,
} from "@/features/video";
import { batchChildGridPosition, refreshImageBatchRoot } from "@/features/canvas/domain/batch";
import { ensureUniqueCanvasNodeTitles, preserveCanvasNodeTitle } from "@/features/canvas/domain/nodeTitles";
import {
  applyPendingCanvasJobIds,
  markUnrecoverableCanvasGenerations,
  matchLoadingNodesToJobs,
  type CanvasJobAssignment,
  type RecoverableCanvasJob,
} from "@/features/canvas/domain/generationResume";
import {
  canvasImageBatchSlot,
  diversifyCanvasBatchImagePrompt,
  randomImageGenerationSeed,
} from "@/features/canvas/domain/imageBatchDiversity";
import { appendCanvasGenerationRevision } from "@/features/canvas/domain/generationHistory";
import { canvasImageGenerationSettings, canvasImageGenerationSettingsIssue, canvasImageResolutionIssue } from "@/features/canvas/domain/imageGenerationSettings";
import { canvasImageGenerationError } from "@/features/canvas/domain/imageGenerationError";
import { buildCanvasGenerationInputs, isHiddenCanvasBatchChild } from "@/features/canvas/domain/connections";
import {
  completeGeneratedAudioTarget,
  completeGeneratedImageTarget,
  completeGeneratedVideoTarget,
  failGeneratedAudioTarget,
  failGeneratedImageTarget,
  failGeneratedTextTarget,
  failGeneratedVideoTarget,
} from "@/features/canvas/domain/generation";
import {
  buildCanvasMentionGenerationContext,
  extractCanvasMentionTokens,
  type BuildCanvasMentionGenerationContextOptions,
} from "@/features/canvas/domain/mentions";
import {
  assetIdFromNode,
  looksLikeImageSource,
} from "@/features/canvas/domain/nodes";
import {
  audioConfigFromNode,
  canvasGenerationInputsFromVideoSnapshot,
  imageCountFromNode,
  imageResolutionFromNode,
  imageFileName,
  imageReferenceSnapshots,
  isAbortError,
  isReadableMediaSource,
  canvasVideoReferenceSnapshot,
  generationModeFromNode,
  modelFromNode,
  promptTextFromNode,
  sizeFromNode,
  videoConfigFromNode,
  videoFileName,
  videoProviderFromNode,
} from "@/features/canvas/domain/nodeUtils";
import {
  buildCanvasTextRequestMessages,
  canvasTextRequestPrompt,
  isGeneratedCanvasText,
  updateCanvasNodeComposer,
} from "@/features/canvas/domain/text";
import {
  canvasSeedanceVideoReferences,
  canvasVideoReferenceLayout,
  hydrateCanvasVideoReferences,
  mergeCanvasVideoReferences,
  videoResultPersistentMetadata,
} from "@/features/canvas/domain/video";
import { stringValue } from "@/features/canvas/domain/value";
import type { WorkspaceScope } from "@/shared/config";
import type {
  CanvasEdgeData,
  CanvasImageReferenceSnapshot,
  CanvasNodeData,
  CanvasNodeMetadata,
} from "@/features/canvas/domain/types";
import { browserCanvasGenerationServices } from "./browser-services";
import { validateVideoGenerationConfig, validateVideoReferenceLayout } from "@/features/video";
import {
  forgetPendingCanvasJob,
  pendingCanvasJobsForProject,
  rememberPendingCanvasJob,
} from "./pendingJobStore";
import type {
  CanvasAudioTargetRunInput,
  CanvasGenerationBindings,
  CanvasGenerationPreparation,
  CanvasGenerationRequest,
  CanvasGenerationServices,
  CanvasImageTargetRunInput,
  CanvasPreparedImageReferences,
  CanvasTextTargetRunInput,
  CanvasVideoTargetRunInput,
} from "./types";

const directExecutor: CanvasGenerationBindings["executeGeneration"] = operation => operation();

const emptyBindings: CanvasGenerationBindings = {
  getProjectId: () => "",
  getProjectTitle: () => "",
  getProjectKey: () => "",
  getScope: () => null,
  isSwitching: () => true,
  isLoading: () => true,
  getNodes: () => [],
  setNodes: () => undefined,
  getEdges: () => [],
  setEdges: () => undefined,
  getSelectedNodeId: () => "",
  getSelectedNodeIds: () => new Set(),
  getCanvasAssets: () => [],
  mergeCanvasAssets: () => undefined,
  getImageModel: () => "",
  getTextModel: () => "",
  getVideoModel: () => "",
  getAudioModel: () => "",
  isPromptOptimizing: () => false,
  setPromptOptimizing: () => undefined,
  getViewportZoom: () => 90,
  setRunningNodeIds: () => undefined,
  setJobProgressByNode: () => undefined,
  applyNodeSelection: () => undefined,
  persistSnapshot: async () => false,
  executeGeneration: directExecutor,
  executeAssets: directExecutor,
  onMessage: () => undefined,
  onSuccess: () => undefined,
  onWarning: () => undefined,
  onError: () => undefined,
};

export class CanvasGenerationJobsController {
  private bindings = emptyBindings;
  private readonly requests = new Map<string, CanvasGenerationRequest>();
  private readonly preparations = new Map<string, CanvasGenerationPreparation>();
  private readonly recoveredJobIds = new Set<string>();
  private readonly startingTargetIds = new Set<string>();
  private recoverGeneration = 0;

  constructor(
    private readonly services: CanvasGenerationServices = browserCanvasGenerationServices,
  ) {}

  updateBindings(bindings: CanvasGenerationBindings) {
    this.bindings = bindings;
  }

  readonly abortAllGenerationRequests = () => {
    this.preparations.forEach(preparation => preparation.controller.abort());
    this.preparations.clear();
    this.requests.forEach(request => request.controller.abort());
    this.requests.clear();
    this.recoveredJobIds.clear();
    this.startingTargetIds.clear();
    this.bindings.setRunningNodeIds(new Set());
    this.bindings.setJobProgressByNode({});
  };

  readonly clearRecoveredJobs = () => {
    this.recoveredJobIds.clear();
  };

  readonly cancelForRemovedNodes = (removedIds: ReadonlySet<string>) => {
    const canceledTargetIds = new Set<string>();
    this.preparations.forEach((preparation, preparationId) => {
      const relatedNodeDeleted = removedIds.has(preparation.originNodeId)
        || Boolean(preparation.targetNodeId && removedIds.has(preparation.targetNodeId))
        || preparation.referenceNodeIds.some(nodeId => removedIds.has(nodeId));
      if (!relatedNodeDeleted) return;
      this.preparations.delete(preparationId);
      preparation.controller.abort();
      if (preparation.targetNodeId) canceledTargetIds.add(preparation.targetNodeId);
    });
    Array.from(this.requests.values()).forEach(request => {
      if (
        !removedIds.has(request.targetNodeId)
        && !removedIds.has(request.originNodeId)
        && !removedIds.has(request.runningNodeId)
      ) return;
      this.requests.delete(request.targetNodeId);
      canceledTargetIds.add(request.targetNodeId);
      this.forgetCanvasJob(request.targetNodeId, request.jobId);
      request.controller.abort();
      if (request.jobId && (request.provider !== "seedance" || request.jobId.startsWith("job_"))) {
        void this.generation(() => this.services.cancelJob(request.jobId!, request.scope)).catch(() => undefined);
      }
    });
    this.syncRequestState();
    return canceledTargetIds;
  };

  readonly runImageTarget = async (input: CanvasImageTargetRunInput) => {
    const graph = this.currentGenerationGraph(input.projectKey, input.targetNodeId);
    if (!graph) return false;
    const request = this.startRequest({
      targetNodeId: input.targetNodeId,
      originNodeId: input.originNodeId,
      runningNodeId: input.runningNodeId,
      projectKey: input.projectKey,
      scope: input.scope,
      jobId: input.existingJobId,
    });
    const isCurrent = () => this.currentRequest(request.targetNodeId, request.requestId, request.projectKey);
    try {
      let generated: Awaited<ReturnType<CanvasGenerationServices["generateImages"]>>["images"][number] | undefined;
      if (input.existingJobId) {
        this.rememberCanvasJob(input.targetNodeId, input.existingJobId, "image", input.projectKey);
        const job = await this.generation(() => this.services.waitForImageJob(input.existingJobId!, {
          signal: request.controller.signal,
          onProgress: state => this.updateProgress(request, state.progress ?? 0),
        }));
        if (job.status !== "succeeded") {
          throw new Error(jobErrorMessage(
            job,
            job.status === "canceled" ? "生成任务已取消，可重试" : "图片生成失败",
          ));
        }
        generated = (await this.generation(() => this.services.generatedImagesFromJob(
          job,
          input.scope,
          request.controller.signal,
        )))[0];
      } else {
        const settingsIssue = canvasImageResolutionIssue(input.imageResolution ?? imageResolutionFromNode(graph.source));
        if (settingsIssue) throw new Error(settingsIssue);
        if (!input.model.trim()) throw new Error("图片模型尚未就绪，请稍后重试");
        const result = await this.generation(() => this.services.generateImages({
          model: input.model,
          prompt: input.requestPrompt || input.prompt,
          seed: input.seed,
          size: input.size,
          quality: input.quality,
          count: 1,
          referenceFiles: input.referenceFiles,
          maskFile: input.maskFile,
          scope: input.scope,
          sourceType: "canvas",
          sourceProjectId: this.bindings.getProjectId(),
          sourceNodeId: input.targetNodeId,
        }, {
          signal: request.controller.signal,
          onWaiting: waiting => this.updateWaiting(request, waiting),
          onAccepted: job => {
            const active = isCurrent();
            if (!active) return;
            const jobId = job.job_id || job.id || "";
            active.jobId = jobId;
            this.rememberCanvasJob(input.targetNodeId, jobId, "image", input.projectKey);
            const next = this.updateNodes(current => current.map(node => node.id === input.targetNodeId ? {
              ...node,
              metadata: {
                ...node.metadata,
                jobId,
                status: "loading",
                errorDetails: undefined,
                requestedImageSize: input.size,
                ...(input.seed !== undefined ? { seed: input.seed } : {}),
              },
            } : node));
            this.updateProgress(active, 0);
            void this.persist(next);
          },
          onProgress: job => this.updateProgress(request, job.progress ?? 0),
        }));
        generated = result.images[0];
      }
      const active = isCurrent();
      if (!active || !generated) return false;
      const archived = await this.archiveGeneratedImage(generated, active, input.prompt);
      if (!isCurrent()) return false;
      const next = this.updateNodes(current => completeGeneratedImageTarget(
        current,
        input.targetNodeId,
        archived,
        input.prompt,
      ));
      this.forgetCanvasJob(input.targetNodeId, request.jobId || input.existingJobId);
      await this.persist(next);
      return true;
    } catch (error) {
      if (!isCurrent() || isAbortError(error)) return false;
      const message = canvasImageGenerationError(publicApiError(error, "画布节点生成失败"));
      this.forgetCanvasJob(input.targetNodeId, request.jobId || input.existingJobId);
      const next = this.updateNodes(current => failGeneratedImageTarget(current, input.targetNodeId, message));
      await this.persist(next);
      this.bindings.onError(message);
      return false;
    } finally {
      this.finishRequest(request.targetNodeId, request.requestId, request.projectKey);
    }
  };

  readonly runTextTarget = async (input: CanvasTextTargetRunInput) => {
    if (!this.currentGenerationGraph(input.projectKey, input.targetNodeId)) return false;
    const request = this.startRequest({
      targetNodeId: input.targetNodeId,
      originNodeId: input.originNodeId,
      runningNodeId: input.runningNodeId,
      projectKey: input.projectKey,
      scope: input.scope,
    });
    const isCurrent = () => this.currentRequest(request.targetNodeId, request.requestId, request.projectKey);
    try {
      const response = await this.generation(() => this.services.requestAiText({
        model: input.model,
        messages: input.messages || buildCanvasTextRequestMessages(input.prompt, []),
      }, request.controller.signal, waiting => this.updateWaiting(request, waiting)));
      if (!isCurrent()) return false;
      const content = response.content.trim();
      if (!content) throw new Error("文本模型没有返回内容");
      const next = this.updateNodes(current => current.map(node => node.id === input.targetNodeId ? {
        ...node,
        kind: "text" as const,
        title: preserveCanvasNodeTitle(node, "生成文本"),
        content,
        metadata: {
          ...node.metadata,
          content,
          generationMode: "text" as const,
          generatedInCanvas: true,
          model: response.model || input.model,
          prompt: input.prompt,
          sourceNodeId: input.originNodeId,
          status: "success" as const,
          errorDetails: undefined,
          jobId: undefined,
          jobProgress: undefined,
        },
      } : node));
      await this.persist(next);
      return true;
    } catch (error) {
      if (!isCurrent() || isAbortError(error)) return false;
      const message = publicApiError(error, "文本生成失败");
      const next = this.updateNodes(current => failGeneratedTextTarget(current, input.targetNodeId, message));
      await this.persist(next);
      this.bindings.onError(message);
      return false;
    } finally {
      this.finishRequest(request.targetNodeId, request.requestId, request.projectKey);
    }
  };

  readonly runAudioTarget = async (input: CanvasAudioTargetRunInput) => {
    if (!this.currentGenerationGraph(input.projectKey, input.targetNodeId)) return false;
    const request = this.startRequest({
      targetNodeId: input.targetNodeId,
      originNodeId: input.originNodeId,
      runningNodeId: input.runningNodeId,
      projectKey: input.projectKey,
      scope: input.scope,
    });
    const isCurrent = () => this.currentRequest(request.targetNodeId, request.requestId, request.projectKey);
    const config = normalizeAudioGenerationConfig(input.config);
    try {
      const blob = await this.generation(() => this.services.requestAudioGeneration(
        config,
        input.prompt,
        { signal: request.controller.signal, onWaiting: waiting => this.updateWaiting(request, waiting) },
      ));
      if (!isCurrent()) return false;
      const contentType = blob.type.startsWith("audio/") ? blob.type : audioMimeType(config.format);
      const file = this.services.createFile(
        [blob],
        audioFileName(input.prompt.slice(0, 32) || "generated-audio", config.format),
        { type: contentType },
      );
      const asset = await this.assets(() => this.services.uploadAsset(file, this.assetMetadata(
        request.targetNodeId,
        input.prompt,
        "audio",
        file.name,
      ), request.scope, request.controller.signal));
      if (!isCurrent()) return false;
      const next = this.updateNodes(current => completeGeneratedAudioTarget(
        current,
        input.targetNodeId,
        asset,
        input.prompt,
        config,
        input.originNodeId,
        input.scope,
      ));
      await this.persist(next);
      return true;
    } catch (error) {
      if (!isCurrent() || isAbortError(error)) return false;
      const message = publicApiError(error, "音频生成失败");
      const next = this.updateNodes(current => failGeneratedAudioTarget(current, input.targetNodeId, message));
      await this.persist(next);
      this.bindings.onError(message);
      return false;
    } finally {
      this.finishRequest(request.targetNodeId, request.requestId, request.projectKey);
    }
  };

  readonly runVideoTarget = async (input: CanvasVideoTargetRunInput) => {
    if (!this.currentGenerationGraph(input.projectKey, input.targetNodeId)) return false;
    const request = this.startRequest({
      targetNodeId: input.targetNodeId,
      originNodeId: input.originNodeId,
      runningNodeId: input.runningNodeId,
      projectKey: input.projectKey,
      scope: input.scope,
      jobId: input.existingTask?.id,
      provider: input.existingTask?.provider,
    });
    const isCurrent = () => this.currentRequest(request.targetNodeId, request.requestId, request.projectKey);
    try {
      let task = input.existingTask;
      if (task?.id) {
        this.rememberCanvasJob(input.targetNodeId, task.id, "video", input.projectKey);
      }
      if (!task) {
        task = await this.generation(() => this.services.createVideoGenerationTask(
          input.config,
          input.prompt,
          input.references,
          { signal: request.controller.signal, projectId: this.bindings.getProjectId(),
            onWaiting: waiting => this.updateWaiting(request, waiting),
            nodeId: this.bindings.getProjectId() ? input.targetNodeId : undefined, scope: input.scope },
        ));
        const active = isCurrent();
        if (!active) return false;
        active.jobId = task.id;
        active.provider = task.provider;
        this.rememberCanvasJob(input.targetNodeId, task.id, "video", input.projectKey);
        const accepted = this.updateNodes(current => current.map(node => node.id === input.targetNodeId ? {
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
        this.updateProgress(active, 0);
        await this.persist(accepted);
      }

      let result: VideoGenerationResult | undefined;
      while (isCurrent()) {
        const state = await this.generation(() => this.services.pollVideoGenerationTask(
          input.config,
          task!,
          {
            signal: request.controller.signal,
            onProgress: job => this.updateProgress(request, job.progress ?? 0),
          },
        ));
        if (state.status === "failed") throw new Error(state.error);
        if (state.status === "completed") {
          result = state.result;
          break;
        }
        if (typeof state.progress === "number") this.updateProgress(request, state.progress);
        await this.services.waitForPoll(request.controller.signal);
      }
      if (!isCurrent() || !result) return false;
      const asset = await this.archiveGeneratedVideo(result, request, input.prompt);
      if (!isCurrent()) return false;
      const persistentResult = videoResultPersistentMetadata(result, { ...asset, scope: input.scope });
      const next = this.updateNodes(current => completeGeneratedVideoTarget(
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
      this.forgetCanvasJob(input.targetNodeId, task?.id || request.jobId);
      await this.persist(next);
      if (isCurrent()) this.bindings.onSuccess("视频生成完成，节点结果已更新");
      return true;
    } catch (error) {
      if (!isCurrent() || isAbortError(error)) return false;
      const message = publicApiError(error, "视频生成失败");
      this.forgetCanvasJob(input.targetNodeId, request.jobId || input.existingTask?.id);
      const next = this.updateNodes(current => failGeneratedVideoTarget(current, input.targetNodeId, message));
      await this.persist(next);
      this.bindings.onError(message);
      return false;
    } finally {
      this.finishRequest(request.targetNodeId, request.requestId, request.projectKey);
    }
  };

  readonly stopGenerationByNodeId = (nodeId: string) => {
    const preparations = Array.from(this.preparations.values()).filter(preparation => (
      preparation.targetNodeId === nodeId
      || preparation.runningNodeId === nodeId
      || preparation.originNodeId === nodeId
    ));
    const requests = Array.from(this.requests.values()).filter(request => (
      request.targetNodeId === nodeId
      || request.runningNodeId === nodeId
      || request.originNodeId === nodeId
    ));
    if (!requests.length && !preparations.length) return;
    const affected = new Set(requests.map(request => request.targetNodeId));
    preparations.forEach(preparation => {
      this.preparations.delete(preparation.id);
      preparation.controller.abort();
      if (preparation.targetNodeId) affected.add(preparation.targetNodeId);
    });
    requests.forEach(request => {
      this.requests.delete(request.targetNodeId);
      this.forgetCanvasJob(request.targetNodeId, request.jobId);
      request.controller.abort();
      if (request.jobId && (request.provider !== "seedance" || request.jobId.startsWith("job_"))) {
        void this.generation(() => this.services.cancelJob(request.jobId!, request.scope)).catch(() => undefined);
      }
    });
    this.syncRequestState();
    const next = this.updateNodes(current => {
      let changed = current.map(node => affected.has(node.id) && node.metadata?.status === "loading" ? {
        ...node,
        title: "生成已停止",
        metadata: {
          ...node.metadata,
          status: "error" as const,
          errorDetails: "已停止生成，可重试。",
          jobId: undefined,
          jobProgress: undefined,
        },
      } : node);
      const roots = new Set(changed
        .filter(node => affected.has(node.id))
        .map(node => stringValue(node.metadata?.batchRootId))
        .filter(Boolean));
      roots.forEach(rootId => { changed = refreshImageBatchRoot(changed, rootId); });
      if (changed.some(node => node.id === nodeId && node.metadata?.isBatchRoot)) {
        changed = refreshImageBatchRoot(changed, nodeId);
      }
      return changed;
    });
    void this.persist(next);
    this.bindings.onMessage("已停止生成，失败节点可单独重试");
  };

  readonly retryImageNode = async (node: CanvasNodeData) => {
    const scope = this.bindings.getScope();
    const projectKey = this.bindings.getProjectKey();
    if (!scope || !projectKey || this.bindings.isSwitching()) return;
    const currentNodes = this.bindings.getNodes();
    node = currentNodes.find(item => item.id === node.id) || node;
    const targetNodes = node.metadata?.isBatchRoot
      ? currentNodes.filter(item => (
        (item.id === node.id || node.metadata?.batchChildIds?.includes(item.id))
        && item.metadata?.status === "error"
      ))
      : [node];
    if (!targetNodes.length) {
      this.bindings.onMessage("没有需要重试的失败结果");
      return;
    }
    const invalidTarget = targetNodes.find(target => canvasImageGenerationSettingsIssue(target));
    if (invalidTarget) {
      this.bindings.onWarning(`${invalidTarget.title}：${canvasImageGenerationSettingsIssue(invalidTarget)}`);
      return;
    }
    await Promise.allSettled(targetNodes.map(target => this.withRetryPreparation(target, projectKey, async preparation => {
      const snapshots = imageReferenceSnapshots(target.metadata?.referenceInputs);
      const sourceNodeId = stringValue(target.metadata?.sourceNodeId) || target.id;
      preparation.referenceNodeIds = snapshots.map(snapshot => snapshot.nodeId)
        .filter(nodeId => currentNodes.some(item => item.id === nodeId));
      const files = await this.filesFromReferenceSnapshots(snapshots, scope, preparation.controller.signal);
      if (!this.preparationIsCurrent(preparation)) return;
      const prompt = stringValue(target.metadata?.prompt) || target.content;
      const slot = canvasImageBatchSlot(this.bindings.getNodes(), target.id);
      const seed = randomImageGenerationSeed();
      const next = this.updateNodes(current => {
        let mapped = current.map(item => item.id === target.id ? {
          ...item,
          title: "重新生成中…",
          imageAssetId: undefined,
          imageSrc: undefined,
          metadata: {
            ...item.metadata,
            assetId: undefined,
            content: prompt,
            status: "loading" as const,
            errorDetails: undefined,
            jobId: undefined,
            jobProgress: undefined,
            ownAssetId: undefined,
            ownImageSrc: undefined,
            ...(Number.isFinite(seed) ? { seed } : {}),
          },
        } : item);
        const rootId = stringValue(target.metadata?.batchRootId)
          || (target.metadata?.isBatchRoot ? target.id : "");
        if (rootId) mapped = refreshImageBatchRoot(mapped, rootId);
        return mapped;
      });
      void this.persist(next);
      const running = this.runImageTarget({
        targetNodeId: target.id,
        originNodeId: sourceNodeId,
        runningNodeId: stringValue(target.metadata?.batchRootId) || target.id,
        projectKey,
        scope,
        prompt,
        requestPrompt: diversifyCanvasBatchImagePrompt(prompt, slot.index, slot.count, seed),
        seed,
        model: modelFromNode(target, this.bindings.getImageModel()),
        ...canvasImageGenerationSettings(target, undefined, modelFromNode(target, this.bindings.getImageModel())),
        referenceFiles: files,
      });
      this.finishPreparation(preparation.id);
      await running;
    })));
  };

  readonly retryTextNode = async (node: CanvasNodeData) => {
    const scope = this.bindings.getScope();
    const projectKey = this.bindings.getProjectKey();
    if (!scope || !projectKey || this.bindings.isSwitching()) return;
    node = this.bindings.getNodes().find(item => item.id === node.id) || node;
    const prompt = stringValue(node.metadata?.prompt) || node.content;
    const model = modelFromNode(node, this.bindings.getTextModel());
    if (!prompt.trim() || !model) {
      this.bindings.onWarning(!model ? "请先配置文本模型" : "提示词不能为空");
      return;
    }
    const sourceNodeId = stringValue(node.metadata?.sourceNodeId) || node.id;
    await this.withRetryPreparation(node, projectKey, async preparation => {
      const next = this.updateNodes(current => current.map(item => item.id === node.id ? {
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
      await this.persist(next);
      if (!this.sessionCurrent(projectKey)) {
        this.failIfSameProject(projectKey, [node.id], failGeneratedTextTarget);
        return;
      }
      if (!this.preparationIsCurrent(preparation)) return;
      const running = this.runTextTarget({
        targetNodeId: node.id,
        originNodeId: sourceNodeId,
        runningNodeId: node.id,
        projectKey,
        scope,
        prompt,
        model,
      });
      this.finishPreparation(preparation.id);
      await running;
    });
  };

  readonly retryAudioNode = async (node: CanvasNodeData) => {
    const scope = this.bindings.getScope();
    const projectKey = this.bindings.getProjectKey();
    if (!scope || !projectKey || this.bindings.isSwitching()) return;
    node = this.bindings.getNodes().find(item => item.id === node.id) || node;
    const prompt = stringValue(node.metadata?.prompt) || node.content;
    const config = audioConfigFromNode(node, this.bindings.getAudioModel());
    if (!prompt.trim() || !config.model) {
      this.bindings.onWarning(!config.model ? "请先配置音频模型" : "提示词不能为空");
      return;
    }
    const sourceNodeId = stringValue(node.metadata?.sourceNodeId) || node.id;
    await this.withRetryPreparation(node, projectKey, async preparation => {
      const next = this.updateNodes(current => current.map(item => item.id === node.id ? {
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
      await this.persist(next);
      if (!this.sessionCurrent(projectKey)) {
        this.failIfSameProject(projectKey, [node.id], failGeneratedAudioTarget);
        return;
      }
      if (!this.preparationIsCurrent(preparation)) return;
      const running = this.runAudioTarget({
        targetNodeId: node.id,
        originNodeId: sourceNodeId,
        runningNodeId: node.id,
        projectKey,
        scope,
        prompt,
        config,
      });
      this.finishPreparation(preparation.id);
      await running;
    });
  };

  readonly retryVideoNode = async (node: CanvasNodeData) => {
    const scope = this.bindings.getScope();
    const projectKey = this.bindings.getProjectKey();
    if (!scope || !projectKey || this.bindings.isSwitching()) return;
    node = this.bindings.getNodes().find(item => item.id === node.id) || node;
    const prompt = stringValue(node.metadata?.prompt) || node.content;
    const config = videoConfigFromNode(node, this.bindings.getVideoModel());
    if (!prompt.trim() || !config.model) {
      this.bindings.onWarning(!config.model ? "请先配置视频模型" : "提示词不能为空");
      return;
    }
    await this.withRetryPreparation(node, projectKey, async preparation => {
      const nodes = this.bindings.getNodes();
      const edges = this.bindings.getEdges();
      // Ignore a legacy snapshot entry that points back to the node being
      // retried. It is the previous output, not an explicit video reference.
      const snapshot = canvasVideoReferenceSnapshot(node.metadata?.videoReferenceInputs);
      const retrySnapshot = {
        items: snapshot.items.filter(item => item.nodeId !== node.id),
      };
      let retryPrompt = prompt;
      let generationInputs = canvasGenerationInputsFromVideoSnapshot(retrySnapshot, nodes);
      // Retry must resolve the current graph first. A failed node can outlive or
      // replace the image nodes captured by its old snapshot; using that stale
      // snapshot silently re-uploads the original image as storage_token and
      // loses a registered asset:// reference.
      try {
        const current = await this.resolveMentionContext(node, nodes, edges, undefined, preparation.controller.signal);
        if (!current.missingKeys.length && (current.inputs.length || extractCanvasMentionTokens(prompt).length)) {
          retryPrompt = current.prompt;
          generationInputs = current.inputs;
        }
      } catch {
        // Keep the durable snapshot fallback for retries whose source nodes were
        // intentionally removed from the current canvas.
      }
      if (!this.preparationIsCurrent(preparation)) return;
      const sourceNodeId = stringValue(node.metadata?.sourceNodeId) || node.id;
      preparation.referenceNodeIds = generationInputs
        .map(input => input.nodeId)
        .filter(nodeId => nodes.some(item => item.id === nodeId));
      if (!this.preparationIsCurrent(preparation)) return;
      const prepared = await this.prepareVideoReferences(generationInputs, scope, preparation.controller.signal);
      if (!this.preparationIsCurrent(preparation)) return;
      const references = mergeCanvasVideoReferences(
        prepared.references,
        canvasSeedanceVideoReferences(node.metadata?.seedanceMaterialAssets, node.metadata?.seedanceVolcanoAssets),
      );
      const next = this.updateNodes(current => current.map(item => item.id === node.id ? {
        ...item,
        title: "重新生成视频中…",
        imageAssetId: undefined,
        imageSrc: undefined,
        metadata: {
          ...item.metadata,
          generationRevisions: appendCanvasGenerationRevision(item, this.services.createId()),
          appliedFromHistory: undefined,
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
      await this.persist(next);
      if (!this.preparationIsCurrent(preparation)) return;
      const running = this.runVideoTarget({
        targetNodeId: node.id,
        originNodeId: sourceNodeId,
        runningNodeId: node.id,
        projectKey,
        scope,
        prompt: retryPrompt,
        config,
        references,
        referenceInputs: prepared.snapshot,
      });
      this.finishPreparation(preparation.id);
      await running;
    });
  };

  readonly runSelectedGeneration = async () => {
    if (this.bindings.isSwitching() || this.bindings.isLoading()) return;
    const nodes = this.bindings.getNodes();
    const nodesById = new Map(nodes.map(node => [node.id, node]));
    const runners: Partial<Record<CanvasNodeData["kind"], (node: CanvasNodeData) => Promise<void>>> = {
      image: this.retryImageNode,
      text: this.retryTextNode,
      audio: this.retryAudioNode,
      video: this.retryVideoNode,
    };
    const runnable = Array.from(this.bindings.getSelectedNodeIds())
      .map(id => nodesById.get(id))
      .filter((node): node is CanvasNodeData => Boolean(
        node
        && runners[node.kind]
        && node.metadata?.status !== "loading"
        && !isHiddenCanvasBatchChild(node, nodes),
      ));
    if (!runnable.length) {
      this.bindings.onMessage("没有可运行的选中节点");
      return;
    }
    this.bindings.onMessage(`开始生成 ${runnable.length} 个选中节点`);
    await Promise.allSettled(runnable.map(node => runners[node.kind]!(node)));
  };

  readonly recoverPendingJobs = () => {
    const generation = ++this.recoverGeneration;
    void this.recoverPendingJobsInternal(generation);
  };

  readonly generateTextFromNode = async (sourceId?: string) => {
    const nodes = this.bindings.getNodes();
    const edges = this.bindings.getEdges();
    const sourceNode = this.sourceNode(sourceId, nodes);
    if (!sourceNode || this.bindings.isSwitching()) return;
    const session = this.activeSession("文本");
    if (!session) return;
    const context = await this.resolveMentionContextOrNotify(sourceNode, nodes, edges);
    if (!context) return;
    const prompt = canvasTextRequestPrompt(sourceNode, context.prompt);
    const model = modelFromNode(sourceNode, this.bindings.getTextModel());
    if (!prompt.trim() || !model) {
      this.bindings.onWarning(!model ? "请先配置文本模型" : "提示词不能为空");
      return;
    }
    const imageInputs = context.inputs.filter(input => input.type === "image");
    let messages = buildCanvasTextRequestMessages(prompt, []);
    if (imageInputs.length) {
      const preparation = this.startPreparation({
        projectKey: session.projectKey,
        originNodeId: sourceNode.id,
        referenceNodeIds: imageInputs.filter(input => !input.assetId).map(input => input.nodeId),
      });
      try {
        const urls: string[] = [];
        for (const input of imageInputs) {
          const file = await this.referenceFile(input, session.scope, preparation.controller.signal);
          urls.push(await this.services.readFileDataUrl(file, preparation.controller.signal));
        }
        if (!this.preparationIsCurrent(preparation)) return;
        messages = buildCanvasTextRequestMessages(prompt, urls);
      } catch (error) {
        if (!isAbortError(error)) this.bindings.onError(publicApiError(error, "文本参考图读取失败"));
        return;
      } finally {
        this.finishPreparation(preparation.id);
      }
    }
    const currentGraph = this.currentGenerationGraph(session.projectKey, sourceNode.id);
    if (!currentGraph) return;
    const isConfigNode = sourceNode.kind === "config";
    const editingTextNode = isGeneratedCanvasText(sourceNode);
    const count = isConfigNode ? imageCountFromNode(sourceNode) : 1;
    const childIds = isConfigNode || editingTextNode
      ? Array.from({ length: count }, () => this.services.createId())
      : [];
    const targetIds = childIds.length ? childIds : [sourceNode.id];
    const childNodes = childIds.map((id, index): CanvasNodeData => ({
      id,
      kind: "text",
      title: `生成文本中${count > 1 ? ` ${index + 1}/${count}` : ""}…`,
      content: "",
      x: currentGraph.source.x + currentGraph.source.width + 96,
      y: currentGraph.source.y + (index - (count - 1) / 2) * 206,
      width: 320,
      height: 170,
      metadata: {
        content: "",
        composerContent: promptTextFromNode(sourceNode),
        prompt,
        generationMode: "text",
        model,
        sourceNodeId: sourceNode.id,
        status: "loading",
      },
    }));
    const pendingNodes = childIds.length
      ? [...currentGraph.nodes.map(node => node.id === sourceNode.id && isConfigNode ? {
        ...node,
        metadata: {
          ...node.metadata,
          composerContent: promptTextFromNode(sourceNode),
          prompt,
          generationMode: "text" as const,
          model,
          status: "success" as const,
          errorDetails: undefined,
        },
      } : node), ...childNodes]
      : currentGraph.nodes.map(node => node.id === sourceNode.id ? {
        ...node,
        kind: "text" as const,
        title: "生成文本中…",
        content: "",
        metadata: {
          ...node.metadata,
          content: "",
          composerContent: promptTextFromNode(sourceNode),
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
      ? [...currentGraph.edges, ...childIds.map((childId): CanvasEdgeData => ({
        id: this.services.createId(),
        from: sourceNode.id,
        to: childId,
      }))]
      : currentGraph.edges;
    this.commitGraph(pendingNodes, pendingEdges);
    this.selectPreparedTarget(sourceNode.id, childIds[0] || sourceNode.id);
    await this.persist(pendingNodes, pendingEdges);
    if (!this.sessionCurrent(session.projectKey)) {
      this.failIfSameProject(session.projectKey, targetIds, failGeneratedTextTarget);
      return;
    }
    const results = await Promise.all(targetIds.map(targetNodeId => this.runTextTarget({
      targetNodeId,
      originNodeId: sourceNode.id,
      runningNodeId: sourceNode.id,
      projectKey: session.projectKey,
      scope: session.scope,
      prompt,
      model,
      messages,
    })));
    const succeeded = results.filter(Boolean).length;
    if (succeeded && succeeded < targetIds.length) {
      this.bindings.onWarning(`已生成 ${succeeded}/${targetIds.length} 条文本，失败结果可单独重试`);
    }
  };

  readonly generateImageFromNode = async (sourceId?: string) => {
    const nodes = this.bindings.getNodes();
    const edges = this.bindings.getEdges();
    const sourceNode = this.sourceNode(sourceId, nodes);
    if (!sourceNode || this.bindings.isSwitching()) return;
    const session = this.activeSession("画布");
    if (!session) return;
    const settingsIssue = canvasImageGenerationSettingsIssue(sourceNode);
    if (settingsIssue) {
      this.bindings.onWarning(settingsIssue);
      return;
    }
    const model = modelFromNode(sourceNode, this.bindings.getImageModel());
    if (!model.trim()) {
      this.bindings.onWarning("图片模型尚未就绪，请稍后重试");
      return;
    }
    const context = await this.resolveMentionContextOrNotify(sourceNode, nodes, edges, {
      includeConnectedInputs: false,
    });
    if (!context) return;
    const prompt = context.prompt;
    if (!prompt.trim()) {
      this.bindings.onWarning("请先填写提示词");
      return;
    }
    const generationInputs = context.inputs.filter(input => input.nodeId !== sourceNode.id);
    const referenceNodeIds = generationInputs
      .filter(input => input.type === "image" && !input.assetId)
      .map(input => input.nodeId);
    const preparation = this.startPreparation({
      projectKey: session.projectKey,
      originNodeId: sourceNode.id,
      referenceNodeIds,
    });
    let prepared: CanvasPreparedImageReferences;
    try {
      prepared = await this.prepareImageReferences(
        generationInputs,
        session.scope,
        sourceNode.id,
        session.projectKey,
        preparation.controller.signal,
      );
    } catch (error) {
      if (isAbortError(error) || this.bindings.getProjectKey() !== session.projectKey) return;
      this.bindings.onError(publicApiError(error, "读取或归档参考图失败"));
      return;
    } finally {
      this.finishPreparation(preparation.id);
    }
    if (!this.preparationIsCurrent(preparation)) return;
    const currentGraph = this.currentGenerationGraph(session.projectKey, sourceNode.id);
    if (!currentGraph) return;
    const count = stringValue(sourceNode.metadata?.batchRootId) ? 1 : imageCountFromNode(sourceNode);
    // Imported asset nodes are source material and must remain intact; generating
    // from their prompt creates a new image node. Generated image nodes continue
    // to reuse their slot for the existing overwrite workflow.
    const reuseSourceNode = sourceNode.kind === "image" && sourceNode.metadata?.canvasOrigin !== "imported";
    const hasExistingMedia = Boolean(
      assetIdFromNode(sourceNode)
      || sourceNode.imageSrc
      || looksLikeImageSource(stringValue(sourceNode.metadata?.content))
    );
    const spawnBatchChildren = count > 1;
    const rootId = reuseSourceNode ? sourceNode.id : this.services.createId();
    const previousChildren = reuseSourceNode && sourceNode.metadata?.isBatchRoot
      ? (sourceNode.metadata.batchChildIds || []).flatMap(id => {
        const child = this.bindings.getNodes().find(node => node.id === id && node.metadata?.batchRootId === rootId);
        return child ? [child] : [];
      }) : [];
    const childIds = spawnBatchChildren
      ? Array.from({ length: count - 1 }, (_, index) => previousChildren[index]?.id || this.services.createId())
      : [];
    const targetIds = [rootId, ...childIds];
    const { size, quality, imageResolution } = canvasImageGenerationSettings(sourceNode, undefined, model);
    const generationRevisions = reuseSourceNode
      ? appendCanvasGenerationRevision(sourceNode, this.services.createId())
      : sourceNode.metadata?.generationRevisions;
    const commonMetadata: CanvasNodeMetadata = {
      content: prompt,
      composerContent: promptTextFromNode(sourceNode),
      prompt,
      status: "loading",
      jobId: undefined,
      jobProgress: undefined,
      generationQueued: undefined,
      model,
      size: sizeFromNode(sourceNode),
      quality,
      imageResolution,
      requestedImageSize: size,
      sourceNodeId: sourceNode.id,
      generationType: prepared.files.length ? "edit" : "generation",
      referenceInputs: prepared.snapshots,
    };
    // The request keeps the clicked settings, while choices edited during
    // reference loading remain available for the user's next generation.
    const currentSourceNode = currentGraph.source;
    const currentImageSettings = canvasImageGenerationSettings(currentSourceNode, undefined, modelFromNode(currentSourceNode, model));
    const rootNode: CanvasNodeData = {
      ...(reuseSourceNode ? currentSourceNode : {
        id: rootId,
        kind: "image" as const,
        x: currentSourceNode.x + currentSourceNode.width + 96,
        y: currentSourceNode.y + 24,
        width: 320,
        height: 238,
      }),
      id: rootId,
      kind: "image",
      title: hasExistingMedia ? sourceNode.title : "生成中…",
      content: prompt,
      imageAssetId: hasExistingMedia ? sourceNode.imageAssetId : undefined,
      imageSrc: hasExistingMedia ? sourceNode.imageSrc : undefined,
      metadata: {
        ...(reuseSourceNode ? currentSourceNode.metadata : {}),
        ...commonMetadata,
        count,
        isBatchRoot: spawnBatchChildren || undefined,
        batchStatus: spawnBatchChildren ? "loading" : undefined,
        batchErrorDetails: undefined,
        batchChildIds: childIds.length ? childIds : undefined,
        batchModelV2: spawnBatchChildren || undefined,
        assetId: hasExistingMedia ? assetIdFromNode(sourceNode) : undefined,
        ownAssetId: hasExistingMedia ? sourceNode.metadata?.ownAssetId : undefined,
        ownImageSrc: hasExistingMedia ? sourceNode.metadata?.ownImageSrc : undefined,
        errorDetails: undefined,
        appliedFromHistory: undefined,
        generationRevisions,
        ...(reuseSourceNode ? {
          size: sizeFromNode(currentSourceNode),
          quality: currentImageSettings.quality,
          imageResolution: currentImageSettings.imageResolution,
          model: modelFromNode(currentSourceNode, model),
        } : {}),
      },
    };
    const childNodes = childIds.map((id, index): CanvasNodeData => {
      const position = batchChildGridPosition(rootNode, index);
      const previous = previousChildren[index];
      return {
        ...previous,
        id,
        kind: "image",
        title: `生成中 ${index + 2}/${count}`,
        content: prompt,
        x: position.x,
        y: position.y,
        width: 320,
        height: 238,
        metadata: {
          ...previous?.metadata,
          ...commonMetadata,
          count: 1,
          batchRootId: rootId,
          errorDetails: undefined,
          jobId: undefined,
          jobProgress: undefined,
          generationRevisions: previous ? appendCanvasGenerationRevision(previous, this.services.createId()) : undefined,
        },
      };
    });
    const childUpdates = new Map(childNodes.map(node => [node.id, node]));
    const currentNodes = currentGraph.nodes;
    const retainedNodes = currentNodes.map(node => childUpdates.get(node.id) || (
      // Reducing the next batch must retain older results as independent nodes.
      previousChildren.some(child => child.id === node.id)
        ? { ...node, metadata: { ...node.metadata, batchRootId: undefined } }
        : node
    ));
    // Retried children keep their creation position and therefore their default number.
    const currentIds = new Set(currentNodes.map(node => node.id));
    const pendingNodes = reuseSourceNode
      ? [...retainedNodes.map(node => node.id === sourceNode.id ? rootNode : node), ...childNodes.filter(node => !currentIds.has(node.id))]
      : [...currentNodes, rootNode, ...childNodes];
    const pendingEdges = reuseSourceNode
      ? currentGraph.edges
      : [...currentGraph.edges, {
        id: this.services.createId(),
        from: sourceNode.id,
        to: rootId,
      }];
    const releaseStarting = this.trackStartingTargets(targetIds);
    try {
      this.commitGraph(pendingNodes, pendingEdges);
      this.selectPreparedTarget(sourceNode.id, rootId);
      await this.persist(pendingNodes, pendingEdges);
      if (!this.sessionCurrent(session.projectKey)) {
        this.failIfSameProject(session.projectKey, targetIds, failGeneratedImageTarget);
        return;
      }
      const results = await Promise.all(targetIds.map((targetNodeId, index) => {
        const seed = randomImageGenerationSeed();
        return this.runImageTarget({
          targetNodeId,
          originNodeId: sourceNode.id,
          runningNodeId: rootId,
          projectKey: session.projectKey,
          scope: session.scope,
          prompt,
          requestPrompt: diversifyCanvasBatchImagePrompt(prompt, index, count, seed),
          seed,
          model,
          size,
          quality,
          imageResolution,
          referenceFiles: prepared.files,
        });
      }));
      if (this.bindings.getProjectKey() !== session.projectKey) return;
      const succeeded = results.filter(Boolean).length;
      if (count > 1) {
        const next = this.updateNodes(current => refreshImageBatchRoot(current, rootId));
        await this.persist(next);
        if (succeeded && succeeded < count) {
          this.bindings.onWarning(`已生成 ${succeeded}/${count} 张，失败结果可单独重试`);
        }
      }
    } finally {
      releaseStarting();
    }
  };

  readonly generateVideoFromNode = async (sourceId?: string) => {
    const nodes = this.bindings.getNodes();
    const edges = this.bindings.getEdges();
    const sourceNode = this.sourceNode(sourceId, nodes);
    if (!sourceNode || this.bindings.isSwitching()) return;
    const session = this.activeSession("视频");
    if (!session) return;
    const context = await this.resolveMentionContextOrNotify(sourceNode, nodes, edges);
    if (!context) return;
    const prompt = context.prompt;
    const config = videoConfigFromNode(sourceNode, this.bindings.getVideoModel());
    if (!prompt.trim() || !config.model) {
      this.bindings.onWarning(!config.model ? "请先配置视频模型" : "提示词不能为空");
      return;
    }
    const referenceNodeIds = context.inputs
      .filter(input => input.type !== "text" && !input.assetId)
      .map(input => input.nodeId);
    const preparation = this.startPreparation({
      projectKey: session.projectKey,
      originNodeId: sourceNode.id,
      referenceNodeIds,
    });
    let prepared: Awaited<ReturnType<CanvasGenerationJobsController["prepareVideoReferences"]>>;
    try {
      prepared = await this.prepareVideoReferences(context.inputs, session.scope, preparation.controller.signal);
    } catch (error) {
      if (isAbortError(error) || this.bindings.getProjectKey() !== session.projectKey) return;
      this.bindings.onError(publicApiError(error, "读取视频参考素材失败"));
      return;
    } finally {
      this.finishPreparation(preparation.id);
    }
    if (!this.preparationIsCurrent(preparation)) return;
    const currentGraph = this.currentGenerationGraph(session.projectKey, sourceNode.id);
    if (!currentGraph) return;
    const currentSourceNode = currentGraph.source;
    const references = mergeCanvasVideoReferences(
      prepared.references,
      canvasSeedanceVideoReferences(sourceNode.metadata?.seedanceMaterialAssets, sourceNode.metadata?.seedanceVolcanoAssets),
    );
    // Mirror the image-node overwrite workflow: generated video nodes reuse their
    // slot when the prompt is edited and regenerated; imported source material
    // always spawns a new node so the original asset stays intact.
    const reuseSourceNode = sourceNode.kind === "video" && sourceNode.metadata?.canvasOrigin !== "imported";
    const hasExistingMedia = reuseSourceNode && Boolean(assetIdFromNode(sourceNode));
    const targetNodeId = reuseSourceNode ? sourceNode.id : this.services.createId();
    const generationRevisions = reuseSourceNode
      ? appendCanvasGenerationRevision(sourceNode, this.services.createId())
      : undefined;
    const targetNode: CanvasNodeData = {
      id: targetNodeId,
      kind: "video",
      title: hasExistingMedia ? sourceNode.title : "视频生成中…",
      content: prompt,
      x: reuseSourceNode ? currentSourceNode.x : currentSourceNode.x + currentSourceNode.width + 96,
      y: reuseSourceNode ? currentSourceNode.y : currentSourceNode.y + 24,
      width: reuseSourceNode ? currentSourceNode.width : 420,
      height: reuseSourceNode ? currentSourceNode.height : 260,
      metadata: {
        ...(reuseSourceNode ? currentSourceNode.metadata : {}),
        generationRevisions,
        appliedFromHistory: undefined,
        // Keep the previous media attached while regenerating so the node keeps
        // showing the old video during generation and after a failed attempt,
        // matching the image-node behavior.
        assetId: hasExistingMedia ? assetIdFromNode(sourceNode) : undefined,
        content: prompt,
        composerContent: promptTextFromNode(sourceNode),
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
        seedanceMaterialAssets: sourceNode.metadata?.seedanceMaterialAssets?.map(asset => ({ ...asset })),
        seedanceVolcanoAssets: sourceNode.metadata?.seedanceVolcanoAssets?.map(asset => ({ ...asset })),
        status: "loading",
        errorDetails: undefined,
        jobId: undefined,
        jobProgress: 0,
        mimeType: hasExistingMedia ? sourceNode.metadata?.mimeType : undefined,
        bytes: hasExistingMedia ? sourceNode.metadata?.bytes : undefined,
      },
    };
    const pendingNodes = reuseSourceNode
      ? currentGraph.nodes.map(node => node.id === sourceNode.id ? targetNode : node)
      : [...currentGraph.nodes, targetNode];
    const pendingEdges = reuseSourceNode
      ? currentGraph.edges
      : [...currentGraph.edges, { id: this.services.createId(), from: sourceNode.id, to: targetNodeId }];
    const releaseStarting = this.trackStartingTargets([targetNodeId]);
    try {
      this.commitGraph(pendingNodes, pendingEdges);
      this.selectPreparedTarget(sourceNode.id, targetNodeId);
      await this.persist(pendingNodes, pendingEdges);
      if (!this.sessionCurrent(session.projectKey)) {
        this.failIfSameProject(session.projectKey, [targetNodeId], failGeneratedVideoTarget);
        return;
      }
      await this.runVideoTarget({
        targetNodeId,
        originNodeId: sourceNode.id,
        runningNodeId: targetNodeId,
        projectKey: session.projectKey,
        scope: session.scope,
        prompt,
        config,
        references,
        referenceInputs: prepared.snapshot,
      });
    } finally {
      releaseStarting();
    }
  };

  readonly generateAudioFromNode = async (sourceId?: string) => {
    const nodes = this.bindings.getNodes();
    const edges = this.bindings.getEdges();
    const sourceNode = this.sourceNode(sourceId, nodes);
    if (!sourceNode || this.bindings.isSwitching()) return;
    const session = this.activeSession("音频");
    if (!session) return;
    const context = await this.resolveMentionContextOrNotify(sourceNode, nodes, edges);
    if (!context) return;
    const prompt = context.prompt;
    const config = audioConfigFromNode(sourceNode, this.bindings.getAudioModel());
    if (!prompt.trim() || !config.model) {
      this.bindings.onWarning(!config.model ? "请先配置音频模型" : "提示词不能为空");
      return;
    }
    const currentGraph = this.currentGenerationGraph(session.projectKey, sourceNode.id);
    if (!currentGraph) return;
    const currentSourceNode = currentGraph.source;
    // Same overwrite workflow as image/video: generated audio nodes reuse their
    // slot; imported material spawns a new node to protect the original asset.
    const reuseSourceNode = sourceNode.kind === "audio" && sourceNode.metadata?.canvasOrigin !== "imported";
    const hasExistingMedia = reuseSourceNode && Boolean(assetIdFromNode(sourceNode));
    const targetNodeId = reuseSourceNode ? sourceNode.id : this.services.createId();
    const targetNode: CanvasNodeData = {
      id: targetNodeId,
      kind: "audio",
      title: hasExistingMedia ? sourceNode.title : "音频生成中…",
      content: prompt,
      x: reuseSourceNode ? currentSourceNode.x : currentSourceNode.x + currentSourceNode.width + 96,
      y: reuseSourceNode ? currentSourceNode.y : currentSourceNode.y + Math.max(0, (currentSourceNode.height - 120) / 2),
      width: reuseSourceNode ? currentSourceNode.width : 320,
      height: reuseSourceNode ? currentSourceNode.height : 120,
      metadata: {
        ...(reuseSourceNode ? currentSourceNode.metadata : {}),
        assetId: hasExistingMedia ? assetIdFromNode(sourceNode) : undefined,
        content: prompt,
        composerContent: promptTextFromNode(sourceNode),
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
        mimeType: hasExistingMedia ? sourceNode.metadata?.mimeType : undefined,
        bytes: hasExistingMedia ? sourceNode.metadata?.bytes : undefined,
      },
    };
    const pendingNodes = reuseSourceNode
      ? currentGraph.nodes.map(node => node.id === sourceNode.id ? targetNode : node)
      : [...currentGraph.nodes, targetNode];
    const pendingEdges = reuseSourceNode
      ? currentGraph.edges
      : [...currentGraph.edges, { id: this.services.createId(), from: sourceNode.id, to: targetNodeId }];
    this.commitGraph(pendingNodes, pendingEdges);
    this.selectPreparedTarget(sourceNode.id, targetNodeId);
    await this.persist(pendingNodes, pendingEdges);
    if (!this.sessionCurrent(session.projectKey)) {
      this.failIfSameProject(session.projectKey, [targetNodeId], failGeneratedAudioTarget);
      return;
    }
    await this.runAudioTarget({
      targetNodeId,
      originNodeId: sourceNode.id,
      runningNodeId: targetNodeId,
      projectKey: session.projectKey,
      scope: session.scope,
      prompt,
      config,
    });
  };

  readonly generateFromNode = async (sourceId?: string) => {
    const sourceNode = this.sourceNode(sourceId, this.bindings.getNodes());
    if (!sourceNode) return;
    // Mark the intent before resolving references or persisting the pending node.
    // This keeps the UI responsive on a busy page and prevents duplicate clicks.
    if (this.isLiveCanvasTarget(sourceNode.id)) return;
    const releaseStarting = this.trackStartingTargets([sourceNode.id]);
    const mode = generationModeFromNode(sourceNode);
    try {
      if (mode === "text") return await this.generateTextFromNode(sourceNode.id);
      if (mode === "image") return await this.generateImageFromNode(sourceNode.id);
      if (mode === "video") return await this.generateVideoFromNode(sourceNode.id);
      return await this.generateAudioFromNode(sourceNode.id);
    } finally {
      releaseStarting();
    }
  };

  readonly optimizeNodePrompt = async (node: CanvasNodeData, skillPrompt?: string) => {
    const current = promptTextFromNode(node).trim();
    if (!current) {
      this.bindings.onWarning("先写点提示词再优化");
      return;
    }
    if (this.bindings.isPromptOptimizing()) return;
    const model = this.bindings.getTextModel();
    if (!model) {
      this.bindings.onError("请先配置文本模型");
      return;
    }
    this.bindings.setPromptOptimizing(true);
    try {
      const instruction = skillPrompt?.trim()
        || "你是提示词优化专家。在不改变主体与场景的前提下，补足画面、动作、光影与质感细节，直接返回优化后的提示词本身，不要解释。";
      const result = await this.generation(() => this.services.requestAiText({
        model,
        prompt: `${instruction}\n\n待优化的提示词：\n${current}`,
      }));
      const optimized = result.content.trim();
      if (!optimized) {
        this.bindings.onWarning("优化结果为空");
        return;
      }
      this.updateNodes(nodes => nodes.map(item => (
        item.id === node.id ? updateCanvasNodeComposer(item, optimized) : item
      )));
      this.bindings.onSuccess("提示词已优化");
    } catch (error) {
      this.bindings.onError(publicApiError(error, "优化提示词失败"));
    } finally {
      this.bindings.setPromptOptimizing(false);
    }
  };

  dispose() {
    this.abortAllGenerationRequests();
    this.bindings = emptyBindings;
  }

  private async withRetryPreparation(
    node: CanvasNodeData,
    projectKey: string,
    operation: (preparation: CanvasGenerationPreparation) => Promise<void>,
  ) {
    const nodes = this.bindings.getNodes();
    if (!nodes.some(item => item.id === node.id) || this.isLiveCanvasTarget(node.id)) return;
    const sourceNodeId = stringValue(node.metadata?.sourceNodeId) || node.id;
    // Register before any asynchronous work, including reference lookup and saving.
    const preparation = this.startPreparation({
      projectKey,
      originNodeId: nodes.some(item => item.id === sourceNodeId) ? sourceNodeId : node.id,
      targetNodeId: node.id,
      runningNodeId: stringValue(node.metadata?.batchRootId) || node.id,
      referenceNodeIds: [],
    });
    try {
      await operation(preparation);
    } catch (error) {
      if (isAbortError(error) || !this.preparations.has(preparation.id) || !this.preparationIsCurrent(preparation)) return;
      const message = publicApiError(error, "准备重试失败，请检查参考素材后重试");
      const fail = {
        image: failGeneratedImageTarget,
        video: failGeneratedVideoTarget,
        audio: failGeneratedAudioTarget,
        text: failGeneratedTextTarget,
      }[generationModeFromNode(node)];
      const next = this.updateNodes(current => fail(current, node.id, message));
      this.bindings.onError(message);
      await this.persist(next);
    } finally {
      this.finishPreparation(preparation.id);
    }
  }

  private startPreparation(input: Omit<CanvasGenerationPreparation, "id" | "controller">) {
    const preparation: CanvasGenerationPreparation = {
      ...input,
      id: this.services.createId(),
      referenceNodeIds: Array.from(new Set(input.referenceNodeIds)),
      controller: this.services.createAbortController(),
    };
    this.preparations.set(preparation.id, preparation);
    this.syncRequestState();
    return preparation;
  }

  private finishPreparation(id: string) {
    if (this.preparations.delete(id)) this.syncRequestState();
  }

  private preparationIsCurrent(preparation: CanvasGenerationPreparation) {
    if (
      preparation.controller.signal.aborted
      || !this.sessionCurrent(preparation.projectKey)
    ) return false;
    const ids = new Set(this.bindings.getNodes().map(node => node.id));
    return ids.has(preparation.originNodeId)
      && (!preparation.targetNodeId || ids.has(preparation.targetNodeId))
      && preparation.referenceNodeIds.every(nodeId => ids.has(nodeId));
  }

  private startRequest(
    input: Omit<CanvasGenerationRequest, "requestId" | "controller"> & { controller?: AbortController },
  ) {
    this.requests.get(input.targetNodeId)?.controller.abort();
    const request: CanvasGenerationRequest = {
      ...input,
      requestId: this.services.createId(),
      controller: input.controller || this.services.createAbortController(),
    };
    this.requests.set(input.targetNodeId, request);
    this.syncRequestState();
    return request;
  }

  private currentRequest(targetNodeId: string, requestId: string, projectKey: string) {
    const request = this.requests.get(targetNodeId);
    return request?.requestId === requestId
      && request.projectKey === projectKey
      && this.bindings.getProjectKey() === projectKey
      ? request
      : null;
  }

  private finishRequest(targetNodeId: string, requestId: string, projectKey: string) {
    if (!this.currentRequest(targetNodeId, requestId, projectKey)) return false;
    this.requests.delete(targetNodeId);
    this.syncRequestState();
    return true;
  }

  private syncRequestState() {
    const running = new Set<string>();
    this.requests.forEach(request => {
      running.add(request.targetNodeId);
      running.add(request.runningNodeId);
    });
    this.startingTargetIds.forEach(nodeId => running.add(nodeId));
    this.preparations.forEach(preparation => {
      if (preparation.targetNodeId) running.add(preparation.targetNodeId);
      if (preparation.runningNodeId) running.add(preparation.runningNodeId);
    });
    this.bindings.setRunningNodeIds(running);
    this.bindings.setJobProgressByNode(current => Object.fromEntries(
      Object.entries(current).filter(([nodeId]) => running.has(nodeId)),
    ));
  }

  private updateWaiting(request: CanvasGenerationRequest, waiting: boolean) {
    if (!this.currentRequest(request.targetNodeId, request.requestId, request.projectKey)) return;
    this.updateNodes(nodes => nodes.map(node => node.id === request.targetNodeId ? {
      ...node,
      metadata: { ...node.metadata, generationQueued: waiting || undefined },
    } : node));
  }

  private updateProgress(request: CanvasGenerationRequest, progress: number) {
    if (!this.currentRequest(request.targetNodeId, request.requestId, request.projectKey)) return;
    const normalized = Math.max(0, Math.min(100, Math.round(progress || 0)));
    this.bindings.setJobProgressByNode(current => ({
      ...current,
      [request.targetNodeId]: normalized,
      [request.runningNodeId]: normalized,
    }));
  }

  private async referenceFile(
    input: { title: string; assetId?: string; assetScope?: "personal" | "team"; content?: string },
    scope: "personal" | "team",
    signal?: AbortSignal,
  ) {
    let url = input.content || "";
    let ownedUrl = "";
    if (input.assetId) {
      ownedUrl = await this.assets(() => this.services.getAssetContentObjectUrl(
        input.assetId!,
        input.assetScope || scope,
        undefined,
        signal,
      ));
      url = ownedUrl;
    }
    if (!url) throw new Error(`参考图“${input.title}”没有可读取内容`);
    if (!input.assetId && !/^(asset:|data:|blob:|https?:\/\/|\/)/i.test(url)) {
      throw new Error(`参考图“${input.title}”的内容不是可读取的媒体地址`);
    }
    try {
      const blob = await this.services.fetchBlob(url, signal, `读取参考图“${input.title}”`);
      const contentType = blob.type || "image/png";
      return this.services.createFile([blob], imageFileName(input.title, contentType), { type: contentType });
    } finally {
      if (ownedUrl) this.services.revokeObjectURL(ownedUrl);
    }
  }

  private async prepareImageReferences(
    inputs: ReturnType<typeof buildCanvasGenerationInputs>,
    scope: "personal" | "team",
    sourceNodeId: string,
    projectKey: string,
    signal?: AbortSignal,
  ): Promise<CanvasPreparedImageReferences> {
    const files: File[] = [];
    const snapshots: CanvasImageReferenceSnapshot[] = [];
    for (const input of inputs.filter(item => item.type === "image")) {
      this.assertSession(signal, projectKey);
      const file = await this.referenceFile(input, scope, signal);
      let assetId = input.assetId || "";
      let name = file.name;
      let contentType = file.type || "image/png";
      if (!assetId) {
        const asset = await this.assets(() => this.services.uploadAsset(file, {
          type: "image",
          name: file.name,
          category: "reference",
          source_type: "canvas",
          source_project_id: this.bindings.getProjectId(),
          source_project_name: this.bindings.getProjectTitle(),
          source_metadata: JSON.stringify({
            canvas_node_id: input.nodeId,
            generation_source_node_id: sourceNodeId,
          }),
        }, scope, signal));
        assetId = asset.id;
        name = asset.name || name;
        contentType = asset.content_type || contentType;
        this.assertSession(signal, projectKey);
        this.updateNodes(current => current.map(node => node.id === input.nodeId ? {
          ...node,
          content: looksLikeImageSource(node.content) ? "" : node.content,
          imageAssetId: assetId,
          imageSrc: undefined,
          metadata: {
            ...node.metadata,
            assetId,
            content: looksLikeImageSource(node.content) ? "" : node.content,
          },
        } : node));
      }
      this.assertSession(signal, projectKey);
      files.push(file);
      snapshots.push({
        nodeId: input.nodeId,
        title: input.title,
        assetId,
        assetScope: input.assetScope || scope,
        name,
        contentType,
      });
    }
    return { files, snapshots };
  }

  /** Read-only preflight: no job, loading node, upload or generation is created. */
  readonly preflightVideoNode = async (nodeId: string, signal: AbortSignal): Promise<string[]> => {
    const nodes = this.bindings.getNodes();
    const node = nodes.find(item => item.id === nodeId);
    const scope = this.bindings.getScope();
    const projectKey = this.bindings.getProjectKey();
    if (!node || !scope || this.bindings.isSwitching()) throw new Error("正在确认画布与模型，请稍后重试检查");
    const config = videoConfigFromNode(node, this.bindings.getVideoModel());
    validateVideoGenerationConfig(config);
    const context = await this.resolveMentionContext(node, nodes, this.bindings.getEdges(), undefined, signal);
    if (context.missingKeys.length) throw new Error(`存在失效引用：${context.missingKeys.join("、")}`);
    const inputs = node.metadata?.status === "error" && !context.inputs.length && !extractCanvasMentionTokens(context.prompt).length
      ? canvasGenerationInputsFromVideoSnapshot({ items: canvasVideoReferenceSnapshot(node.metadata.videoReferenceInputs).items.filter(item => item.nodeId !== node.id) }, nodes)
      : context.inputs;
    // Selecting a node must not download every reference just to enable Generate.
    // Full file/metadata validation still runs before submission in both generate
    // and retry; this passive check only validates locally available constraints.
    const registered = canvasSeedanceVideoReferences(node.metadata?.seedanceMaterialAssets, node.metadata?.seedanceVolcanoAssets);
    validateVideoReferenceLayout(canvasVideoReferenceLayout(inputs, registered), config.model);
    this.assertSession(signal, projectKey);
    return [];
  };

  private prepareVideoReferences(
    inputs: ReturnType<typeof buildCanvasGenerationInputs>,
    scope: "personal" | "team",
    signal?: AbortSignal,
  ) {
    return hydrateCanvasVideoReferences(inputs, {
      scope,
      createFile: (blob, name, mime) => this.services.createFile([blob], name, { type: mime }),
      resolveAssetBlob: async input => {
        const url = await this.assets(() => this.services.getAssetContentObjectUrl(
          input.assetId,
          input.assetScope || scope,
          undefined,
          signal,
        ));
        try {
          return await this.services.fetchBlob(url, signal, `读取引用“${input.title}”`);
        } finally {
          this.services.revokeObjectURL(url);
        }
      },
      resolveNodeBlob: input => isReadableMediaSource(input.content)
        ? this.services.fetchBlob(input.content, signal, `读取引用“${input.title}”`)
        : Promise.resolve(null),
      readImageMetadata: file => this.services.readImageMetadata(file, signal),
      readVideoMetadata: file => this.services.readVideoMetadata(file, signal),
      readAudioMetadata: file => this.services.readAudioMetadata(file, signal),
    });
  }

  private filesFromReferenceSnapshots(
    snapshots: CanvasImageReferenceSnapshot[],
    scope: "personal" | "team",
    signal?: AbortSignal,
  ) {
    return Promise.all(snapshots.map(snapshot => this.referenceFile({
      title: snapshot.title,
      assetId: snapshot.assetId,
      assetScope: snapshot.assetScope,
    }, scope, signal)));
  }

  private async resolveMentionContext(
    sourceNode: CanvasNodeData,
    nodes: CanvasNodeData[],
    edges: CanvasEdgeData[],
    options?: BuildCanvasMentionGenerationContextOptions,
    signal?: AbortSignal,
  ) {
    const scope = this.bindings.getScope();
    const projectKey = this.bindings.getProjectKey();
    if (!scope) throw new Error("正在确认项目工作区");
    const ownPrompt = promptTextFromNode(sourceNode) || sourceNode.title;
    const assetIds = extractCanvasMentionTokens(ownPrompt)
      .filter(token => token.source === "asset")
      .map(token => token.targetId);
    const currentAssets = this.bindings.getCanvasAssets();
    const known = new Set(currentAssets.filter(asset => asset.scope === scope).map(asset => asset.id));
    const missing = Array.from(new Set(assetIds.filter(id => !known.has(id))));
    const fetched = (await Promise.allSettled(missing.map(id => this.assets(
      () => this.services.getAsset(id, scope),
    )))).flatMap(result => result.status === "fulfilled" ? [result.value] : []);
    this.assertSession(signal, projectKey);
    if (!this.bindings.getNodes().some(node => node.id === sourceNode.id)) throw new DOMException("Aborted", "AbortError");
    if (fetched.length) this.bindings.mergeCanvasAssets(fetched, scope);
    const assets = [
      ...currentAssets.filter(asset => asset.scope === scope),
      ...fetched.map(asset => ({ ...asset, scope })),
    ];
    return buildCanvasMentionGenerationContext(sourceNode.id, nodes, edges, ownPrompt, assets, scope, options);
  }

  private async resolveMentionContextOrNotify(
    sourceNode: CanvasNodeData,
    nodes: CanvasNodeData[],
    edges: CanvasEdgeData[],
    options?: BuildCanvasMentionGenerationContextOptions,
  ) {
    try {
      const context = await this.resolveMentionContext(sourceNode, nodes, edges, options);
      if (context.missingKeys.length) {
        this.bindings.onError(`存在失效引用：${context.missingKeys.join("、")}`);
        return null;
      }
      return context;
    } catch (error) {
      if (!isAbortError(error)) this.bindings.onError(publicApiError(error, "解析画布引用失败"));
      return null;
    }
  }

  private async archiveGeneratedImage(
    generated: Awaited<ReturnType<CanvasGenerationServices["generateImages"]>>["images"][number],
    request: CanvasGenerationRequest,
    prompt: string,
  ) {
    if (generated.assetId) {
      if (generated.src.startsWith("blob:")) this.services.revokeObjectURL(generated.src);
      return { ...generated, src: "" };
    }
    if (!generated.src) throw new Error("生成任务没有返回可归档的图片内容");
    const temporaryUrl = generated.src.startsWith("blob:") ? generated.src : "";
    try {
      const blob = await this.services.fetchBlob(
        generated.src,
        request.controller.signal,
        "读取生成结果",
      );
      const contentType = blob.type || generated.contentType || "image/png";
      const file = this.services.createFile(
        [blob],
        imageFileName(generated.name || "generated-image", contentType),
        { type: contentType },
      );
      const asset = await this.assets(() => this.services.uploadAsset(file, this.assetMetadata(
        request.targetNodeId,
        prompt,
        "image",
        file.name,
      ), request.scope, request.controller.signal));
      return {
        ...generated,
        id: asset.id,
        assetId: asset.id,
        src: "",
        name: asset.name || generated.name,
        contentType: asset.content_type || contentType,
      };
    } finally {
      if (temporaryUrl) this.services.revokeObjectURL(temporaryUrl);
    }
  }

  private async archiveGeneratedVideo(
    result: VideoGenerationResult,
    request: CanvasGenerationRequest,
    prompt: string,
  ): Promise<Asset> {
    if (result.assetId) {
      if (result.url.startsWith("blob:")) this.services.revokeObjectURL(result.url);
      return {
        id: result.assetId,
        type: "video",
        name: result.fileName || "generated-video.mp4",
        content_type: result.mimeType || "video/mp4",
      };
    }
    const temporaryUrl = result.url.startsWith("blob:") ? result.url : "";
    try {
      const blob = await this.generation(() => this.services.videoGenerationResultToBlob(
        result,
        request.controller.signal,
      ));
      const contentType = blob.type || result.mimeType || "video/mp4";
      const file = this.services.createFile(
        [blob],
        videoFileName(result.fileName || "generated-video", contentType),
        { type: contentType },
      );
      return await this.assets(() => this.services.uploadAsset(file, this.assetMetadata(
        request.targetNodeId,
        prompt,
        "video",
        file.name,
      ), request.scope, request.controller.signal));
    } finally {
      if (temporaryUrl) this.services.revokeObjectURL(temporaryUrl);
    }
  }

  private assetMetadata(
    targetNodeId: string,
    prompt: string,
    type: "image" | "video" | "audio",
    name: string,
  ) {
    return {
      type,
      name,
      category: "other" as const,
      source_type: "canvas" as const,
      source_project_id: this.bindings.getProjectId(),
      source_project_name: this.bindings.getProjectTitle(),
      source_metadata: JSON.stringify({ canvas_node_id: targetNodeId, prompt }),
    };
  }

  private sourceNode(sourceId: string | undefined, nodes: CanvasNodeData[]) {
    const id = sourceId || this.bindings.getSelectedNodeId();
    return nodes.find(node => node.id === id) || null;
  }

  /** Only request inputs may outlive an await. Graph writes start from live data,
   * so unrelated additions, edits and removals cannot be rolled back by a task. */
  private currentGenerationGraph(projectKey: string, sourceId: string) {
    if (!this.sessionCurrent(projectKey)) return null;
    const nodes = this.bindings.getNodes();
    const source = nodes.find(node => node.id === sourceId);
    return source ? { nodes, edges: this.bindings.getEdges(), source } : null;
  }

  private selectPreparedTarget(sourceId: string, targetId: string) {
    // Background preparation must not pull focus away from a newly edited node.
    if (this.bindings.getSelectedNodeId() === sourceId) this.bindings.applyNodeSelection([targetId], targetId, true);
  }

  private activeSession(label: string) {
    const scope = this.bindings.getScope();
    const projectKey = this.bindings.getProjectKey();
    if (scope && projectKey) return { scope, projectKey };
    this.bindings.onWarning(`正在确认项目工作区，暂不能生成${label}节点`);
    return null;
  }

  private sessionCurrent(projectKey: string) {
    return !this.bindings.isSwitching() && this.bindings.getProjectKey() === projectKey;
  }

  private failIfSameProject(
    projectKey: string,
    targetIds: string[],
    fail: (nodes: CanvasNodeData[], id: string, message: string) => CanvasNodeData[],
  ) {
    if (this.bindings.getProjectKey() !== projectKey) return;
    this.updateNodes(current => targetIds.reduce(
      (next, id) => fail(next, id, "切换画布时生成被中断，可重试。"),
      current,
    ));
  }

  private assertSession(signal: AbortSignal | undefined, projectKey: string) {
    if (signal?.aborted || this.bindings.getProjectKey() !== projectKey) {
      throw new DOMException("Aborted", "AbortError");
    }
  }

  private rememberCanvasJob(
    nodeId: string,
    jobId: string,
    kind: "image" | "video",
    projectKey: string,
  ) {
    if (!nodeId || !jobId || !projectKey) return;
    rememberPendingCanvasJob({
      nodeId,
      jobId,
      kind,
      projectKey,
      savedAt: Date.now(),
    });
  }

  private forgetCanvasJob(nodeId: string, jobId?: string) {
    forgetPendingCanvasJob(nodeId, jobId);
  }

  private trackStartingTargets(ids: readonly string[]) {
    ids.forEach(id => this.startingTargetIds.add(id));
    this.syncRequestState();
    return () => {
      ids.forEach(id => this.startingTargetIds.delete(id));
      this.syncRequestState();
    };
  }

  private isLiveCanvasTarget(nodeId: string) {
    if (this.requests.has(nodeId) || this.startingTargetIds.has(nodeId)) return true;
    for (const preparation of this.preparations.values()) {
      if (preparation.targetNodeId === nodeId) return true;
    }
    return false;
  }

  private listedCanvasJobs(listed: unknown): RecoverableCanvasJob[] {
    const items = Array.isArray(listed)
      ? listed
      : listed && typeof listed === "object" && Array.isArray((listed as { items?: unknown }).items)
        ? (listed as { items: unknown[] }).items
        : [];
    return items.flatMap(item => {
      if (!item || typeof item !== "object") return [];
      const record = item as RecoverableCanvasJob;
      const id = stringValue(record.id);
      if (!id) return [];
      return [{
        id,
        payload: record.payload,
        created_at: record.created_at,
        updated_at: record.updated_at,
        status: record.status,
      }];
    });
  }

  private applyJobAssignments(assignments: readonly CanvasJobAssignment[]) {
    if (!assignments.length) return false;
    const current = this.bindings.getNodes();
    const restored = applyPendingCanvasJobIds(current, assignments);
    if (restored === current) return false;
    this.bindings.setNodes(restored);
    void this.persist(restored);
    return true;
  }

  private resumeLoadingCanvasJobs(projectKey: string, scope: WorkspaceScope) {
    this.bindings.getNodes()
      .filter(node => (
        (node.kind === "image" || node.kind === "video")
        && node.metadata?.status === "loading"
        && stringValue(node.metadata.jobId)
      ))
      .forEach(node => {
        const jobId = stringValue(node.metadata?.jobId);
        if (!jobId || this.recoveredJobIds.has(jobId) || this.requests.has(node.id)) return;
        this.recoveredJobIds.add(jobId);
        this.rememberCanvasJob(
          node.id,
          jobId,
          node.kind === "video" ? "video" : "image",
          projectKey,
        );
        if (node.kind === "video") {
          const config = videoConfigFromNode(node, this.bindings.getVideoModel());
          void this.runVideoTarget({
            targetNodeId: node.id,
            originNodeId: stringValue(node.metadata?.sourceNodeId) || node.id,
            runningNodeId: node.id,
            projectKey,
            scope,
            prompt: stringValue(node.metadata?.prompt) || node.content,
            config,
            references: { images: [], videos: [], audios: [] },
            referenceInputs: canvasVideoReferenceSnapshot(node.metadata?.videoReferenceInputs),
            existingTask: {
              id: jobId,
              provider: videoProviderFromNode(node, config.model),
              model: config.model,
            },
          });
          return;
        }
        void this.runImageTarget({
          targetNodeId: node.id,
          originNodeId: stringValue(node.metadata?.sourceNodeId) || node.id,
          runningNodeId: stringValue(node.metadata?.batchRootId) || node.id,
          projectKey,
          scope,
          prompt: stringValue(node.metadata?.prompt) || node.content,
          model: modelFromNode(node, this.bindings.getImageModel()),
          ...canvasImageGenerationSettings(node, undefined, modelFromNode(node, this.bindings.getImageModel())),
          referenceFiles: [],
          existingJobId: jobId,
        });
      });
  }

  private orphanLoadingMediaNodes() {
    return this.bindings.getNodes().filter(node => (
      (node.kind === "image" || node.kind === "video")
      && node.metadata?.status === "loading"
      && !stringValue(node.metadata?.jobId)
      && !this.isLiveCanvasTarget(node.id)
    ));
  }

  private async recoverPendingJobsInternal(generation: number) {
    const scope = this.bindings.getScope();
    const projectKey = this.bindings.getProjectKey();
    const projectId = this.bindings.getProjectId();
    if (
      generation !== this.recoverGeneration
      || this.bindings.isLoading()
      || this.bindings.isSwitching()
      || !scope
      || !projectKey
    ) return;

    this.applyJobAssignments(pendingCanvasJobsForProject(projectKey));
    this.resumeLoadingCanvasJobs(projectKey, scope);

    const missing = this.orphanLoadingMediaNodes();
    if (!missing.length) return;

    let jobs: RecoverableCanvasJob[] = [];
    try {
      const listed = await this.generation(() => this.services.getJobs({
        scope,
        status: "queued,running,succeeded,failed,canceled",
        type: "image.generate,image.edit",
        limit: 50,
      }));
      jobs = this.listedCanvasJobs(listed);
    } catch {
      return;
    }
    if (
      generation !== this.recoverGeneration
      || this.bindings.isLoading()
      || this.bindings.isSwitching()
      || this.bindings.getProjectKey() !== projectKey
    ) return;

    const matched = matchLoadingNodesToJobs(this.bindings.getNodes(), jobs, projectId);
    if (matched.length) {
      this.applyJobAssignments(matched);
      matched.forEach(item => this.rememberCanvasJob(item.nodeId, item.jobId, "image", projectKey));
      this.resumeLoadingCanvasJobs(projectKey, scope);
    }

    const leftover = this.orphanLoadingMediaNodes();
    if (!leftover.length) return;
    const interrupted = markUnrecoverableCanvasGenerations(
      this.bindings.getNodes(),
      new Set(leftover.map(node => node.id)),
    );
    if (interrupted === this.bindings.getNodes()) return;
    this.bindings.setNodes(interrupted);
    void this.persist(interrupted);
  }

  private updateNodes(updater: (nodes: CanvasNodeData[]) => CanvasNodeData[]) {
    const previous = this.bindings.getNodes();
    const next = ensureUniqueCanvasNodeTitles(updater(previous), previous, this.bindings.getProjectTitle());
    this.bindings.setNodes(next);
    return next;
  }

  private commitGraph(nodes: CanvasNodeData[], edges: CanvasEdgeData[]) {
    this.bindings.setNodes(ensureUniqueCanvasNodeTitles(nodes, this.bindings.getNodes(), this.bindings.getProjectTitle()));
    this.bindings.setEdges(edges);
  }

  private persist(
    nodes = this.bindings.getNodes(),
    edges = this.bindings.getEdges(),
  ) {
    return this.bindings.persistSnapshot(
      ensureUniqueCanvasNodeTitles(nodes, this.bindings.getNodes(), this.bindings.getProjectTitle()),
      edges,
      this.bindings.getViewportZoom(),
      { quiet: true },
    );
  }

  private generation<Result>(operation: () => Promise<Result>) {
    return this.bindings.executeGeneration(operation);
  }

  private assets<Result>(operation: () => Promise<Result>) {
    return this.bindings.executeAssets(operation);
  }
}
