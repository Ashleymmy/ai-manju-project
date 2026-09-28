import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  keys: vi.fn(), getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(),
}));
vi.mock("localforage", () => ({ default: { createInstance: () => storage } }));

import { browserPendingAudioUploadStore, canvasPendingAudioUploadKey } from "./pendingAudioUpload";

describe("orphan audio result lookup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("only loads the requested user, scope, canvas and node, and returns the newest attempt", async () => {
    const key = (user: string, project: string, node: string, attempt: string) =>
      canvasPendingAudioUploadKey(user, "personal", project, node, attempt);
    const first = key("user:1", "personal:p", "node:1", "first");
    const latest = key("user:1", "personal:p", "node:1", "last");
    storage.keys.mockResolvedValue([
      key("user:2", "personal:p", "node:1", "private"),
      key("user:1", "personal:other", "node:1", "private"),
      key("user:1", "personal:p", "node:10", "private"), first, latest,
    ]);
    storage.getItem.mockImplementation(async key => ({ key, createdAt: key === latest ? "2026-09-25T12:00:00Z" : "2026-09-25T11:00:00Z" }));
    const result = await browserPendingAudioUploadStore.find({
      userId: "user:1", workspace: "personal", projectId: "p", projectKey: "personal:p", nodeId: "node:1",
    });
    expect(result?.key).toBe(latest);
    expect(storage.getItem.mock.calls).toEqual([[first], [latest]]);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("does not interpret a failed IndexedDB read as permission to generate again", async () => {
    storage.keys.mockRejectedValue(new Error("storage unavailable"));
    await expect(browserPendingAudioUploadStore.find({
      userId: "u", workspace: "personal", projectId: "p", projectKey: "personal:p", nodeId: "n",
    })).rejects.toThrow("storage unavailable");
  });
});
