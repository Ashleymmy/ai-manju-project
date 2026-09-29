import { describe, expect, it } from "vitest";
import { applyCanvasAgentOps, canvasAgentToolToOps, type CanvasAgentNode, type CanvasAgentSnapshot } from "./canvas-agent";
import { normalizeCanvasNode, canvasAgentNodeFromCanvas } from "@/features/canvas/domain/nodes";

const empty: CanvasAgentSnapshot = { projectId: "placement", title: "Placement", nodes: [],
  connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };
const node = (id: string, x: number, y: number, width = 320, height = 260): CanvasAgentNode =>
  ({ id, type: "image", position: { x, y }, width, height });
const generate = (state: CanvasAgentSnapshot, mode = "image", input = {}) =>
  applyCanvasAgentOps(state, canvasAgentToolToOps(`canvas_generate_${mode}`, { prompt: "Scene", ...input }, state));
const overlaps = (a: CanvasAgentNode, b: CanvasAgentNode) => a.position.x < b.position.x + b.width
  && a.position.x + a.width > b.position.x && a.position.y < b.position.y + b.height
  && a.position.y + a.height > b.position.y;

describe("Agent generation placement", () => {
  it.each(["image", "video", "audio", "text"])("stacks %s flows despite different model coordinates, selection and viewport", mode => {
    const first = generate(empty, mode, { x: -500, y: 800 });
    const second = generate({ ...first, selectedNodeIds: [], viewport: { x: -9000, y: 400, k: 0.4 } }, mode, { x: 6000, y: -3000 });
    expect(first.nodes[0].position).toEqual({ x: 0, y: 0 });
    expect(second.nodes[2].position.x).toBe(first.nodes[0].position.x);
    expect(second.nodes[3].position.x).toBe(first.nodes[1].position.x);
    expect(second.nodes[2].position.y).toBeGreaterThan(first.nodes[1].position.y + first.nodes[1].height);
    expect(second.nodes.slice(0, 2)).toEqual(first.nodes);
  });

  it("starts below existing content and avoids a node created after tool preparation", () => {
    const original = { ...empty, nodes: [node("original", -600, -200)] };
    const first = generate(original);
    const ops = canvasAgentToolToOps("canvas_generate_image", { prompt: "Next" }, first);
    const obstacle = node("created-while-agent-was-thinking", -600, 500, 1600, 900);
    const live = { ...first, nodes: [...first.nodes, obstacle] };
    const next = applyCanvasAgentOps(live, ops);
    expect(next.nodes.slice(-2)[0].position.x).toBe(-600);
    expect(next.nodes.slice(-2)[0].position.y).toBeGreaterThan(1400);
    expect(next.nodes.slice(0, live.nodes.length)).toEqual(live.nodes);
  });

  it("reserves the output column and follows actual tall results", () => {
    const first = generate(empty);
    const config = first.nodes[1];
    const output = { ...node("output", 876, 24, 320, 800), metadata: { sourceNodeId: config.id } };
    const afterOutput = { ...first, nodes: [...first.nodes, output] };
    const next = generate(afterOutput);
    expect(next.nodes.at(-2)!.position.y).toBeGreaterThan(824);
    // A node in the future output column also blocks the next group before generation starts.
    const withObstacle = { ...empty, nodes: [node("obstacle", 1100, 400, 100, 100)] };
    const nextOnPopulatedCanvas = generate(withObstacle);
    expect(nextOnPopulatedCanvas.nodes[1].position.y).toBeGreaterThan(500);
    expect(next.nodes[2]).toEqual(output);
  });

  it("reserves upward image batches and vertically distributed text results", () => {
    for (const mode of ["image", "text"]) {
      const first = generate(empty, mode, { count: 4 });
      const next = generate(first, mode, { count: 4 });
      const nextPrompt = next.nodes[2];
      const firstConfig = first.nodes[1];
      const nextConfig = next.nodes[3];
      const previousOutputBottom = mode === "image" ? firstConfig.position.y + 24 + 238
        : firstConfig.position.y + 1.5 * 206 + 170;
      const nextOutputTop = mode === "image" ? nextConfig.position.y + 24 - 238 - 36
        : nextConfig.position.y - 1.5 * 206;
      expect(nextPrompt.position.x).toBe(first.nodes[0].position.x);
      expect(nextOutputTop).toBeGreaterThan(previousOutputBottom);
      expect(first.nodes.every(a => next.nodes.slice(2).every(b => !overlaps(a, b)))).toBe(true);
    }
  });

  it("retains the placement anchor after saving and reopening, while preserving explicit moves", () => {
    const first = generate(empty);
    const reopened = { ...first, nodes: JSON.parse(JSON.stringify(first.nodes))
      .map((item: unknown) => canvasAgentNodeFromCanvas(normalizeCanvasNode(item)!)) };
    const second = generate(reopened);
    expect(second.nodes[2].position.x).toBe(first.nodes[0].position.x);
    const moved = applyCanvasAgentOps(second, [{ type: "update_node", id: first.nodes[0].id,
      patch: { position: { x: -800, y: -400 } } }]);
    expect(moved.nodes[0].position).toEqual({ x: -800, y: -400 });
    expect(moved.nodes.slice(1)).toEqual(second.nodes.slice(1));
  });

  it("positions multiple flows in one local ops request and standalone config tools", () => {
    const ops = [...canvasAgentToolToOps("canvas_generate_image", { prompt: "A" }, empty),
      ...canvasAgentToolToOps("canvas_generate_video", { prompt: "B" }, empty)];
    const next = applyCanvasAgentOps(empty, canvasAgentToolToOps("canvas_apply_ops", { ops }, empty));
    expect(next.nodes[2].position.x).toBe(next.nodes[0].position.x);
    expect(next.nodes[2].position.y).toBeGreaterThan(next.nodes[1].position.y + next.nodes[1].height);
    const config = applyCanvasAgentOps(next, canvasAgentToolToOps("canvas_create_config_node", { prompt: "C" }, next));
    expect(config.nodes.at(-1)!.position.x).toBe(0);
    expect(config.nodes.at(-1)!.position.y).toBeGreaterThan(next.nodes[3].position.y + next.nodes[3].height);
  });

  it("leaves ordinary creation and completed generation updates at their requested positions", () => {
    const first = applyCanvasAgentOps(empty, [{ type: "add_node", id: "manual", nodeType: "text", x: 700, y: -800 }]);
    expect(first.nodes[0].position).toEqual({ x: 700, y: -800 });
    const generated = generate(first);
    const finished = applyCanvasAgentOps(generated, [{ type: "update_node", id: generated.nodes[2].id, metadata: { status: "success" } }]);
    expect(finished.nodes.map(item => item.position)).toEqual(generated.nodes.map(item => item.position));
  });
});
