export type DirectorCanvasAsset = {
  id: string;
  name?: string;
  size?: number;
  content_type?: string;
};

export type DirectorCanvasFrame = {
  width?: number;
  height?: number;
};

export type DirectorCanvasIdentity = {
  instanceId: string;
  canvasId: string;
  nodeId: string;
  outputKey: string;
  projectFingerprint: string;
  activeCameraId: string;
  progress: number;
  scope: "personal" | "team";
};

export function canvasDirectorOutputExists(snapshot: Record<string, unknown>, nodeId: string, outputKey: string) {
  const nodes = Array.isArray(snapshot.nodes) ? snapshot.nodes.filter(isRecord) : [];
  const directorNode = nodes.find((node) => stringValue(node.id) === nodeId && nodeKind(node) === "director");
  if (!directorNode) throw new Error("未找到对应的导演台画布节点");
  const metadata = isRecord(directorNode.metadata) ? directorNode.metadata : {};
  return stringArray(metadata.directorOutputKeys).includes(outputKey);
}

export function applyDirectorFrameToCanvasSnapshot(input: {
  snapshot: Record<string, unknown>;
  asset: DirectorCanvasAsset;
  frame: DirectorCanvasFrame;
  identity: DirectorCanvasIdentity;
  createNodeId: () => string;
  createEdgeId: () => string;
  now: string;
}) {
  const sourceNodes = Array.isArray(input.snapshot.nodes) ? input.snapshot.nodes : [];
  const nodes = sourceNodes.filter(isRecord);
  const directorIndex = nodes.findIndex((node) => stringValue(node.id) === input.identity.nodeId && nodeKind(node) === "director");
  if (directorIndex < 0) throw new Error("未找到对应的导演台画布节点");
  const directorNode = nodes[directorIndex];
  const metadata = isRecord(directorNode.metadata) ? { ...directorNode.metadata } : {};
  const outputKeys = stringArray(metadata.directorOutputKeys);
  if (outputKeys.includes(input.identity.outputKey)) {
    return { duplicate: true, snapshot: input.snapshot, outputNodeId: "" };
  }

  const revision = Math.max(0, numberValue(metadata.directorRevision)) + 1;
  const outputNodeId = input.createNodeId();
  const directorPosition = nodePosition(directorNode);
  const directorWidth = positiveNumber(directorNode.width, 300);
  const directorHeight = positiveNumber(directorNode.height, 170);
  const outputSize = fitNodeSize(input.frame.width, input.frame.height, 340, 240);
  const outputIndex = outputKeys.length;
  const outputNode = {
    id: outputNodeId,
    kind: "image",
    type: "image",
    title: `${stringValue(directorNode.title) || "3D 导演台"} · 机位 v${String(revision).padStart(3, "0")}`,
    content: "",
    x: directorPosition.x + directorWidth + 96,
    y: directorPosition.y + outputIndex * (outputSize.height + 20),
    position: {
      x: directorPosition.x + directorWidth + 96,
      y: directorPosition.y + outputIndex * (outputSize.height + 20),
    },
    width: outputSize.width,
    height: outputSize.height,
    imageAssetId: input.asset.id,
    metadata: {
      content: "",
      prompt: "",
      status: "success",
      generationMode: "image",
      generationType: "director",
      sourceNodeId: input.identity.nodeId,
      directorSourceNodeId: input.identity.nodeId,
      directorOutputKey: input.identity.outputKey,
      assetId: input.asset.id,
      assetScope: input.identity.scope,
      mimeType: input.asset.content_type || "image/png",
      bytes: input.asset.size,
      naturalWidth: input.frame.width,
      naturalHeight: input.frame.height,
    },
  };

  const updatedDirector = {
    ...directorNode,
    imageAssetId: input.asset.id,
    metadata: {
      ...metadata,
      assetId: input.asset.id,
      assetScope: input.identity.scope,
      status: "success",
      mimeType: input.asset.content_type || "image/png",
      bytes: input.asset.size,
      naturalWidth: input.frame.width,
      naturalHeight: input.frame.height,
      directorInstanceId: input.identity.instanceId,
      directorCanvasId: input.identity.canvasId,
      directorProjectFingerprint: input.identity.projectFingerprint,
      directorRevision: revision,
      directorPreviewAssetId: input.asset.id,
      directorOutputKeys: [...outputKeys, input.identity.outputKey],
      directorOutputNodeIds: [...stringArray(metadata.directorOutputNodeIds), outputNodeId],
      directorUpdatedAt: input.now,
    },
  };
  const nextNodes = nodes.map((node, index) => index === directorIndex ? updatedDirector : node).concat(outputNode);
  const sourceEdges = (Array.isArray(input.snapshot.edges) ? input.snapshot.edges : Array.isArray(input.snapshot.connections) ? input.snapshot.connections : []).filter(isRecord);
  const hasConnection = sourceEdges.some((edge) => edgeFrom(edge) === input.identity.nodeId && edgeTo(edge) === outputNodeId);
  const nextEdges = hasConnection ? sourceEdges : [...sourceEdges, {
    id: input.createEdgeId(),
    from: input.identity.nodeId,
    to: outputNodeId,
    fromNodeId: input.identity.nodeId,
    toNodeId: outputNodeId,
  }];
  return {
    duplicate: false,
    outputNodeId,
    snapshot: {
      ...input.snapshot,
      nodes: nextNodes,
      edges: nextEdges,
      connections: nextEdges,
      updated_at: input.now,
    },
  };
}

function fitNodeSize(width: number | undefined, height: number | undefined, maxWidth: number, maxHeight: number) {
  if (!width || !height || width <= 0 || height <= 0) return { width: maxWidth, height: maxHeight };
  const scale = Math.min(maxWidth / width, maxHeight / height);
  return { width: Math.max(120, Math.round(width * scale)), height: Math.max(90, Math.round(height * scale)) };
}

function nodePosition(node: Record<string, unknown>) {
  const position = isRecord(node.position) ? node.position : {};
  return { x: numberValue(node.x, numberValue(position.x)), y: numberValue(node.y, numberValue(position.y)) };
}

function nodeKind(node: Record<string, unknown>) {
  return (stringValue(node.kind) || stringValue(node.type)).toLowerCase();
}

function edgeFrom(edge: Record<string, unknown>) {
  return stringValue(edge.from) || stringValue(edge.fromNodeId);
}

function edgeTo(edge: Record<string, unknown>) {
  return stringValue(edge.to) || stringValue(edge.toNodeId);
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveNumber(value: unknown, fallback: number) {
  const number = numberValue(value, fallback);
  return number > 0 ? number : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
