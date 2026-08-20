export type CanvasSnapshotBase = Record<string, unknown>;

export type RoundTripCanvasEdge = {
  id: string;
  from: string;
  to: string;
};

export type BuildCanvasSnapshotInput = {
  nodes: unknown[];
  edges: unknown[];
  groups?: unknown[];
  zoom: number;
  panX: number;
  panY: number;
  backgroundMode?: "dots" | "lines" | "blank";
  showImageInfo?: boolean;
  updatedAt?: string;
  defaultSchema: string;
  defaultVersion: number;
};

export function isCanvasSnapshotBase(value: unknown): value is CanvasSnapshotBase {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function extractServerCanvasSnapshotData(value: unknown): CanvasSnapshotBase | null {
  if (!isCanvasSnapshotBase(value)) return null;
  const isServerEnvelope = "data" in value && ("project_id" in value || "version" in value || "created_at" in value || "updated_at" in value);
  if (isServerEnvelope) return isCanvasSnapshotBase(value.data) ? value.data : null;
  return value;
}

export function extractProjectCanvasData(value: unknown): CanvasSnapshotBase | null {
  return isCanvasSnapshotBase(value) ? value : null;
}

export function hasRoundTripCanvasGraph(value: unknown): value is CanvasSnapshotBase {
  return isCanvasSnapshotBase(value) && (
    Array.isArray(value.nodes)
    || Array.isArray(value.connections)
    || Array.isArray(value.edges)
  );
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nestedIdField(value: unknown): string {
  if (!isCanvasSnapshotBase(value)) return "";
  return stringField(value.id) || stringField(value.nodeId) || stringField(value.node_id);
}

function endpointField(source: CanvasSnapshotBase, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    const direct = stringField(value);
    if (direct) return direct;
    const nested = nestedIdField(value);
    if (nested) return nested;
  }
  return "";
}

export function normalizeRoundTripCanvasEdge(value: unknown): RoundTripCanvasEdge | null {
  if (!isCanvasSnapshotBase(value)) return null;
  const from = endpointField(value, ["from", "fromNodeId", "from_node_id", "sourceNodeId", "source_node_id", "sourceId", "source_id", "source"]);
  const to = endpointField(value, ["to", "toNodeId", "to_node_id", "targetNodeId", "target_node_id", "targetId", "target_id", "target"]);
  if (!from || !to || from === to) return null;
  return { id: stringField(value.id) || `${from}:${to}`, from, to };
}

export function collectRoundTripCanvasEdges(value: CanvasSnapshotBase): RoundTripCanvasEdge[] {
  const raw = [
    ...(Array.isArray(value.connections) ? value.connections : []),
    ...(Array.isArray(value.edges) ? value.edges : []),
  ];
  const seen = new Set<string>();
  return raw.flatMap((item) => {
    const edge = normalizeRoundTripCanvasEdge(item);
    if (!edge) return [];
    const key = `${edge.from}->${edge.to}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [edge];
  });
}

export function buildRoundTripCanvasSnapshot(base: CanvasSnapshotBase, input: BuildCanvasSnapshotInput): CanvasSnapshotBase {
  const viewportBase = isCanvasSnapshotBase(base.viewport) ? base.viewport : {};
  const next: CanvasSnapshotBase = { ...base };

  if (!Object.prototype.hasOwnProperty.call(base, "schema")) next.schema = input.defaultSchema;
  if (!Object.prototype.hasOwnProperty.call(base, "version")) next.version = input.defaultVersion;

  next.nodes = input.nodes;
  next.edges = input.edges;
  next.connections = input.edges;
  if (input.groups !== undefined) next.groups = input.groups;
  next.viewport = {
    ...viewportBase,
    x: input.panX,
    y: input.panY,
    k: input.zoom / 100,
  };
  next.zoom = input.zoom;
  next.panX = input.panX;
  next.panY = input.panY;
  if (input.backgroundMode !== undefined) next.backgroundMode = input.backgroundMode;
  if (input.showImageInfo !== undefined) next.showImageInfo = input.showImageInfo;
  next.updated_at = input.updatedAt || new Date().toISOString();

  return next;
}
