import { describe, expect, it } from "vitest";

import {
  applyCanvasMentionEditorEdit,
  buildCanvasMentionEditorModel,
  buildCanvasMentionGenerationContext,
  buildCanvasMentionMenuItems,
  buildCanvasMentionReferences,
  canvasMentionEditorDisplayText,
  canvasMentionEditorSpacer,
  CANVAS_MENTION_IMAGE_CHIP_GAP,
  filterCanvasMentionAssetCategories,
  filterCanvasMentionReferences,
  serializeCanvasMentionEditorValue,
  splitCanvasMentionEditorDisplay,
  splitCanvasMentionText,
} from "./mentions";

const nodes = [
  { id: "prompt", kind: "prompt", title: "主提示", content: "生成画面" },
  {
    id: "image",
    kind: "image",
    title: "角色参考",
    metadata: { assetId: "asset-node", assetScope: "personal" },
  },
  { id: "text", kind: "text", title: "设定", content: "红色风衣" },
  {
    id: "orphan",
    kind: "video",
    title: "未连接视频",
    metadata: { assetId: "video-node" },
  },
];
const edges = [
  { id: "e1", from: "image", to: "prompt" },
  { id: "e2", from: "text", to: "prompt" },
];
const assets = [
  {
    id: "asset-library",
    type: "audio" as const,
    name: "旁白",
    scope: "team" as const,
  },
  {
    id: "fruit-stall",
    type: "image" as const,
    name: "水果摊",
    category: "environment",
    scope: "personal" as const,
  },
  {
    id: "hero",
    type: "image" as const,
    name: "主角立绘",
    category: "character",
    scope: "personal" as const,
  },
];

describe("canvas mention references", () => {
  it("activates connected nodes and current asset-library results", () => {
    const references = buildCanvasMentionReferences(
      "prompt",
      nodes,
      edges,
      assets,
      "personal"
    );
    expect(references.find(item => item.key === "node:image")?.active).toBe(
      true
    );
    expect(references.find(item => item.key === "node:image")?.assetScope).toBe(
      "personal"
    );
    expect(references.find(item => item.key === "node:orphan")?.active).toBe(
      false
    );
    expect(
      references.find(item => item.key === "asset:asset-library")
    ).toMatchObject({ active: true, assetScope: "team" });
    expect(
      filterCanvasMentionReferences(references, "角色").map(item => item.key)
    ).toEqual(["node:image"]);
  });

  it("without mentions still uses connected nodes as inputs by default", () => {
    const result = buildCanvasMentionGenerationContext(
      "prompt",
      nodes,
      edges,
      "生成画面",
      assets,
      "personal"
    );
    expect(result.prompt).toContain("生成画面");
    expect(result.prompt).toContain("红色风衣");
    expect(result.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeId: "image", type: "image" }),
        expect.objectContaining({ nodeId: "text", type: "text" }),
      ])
    );
  });

  it("can ignore connected inputs until the prompt explicitly @ mentions them", () => {
    const withoutMention = buildCanvasMentionGenerationContext(
      "prompt",
      nodes,
      edges,
      "生成画面",
      assets,
      "personal",
      { includeConnectedInputs: false }
    );
    expect(withoutMention).toEqual({
      prompt: "生成画面",
      inputs: [],
      missingKeys: [],
    });

    const withMention = buildCanvasMentionGenerationContext(
      "prompt",
      nodes,
      edges,
      "用 @[node:image] 生成画面",
      assets,
      "personal",
      { includeConnectedInputs: false }
    );
    expect(withMention.inputs).toEqual([
      expect.objectContaining({ nodeId: "image", type: "image", assetId: "asset-node" }),
    ]);
    expect(withMention.prompt).toContain("图片1");
  });

  it("resolves explicit node and asset tokens and reports stale references", () => {
    const result = buildCanvasMentionGenerationContext(
      "prompt",
      nodes,
      edges,
      "用 @[node:text] 和 @[asset:asset-library]，忽略 @[asset:missing]",
      assets,
      "personal"
    );
    expect(result.prompt).toContain("【文本1】");
    expect(result.prompt).toContain("红色风衣");
    expect(result.prompt).toContain("旁白");
    expect(result.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeId: "text", type: "text" }),
        expect.objectContaining({
          assetId: "asset-library",
          assetScope: "team",
          type: "audio",
        }),
      ])
    );
    expect(result.missingKeys).toEqual(["asset:missing"]);
  });

  it("preserves a cross-scope node asset reference for media hydration", () => {
    const crossScopeNodes = nodes.map(node =>
      node.id === "image"
        ? { ...node, metadata: { ...node.metadata, assetScope: "team" } }
        : node
    );
    const result = buildCanvasMentionGenerationContext(
      "prompt",
      crossScopeNodes,
      edges,
      "使用 @[node:image]",
      assets,
      "personal"
    );
    expect(result.inputs).toContainEqual(
      expect.objectContaining({
        nodeId: "image",
        assetId: "asset-node",
        assetScope: "team",
        type: "image",
      })
    );
  });

  it("renders valid mentions as labels and stale tokens as missing", () => {
    const references = buildCanvasMentionReferences(
      "prompt",
      nodes,
      edges,
      assets,
      "personal"
    );
    expect(
      splitCanvasMentionText("@[node:image] @[node:missing]", references)
    ).toEqual([
      expect.objectContaining({
        type: "reference",
        label: "角色参考",
        missing: false,
      }),
      { type: "text", value: " " },
      expect.objectContaining({
        type: "reference",
        label: "引用已失效",
        missing: true,
      }),
    ]);
  });

  it("keeps editor display short while serializing the stable token for persistence", () => {
    const references = buildCanvasMentionReferences(
      "prompt",
      nodes,
      edges,
      assets,
      "personal"
    );
    const canonical = "前景 @[node:image] 后景";
    const model = buildCanvasMentionEditorModel(canonical, references);
    expect(model.displayValue).not.toContain("@[node:image]");
    expect(model.displayValue).not.toContain("角色参考");
    expect(model.displayValue).toContain("前景");
    expect(model.displayValue).toContain(canvasMentionEditorSpacer("image"));
    const parts = splitCanvasMentionEditorDisplay(
      model.displayValue,
      model.segments,
      references
    );
    expect(parts).toEqual([
      { type: "text", value: "前景 " },
      expect.objectContaining({
        type: "reference",
        key: "node:image",
        label: "角色参考",
        missing: false,
      }),
      { type: "text", value: " 后景" },
    ]);
    expect(
      serializeCanvasMentionEditorValue(model.displayValue, model.segments)
    ).toBe(canonical);
  });

  it("reserves only spacer width for image mention chips", () => {
    const references = buildCanvasMentionReferences(
      "prompt",
      nodes,
      edges,
      assets,
      "personal"
    );
    const image = references.find(item => item.key === "node:image");
    const text = references.find(item => item.key === "node:text");
    expect(canvasMentionEditorDisplayText(image)).toBe(
      canvasMentionEditorSpacer("image")
    );
    expect(canvasMentionEditorDisplayText(image)).not.toContain("角色参考");
    expect(canvasMentionEditorDisplayText(text)).toContain("设定");
  });

  it("widens the display gap between adjacent image mentions", () => {
    const references = buildCanvasMentionReferences(
      "prompt",
      nodes,
      edges,
      assets,
      "personal"
    );
    const withSpace = buildCanvasMentionEditorModel(
      "@[asset:fruit-stall] @[asset:hero]",
      references
    );
    const adjacent = buildCanvasMentionEditorModel(
      "@[asset:fruit-stall]@[asset:hero]",
      references
    );
    expect(withSpace.displayValue).toContain(CANVAS_MENTION_IMAGE_CHIP_GAP);
    expect(adjacent.displayValue).toContain(CANVAS_MENTION_IMAGE_CHIP_GAP);
    expect(withSpace.displayValue.includes(" ")).toBe(false);
    expect(adjacent.displayValue.split(CANVAS_MENTION_IMAGE_CHIP_GAP).length).toBeGreaterThan(1);
  });

  it("moves mention offsets when text is inserted after a chip", () => {
    const references = buildCanvasMentionReferences(
      "prompt",
      nodes,
      edges,
      assets,
      "personal"
    );
    const model = buildCanvasMentionEditorModel("@[node:image]", references);
    const nextDisplay = `${model.displayValue}继续编辑`;
    const nextSegments = applyCanvasMentionEditorEdit(
      model.displayValue,
      nextDisplay,
      model.segments
    );
    expect(serializeCanvasMentionEditorValue(nextDisplay, nextSegments)).toBe(
      "@[node:image]继续编辑"
    );
  });

  it("lists asset-library categories before images when the query is empty", () => {
    const references = buildCanvasMentionReferences(
      "prompt",
      nodes,
      edges,
      assets,
      "personal"
    );
    const items = buildCanvasMentionMenuItems(references, "", null);
    expect(
      items.filter(item => item.kind === "category").map(item => item.label)
    ).toEqual(["人物", "场景", "服饰", "道具", "UI", "参考", "其他"]);
    expect(
      items.some(
        item =>
          item.kind === "reference" && item.reference.group === "asset-library"
      )
    ).toBe(false);
    expect(filterCanvasMentionAssetCategories("场").map(item => item.value)).toEqual(
      ["environment"]
    );
  });

  it("shows only assets in the selected category after drilling into a folder", () => {
    const references = buildCanvasMentionReferences(
      "prompt",
      nodes,
      edges,
      assets,
      "personal"
    );
    expect(
      buildCanvasMentionMenuItems(references, "", "environment")
        .filter(
          (item): item is Extract<typeof item, { kind: "reference" }> =>
            item.kind === "reference" && item.reference.group === "asset-library"
        )
        .map(item => item.reference.key)
    ).toEqual(["asset:fruit-stall"]);
    expect(
      buildCanvasMentionMenuItems(references, "水果", null)
        .filter(item => item.kind === "reference")
        .map(item => (item.kind === "reference" ? item.reference.key : ""))
    ).toContain("asset:fruit-stall");
  });
});
