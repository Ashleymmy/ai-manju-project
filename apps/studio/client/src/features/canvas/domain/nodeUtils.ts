import {
  isSeedanceVideoModel,
  normalizeVideoGenerationConfig,
  type VideoGenerationConfig,
  type VideoProvider,
} from "@/features/video";
import { normalizeCanvasAudioGenerationConfig } from "./audioConfig";
import {
  canvasTextComposerValue,
  canvasTextDisplayValue,
  isGeneratedCanvasText,
} from "./text";
import type { CanvasGenerationInput } from "./connections";
import type { CanvasVideoReferenceSnapshot } from "./video";
import type {
  CanvasEdgeData,
  CanvasGenerationMode,
  CanvasImageReferenceSnapshot,
  CanvasNodeData,
  CanvasNodeKind,
  ImageQualityValue,
  ImageSizeValue,
} from "./types";
import { assetIdFromNode, looksLikeImageSource } from "./nodes";
import { isRecord, stringValue } from "./value";
import { workspaceScopeValue } from "./workspace";

export const VIDEO_SUBMODES = [
  { value: "text", label: "文生视频" },
  { value: "reference", label: "全能参考" },
  { value: "edit", label: "视频编辑" },
  { value: "extend", label: "视频延长" },
  { value: "first-last", label: "首位帧" },
  { value: "camera", label: "运镜" },
] as const;
export type VideoSubMode = (typeof VIDEO_SUBMODES)[number]["value"];

export function nodeKindBadge(kind: CanvasNodeKind) {
  const labels: Record<CanvasNodeKind, string> = {
    prompt: "PROMPT",
    text: "TEXT",
    note: "NOTE",
    image: "IMAGE",
    config: "CONFIG",
    video: "VIDEO",
    audio: "AUDIO",
    director: "DIRECTOR",
  };
  return labels[kind] || "NODE";
}

export function editableNodeKind(kind: CanvasNodeKind) {
  return kind !== "image" && kind !== "director";
}

export function promptTextFromNode(node: CanvasNodeData) {
  if (node.kind === "text") return canvasTextComposerValue(node);
  const metadataPrompt = stringValue(node.metadata?.prompt);
  if (metadataPrompt) return metadataPrompt;
  if (node.content && !looksLikeImageSource(node.content)) return node.content;
  const metadataContent = stringValue(node.metadata?.content);
  return looksLikeImageSource(metadataContent) ? "" : metadataContent;
}

export function nodeEditorTextFromNode(node: CanvasNodeData) {
  return isGeneratedCanvasText(node) ? canvasTextDisplayValue(node) : promptTextFromNode(node);
}

export function nodeInlineEditPlaceholder(kind: CanvasNodeKind) {
  if (kind === "config") return "双击编辑配置";
  if (kind === "text") return "双击编辑文本";
  if (kind === "video") return "双击编辑视频提示";
  if (kind === "audio") return "双击编辑音频提示";
  if (kind === "note") return "双击编辑备注";
  return "双击编辑节点内容";
}

export function videoSubModeFromNode(node: CanvasNodeData): VideoSubMode {
  const value = stringValue(node.metadata?.videoSubMode);
  return VIDEO_SUBMODES.some((sub) => sub.value === value) ? value as VideoSubMode : "text";
}

export function videoSubModePlaceholder(mode: VideoSubMode) {
  switch (mode) {
    case "reference":
      return "输入文字或 @ 参考内容，自由组合图、文、音、视频元素。例如：@图片1 模仿 @视频1 的动作，音色参考 @音频1。";
    case "edit":
      return "描述你想要对视频进行的编辑操作，例如：将背景替换为海滩场景。";
    case "extend":
      return "描述视频延长的画面走向。例如：延长 @视频1，镜头继续向前推进。";
    case "first-last":
      return "上传首帧与尾帧图片后，描述中间的运动过程…";
    case "camera":
      return "描述运镜方式，例如：镜头缓慢推近主体，轻微环绕…";
    default:
      return "请输入视频描述…";
  }
}

export function modelFromNode(node: CanvasNodeData, fallback: string) {
  return stringValue(node.metadata?.model) || fallback;
}

export function defaultGenerationModeForKind(kind: CanvasNodeKind): CanvasGenerationMode {
  if (kind === "text") return "text";
  if (kind === "video") return "video";
  if (kind === "audio") return "audio";
  return "image";
}

export function generationModeFromNode(node: CanvasNodeData): CanvasGenerationMode {
  const mode = stringValue(node.metadata?.generationMode);
  if (mode === "text" || mode === "image" || mode === "video" || mode === "audio") return mode;
  return defaultGenerationModeForKind(node.kind);
}

export function generationModeLabel(mode: CanvasGenerationMode) {
  return ({ text: "文本", image: "图片", video: "视频", audio: "音频" } as const)[mode];
}

export function sizeFromNode(node: CanvasNodeData): string {
  return stringValue(node.metadata?.size).toLowerCase() || "auto";
}

export function toImageSizeValue(size: string): ImageSizeValue {
  return size === "1:1" || size === "16:9" || size === "9:16" || size === "2:1" || size === "auto" ? size : "auto";
}

export function qualityFromNode(node: CanvasNodeData): ImageQualityValue {
  const value = stringValue(node.metadata?.quality).toLowerCase();
  return value === "low" || value === "medium" || value === "high" || value === "auto" ? value : "auto";
}

export function imageCountFromNode(node: CanvasNodeData) {
  const value = typeof node.metadata?.count === "number" ? node.metadata.count : Number(node.metadata?.count || 1);
  return Math.max(1, Math.min(15, Number.isFinite(value) ? Math.floor(value) : 1));
}

export function videoConfigFromNode(node: CanvasNodeData, fallbackModel: string): VideoGenerationConfig {
  return normalizeVideoGenerationConfig({
    model: modelFromNode(node, fallbackModel),
    size: stringValue(node.metadata?.size) || "auto",
    resolution: stringValue(node.metadata?.resolution) || "720p",
    seconds: stringValue(node.metadata?.seconds) || "5",
    generateAudio: Boolean(node.metadata?.generateAudio),
    watermark: Boolean(node.metadata?.watermark),
  });
}

export function audioConfigFromNode(node: CanvasNodeData, fallbackModel: string) {
  return normalizeCanvasAudioGenerationConfig({
    model: modelFromNode(node, fallbackModel),
    voice: stringValue(node.metadata?.audioVoice) || "alloy",
    format: stringValue(node.metadata?.audioFormat) || "mp3",
    speed: stringValue(node.metadata?.audioSpeed) || "1",
    instructions: stringValue(node.metadata?.audioInstructions),
  });
}

export function videoProviderFromNode(node: CanvasNodeData, model: string): VideoProvider {
  const provider = stringValue(node.metadata?.videoProvider);
  if (provider === "openai" || provider === "seedance") return provider;
  return isSeedanceVideoModel(model) ? "seedance" : "openai";
}

export function canvasVideoReferenceSnapshot(value: unknown): CanvasVideoReferenceSnapshot {
  if (!isRecord(value) || !Array.isArray(value.items)) return { items: [] };
  return { items: value.items.filter(isRecord) as CanvasVideoReferenceSnapshot["items"] };
}

export function canvasGenerationInputsFromVideoSnapshot(
  snapshot: CanvasVideoReferenceSnapshot,
  nodes: readonly CanvasNodeData[],
): CanvasGenerationInput[] {
  return snapshot.items.map((item) => {
    if (item.type === "text") {
      return {
        nodeId: item.nodeId,
        type: "text" as const,
        title: item.title,
        text: item.text,
      };
    }
    const node = nodes.find((candidate) => candidate.id === item.nodeId);
    const assetId = item.assetId || (node ? assetIdFromNode(node) : undefined);
    const content = !assetId && node
      ? node.imageSrc || stringValue(node.metadata?.content) || undefined
      : undefined;
    return {
      nodeId: item.nodeId,
      type: item.type,
      title: item.title,
      assetId,
      assetScope: item.scope || (node ? workspaceScopeValue(node.metadata?.assetScope) : undefined),
      content: content && isReadableMediaSource(content) ? content : undefined,
    };
  });
}

export function mediaKindFromNode(node: CanvasNodeData): "image" | "video" | "audio" {
  if (node.kind === "video" || node.kind === "audio") return node.kind;
  const mimeType = stringValue(node.metadata?.mimeType).toLowerCase();
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "image";
}

export function assetKindFromFile(file: File): "image" | "video" | "audio" | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return null;
}

export function mediaKindLabel(kind: "image" | "video" | "audio") {
  if (kind === "video") return "视频";
  if (kind === "audio") return "音频";
  return "图片";
}

export function defaultMediaMimeType(kind: "image" | "video" | "audio") {
  if (kind === "video") return "video/mp4";
  if (kind === "audio") return "audio/mpeg";
  return "image/png";
}

export function mediaFileName(name: string, kind: "image" | "video" | "audio", contentType: string) {
  if (kind === "image") return imageFileName(name, contentType);
  if (kind === "video") return videoFileName(name, contentType);
  const clean = name.trim().replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80) || "canvas-audio";
  return /\.(mp3|wav|opus|aac|flac)$/i.test(clean) ? clean : `${clean}.${audioFileExtension(contentType)}`;
}

export function videoFileName(name: string, contentType: string) {
  const clean = name.trim().replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80) || "generated-video";
  if (/\.(mp4|mov|webm)$/i.test(clean)) return clean;
  const extension = contentType.includes("quicktime") ? "mov" : contentType.includes("webm") ? "webm" : "mp4";
  return `${clean}.${extension}`;
}

export function audioFileExtension(mimeType: string) {
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("opus")) return "opus";
  if (mimeType.includes("aac")) return "aac";
  if (mimeType.includes("flac")) return "flac";
  if (mimeType.includes("pcm")) return "pcm";
  return "mp3";
}

export function isReadableMediaSource(value: string) {
  return /^(blob:|data:|https?:\/\/)/i.test(value.trim());
}

export function imageReferenceSnapshots(value: unknown): CanvasImageReferenceSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const assetId = stringValue(item.assetId);
    if (!assetId) return [];
    return [{
      nodeId: stringValue(item.nodeId),
      title: stringValue(item.title) || "参考图",
      assetId,
      name: stringValue(item.name) || "reference.png",
      contentType: stringValue(item.contentType) || "image/png",
    }];
  });
}

export function imageFileName(title: string, contentType: string) {
  const clean = title.trim().replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80) || "image";
  if (/\.(png|jpe?g|webp|gif)$/i.test(clean)) return clean;
  const extension = contentType.includes("jpeg") ? "jpg" : contentType.includes("webp") ? "webp" : contentType.includes("gif") ? "gif" : "png";
  return `${clean}.${extension}`;
}

export function isAbortError(error: unknown) {
  if (!isRecord(error)) return false;
  return stringValue(error.name) === "AbortError"
    || stringValue(error.message) === "请求超时或已取消";
}

export function cloneCanvasNodes(nodes: CanvasNodeData[]) {
  return nodes.map((node) => ({ ...node, metadata: node.metadata ? { ...node.metadata } : undefined }));
}

export function cloneCanvasEdges(edges: CanvasEdgeData[]) {
  return edges.map((edge) => ({ ...edge }));
}
