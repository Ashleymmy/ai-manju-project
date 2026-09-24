import { describe, expect, it } from "vitest";
import { canvasNodeDisplayTitle, canvasNodeTitle, ensureUniqueCanvasNodeTitles, renameCanvasNode } from "./nodeTitles";
import { createCanvasClipboard, duplicateCanvasNode, pasteCanvasClipboard } from "./clipboard";
import { normalizeCanvasNode, serializeCanvasNode } from "./nodes";
import type { CanvasNodeData, CanvasNodeKind } from "./types";

const kinds: CanvasNodeKind[] = ["image", "video", "audio", "text", "prompt", "note", "config", "director"];
function node(id: string, kind: CanvasNodeKind, title = id): CanvasNodeData {
  return { id, kind, title, content: "prompt", x: 0, y: 0, width: 320, height: 240,
    imageAssetId: "shared-asset", metadata: { assetId: "shared-asset", assetScope: "personal", prompt: "original prompt" } };
}

describe("independent canvas node titles", () => {
  it("numbers collisions across every kind while reserving existing numbered names", () => {
    const nodes = kinds.map((kind, index) => node(String(index), kind, "苹果"));
    const named = ensureUniqueCanvasNodeTitles(nodes);
    expect(named.map(item => item.title)).toEqual(["苹果", "苹果（1）", "苹果（2）", "苹果（3）", "苹果（4）", "苹果（5）", "苹果（6）", "苹果（7）"]);
    expect(ensureUniqueCanvasNodeTitles(named)).toBe(named);
    expect(nodes.every(item => item.title === "苹果")).toBe(true);
    const existing = [node("one", "image", "苹果"), node("two", "video", "苹果1")];
    const inserted = ensureUniqueCanvasNodeTitles([node("new", "audio", "苹果"), ...existing], existing);
    expect(inserted.map(item => item.title)).toEqual(["苹果（1）", "苹果", "苹果1"]);
    expect(renameCanvasNode(existing, "one", "苹果1").map(item => item.title)).toEqual(["苹果1（1）", "苹果1"]);
    expect(renameCanvasNode(existing, "two", "苹果").map(item => item.title)).toEqual(["苹果", "苹果（1）"]);
    const reserved = [node("original", "image", "苹果"), node("numbered", "audio", "苹果（1）")];
    expect(ensureUniqueCanvasNodeTitles([node("new", "video", "苹果.mp4"), ...reserved], reserved).map(item => item.title))
      .toEqual(["苹果（2）", "苹果", "苹果（1）"]);
  });

  it.each(kinds)("shares copy numbering between duplicate and clipboard for %s", kind => {
    const source = node("source", kind, "苹果");
    const first = duplicateCanvasNode(source, "first", [source]);
    const second = duplicateCanvasNode(source, "second", [source, first]);
    const clipboard = createCanvasClipboard([second], [], [second.id], "project");
    const pasted = pasteCanvasClipboard(clipboard, "project", { x: 0, y: 0 }, () => "third", [source, first, second])!;
    expect([source, first, second, ...pasted.nodes].map(item => item.title)).toEqual(["苹果", "苹果副本", "苹果副本（1）", "苹果副本（2）"]);
    expect(normalizeCanvasNode(serializeCanvasNode(pasted.nodes[0]))?.title).toBe("苹果副本（2）");
  });

  it("shortens only the visible label to eight Unicode characters", () => {
    expect(canvasNodeDisplayTitle("春天的苹果园风景")).toBe("春天的苹果园风景");
    expect(canvasNodeDisplayTitle("春天的苹果园风景很美")).toBe("春天的苹果园风景…");
    expect(canvasNodeDisplayTitle("苹果副本2")).toBe("苹果副本2");
    expect(canvasNodeDisplayTitle("苹果副本（2）")).toBe("苹果副本（2）");
    expect(canvasNodeDisplayTitle("春天的苹果园风景很美（12）")).toBe("春天的苹果园风景…（12）");
    expect(canvasNodeDisplayTitle("🍎🍏🍐🍊🍋🍉🍇🍓🍒")).toBe("🍎🍏🍐🍊🍋🍉🍇🍓…");
  });

  it.each(kinds)("renames only the selected %s node, keeping shared media and other nodes intact", kind => {
    const source = node("source", kind, "original");
    const copy = node("copy", kind, "original copy");
    const peer = node("peer", kind, "independent reference");
    const nodes = [source, copy, peer];
    const renamed = renameCanvasNode(nodes, "source", "  new name  ");
    expect(renamed.map(item => item.title)).toEqual(["new name", "original copy", "independent reference"]);
    expect(renamed[0]).toMatchObject({ imageAssetId: "shared-asset", metadata: { assetId: "shared-asset", titleEdited: true } });
    expect(renamed[1]).toBe(copy);
    expect(renamed[2]).toBe(peer);
    expect(source.title).toBe("original");
    expect(source.metadata?.titleEdited).toBeUndefined();
    const copyRenamed = renameCanvasNode(renamed, "copy", "copy name");
    expect(copyRenamed.map(item => item.title)).toEqual(["new name", "copy name", "independent reference"]);
    const restored = copyRenamed.map(item => normalizeCanvasNode(serializeCanvasNode(item))!);
    expect(restored.map(item => item.title)).toEqual(copyRenamed.map(item => item.title));
  });

  it("does not fall back to asset matching for missing IDs or invalid titles", () => {
    const nodes = [node("a", "image"), node("b", "image")];
    expect(renameCanvasNode(nodes, "shared-asset", "changed")).toBe(nodes);
    expect(renameCanvasNode(nodes, "a", "   ")).toBe(nodes);
    const next = renameCanvasNode(nodes, "a", "a");
    expect(next[0].metadata?.titleEdited).toBe(true);
    expect(renameCanvasNode(next, "a", "a")).toBe(next);
  });

  it.each(["provider_0", "image_123", "图片"])("preserves the explicit title %s after save and reopen", title => {
    const nodes = renameCanvasNode([node("a", "image"), node("b", "image", "copy")], "a", title);
    expect(normalizeCanvasNode(serializeCanvasNode(nodes[0]))?.title).toBe(title);
    expect(nodes[1].title).toBe("copy");
  });

  it("keeps clipboard copies independent before and after snapshot normalization", () => {
    const source = renameCanvasNode([node("a", "image")], "a", "provider_0.png")[0];
    const clipboard = createCanvasClipboard([source], [], [source.id], "personal:project");
    const pasted = pasteCanvasClipboard(clipboard, "personal:project", { x: 400, y: 300 }, () => "pasted")!;
    const nodes = [source, ...pasted.nodes];
    const renamed = renameCanvasNode(nodes, "pasted", "pasted title");
    expect(renamed.map(item => normalizeCanvasNode(serializeCanvasNode(item))?.title)).toEqual(["provider_0", "pasted title"]);
    expect(clipboard?.nodes[0].title).toBe("provider_0");
    expect(pasted.nodes[0].metadata?.assetId).toBe("shared-asset");
  });

  it.each([
    ["1 (2).png", "1 (2)"], ["苹果01.JPG", "苹果01"], ["片段1.mp4", "片段1"],
    ["片段1.MOV", "片段1"], ["旁白001.mp3", "旁白001"], ["旁白1.wav", "旁白1"],
    ["剧本2.txt", "剧本2"], ["作品 v1.2", "作品 v1.2"], ["名称1", "名称1"],
    ["苹果.png副本2", "苹果副本2"], ["苹果.PNG（1）", "苹果（1）"],
    ["1.png.PNG", "1"],
  ])("removes only the file extension from %s", (name, expected) => {
    expect(canvasNodeTitle(name)).toBe(expected);
    expect(canvasNodeTitle(canvasNodeTitle(name))).toBe(expected);
  });

  it("cleans imports, edited names and saved names before checking cross-media collisions", () => {
    const raw = [node("image", "image", "001.png"), node("video", "video", "001.mp4"), node("audio", "audio", "001.wav")]
      .map(item => ({ ...item, metadata: { ...item.metadata, titleEdited: true, canvasOrigin: "imported" as const } }));
    const clean = ensureUniqueCanvasNodeTitles(raw);
    expect(clean.map(item => item.title)).toEqual(["001", "001（1）", "001（2）"]);
    expect(clean.map(item => normalizeCanvasNode(serializeCanvasNode(item))?.title)).toEqual(clean.map(item => item.title));
    expect(clean.map(item => item.metadata)).toEqual(raw.map(item => item.metadata));
    expect(renameCanvasNode(clean, "video", "001.MOV")[1].title).toBe("001（1）");
    expect(raw.map(item => item.title)).toEqual(["001.png", "001.mp4", "001.wav"]);
  });
});
