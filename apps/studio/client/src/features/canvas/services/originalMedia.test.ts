import { afterEach, expect, it, vi } from "vitest";
import { getAssetContentBlob } from "@/entities/asset";
import type { CanvasNodeData } from "../domain/types";
import { downloadCanvasOriginalMedia } from "./originalMedia";

vi.mock("@/entities/asset", () => ({ getAssetContentBlob: vi.fn() }));
const node: CanvasNodeData = {
  id: "image", kind: "image", title: "原图", content: "", x: 0, y: 0, width: 300, height: 300,
  imageAssetId: "original", imageSrc: "blob:thumbnail", metadata: { assetScope: "team" },
};
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });

it("downloads exact original bytes without resizing to the canvas frame or using its cached source", async () => {
  const original = new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type: "image/png" });
  vi.mocked(getAssetContentBlob).mockResolvedValue(original);
  vi.stubGlobal("fetch", vi.fn());
  const downloaded = await downloadCanvasOriginalMedia(node, "personal");
  expect(getAssetContentBlob).toHaveBeenCalledWith("original", "team");
  expect(downloaded).toBe(original);
  expect(fetch).not.toHaveBeenCalled();
});

it("does not silently download a thumbnail when the original fails", async () => {
  vi.mocked(getAssetContentBlob).mockRejectedValue(new Error("original unavailable"));
  vi.stubGlobal("fetch", vi.fn());
  await expect(downloadCanvasOriginalMedia(node, "personal")).rejects.toThrow("original unavailable");
  expect(fetch).not.toHaveBeenCalled();
});

it("refuses an asset download until its workspace is known instead of falling back to a preview", async () => {
  await expect(downloadCanvasOriginalMedia({ ...node, metadata: {} }, null)).rejects.toThrow("工作区");
  expect(getAssetContentBlob).not.toHaveBeenCalled();
});

it("preserves directly imported original files and rejects failed HTTP responses", async () => {
  const original = new Blob(["original-file"], { type: "image/webp" });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, blob: async () => original }).mockResolvedValueOnce({ ok: false, status: 404 }));
  const local = { ...node, imageAssetId: undefined, imageSrc: "blob:local-original" };
  expect(await downloadCanvasOriginalMedia(local, null)).toBe(original);
  expect(fetch).toHaveBeenCalledWith("blob:local-original");
  await expect(downloadCanvasOriginalMedia(local, null)).rejects.toThrow("404");
});
