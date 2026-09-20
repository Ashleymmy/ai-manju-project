import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeCanvasClipboardFile, readCanvasClipboardData, readSystemCanvasClipboard } from "./clipboard";

afterEach(() => vi.unstubAllGlobals());

describe("canvas clipboard", () => {
  it("reads file data only once when both native lists expose it", () => {
    const file = new File(["png"], "image.png", { type: "image/png" });
    const getAsFile = vi.fn(() => file);
    const data = { files: [file], items: [{ kind: "file", getAsFile }], getData: () => "caption" } as unknown as DataTransfer;
    expect(readCanvasClipboardData(data)).toEqual({ files: [file], text: "caption" });
    expect(getAsFile).not.toHaveBeenCalled();
  });

  it("supports clipboard items without FileList and ignores inaccessible files", () => {
    const file = new File(["png"], "shot.png", { type: "image/png" });
    const data = { files: [], items: [{ kind: "file", getAsFile: () => file }, { kind: "file", getAsFile: () => null }, { kind: "string" }], getData: () => "" } as unknown as DataTransfer;
    expect(readCanvasClipboardData(data).files).toEqual([file]);
  });

  it("normalizes desktop clipboard line endings", () => {
    const data = { files: [], items: [], getData: () => "first\r\nsecond\rthird" } as unknown as DataTransfer;
    expect(readCanvasClipboardData(data).text).toBe("first\nsecond\nthird");
  });

  it.each([["Photo.JPG", "image/jpeg"], ["clip.mp4", "video/mp4"], ["sound.wav", "audio/wav"]])("recognizes desktop file %s without a MIME type", (name, mime) => {
    const normalized = normalizeCanvasClipboardFile(new File(["data"], name), 0);
    expect(normalized.type).toBe(mime);
    expect(normalized.name).toBe(name);
    expect(normalized.size).toBe(4);
  });

  it("assigns a usable filename to screenshot blobs without changing their bytes", async () => {
    const file = normalizeCanvasClipboardFile(new File(["pixels"], "", { type: "image/png" }), 0);
    expect(file.name).toBe("pasted-image-1.png");
    expect(await file.text()).toBe("pixels");
  });

  it("reads one representation per image and all clipboard items", async () => {
    const getType = vi.fn(async (type: string) => new Blob(["pixels"], { type }));
    vi.stubGlobal("navigator", { clipboard: { read: async () => [
      { types: ["text/html", "image/png", "image/jpeg"], getType },
      { types: ["audio/wav"], getType },
    ] } });
    const content = await readSystemCanvasClipboard();
    expect(content.files.map(file => file.type)).toEqual(["image/png", "audio/wav"]);
    expect(getType).toHaveBeenCalledTimes(2);
  });

  it("reads plain text without executing clipboard HTML", async () => {
    const getType = vi.fn(async () => new Blob(["literal\r\ntext"]));
    vi.stubGlobal("navigator", { clipboard: { read: async () => [{ types: ["text/html", "text/plain"], getType }] } });
    expect(await readSystemCanvasClipboard()).toEqual({ files: [], text: "literal\ntext" });
    expect(getType).toHaveBeenCalledWith("text/plain");
  });

  it("reports denied permission instead of falling back to stale node copies", async () => {
    const error = new Error("Denied");
    const readText = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { read: vi.fn().mockRejectedValue(error), readText } });
    await expect(readSystemCanvasClipboard()).rejects.toBe(error);
    expect(readText).not.toHaveBeenCalled();
  });

  it("falls back to plain-text clipboard APIs on older browsers", async () => {
    vi.stubGlobal("navigator", { clipboard: { readText: async () => "copied\r\ntext" } });
    expect(await readSystemCanvasClipboard()).toEqual({ files: [], text: "copied\ntext" });
  });
});
