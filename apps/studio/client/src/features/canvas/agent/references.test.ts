import { describe, expect, it } from "vitest";
import { canvasAgentToolToOps, type CanvasAgentSnapshot } from "@/lib/canvas-agent";
import { buildCanvasMentionGenerationContext } from "../domain/mentions";
import { applyAgentReferencesToOps, canvasAgentReferences, persistableAgentReferences } from "./references";

const snapshot: CanvasAgentSnapshot = {
  projectId: "refs", title: "References", viewport: { x: 0, y: 0, k: 1 }, selectedNodeIds: ["image"], connections: [],
  nodes: [
    { id: "image", type: "image", title: "Reference", imageAssetId: "asset-1", position: { x: 0, y: 0 }, width: 200, height: 100, metadata: { assetScope: "team" } },
    { id: "config", type: "config", position: { x: 300, y: 0 }, width: 200, height: 100, metadata: { composerContent: "Existing prompt" } },
  ],
};
const references = canvasAgentReferences(snapshot, "personal").slice(0, 1);

describe("Agent references", () => {
  it("reuses editor media resolution, scope and text references", () => {
    expect(references[0]).toMatchObject({ nodeId: "image", kind: "image", assetId: "asset-1", assetScope: "team", mentionKey: "node:image" });
    expect(canvasAgentReferences({ ...snapshot, nodes: [{ ...snapshot.nodes[0], imageAssetId: undefined, metadata: { content: "data:image/png;base64,AAAA" } }] }, "team")[0]).toMatchObject({ content: "data:image/png;base64,AAAA", assetScope: "team" });
  });

  it.each(["canvas_generate_image", "canvas_generate_video", "canvas_create_config_node", "canvas_create_generation_flow", "canvas_create_image_prompt_flow"])("adds real @ inputs to %s even without model-provided references", name => {
    const ops = applyAgentReferencesToOps(canvasAgentToolToOps(name, { prompt: "New scene", autoRun: true }, snapshot), references, snapshot);
    const config = ops.find(op => op.type === "add_node" && op.nodeType === "config");
    expect(config).toMatchObject({ metadata: { composerContent: expect.stringContaining("@[node:image]") } });
    const run = ops.find(op => op.type === "run_generation");
    expect(run).toMatchObject({ prompt: expect.stringContaining("@[node:image]") });
    if (run?.type !== "run_generation") throw new Error("Missing run");
    const context = buildCanvasMentionGenerationContext(run.nodeId, snapshot.nodes.map(node => ({ ...node, kind: node.type })), [], run.prompt!, [], "personal", { includeConnectedInputs: false });
    expect(context.inputs).toContainEqual(expect.objectContaining({ nodeId: "image", type: "image", assetId: "asset-1", assetScope: "team" }));
  });

  it("preserves existing composer text and deduplicates explicit references", () => {
    const ops = applyAgentReferencesToOps([{ type: "run_generation", nodeId: "config" }], references, snapshot);
    expect(ops[0]).toMatchObject({ prompt: "Existing prompt\n@[node:image]" });
    expect(applyAgentReferencesToOps(ops, references, snapshot)).toEqual(ops);
  });

  it("does not alter move/read/edit tools, but rejects deleted sources before generating", () => {
    const ops = canvasAgentToolToOps("canvas_move_nodes", { items: [{ id: "image", x: 100 }] }, snapshot);
    expect(applyAgentReferencesToOps(ops, references, snapshot)).toEqual(ops);
    expect(() => applyAgentReferencesToOps([{ type: "delete_node", id: "image" }, { type: "run_generation", nodeId: "config" }], references, snapshot)).toThrow("已删除");
    expect(() => applyAgentReferencesToOps([{ type: "run_generation", nodeId: "image" }], references, snapshot)).toThrow("不能覆盖");
  });

  it("never persists image bytes or large source text in conversation history", () => {
    expect(persistableAgentReferences([{ ...references[0], content: "data:image/png;base64,AAAA", text: "Large text" }])[0]).not.toHaveProperty("content");
    expect(persistableAgentReferences([{ ...references[0], text: "Large text" }])[0]).not.toHaveProperty("text");
  });

  it("does not silently switch to an overwritten image while awaiting confirmation", () => {
    const changed = { ...snapshot, nodes: snapshot.nodes.map(node => node.id === "image" ? { ...node, imageAssetId: "asset-replaced" } : node) };
    expect(() => applyAgentReferencesToOps([{ type: "run_generation", nodeId: "config" }], references, changed)).toThrow("已变化");
  });

  it("passes multiple video references through the same @ generation context", () => {
    const videoSnapshot = { ...snapshot, nodes: ["video-a", "video-b"].map(id => ({ ...snapshot.nodes[0], id, type: "video", imageAssetId: `asset-${id}` })) };
    const videoReferences = canvasAgentReferences(videoSnapshot, "personal");
    const ops = applyAgentReferencesToOps(canvasAgentToolToOps("canvas_generate_video", { prompt: "Continue the scene" }, videoSnapshot), videoReferences, videoSnapshot);
    const run = ops.find(op => op.type === "run_generation");
    if (run?.type !== "run_generation") throw new Error("Missing generation");
    const context = buildCanvasMentionGenerationContext(run.nodeId, videoSnapshot.nodes.map(node => ({ ...node, kind: node.type })), [], run.prompt!, [], "personal", { includeConnectedInputs: false });
    expect(context.inputs.filter(input => input.type === "video").map(input => input.assetId)).toEqual(["asset-video-a", "asset-video-b"]);
  });
});
