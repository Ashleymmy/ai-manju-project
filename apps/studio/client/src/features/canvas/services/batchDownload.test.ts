import { describe, expect, it, vi } from "vitest";
import { BlobReader, BlobWriter, ZipReader } from "@zip.js/zip.js";
import type { CanvasNodeData } from "../domain/types";
import { createCanvasSelectionDownload } from "./batchDownload";

const node = (id: string, patch: Partial<CanvasNodeData> = {}): CanvasNodeData => ({
  id, kind: "image", title: "原文件.png", content: "", x: 0, y: 0, width: 100, height: 100,
  imageAssetId: id, ...patch,
});
async function unzip(blob: Blob) {
  const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
  const result = new Map<string, string>();
  for (const entry of await reader.getEntries()) {
    if (!entry.directory) result.set(entry.filename, await (await entry.getData(new BlobWriter())).text());
  }
  await reader.close();
  return result;
}

describe("canvas selection download", () => {
  it("downloads only selected originals, preserves duplicate names and processes one file at a time", async () => {
    const nodes = [node("a"), node("b", { metadata: { assetScope: "team" } }), node("excluded"), node("text", { kind: "text" }), node("empty", { imageAssetId: undefined }),
      node("audio", { kind: "audio", title: "音频", metadata: { mimeType: "audio/wav" } })];
    let active = 0;
    const read = vi.fn(async (n: CanvasNodeData) => {
      expect(++active).toBe(1);
      await Promise.resolve(); active--;
      return new Blob([n.id], { type: n.kind === "audio" ? "audio/wav" : "image/png" });
    });
    const progress = vi.fn();
    const result = await createCanvasSelectionDownload(nodes, new Set(["a", "b", "text", "empty", "audio"]), "personal", progress, read);
    expect(result).toMatchObject({ completed: 3, skipped: 2, failures: [] });
    expect(read.mock.calls.map(([n]) => n.id)).toEqual(["a", "b", "audio"]);
    expect(read.mock.calls[1][0].metadata?.assetScope).toBe("team");
    expect(await unzip(result.blob)).toEqual(new Map([["原文件.png", "a"], ["原文件 (2).png", "b"], ["音频.wav", "audio"]]));
    expect(progress.mock.lastCall?.[0]).toMatchObject({ completed: 3, total: 3 });
  });

  it("keeps successful files and records failed originals rather than silently substituting thumbnails", async () => {
    const read = vi.fn(async (n: CanvasNodeData) => { if (n.id === "bad") throw new Error("原文件不存在"); return new Blob(["unchanged"], { type: "image/png" }); });
    const result = await createCanvasSelectionDownload([node("good"), node("bad")], new Set(["good", "bad"]), "personal", vi.fn(), read);
    expect(result.completed).toBe(1);
    const files = await unzip(result.blob);
    expect(files.get("原文件.png")).toBe("unchanged");
    expect(files.get("下载失败说明.txt")).toContain("原文件不存在");
  });

  it("rejects an empty selection and a completely failed batch", async () => {
    const read = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(createCanvasSelectionDownload([node("a")], new Set(), "personal", vi.fn(), read)).rejects.toThrow("没有可下载");
    expect(read).not.toHaveBeenCalled();
    await expect(createCanvasSelectionDownload([node("a")], new Set(["a"]), "personal", vi.fn(), read)).rejects.toThrow("均下载失败");
  });
});
