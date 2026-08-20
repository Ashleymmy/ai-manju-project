import { describe, expect, it } from "vitest";

import {
  buildCanvasMentionGenerationContext,
  buildCanvasMentionReferences,
  filterCanvasMentionReferences,
  splitCanvasMentionText,
} from "./canvas-mentions";

const nodes = [
  { id: "prompt", kind: "prompt", title: "主提示", content: "生成画面" },
  { id: "image", kind: "image", title: "角色参考", metadata: { assetId: "asset-node", assetScope: "personal" } },
  { id: "text", kind: "text", title: "设定", content: "红色风衣" },
  { id: "orphan", kind: "video", title: "未连接视频", metadata: { assetId: "video-node" } },
];
const edges = [
  { id: "e1", from: "image", to: "prompt" },
  { id: "e2", from: "text", to: "prompt" },
];
const assets = [{ id: "asset-library", type: "audio" as const, name: "旁白", scope: "team" as const }];

describe("canvas mention references", () => {
  it("activates connected nodes and current asset-library results", () => {
    const references = buildCanvasMentionReferences("prompt", nodes, edges, assets, "personal");
    expect(references.find((item) => item.key === "node:image")?.active).toBe(true);
    expect(references.find((item) => item.key === "node:image")?.assetScope).toBe("personal");
    expect(references.find((item) => item.key === "node:orphan")?.active).toBe(false);
    expect(references.find((item) => item.key === "asset:asset-library")).toMatchObject({ active: true, assetScope: "team" });
    expect(filterCanvasMentionReferences(references, "角色").map((item) => item.key)).toEqual(["node:image"]);
  });

  it("resolves explicit node and asset tokens and reports stale references", () => {
    const result = buildCanvasMentionGenerationContext(
      "prompt",
      nodes,
      edges,
      "用 @[node:text] 和 @[asset:asset-library]，忽略 @[asset:missing]",
      assets,
      "personal",
    );
    expect(result.prompt).toContain("【文本1】");
    expect(result.prompt).toContain("红色风衣");
    expect(result.prompt).toContain("旁白");
    expect(result.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: "text", type: "text" }),
      expect.objectContaining({ assetId: "asset-library", assetScope: "team", type: "audio" }),
    ]));
    expect(result.missingKeys).toEqual(["asset:missing"]);
  });

  it("preserves a cross-scope node asset reference for media hydration", () => {
    const crossScopeNodes = nodes.map((node) => node.id === "image"
      ? { ...node, metadata: { ...node.metadata, assetScope: "team" } }
      : node);
    const result = buildCanvasMentionGenerationContext(
      "prompt",
      crossScopeNodes,
      edges,
      "使用 @[node:image]",
      assets,
      "personal",
    );
    expect(result.inputs).toContainEqual(expect.objectContaining({
      nodeId: "image",
      assetId: "asset-node",
      assetScope: "team",
      type: "image",
    }));
  });

  it("renders valid mentions as labels and stale tokens as missing", () => {
    const references = buildCanvasMentionReferences("prompt", nodes, edges, assets, "personal");
    expect(splitCanvasMentionText("@[node:image] @[node:missing]", references)).toEqual([
      expect.objectContaining({ type: "reference", label: "角色参考", missing: false }),
      { type: "text", value: " " },
      expect.objectContaining({ type: "reference", label: "引用已失效", missing: true }),
    ]);
  });
});
