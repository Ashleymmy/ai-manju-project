import {
  requestAiText,
  type AiTextRequest,
  type ResponseFunctionTool,
  type ResponseInputMessage,
  type ResponseToolCall,
  type ToolChoice,
} from "@/services/api/ai";
import {
  CANVAS_AGENT_TOOLS,
  compactCanvasAgentSnapshot,
  isCanvasAgentReadTool,
  type CanvasAgentSnapshot,
} from "@/lib/canvas-agent";

import type {
  AgentMessage,
  AgentToolExecution,
  AgentToolResult,
  NormalizedToolCall,
  OnlineToolContext,
} from "./types";

export const ONLINE_AGENT_MAX_STEPS = 4;
export const ONLINE_AGENT_PROMPT = "你是 AI-Manju 的在线画布助手。首轮必须调用工具：只读问题调用 canvas_get_state，需要改动画布时调用对应画布工具。需要生成内容时调用 canvas_generate_text、canvas_generate_image、canvas_generate_video、canvas_generate_audio 或 canvas_create_generation_flow。不要输出伪造的 JSON ops，不要编造执行结果。涉及已有节点时只能使用当前画布快照中的真实 id；信息不足时先向用户说明。工具返回后必须依据真实结果回答。";

const ONLINE_AGENT_TOOLS: ResponseFunctionTool[] = CANVAS_AGENT_TOOLS.map(item => ({
  type: "function",
  function: { ...item.function },
}));

export type CanvasOnlineAgentLoopBindings = {
  getModel: () => string;
  shouldConfirmTools: () => boolean;
  executeTool: (
    name: string,
    input: Record<string, unknown>,
  ) => Promise<AgentToolResult>;
  onPending: (context: OnlineToolContext) => void;
  onAssistantMessage: (id: string, text: string) => void;
  onToolResults: (results: AgentToolExecution[]) => void;
  onActivity: (activity: string) => void;
  onWaiting: (waiting: boolean) => void;
};

export type CanvasOnlineAgentLoopServices = {
  requestText: (body: AiTextRequest) => ReturnType<typeof requestAiText>;
};

const browserServices: CanvasOnlineAgentLoopServices = {
  requestText: requestAiText,
};

const emptyBindings: CanvasOnlineAgentLoopBindings = {
  getModel: () => "",
  shouldConfirmTools: () => true,
  executeTool: async () => ({ ok: false, message: "Agent tool loop 未初始化" }),
  onPending: () => undefined,
  onAssistantMessage: () => undefined,
  onToolResults: () => undefined,
  onActivity: () => undefined,
  onWaiting: () => undefined,
};

export class CanvasOnlineAgentLoop {
  private bindings = emptyBindings;

  constructor(
    private readonly services: CanvasOnlineAgentLoopServices = browserServices,
  ) {}

  updateBindings(bindings: CanvasOnlineAgentLoopBindings) {
    this.bindings = bindings;
  }

  readonly runStep = async (
    requestMessages: ResponseInputMessage[],
    step: number,
    assistantId: string,
    toolChoice: ToolChoice = "auto",
  ): Promise<void> => {
    const response = await this.services.requestText({
      model: this.bindings.getModel(),
      messages: requestMessages,
      tools: ONLINE_AGENT_TOOLS,
      tool_choice: toolChoice,
    });
    const calls = normalizeOnlineToolCalls(response.toolCalls);
    if (!calls.length) {
      this.bindings.onAssistantMessage(
        assistantId,
        response.content || "模型没有返回内容。",
      );
      this.bindings.onActivity(response.model ? `完成 · ${response.model}` : "完成");
      this.bindings.onWaiting(false);
      return;
    }
    if (
      this.bindings.shouldConfirmTools()
      && calls.some(call => !isCanvasAgentReadTool(call.name))
    ) {
      const context: OnlineToolContext = {
        source: "online",
        calls,
        messages: requestMessages,
        step,
        assistantId,
      };
      this.bindings.onPending(context);
      if (response.content.trim()) {
        this.bindings.onAssistantMessage(assistantId, response.content.trim());
      }
      this.bindings.onActivity("等待确认");
      this.bindings.onWaiting(false);
      return;
    }
    await this.continue({
      source: "online",
      calls,
      messages: requestMessages,
      step,
      assistantId,
    });
  };

  readonly continue = async (context: OnlineToolContext): Promise<void> => {
    this.bindings.onWaiting(true);
    this.bindings.onActivity("执行画布工具");
    const results = await executeAgentToolCalls(
      context.calls,
      this.bindings.executeTool,
    );
    const failed = results.some(item => !item.result.ok);
    this.bindings.onToolResults(results);
    if (failed || context.step >= ONLINE_AGENT_MAX_STEPS) {
      this.bindings.onAssistantMessage(
        context.assistantId,
        failed
          ? "工具执行未完成，请根据上方真实错误调整操作。"
          : results.map(item => item.result.message).join("\n") || "工具已执行。",
      );
      this.bindings.onActivity(failed ? "工具失败" : "完成");
      this.bindings.onWaiting(false);
      return;
    }
    const nextMessages: ResponseInputMessage[] = [
      ...context.messages,
      ...context.calls.map((call): ResponseInputMessage => ({
        type: "function_call",
        call_id: call.id,
        name: call.name,
        arguments: call.arguments,
      })),
      ...results.map((item): ResponseInputMessage => ({
        role: "tool",
        tool_call_id: item.toolCallId,
        content: JSON.stringify(item.result),
      })),
    ];
    await this.runStep(nextMessages, context.step + 1, context.assistantId);
  };
}

export function buildOnlineAgentMessages(
  history: AgentMessage[],
  snapshot: CanvasAgentSnapshot,
  prompt: string,
): ResponseInputMessage[] {
  return [
    { role: "system", content: ONLINE_AGENT_PROMPT },
    ...history
      .filter(message => message.role === "user" || message.role === "assistant")
      .slice(-8)
      .map((message): ResponseInputMessage => ({
        role: message.role as "user" | "assistant",
        content: message.text,
      })),
    {
      role: "user",
      content: `当前画布：${JSON.stringify(compactCanvasAgentSnapshot(snapshot))}\n\n用户需求：${prompt}`,
    },
  ];
}

export function normalizeOnlineToolCalls(
  calls: ResponseToolCall[],
  now = Date.now,
): NormalizedToolCall[] {
  return calls.flatMap((call, index) => {
    const name = call.function?.name?.trim();
    if (!name) return [];
    return [{
      id: call.id?.trim() || `call-${now()}-${index}`,
      name,
      arguments: call.function?.arguments || "{}",
    }];
  });
}

export function parseOnlineToolArguments(value: string) {
  try {
    const parsed = JSON.parse(value || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("工具参数必须是 JSON 对象");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("工具参数不是合法 JSON 对象");
  }
}

export async function executeAgentToolCalls(
  calls: NormalizedToolCall[],
  executeTool: CanvasOnlineAgentLoopBindings["executeTool"],
) {
  const results: AgentToolExecution[] = [];
  let stopped = false;
  for (const call of calls) {
    if (stopped) {
      results.push({
        toolCallId: call.id,
        name: call.name,
        result: {
          ok: false,
          message: "前一个工具调用失败，后续工具未执行。",
        },
      });
      continue;
    }
    let result: AgentToolResult;
    try {
      result = await executeTool(
        call.name,
        parseOnlineToolArguments(call.arguments),
      );
    } catch (error) {
      result = {
        ok: false,
        message: error instanceof Error ? error.message : "工具执行失败",
      };
    }
    results.push({ toolCallId: call.id, name: call.name, result });
    if (!result.ok) stopped = true;
  }
  return results;
}
