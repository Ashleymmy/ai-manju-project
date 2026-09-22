import { describe, expect, it } from "vitest";
import { canvasNodeDisplayTitle, ensureUniqueCanvasNodeTitles, renameCanvasNode } from "./nodeTitles";
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
    expect(named.map(item => item.title)).toEqual(["苹果", "苹果1", "苹果2", "苹果3", "苹果4", "苹果5", "苹果6", "苹果7"]);
    expect(ensureUniqueCanvasNodeTitles(named)).toBe(named);
    expect(nodes.every(item => item.title === "苹果")).toBe(true);
    const existing = [node("one", "image", "苹果"), node("two", "video", "苹果1")];
    const inserted = ensureUniqueCanvasNodeTitles([node("new", "audio", "苹果"), ...existing], existing);
    expect(inserted.map(item => item.title)).toEqual(["苹果2", "苹果", "苹果1"]);
    expect(renameCanvasNode(existing, "one", "苹果1").map(item => item.title)).toEqual(["苹果11", "苹果1"]);
    expect(renameCanvasNode(existing, "two", "苹果").map(item => item.title)).toEqual(["苹果", "苹果1"]);
  });

  it.each(kinds)("shares copy numbering between duplicate and clipboard for %s", kind => {
    const source = node("source", kind, "苹果");
    const first = duplicateCanvasNode(source, "first", [source]);
    const second = duplicateCanvasNode(source, "second", [source, first]);
    const clipboard = createCanvasClipboard([first], [], [first.id], "project");
    const pasted = pasteCanvasClipboard(clipboard, "project", { x: 0, y: 0 }, () => "third", [source, first, second])!;
    expect([source, first, second, ...pasted.nodes].map(item => item.title)).toEqual(["苹果", "苹果副本", "苹果副本2", "苹果副本3"]);
    expect(normalizeCanvasNode(serializeCanvasNode(pasted.nodes[0]))?.title).toBe("苹果副本3");
  });

  it("shortens only the visible label to five Unicode characters", () => {
    expect(canvasNodeDisplayTitle("春天的苹果园")).toBe("春天的苹果…");
    expect(canvasNodeDisplayTitle("苹果副本2")).toBe("苹果副本2");
    expect(canvasNodeDisplayTitle("🍎🍏🍐🍊🍋🍉")).toBe("🍎🍏🍐🍊🍋…");
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

  it.each(["provider_0.png", "image_123", "图片"])("preserves the explicit title %s after save and reopen", title => {
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
    expect(renamed.map(item => normalizeCanvasNode(serializeCanvasNode(item))?.title)).toEqual(["provider_0.png", "pasted title"]);
    expect(clipboard?.nodes[0].title).toBe("provider_0.png");
    expect(pasted.nodes[0].metadata?.assetId).toBe("shared-asset");
  });
});
