import { describe, expect, it, vi } from "vitest";

import {
  canvasTextAssetStorageKey,
  listCanvasTextAssets,
  saveCanvasTextAsset,
} from "./textAssetsRepository";

function memoryStorage() {
  const values = new Map<string, unknown>();
  return {
    getItem: vi.fn(async <T>(key: string) => values.get(key) as T | null),
    setItem: vi.fn(async (key: string, value: unknown) => { values.set(key, value); return value; }),
  };
}

describe("canvas text assets", () => {
  it("isolates persisted text by user and workspace scope", async () => {
    const storage = memoryStorage();
    await saveCanvasTextAsset({ userId: "user-a", scope: "personal", title: "个人", content: "个人文本" }, storage);
    await saveCanvasTextAsset({ userId: "user-a", scope: "team", title: "团队", content: "团队文本" }, storage);

    expect((await listCanvasTextAssets("user-a", "personal", storage)).map((asset) => asset.content)).toEqual(["个人文本"]);
    expect((await listCanvasTextAssets("user-a", "team", storage)).map((asset) => asset.content)).toEqual(["团队文本"]);
    expect(await listCanvasTextAssets("user-b", "personal", storage)).toEqual([]);
    expect(canvasTextAssetStorageKey("user-a", "personal")).not.toBe(canvasTextAssetStorageKey("user-a", "team"));
  });

  it("rejects empty text and preserves the original saved copy", async () => {
    const storage = memoryStorage();
    await expect(saveCanvasTextAsset({ userId: "user-a", scope: "personal", title: "空", content: "   " }, storage)).rejects.toThrow("空文本");
    const saved = await saveCanvasTextAsset({ userId: "user-a", scope: "personal", title: "初稿", content: "保存内容" }, storage);
    const detachedNodeContent = `${saved.content}，节点后来被编辑`;

    expect(detachedNodeContent).not.toBe(saved.content);
    expect((await listCanvasTextAssets("user-a", "personal", storage))[0].content).toBe("保存内容");
  });

  it("drops malformed records instead of leaking them into the picker", async () => {
    const storage = memoryStorage();
    await storage.setItem(canvasTextAssetStorageKey("user-a", "personal"), [
      { id: "valid", title: "有效", content: "正文", scope: "team" },
      { id: "empty", content: "" },
      { title: "missing id", content: "正文" },
    ]);

    expect(await listCanvasTextAssets("user-a", "personal", storage)).toEqual([
      expect.objectContaining({ id: "valid", content: "正文", scope: "personal" }),
    ]);
  });
});
