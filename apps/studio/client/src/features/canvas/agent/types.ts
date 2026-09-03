import type { ResponseInputMessage } from "@/services/api/ai";
import type {
  CanvasAgentExecutionResult,
  CanvasAgentOp,
  CanvasAgentSnapshot,
  CanvasAgentToolRequest,
} from "@/lib/canvas-agent";

export type AgentMessage = {
  id: string;
  role: "user" | "assistant" | "error" | "tool";
  text: string;
};

export type AgentConversation = {
  id: string;
  title: string;
  updatedAt: number;
  messages: AgentMessage[];
};

export type AgentToolResult = {
  ok: boolean;
  message: string;
  data?: unknown;
};

export type AgentToolExecution = {
  toolCallId: string;
  name: string;
  result: AgentToolResult;
};

export type NormalizedToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type OnlineToolContext = {
  source: "online";
  calls: NormalizedToolCall[];
  messages: ResponseInputMessage[];
  step: number;
  assistantId: string;
};

export type PendingAgentTool =
  | { source: "local"; request: CanvasAgentToolRequest }
  | OnlineToolContext;

export type CanvasAgentPanelBindings = {
  snapshot: CanvasAgentSnapshot;
  onApplyOps: (ops: CanvasAgentOp[]) => Promise<CanvasAgentExecutionResult>;
  onExecuteWorkspaceTool: (
    name: string,
    input: Record<string, unknown>,
  ) => Promise<AgentToolResult>;
};
