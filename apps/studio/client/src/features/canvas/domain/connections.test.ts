import { describe, expect, it, vi } from "vitest";

import {
  addCanvasConnection,
  buildCanvasGenerationInputs,
  buildCanvasConnectionLayerBounds,
  canvasActiveConnectionPath,
  canvasClientPointToWorld,
  canvasConnectionCurvature,
  connectableCanvasNodesToConfig,
  connectCanvasNodesToConfig,
  createConnectedCanvasGraph,
  defaultCanvasConnectionHandle,
  findCanvasConnectionDropTarget,
  isActiveCanvasConnectionPointer,
  isHiddenCanvasBatchChild,
  isHiddenCanvasConnectionEndpoint,
  normalizeCanvasConnection,
  promptFromCanvasTopology,
  visibleCanvasConnectionNodes,
} from "./connections";

const nodes = [
  { id: "prompt", kind: "prompt" },
  { id: "image", kind: "image" },
  { id: "config", kind: "config" },
  { id: "config-2", kind: "config" },
];

describe("canvas connection rules", () => {
  it("normalizes production config-node direction rules", () => {
    expect(normalizeCanvasConnection("prompt", "image", nodes, "source")).toEqual({ from: "prompt", to: "image" });
    expect(normalizeCanvasConnection("prompt", "config", nodes, "source")).toEqual({ from: "prompt", to: "config" });
    expect(normalizeCanvasConnection("config", "image", nodes, "target")).toEqual({ from: "image", to: "config" });
    expect(normalizeCanvasConnection("config", "image", nodes, "source")).toEqual({ from: "config", to: "image" });
  });

  it("uses the production default handle for config nodes", () => {
    expect(defaultCanvasConnectionHandle(nodes[0])).toBe("source");
    expect(defaultCanvasConnectionHandle(nodes[2])).toBe("target");
    expect(defaultCanvasConnectionHandle(null)).toBe("source");
  });

  it("uses the same dynamic curvature for visible and hit-test paths", () => {
    expect(canvasConnectionCurvature(100, 130)).toBe(50);
    expect(canvasConnectionCurvature(100, 700)).toBe(300);
    expect(canvasConnectionCurvature(700, 100)).toBe(300);
  });

  it("builds active preview paths with the production source and target handle directions", () => {
    const source = { id: "source", kind: "prompt", x: 100, y: 80, width: 200, height: 120 };
    const target = { id: "target", kind: "image", x: 500, y: 200, width: 240, height: 160 };

    expect(canvasActiveConnectionPath(source, "source", { x: 420, y: 160 }, target)).toBe(
      "M 300 140 C 400 140, 400 280, 500 280",
    );
    expect(canvasActiveConnectionPath(source, "target", { x: 420, y: 160 }, target)).toBe(
      "M 740 280 C 1060 280, -220 140, 100 140",
    );
  });

  it("rejects missing nodes, self links, and config-to-config links", () => {
    expect(normalizeCanvasConnection("missing", "image", nodes)).toBeNull();
    expect(normalizeCanvasConnection("image", "image", nodes)).toBeNull();
    expect(normalizeCanvasConnection("config", "config-2", nodes)).toBeNull();
  });

  it("does not create a duplicate directed edge", () => {
    const existing = [{ id: "edge-1", from: "prompt", to: "image" }];
    const createId = vi.fn(() => "edge-2");

    expect(addCanvasConnection(existing, { from: "prompt", to: "image" }, createId)).toBe(existing);
    expect(createId).not.toHaveBeenCalled();
  });

  it("creates node and edge atomically only after validation", () => {
    const originalNodes = [{ id: "config", kind: "config" }];
    const originalEdges = [{ id: "edge-1", from: "a", to: "b" }];
    const invalid = createConnectedCanvasGraph(
      originalNodes,
      originalEdges,
      { id: "config-2", kind: "config" },
      { nodeId: "config", handleType: "target" },
      () => "edge-2",
    );
    const valid = createConnectedCanvasGraph(
      originalNodes,
      originalEdges,
      { id: "image", kind: "image" },
      { nodeId: "config", handleType: "target" },
      () => "edge-2",
    );

    expect(invalid).toBeNull();
    expect(originalNodes).toHaveLength(1);
    expect(originalEdges).toHaveLength(1);
    expect(valid).toEqual({
      nodes: [...originalNodes, { id: "image", kind: "image" }],
      edges: [...originalEdges, { id: "edge-2", from: "image", to: "config" }],
      connection: { from: "image", to: "config" },
    });
  });

  it("accepts only the pointer that started the connection drag", () => {
    expect(isActiveCanvasConnectionPointer(true, 7, 7)).toBe(true);
    expect(isActiveCanvasConnectionPointer(true, 7, 8)).toBe(false);
    expect(isActiveCanvasConnectionPointer(false, 7, 7)).toBe(false);
    expect(isActiveCanvasConnectionPointer(true, null, 7)).toBe(false);
  });

  it("connects a multi-selection to config while filtering invalid and duplicate edges", () => {
    const batchNodes = [
      { id: "prompt", kind: "prompt" },
      { id: "image", kind: "image" },
      { id: "root", kind: "image", metadata: { imageBatchExpanded: false } },
      { id: "hidden", kind: "image", metadata: { batchRootId: "root" } },
      { id: "config", kind: "config" },
      { id: "config-2", kind: "config" },
    ];
    let index = 1;
    const result = connectCanvasNodesToConfig(
      batchNodes,
      [{ id: "existing", from: "prompt", to: "config" }],
      ["prompt", "image", "hidden", "config-2", "missing"],
      "config",
      () => `edge-${index++}`,
    );

    expect(result.addedCount).toBe(1);
    expect(result.edges).toEqual([
      { id: "existing", from: "prompt", to: "config" },
      { id: "edge-1", from: "image", to: "config" },
    ]);
    expect(result.sourceNodeIds).toEqual(["prompt", "image"]);
  });

  it("counts only nodes that can actually connect to a config target", () => {
    expect(connectableCanvasNodesToConfig(nodes, ["prompt", "config-2"], "config").map((node) => node.id)).toEqual(["prompt"]);
    expect(connectableCanvasNodesToConfig(nodes, ["prompt", "image"], "config").map((node) => node.id)).toEqual(["prompt", "image"]);
  });
});

describe("canvas batch visibility", () => {
  const batchNodes = [
    { id: "root", kind: "image", metadata: { imageBatchExpanded: false } },
    { id: "child", kind: "image", metadata: { batchRootId: "root", assetId: "asset-child" } },
  ];

  it("hides collapsed batch children and their connection endpoints", () => {
    expect(isHiddenCanvasBatchChild(batchNodes[0], batchNodes)).toBe(false);
    expect(isHiddenCanvasBatchChild(batchNodes[1], batchNodes)).toBe(true);
    expect(isHiddenCanvasConnectionEndpoint(batchNodes[1], batchNodes)).toBe(true);
  });

  it("shows batch children when the root is expanded or absent", () => {
    expect(isHiddenCanvasBatchChild(batchNodes[1], [{ ...batchNodes[0], metadata: { imageBatchExpanded: true } }, batchNodes[1]])).toBe(false);
    expect(isHiddenCanvasBatchChild(batchNodes[1], [{ ...batchNodes[0], metadata: { imageBatchExpanded: 1 } }, batchNodes[1]])).toBe(false);
    expect(isHiddenCanvasBatchChild(batchNodes[1], [batchNodes[1]])).toBe(false);
  });

  it("does not count a collapsed batch child as a visible multi-selection source", () => {
    expect(visibleCanvasConnectionNodes(batchNodes, ["root", "child"]).map((node) => node.id)).toEqual(["root"]);
  });
});

describe("canvas generation topology", () => {
  const topologyNodes = [
    { id: "prompt", kind: "prompt", title: "主提示", content: "主体动作" },
    { id: "note", kind: "text", title: "补充文本", metadata: { prompt: "补充光线" } },
    { id: "image", kind: "image", title: "参考图", imageAssetId: "asset-image" },
    { id: "video", kind: "video", title: "参考视频", metadata: { content: "asset://video" } },
    { id: "audio", kind: "audio", title: "参考音频", metadata: { assetId: "asset-audio" } },
    { id: "config", kind: "config", title: "配置" },
  ];

  it("keeps direct typed inputs in connection order", () => {
    const inputs = buildCanvasGenerationInputs("prompt", topologyNodes, [
      { from: "image", to: "prompt" },
      { from: "note", to: "prompt" },
      { from: "video", to: "prompt" },
      { from: "audio", to: "prompt" },
    ]);

    expect(inputs).toEqual([
      { nodeId: "image", type: "image", title: "参考图", content: undefined, assetId: "asset-image" },
      { nodeId: "note", type: "text", title: "补充文本", text: "补充光线" },
      { nodeId: "video", type: "video", title: "参考视频", content: "asset://video", assetId: undefined },
      { nodeId: "audio", type: "audio", title: "参考音频", content: undefined, assetId: "asset-audio" },
    ]);
  });

  it("uses config inputs before direct inputs and excludes the generating node", () => {
    const inputs = buildCanvasGenerationInputs("prompt", topologyNodes, [
      { from: "note", to: "prompt" },
      { from: "prompt", to: "config" },
      { from: "image", to: "config" },
      { from: "video", to: "config" },
    ]);

    expect(inputs.map((input) => input.nodeId)).toEqual(["image", "video"]);
  });

  it("falls back to a direct media node and keeps own prompt before upstream text", () => {
    expect(buildCanvasGenerationInputs("image", topologyNodes, [])).toEqual([
      { nodeId: "image", type: "image", title: "参考图", content: undefined, assetId: "asset-image" },
    ]);
    expect(promptFromCanvasTopology("prompt", topologyNodes, [{ from: "note", to: "prompt" }], "主体动作")).toBe("主体动作\n\n补充光线");
  });

  it("excludes resources hidden inside a collapsed batch", () => {
    const nodesWithBatch = [
      ...topologyNodes,
      { id: "root", kind: "image", metadata: { imageBatchExpanded: false } },
      { id: "hidden", kind: "text", content: "不应出现", metadata: { batchRootId: "root" } },
    ];

    expect(buildCanvasGenerationInputs("prompt", nodesWithBatch, [{ from: "hidden", to: "prompt" }])).toEqual([]);
  });

  it.each(["image", "video", "audio"] as const)("excludes a collapsed %s batch child from direct self fallback", (kind) => {
    const nodesWithBatch = [
      { id: "root", kind: "image", metadata: { imageBatchExpanded: false } },
      { id: "hidden", kind, metadata: { batchRootId: "root", content: `asset://${kind}` } },
    ];

    expect(buildCanvasGenerationInputs("hidden", nodesWithBatch, [])).toEqual([]);
  });

  it.each([true, 1] as const)("allows direct self fallback when the batch root expanded state is %s", (imageBatchExpanded) => {
    const nodesWithBatch = [
      { id: "root", kind: "image", metadata: { imageBatchExpanded } },
      { id: "child", kind: "image", metadata: { batchRootId: "root", content: "asset://image" } },
    ];

    expect(buildCanvasGenerationInputs("child", nodesWithBatch, [])).toEqual([
      { nodeId: "child", type: "image", title: "child", content: "asset://image", assetId: undefined },
    ]);
  });

  it("treats prompt text in metadata.content as text, never as a media reference", () => {
    const nodes = [
      { id: "target", kind: "prompt", title: "目标", content: "主体" },
      // normalizeCanvasNode 会把顶层提示词回填进 metadata.content，这里模拟回填后的空图片节点
      { id: "empty-image", kind: "image", title: "空图片", metadata: { content: "生成一个苹果", prompt: "生成一个苹果" } },
    ];

    expect(buildCanvasGenerationInputs("target", nodes, [{ from: "empty-image", to: "target" }])).toEqual([
      { nodeId: "empty-image", type: "text", title: "空图片", text: "生成一个苹果" },
    ]);
    // 没有提示词的空媒体节点直接丢弃，不产生任何输入
    const silent = [
      { id: "target", kind: "prompt", title: "目标", content: "主体" },
      { id: "blank", kind: "image", title: "空白图片" },
    ];
    expect(buildCanvasGenerationInputs("target", silent, [{ from: "blank", to: "target" }])).toEqual([]);
  });

  it("keeps asset:// metadata.content as a media reference", () => {
    const nodes = [
      { id: "target", kind: "prompt", title: "目标", content: "主体" },
      { id: "material", kind: "video", title: "素材", metadata: { content: "asset://volcano-1" } },
    ];

    expect(buildCanvasGenerationInputs("target", nodes, [{ from: "material", to: "target" }])).toEqual([
      { nodeId: "material", type: "video", title: "素材", content: "asset://volcano-1", assetId: undefined },
    ]);
  });
});

describe("canvas connection layer bounds", () => {
  it("expands to include negative coordinates and long curved edges", () => {
    const bounds = buildCanvasConnectionLayerBounds(
      [
        { id: "left", kind: "prompt", x: -240, y: -180, width: 180, height: 120 },
        { id: "right", kind: "image", x: 1380, y: 420, width: 220, height: 160 },
      ],
      [{ from: "left", to: "right" }],
    );

    expect(bounds.left).toBeLessThanOrEqual(-180);
    expect(bounds.top).toBeLessThanOrEqual(-240);
    expect(bounds.width).toBeGreaterThan(1500);
    expect(bounds.height).toBeGreaterThan(800);
    expect(bounds.viewBox).toContain(String(bounds.left));
  });

  it("includes connection preview points so the drag line stays visible", () => {
    const bounds = buildCanvasConnectionLayerBounds(
      [
        { id: "source", kind: "prompt", x: 120, y: 120, width: 180, height: 120 },
        { id: "target", kind: "image", x: 680, y: 220, width: 180, height: 120 },
      ],
      [],
      {
        nodeId: "source",
        handleType: "source",
        previewPoint: { x: 1280, y: 960 },
      },
    );

    expect(bounds.width).toBeGreaterThan(1100);
    expect(bounds.height).toBeGreaterThan(900);
  });

  it("includes target-handle preview control points so reverse drag lines are not clipped", () => {
    const bounds = buildCanvasConnectionLayerBounds(
      [
        { id: "config", kind: "config", x: 600, y: 200, width: 220, height: 140 },
      ],
      [],
      {
        nodeId: "config",
        handleType: "target",
        previewPoint: { x: 1000, y: 260 },
      },
    );

    expect(bounds.left + bounds.width).toBeGreaterThanOrEqual(1320);
    expect(bounds.viewBox).toContain(String(bounds.left));
  });
});

describe("canvas connection hit testing", () => {
  it("converts client coordinates through the stage toolbar offset and viewport transform", () => {
    expect(canvasClientPointToWorld(
      452,
      304,
      { left: 20, top: 30 },
      { zoom: 200, panX: 32, panY: 22 },
      52,
    )).toEqual({ x: 200, y: 100 });
  });

  it("keeps connection drop targets accurate at the 5 percent production zoom floor", () => {
    const hitNodes = [
      { id: "source", kind: "prompt", x: 0, y: 0, width: 300, height: 160 },
      { id: "target", kind: "image", x: 1000, y: 200, width: 300, height: 160 },
    ];

    expect(findCanvasConnectionDropTarget(
      hitNodes,
      { nodeId: "source", handleType: "source" },
      { x: 1000, y: 280 },
      { zoom: 5, padding: 28, handleRadius: 18 },
    )).toEqual({ nodeId: "target", isNearNode: true });
  });

  it("reports near-node invalid drops without returning a target id", () => {
    const hitNodes = [
      { id: "source", kind: "config", x: 0, y: 0, width: 260, height: 140 },
      { id: "target", kind: "config", x: 400, y: 0, width: 260, height: 140 },
    ];

    expect(findCanvasConnectionDropTarget(
      hitNodes,
      { nodeId: "source", handleType: "source" },
      { x: 400, y: 70 },
    )).toEqual({ nodeId: "", isNearNode: true });
  });
});
