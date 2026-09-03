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
} from "@/features/canvas/domain/mentions";
import {
  assetIdFromNode,
  looksLikeImageSource,
} from "@/features/canvas/domain/nodes";
import {
  audioConfigFromNode,
  canvasGenerationInputsFromVideoSnapshot,
  imageCountFromNode,
  imageFileName,
  imageReferenceSnapshots,
  isAbortError,
  isReadableMediaSource,
  canvasVideoReferenceSnapshot,
  generationModeFromNode,
  modelFromNode,
  promptTextFromNode,
  qualityFromNode,
  sizeFromNode,
  toImageSizeValue,
  videoConfigFromNode,
  videoFileName,
  videoProviderFromNode,
} from "@/features/canvas/domain/nodeUtils";
import {
  buildCanvasTextRequestMessages,
  canvasTextComposerValue,
  canvasTextRequestPrompt,
  isGeneratedCanvasText,
  updateCanvasNodeComposer,
} from "@/features/canvas/domain/text";
import {
  canvasSeedanceVideoReferences,
  hydrateCanvasVideoReferences,
  mergeCanvasVideoReferences,
  videoResultPersistentMetadata,
} from "@/features/canvas/domain/video";
import { stringValue } from "@/features/canvas/domain/value";
import type {
  CanvasEdgeData,
  CanvasImageReferenceSnapshot,
  CanvasNodeData,
  CanvasNodeMetadata,
} from "@/features/canvas/domain/types";
import { browserCanvasGenerationServices } from "./browser-services";
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
    this.bindings.setRunningNodeIds(new Set());
    this.bindings.setJobProgressByNode({});
  };

  readonly clearRecoveredJobs = () => {
    this.recoveredJobIds.clear();
  };

  readonly cancelForRemovedNodes = (removedIds: ReadonlySet<string>) => {
    this.preparations.forEach((preparation, preparationId) => {
      const relatedNodeDeleted = removedIds.has(preparation.originNodeId)
        || Boolean(preparation.targetNodeId && removedIds.has(preparation.targetNodeId))
        || preparation.referenceNodeIds.some(nodeId => removedIds.has(nodeId));
      if (!relatedNodeDeleted) return;
      this.preparations.delete(preparationId);
      preparation.controller.abort();
    });
    const canceledTargetIds = new Set<string>();
    Array.from(this.requests.values()).forEach(request => {
      if (
        !removedIds.has(request.targetNodeId)
        && !removedIds.has(request.originNodeId)
        && !removedIds.has(request.runningNodeId)
      ) return;
      this.requests.delete(request.targetNodeId);
      canceledTargetIds.add(request.targetNodeId);
      request.controller.abort();
      if (request.jobId && request.provider !== "seedance") {
        void this.generation(() => this.services.cancelJob(request.jobId!, request.scope)).catch(() => undefined);
      }
    });
    this.syncRequestState();
    return canceledTargetIds;
  };

  readonly runImageTarget = async (input: CanvasImageTargetRunInput) => {
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
        const result = await this.generation(() => this.services.generateImages({
          model: input.model,
          prompt: input.prompt,
          size: input.size,
          quality: input.quality,
          count: 1,
          referenceFiles: input.referenceFiles,
          maskFile: input.maskFile,
          scope: input.scope,
          sourceType: "canvas",
          sourceProjectId: this.bindings.getProjectId(),
          sourceNodeId: input.originNodeId,
        }, {
          signal: request.controller.signal,
          onAccepted: job => {
            const active = isCurrent();
            if (!active) return;
            const jobId = job.job_id || job.id || "";
            active.jobId = jobId;
            const next = this.updateNodes(current => current.map(node => node.id === input.targetNodeId ? {
              ...node,
              metadata: { ...node.metadata, jobId, status: "loading", errorDetails: undefined },
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
      await this.persist(next);
      return true;
    } catch (error) {
      if (!isCurrent() || isAbortError(error)) return false;
      const message = publicApiError(error, "画布节点生成失败");
      const next = this.updateNodes(current => failGeneratedImageTarget(current, input.targetNodeId, message));
      await this.persist(next);
      this.bindings.onError(message);
      return false;
    } finally {
      this.finishRequest(request.targetNodeId, request.requestId, request.projectKey);
    }
  };

  readonly runTextTarget = async (input: CanvasTextTargetRunInput) => {
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
      }, request.controller.signal));
      if (!isCurrent()) return false;
      const content = response.content.trim();
      if (!content) throw new Error("文本模型没有返回内容");
      const next = this.updateNodes(current => current.map(node => node.id === input.targetNodeId ? {
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
        { signal: request.controller.signal },
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
      if (!task) {
        task = await this.generation(() => this.services.createVideoGenerationTask(
          input.config,
          input.prompt,
          input.references,
          { signal: request.controller.signal },
        ));
        const active = isCurrent();
        if (!active) return false;
        active.jobId = task.id;
        active.provider = task.provider;
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
      await this.persist(next);
      return true;
    } catch (error) {
      if (!isCurrent() || isAbortError(error)) return false;
      const message = publicApiError(error, "视频生成失败");
      const next = this.updateNodes(current => failGeneratedVideoTarget(current, input.targetNodeId, message));
      await this.persist(next);
      this.bindings.onError(message);
      return false;
    } finally {
      this.finishRequest(request.targetNodeId, request.requestId, request.projectKey);
    }
  };

  readonly stopGenerationByNodeId = (nodeId: string) => {
    const requests = Array.from(this.requests.values()).filter(request => (
      request.targetNodeId === nodeId
      || request.runningNodeId === nodeId
      || request.originNodeId === nodeId
    ));
    if (!requests.length) return;
    const affected = new Set(requests.map(request => request.targetNodeId));
    requests.forEach(request => {
      this.requests.delete(request.targetNodeId);
      request.controller.abort();
      if (request.jobId && request.provider !== "seedance") {
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
    await Promise.allSettled(targetNodes.map(async target => {
      const snapshots = imageReferenceSnapshots(target.metadata?.referenceInputs);
      const sourceNodeId = stringValue(target.metadata?.sourceNodeId) || target.id;
      const preparation = this.startPreparation({
        projectKey,
        originNodeId: sourceNodeId,
        targetNodeId: target.id,
        referenceNodeIds: snapshots
          .map(snapshot => snapshot.nodeId)
          .filter(nodeId => currentNodes.some(item => item.id === nodeId)),
      });
      let files: File[];
      try {
        files = await this.filesFromReferenceSnapshots(snapshots, scope, preparation.controller.signal);
      } catch (error) {
        if (isAbortError(error) || this.bindings.getProjectKey() !== projectKey) return;
        const message = publicApiError(error, "参考图已失效，无法重试");
        this.updateNodes(current => failGeneratedImageTarget(current, target.id, message));
        return;
      } finally {
        this.finishPreparation(preparation.id);
      }
      if (!this.preparationIsCurrent(preparation)) return;
      const prompt = stringValue(target.metadata?.prompt) || target.content;
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
            ownAssetId: undefined,
            ownImageSrc: undefined,
          },
        } : item);
        const rootId = stringValue(target.metadata?.batchRootId)
          || (target.metadata?.isBatchRoot ? target.id : "");
        if (rootId) mapped = refreshImageBatchRoot(mapped, rootId);
        return mapped;
      });
      void this.persist(next);
      await this.runImageTarget({
        targetNodeId: target.id,
        originNodeId: sourceNodeId,
        runningNodeId: stringValue(target.metadata?.batchRootId) || target.id,
        projectKey,
        scope,
        prompt,
        model: stringValue(target.metadata?.model) || this.bindings.getImageModel(),
        size: toImageSizeValue(sizeFromNode(target)),
        quality: qualityFromNode(target),
        referenceFiles: files,
      });
    }));
  };

  readonly retryTextNode = async (node: CanvasNodeData) => {
    const scope = this.bindings.getScope();
    const projectKey = this.bindings.getProjectKey();
    if (!scope || !projectKey || this.bindings.isSwitching()) return;
    const prompt = stringValue(node.metadata?.prompt) || node.content;
    const model = modelFromNode(node, this.bindings.getTextModel());
    if (!prompt.trim() || !model) {
      this.bindings.onWarning(!model ? "请先配置文本模型" : "提示词不能为空");
      return;
    }
    const sourceNodeId = stringValue(node.metadata?.sourceNodeId) || node.id;
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
      if (this.bindings.getProjectKey() === projectKey) {
        this.updateNodes(current => failGeneratedTextTarget(
          current,
          node.id,
          "切换画布时生成被中断，可重试。",
        ));
      }
      return;
    }
    await this.runTextTarget({
      targetNodeId: node.id,
      originNodeId: sourceNodeId,
      runningNodeId: node.id,
      projectKey,
      scope,
      prompt,
      model,
    });
  };

  readonly retryAudioNode = async (node: CanvasNodeData) => {
    const scope = this.bindings.getScope();
    const projectKey = this.bindings.getProjectKey();
    if (!scope || !projectKey || this.bindings.isSwitching()) return;
    const prompt = stringValue(node.metadata?.prompt) || node.content;
    const config = audioConfigFromNode(node, this.bindings.getAudioModel());
    if (!prompt.trim() || !config.model) {
      this.bindings.onWarning(!config.model ? "请先配置音频模型" : "提示词不能为空");
      return;
    }
    const sourceNodeId = stringValue(node.metadata?.sourceNodeId) || node.id;
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
      if (this.bindings.getProjectKey() === projectKey) {
        this.updateNodes(current => failGeneratedAudioTarget(
          current,
          node.id,
          "切换画布时生成被中断，可重试。",
        ));
      }
      return;
    }
    await this.runAudioTarget({
      targetNodeId: node.id,
      originNodeId: sourceNodeId,
      runningNodeId: node.id,
      projectKey,
      scope,
      prompt,
      config,
    });
  };

  readonly retryVideoNode = async (node: CanvasNodeData) => {
    const scope = this.bindings.getScope();
    const projectKey = this.bindings.getProjectKey();
    if (!scope || !projectKey || this.bindings.isSwitching()) return;
    const prompt = stringValue(node.metadata?.prompt) || node.content;
    const config = videoConfigFromNode(node, this.bindings.getVideoModel());
    if (!prompt.trim() || !config.model) {
      this.bindings.onWarning(!config.model ? "请先配置视频模型" : "提示词不能为空");
      return;
    }
    const snapshot = canvasVideoReferenceSnapshot(node.metadata?.videoReferenceInputs);
    const generationInputs = canvasGenerationInputsFromVideoSnapshot(snapshot, this.bindings.getNodes());
    const sourceNodeId = stringValue(node.metadata?.sourceNodeId) || node.id;
    const preparation = this.startPreparation({
      projectKey,
      originNodeId: this.bindings.getNodes().some(item => item.id === sourceNodeId) ? sourceNodeId : node.id,
      targetNodeId: node.id,
      referenceNodeIds: generationInputs
        .map(input => input.nodeId)
        .filter(nodeId => this.bindings.getNodes().some(item => item.id === nodeId)),
    });
    let prepared: Awaited<ReturnType<CanvasGenerationJobsController["prepareVideoReferences"]>>;
    try {
      prepared = await this.prepareVideoReferences(generationInputs, scope, preparation.controller.signal);
    } catch (error) {
      if (isAbortError(error) || this.bindings.getProjectKey() !== projectKey) return;
      const message = publicApiError(error, "视频参考素材已失效，无法重试");
      const next = this.updateNodes(current => failGeneratedVideoTarget(current, node.id, message));
      await this.persist(next);
      this.bindings.onError(message);
      return;
    } finally {
      this.finishPreparation(preparation.id);
    }
    if (!this.preparationIsCurrent(preparation)) return;
    const references = mergeCanvasVideoReferences(
      prepared.references,
      canvasSeedanceVideoReferences(
        node.metadata?.seedanceMaterialAssets,
        node.metadata?.seedanceVolcanoAssets,
      ),
    );
    const next = this.updateNodes(current => current.map(item => item.id === node.id ? {
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
    await this.persist(next);
    if (!this.sessionCurrent(projectKey)) return;
    await this.runVideoTarget({
      targetNodeId: node.id,
      originNodeId: sourceNodeId,
      runningNodeId: node.id,
      projectKey,
      scope,
      prompt,
      config,
      references,
      referenceInputs: prepared.snapshot,
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
    const scope = this.bindings.getScope();
    const projectKey = this.bindings.getProjectKey();
    if (this.bindings.isLoading() || this.bindings.isSwitching() || !scope || !projectKey) return;
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
          model: stringValue(node.metadata?.model) || this.bindings.getImageModel(),
          size: toImageSizeValue(sizeFromNode(node)),
          quality: qualityFromNode(node),
          referenceFiles: [],
          existingJobId: jobId,
        });
      });
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
      ? [...nodes.map(node => node.id === sourceNode.id && isConfigNode ? {
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
      : nodes.map(node => node.id === sourceNode.id ? {
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
      ? [...edges, ...childIds.map((childId): CanvasEdgeData => ({
        id: this.services.createId(),
        from: sourceNode.id,
        to: childId,
      }))]
      : edges;
    this.commitGraph(pendingNodes, pendingEdges);
    this.bindings.applyNodeSelection(
      [childIds[0] || sourceNode.id],
      childIds[0] || sourceNode.id,
      true,
    );
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
    const context = await this.resolveMentionContextOrNotify(sourceNode, nodes, edges);
    if (!context) return;
    const prompt = context.prompt;
    if (!prompt.trim()) {
      this.bindings.onWarning("请先填写提示词");
      return;
    }
    const referenceNodeIds = context.inputs
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
        context.inputs,
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
    const count = imageCountFromNode(sourceNode);
    const reuseSourceNode = sourceNode.kind === "image"
      && !assetIdFromNode(sourceNode)
      && !sourceNode.imageSrc
      && !looksLikeImageSource(stringValue(sourceNode.metadata?.content))
      && !sourceNode.metadata?.isBatchRoot
      && !stringValue(sourceNode.metadata?.batchRootId);
    const rootId = reuseSourceNode ? sourceNode.id : this.services.createId();
    const childIds = count > 1
      ? Array.from({ length: count - 1 }, () => this.services.createId())
      : [];
    const targetIds = [rootId, ...childIds];
    const model = modelFromNode(sourceNode, this.bindings.getImageModel());
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
        batchModelV2: count > 1 ? true : undefined,
        assetId: undefined,
        ownAssetId: undefined,
        ownImageSrc: undefined,
        errorDetails: undefined,
      },
    };
    const childNodes = childIds.map((id, index): CanvasNodeData => {
      const position = batchChildGridPosition(rootNode, index);
      return {
        id,
        kind: "image",
        title: `生成中 ${index + 2}/${count}`,
        content: prompt,
        x: position.x,
        y: position.y,
        width: 320,
        height: 238,
        metadata: { ...commonMetadata, count: 1, batchRootId: rootId },
      };
    });
    const pendingNodes = reuseSourceNode
      ? [...this.bindings.getNodes().map(node => node.id === sourceNode.id ? rootNode : node), ...childNodes]
      : [...this.bindings.getNodes(), rootNode, ...childNodes];
    const pendingEdges = reuseSourceNode
      ? this.bindings.getEdges()
      : [...this.bindings.getEdges(), {
        id: this.services.createId(),
        from: sourceNode.id,
        to: rootId,
      }];
    this.commitGraph(pendingNodes, pendingEdges);
    this.bindings.applyNodeSelection([rootId], rootId, true);
    await this.persist(pendingNodes, pendingEdges);
    if (!this.sessionCurrent(session.projectKey)) {
      this.failIfSameProject(session.projectKey, targetIds, failGeneratedImageTarget);
      return;
    }
    const results = await Promise.all(targetIds.map(targetNodeId => this.runImageTarget({
      targetNodeId,
      originNodeId: sourceNode.id,
      runningNodeId: rootId,
      projectKey: session.projectKey,
      scope: session.scope,
      prompt,
      model,
      size,
      quality,
      referenceFiles: prepared.files,
    })));
    if (this.bindings.getProjectKey() !== session.projectKey) return;
    const succeeded = results.filter(Boolean).length;
    if (count > 1) {
      const next = this.updateNodes(current => refreshImageBatchRoot(current, rootId));
      await this.persist(next);
      if (succeeded && succeeded < count) {
        this.bindings.onWarning(`已生成 ${succeeded}/${count} 张，失败结果可单独重试`);
      }
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
    const references = mergeCanvasVideoReferences(
      prepared.references,
      canvasSeedanceVideoReferences(
        sourceNode.metadata?.seedanceMaterialAssets,
        sourceNode.metadata?.seedanceVolcanoAssets,
      ),
    );
    const reuseSourceNode = sourceNode.kind === "video" && !assetIdFromNode(sourceNode);
    const targetNodeId = reuseSourceNode ? sourceNode.id : this.services.createId();
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
        seedanceMaterialAssets: sourceNode.metadata?.seedanceMaterialAssets?.map(asset => ({ ...asset })),
        seedanceVolcanoAssets: sourceNode.metadata?.seedanceVolcanoAssets?.map(asset => ({ ...asset })),
        status: "loading",
        errorDetails: undefined,
        jobId: undefined,
        jobProgress: 0,
        mimeType: undefined,
        bytes: undefined,
      },
    };
    const pendingNodes = reuseSourceNode
      ? nodes.map(node => node.id === sourceNode.id ? targetNode : node)
      : [...nodes, targetNode];
    const pendingEdges = reuseSourceNode
      ? edges
      : [...edges, { id: this.services.createId(), from: sourceNode.id, to: targetNodeId }];
    this.commitGraph(pendingNodes, pendingEdges);
    this.bindings.applyNodeSelection([targetNodeId], targetNodeId, true);
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
    const reuseSourceNode = sourceNode.kind === "audio" && !assetIdFromNode(sourceNode);
    const targetNodeId = reuseSourceNode ? sourceNode.id : this.services.createId();
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
      ? nodes.map(node => node.id === sourceNode.id ? targetNode : node)
      : [...nodes, targetNode];
    const pendingEdges = reuseSourceNode
      ? edges
      : [...edges, { id: this.services.createId(), from: sourceNode.id, to: targetNodeId }];
    this.commitGraph(pendingNodes, pendingEdges);
    this.bindings.applyNodeSelection([targetNodeId], targetNodeId, true);
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
    const mode = generationModeFromNode(sourceNode);
    if (mode === "text") return this.generateTextFromNode(sourceNode.id);
    if (mode === "image") return this.generateImageFromNode(sourceNode.id);
    if (mode === "video") return this.generateVideoFromNode(sourceNode.id);
    return this.generateAudioFromNode(sourceNode.id);
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

  private startPreparation(input: Omit<CanvasGenerationPreparation, "id" | "controller">) {
    const preparation: CanvasGenerationPreparation = {
      ...input,
      id: this.services.createId(),
      referenceNodeIds: Array.from(new Set(input.referenceNodeIds)),
      controller: this.services.createAbortController(),
    };
    this.preparations.set(preparation.id, preparation);
    return preparation;
  }

  private finishPreparation(id: string) {
    this.preparations.delete(id);
  }

  private preparationIsCurrent(preparation: CanvasGenerationPreparation) {
    if (
      preparation.controller.signal.aborted
      || this.bindings.getProjectKey() !== preparation.projectKey
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
    this.bindings.setRunningNodeIds(running);
    this.bindings.setJobProgressByNode(current => Object.fromEntries(
      Object.entries(current).filter(([nodeId]) => running.has(nodeId)),
    ));
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
      readImageMetadata: this.services.readImageMetadata,
      readVideoMetadata: this.services.readVideoMetadata,
      readAudioMetadata: this.services.readAudioMetadata,
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
  ) {
    const scope = this.bindings.getScope();
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
    if (fetched.length) this.bindings.mergeCanvasAssets(fetched, scope);
    const assets = [
      ...currentAssets.filter(asset => asset.scope === scope),
      ...fetched.map(asset => ({ ...asset, scope })),
    ];
    return buildCanvasMentionGenerationContext(sourceNode.id, nodes, edges, ownPrompt, assets, scope);
  }

  private async resolveMentionContextOrNotify(
    sourceNode: CanvasNodeData,
    nodes: CanvasNodeData[],
    edges: CanvasEdgeData[],
  ) {
    try {
      const context = await this.resolveMentionContext(sourceNode, nodes, edges);
      if (context.missingKeys.length) {
        this.bindings.onError(`存在失效引用：${context.missingKeys.join("、")}`);
        return null;
      }
      return context;
    } catch (error) {
      this.bindings.onError(publicApiError(error, "解析画布引用失败"));
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

  private updateNodes(updater: (nodes: CanvasNodeData[]) => CanvasNodeData[]) {
    const next = updater(this.bindings.getNodes());
    this.bindings.setNodes(next);
    return next;
  }

  private commitGraph(nodes: CanvasNodeData[], edges: CanvasEdgeData[]) {
    this.bindings.setNodes(nodes);
    this.bindings.setEdges(edges);
  }

  private persist(
    nodes = this.bindings.getNodes(),
    edges = this.bindings.getEdges(),
  ) {
    return this.bindings.persistSnapshot(
      nodes,
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
