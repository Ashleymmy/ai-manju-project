import { describe, expect, it, vi } from "vitest";

import {
  agentConversationStorageKey,
  loadAgentConversations,
  loadScopedAgentConversations,
  persistAgentConversations,
  persistAgentReceiptMessage,
  upsertAgentConversation,
} from "./conversationRepository";
import type { AgentConversation } from "./types";
import { agentConversationScopeKey, ownsAgentTextReceipt } from "./textReceipt";

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: key => items.get(key) ?? null,
    key: index => Array.from(items.keys())[index] ?? null,
    removeItem: key => { items.delete(key); },
    setItem: (key, value) => { items.set(key, value); },
  };
}

function conversation(id: string): AgentConversation {
  return {
    id,
    title: id,
    updatedAt: Number(id.replace(/\D/g, "")) || 0,
    messages: [],
  };
}

describe("Canvas Agent conversation repository", () => {
  it("keeps the project-scoped storage key and maximum of 20 conversations", () => {
    const storage = memoryStorage();
    const items = Array.from({ length: 23 }, (_, index) => conversation(`c-${index}`));

    persistAgentConversations("project/one", items, storage);

    expect(agentConversationStorageKey("project/one")).toBe(
      "canvas-agent-conversations:project/one",
    );
    expect(loadAgentConversations("project/one", storage)).toEqual(items.slice(0, 20));
  });

  it("uses the first user message as the title and keeps an existing title", () => {
    const userTitle = "这是一个超过二十四个字符但应该被截断的用户输入标题文本";
    const initial = upsertAgentConversation([], "active", [
      { id: "tool", role: "tool", text: "工具结果" },
      { id: "user", role: "user", text: userTitle },
    ], 100);
    const updated = upsertAgentConversation(initial, "active", [
      ...initial[0].messages,
      { id: "assistant", role: "assistant", text: "完成" },
    ], 200);

    expect(initial[0].title).toBe(userTitle.slice(0, 24));
    expect(updated[0].title).toBe(initial[0].title);
    expect(updated[0].updatedAt).toBe(200);
  });

  it("falls back to memory when stored data is invalid or storage throws", () => {
    const storage = memoryStorage();
    storage.setItem(agentConversationStorageKey("broken"), "{");
    expect(loadAgentConversations("broken", storage)).toEqual([]);

    const failing = memoryStorage();
    vi.spyOn(failing, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(persistAgentConversations("project", [conversation("one")], failing)).toBe(false);
  });

  it("skips malformed stored messages without hiding valid conversations or receipts", () => {
    const storage = memoryStorage();
    const owner = { userId: "one", projectId: "project", scope: "personal" as const };
    const receipt = { ...owner, version: 1 as const, conversationId: "valid", key: "original", model: "text", state: "pending" as const };
    const validMessage = { id: "reply", role: "assistant", text: "waiting", receipt };
    storage.setItem(agentConversationStorageKey(agentConversationScopeKey(owner)), JSON.stringify([
      { id: "malformed", title: {}, messages: [null, 123, {}, { id: "bad", role: "assistant", text: {} }] },
      { id: "valid", title: "valid", updatedAt: 1, messages: [validMessage] },
    ]));
    expect(loadScopedAgentConversations(owner, storage)).toEqual([
      { id: "malformed", title: "历史对话", updatedAt: 0, messages: [] },
      { id: "valid", title: "valid", updatedAt: 1, messages: [validMessage] },
    ]);
    expect(ownsAgentTextReceipt({ ...receipt, state: "unknown" } as unknown as typeof receipt, owner, "valid")).toBe(false);
    expect(ownsAgentTextReceipt({ ...receipt, model: "" }, owner, "valid")).toBe(false);
  });

  it("isolates account and scope and preserves unowned legacy canvas history", () => {
    const storage = memoryStorage();
    const owner = { userId: "user:one", projectId: "shared:canvas", scope: "personal" as const };
    persistAgentConversations(owner.projectId, [conversation("legacy")], storage);
    expect(loadScopedAgentConversations(owner, storage)).toEqual([]);
    persistAgentConversations(agentConversationScopeKey(owner), [conversation("owned")], storage);
    expect(loadScopedAgentConversations(owner, storage).map(item => item.id)).toEqual(["owned"]);
    expect(loadScopedAgentConversations({ ...owner, userId: "two" }, storage)).toEqual([]);
    expect(loadScopedAgentConversations({ ...owner, scope: "team" }, storage)).toEqual([]);
    expect(loadAgentConversations(owner.projectId, storage).map(item => item.id)).toEqual(["legacy"]);
  });

  it("migrates only an already owner-scoped global chat and never resurrects removed history", () => {
    const storage = memoryStorage();
    const owner = { userId: "one", projectId: "studio:one", scope: "personal" as const };
    persistAgentConversations(owner.projectId, [conversation("legacy")], storage);
    expect(loadScopedAgentConversations({ ...owner, userId: "two" }, storage)).toEqual([]);
    expect(loadScopedAgentConversations(owner, storage).map(item => item.id)).toEqual(["legacy"]);
    persistAgentConversations(agentConversationScopeKey(owner), [], storage);
    expect(loadScopedAgentConversations(owner, storage)).toEqual([]);
    expect(loadAgentConversations(owner.projectId, storage)).toHaveLength(1);
  });

  it("keeps unresolved receipts beyond the completed conversation history limit", () => {
    const storage = memoryStorage();
    const receipt = { version: 1 as const, userId: "one", scope: "personal" as const, projectId: "p", conversationId: "pending", key: "original", model: "text", state: "pending" as const };
    const pending = { ...conversation("pending"), messages: [{ id: "a", role: "assistant" as const, text: "waiting", receipt }] };
    const items = [...Array.from({ length: 25 }, (_, i) => conversation(`c-${i}`)), pending];
    persistAgentConversations("test", items, storage);
    expect(loadAgentConversations("test", storage)).toHaveLength(21);
    expect(loadAgentConversations("test", storage).at(-1)).toEqual(pending);
    const next = upsertAgentConversation(loadAgentConversations("test", storage), "new", [{ id: "u", role: "user", text: "new" }]);
    expect(next).toHaveLength(21);
    expect(next.at(-1)).toEqual(pending);
    expect(ownsAgentTextReceipt(receipt, receipt, "pending")).toBe(true);
    expect(ownsAgentTextReceipt(receipt, receipt, "other")).toBe(false);
  });

  it("recovers an independent receipt when another tab overwrites its conversation list", () => {
    const storage = memoryStorage();
    const owner = { userId: "one", projectId: "shared", scope: "personal" as const };
    const receipt = { ...owner, version: 1 as const, conversationId: "pending", key: "original", model: "text", state: "pending" as const };
    const message = { id: "reply", role: "assistant" as const, text: "waiting", receipt };
    expect(persistAgentReceiptMessage(message, "原请求", storage)).toBe(true);
    persistAgentConversations(agentConversationScopeKey(owner), [], storage);
    expect(loadScopedAgentConversations(owner, storage)[0]).toMatchObject({ id: "pending", title: "原请求", messages: [message] });
    expect(loadScopedAgentConversations({ ...owner, userId: "two" }, storage)).toEqual([]);
    expect(persistAgentReceiptMessage({ ...message, receipt: { ...receipt, state: "received" } }, "原请求", storage)).toBe(true);
    expect(loadScopedAgentConversations(owner, storage)).toEqual([]);
  });
});
