export type CanvasProjectArchiveAsset = {
  storageKey: string;
  path: string;
  mimeType: string;
  bytes: number;
};

export type CanvasProjectArchiveItem = {
  project: Record<string, unknown> & { id: string; title: string };
  files: CanvasProjectArchiveAsset[];
};

export type CanvasProjectArchive = {
  app: "infinite-canvas";
  version: 3;
  exportedAt: string;
  projects: CanvasProjectArchiveItem[];
};

export type CanvasArchiveUploadedAsset = {
  id: string;
  mimeType: string;
  kind: "image" | "video" | "audio";
};

export function canvasArchiveStorageKey(scope: "personal" | "team", kind: "image" | "video" | "audio", assetId: string) {
  return `server:${scope}:${kind}:${assetId}`;
}

export function canvasArchiveAssetId(storageKey: string) {
  const match = /^server:(?:personal|team):(image|video|audio):(.+)$/.exec(storageKey);
  return match?.[2] || "";
}

export function buildCanvasArchiveProjectRecord(input: {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  scope: "personal" | "team";
  snapshot: Record<string, unknown>;
  storageKeysByAssetId: ReadonlyMap<string, string>;
}) {
  const snapshot = addArchiveStorageReferences(structuredClone(input.snapshot), input.storageKeysByAssetId) as Record<string, unknown>;
  const nodes = Array.isArray(snapshot.nodes)
    ? snapshot.nodes
    : [];
  const connections = Array.isArray(snapshot.connections)
    ? snapshot.connections
    : Array.isArray(snapshot.edges)
      ? snapshot.edges
      : [];
  const viewport = recordValue(snapshot.viewport);
  return {
    id: input.id,
    title: input.title,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    nodes,
    connections,
    groups: Array.isArray(snapshot.groups) ? snapshot.groups : [],
    chatSessions: Array.isArray(snapshot.chatSessions) ? snapshot.chatSessions : [],
    activeChatId: typeof snapshot.activeChatId === "string" ? snapshot.activeChatId : null,
    backgroundMode: typeof snapshot.backgroundMode === "string" ? snapshot.backgroundMode : "grid",
    showImageInfo: snapshot.showImageInfo === true,
    viewport: {
      x: numberValue(viewport.x) ?? numberValue(snapshot.panX) ?? 0,
      y: numberValue(viewport.y) ?? numberValue(snapshot.panY) ?? 0,
      k: numberValue(viewport.k) ?? (numberValue(snapshot.zoom) ?? 100) / 100,
    },
    scope: input.scope,
  } satisfies Record<string, unknown> & { id: string; title: string };
}

export function collectCanvasArchiveAssetIds(value: unknown, assetIds = new Set<string>()) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectCanvasArchiveAssetIds(item, assetIds));
    return assetIds;
  }
  if (!isRecord(value)) return assetIds;
  const assetId = stringValue(value.assetId) || stringValue(value.imageAssetId);
  if (assetId) assetIds.add(assetId);
  Object.values(value).forEach((item) => collectCanvasArchiveAssetIds(item, assetIds));
  return assetIds;
}

export function collectCanvasArchiveAssetReferences(
  value: unknown,
  fallbackScope: "personal" | "team",
  references = new Map<string, "personal" | "team">(),
) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectCanvasArchiveAssetReferences(item, fallbackScope, references));
    return references;
  }
  if (!isRecord(value)) return references;
  const assetId = stringValue(value.assetId) || stringValue(value.imageAssetId);
  const metadata = isRecord(value.metadata) ? value.metadata : {};
  const scopedValue = value.assetScope || metadata.assetScope;
  const assetScope = scopedValue === "personal" || scopedValue === "team" ? scopedValue : fallbackScope;
  if (assetId) references.set(assetId, assetScope);
  Object.values(value).forEach((item) => collectCanvasArchiveAssetReferences(item, fallbackScope, references));
  return references;
}

export function parseCanvasProjectArchive(value: unknown): CanvasProjectArchive {
  if (!isRecord(value) || value.app !== "infinite-canvas" || value.version !== 3 || !Array.isArray(value.projects)) {
    throw new Error("不是有效的画布项目包");
  }
  const projects = value.projects.map((item) => {
    if (!isRecord(item) || !isRecord(item.project) || typeof item.project.id !== "string" || typeof item.project.title !== "string" || !Array.isArray(item.files)) {
      throw new Error("画布项目包结构不完整");
    }
    const files = item.files.map((file) => {
      if (!isRecord(file) || typeof file.storageKey !== "string" || typeof file.path !== "string" || typeof file.mimeType !== "string") {
        throw new Error("画布项目包媒体清单不完整");
      }
      return {
        storageKey: file.storageKey,
        path: file.path,
        mimeType: file.mimeType,
        bytes: Math.max(0, numberValue(file.bytes) ?? 0),
      } satisfies CanvasProjectArchiveAsset;
    });
    return {
      project: structuredClone(item.project) as CanvasProjectArchiveItem["project"],
      files,
    };
  });
  return {
    app: "infinite-canvas",
    version: 3,
    exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : "",
    projects,
  };
}

export function canvasArchiveProjectSnapshot(project: Record<string, unknown>) {
  if (isRecord(project.data)) return structuredClone(project.data);
  const viewport = recordValue(project.viewport);
  const connections = Array.isArray(project.connections)
    ? project.connections
    : Array.isArray(project.edges)
      ? project.edges
      : [];
  return {
    schema: "ai-manhua-studio-canvas",
    version: 3,
    nodes: Array.isArray(project.nodes) ? structuredClone(project.nodes) : [],
    edges: structuredClone(connections),
    connections: structuredClone(connections),
    groups: Array.isArray(project.groups) ? structuredClone(project.groups) : [],
    chatSessions: Array.isArray(project.chatSessions) ? structuredClone(project.chatSessions) : [],
    activeChatId: typeof project.activeChatId === "string" ? project.activeChatId : null,
    backgroundMode: typeof project.backgroundMode === "string" ? project.backgroundMode : "grid",
    showImageInfo: project.showImageInfo === true,
    viewport: {
      x: numberValue(viewport.x) ?? 0,
      y: numberValue(viewport.y) ?? 0,
      k: numberValue(viewport.k) ?? 1,
    },
    zoom: Math.round((numberValue(viewport.k) ?? 1) * 100),
    panX: numberValue(viewport.x) ?? 0,
    panY: numberValue(viewport.y) ?? 0,
  };
}

export function remapCanvasArchiveSnapshotAssets(
  value: Record<string, unknown>,
  uploadedByReference: ReadonlyMap<string, CanvasArchiveUploadedAsset>,
  scope: "personal" | "team",
) {
  const snapshot = remapArchiveValue(structuredClone(value), uploadedByReference, scope) as Record<string, unknown>;
  if (!Array.isArray(snapshot.nodes)) return snapshot;
  snapshot.nodes = snapshot.nodes.map((node) => remapArchiveNode(node, uploadedByReference, scope));
  return snapshot;
}

function addArchiveStorageReferences(value: unknown, storageKeysByAssetId: ReadonlyMap<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => addArchiveStorageReferences(item, storageKeysByAssetId));
  if (!isRecord(value)) return value;
  const next = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, addArchiveStorageReferences(item, storageKeysByAssetId)]));
  const assetId = stringValue(value.imageAssetId) || stringValue(value.assetId);
  const storageKey = storageKeysByAssetId.get(assetId);
  return storageKey ? { ...next, storageKey } : next;
}

function remapArchiveValue(
  value: unknown,
  uploadedByReference: ReadonlyMap<string, CanvasArchiveUploadedAsset>,
  scope: "personal" | "team",
): unknown {
  if (Array.isArray(value)) return value.map((item) => remapArchiveValue(item, uploadedByReference, scope));
  if (!isRecord(value)) return value;
  const references = [
    stringValue(value.imageAssetId),
    stringValue(value.assetId),
    stringValue(value.storageKey),
  ].filter(Boolean);
  const next = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remapArchiveValue(item, uploadedByReference, scope)]));
  const uploaded = references.map((reference) => uploadedByReference.get(reference)).find(Boolean);
  if (!uploaded) return next;
  const remapped: Record<string, unknown> = {
    ...next,
    assetId: uploaded.id,
    storageKey: canvasArchiveStorageKey(scope, uploaded.kind, uploaded.id),
  };
  if ("imageAssetId" in value) remapped.imageAssetId = uploaded.id;
  if (references.includes(stringValue(value.content))) remapped.content = "";
  return remapped;
}

function remapArchiveNode(
  value: unknown,
  uploadedByReference: ReadonlyMap<string, CanvasArchiveUploadedAsset>,
  scope: "personal" | "team",
) {
  if (!isRecord(value)) return value;
  const node = structuredClone(value);
  const metadata = recordValue(node.metadata);
  const references = [
    stringValue(node.imageAssetId),
    stringValue(node.assetId),
    stringValue(node.storageKey),
    stringValue(metadata.assetId),
    stringValue(metadata.storageKey),
  ].filter(Boolean);
  const uploaded = references.map((reference) => uploadedByReference.get(reference)).find(Boolean)
    || Array.from(uploadedByReference.values()).find((item) => item.id === stringValue(metadata.assetId));
  if (!uploaded) return node;
  node.imageAssetId = uploaded.id;
  node.assetId = uploaded.id;
  node.imageSrc = undefined;
  node.metadata = {
    ...metadata,
    assetId: uploaded.id,
    assetScope: scope,
    mimeType: uploaded.mimeType || metadata.mimeType,
    storageKey: canvasArchiveStorageKey(scope, uploaded.kind, uploaded.id),
    content: references.includes(stringValue(metadata.content)) ? "" : metadata.content,
  };
  return node;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recordValue(value: unknown) {
  return isRecord(value) ? value : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
