import type { AgentConversation, AgentMessage } from "./types";

export const CANVAS_AGENT_URL_STORAGE_KEY = "canvas-agent-url";
export const CANVAS_AGENT_TOKEN_STORAGE_KEY = "canvas-agent-token";
export const DEFAULT_CANVAS_AGENT_URL = "http://127.0.0.1:17371";
export const MAX_SAVED_AGENT_CONVERSATIONS = 20;

export function agentConversationStorageKey(projectId: string) {
  return `canvas-agent-conversations:${projectId}`;
}

export function loadAgentConnectionSettings(storage: Storage = localStorage) {
  return {
    url: storage.getItem(CANVAS_AGENT_URL_STORAGE_KEY) ?? DEFAULT_CANVAS_AGENT_URL,
    token: storage.getItem(CANVAS_AGENT_TOKEN_STORAGE_KEY) ?? "",
  };
}

export function persistAgentConnectionSettings(
  url: string,
  token: string,
  storage: Storage = localStorage,
) {
  storage.setItem(CANVAS_AGENT_URL_STORAGE_KEY, url.trim().replace(/\/$/, ""));
  storage.setItem(CANVAS_AGENT_TOKEN_STORAGE_KEY, token);
}

export function loadAgentConversations(
  projectId: string,
  storage: Storage = localStorage,
): AgentConversation[] {
  try {
    const raw = storage.getItem(agentConversationStorageKey(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AgentConversation[];
    return Array.isArray(parsed)
      ? parsed.filter(isStoredAgentConversation)
      : [];
  } catch {
    return [];
  }
}

export function persistAgentConversations(
  projectId: string,
  conversations: AgentConversation[],
  storage: Storage = localStorage,
) {
  try {
    storage.setItem(
      agentConversationStorageKey(projectId),
      JSON.stringify(conversations.slice(0, MAX_SAVED_AGENT_CONVERSATIONS)),
    );
  } catch {
    // 存储失败（如配额不足）时静默降级，仅保留内存态。
  }
}

export function upsertAgentConversation(
  conversations: AgentConversation[],
  conversationId: string,
  messages: AgentMessage[],
  updatedAt = Date.now(),
) {
  const existing = conversations.find((item) => item.id === conversationId);
  const firstUser = messages.find((message) => message.role === "user");
  const title = existing?.title
    ?? (firstUser ? firstUser.text.slice(0, 24) : "新建对话");
  const entry: AgentConversation = {
    id: conversationId,
    title,
    updatedAt,
    messages,
  };
  return [
    entry,
    ...conversations.filter((item) => item.id !== conversationId),
  ].slice(0, MAX_SAVED_AGENT_CONVERSATIONS);
}

function isStoredAgentConversation(value: unknown): value is AgentConversation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<AgentConversation>;
  return typeof candidate.id === "string" && Array.isArray(candidate.messages);
}
