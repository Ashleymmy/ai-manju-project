export type CanvasFragmentNode = {
  id: string;
  kind: string;
  title: string;
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
  imageAssetId?: string;
  imageSrc?: string;
  metadata?: Record<string, unknown>;
};

export type CanvasFragmentEdge = {
  id: string;
  from: string;
  to: string;
};

export type CanvasFragmentGroup = Record<string, unknown> & {
  id: string;
  nodeIds: string[];
  position?: { x: number; y: number };
  x?: number;
  y?: number;
};

export type CanvasFragmentPackage = {
  version: 1;
  source_project_id: string;
  source_project_title: string;
  workspace_id?: string;
  scope: "personal" | "team";
  nodes: CanvasFragmentNode[];
  connections: CanvasFragmentEdge[];
  groups?: CanvasFragmentGroup[];
  omitted_external_connections: CanvasFragmentEdge[];
};

export type CanvasFragmentManifestRow = {
  asset_id: string;
  name: string;
  type: "image" | "video" | "audio";
  content_type: string;
  archive_path?: string;
  category?: string;
  tags?: string[];
};

export type CanvasFragmentAsset = {
  id: string;
  type: "image" | "video" | "audio";
  name: string;
  url?: string;
  content_type?: string;
};

export type ProductionCanvasFragmentPackage = Omit<
  CanvasFragmentPackage,
  "nodes" | "connections" | "omitted_external_connections"
> & {
  nodes: Array<Omit<CanvasFragmentNode, "kind" | "x" | "y"> & {
    type: string;
    position: { x: number; y: number };
  }>;
  connections: Array<{ id: string; fromNodeId: string; toNodeId: string }>;
  omitted_external_connections: Array<{ id: string; fromNodeId: string; toNodeId: string }>;
};

export function parseCanvasFragmentPackage(value: unknown): CanvasFragmentPackage {
  if (!value || typeof value !== "object") throw new Error("画布选区包格式不受支持");
  const source = value as Record<string, unknown>;
  if (source.version !== 1 || !Array.isArray(source.nodes) || !source.nodes.length || !Array.isArray(source.connections)) {
    throw new Error("画布选区包格式不受支持");
  }
  const nodes = source.nodes.map((item) => normalizeFragmentNode(item));
  const connections = source.connections.map((item) => normalizeFragmentEdge(item));
  const omitted = Array.isArray(source.omitted_external_connections)
    ? source.omitted_external_connections.map((item) => normalizeFragmentEdge(item))
    : [];
  const groups = Array.isArray(source.groups)
    ? source.groups.map((item) => normalizeFragmentGroup(item))
    : [];
  return {
    version: 1,
    source_project_id: stringValue(source.source_project_id),
    source_project_title: stringValue(source.source_project_title) || "未命名画布",
    workspace_id: stringValue(source.workspace_id) || undefined,
    scope: source.scope === "team" ? "team" : "personal",
    nodes,
    connections,
    groups,
    omitted_external_connections: omitted,
  };
}

export function buildCanvasFragmentPackage(input: {
  nodes: readonly CanvasFragmentNode[];
  edges: readonly CanvasFragmentEdge[];
  groups?: readonly CanvasFragmentGroup[];
  selectedIds: ReadonlySet<string>;
  projectId: string;
  projectTitle: string;
  workspaceId?: string;
  scope: "personal" | "team";
}): CanvasFragmentPackage {
  const nodes = input.nodes.filter((node) => input.selectedIds.has(node.id)).map(cloneFragmentNode);
  const connections = input.edges.filter((edge) => input.selectedIds.has(edge.from) && input.selectedIds.has(edge.to)).map((edge) => ({ ...edge }));
  const omitted = input.edges.filter((edge) => input.selectedIds.has(edge.from) !== input.selectedIds.has(edge.to)).map((edge) => ({ ...edge }));
  const groups = (input.groups || []).flatMap((group) => {
    const nodeIds = group.nodeIds.filter((id) => input.selectedIds.has(id));
    return nodeIds.length ? [{ ...group, nodeIds }] : [];
  });
  return {
    version: 1,
    source_project_id: input.projectId,
    source_project_title: input.projectTitle,
    workspace_id: input.workspaceId,
    scope: input.scope,
    nodes,
    connections,
    groups,
    omitted_external_connections: omitted,
  };
}

export function serializeCanvasFragmentPackage(fragment: CanvasFragmentPackage): ProductionCanvasFragmentPackage {
  return {
    ...fragment,
    nodes: fragment.nodes.map(({ kind, x, y, ...node }) => ({
      ...node,
      type: kind,
      position: { x, y },
    })),
    connections: fragment.connections.map((edge) => ({
      id: edge.id,
      fromNodeId: edge.from,
      toNodeId: edge.to,
    })),
    omitted_external_connections: fragment.omitted_external_connections.map((edge) => ({
      id: edge.id,
      fromNodeId: edge.from,
      toNodeId: edge.to,
    })),
  };
}

export function canvasFragmentAssetIds(nodes: readonly CanvasFragmentNode[]) {
  const ids = new Set<string>();
  const inspect = (value: unknown, key = "") => {
    if (typeof value === "string") {
      if ((key === "assetId" || key === "imageAssetId") && value) ids.add(value);
      const mentionPattern = /@\[asset:([^\]]+)\]/g;
      let mention = mentionPattern.exec(value);
      while (mention) {
        ids.add(mention[1]);
        mention = mentionPattern.exec(value);
      }
      const assetUri = value.match(/^asset:\/\/([^/?#]+)/)?.[1];
      if (assetUri) ids.add(assetUri);
      const contentUrl = value.match(/\/api\/assets\/([A-Za-z0-9_-]+)\/content(?:[?#]|$)/)?.[1];
      if (contentUrl) ids.add(contentUrl);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => inspect(item, key));
      return;
    }
    if (!value || typeof value !== "object") return;
    Object.entries(value).forEach(([childKey, child]) => inspect(child, childKey));
  };
  nodes.forEach((node) => inspect(node));
  return Array.from(ids);
}

export function importCanvasFragmentPackage(input: {
  fragment: CanvasFragmentPackage;
  assets: ReadonlyMap<string, CanvasFragmentAsset>;
  scope: "personal" | "team";
  center: { x: number; y: number };
  createId: (kind: string, index: number) => string;
  createEdgeId: (index: number) => string;
  createGroupId: (index: number) => string;
}) {
  const bounds = canvasFragmentBounds(input.fragment.nodes);
  const dx = input.center.x - (bounds.left + bounds.right) / 2;
  const dy = input.center.y - (bounds.top + bounds.bottom) / 2;
  const nodeIds = new Map(input.fragment.nodes.map((node, index) => [node.id, input.createId(node.kind, index)]));
  const nodes = input.fragment.nodes.map((source) => rewriteFragmentNode(source, input.assets, nodeIds, input.scope, dx, dy));
  const validIds = new Set(nodes.map((node) => node.id));
  const connections = input.fragment.connections.flatMap((edge, index) => {
    const from = nodeIds.get(edge.from) || "";
    const to = nodeIds.get(edge.to) || "";
    return validIds.has(from) && validIds.has(to) ? [{ id: input.createEdgeId(index), from, to }] : [];
  });
  const groups = (input.fragment.groups || []).flatMap((group, index) => {
    const groupNodeIds = group.nodeIds.map((id) => nodeIds.get(id)).filter((id): id is string => Boolean(id));
    if (!groupNodeIds.length) return [];
    const position = group.position ? { x: group.position.x + dx, y: group.position.y + dy } : undefined;
    return [{
      ...group,
      id: input.createGroupId(index),
      nodeIds: groupNodeIds,
      ...(position ? { position } : {}),
      ...(typeof group.x === "number" ? { x: group.x + dx } : {}),
      ...(typeof group.y === "number" ? { y: group.y + dy } : {}),
    }];
  });
  return { nodes, connections, groups, nodeIds };
}

export function canvasFragmentBounds(nodes: readonly CanvasFragmentNode[]) {
  return nodes.reduce((bounds, node) => ({
    left: Math.min(bounds.left, node.x),
    top: Math.min(bounds.top, node.y),
    right: Math.max(bounds.right, node.x + node.width),
    bottom: Math.max(bounds.bottom, node.y + node.height),
  }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
}

function cloneFragmentNode(node: CanvasFragmentNode): CanvasFragmentNode {
  return {
    ...node,
    metadata: node.metadata ? structuredClone(node.metadata) : undefined,
  };
}

function rewriteFragmentNode(
  source: CanvasFragmentNode,
  assets: ReadonlyMap<string, CanvasFragmentAsset>,
  nodeIds: ReadonlyMap<string, string>,
  scope: "personal" | "team",
  dx: number,
  dy: number,
): CanvasFragmentNode {
  const oldAssetId = source.imageAssetId
    || stringValue(source.metadata?.assetId)
    || assetIdFromReference(stringValue(source.metadata?.storageKey))
    || assetIdFromReference(stringValue(source.metadata?.content));
  const directAsset = oldAssetId ? assets.get(oldAssetId) : undefined;
  const metadata = rewriteFragmentValue(structuredClone(source.metadata || {}), assets, nodeIds, "metadata") as Record<string, unknown>;
  if (directAsset) {
    metadata.assetId = directAsset.id;
    metadata.assetScope = scope;
    metadata.content = "";
    metadata.mimeType = directAsset.content_type || metadata.mimeType;
  }
  metadata.jobId = undefined;
  metadata.jobProgress = undefined;
  if (typeof metadata.directorInstanceId === "string") {
    metadata.directorInstanceId = `director-${crypto.randomUUID()}`;
    metadata.directorProjectFingerprint = undefined;
    metadata.directorRevision = 0;
    metadata.directorPreviewAssetId = undefined;
    metadata.directorOutputKeys = [];
    metadata.directorOutputNodeIds = [];
    metadata.directorUpdatedAt = undefined;
  }
  return {
    ...source,
    id: nodeIds.get(source.id) || source.id,
    x: source.x + dx,
    y: source.y + dy,
    content: rewriteFragmentString(source.content, assets, nodeIds),
    imageAssetId: directAsset?.id || (source.imageAssetId ? assets.get(source.imageAssetId)?.id || source.imageAssetId : undefined),
    imageSrc: directAsset ? undefined : rewriteFragmentString(source.imageSrc || "", assets, nodeIds) || undefined,
    metadata,
  };
}

function rewriteFragmentValue(
  value: unknown,
  assets: ReadonlyMap<string, CanvasFragmentAsset>,
  nodeIds: ReadonlyMap<string, string>,
  key: string,
): unknown {
  if (typeof value === "string") {
    if (assetIdKey(key) && assets.has(value)) return assets.get(value)!.id;
    if (nodeIdKey(key) && nodeIds.has(value)) return nodeIds.get(value)!;
    return rewriteFragmentString(value, assets, nodeIds);
  }
  if (Array.isArray(value)) return value.map((item) => rewriteFragmentValue(item, assets, nodeIds, key));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, rewriteFragmentValue(child, assets, nodeIds, childKey)]));
}

function rewriteFragmentString(value: string, assets: ReadonlyMap<string, CanvasFragmentAsset>, nodeIds: ReadonlyMap<string, string>) {
  let next = value.replace(/@\[asset:([^\]]+)\]/g, (raw, id: string) => assets.has(id) ? `@[asset:${assets.get(id)!.id}]` : raw);
  next = next.replace(/@\[node:([^\]]+)\]/g, (raw, id: string) => nodeIds.has(id) ? `@[node:${nodeIds.get(id)!}]` : raw);
  const uriId = next.match(/^asset:\/\/([^/?#]+)/)?.[1];
  if (uriId && assets.has(uriId)) next = `asset://${assets.get(uriId)!.id}`;
  const contentId = next.match(/\/api\/assets\/([A-Za-z0-9_-]+)\/content(?:[?#]|$)/)?.[1];
  if (contentId && assets.has(contentId)) next = assets.get(contentId)!.url || `asset://${assets.get(contentId)!.id}`;
  return next;
}

function assetIdKey(key: string) {
  return key === "assetId" || key === "imageAssetId" || key === "parentAssetIds";
}

function nodeIdKey(key: string) {
  return key === "nodeId"
    || key === "sourceNodeId"
    || key === "batchRootId"
    || key === "batchChildIds"
    || key === "primaryImageId"
    || key === "targetNodeId"
    || key === "directorOutputNodeIds";
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeFragmentNode(value: unknown): CanvasFragmentNode {
  if (!value || typeof value !== "object") throw new Error("画布选区包包含无效节点");
  const node = value as Record<string, unknown>;
  const position = node.position && typeof node.position === "object" ? node.position as Record<string, unknown> : {};
  const kind = stringValue(node.kind) || stringValue(node.type);
  const id = stringValue(node.id);
  if (!id || !kind) throw new Error("画布选区包包含无效节点");
  const metadata = node.metadata && typeof node.metadata === "object" && !Array.isArray(node.metadata)
    ? structuredClone(node.metadata as Record<string, unknown>)
    : undefined;
  return {
    id,
    kind,
    title: stringValue(node.title) || kind,
    content: stringValue(node.content) || stringValue(metadata?.content),
    x: numberValue(node.x, numberValue(position.x, 0)),
    y: numberValue(node.y, numberValue(position.y, 0)),
    width: Math.max(1, numberValue(node.width, 280)),
    height: Math.max(1, numberValue(node.height, 180)),
    imageAssetId: stringValue(node.imageAssetId) || stringValue(metadata?.assetId) || undefined,
    imageSrc: stringValue(node.imageSrc) || undefined,
    metadata,
  };
}

function normalizeFragmentEdge(value: unknown): CanvasFragmentEdge {
  if (!value || typeof value !== "object") throw new Error("画布选区包包含无效连线");
  const edge = value as Record<string, unknown>;
  const from = stringValue(edge.from) || stringValue(edge.fromNodeId);
  const to = stringValue(edge.to) || stringValue(edge.toNodeId);
  if (!from || !to) throw new Error("画布选区包包含无效连线");
  return { id: stringValue(edge.id) || `${from}:${to}`, from, to };
}

function normalizeFragmentGroup(value: unknown): CanvasFragmentGroup {
  if (!value || typeof value !== "object") throw new Error("画布选区包包含无效分组");
  const group = structuredClone(value as Record<string, unknown>);
  const nodeIds = Array.isArray(group.nodeIds) ? group.nodeIds.filter((id): id is string => typeof id === "string") : [];
  return {
    ...group,
    id: stringValue(group.id) || crypto.randomUUID(),
    nodeIds,
    position: group.position && typeof group.position === "object"
      ? { x: numberValue((group.position as Record<string, unknown>).x, 0), y: numberValue((group.position as Record<string, unknown>).y, 0) }
      : undefined,
    x: typeof group.x === "number" ? group.x : undefined,
    y: typeof group.y === "number" ? group.y : undefined,
  };
}

function assetIdFromReference(value: string) {
  return value.match(/^asset:\/\/([^/?#]+)/)?.[1]
    || value.match(/\/api\/assets\/([A-Za-z0-9_-]+)\/content(?:[?#]|$)/)?.[1]
    || "";
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
