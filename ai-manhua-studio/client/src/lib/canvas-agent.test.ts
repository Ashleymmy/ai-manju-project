import { describe, expect, it } from "vitest";

import {
  applyCanvasAgentOps,
  canvasAgentToolToOps,
  compactCanvasAgentSnapshot,
  isCanvasAgentReadTool,
  isCanvasAgentToolName,
  isCanvasAgentWorkspaceTool,
  type CanvasAgentSnapshot,
} from "./canvas-agent";

const snapshot: CanvasAgentSnapshot = {
  projectId: "canvas-1",
  title: "测试画布",
  nodes: [{ id: "text-1", type: "text", title: "提示词", position: { x: 0, y: 0 }, width: 300, height: 170, metadata: { content: "原文" } }],
  connections: [],
  selectedNodeIds: ["text-1"],
  viewport: { x: 0, y: 0, k: 1 },
};

describe("canvas agent bridge", () => {
  it("applies node, connection, selection and viewport operations atomically", () => {
    const next = applyCanvasAgentOps(snapshot, [
      { type: "add_node", id: "config-1", nodeType: "config", x: 420, y: 0, metadata: { generationMode: "image" } },
      { type: "connect_nodes", fromNodeId: "text-1", toNodeId: "config-1" },
      { type: "select_nodes", ids: ["config-1", "missing"] },
      { type: "set_viewport", viewport: { x: 80, y: 40, k: 1.25 } },
    ]);

    expect(next.nodes.map((node) => node.id)).toEqual(["text-1", "config-1"]);
    expect(next.connections).toHaveLength(1);
    expect(next.selectedNodeIds).toEqual(["config-1"]);
    expect(next.viewport).toEqual({ x: 80, y: 40, k: 1.25 });
  });

  it("converts a production-style generation tool into a runnable flow", () => {
    const ops = canvasAgentToolToOps("canvas_generate_video", {
      prompt: "人物向镜头挥手",
      referenceNodeIds: ["text-1"],
      model: "provider::seedance",
      seconds: "5",
    }, snapshot);

    expect(ops.map((op) => op.type)).toEqual([
      "add_node",
      "add_node",
      "connect_nodes",
      "connect_nodes",
      "select_nodes",
      "run_generation",
    ]);
    expect(ops.at(-1)).toMatchObject({ type: "run_generation", mode: "video" });
  });

  it("deletes matching nodes together with their connections and selection", () => {
    const connected = applyCanvasAgentOps(snapshot, [
      { type: "add_node", id: "config-1", nodeType: "config" },
      { type: "connect_nodes", fromNodeId: "text-1", toNodeId: "config-1" },
    ]);
    const next = applyCanvasAgentOps(connected, [{ type: "delete_node", ids: ["text-1"] }]);

    expect(next.nodes.map((node) => node.id)).toEqual(["config-1"]);
    expect(next.connections).toEqual([]);
    expect(next.selectedNodeIds).toEqual(["config-1"]);
  });

  it("classifies every public tool before dispatching it", () => {
    expect(isCanvasAgentToolName("canvas_generate_video")).toBe(true);
    expect(isCanvasAgentToolName("canvas_unknown")).toBe(false);
    expect(isCanvasAgentReadTool("canvas_search_assets")).toBe(true);
    expect(isCanvasAgentReadTool("canvas_add_assets")).toBe(false);
    expect(isCanvasAgentWorkspaceTool("canvas_add_assets")).toBe(true);
  });

  it("compacts model context without media payloads, signed queries, or unknown metadata", () => {
    const compact = compactCanvasAgentSnapshot({
      ...snapshot,
      nodes: [{
        ...snapshot.nodes[0],
        metadata: {
          content: "data:image/png;base64,secret",
          prompt: "保留这段提示词",
          composerContent: "https://assets.example.com/path/image.png?token=secret",
          status: "success",
          privateToken: "must-not-leak",
        },
      }],
    });

    expect(compact.nodes[0].metadata).toMatchObject({
      content: "[媒体数据已省略]",
      prompt: "保留这段提示词",
      composerContent: "https://assets.example.com/path/image.png",
      status: "success",
    });
    expect(compact.nodes[0].metadata).not.toHaveProperty("privateToken");
  });
});
