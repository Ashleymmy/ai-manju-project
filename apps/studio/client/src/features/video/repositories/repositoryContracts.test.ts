import { afterEach, describe, expect, it, vi } from "vitest";

const repositoryMocks = vi.hoisted(() => {
  const stores = new Map<
    string,
    {
      getItem: ReturnType<typeof vi.fn>;
      keys: ReturnType<typeof vi.fn>;
      removeItem: ReturnType<typeof vi.fn>;
      setItem: ReturnType<typeof vi.fn>;
    }
  >();
  const createInstance = vi.fn((options: { name: string; storeName: string }) => {
    const store = {
      getItem: vi.fn(async () => null),
      keys: vi.fn(async () => [] as string[]),
      removeItem: vi.fn(async () => undefined),
      setItem: vi.fn(async () => undefined),
    };
    stores.set(options.storeName, store);
    return store;
  });
  return { createInstance, stores };
});

vi.mock("localforage", () => ({
  default: { createInstance: repositoryMocks.createInstance },
}));

import {
  createVideoWorkbenchConversation,
  loadVideoWorkbenchConversations,
  queueVideoWorkbenchWrite,
} from "./conversationRepository";
import { loadStoredVideoHistory } from "./historyRepository";

afterEach(() => {
  vi.unstubAllGlobals();
  repositoryMocks.stores.forEach((store) => {
    store.getItem.mockClear();
    store.keys.mockClear();
    store.removeItem.mockClear();
    store.setItem.mockClear();
  });
});

describe("video repository compatibility contracts", () => {
  it("keeps every IndexedDB database and store name byte-for-byte stable", () => {
    const options = repositoryMocks.createInstance.mock.calls.map(([item]) => item);
    expect(options).toHaveLength(4);
    expect(options).toEqual(expect.arrayContaining([
        { name: "ai-manhua-studio", storeName: "video_workbench_conversations_v1" },
        { name: "ai-manhua-studio", storeName: "video_workbench_media_v1" },
        { name: "ai-manhua-studio", storeName: "video_generation_history_v3" },
        { name: "ai-manhua-studio", storeName: "video_generation_media_v3" },
      ]));
  });

  it("keeps the legacy history key and marks migration only after the queued write", async () => {
    const localStorage = {
      getItem: vi.fn(() => null),
      removeItem: vi.fn(),
    };
    vi.stubGlobal("localStorage", localStorage);

    await expect(loadStoredVideoHistory()).resolves.toEqual([]);

    const historyStore = repositoryMocks.stores.get("video_generation_history_v3")!;
    expect(localStorage.getItem).toHaveBeenCalledWith(
      "ai-manhua-studio:video-generation-history",
    );
    expect(historyStore.setItem.mock.calls.map(([key]) => key)).toEqual([
      "history",
      "legacy-local-storage-v1",
    ]);
    expect(localStorage.removeItem).toHaveBeenCalledWith(
      "ai-manhua-studio:video-generation-history",
    );
  });

  it("keeps conversation writes on the conversations record", async () => {
    const conversation = createVideoWorkbenchConversation("分镜讨论");
    await queueVideoWorkbenchWrite([conversation]);

    const conversationStore = repositoryMocks.stores.get(
      "video_workbench_conversations_v1",
    )!;
    expect(conversationStore.setItem).toHaveBeenCalledWith(
      "conversations",
      expect.objectContaining({
        version: 1,
        items: [expect.objectContaining({ title: "分镜讨论" })],
      }),
    );
  });

  it("restores queued task metadata needed to resume polling after refresh", async () => {
    const conversationStore = repositoryMocks.stores.get(
      "video_workbench_conversations_v1",
    )!;
    conversationStore.getItem.mockResolvedValueOnce({
      version: 1,
      revision: 7,
      items: [{
        id: "conversation-1",
        title: "恢复任务",
        createdAt: 10,
        updatedAt: 20,
        messages: [{
          id: "message-1",
          role: "system",
          text: "等待视频结果",
          createdAt: 15,
          taskId: "job-1",
          taskProvider: "seedance",
          taskStatus: "running",
          taskProgress: 42,
          resultStorageKey: "wbresult:message-1",
          model: "provider::doubao-seedance-2-5-pro",
        }],
      }],
    });

    const conversations = await loadVideoWorkbenchConversations();

    expect(conversations[0]?.messages[0]).toMatchObject({
      taskId: "job-1",
      taskProvider: "seedance",
      taskStatus: "running",
      taskProgress: 42,
      resultStorageKey: "wbresult:message-1",
    });
  });
});
