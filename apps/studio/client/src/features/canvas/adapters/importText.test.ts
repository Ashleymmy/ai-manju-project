import { describe, expect, it } from "vitest";
import { CANVAS_TEXT_IMPORT_MAX_BYTES, droppedCanvasText, isCanvasTextFile, readCanvasTextFile } from "./importText";

const transfer = (data: Record<string, string>) => ({ types: Object.keys(data), getData: (type: string) => data[type] || "" });

describe("canvas text import", () => {
  it("recognizes text documents by type or extension", () => {
    expect(isCanvasTextFile(new File(["a"], "剧本.txt", { type: "text/plain" }))).toBe(true);
    expect(isCanvasTextFile(new File(["a"], "分镜.MD"))).toBe(true);
    expect(isCanvasTextFile(new File(["a"], "notes", { type: "text/markdown" }))).toBe(true);
    expect(isCanvasTextFile(new File(["a"], "page.html", { type: "text/html" }))).toBe(false);
    expect(isCanvasTextFile(new File(["a"], "photo.png", { type: "image/png" }))).toBe(false);
  });

  it("reads UTF-8 and normalizes line endings", async () => {
    await expect(readCanvasTextFile(new File(["第一行\r\n第二行\r第三行"], "a.txt"))).resolves.toBe("第一行\n第二行\n第三行");
  });

  it("falls back to GB18030 for files saved by Chinese Windows editors", async () => {
    const gbk = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]);
    await expect(readCanvasTextFile(new File([gbk], "a.txt"))).resolves.toBe("你好");
  });

  it("rejects empty and oversized files", async () => {
    await expect(readCanvasTextFile(new File(["  \n"], "a.txt"))).rejects.toThrow("文本文件没有内容");
    await expect(readCanvasTextFile(new File([new Uint8Array(CANVAS_TEXT_IMPORT_MAX_BYTES + 1)], "a.txt"))).rejects.toThrow("超过 1 MB");
  });

  it("takes dragged selections but not dragged links or images", () => {
    expect(droppedCanvasText(transfer({ "text/plain": "一段\r\n文字" }))).toBe("一段\n文字");
    expect(droppedCanvasText(transfer({ "text/uri-list": "https://example.com/a.png", "text/plain": "https://example.com/a.png" }))).toBe("");
  });
});
