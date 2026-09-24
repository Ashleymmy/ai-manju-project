import { describe, expect, it, vi } from "vitest";

import {
  canvasTextAssetStorageKey,
  listCanvasTextAssets,
  saveCanvasTextAsset,
  syncCanvasTextAssets,
  canvasNodeTextAssetId,
  renameCanvasTextAsset,
} from "./textAssetsRepository";
import type { CanvasNodeData } from "../domain/types";

function memoryStorage() {
  const values = new Map<string, unknown>();
  return {
    getItem: vi.fn(async <T>(key: string) => values.get(key) as T | null),
    setItem: vi.fn(async (key: string, value: unknown) => { values.set(key, value); return value; }),
  };
}

describe("canvas text assets", () => {
  it("renames a saved text snapshot while preserving its body, folder and category", async () => {
    const storage = memoryStorage();
    const saved = await saveCanvasTextAsset({ userId: "u", scope: "personal", title: "旧名", content: "保存时正文", category: "character", folderId: "roles" }, storage);
    await renameCanvasTextAsset({ userId: "u", scope: "personal", id: saved.id, title: "新名" }, storage);
    expect(await listCanvasTextAssets("u", "personal", storage)).toEqual([
      expect.objectContaining({ id: saved.id, title: "新名", content: "保存时正文", category: "character", folderId: "roles", automatic: false }),
    ]);
    expect(await renameCanvasTextAsset({ userId: "another", scope: "personal", id: saved.id, title: "错误" }, storage)).toBeUndefined();
    expect(await renameCanvasTextAsset({ userId: "u", scope: "team", id: saved.id, title: "错误" }, storage)).toBeUndefined();
  });
  it("automatically archives nonempty text in other and preserves manual classification during concurrent saves", async () => {
    const storage = memoryStorage();
    const text = (id: string, content: string) => ({ id, kind: "text", title: id, content } as CanvasNodeData);
    const input = { userId: "user-a", scope: "personal" as const, projectId: "canvas-a", nodes: [text("one", "第一段"), text("two", "第二段"), text("empty", "")] };
    expect(await syncCanvasTextAssets(input, storage)).toBe(true);
    expect(await syncCanvasTextAssets(input, storage)).toBe(false);
    expect(await listCanvasTextAssets("user-a", "personal", storage)).toEqual([
      expect.objectContaining({ id: canvasNodeTextAssetId("canvas-a", "one"), content: "第一段", category: "other", projectId: "canvas-a" }),
      expect.objectContaining({ id: canvasNodeTextAssetId("canvas-a", "two"), content: "第二段", category: "other" }),
    ]);
    await Promise.all([
      saveCanvasTextAsset({ userId: "user-a", scope: "personal", id: canvasNodeTextAssetId("canvas-a", "one"), title: "角色", content: "已选角色", category: "character", folderId: "roles" }, storage),
      syncCanvasTextAssets({ ...input, nodes: [text("one", "修改内容"), text("two", "新第二段")] }, storage),
      syncCanvasTextAssets({ ...input, projectId: "canvas-b", nodes: [text("one", "另一画布")] }, storage),
    ]);
    const assets = await listCanvasTextAssets("user-a", "personal", storage);
    expect(assets).toHaveLength(3);
    expect(assets.find(asset => asset.id === canvasNodeTextAssetId("canvas-a", "one"))).toMatchObject({ category: "character", folderId: "roles", content: "已选角色" });
    expect(assets.find(asset => asset.id === canvasNodeTextAssetId("canvas-a", "two"))?.content).toBe("新第二段");
    expect(assets.find(asset => asset.id === canvasNodeTextAssetId("canvas-b", "one"))?.content).toBe("另一画布");
  });
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

  it("persists the canvas category and reclassifies the same text without duplicating it", async () => {
    const storage = memoryStorage();
    const saved = await saveCanvasTextAsset({ userId: "user-a", scope: "personal", title: "设定", content: "人物背景",
      folderId: "roles", category: "character", projectId: "canvas-a" }, storage);
    await saveCanvasTextAsset({ userId: "user-a", scope: "personal", title: "设定", content: saved.content, id: saved.id,
      folderId: "other", category: "other", projectId: "canvas-a" }, storage);
    const items = await listCanvasTextAssets("user-a", "personal", storage);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: saved.id, folderId: "other", category: "other", projectId: "canvas-a", content: "人物背景" });
  });
});
