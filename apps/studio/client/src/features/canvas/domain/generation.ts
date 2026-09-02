import type { Asset } from "@/entities/asset";
import type { GeneratedImage } from "@/features/image";
import type { VideoGenerationConfig, VideoGenerationTask } from "@/features/video";
import type { WorkspaceScope } from "@/shared/config/workspace";
import type { CanvasVideoReferenceSnapshot } from "./video";
import { videoResultPersistentMetadata } from "./video";
import { refreshImageBatchRoot } from "./batch";
import type { CanvasNodeData } from "./types";
import { stringValue } from "./value";
import {
  canvasAudioMimeType,
  normalizeCanvasAudioGenerationConfig,
} from "./audioConfig";

export function completeGeneratedAudioTarget(
  nodes: CanvasNodeData[],
  targetNodeId: string,
  asset: Asset,
  prompt: string,
  config: ReturnType<typeof normalizeCanvasAudioGenerationConfig>,
  sourceNodeId: string,
  scope: WorkspaceScope,
) {
  return nodes.map((node) => node.id === targetNodeId ? {
    ...node,
    kind: "audio" as const,
    title: asset.name || "生成音频",
    content: prompt,
    imageAssetId: undefined,
    imageSrc: undefined,
    metadata: {
      ...node.metadata,
      assetId: asset.id,
      assetScope: scope,
      content: prompt,
      prompt,
      generationMode: "audio" as const,
      model: config.model,
      audioVoice: config.voice,
      audioFormat: config.format,
      audioSpeed: config.speed,
      audioInstructions: config.instructions,
      sourceNodeId,
      status: "success" as const,
      errorDetails: undefined,
      jobId: undefined,
      jobProgress: undefined,
      mimeType: asset.content_type || canvasAudioMimeType(config.format),
      bytes: asset.size,
    },
  } : node);
}

export function failGeneratedAudioTarget(nodes: CanvasNodeData[], targetNodeId: string, message: string) {
  return nodes.map((node) => node.id === targetNodeId ? {
    ...node,
    title: "音频生成失败",
    metadata: {
      ...node.metadata,
      generationMode: "audio" as const,
      status: "error" as const,
      errorDetails: message,
      jobId: undefined,
      jobProgress: undefined,
    },
  } : node);
}

export function completeGeneratedVideoTarget(
  nodes: CanvasNodeData[],
  targetNodeId: string,
  asset: Asset,
  persistentResult: ReturnType<typeof videoResultPersistentMetadata>,
  prompt: string,
  config: VideoGenerationConfig,
  task: VideoGenerationTask,
  sourceNodeId: string,
  referenceInputs: CanvasVideoReferenceSnapshot | undefined,
  scope: WorkspaceScope,
) {
  return nodes.map((node) => node.id === targetNodeId ? {
    ...node,
    kind: "video" as const,
    title: asset.name || "生成视频",
    content: prompt,
    imageAssetId: undefined,
    imageSrc: undefined,
    metadata: {
      ...node.metadata,
      assetId: persistentResult.assetId || asset.id,
      assetScope: persistentResult.scope || scope,
      content: prompt,
      prompt,
      generationMode: "video" as const,
      videoProvider: task.provider,
      model: task.model || config.model,
      size: config.size,
      resolution: config.resolution,
      seconds: config.seconds,
      generateAudio: config.generateAudio,
      watermark: config.watermark,
      sourceNodeId,
      videoReferenceInputs: referenceInputs,
      status: "success" as const,
      errorDetails: undefined,
      jobId: undefined,
      jobProgress: undefined,
      mimeType: persistentResult.mimeType || asset.content_type || "video/mp4",
      bytes: persistentResult.bytes || asset.size,
    },
  } : node);
}

export function failGeneratedVideoTarget(nodes: CanvasNodeData[], targetNodeId: string, message: string) {
  return nodes.map((node) => node.id === targetNodeId ? {
    ...node,
    title: "视频生成失败",
    metadata: {
      ...node.metadata,
      generationMode: "video" as const,
      status: "error" as const,
      errorDetails: message,
      jobId: undefined,
      jobProgress: undefined,
    },
  } : node);
}

export function resolveGeneratedNode(nodes: CanvasNodeData[], childId: string, generated: GeneratedImage | undefined, prompt: string) {
  return nodes.map((node) => {
    if (node.id !== childId) return node;
    return {
      ...node,
      title: generated?.name || "生成图片",
      imageAssetId: generated?.assetId,
      imageSrc: generated?.assetId ? undefined : generated?.src,
      metadata: {
        ...node.metadata,
        assetId: generated?.assetId,
        // 批次根节点自身也是生成目标：把"自己的"结果单独留档，避免主图切换后被覆盖丢失
        ...(node.metadata?.isBatchRoot ? { ownAssetId: generated?.assetId, ownImageSrc: generated?.assetId ? undefined : generated?.src } : {}),
        content: generated?.assetId ? prompt : generated?.src || prompt,
        prompt,
        status: generated ? "success" as const : "error" as const,
        jobId: undefined,
        jobProgress: undefined,
        errorDetails: generated ? undefined : "任务已完成，但没有返回图片",
        mimeType: generated?.contentType,
      },
    };
  });
}

export function completeGeneratedImageTarget(nodes: CanvasNodeData[], targetNodeId: string, generated: GeneratedImage, prompt: string) {
  const next = resolveGeneratedNode(nodes, targetNodeId, generated, prompt);
  const target = next.find((node) => node.id === targetNodeId);
  // 子节点完成刷所属根；根节点（基底）自身完成也触发聚合
  const rootId = stringValue(target?.metadata?.batchRootId) || (target?.metadata?.isBatchRoot ? target.id : "");
  if (!rootId) return next;
  return refreshImageBatchRoot(next, rootId);
}

export function failGeneratedImageTarget(nodes: CanvasNodeData[], targetNodeId: string, message: string) {
  let next = nodes.map((node) => node.id === targetNodeId ? {
    ...node,
    title: "生成失败",
    metadata: {
      ...node.metadata,
      status: "error" as const,
      errorDetails: message,
      jobId: undefined,
      jobProgress: undefined,
    },
  } : node);
  const target = next.find((node) => node.id === targetNodeId);
  const rootId = stringValue(target?.metadata?.batchRootId) || (target?.metadata?.isBatchRoot ? target.id : "");
  if (rootId) next = refreshImageBatchRoot(next, rootId);
  return next;
}

export function failGeneratedTextTarget(nodes: CanvasNodeData[], targetNodeId: string, message: string) {
  return nodes.map((node) => node.id === targetNodeId ? {
    ...node,
    title: "文本生成失败",
    metadata: {
      ...node.metadata,
      generationMode: "text" as const,
      status: "error" as const,
      errorDetails: message,
      jobId: undefined,
      jobProgress: undefined,
    },
  } : node);
}
