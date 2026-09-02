import type {
  CanvasEdgeData,
  CanvasNodeData,
  CanvasNodeKind,
  CanvasNodeMetadata,
  CanvasNodeStatus,
} from "./types";
import { isRecord, numberValue, stringValue } from "./value";

export function normalizeCanvasNodeKind(value: unknown): CanvasNodeKind {
  const kind = stringValue(value).toLowerCase();
  if (kind === "config") return "config";
  if (kind === "video") return "video";
  if (kind === "audio") return "audio";
  if (kind === "director") return "director";
  if (kind === "image") return "image";
  if (kind === "prompt" || kind === "note" || kind === "text") return "text";
  return "text";
}

export function legacyTypeForKind(kind: CanvasNodeKind) {
  return kind === "prompt" || kind === "note" ? "text" : kind;
}

export function nodeKindTitle(kind: CanvasNodeKind) {
  const labels: Record<CanvasNodeKind, string> = {
    prompt: "新提示词",
    text: "剧本提示词",
    note: "备注",
    image: "图片占位",
    config: "生成配置",
    video: "视频片段",
    audio: "音频轨道",
    director: "3D 导演台",
  };
  return labels[kind] || "节点";
}

export function normalizeNodeStatus(value: unknown): CanvasNodeStatus {
  return value === "loading" || value === "success" || value === "error"
    ? value
    : "idle";
}

export function looksLikeImageSource(value: string) {
  return (
    value.startsWith("data:image/") ||
    value.startsWith("blob:") ||
    /^https?:\/\//i.test(value) ||
    value.startsWith("/")
  );
}

export function assetIdFromNode(node: Pick<CanvasNodeData, "imageAssetId" | "metadata">) {
  return node.imageAssetId || stringValue(node.metadata?.assetId);
}

export function imageSrcFromNode(
  node: Pick<CanvasNodeData, "imageAssetId" | "imageSrc" | "metadata">,
  previews: Record<string, string>,
) {
  const assetId = assetIdFromNode(node);
  if (assetId && previews[assetId]) return previews[assetId];
  const candidate = node.imageSrc || stringValue(node.metadata?.content);
  return looksLikeImageSource(candidate) ? candidate : "";
}

export function normalizeCanvasNode(value: unknown): CanvasNodeData | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  if (!id) return null;

  const kind = normalizeCanvasNodeKind(
    stringValue(value.kind) || stringValue(value.type) || "text",
  );
  const position = isRecord(value.position) ? value.position : {};
  const metadata = (isRecord(value.metadata)
    ? { ...value.metadata }
    : {}) as CanvasNodeMetadata;
  const topContent = stringValue(value.content);
  const metaContent = stringValue(metadata.content);
  const metaPrompt = stringValue(metadata.prompt);
  const imageSrc =
    stringValue(value.imageSrc) ||
    stringValue(value.src) ||
    (looksLikeImageSource(metaContent) ? metaContent : "");
  const content =
    topContent || metaPrompt || (looksLikeImageSource(metaContent) ? "" : metaContent);
  const assetId =
    stringValue(value.imageAssetId) ||
    stringValue(value.assetId) ||
    stringValue(metadata.assetId);

  return {
    ...value,
    id,
    kind,
    title: stringValue(value.title) || nodeKindTitle(kind),
    content,
    x: numberValue(value.x) ?? numberValue(position.x) ?? 0,
    y: numberValue(value.y) ?? numberValue(position.y) ?? 0,
    width:
      numberValue(value.width) ||
      (kind === "video" ? 420 : kind === "image" ? 320 : 300),
    height:
      numberValue(value.height) ||
      (kind === "audio" ? 120 : kind === "image" ? 238 : 170),
    imageAssetId: assetId || undefined,
    imageSrc: imageSrc || undefined,
    metadata: {
      ...metadata,
      assetId: assetId || metadata.assetId,
      content: metadata.content ?? (imageSrc || content),
      prompt: metadata.prompt ?? content,
      status: normalizeNodeStatus(metadata.status),
    },
  };
}

export function normalizeCanvasEdge(value: unknown): CanvasEdgeData | null {
  if (!isRecord(value)) return null;
  const from = stringValue(value.from) || stringValue(value.fromNodeId);
  const to = stringValue(value.to) || stringValue(value.toNodeId);
  if (!from || !to || from === to) return null;
  return {
    ...value,
    id: stringValue(value.id) || `${from}:${to}`,
    from,
    to,
  };
}

export function serializeCanvasNode(node: CanvasNodeData) {
  const assetId = assetIdFromNode(node);
  const imageSrc = imageSrcFromNode(node, {});
  const position = isRecord(node.position) ? node.position : {};
  return {
    ...node,
    id: node.id,
    kind: node.kind,
    type: legacyTypeForKind(node.kind),
    title: node.title,
    content: node.content,
    x: node.x,
    y: node.y,
    position: { ...position, x: node.x, y: node.y },
    width: node.width,
    height: node.height,
    imageAssetId: assetId || undefined,
    imageSrc: imageSrc || undefined,
    metadata: {
      ...node.metadata,
      assetId: assetId || node.metadata?.assetId,
      content: node.metadata?.content ?? node.content,
      prompt: node.metadata?.prompt ?? node.content,
    },
  };
}

export function serializeCanvasEdge(edge: CanvasEdgeData) {
  return {
    ...edge,
    id: edge.id,
    from: edge.from,
    to: edge.to,
    fromNodeId: edge.from,
    toNodeId: edge.to,
  };
}

export function canvasAgentNodeFromCanvas(node: CanvasNodeData) {
  return {
    ...serializeCanvasNode(node),
    type: node.kind,
    kind: node.kind,
    metadata: { ...node.metadata },
  };
}
