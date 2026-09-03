import { describe, expect, it, vi } from "vitest";

import {
  agentConversationStorageKey,
  loadAgentConversations,
  persistAgentConversations,
  upsertAgentConversation,
} from "./conversationRepository";
import type { AgentConversation } from "./types";

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
    expect(() => persistAgentConversations("project", [conversation("one")], failing)).not.toThrow();
  });
});
