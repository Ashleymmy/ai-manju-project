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
  it("numbers every colliding node name-1, name-2 across kinds while keeping other literal names", () => {
    const nodes = kinds.map((kind, index) => node(String(index), kind, "苹果"));
    const named = ensureUniqueCanvasNodeTitles(nodes);
    expect(named.map(item => item.title)).toEqual(["苹果-1", "苹果-2", "苹果-3", "苹果-4", "苹果-5", "苹果-6", "苹果-7", "苹果-8"]);
    expect(ensureUniqueCanvasNodeTitles(named)).toBe(named);
    expect(nodes.every(item => item.title === "苹果")).toBe(true);
    const existing = [node("one", "image", "苹果"), node("two", "video", "苹果1")];
    const inserted = ensureUniqueCanvasNodeTitles([node("new", "audio", "苹果"), ...existing], existing);
    expect(inserted.map(item => item.title)).toEqual(["苹果-1", "苹果-2", "苹果1"]);
    expect(renameCanvasNode(existing, "one", "苹果1").map(item => item.title)).toEqual(["苹果1-1", "苹果1-2"]);
    expect(renameCanvasNode(existing, "two", "苹果").map(item => item.title)).toEqual(["苹果-1", "苹果-2"]);
    const reserved = [node("original", "image", "苹果"), node("numbered", "audio", "苹果（1）")];
    expect(ensureUniqueCanvasNodeTitles([node("new", "video", "苹果.mp4"), ...reserved], reserved).map(item => item.title))
      .toEqual(["苹果-1", "苹果-2", "苹果（1）"]);
  });

  it("numbers imports after a literal name-1, and restores the plain name once it is unique again", () => {
    const literal = node("literal", "image", "OIP-C-1.png");
    const pair = ensureUniqueCanvasNodeTitles([literal, node("a", "image", "OIP-C.jpg"), node("b", "image", "OIP-C.png")]);
    expect(pair.map(item => item.title)).toEqual(["OIP-C-1", "OIP-C-2", "OIP-C-3"]);
    const alone = ensureUniqueCanvasNodeTitles(pair.filter(item => item.id !== "b"), pair);
    expect(alone.map(item => item.title)).toEqual(["OIP-C-1", "OIP-C"]);
    expect(alone[1].metadata?.titleBase).toBeUndefined();
    const retitled = ensureUniqueCanvasNodeTitles(pair.map(item => item.id === "a" ? { ...item, title: "猫" } : item), pair);
    expect(retitled.map(item => item.title)).toEqual(["OIP-C-1", "猫", "OIP-C"]);
  });

  it.each(kinds)("shares copy numbering between duplicate and clipboard for %s", kind => {
    const source = node("source", kind, "苹果");
    const first = ensureUniqueCanvasNodeTitles([source, duplicateCanvasNode(source, "first")]);
    expect(first.map(item => item.title)).toEqual(["苹果", "苹果副本"]);
    const second = ensureUniqueCanvasNodeTitles([...first, duplicateCanvasNode(source, "second")], first);
    expect(second.map(item => item.title)).toEqual(["苹果", "苹果副本-1", "苹果副本-2"]);
    const clipboard = createCanvasClipboard([second[2]], [], ["second"], "project");
    const pasted = pasteCanvasClipboard(clipboard, "project", { x: 0, y: 0 }, () => "third")!;
    const all = ensureUniqueCanvasNodeTitles([...second, ...pasted.nodes], second);
    expect(all.map(item => item.title)).toEqual(["苹果", "苹果副本-1", "苹果副本-2", "苹果副本-3"]);
    expect(normalizeCanvasNode(serializeCanvasNode(all[3]))?.title).toBe("苹果副本-3");
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
    expect(clean.map(item => item.title)).toEqual(["001-1", "001-2", "001-3"]);
    expect(clean.map(item => normalizeCanvasNode(serializeCanvasNode(item))?.title)).toEqual(clean.map(item => item.title));
    expect(clean.map(item => item.metadata)).toEqual(raw.map(item => ({ ...item.metadata, titleBase: "001", titleMode: "custom" })));
    expect(renameCanvasNode(clean, "video", "001.MOV")[1].title).toBe("001-2");
    expect(raw.map(item => item.title)).toEqual(["001.png", "001.mp4", "001.wav"]);
  });
});
