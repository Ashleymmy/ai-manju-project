export const CANVAS_AGENT_PROTOCOL_VERSION = "1.0" as const;

export type CanvasAgentViewport = { x: number; y: number; k: number };

export type CanvasAgentNode = {
  id: string;
  type: string;
  kind?: string;
  title?: string;
  content?: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  imageAssetId?: string;
  imageSrc?: string;
  metadata?: Record<string, unknown>;
};

export type CanvasAgentConnection = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
};

export type CanvasAgentSnapshot = {
  protocolVersion?: typeof CANVAS_AGENT_PROTOCOL_VERSION;
  projectId: string;
  title: string;
  nodes: CanvasAgentNode[];
  connections: CanvasAgentConnection[];
  selectedNodeIds: string[];
  viewport: CanvasAgentViewport;
};

export type CanvasAgentGenerationMode = "text" | "image" | "video" | "audio";

export type CanvasAgentGenerationResult = {
  nodeId: string;
  mode: CanvasAgentGenerationMode;
  status: "succeeded" | "partial_failed" | "failed" | "canceled" | "blocked";
  outputNodeIds: string[];
  jobIds: string[];
  error?: string;
};

export type CanvasAgentExecutionResult = {
  snapshot: CanvasAgentSnapshot;
  generationResults: CanvasAgentGenerationResult[];
};

export type CanvasAgentOp =
  | { type: "add_node"; id?: string; nodeType?: string; title?: string; position?: { x: number; y: number }; x?: number; y?: number; width?: number; height?: number; metadata?: Record<string, unknown> }
  | { type: "update_node"; id: string; patch?: Partial<CanvasAgentNode>; metadata?: Record<string, unknown> }
  | { type: "delete_node"; id?: string; ids?: string[]; nodeType?: string }
  | { type: "delete_connections"; id?: string; ids?: string[]; all?: boolean }
  | { type: "connect_nodes"; id?: string; fromNodeId: string; toNodeId: string }
  | { type: "set_viewport"; viewport: CanvasAgentViewport }
  | { type: "select_nodes"; ids: string[] }
  | { type: "run_generation"; nodeId: string; mode?: CanvasAgentGenerationMode; prompt?: string };

export type CanvasAgentToolName =
  | "canvas_get_state"
  | "canvas_get_selection"
  | "canvas_export_snapshot"
  | "canvas_search_assets"
  | "canvas_add_assets"
  | "canvas_list_jobs"
  | "canvas_cancel_job"
  | "canvas_apply_ops"
  | "canvas_create_node"
  | "canvas_create_text_node"
  | "canvas_create_text_nodes"
  | "canvas_create_config_node"
  | "canvas_create_image_prompt_flow"
  | "canvas_create_generation_flow"
  | "canvas_generate_text"
  | "canvas_generate_image"
  | "canvas_generate_video"
  | "canvas_generate_audio"
  | "canvas_update_node"
  | "canvas_update_node_text"
  | "canvas_move_nodes"
  | "canvas_resize_node"
  | "canvas_delete_nodes"
  | "canvas_connect_nodes"
  | "canvas_select_nodes"
  | "canvas_set_viewport"
  | "canvas_run_generation";

export type CanvasAgentToolRequest = {
  protocolVersion?: string;
  requestId: string;
  name: CanvasAgentToolName;
  input?: Record<string, unknown>;
  requiresConfirmation?: boolean;
};

export type CanvasAgentFunctionTool = {
  type: "function";
  function: {
    name: CanvasAgentToolName;
    description: string;
    parameters: Record<string, unknown>;
  };
};

const readTools = new Set<CanvasAgentToolName>([
  "canvas_get_state",
  "canvas_get_selection",
  "canvas_export_snapshot",
  "canvas_search_assets",
  "canvas_list_jobs",
]);

const workspaceTools = new Set<CanvasAgentToolName>([
  "canvas_search_assets",
  "canvas_add_assets",
  "canvas_list_jobs",
  "canvas_cancel_job",
]);

const objectParameters = { type: "object", additionalProperties: true } as const;

function tool(name: CanvasAgentToolName, description: string): CanvasAgentFunctionTool {
  return { type: "function", function: { name, description, parameters: objectParameters } };
}

export const CANVAS_AGENT_TOOLS: readonly CanvasAgentFunctionTool[] = [
  tool("canvas_get_state", "读取当前画布节点、连线、选区和视口。"),
  tool("canvas_get_selection", "读取当前画布选中的节点。"),
  tool("canvas_export_snapshot", "导出当前画布快照。"),
  tool("canvas_search_assets", "搜索当前 workspace 的资产库。参数可包含 keyword、assetType、category、sourceType、limit。"),
  tool("canvas_add_assets", "把资产库素材添加到当前画布。参数包含 assetIds、x、y、direction、gap。"),
  tool("canvas_list_jobs", "读取当前 workspace 的生成任务。参数可包含 statuses、types、limit。"),
  tool("canvas_cancel_job", "取消生成任务。参数包含 jobId。"),
  tool("canvas_apply_ops", "批量执行画布操作。参数包含 ops 数组。"),
  tool("canvas_create_node", "创建任意节点。参数包含 nodeType、title、x、y、width、height、metadata。"),
  tool("canvas_create_text_node", "创建单个文本节点。参数包含 text、title、x、y。"),
  tool("canvas_create_text_nodes", "批量创建文本节点。参数包含 items、x、y、gap、direction。"),
  tool("canvas_create_config_node", "创建生成配置节点。参数包含 prompt、mode、model、size、quality、count、seconds、autoRun。"),
  tool("canvas_create_image_prompt_flow", "创建提示词和图片生成配置流程。"),
  tool("canvas_create_generation_flow", "创建文本、图片、视频或音频生成流程。"),
  tool("canvas_generate_text", "创建并运行文本生成流程。"),
  tool("canvas_generate_image", "创建并运行图片生成流程。"),
  tool("canvas_generate_video", "创建并运行视频生成流程。"),
  tool("canvas_generate_audio", "创建并运行音频生成流程。"),
  tool("canvas_update_node", "更新节点字段或 metadata。"),
  tool("canvas_update_node_text", "更新文本节点内容。"),
  tool("canvas_move_nodes", "移动一个或多个节点。"),
  tool("canvas_resize_node", "调整节点尺寸。"),
  tool("canvas_delete_nodes", "删除节点及其连线。"),
  tool("canvas_connect_nodes", "连接一个或多个节点。"),
  tool("canvas_select_nodes", "设置选中节点。"),
  tool("canvas_set_viewport", "设置画布视口。"),
  tool("canvas_run_generation", "触发指定节点生成。"),
];

const toolNames = new Set<CanvasAgentToolName>(CANVAS_AGENT_TOOLS.map((item) => item.function.name));

export function isCanvasAgentReadTool(name: string): name is CanvasAgentToolName {
  return readTools.has(name as CanvasAgentToolName);
}

export function isCanvasAgentToolName(name: string): name is CanvasAgentToolName {
  return toolNames.has(name as CanvasAgentToolName);
}

export function isCanvasAgentWorkspaceTool(name: string): name is CanvasAgentToolName {
  return workspaceTools.has(name as CanvasAgentToolName);
}

export function compactCanvasAgentSnapshot(snapshot: CanvasAgentSnapshot) {
  return {
    protocolVersion: CANVAS_AGENT_PROTOCOL_VERSION,
    projectId: snapshot.projectId,
    title: snapshot.title,
    viewport: snapshot.viewport,
    selectedNodeIds: snapshot.selectedNodeIds,
    nodes: snapshot.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      title: node.title,
      position: node.position,
      width: node.width,
      height: node.height,
      metadata: compactAgentMetadata(node.metadata),
    })),
    connections: snapshot.connections,
  };
}

export function summarizeCanvasAgentOps(ops: readonly CanvasAgentOp[] = []) {
  const counts = new Map<string, number>();
  ops.forEach((op) => counts.set(op.type, (counts.get(op.type) || 0) + 1));
  return Array.from(counts).map(([type, count]) => `${opLabel(type)} ${count}`).join("，");
}

export function applyCanvasAgentOps(snapshot: CanvasAgentSnapshot, ops: readonly CanvasAgentOp[] = []) {
  let nodes = snapshot.nodes;
  let connections = snapshot.connections;
  let selectedNodeIds = snapshot.selectedNodeIds;
  let viewport = snapshot.viewport;

  ops.forEach((op, index) => {
    if (op.type === "add_node") {
      const nodeType = normalizeNodeType(op.nodeType);
      const spec = nodeSpec(nodeType);
      const node: CanvasAgentNode = {
        id: op.id || `${nodeType}-${crypto.randomUUID()}`,
        type: nodeType,
        kind: nodeType,
        title: op.title || spec.title,
        content: stringValue(op.metadata?.content) || stringValue(op.metadata?.prompt),
        position: op.position || { x: op.x ?? index * 36, y: op.y ?? index * 36 },
        width: positiveNumber(op.width, spec.width),
        height: positiveNumber(op.height, spec.height),
        metadata: { ...spec.metadata, ...(nodeType === "config" ? { size: "auto" } : {}), ...op.metadata },
      };
      nodes = [...nodes, node];
      selectedNodeIds = [node.id];
      return;
    }
    if (op.type === "update_node") {
      nodes = nodes.map((node) => node.id === op.id ? {
        ...node,
        ...op.patch,
        metadata: { ...node.metadata, ...op.patch?.metadata, ...op.metadata },
      } : node);
      return;
    }
    if (op.type === "delete_node") {
      const ids = new Set(op.ids || (op.id ? [op.id] : op.nodeType ? nodes.filter((node) => node.type === op.nodeType).map((node) => node.id) : []));
      nodes = nodes.filter((node) => !ids.has(node.id));
      connections = connections.filter((edge) => !ids.has(edge.fromNodeId) && !ids.has(edge.toNodeId));
      selectedNodeIds = selectedNodeIds.filter((id) => !ids.has(id));
      return;
    }
    if (op.type === "delete_connections") {
      const ids = new Set(op.ids || (op.id ? [op.id] : []));
      connections = op.all ? [] : connections.filter((edge) => !ids.has(edge.id));
      return;
    }
    if (op.type === "connect_nodes") {
      const valid = nodes.some((node) => node.id === op.fromNodeId) && nodes.some((node) => node.id === op.toNodeId);
      const exists = connections.some((edge) => edge.fromNodeId === op.fromNodeId && edge.toNodeId === op.toNodeId);
      if (valid && !exists && op.fromNodeId !== op.toNodeId) {
        connections = [...connections, { id: op.id || crypto.randomUUID(), fromNodeId: op.fromNodeId, toNodeId: op.toNodeId }];
      }
      return;
    }
    if (op.type === "select_nodes") {
      selectedNodeIds = op.ids.filter((id) => nodes.some((node) => node.id === id));
      return;
    }
    if (op.type === "set_viewport") viewport = normalizeViewport(op.viewport, viewport);
  });

  return { ...snapshot, protocolVersion: CANVAS_AGENT_PROTOCOL_VERSION, nodes, connections, selectedNodeIds, viewport };
}

export function canvasAgentToolToOps(
  name: string,
  input: Record<string, unknown>,
  snapshot: CanvasAgentSnapshot,
): CanvasAgentOp[] {
  if (name === "canvas_apply_ops") return requireOps(input.ops);
  if (name === "canvas_create_node") return [{
    type: "add_node",
    nodeType: stringValue(input.nodeType),
    title: stringValue(input.title) || undefined,
    x: finiteNumber(input.x),
    y: finiteNumber(input.y),
    width: finiteNumber(input.width),
    height: finiteNumber(input.height),
    metadata: recordValue(input.metadata),
  }];
  if (name === "canvas_create_text_node") return [textNodeOp(input, finiteNumber(input.x) ?? nextCanvasX(snapshot), finiteNumber(input.y) ?? 0)];
  if (name === "canvas_create_text_nodes") {
    const items = Array.isArray(input.items) ? input.items.filter(isRecord) : [];
    const x = finiteNumber(input.x) ?? nextCanvasX(snapshot);
    const y = finiteNumber(input.y) ?? 0;
    const gap = finiteNumber(input.gap) ?? 40;
    const direction = input.direction === "row" ? "row" : "column";
    return items.map((item, index) => textNodeOp(
      item,
      finiteNumber(item.x) ?? (direction === "row" ? x + index * (340 + gap) : x),
      finiteNumber(item.y) ?? (direction === "row" ? y : y + index * (220 + gap)),
    ));
  }
  if (name === "canvas_create_config_node") {
    const id = `config-${crypto.randomUUID()}`;
    const op = configNodeOp(id, input, finiteNumber(input.x) ?? nextCanvasX(snapshot), finiteNumber(input.y) ?? 0);
    return [op, ...(input.autoRun ? [runGenerationOp(id, generationMode(input.mode), stringValue(input.prompt))] : [])];
  }
  if (name === "canvas_create_image_prompt_flow") return generationFlowOps({ ...input, mode: "image" }, snapshot);
  if (name === "canvas_create_generation_flow") return generationFlowOps(input, snapshot);
  if (name.startsWith("canvas_generate_")) return generationFlowOps({ ...input, mode: name.replace("canvas_generate_", ""), autoRun: true }, snapshot);
  if (name === "canvas_update_node") return [{ type: "update_node", id: stringValue(input.id), patch: recordValue(input.patch) as Partial<CanvasAgentNode>, metadata: recordValue(input.metadata) }];
  if (name === "canvas_update_node_text") return [{ type: "update_node", id: stringValue(input.id), patch: stringValue(input.title) ? { title: stringValue(input.title) } : undefined, metadata: { content: stringValue(input.text), prompt: stringValue(input.text), status: "success" } }];
  if (name === "canvas_move_nodes") {
    const items = Array.isArray(input.items) ? input.items.filter(isRecord) : [];
    return items.map((item) => {
      const id = stringValue(item.id);
      const current = snapshot.nodes.find((node) => node.id === id);
      return {
        type: "update_node" as const,
        id,
        patch: { position: {
          x: finiteNumber(item.x) ?? ((current?.position.x || 0) + (finiteNumber(item.dx) || 0)),
          y: finiteNumber(item.y) ?? ((current?.position.y || 0) + (finiteNumber(item.dy) || 0)),
        } },
      };
    });
  }
  if (name === "canvas_resize_node") return [{ type: "update_node", id: stringValue(input.id), patch: { width: finiteNumber(input.width), height: finiteNumber(input.height) }, metadata: typeof input.freeResize === "boolean" ? { freeResize: input.freeResize } : undefined }];
  if (name === "canvas_delete_nodes") return [{ type: "delete_node", ids: stringValues(input.ids) }];
  if (name === "canvas_connect_nodes") return (Array.isArray(input.connections) ? input.connections.filter(isRecord) : []).map((edge) => ({ type: "connect_nodes" as const, fromNodeId: stringValue(edge.fromNodeId), toNodeId: stringValue(edge.toNodeId) }));
  if (name === "canvas_select_nodes") return [{ type: "select_nodes", ids: stringValues(input.ids) }];
  if (name === "canvas_set_viewport") return [{ type: "set_viewport", viewport: normalizeViewport(input.viewport, snapshot.viewport) }];
  if (name === "canvas_run_generation") return [runGenerationOp(stringValue(input.nodeId), generationMode(input.mode), stringValue(input.prompt))];
  return [];
}

function generationFlowOps(input: Record<string, unknown>, snapshot: CanvasAgentSnapshot): CanvasAgentOp[] {
  const mode = generationMode(input.mode);
  const prompt = stringValue(input.prompt);
  const x = finiteNumber(input.x) ?? nextCanvasX(snapshot);
  const y = finiteNumber(input.y) ?? 0;
  const textId = `text-${crypto.randomUUID()}`;
  const configId = `config-${crypto.randomUUID()}`;
  const referenceNodeIds = stringValues(input.referenceNodeIds);
  const composer = [`@[node:${textId}]`, ...referenceNodeIds.map((id) => `@[node:${id}]`)].join("\n");
  return [
    textNodeOp({ text: prompt, title: stringValue(input.title) || "提示词" }, x, y, textId),
    configNodeOp(configId, { ...input, prompt: composer }, x + 420, y),
    { type: "connect_nodes", fromNodeId: textId, toNodeId: configId },
    ...referenceNodeIds.map((fromNodeId): CanvasAgentOp => ({ type: "connect_nodes", fromNodeId, toNodeId: configId })),
    { type: "select_nodes", ids: [configId] },
    ...(input.autoRun ? [runGenerationOp(configId, mode, composer)] : []),
  ];
}

function textNodeOp(input: Record<string, unknown>, x: number, y: number, id?: string): CanvasAgentOp {
  const text = stringValue(input.text);
  return { type: "add_node", id, nodeType: "text", title: stringValue(input.title) || "文本", x, y, width: finiteNumber(input.width), height: finiteNumber(input.height), metadata: { content: text, prompt: text, status: "success" } };
}

function configNodeOp(id: string, input: Record<string, unknown>, x: number, y: number): CanvasAgentOp {
  const mode = generationMode(input.mode);
  const prompt = stringValue(input.prompt);
  return {
    type: "add_node",
    id,
    nodeType: "config",
    title: stringValue(input.title) || generationTitle(mode),
    x,
    y,
    width: finiteNumber(input.width),
    height: finiteNumber(input.height),
    metadata: definedFields({
      generationMode: mode,
      composerContent: prompt,
      prompt,
      status: "idle",
      model: stringValue(input.model),
      size: stringValue(input.size) || "auto",
      quality: stringValue(input.quality),
      count: finiteNumber(input.count),
      seconds: stringValue(input.seconds),
      resolution: stringValue(input.resolution) || stringValue(input.vquality),
      generateAudio: input.generateAudio,
      watermark: input.watermark,
      audioVoice: stringValue(input.audioVoice),
      audioFormat: stringValue(input.audioFormat),
      audioSpeed: stringValue(input.audioSpeed),
      audioInstructions: stringValue(input.audioInstructions),
    }),
  };
}

function runGenerationOp(nodeId: string, mode: CanvasAgentGenerationMode, prompt?: string): CanvasAgentOp {
  return { type: "run_generation", nodeId, mode, prompt };
}

function requireOps(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is CanvasAgentOp => isRecord(item) && typeof item.type === "string") : [];
}

function nextCanvasX(snapshot: CanvasAgentSnapshot) {
  return snapshot.nodes.length ? Math.max(...snapshot.nodes.map((node) => node.position.x + node.width)) + 80 : 0;
}

function normalizeNodeType(value: unknown) {
  const type = stringValue(value).toLowerCase();
  return type === "image" || type === "config" || type === "video" || type === "audio" ? type : "text";
}

function generationMode(value: unknown): CanvasAgentGenerationMode {
  return value === "text" || value === "video" || value === "audio" ? value : "image";
}

function generationTitle(mode: CanvasAgentGenerationMode) {
  if (mode === "text") return "文本生成";
  if (mode === "video") return "视频生成";
  if (mode === "audio") return "音频生成";
  return "图片生成";
}

function nodeSpec(type: string) {
  if (type === "image") return { title: "图片", width: 320, height: 238, metadata: { status: "idle" } };
  if (type === "video") return { title: "视频", width: 420, height: 260, metadata: { status: "idle", generationMode: "video" } };
  if (type === "audio") return { title: "音频", width: 360, height: 120, metadata: { status: "idle", generationMode: "audio" } };
  if (type === "config") return { title: "生成配置", width: 360, height: 260, metadata: { status: "idle", generationMode: "image", size: "auto" } };
  return { title: "文本", width: 300, height: 170, metadata: { status: "success" } };
}

function normalizeViewport(value: unknown, fallback: CanvasAgentViewport) {
  if (!isRecord(value)) return fallback;
  return {
    x: finiteNumber(value.x) ?? fallback.x,
    y: finiteNumber(value.y) ?? fallback.y,
    k: Math.max(0.1, Math.min(2.5, finiteNumber(value.k) ?? fallback.k)),
  };
}

function opLabel(type: string) {
  if (type === "add_node") return "新增节点";
  if (type === "update_node") return "更新节点";
  if (type === "delete_node") return "删除节点";
  if (type === "delete_connections") return "删除连线";
  if (type === "connect_nodes") return "连接";
  if (type === "set_viewport") return "调整视图";
  if (type === "select_nodes") return "选择节点";
  if (type === "run_generation") return "触发生成";
  return type;
}

function positiveNumber(value: unknown, fallback: number) {
  const number = finiteNumber(value);
  return number && number > 0 ? number : fallback;
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringValues(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
}

function recordValue(value: unknown) {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function definedFields(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ""));
}

function compactAgentMetadata(metadata: Record<string, unknown> | undefined) {
  if (!metadata) return undefined;
  return definedFields({
    content: compactAgentText(metadata.content),
    prompt: compactAgentText(metadata.prompt),
    composerContent: compactAgentText(metadata.composerContent),
    status: metadata.status,
    generationMode: metadata.generationMode,
    model: metadata.model,
    size: metadata.size,
    quality: metadata.quality,
    count: metadata.count,
    seconds: metadata.seconds,
    resolution: metadata.resolution,
    vquality: metadata.vquality,
    generateAudio: metadata.generateAudio,
    watermark: metadata.watermark,
    assetId: metadata.assetId,
    mimeType: metadata.mimeType,
    jobId: metadata.jobId,
    referenceNodeIds: metadata.referenceNodeIds,
  });
}

function compactAgentText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  if (text.startsWith("data:")) return "[媒体数据已省略]";
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      return `${url.origin}${url.pathname}`.slice(0, 500);
    } catch {
      return "[媒体地址已省略]";
    }
  }
  return text.slice(0, 500);
}
