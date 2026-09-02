import { fetchModelCatalog, fetchTextModelCatalog, normalizeModelList } from "@/entities/model";
import type { CapabilityModelCatalog } from "@/entities/model";
import { ApiError, request } from "./request";

export type { AiModelsResponse } from "@/entities/model";
export type TextModelCatalog = CapabilityModelCatalog;

export type ResponseMessageContent = string | Array<{ type?: string; text?: string; image_url?: { url?: string } }>;

export type ResponseInputMessage =
  | { role: "system" | "user" | "assistant"; content: ResponseMessageContent }
  | { role: "tool"; content: string; tool_call_id?: string }
  | { type: "function_call"; call_id: string; name: string; arguments: string };

export type ResponseFunctionTool = {
  type: "function";
  function: { name: string; description?: string; parameters?: Record<string, unknown> };
};

export type ResponseToolCall = {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
};

export type ToolChoice = "auto" | "required" | { type: "function"; name: string };

export type AiTextRequest = {
  messages?: ResponseInputMessage[];
  tools?: ResponseFunctionTool[];
  tool_choice?: ToolChoice;
  parallel_tool_calls?: false;
  model?: string;
  prompt?: string;
  stream?: false;
};

export type AiTextResponse = {
  content?: string;
  text?: string;
  model?: string;
  toolCalls?: ResponseToolCall[];
  tool_calls?: ResponseToolCall[];
  finish_reason?: string;
};

export class AiRequestError extends Error {
  readonly status: number;
  readonly requestId?: string;
  readonly cancelled: boolean;

  constructor(message: string, options: { status: number; requestId?: string; cancelled?: boolean }) {
    super(message);
    this.name = "AiRequestError";
    this.status = options.status;
    this.requestId = options.requestId;
    this.cancelled = Boolean(options.cancelled);
  }
}

export async function fetchAiModels() {
  try {
    return await fetchModelCatalog();
  } catch (error) {
    throw new Error(formatPublicAiError(error));
  }
}

export async function fetchTextModels(): Promise<TextModelCatalog> {
  return fetchTextModelCatalog({ includeGenericModels: true, normalizeMetadata: true });
}

export async function requestAiText(body: AiTextRequest, signal?: AbortSignal) {
  try {
    const data = await request<AiTextResponse>("/api/ai/text", {
      method: "POST",
      signal,
      body: {
        ...body,
        prompt: body.prompt || messagesToPrompt(body.messages || []),
        parallel_tool_calls: false,
        stream: false,
      },
    });
    return {
      content: data.content || data.text || "",
      model: data.model || body.model || "",
      toolCalls: data.toolCalls || data.tool_calls || [],
      finishReason: data.finish_reason || "",
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw new AiRequestError(formatPublicAiError(error), {
        status: error.status,
        requestId: error.requestId,
        cancelled: error.status === 0 && error.message.includes("请求已取消"),
      });
    }
    throw new Error(formatPublicAiError(error));
  }
}

export { normalizeModelList };

function messagesToPrompt(messages: ResponseInputMessage[]) {
  return messages
    .map((message) => {
      if (!("role" in message)) return `${message.name}(${message.arguments})`;
      if (message.role === "tool") return message.content;
      return messageContentToText(message.content);
    })
    .filter(Boolean)
    .join("\n\n");
}

function messageContentToText(content: ResponseMessageContent) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (item.type === "text" || item.type === "input_text") return item.text || "";
      if (item.type === "image_url" || item.type === "input_image") return item.image_url?.url ? `[image: ${item.image_url.url}]` : "[image]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function formatPublicAiError(error: unknown) {
  if (error instanceof ApiError) {
    const suffix = error.requestId ? ` (request_id: ${error.requestId})` : "";
    if (error.status === 401) return `登录状态已失效，请重新登录${suffix}`;
    if (error.status === 403) return `当前账号无权使用模型服务${suffix}`;
    return error.message || `模型服务暂不可用，请联系管理员配置模型服务${suffix}`;
  }
  return "模型服务暂不可用，请联系管理员配置模型服务";
}
