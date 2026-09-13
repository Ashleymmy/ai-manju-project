import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  legacy: [] as unknown[], cache: new Map<string, unknown>(),
  api: { conversations: vi.fn(), messages: vi.fn(), createConversation: vi.fn(), renameConversation: vi.fn(), deleteConversation: vi.fn(), createMessage: vi.fn(), updateMessage: vi.fn() },
}));
vi.mock("@/entities/sd-video", () => ({ createSDVideoClient: () => mocks.api }));
vi.mock("@/entities/asset", () => ({ uploadAsset: vi.fn() }));
vi.mock("./conversationRepository", () => ({
  conversationStore: { getItem: async (key: string) => mocks.cache.get(key), setItem: async (key: string, value: unknown) => mocks.cache.set(key, value) },
  loadVideoWorkbenchConversations: async () => mocks.legacy,
  normalizeConversations: (items: unknown) => Array.isArray(items) ? items : [],
  queueVideoWorkbenchWrite: vi.fn(async () => undefined),
}));
import { createCloudConversationRepository } from "./cloudConversationRepository";

beforeEach(() => {
  vi.clearAllMocks(); mocks.cache.clear(); mocks.legacy = [];
  mocks.api.conversations.mockResolvedValue([]);
  mocks.api.messages.mockResolvedValue([]);
  mocks.api.createConversation.mockResolvedValue({ version: 1 });
  mocks.api.createMessage.mockResolvedValue({ version: 1 });
  mocks.api.updateMessage.mockResolvedValue({ version: 2 });
});
const conversation = (id: string) => ({ id, title: "title", messages: [], createdAt: 1, updatedAt: 1 });

describe("cloud video conversations", () => {
  it("does not claim or upload legacy conversations", async () => {
    mocks.legacy = [conversation("legacy")];
    const repository = createCloudConversationRepository("user-a");
    const items = await repository.load();
    await repository.write([...items, conversation("new")]);
    expect(mocks.api.createConversation).toHaveBeenCalledTimes(1);
    expect(mocks.api.createConversation).toHaveBeenCalledWith("new", "title");
    expect(repository.isLegacy("legacy")).toBe(true);
  });
  it("updates a message with its remote version without replacing the conversation", async () => {
    const repository = createCloudConversationRepository("user-a");
    await repository.load();
    const item = { ...conversation("new"), messages: [{ id: "m", role: "user" as const, text: "a", createdAt: 2 }] };
    await repository.write([item]);
    await repository.write([{ ...item, messages: [{ ...item.messages[0], text: "b" }] }]);
    expect(mocks.api.createMessage).toHaveBeenCalledTimes(1);
    expect(mocks.api.updateMessage).toHaveBeenCalledWith("m", expect.objectContaining({ text: "b" }), 1);
    expect(mocks.api.renameConversation).not.toHaveBeenCalled();
  });
  it("does not resurrect a remotely deleted synced conversation from cache", async () => {
    mocks.cache.set("cloud:personal:user-a", { items: [conversation("deleted")], draftIds: [] });
    const repository = createCloudConversationRepository("user-a");
    expect(await repository.load()).toEqual([]);
    expect(mocks.api.createConversation).not.toHaveBeenCalled();
  });
  it("blocks queued writes after account disposal", async () => {
    const repository = createCloudConversationRepository("user-a");
    await repository.load();
    repository.dispose();
    await expect(repository.write([conversation("new")])).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.api.createConversation).not.toHaveBeenCalled();
  });

  it("restores unsent messages after conversation creation without replacing remote messages", async () => {
    const repository = createCloudConversationRepository("user-a");
    await repository.load();
    const item = { ...conversation("new"), messages: [
      { id: "sent", role: "user" as const, text: "sent", createdAt: 2 },
      { id: "draft", role: "user" as const, text: "unsent", createdAt: 3 },
    ] };
    mocks.api.createMessage.mockResolvedValueOnce({ version: 1 }).mockRejectedValueOnce(new Error("offline"));
    await expect(repository.write([item])).rejects.toThrow("offline");
    expect(mocks.cache.get("cloud:personal:user-a")).toMatchObject({ draftIds: [], pendingMessages: { new: ["draft"] } });
    repository.dispose();
    mocks.api.conversations.mockResolvedValue([{ id: "new", title: "remote", version: 1 }]);
    mocks.api.messages.mockResolvedValue([{ id: "sent", role: "user", text: "new remote version", version: 2 }]);
    const restored = createCloudConversationRepository("user-a");
    const items = await restored.load();
    expect(items[0].messages.map(message => message.text)).toEqual(["new remote version", "unsent"]);
    await restored.write(items);
    expect(mocks.api.updateMessage).not.toHaveBeenCalled();
    expect(mocks.api.createMessage).toHaveBeenLastCalledWith(expect.objectContaining({ id: "draft", text: "unsent" }));
  });

  it("does not restore unsent messages into a remotely deleted conversation", async () => {
    mocks.cache.set("cloud:personal:user-a", { items: [conversation("deleted")], draftIds: [], pendingMessages: { deleted: ["draft"] } });
    expect(await createCloudConversationRepository("user-a").load()).toEqual([]);
  });
});
