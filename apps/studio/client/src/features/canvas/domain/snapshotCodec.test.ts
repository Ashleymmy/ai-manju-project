import { describe, expect, it } from "vitest";

import {
  buildCanvasSnapshot,
  canvasAgentSnapshotFromCanvas,
  canvasViewportFromAgent,
  parseCanvasSnapshot,
} from "./snapshotCodec";

describe("canvas snapshot codec", () => {
  it("normalizes nodes while preserving unknown node and metadata fields", () => {
    const parsed = parseCanvasSnapshot({
      nodes: [{
        id: "image-1",
        type: "image",
        title: "参考图",
        position: { x: 12, y: 34 },
        width: 280,
        height: 200,
        customNodeField: { keep: true },
        metadata: { customMetadata: "keep", content: "data:image/png;base64,abc" },
      }],
      connections: [],
      viewport: { x: 7, y: -3, k: 1.25, rotation: 15 },
    });

    expect(parsed?.nodes?.[0]).toMatchObject({
      id: "image-1",
      kind: "image",
      x: 12,
      y: 34,
      customNodeField: { keep: true },
      metadata: { customMetadata: "keep" },
    });
    expect(parsed).toMatchObject({ zoom: 125, panX: 7, panY: -3 });
  });

  it("promotes the first legacy batch child and removes synthetic batch edges", () => {
    const parsed = parseCanvasSnapshot({
      nodes: [
        {
          id: "root",
          kind: "image",
          x: 100,
          y: 200,
          width: 300,
          height: 220,
          metadata: { isBatchRoot: true, batchChildIds: ["child-1", "child-2"], status: "idle" },
        },
        {
          id: "child-1",
          kind: "image",
          x: 0,
          y: 0,
          width: 300,
          height: 220,
          imageAssetId: "asset-promoted",
          metadata: { status: "success", assetId: "asset-promoted" },
        },
        {
          id: "child-2",
          kind: "image",
          x: 0,
          y: 0,
          width: 300,
          height: 220,
          metadata: { status: "loading" },
        },
      ],
      edges: [
        { id: "synthetic", from: "root", to: "child-1" },
        { id: "real", from: "root", to: "child-2" },
      ],
    });

    expect(parsed?.nodes?.map((node) => node.id)).toEqual(["root", "child-2"]);
    const root = parsed?.nodes?.find((node) => node.id === "root");
    expect(root).toMatchObject({ imageAssetId: "asset-promoted", metadata: {
      batchModelV2: true,
      ownAssetId: "asset-promoted",
      batchChildIds: ["child-2"],
      isBatchRoot: true,
    }});
    expect(parsed?.edges).toEqual([]);
    expect(parsed?.zoom).toBe(90);
  });

  it("retains edge and group extensions across decode and encode", () => {
    const source = {
      nodes: [
        { id: "a", kind: "text", x: 0, y: 0, width: 100, height: 80 },
        { id: "b", kind: "config", x: 200, y: 0, width: 100, height: 80 },
      ],
      connections: [{ id: "edge-1", fromNodeId: "a", toNodeId: "b", edgeStyle: "dashed" }],
      groups: [{
        id: "group-1",
        nodeIds: ["a", "b"],
        position: { x: -20, y: -30, anchor: "top-left" },
        width: 340,
        height: 150,
        color: "#fff",
        collapsed: true,
      }],
    };

    const parsed = parseCanvasSnapshot(source)!;
    expect(parsed.edges?.[0]).toMatchObject({ edgeStyle: "dashed" });
    expect(parsed.groups?.[0]).toMatchObject({
      collapsed: true,
      position: { anchor: "top-left" },
    });
    const encoded = buildCanvasSnapshot({}, parsed.nodes || [], parsed.edges || [], 100, 0, 0, parsed.groups);
    expect(encoded.edges?.[0]).toMatchObject({ edgeStyle: "dashed", from: "a", to: "b" });
    expect(encoded.groups?.[0]).toMatchObject({ collapsed: true, position: { anchor: "top-left" } });
  });

  it("preserves nested node position and richer duplicate edge extensions through a golden round trip", () => {
    const source = {
      nodes: [
        {
          id: "a",
          kind: "text",
          position: { x: 10, y: 20, rotation: 9, anchor: { x: 0.5, y: 1 } },
          width: 100,
          height: 80,
        },
        { id: "b", kind: "config", position: { x: 200, y: 20 }, width: 100, height: 80 },
      ],
      connections: [{
        id: "connection-1",
        fromNodeId: "a",
        toNodeId: "b",
        metadata: { connectionOnly: true },
      }],
      edges: [{
        id: "edge-1",
        from: "a",
        to: "b",
        edgeStyle: "dashed",
        metadata: { edgeOnly: true },
      }],
    };

    const parsed = parseCanvasSnapshot(source)!;
    const movedNodes = parsed.nodes!.map((node) => node.id === "a"
      ? { ...node, x: 30, y: 40 }
      : node);
    const encoded = buildCanvasSnapshot(
      source,
      movedNodes,
      parsed.edges!,
      parsed.zoom!,
      parsed.panX!,
      parsed.panY!,
      parsed.groups,
    );

    expect(encoded.nodes?.[0]).toMatchObject({
      position: {
        x: 30,
        y: 40,
        rotation: 9,
        anchor: { x: 0.5, y: 1 },
      },
    });
    expect(encoded.connections?.[0]).toMatchObject({
      id: "connection-1",
      edgeStyle: "dashed",
      metadata: { connectionOnly: true, edgeOnly: true },
    });
    expect(encoded.edges?.[0]).toMatchObject({
      id: "connection-1",
      edgeStyle: "dashed",
      metadata: { connectionOnly: true, edgeOnly: true },
    });
  });

  it("round-trips agent viewport and managed snapshot fields without dropping base data", () => {
    const nodes = [{
      id: "text-1",
      kind: "text" as const,
      title: "提示",
      content: "雨夜",
      x: 10,
      y: 20,
      width: 300,
      height: 170,
      metadata: { custom: "keep" },
    }];
    const edges = [{ id: "edge-1", from: "text-1", to: "config-1" }];
    const agent = canvasAgentSnapshotFromCanvas("p-1", "项目", nodes, edges, new Set(["text-1"]), {
      zoom: 150,
      panX: -20,
      panY: 33,
    });
    expect(agent.viewport).toEqual({ x: -20, y: 33, k: 1.5 });
    expect(canvasViewportFromAgent(agent.viewport)).toEqual({ zoom: 150, panX: -20, panY: 33 });

    const base = { customExtension: { keep: true }, viewport: { rotation: 9 } };
    const encoded = buildCanvasSnapshot(base, nodes, edges, 150, -20, 33);
    expect(encoded.customExtension).toEqual({ keep: true });
    expect(encoded.viewport).toEqual({ x: -20, y: 33, k: 1.5, rotation: 9 });
    expect(encoded.nodes?.[0]).toMatchObject({ metadata: { custom: "keep" } });
  });
});
