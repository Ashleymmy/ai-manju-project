/** Wire protocol shared by the online Canvas Agent, local Agent and web canvas. */
export const CANVAS_AGENT_PROTOCOL_VERSION = "1.0" as const;

export type CanvasAgentPosition = { x: number; y: number };
export type CanvasAgentViewport = { x: number; y: number; k: number };
export type CanvasAgentNodeType = "image" | "text" | "config" | "video" | "audio";
export type CanvasAgentGenerationMode = "text" | "image" | "video" | "audio";

export type CanvasAgentGenerationResult = {
    nodeId: string;
    mode: CanvasAgentGenerationMode;
    status: "succeeded" | "partial_failed" | "failed" | "canceled" | "blocked";
    outputNodeIds: string[];
    jobIds: string[];
    error?: string;
};

export type CanvasAgentNode<TNodeType extends string = CanvasAgentNodeType, TMetadata = Record<string, unknown>> = {
    id: string;
    type: TNodeType;
    title?: string;
    position: CanvasAgentPosition;
    width: number;
    height: number;
    metadata?: TMetadata;
};

export type CanvasAgentConnection = { id: string; fromNodeId: string; toNodeId: string };

export type CanvasAgentSnapshot<
    TNode = CanvasAgentNode,
    TConnection = CanvasAgentConnection,
    TViewport = CanvasAgentViewport,
> = {
    protocolVersion?: typeof CANVAS_AGENT_PROTOCOL_VERSION;
    projectId: string;
    title: string;
    nodes: TNode[];
    connections: TConnection[];
    selectedNodeIds: string[];
    viewport: TViewport;
    clientId?: string;
};

export type CanvasAgentExecutionResult<TSnapshot = CanvasAgentSnapshot> = {
    snapshot: TSnapshot;
    generationResults: CanvasAgentGenerationResult[];
};

export type CanvasAgentOp<
    TNodeType extends string = CanvasAgentNodeType,
    TNode = CanvasAgentNode<TNodeType>,
    TMetadata = Record<string, unknown>,
    TViewport = CanvasAgentViewport,
> =
    | { type: "add_node"; id?: string; nodeType?: TNodeType; title?: string; position?: CanvasAgentPosition; x?: number; y?: number; width?: number; height?: number; metadata?: TMetadata }
    | { type: "update_node"; id: string; patch?: Partial<TNode>; metadata?: TMetadata }
    | { type: "delete_node"; id?: string; ids?: string[]; nodeType?: TNodeType }
    | { type: "delete_connections"; id?: string; ids?: string[]; all?: boolean }
    | { type: "connect_nodes"; id?: string; fromNodeId: string; toNodeId: string }
    | { type: "set_viewport"; viewport: TViewport }
    | { type: "select_nodes"; ids: string[] }
    | { type: "run_generation"; nodeId: string; mode?: CanvasAgentGenerationMode; prompt?: string };

export type CanvasAgentMessage = {
    id: string;
    role: "system" | "user" | "assistant" | "tool" | "error";
    text: string;
    title?: string;
    detail?: unknown;
    attachments?: Array<{ name?: string; type?: string; dataUrl?: string }>;
};

export type CanvasAgentEvent = {
    protocolVersion: typeof CANVAS_AGENT_PROTOCOL_VERSION;
    channel: "online" | "local";
    type: string;
    timestamp: string;
    payload?: unknown;
};

export type CanvasAgentToolRequest = {
    protocolVersion: typeof CANVAS_AGENT_PROTOCOL_VERSION;
    requestId: string;
    name: CanvasAgentToolName;
    input: Record<string, unknown>;
    requiresConfirmation: boolean;
};

export type CanvasAgentToolResult = {
    protocolVersion: typeof CANVAS_AGENT_PROTOCOL_VERSION;
    requestId: string;
    result?: unknown;
    error?: string;
};

export const CANVAS_AGENT_TOOL_NAMES = [
    "canvas_get_state",
    "canvas_get_selection",
    "canvas_export_snapshot",
    "canvas_search_assets",
    "canvas_add_assets",
    "canvas_list_jobs",
    "canvas_cancel_job",
    "canvas_apply_ops",
    "canvas_create_node",
    "canvas_create_text_node",
    "canvas_create_text_nodes",
    "canvas_create_config_node",
    "canvas_create_image_prompt_flow",
    "canvas_create_generation_flow",
    "canvas_generate_text",
    "canvas_generate_image",
    "canvas_generate_video",
    "canvas_generate_audio",
    "canvas_update_node",
    "canvas_update_node_text",
    "canvas_move_nodes",
    "canvas_resize_node",
    "canvas_delete_nodes",
    "canvas_connect_nodes",
    "canvas_select_nodes",
    "canvas_set_viewport",
    "canvas_run_generation",
] as const;

export type CanvasAgentToolName = (typeof CANVAS_AGENT_TOOL_NAMES)[number];
export const CANVAS_AGENT_READ_TOOL_NAMES = ["canvas_get_state", "canvas_get_selection", "canvas_export_snapshot", "canvas_search_assets", "canvas_list_jobs"] as const satisfies readonly CanvasAgentToolName[];

type JsonSchema = Record<string, unknown>;
export type CanvasAgentFunctionTool = {
    type: "function";
    function: { name: CanvasAgentToolName; description: string; parameters: JsonSchema; strict?: boolean };
};

const recordSchema = { type: "object", additionalProperties: true } as const;
const positionSchema = { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"], additionalProperties: false } as const;
const viewportSchema = { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, k: { type: "number" } }, required: ["x", "y", "k"], additionalProperties: false } as const;
const nodeTypeSchema = { type: "string", enum: ["image", "text", "config", "video", "audio"] } as const;
const generationModeSchema = { type: "string", enum: ["text", "image", "video", "audio"] } as const;
const generationOptionProperties = {
    model: { type: "string" }, size: { type: "string" }, quality: { type: "string" }, count: { type: "number" }, seconds: { type: "string" },
    vquality: { type: "string" }, generateAudio: { type: "string" }, watermark: { type: "string" }, audioVoice: { type: "string" },
    audioFormat: { type: "string" }, audioSpeed: { type: "string" }, audioInstructions: { type: "string" },
} as const;
const canvasOpSchema = {
    type: "object",
    properties: {
        type: { type: "string", enum: ["add_node", "update_node", "delete_node", "delete_connections", "connect_nodes", "set_viewport", "select_nodes", "run_generation"] },
        id: { type: "string" }, ids: { type: "array", items: { type: "string" } }, nodeType: nodeTypeSchema, title: { type: "string" },
        x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" }, position: positionSchema,
        metadata: recordSchema, patch: recordSchema, all: { type: "boolean" }, fromNodeId: { type: "string" }, toNodeId: { type: "string" },
        viewport: viewportSchema, nodeId: { type: "string" }, mode: generationModeSchema, prompt: { type: "string" },
    },
    required: ["type"],
    additionalProperties: false,
} as const;

function tool(name: CanvasAgentToolName, description: string, properties: Record<string, unknown>, required: string[] = []): CanvasAgentFunctionTool {
    return { type: "function", function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } } };
}

function generationTool(name: CanvasAgentToolName, description: string, mode?: CanvasAgentGenerationMode): CanvasAgentFunctionTool {
    return tool(name, description, {
        prompt: { type: "string" }, title: { type: "string" }, x: { type: "number" }, y: { type: "number" },
        referenceNodeIds: { type: "array", items: { type: "string" } }, ...(mode ? {} : { mode: generationModeSchema }),
        autoRun: { type: "boolean" }, ...generationOptionProperties,
    }, ["prompt"]);
}

export const CANVAS_AGENT_TOOLS: readonly CanvasAgentFunctionTool[] = [
    tool("canvas_get_state", "读取当前画布节点、连线、选区和视口。", {}),
    tool("canvas_get_selection", "读取当前画布选中的节点。", {}),
    tool("canvas_export_snapshot", "导出当前画布快照。", {}),
    tool("canvas_search_assets", "搜索当前 workspace 的资产库。", { keyword: { type: "string" }, assetType: { type: "string", enum: ["image", "video", "audio"] }, category: { type: "string", enum: ["character", "environment", "costume", "prop", "ui", "reference", "other"] }, sourceType: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50 } }),
    tool("canvas_add_assets", "把资产库中的素材添加到当前画布。", { assetIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20 }, x: { type: "number" }, y: { type: "number" }, direction: { type: "string", enum: ["row", "column"] }, gap: { type: "number" } }, ["assetIds"]),
    tool("canvas_list_jobs", "读取当前 workspace 的渲染任务。", { statuses: { type: "array", items: { type: "string", enum: ["queued", "running", "succeeded", "failed", "canceled"] } }, types: { type: "array", items: { type: "string" } }, limit: { type: "integer", minimum: 1, maximum: 100 } }),
    tool("canvas_cancel_job", "取消当前用户的渲染任务。", { jobId: { type: "string" } }, ["jobId"]),
    tool("canvas_apply_ops", "批量执行画布操作。", { ops: { type: "array", items: canvasOpSchema } }, ["ops"]),
    tool("canvas_create_node", "创建任意类型节点。", { nodeType: nodeTypeSchema, title: { type: "string" }, x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" }, metadata: recordSchema }, ["nodeType"]),
    tool("canvas_create_text_node", "创建单个文本节点。", { text: { type: "string" }, x: { type: "number" }, y: { type: "number" }, title: { type: "string" }, width: { type: "number" }, height: { type: "number" } }),
    tool("canvas_create_text_nodes", "批量创建文本节点。", { items: { type: "array", minItems: 1, items: { type: "object", properties: { text: { type: "string" }, title: { type: "string" }, x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" } }, required: ["text"], additionalProperties: false } }, x: { type: "number" }, y: { type: "number" }, gap: { type: "number" }, direction: { type: "string", enum: ["row", "column"] } }, ["items"]),
    tool("canvas_create_config_node", "创建生成配置节点。", { prompt: { type: "string" }, mode: generationModeSchema, title: { type: "string" }, x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" }, autoRun: { type: "boolean" }, ...generationOptionProperties }),
    tool("canvas_create_image_prompt_flow", "创建提示词与图片生成配置流程。", { prompt: { type: "string" }, x: { type: "number" }, y: { type: "number" }, autoRun: { type: "boolean" }, ...generationOptionProperties }, ["prompt"]),
    generationTool("canvas_create_generation_flow", "创建通用生成流程。"),
    generationTool("canvas_generate_text", "创建并运行文本生成流程。", "text"),
    generationTool("canvas_generate_image", "创建并运行图片生成流程。", "image"),
    generationTool("canvas_generate_video", "创建并运行视频生成流程。", "video"),
    generationTool("canvas_generate_audio", "创建并运行音频生成流程。", "audio"),
    tool("canvas_update_node", "更新节点字段或 metadata。", { id: { type: "string" }, patch: recordSchema, metadata: recordSchema }, ["id"]),
    tool("canvas_update_node_text", "更新文本节点内容。", { id: { type: "string" }, text: { type: "string" }, title: { type: "string" } }, ["id", "text"]),
    tool("canvas_move_nodes", "移动一个或多个节点。", { items: { type: "array", minItems: 1, items: { type: "object", properties: { id: { type: "string" }, x: { type: "number" }, y: { type: "number" }, dx: { type: "number" }, dy: { type: "number" } }, required: ["id"], additionalProperties: false } } }, ["items"]),
    tool("canvas_resize_node", "调整节点尺寸。", { id: { type: "string" }, width: { type: "number" }, height: { type: "number" }, freeResize: { type: "boolean" } }, ["id", "width", "height"]),
    tool("canvas_delete_nodes", "删除节点及其连线。", { ids: { type: "array", items: { type: "string" }, minItems: 1 } }, ["ids"]),
    tool("canvas_connect_nodes", "连接一个或多个节点。", { connections: { type: "array", minItems: 1, items: { type: "object", properties: { fromNodeId: { type: "string" }, toNodeId: { type: "string" } }, required: ["fromNodeId", "toNodeId"], additionalProperties: false } } }, ["connections"]),
    tool("canvas_select_nodes", "设置选中节点。", { ids: { type: "array", items: { type: "string" } } }, ["ids"]),
    tool("canvas_set_viewport", "设置画布视口。", { viewport: viewportSchema }, ["viewport"]),
    tool("canvas_run_generation", "触发指定节点生成。", { nodeId: { type: "string" }, mode: generationModeSchema, prompt: { type: "string" } }, ["nodeId"]),
] as const;

export function isCanvasAgentToolName(value: unknown): value is CanvasAgentToolName {
    return typeof value === "string" && (CANVAS_AGENT_TOOL_NAMES as readonly string[]).includes(value);
}

export function isCanvasAgentReadTool(value: unknown): value is (typeof CANVAS_AGENT_READ_TOOL_NAMES)[number] {
    return typeof value === "string" && (CANVAS_AGENT_READ_TOOL_NAMES as readonly string[]).includes(value);
}
