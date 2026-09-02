import { describe, expect, it } from "vitest";

import {
  buildCanvasFragmentPackage,
  canvasFragmentAssetIds,
  canvasFragmentGroups,
  importCanvasFragmentPackage,
  parseCanvasFragmentPackage,
  serializeCanvasFragmentPackage,
  type CanvasFragmentNode,
} from "./fragment";

const nodes: CanvasFragmentNode[] = [
  { id: "image-1", kind: "image", title: "图", content: "", x: 0, y: 0, width: 200, height: 100, imageAssetId: "asset-old", metadata: { assetId: "asset-old" } },
  { id: "config-1", kind: "config", title: "配置", content: "", x: 300, y: 20, width: 180, height: 120, metadata: { composerContent: "参考 @[node:image-1] 与 @[asset:asset-old]", batchChildIds: ["image-1"] } },
  { id: "outside", kind: "text", title: "外部", content: "", x: 600, y: 0, width: 160, height: 100 },
];

describe("canvas fragment", () => {
  it("clones exported groups without retaining nested references", () => {
    const source = [{
      id: "group-1",
      nodeIds: ["image-1"],
      metadata: { color: "red" },
    }];
    const cloned = canvasFragmentGroups(source);

    expect(cloned).toEqual(source);
    expect(cloned[0]).not.toBe(source[0]);
    expect(cloned[0].metadata).not.toBe(source[0].metadata);
  });

  it("freezes selected nodes, internal edges and omitted boundary edges", () => {
    const fragment = buildCanvasFragmentPackage({
      nodes,
      edges: [
        { id: "inside", from: "image-1", to: "config-1" },
        { id: "boundary", from: "config-1", to: "outside" },
      ],
      selectedIds: new Set(["image-1", "config-1"]),
      projectId: "project-1",
      projectTitle: "画布",
      scope: "team",
      groups: [{ id: "group-1", nodeIds: ["image-1", "outside"], position: { x: -10, y: -10 } }],
    });
    expect(fragment.nodes.map((node) => node.id)).toEqual(["image-1", "config-1"]);
    expect(fragment.connections).toEqual([{ id: "inside", from: "image-1", to: "config-1" }]);
    expect(fragment.omitted_external_connections).toEqual([{ id: "boundary", from: "config-1", to: "outside" }]);
    expect(fragment.groups?.[0].nodeIds).toEqual(["image-1"]);
    expect(canvasFragmentAssetIds(fragment.nodes)).toEqual(["asset-old"]);
  });

  it("remaps node and asset references while centering imported nodes", () => {
    const fragment = buildCanvasFragmentPackage({
      nodes,
      edges: [{ id: "inside", from: "image-1", to: "config-1" }],
      selectedIds: new Set(["image-1", "config-1"]),
      projectId: "project-1",
      projectTitle: "画布",
      scope: "personal",
    });
    const imported = importCanvasFragmentPackage({
      fragment,
      assets: new Map([["asset-old", { id: "asset-new", type: "image", name: "图", url: "/api/assets/asset-new/content", content_type: "image/png" }]]),
      scope: "personal",
      center: { x: 1000, y: 600 },
      createId: (kind, index) => `${kind}-new-${index}`,
      createEdgeId: (index) => `edge-new-${index}`,
      createGroupId: (index) => `group-new-${index}`,
      createDirectorInstanceId: () => "director-new",
    });
    expect(imported.nodes[0]).toMatchObject({ id: "image-new-0", imageAssetId: "asset-new" });
    expect(imported.nodes[0].metadata).toMatchObject({ assetId: "asset-new", content: "", mimeType: "image/png" });
    expect(imported.nodes[1].metadata?.composerContent).toBe("参考 @[node:image-new-0] 与 @[asset:asset-new]");
    expect(imported.nodes[1].metadata?.batchChildIds).toEqual(["image-new-0"]);
    expect(imported.connections).toEqual([{ id: "edge-new-0", from: "image-new-0", to: "config-new-1" }]);
    const left = Math.min(...imported.nodes.map((node) => node.x));
    const right = Math.max(...imported.nodes.map((node) => node.x + node.width));
    expect((left + right) / 2).toBe(1000);
  });

  it("normalizes production canvas node and connection shapes", () => {
    const fragment = parseCanvasFragmentPackage({
      version: 1,
      source_project_id: "production",
      source_project_title: "正式画布",
      scope: "team",
      nodes: [{
        id: "node-1",
        type: "image",
        title: "生产图片",
        position: { x: 12, y: 34 },
        width: 320,
        height: 180,
        metadata: { assetId: "asset-1", content: "/api/assets/asset-1/content" },
      }],
      connections: [{ id: "edge-1", fromNodeId: "node-1", toNodeId: "node-1" }],
      omitted_external_connections: [],
    }, () => "group-generated");
    expect(fragment.nodes[0]).toMatchObject({ id: "node-1", kind: "image", x: 12, y: 34, imageAssetId: "asset-1" });
    expect(fragment.connections[0]).toEqual({ id: "edge-1", from: "node-1", to: "node-1" });
  });

  it("serializes exported fragments with the production node and edge contract", () => {
    const fragment = buildCanvasFragmentPackage({
      nodes,
      edges: [
        { id: "inside", from: "image-1", to: "config-1" },
        { id: "boundary", from: "config-1", to: "outside" },
      ],
      selectedIds: new Set(["image-1", "config-1"]),
      projectId: "project-1",
      projectTitle: "画布",
      scope: "team",
    });
    const serialized = serializeCanvasFragmentPackage(fragment);

    expect(serialized.nodes[0]).toMatchObject({
      id: "image-1",
      type: "image",
      position: { x: 0, y: 0 },
    });
    expect(serialized.nodes[0]).not.toHaveProperty("kind");
    expect(serialized.nodes[0]).not.toHaveProperty("x");
    expect(serialized.connections).toEqual([{ id: "inside", fromNodeId: "image-1", toNodeId: "config-1" }]);
    expect(serialized.omitted_external_connections).toEqual([{ id: "boundary", fromNodeId: "config-1", toNodeId: "outside" }]);
  });
});
