import {
  canvasAgentToolToOps,
  compactCanvasAgentSnapshot,
  isCanvasAgentToolName,
  isCanvasAgentWorkspaceTool,
  summarizeCanvasAgentOps,
  type CanvasAgentExecutionResult,
  type CanvasAgentOp,
  type CanvasAgentSnapshot,
} from "@/lib/canvas-agent";

import type { AgentToolResult, PendingAgentTool } from "./types";

export type CanvasAgentProtocolBindings = {
  getSnapshot: () => CanvasAgentSnapshot;
  setSnapshot: (snapshot: CanvasAgentSnapshot) => void;
  applyOps: (ops: CanvasAgentOp[]) => Promise<CanvasAgentExecutionResult>;
  executeWorkspaceTool: (
    name: string,
    input: Record<string, unknown>,
  ) => Promise<AgentToolResult>;
};

export async function executeCanvasAgentTool(
  name: string,
  input: Record<string, unknown>,
  bindings: CanvasAgentProtocolBindings,
): Promise<AgentToolResult> {
  if (!isCanvasAgentToolName(name)) {
    return { ok: false, message: `不支持的工具：${name}` };
  }
  if (isCanvasAgentWorkspaceTool(name)) {
    return bindings.executeWorkspaceTool(name, input);
  }
  const current = bindings.getSnapshot();
  if (name === "canvas_get_state" || name === "canvas_export_snapshot") {
    return {
      ok: true,
      message: describeCanvasAgentSnapshot(current),
      data: compactCanvasAgentSnapshot(current),
    };
  }
  if (name === "canvas_get_selection") {
    const selected = new Set(current.selectedNodeIds);
    const selection = {
      ...current,
      nodes: current.nodes.filter(node => selected.has(node.id)),
    };
    return {
      ok: true,
      message: `当前选中 ${selection.nodes.length} 个节点。`,
      data: compactCanvasAgentSnapshot(selection),
    };
  }
  const ops = canvasAgentToolToOps(name, input, current);
  if (!ops.length) {
    return { ok: false, message: `${canvasAgentToolLabel(name)}没有生成可执行操作。` };
  }
  const before = JSON.stringify(compactCanvasAgentSnapshot(current));
  const execution = await bindings.applyOps(ops);
  bindings.setSnapshot(execution.snapshot);
  const after = JSON.stringify(compactCanvasAgentSnapshot(execution.snapshot));
  const failedGeneration = execution.generationResults.find(
    item => item.status !== "succeeded",
  );
  const changed = before !== after || execution.generationResults.length > 0;
  const generationSummary = summarizeGenerationResults(
    execution.generationResults,
  );
  return {
    ok: changed && !failedGeneration,
    message: changed
      ? [
          summarizeCanvasAgentOps(ops) || canvasAgentToolLabel(name),
          generationSummary,
        ].filter(Boolean).join("；")
      : "操作未生效，请核对节点 ID 和工具参数。",
    data: {
      snapshot: compactCanvasAgentSnapshot(execution.snapshot),
      generationResults: execution.generationResults,
    },
  };
}

export function pendingAgentToolSummary(pending: PendingAgentTool) {
  if (pending.source === "local") {
    return canvasAgentToolLabel(pending.request.name);
  }
  return pending.calls.map(call => canvasAgentToolLabel(call.name)).join("，")
    || "画布工具";
}

export function pendingAgentToolDetail(pending: PendingAgentTool) {
  if (pending.source === "online") {
    return `在线助手请求执行 ${pending.calls.length} 个工具。`;
  }
  const ops = Array.isArray(pending.request.input?.ops)
    ? pending.request.input.ops as CanvasAgentOp[]
    : [];
  return summarizeCanvasAgentOps(ops) || "本地 Agent 请求修改当前画布。";
}

export function describeCanvasAgentSnapshot(snapshot: CanvasAgentSnapshot) {
  const counts = snapshot.nodes.reduce<Record<string, number>>((result, node) => {
    result[node.type] = (result[node.type] || 0) + 1;
    return result;
  }, {});
  const breakdown = Object.entries(counts)
    .map(([type, count]) => `${type} ${count}`)
    .join("，");
  return `当前画布有 ${snapshot.nodes.length} 个节点、${snapshot.connections.length} 条连线${breakdown ? `；${breakdown}` : ""}。`;
}

export function summarizeGenerationResults(
  results: CanvasAgentExecutionResult["generationResults"],
) {
  if (!results.length) return "";
  return results.map(item => {
    const outputs = item.outputNodeIds.length
      ? `，输出 ${item.outputNodeIds.length} 个节点`
      : "";
    return `${item.mode} ${item.status}${outputs}${item.error ? `：${item.error}` : ""}`;
  }).join("；");
}

export function canvasAgentToolLabel(name: string) {
  const labels: Record<string, string> = {
    canvas_get_state: "读取画布",
    canvas_get_selection: "读取选区",
    canvas_export_snapshot: "导出快照",
    canvas_search_assets: "搜索资产",
    canvas_add_assets: "添加资产",
    canvas_list_jobs: "查看生成任务",
    canvas_cancel_job: "取消生成任务",
    canvas_apply_ops: "画布操作",
    canvas_create_node: "创建节点",
    canvas_create_text_node: "创建文本",
    canvas_create_text_nodes: "批量创建文本",
    canvas_create_config_node: "创建生成配置",
    canvas_create_image_prompt_flow: "创建生图流程",
    canvas_create_generation_flow: "创建生成流程",
    canvas_generate_text: "生成文本",
    canvas_generate_image: "生成图片",
    canvas_generate_video: "生成视频",
    canvas_generate_audio: "生成音频",
    canvas_update_node: "更新节点",
    canvas_update_node_text: "更新文本",
    canvas_move_nodes: "移动节点",
    canvas_resize_node: "调整节点尺寸",
    canvas_delete_nodes: "删除节点",
    canvas_connect_nodes: "连接节点",
    canvas_select_nodes: "选择节点",
    canvas_set_viewport: "调整视口",
    canvas_run_generation: "触发生成",
  };
  return labels[name] || name;
}
