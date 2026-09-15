import crypto from "node:crypto";
import type { ServerResponse } from "node:http";
import { CANVAS_AGENT_PROTOCOL_VERSION, isCanvasAgentReadTool } from "@ai-manju/canvas-agent-protocol";

import { CANVAS_TOOL_TIMEOUT_MS } from "./config.js";
import { type ToolName } from "./schemas.js";
import { compactCanvasState, compactNode, isToolName, nextCanvasX, parseToolInput } from "./tools.js";
import type { CanvasNode, CanvasNodeType, CanvasSnapshot } from "./types.js";

type PendingRequest = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type ClientSession = {
    response: ServerResponse | null;
    snapshot: CanvasSnapshot | null;
    pending: Map<string, PendingRequest>;
    generation: number;
};

export class CanvasSession {
    private sessions = new Map<string, ClientSession>();

    health() {
        const sessions = [...this.sessions.values()];
        return { ok: true, protocolVersion: CANVAS_AGENT_PROTOCOL_VERSION, hasCanvas: sessions.some((item) => Boolean(item.snapshot)), clients: sessions.filter((item) => Boolean(item.response)).length };
    }

    openEvents(url: URL, res: ServerResponse) {
        const clientId = url.searchParams.get("clientId") || crypto.randomUUID();
        const session = this.getSession(clientId);
        if (session.response && session.response !== res) {
            const previous = session.response;
            session.response = null;
            this.rejectPending(session, "画布连接已重置");
            previous.end();
        }
        session.generation += 1;
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        this.sessions.set(clientId, session);
        session.response = res;
        sendEvent(res, "hello", { ok: true, protocolVersion: CANVAS_AGENT_PROTOCOL_VERSION, clientId });
        const timer = setInterval(() => sendEvent(res, "ping", { time: Date.now() }), 15000);
        res.on("close", () => {
            clearInterval(timer);
            if (session.response !== res) return;
            session.response = null;
            this.rejectPending(session, "画布连接已断开");
            this.sessions.delete(clientId);
        });
    }

    updateState(body: unknown, clientId?: string) {
        const session = this.requireSession(clientId);
        session.snapshot = { ...((body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>), protocolVersion: CANVAS_AGENT_PROTOCOL_VERSION, clientId } as CanvasSnapshot;
    }

    resolveResult(body: { requestId?: string; error?: string; result?: unknown }, clientId?: string) {
        const session = this.requireSession(clientId);
        const item = body.requestId ? session.pending.get(body.requestId) : null;
        if (!item || !body.requestId) return;
        session.pending.delete(body.requestId);
        const snapshot = body.result && typeof body.result === "object" ? (body.result as { snapshot?: CanvasSnapshot }).snapshot : undefined;
        if (snapshot) session.snapshot = { ...snapshot, protocolVersion: CANVAS_AGENT_PROTOCOL_VERSION, clientId };
        body.error ? item.reject(new Error(body.error)) : item.resolve(body.result);
    }

    connectionGeneration(clientId: string | undefined) {
        return clientId ? this.sessions.get(clientId)?.generation || 0 : 0;
    }

    emit(clientId: string | undefined, type: string, payload: unknown, generation = this.connectionGeneration(clientId)) {
        if (!clientId) return;
        const session = this.sessions.get(clientId);
        if (!session || session.generation !== generation) return;
        const response = session.response;
        if (response) sendEvent(response, type, payload);
    }

    async callTool(name: unknown, rawInput: unknown, clientId?: string) {
        if (!isToolName(name)) throw new Error(`未知工具：${String(name)}`);
        const session = this.requireSession(clientId);
        if (!session.response) throw new Error("当前没有已连接画布");
        let tool: ToolName = name;
        let input = parseToolInput(tool, rawInput) as Record<string, unknown>;
        const readTool = isCanvasAgentReadTool(tool);
        if (readTool && !session.snapshot) throw new Error("当前没有已同步画布");
        if (tool === "canvas_get_state" || tool === "canvas_export_snapshot") return compactCanvasState(session.snapshot);
        if (tool === "canvas_get_selection") {
            const ids = new Set(session.snapshot?.selectedNodeIds || []);
            return { nodes: (session.snapshot?.nodes || []).filter((node) => ids.has(node.id)).map(compactNode) };
        }
        if (tool === "canvas_search_assets" || tool === "canvas_add_assets" || tool === "canvas_list_jobs" || tool === "canvas_cancel_job") {
            return await this.requestCanvasTool(session, tool, input);
        }
        if (tool === "canvas_create_node") {
            const data = input as { nodeType: CanvasNodeType; title?: string; x?: number; y?: number; width?: number; height?: number; metadata?: Record<string, unknown> };
            input = { ops: [{ type: "add_node", nodeType: data.nodeType, title: data.title, position: { x: data.x ?? nextCanvasX(session.snapshot), y: data.y ?? 0 }, width: data.width, height: data.height, metadata: data.metadata }] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_create_text_node") {
            const text = input as { text?: string; x?: number; y?: number; title?: string; width?: number; height?: number };
            input = { ops: [textNodeOp(text, text.x ?? nextCanvasX(session.snapshot), text.y ?? 0)] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_create_text_nodes") {
            const data = input as { items: Array<{ text: string; title?: string; x?: number; y?: number; width?: number; height?: number }>; x?: number; y?: number; gap?: number; direction?: "row" | "column" };
            const x = Number(data.x ?? nextCanvasX(session.snapshot));
            const y = Number(data.y ?? 0);
            const gap = Number(data.gap ?? 40);
            input = {
                ops: data.items.map((item, index) => textNodeOp(item, item.x ?? (data.direction === "row" ? x + index * (340 + gap) : x), item.y ?? (data.direction === "row" ? y : y + index * (240 + gap)))),
            };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_create_image_prompt_flow") {
            input = { ops: generationFlowOps({ ...(input as Record<string, unknown>), mode: "image" }, session.snapshot) };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_create_config_node") {
            const data = input as Record<string, unknown>;
            const x = Number(data.x ?? nextCanvasX(session.snapshot));
            const y = Number(data.y ?? 0);
            const configId = `config-${crypto.randomUUID()}`;
            const mode = generationMode(data.mode);
            const prompt = String(data.prompt || "");
            input = { ops: [configNodeOp(configId, data, x, y), ...(data.autoRun ? [runGenerationOp(configId, mode, prompt)] : [])] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_create_generation_flow") {
            input = { ops: generationFlowOps(input as Record<string, unknown>, session.snapshot) };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_generate_text" || tool === "canvas_generate_image" || tool === "canvas_generate_video" || tool === "canvas_generate_audio") {
            input = { ops: generationFlowOps({ ...(input as Record<string, unknown>), mode: tool.replace("canvas_generate_", ""), autoRun: true }, session.snapshot) };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_update_node") {
            const data = input as { id: string; patch?: Record<string, unknown>; metadata?: Record<string, unknown> };
            input = { ops: [{ type: "update_node", id: data.id, patch: data.patch, metadata: data.metadata }] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_update_node_text") {
            const data = input as { id: string; text: string; title?: string };
            input = { ops: [{ type: "update_node", id: data.id, patch: { ...(data.title ? { title: data.title } : {}) }, metadata: { content: data.text, status: "success" } }] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_move_nodes") {
            const data = input as { items: Array<{ id: string; x?: number; y?: number; dx?: number; dy?: number }> };
            input = {
                ops: data.items.map((item) => {
                    const current = findNode(session.snapshot, item.id);
                    return { type: "update_node", id: item.id, patch: { position: { x: item.x ?? ((current?.position.x || 0) + (item.dx || 0)), y: item.y ?? ((current?.position.y || 0) + (item.dy || 0)) } } };
                }),
            };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_resize_node") {
            const data = input as { id: string; width: number; height: number; freeResize?: boolean };
            input = { ops: [{ type: "update_node", id: data.id, patch: { width: data.width, height: data.height }, metadata: data.freeResize === undefined ? undefined : { freeResize: data.freeResize } }] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_delete_nodes") {
            input = { ops: [{ type: "delete_node", ids: (input as { ids: string[] }).ids }] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_connect_nodes") {
            const data = input as { connections: Array<{ fromNodeId: string; toNodeId: string }> };
            input = { ops: data.connections.map((connection) => ({ type: "connect_nodes", ...connection })) };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_select_nodes") {
            input = { ops: [{ type: "select_nodes", ids: (input as { ids: string[] }).ids }] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_set_viewport") {
            input = { ops: [{ type: "set_viewport", viewport: (input as { viewport: unknown }).viewport }] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_run_generation") {
            const data = input as { nodeId: string; mode?: string; prompt?: string };
            input = { ops: [runGenerationOp(data.nodeId, generationMode(data.mode), data.prompt)] };
            tool = "canvas_apply_ops";
        }
        if (tool !== "canvas_apply_ops") throw new Error(`未知工具：${tool}`);
        return await this.requestCanvasTool(session, tool, input);
    }

    private async requestCanvasTool(session: ClientSession, name: ToolName, input: Record<string, unknown>) {
        const requestId = crypto.randomUUID();
        const client = session.response;
        if (!client) throw new Error("当前没有已连接画布");
        sendEvent(client, "tool_call", {
            protocolVersion: CANVAS_AGENT_PROTOCOL_VERSION,
            requestId,
            name,
            input,
            requiresConfirmation: !isCanvasAgentReadTool(name),
        });
        return await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                session.pending.delete(requestId);
                reject(new Error("画布操作超时"));
            }, CANVAS_TOOL_TIMEOUT_MS);
            session.pending.set(requestId, { resolve: (value) => (clearTimeout(timer), resolve(value)), reject: (error) => (clearTimeout(timer), reject(error)) });
        });
    }

    private getSession(clientId: string) {
        let session = this.sessions.get(clientId);
        if (!session) {
            session = { response: null, snapshot: null, pending: new Map(), generation: 0 };
            this.sessions.set(clientId, session);
        }
        return session;
    }

    private requireSession(clientId?: string) {
        if (!clientId) throw new Error("缺少画布 clientId");
        return this.getSession(clientId);
    }

    private rejectPending(session: ClientSession, message: string) {
        const error = new Error(message);
        [...session.pending.values()].forEach((item) => item.reject(error));
        session.pending.clear();
    }
}

function sendEvent(res: ServerResponse, type: string, payload: unknown) {
    res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function textNodeOp(input: { id?: string; text?: string; title?: string; width?: number; height?: number }, x: number, y: number) {
    return { type: "add_node", id: input.id, nodeType: "text", title: input.title, position: { x, y }, width: input.width, height: input.height, metadata: { content: input.text || "", status: "success", fontSize: 14 } };
}

function configNodeOp(id: string, input: Record<string, unknown>, x: number, y: number) {
    const mode = generationMode(input.mode);
    const prompt = String(input.prompt || "");
    return {
        type: "add_node",
        id,
        nodeType: "config",
        title: String(input.title || generationTitle(mode)),
        position: { x, y },
        width: typeof input.width === "number" ? input.width : undefined,
        height: typeof input.height === "number" ? input.height : undefined,
        metadata: cleanRecord({
            generationMode: mode,
            composerContent: prompt,
            prompt,
            status: "idle",
            model: input.model,
            size: typeof input.size === "string" && input.size.trim() ? input.size : "auto",
            quality: input.quality,
            count: input.count,
            seconds: input.seconds,
            vquality: input.vquality,
            generateAudio: input.generateAudio,
            watermark: input.watermark,
            audioVoice: input.audioVoice,
            audioFormat: input.audioFormat,
            audioSpeed: input.audioSpeed,
            audioInstructions: input.audioInstructions,
        }),
    };
}

function generationFlowOps(input: Record<string, unknown>, state: CanvasSnapshot | null) {
    const mode = generationMode(input.mode);
    const prompt = String(input.prompt || "");
    const x = Number(input.x ?? nextCanvasX(state));
    const y = Number(input.y ?? 0);
    const textId = `text-${crypto.randomUUID()}`;
    const configId = `config-${crypto.randomUUID()}`;
    const referenceNodeIds = Array.isArray(input.referenceNodeIds) ? input.referenceNodeIds.filter((id): id is string => typeof id === "string") : [];
    const tokens = [`@[node:${textId}]`, ...referenceNodeIds.map((id) => `@[node:${id}]`)];
    const configInput = { ...input, prompt: tokens.join("\n") };
    return [
        textNodeOp({ id: textId, text: prompt, title: String(input.title || "提示词") }, x, y),
        configNodeOp(configId, configInput, x + 420, y),
        { type: "connect_nodes", fromNodeId: textId, toNodeId: configId },
        ...referenceNodeIds.map((fromNodeId) => ({ type: "connect_nodes", fromNodeId, toNodeId: configId })),
        { type: "select_nodes", ids: [configId] },
        ...(input.autoRun ? [runGenerationOp(configId, mode, tokens.join("\n"))] : []),
    ];
}

function runGenerationOp(nodeId: string, mode: "text" | "image" | "video" | "audio", prompt?: string) {
    return { type: "run_generation", nodeId, mode, prompt };
}

function generationMode(value: unknown): "text" | "image" | "video" | "audio" {
    return value === "text" || value === "video" || value === "audio" ? value : "image";
}

function generationTitle(mode: "text" | "image" | "video" | "audio") {
    if (mode === "text") return "文本生成";
    if (mode === "video") return "视频生成";
    if (mode === "audio") return "音频生成";
    return "图片生成";
}

function findNode(state: CanvasSnapshot | null, id: string): CanvasNode | undefined {
    return (state?.nodes || []).find((node) => node.id === id);
}

function cleanRecord(value: Record<string, unknown>) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ""));
}
