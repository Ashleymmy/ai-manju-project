import type { AgentConversation, AgentMessage } from "./types";
import { agentConversationScopeKey, ownsAgentTextReceipt, type AgentConversationOwner } from "./textReceipt";

export const CANVAS_AGENT_URL_STORAGE_KEY = "canvas-agent-url";
export const CANVAS_AGENT_TOKEN_STORAGE_KEY = "canvas-agent-token";
export const DEFAULT_CANVAS_AGENT_URL = "http://127.0.0.1:17371";
export const MAX_SAVED_AGENT_CONVERSATIONS = 20;

export function agentConversationStorageKey(projectId: string) {
  return `canvas-agent-conversations:${projectId}`;
}

export function loadScopedAgentConversations(owner: AgentConversationOwner, storage: Storage = localStorage): AgentConversation[] {
  if (!owner.userId) return [];
  const key = agentConversationScopeKey(owner);
  let conversations: AgentConversation[] = [];
  try {
    if (storage.getItem(agentConversationStorageKey(key)) !== null) conversations = loadAgentConversations(key, storage);
    // Only legacy global chats encoded an owner. Preserve unowned canvas history
    // under its original key instead of assigning it to the next signed-in user.
    else if (owner.scope === "personal" && owner.projectId === `studio:${owner.userId}`) {
      const legacy = loadAgentConversations(owner.projectId, storage);
      if (legacy.length) persistAgentConversations(key, legacy, storage);
      conversations = legacy;
    }
    // A receipt has its own key: another tab saving a stale conversation list
    // cannot erase its recovery identity. Only unfinished replies are restored.
    const prefix = agentReceiptStoragePrefix(owner);
    for (let i = 0; i < storage.length; i++) {
      const storedKey = storage.key(i);
      if (!storedKey?.startsWith(prefix)) continue;
      try {
        const record = JSON.parse(storage.getItem(storedKey) || "null") as { message?: AgentMessage; title?: string; updatedAt?: number };
        const message = record?.message;
        const receipt = message?.receipt;
        if (!receipt || !message || receipt.state !== "pending" || !ownsAgentTextReceipt(receipt, owner, receipt.conversationId)
          || storedKey !== `${prefix}${receipt.key}` || typeof message.text !== "string" || typeof message.id !== "string") continue;
        const entry = conversations.find(item => item.id === receipt.conversationId);
        if (entry?.messages.some(item => item.receipt?.key === receipt.key)) continue;
        const recovered = entry ? { ...entry, messages: [...entry.messages, message] }
          : { id: receipt.conversationId, title: record.title || "待恢复回复", updatedAt: record.updatedAt || 0, messages: [message] };
        conversations = [recovered, ...conversations.filter(item => item.id !== recovered.id)];
      } catch { /* a malformed entry cannot hide other valid scoped receipts */ }
    }
  } catch { /* unavailable storage remains a submission-time error */ }
  return retainAgentConversations(conversations);
}

function agentReceiptStoragePrefix(owner: AgentConversationOwner) {
  return `canvas-agent-receipt:${agentConversationScopeKey(owner)}:`;
}

/** Retain only pending recovery identities; completed replies live in the chat. */
export function persistAgentReceiptMessage(message: AgentMessage, title: string, storage: Storage = localStorage) {
  const receipt = message.receipt;
  if (!receipt || !ownsAgentTextReceipt(receipt, receipt, receipt.conversationId)) return false;
  try {
    const key = `${agentReceiptStoragePrefix(receipt)}${receipt.key}`;
    if (receipt.state === "pending") storage.setItem(key, JSON.stringify({ message, title, updatedAt: Date.now() }));
    // Called only after the reply/terminal status is saved in its conversation.
    // Remove just the redundant browser recovery pointer, never the conversation
    // or the original server receipt. This journal must not fill storage forever.
    else storage.removeItem(key);
    return true;
  } catch { return false; }
}

function retainAgentConversations(conversations: AgentConversation[]) {
  let completed = 0;
  // A new chat cannot silently discard an unresolved paid response receipt.
  return conversations.filter(item => item.messages.some(message => message.receipt?.state === "pending")
    || completed++ < MAX_SAVED_AGENT_CONVERSATIONS);
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
      ? parsed.filter(isStoredAgentConversation).map(item => ({
        ...item,
        title: typeof item.title === "string" ? item.title : "历史对话",
        updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : 0,
        messages: item.messages.filter(isStoredAgentMessage),
      }))
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
      JSON.stringify(retainAgentConversations(conversations)),
    );
    return true;
  } catch {
    return false;
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
  return retainAgentConversations([
    entry,
    ...conversations.filter((item) => item.id !== conversationId),
  ]);
}

function isStoredAgentConversation(value: unknown): value is AgentConversation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<AgentConversation>;
  return typeof candidate.id === "string" && Array.isArray(candidate.messages);
}

function isStoredAgentMessage(value: unknown): value is AgentMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<AgentMessage>;
  return typeof candidate.id === "string" && typeof candidate.text === "string"
    && typeof candidate.role === "string" && ["user", "assistant", "tool", "error"].includes(candidate.role);
}
