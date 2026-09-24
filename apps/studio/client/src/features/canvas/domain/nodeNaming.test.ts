import { describe, expect, it } from "vitest";
import { ensureUniqueCanvasNodeTitles, renameCanvasNode, canvasNodeDisplayTitle } from "./nodeTitles";
import { createCanvasClipboard, duplicateCanvasNode, pasteCanvasClipboard } from "./clipboard";
import { completeGeneratedImageTarget, failGeneratedAudioTarget, failGeneratedImageTarget, failGeneratedTextTarget, failGeneratedVideoTarget } from "./generation";
import { buildCanvasSnapshot, parseCanvasSnapshot } from "./snapshotCodec";
import { nodeKindTitle } from "./nodes";
import type { CanvasNodeData, CanvasNodeKind } from "./types";

function output(id: string, kind: CanvasNodeKind = "image"): CanvasNodeData {
  return { id, kind, title: "旧提示词名称", content: "@[node:reference] prompt", x: 0, y: 0, width: 320, height: 240,
    metadata: { generatedInCanvas: true, status: "success" } };
}
const titles = (nodes: CanvasNodeData[]) => nodes.map(node => node.title);
const named = (nodes: CanvasNodeData[]) => ensureUniqueCanvasNodeTitles(nodes, [], "测试");

describe("canvas generated and custom node naming", () => {
  it("counts each media kind separately from placeholders and retains imported names", () => {
    const blank = { ...output("blank"), title: "图片占位", content: "", metadata: { status: "idle" as const } };
    const imported = { ...output("imported"), title: "素材.png", metadata: { canvasOrigin: "imported", generatedAt: "2026-09-01" } };
    const nodes = named([blank, output("a"), output("v", "video"), output("t", "text"), output("s", "audio"), output("b"), imported]);
    expect(titles(nodes)).toEqual(["图片占位-1", "测试image-1", "测试video-1", "测试text-1", "测试audio-1", "测试image-2", "素材"]);
    expect(nodes[0].metadata?.generatedInCanvas).toBeUndefined();
  });

  it("compacts only the deleted kind and gives the next output the next free number", () => {
    const first = named([output("a"), output("b"), output("v", "video"), output("c")]);
    const next = named(first.filter(node => node.id !== "b"));
    expect(titles(next)).toEqual(["测试image-1", "测试video-1", "测试image-2"]);
    expect(titles(named([...next, output("d")]))).toEqual(["测试image-1", "测试video-1", "测试image-2", "测试image-3"]);
    expect(ensureUniqueCanvasNodeTitles(next, next, "测试")).toBe(next);
  });

  it("numbers both custom names retroactively across kinds and compacts after deletion or rename", () => {
    let nodes = named([output("a"), output("b", "video"), output("c")]);
    nodes = renameCanvasNode(nodes, "a", "苹果");
    expect(titles(nodes)).toEqual(["苹果", "测试video-1", "测试image-1"]);
    nodes = renameCanvasNode(nodes, "b", "苹果");
    expect(titles(nodes)).toEqual(["苹果-1", "苹果-2", "测试image-1"]);
    nodes = renameCanvasNode(nodes, "c", "苹果");
    expect(titles(nodes)).toEqual(["苹果-1", "苹果-2", "苹果-3"]);
    expect(titles(named(nodes.filter(node => node.id !== "b")))).toEqual(["苹果-1", "苹果-2"]);
    expect(titles(named(nodes.filter(node => node.id === "c")))).toEqual(["苹果"]);
    const renamed = renameCanvasNode(nodes, "a", "梨");
    expect(titles(renamed)).toEqual(["梨", "苹果-1", "苹果-2"]);
    expect(renamed.map(node => node.content)).toEqual(nodes.map(node => node.content));
  });

  it("never strips user-written digits and reserves literal indexed names", () => {
    let nodes = named([output("a"), output("b"), output("literal")]);
    nodes = renameCanvasNode(nodes, "literal", "苹果-1");
    nodes = renameCanvasNode(nodes, "a", "苹果");
    nodes = renameCanvasNode(nodes, "b", "苹果");
    expect(titles(nodes)).toEqual(["苹果-2", "苹果-3", "苹果-1"]);
    expect(nodes[2].metadata?.titleBase).toBe("苹果-1");
    expect(ensureUniqueCanvasNodeTitles(nodes)).toBe(nodes);
    nodes = renameCanvasNode(nodes, "b", "苹果-1");
    expect(titles(nodes)).toEqual(["苹果", "苹果-1-1", "苹果-1-2"]);
  });

  it("reserves custom names before generated indices and compacts after release", () => {
    const nodes = renameCanvasNode(named([output("a"), output("b"), output("c")]), "c", "测试image-1");
    expect(titles(nodes)).toEqual(["测试image-2", "测试image-3", "测试image-1"]);
    expect(titles(named(nodes.slice(0, 2)))).toEqual(["测试image-1", "测试image-2"]);
  });

  it("does not turn duplicates of generated outputs into manually named nodes", () => {
    const nodes = named([output("a")]);
    const copy = duplicateCanvasNode(nodes[0], "b", nodes);
    const duplicated = named([...nodes, copy]);
    expect(titles(duplicated)).toEqual(["测试image-1", "测试image-2"]);
    expect(copy.metadata?.titleEdited).toBe(false);
    expect(titles(renameCanvasNode(duplicated, "b", "副本新名称"))).toEqual(["测试image-1", "副本新名称"]);
  });

  it("numbers every placeholder kind from one and compacts it after deletion or renaming", () => {
    for (const kind of ["image", "video", "text", "audio", "config", "director"] as const) {
      const base = nodeKindTitle(kind);
      const blank = { ...output("a", kind), title: base, content: "", metadata: { status: "idle" as const, generationMode: "image" as const } };
      const nodes = named([blank, { ...blank, id: "b" }, { ...blank, id: "c" }]);
      expect(titles(nodes)).toEqual([`${base}-1`, `${base}-2`, `${base}-3`]);
      expect(titles(named(nodes.filter(node => node.id !== "b")))).toEqual([`${base}-1`, `${base}-2`]);
      expect(titles(named(nodes.slice(2)))).toEqual([`${base}-1`]);
      expect(nodes.every(node => !node.metadata?.titleEdited && !node.metadata?.generatedInCanvas)).toBe(true);
      expect(titles(renameCanvasNode(renameCanvasNode(nodes, "a", "苹果"), "b", "苹果")))
        .toEqual(["苹果-1", "苹果-2", `${base}-1`]);
      expect(named(nodes)).toBe(nodes);
    }
  });

  it("migrates old parenthesized placeholder names even when old deduplication marked them edited", () => {
    const nodes = [1, 2, 3, 4, 5].map(number => ({ ...output(String(number)), title: `图片占位（${number}）`, content: "",
      metadata: { status: "idle" as const, titleEdited: true, titleBase: `图片占位（${number}）` } }));
    const migrated = named(nodes.filter(node => node.id !== "3"));
    expect(titles(migrated)).toEqual(["图片占位-1", "图片占位-2", "图片占位-3", "图片占位-4"]);
    expect(migrated.map(node => node.id)).toEqual(["1", "2", "4", "5"]);
    const restored = parseCanvasSnapshot(buildCanvasSnapshot({}, migrated, [], 100, 0, 0))!;
    expect(titles(restored.nodes)).toEqual(titles(migrated));
    expect(named(restored.nodes)).toBe(restored.nodes);
    const videos = ["视频片段", "视频片段2", "视频片段 (3)"].map((title, index) => ({
      ...output(`video-${index}`, "video"), title, content: "", metadata: { status: "idle" as const },
    }));
    expect(titles(named(videos))).toEqual(["视频片段-1", "视频片段-2", "视频片段-3"]);
  });

  it("numbers placeholder copies independently and switches completed outputs to the current canvas name", () => {
    const blank = { ...output("a"), title: "图片占位", content: "", metadata: { status: "idle" as const } };
    let nodes = named([blank]);
    const copy = duplicateCanvasNode(nodes[0], "b", nodes);
    const clipboard = createCanvasClipboard(nodes, [], ["a"], "project");
    const pasted = pasteCanvasClipboard(clipboard, "project", { x: 0, y: 0 }, () => "c")!;
    nodes = named([...nodes, copy, ...pasted.nodes]);
    expect(titles(nodes)).toEqual(["图片占位-1", "图片占位-2", "图片占位-3"]);
    expect(nodes.every(node => !node.metadata?.generatedInCanvas)).toBe(true);
    nodes = completeGeneratedImageTarget(nodes, "b", { id: "asset", assetId: "asset", src: "" }, "提示词");
    nodes = ensureUniqueCanvasNodeTitles(nodes, [], "模板1");
    expect(titles(nodes)).toEqual(["图片占位-1", "模板1image-1", "图片占位-2"]);
  });

  it("protects literal custom placeholder-like names and imported media", () => {
    const blank = { ...output("a"), title: "图片占位", content: "", metadata: { status: "idle" as const } };
    let nodes = named([blank, { ...blank, id: "b" }]);
    nodes = renameCanvasNode(nodes, "b", "图片占位（5）");
    expect(titles(named(nodes))).toEqual(["图片占位-1", "图片占位（5）"]);
    nodes = renameCanvasNode(nodes, "b", "图片占位-1");
    expect(titles(named(nodes))).toEqual(["图片占位-2", "图片占位-1"]);
    const imported = { ...blank, id: "import", title: "图片占位（9）", metadata: { canvasOrigin: "imported" } };
    expect(named([imported])[0].title).toBe("图片占位（9）");
  });

  it("migrates completed legacy outputs but never infers generation just from a prompt", () => {
    const legacy = { ...output("old", "audio"), metadata: { sourceNodeId: "source", generationMode: "audio" as const, status: "success" as const } };
    const copy = duplicateCanvasNode(legacy, "copy");
    const clipboard = createCanvasClipboard([legacy], [], [legacy.id], "project");
    const pasted = pasteCanvasClipboard(clipboard, "project", { x: 0, y: 0 }, () => "pasted")!;
    expect(titles(named([legacy, copy, ...pasted.nodes]))).toEqual(["测试audio-1", "测试audio-2", "测试audio-3"]);
    const imported = { ...legacy, id: "import", title: "原素材", metadata: { ...legacy.metadata, canvasOrigin: "imported" } };
    const blank = { ...legacy, id: "blank", title: "音频", metadata: { generationMode: "audio" as const, prompt: "已填写提示词" } };
    expect(titles(named([imported, blank]))).toEqual(["原素材", "音频"]);
  });

  it.each([
    ["image", failGeneratedImageTarget], ["video", failGeneratedVideoTarget],
    ["audio", failGeneratedAudioTarget], ["text", failGeneratedTextTarget],
  ] as const)("preserves automatic and manual %s names after a failed retry", (kind, fail) => {
    const nodes = renameCanvasNode(named([output("a", kind), output("b", kind)]), "a", "苹果");
    const failed = fail(fail(nodes, "a", "失败"), "b", "失败");
    expect(titles(failed)).toEqual(["苹果", `测试${kind}-1`]);
    expect(failed.every(node => node.metadata?.status === "error")).toBe(true);
  });

  it("numbers in node creation order, not request completion order or provider filename", () => {
    let nodes = ["a", "b", "c"].map(id => ({ ...output(id), title: "生成中", metadata: { status: "loading" as const } } as CanvasNodeData));
    for (const id of ["c", "a", "b"]) {
      nodes = named(completeGeneratedImageTarget(nodes, id, { id, assetId: id, name: "provider_0.png", src: "" }, "苹果提示词"));
    }
    expect(titles(nodes)).toEqual(["测试image-1", "测试image-2", "测试image-3"]);
  });

  it("persists literal bases, numbering and ID references through snapshot round trips", () => {
    let nodes = named([output("a"), output("b"), output("c", "video")]);
    nodes = renameCanvasNode(renameCanvasNode(nodes, "a", "苹果"), "b", "苹果");
    const edges = [{ id: "edge", from: "a", to: "c" }];
    const restored = parseCanvasSnapshot(buildCanvasSnapshot({}, nodes, edges, 100, 0, 0))!;
    expect(titles(restored.nodes!)).toEqual(["苹果-1", "苹果-2", "测试video-1"]);
    expect(restored.edges).toMatchObject(edges);
    expect(restored.nodes?.map(node => node.id)).toEqual(["a", "b", "c"]);
    expect(titles(named(restored.nodes!.filter(node => node.id !== "a")))).toEqual(["苹果", "测试video-1"]);
  });

  it("does not overwrite manual names on completion or after renaming the canvas", () => {
    const nodes = renameCanvasNode(named([output("a"), output("b")]), "a", "用户名字");
    const completed = completeGeneratedImageTarget(nodes, "a", { id: "result", assetId: "asset", src: "", name: "provider_0" }, "new prompt");
    expect(titles(ensureUniqueCanvasNodeTitles(completed, [], "新画布"))).toEqual(["用户名字", "新画布image-1"]);
  });

  it("keeps the media kind and hyphenated index visible on long labels", () => {
    expect(canvasNodeDisplayTitle("很长很长很长很长的画布image-12")).toBe("很长很长很长很长…image-12");
    expect(canvasNodeDisplayTitle("很长很长很长很长的名字-12")).toBe("很长很长很长很长…-12");
  });
});
