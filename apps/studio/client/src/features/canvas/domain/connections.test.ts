import { describe, expect, it, vi } from "vitest";
import type { CanvasGroupData } from "./groups";

import {
  addCanvasConnection,
  buildCanvasGenerationInputs,
  buildCanvasConnectionLayerBounds,
  canvasActiveConnectionPath,
  canvasClientPointToWorld,
  canvasConnectionCurvature,
  canvasConnectionDisplayNode,
  canvasGroupConnections,
  connectableCanvasNodesToConfig,
  connectCanvasNodesToConfig,
  createConnectedCanvasGraph,
  defaultCanvasConnectionHandle,
  findCanvasConnectionDropTarget,
  incomingCanvasMediaSources,
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
    expect(normalizeCanvasConnection("image", "prompt", nodes, "target")).toEqual({ from: "prompt", to: "image" });
    expect(normalizeCanvasConnection("image", "config", nodes, "target")).toEqual({ from: "config", to: "image" });
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

  it.each(["image", "video", "audio", "text", "prompt", "note", "config", "director"])("keeps %s connections output-to-input for both drag directions", kind => {
    const pair = [
      { id: "first", kind, x: 100, y: 80, width: 200, height: 120 },
      { id: "second", kind: "text", x: 550, y: 280, width: 200, height: 120 },
    ];
    expect(normalizeCanvasConnection("first", "second", pair, "source")).toEqual({ from: "first", to: "second" });
    expect(normalizeCanvasConnection("second", "first", pair, "target")).toEqual({ from: "first", to: "second" });
    const path = "M 300 140 C 425 140, 425 340, 550 340";
    expect(canvasActiveConnectionPath(pair[0], "source", { x: 0, y: 0 }, pair[1])).toBe(path);
    expect(canvasActiveConnectionPath(pair[1], "target", { x: 0, y: 0 }, pair[0])).toBe(path);
  });

  it.each([25, 50, 100, 200])("rejects the wrong side for nodes and group frames at %s percent zoom", zoom => {
    const pair = [
      { id: "a", kind: "audio", x: 0, y: 0, width: 300, height: 200 },
      { id: "b", kind: "text", x: 700, y: 300, width: 300, height: 200 },
    ];
    for (const groups of [[], [{ id: "group", title: "Group", nodeIds: ["b"], position: { x: 700, y: 300 }, width: 300, height: 200, color: "#fff" }]]) {
      for (const handleType of ["source", "target"] as const) {
        const options = { zoom, groups };
        const draft = { nodeId: "a", handleType };
        const compatible = { x: handleType === "source" ? 700 : 1000, y: 400 };
        const incompatible = { x: handleType === "source" ? 1000 : 700, y: 400 };
        expect(findCanvasConnectionDropTarget(pair, draft, compatible, options)).toEqual({ nodeId: "b", isNearNode: true });
        expect(findCanvasConnectionDropTarget(pair, draft, incompatible, options)).toEqual({ nodeId: "", isNearNode: true });
      }
    }
  });

  it("keeps short preview curves identical to finished edge curvature", () => {
    const from = { id: "a", kind: "audio", x: 0, y: 0, width: 100, height: 100 };
    const to = { id: "b", kind: "text", x: 148, y: 200, width: 100, height: 100 };
    expect(canvasActiveConnectionPath(from, "source", { x: 148, y: 250 }, to)).toBe("M 100 50 C 150 50, 98 250, 148 250");
  });

  it.each([false, true])("anchors both preview directions to group frames (pending=%s) without mutating members", pending => {
    const member = { id: "member", kind: "image", x: 100, y: 80, width: 200, height: 120 };
    const group: CanvasGroupData = {
      id: "group", title: "Group", color: "#fff", nodeIds: [member.id], pending,
      position: { x: 40, y: 20 }, width: 400, height: 400,
    };
    expect(canvasActiveConnectionPath(member, "source", { x: 600, y: 300 }, null, [group]))
      .toBe("M 440 220 C 520 220, 520 300, 600 300");
    expect(canvasActiveConnectionPath(member, "target", { x: -100, y: 300 }, null, [group]))
      .toBe("M -100 300 C -30 300, -30 220, 40 220");
    const moved = { ...group, position: { x: 60, y: 40 }, height: 600 };
    expect(canvasActiveConnectionPath(member, "source", { x: 600, y: 300 }, null, [moved]))
      .toBe("M 460 340 C 530 340, 530 300, 600 300");
    expect(canvasConnectionDisplayNode(member, [group])).toMatchObject({ x: 40, y: 20, width: 400, height: 400 });
    expect(canvasConnectionDisplayNode(member, [])).toBe(member);
    expect(member).toMatchObject({ x: 100, y: 80, width: 200, height: 120 });
  });

  it("snaps group-to-group previews to the same frames as finished connections", () => {
    const source = { id: "source", kind: "image", x: 80, y: 80, width: 100, height: 100 };
    const target = { id: "target", kind: "image", x: 900, y: 80, width: 100, height: 100 };
    const groups: CanvasGroupData[] = [
      { id: "a", title: "A", color: "#fff", nodeIds: [source.id], position: { x: 0, y: 0 }, width: 400, height: 400 },
      { id: "b", title: "B", color: "#fff", nodeIds: [target.id], position: { x: 800, y: 100 }, width: 500, height: 600 },
    ];
    const path = "M 400 200 C 600 200, 600 400, 800 400";
    expect(canvasActiveConnectionPath(source, "source", { x: 900, y: 80 }, target, groups)).toBe(path);
    expect(canvasActiveConnectionPath(target, "target", { x: 80, y: 80 }, source, groups)).toBe(path);
    const preview = { nodeId: source.id, handleType: "source" as const, targetNodeId: target.id };
    const edges = [{ from: source.id, to: target.id }];
    const projected = [source, target].map(node => canvasConnectionDisplayNode(node, groups));
    expect(buildCanvasConnectionLayerBounds([source, target], edges, preview, groups))
      .toEqual(buildCanvasConnectionLayerBounds(projected, edges, preview));
    expect(canvasActiveConnectionPath(source, "source", { x: 900, y: 80 }, target, groups.map(group => ({ ...group, pending: true }))))
      .toBe(path);
  });

  it.each([false, true])("connects all visible group members in both directions (pending=%s)", pending => {
    const members = [
      { id: "a", kind: "image" }, { id: "b", kind: "video" },
      { id: "hidden", kind: "image", metadata: { batchRootId: "a" } },
      { id: "c", kind: "image" }, { id: "d", kind: "text" },
    ];
    const groups: CanvasGroupData[] = [
      { id: "ab", title: "AB", nodeIds: ["a", "b", "hidden", "missing"], position: { x: 0, y: 0 }, width: 300, height: 200, color: "#fff", pending },
      { id: "cd", title: "CD", nodeIds: ["c", "d"], position: { x: 500, y: 0 }, width: 300, height: 200, color: "#fff" },
    ];
    expect(canvasGroupConnections("a", "c", members, "source", groups)).toEqual([
      { from: "a", to: "c" }, { from: "a", to: "d" }, { from: "b", to: "c" }, { from: "b", to: "d" },
    ]);
    expect(canvasGroupConnections("b", "c", members, "target", groups)).toEqual([
      { from: "c", to: "a" }, { from: "d", to: "a" }, { from: "c", to: "b" }, { from: "d", to: "b" },
    ]);
    expect(canvasGroupConnections("a", "b", members, "source", groups)).toEqual([]);
    for (const handleType of ["source", "target"] as const) {
      let id = 0;
      const graph = createConnectedCanvasGraph(members, [], { id: "new", kind: "image" }, { nodeId: "b", handleType }, () => `edge-${++id}`, groups)!;
      expect(graph.edges.map(({ from, to }) => ({ from, to }))).toEqual(handleType === "source"
        ? [{ from: "a", to: "new" }, { from: "b", to: "new" }]
        : [{ from: "new", to: "a" }, { from: "new", to: "b" }]);
    }
  });

  it("accepts a mixed group's valid config connections even if its port belongs to a config", () => {
    const group: CanvasGroupData = { id: "mixed", title: "Mixed", nodeIds: ["config", "image"], position: { x: 0, y: 0 }, width: 300, height: 200, color: "#fff", pending: true };
    const graph = createConnectedCanvasGraph(nodes, [], { id: "new", kind: "config" }, { nodeId: "config", handleType: "source" }, () => "edge", [group]);
    expect(graph?.edges).toEqual([{ id: "edge", from: "image", to: "new" }]);
  });

  it("hit-tests temporary frame ports and excludes its own members at different zoom levels", () => {
    const members = [
      { id: "outside", kind: "image", x: 0, y: 0, width: 100, height: 100 },
      { id: "a", kind: "image", x: 800, y: 400, width: 100, height: 100 },
      { id: "b", kind: "video", x: 1000, y: 200, width: 100, height: 100 },
    ];
    const group: CanvasGroupData = { id: "selection", title: "Selection", nodeIds: ["a", "b"], position: { x: 700, y: 100 }, width: 500, height: 500, color: "#fff", pending: true };
    for (const zoom of [50, 100, 200]) {
      const options = { groups: [group], zoom };
      expect(findCanvasConnectionDropTarget(members, { nodeId: "outside", handleType: "source" }, { x: 700, y: 350 }, options).nodeId).toBe("b");
      expect(findCanvasConnectionDropTarget(members, { nodeId: "outside", handleType: "target" }, { x: 1200, y: 350 }, options).nodeId).toBe("b");
      expect(findCanvasConnectionDropTarget(members, { nodeId: "a", handleType: "source" }, { x: 1000, y: 250 }, options))
        .toEqual({ nodeId: "", isNearNode: true });
    }
    expect(canvasConnectionDisplayNode(members[1], [group, { ...group, id: "old", pending: false, position: { x: 900, y: 0 } }])).toMatchObject({ x: 700, y: 100 });
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
    // A standalone generated video is the current output, not a video
    // reference for its own retry. References require an explicit edge.
    expect(buildCanvasGenerationInputs("video", topologyNodes, [])).toEqual([]);
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

  it("lists incoming image media for the inspector reference strip", () => {
    const listed = incomingCanvasMediaSources("placeholder", [
      { id: "placeholder", kind: "image" },
      { id: "ref-a", kind: "image", title: "A", imageSrc: "https://example.test/a.png" },
      { id: "ref-b", kind: "image", title: "B", imageAssetId: "asset-b" },
      { id: "empty", kind: "image", title: "空占位" },
      { id: "note", kind: "text", title: "文本" },
    ], [
      { id: "e1", from: "ref-a", to: "placeholder" },
      { id: "e2", from: "empty", to: "placeholder" },
      { id: "e3", from: "note", to: "placeholder" },
      { id: "e4", from: "ref-b", to: "placeholder" },
      { id: "e5", from: "ref-a", to: "other" },
    ]);

    expect(listed.map((item) => item.node.id)).toEqual(["ref-a", "ref-b"]);
  });

  it("hides collapsed batch children from the incoming image strip", () => {
    expect(incomingCanvasMediaSources("target", [
      { id: "target", kind: "image" },
      { id: "root", kind: "image", metadata: { imageBatchExpanded: false } },
      { id: "hidden", kind: "image", imageSrc: "https://example.test/hidden.png", metadata: { batchRootId: "root" } },
    ], [
      { id: "e1", from: "hidden", to: "target" },
    ])).toEqual([]);
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
