import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createCanvasCommands } from "./commands";
import {
  canvasSerializableState,
  createCanvasStore,
  selectCanvasInspectorOpen,
  selectCanvasNodes,
  selectCanvasRunningNodeIds,
  selectCanvasSessionScope,
  selectCanvasViewportZoom,
} from "./store";
import { createCanvasServices } from "@/features/canvas/services/contracts";
import { createCanvasGroup } from "@/features/canvas/domain/groups";
import { buildCanvasSnapshot, parseCanvasSnapshot } from "../domain/snapshotCodec";
import { renameCanvasNode } from "../domain/nodeTitles";

const node = (title: string) => ({
  id: "shared-node",
  kind: "text" as const,
  title,
  content: title,
  x: 0,
  y: 0,
  width: 240,
  height: 160,
});

describe("canvas scoped store", () => {
  it("uses hydrated project titles and compacts generated names through deletion and history restoration", () => {
    const outputs = ["a", "b", "c"].map(id => ({ ...node("旧提示词"), id, metadata: { generatedInCanvas: true } }));
    const blank = { ...node("文本"), id: "blank", content: "" };
    const store = createCanvasStore({ graph: { nodes: [blank, ...outputs] }, session: { projectTitle: "测试" } });
    const actions = store.getState().actions;
    const titles = () => store.getState().graph.nodes.map(item => item.title);
    expect(titles()).toEqual(["文本", "测试text-1", "测试text-2", "测试text-3"]);
    const before = structuredClone(store.getState().graph.nodes);
    actions.setField("graph", "nodes", current => current.filter(item => item.id !== "b"));
    expect(titles()).toEqual(["文本", "测试text-1", "测试text-2"]);
    const after = structuredClone(store.getState().graph.nodes);
    actions.commit({ graph: { nodes: before } });
    expect(titles()).toEqual(["文本", "测试text-1", "测试text-2", "测试text-3"]);
    actions.commit({ graph: { nodes: after } });
    expect(titles()).toEqual(["文本", "测试text-1", "测试text-2"]);
    actions.setField("graph", "nodes", current => renameCanvasNode(current, "a", "苹果"));
    actions.setField("session", "projectTitle", "新画布");
    expect(titles()).toEqual(["文本", "苹果", "新画布text-1"]);
    actions.commit({ session: { projectTitle: "下一画布" }, graph: { nodes: outputs } });
    expect(titles()).toEqual(["下一画布text-1", "下一画布text-2", "下一画布text-3"]);
  });

  it("replaces fallback project prefixes when project details arrive after the snapshot", () => {
    const store = createCanvasStore({ graph: { nodes: [{ ...node("生成结果"), metadata: { generatedInCanvas: true } }] } });
    store.getState().actions.setField("session", "projectTitle", "真实画布");
    expect(store.getState().graph.nodes[0].title).toBe("真实画布text-1");
    const saved = buildCanvasSnapshot({}, store.getState().graph.nodes, [], 100, 0, 0);
    expect(parseCanvasSnapshot(saved)?.nodes[0].title).toBe("真实画布text-1");
  });

  it("deduplicates hydration, insertion and edits in the shared store and saved snapshots", () => {
    const first = { ...node("苹果.png"), id: "first", kind: "image" as const, metadata: { canvasOrigin: "imported" } };
    const second = { ...node("苹果.mp4"), id: "second", kind: "video" as const };
    const store = createCanvasStore({ graph: { nodes: [first, second] } });
    expect(store.getState().graph.nodes.map(item => item.title)).toEqual(["苹果", "苹果（1）"]);
    const actions = store.getState().actions;
    actions.setField("graph", "nodes", current => [{ ...node("苹果.wav"), id: "new", kind: "audio" }, ...current]);
    expect(store.getState().graph.nodes.map(item => item.title)).toEqual(["苹果（2）", "苹果", "苹果（1）"]);
    actions.commit({ graph: { nodes: store.getState().graph.nodes.map(item => item.id === "first" ? { ...item, title: "苹果1.png" } : item) } });
    expect(store.getState().graph.nodes.map(item => item.title)).toEqual(["苹果（2）", "苹果1", "苹果（1）"]);
    const saved = buildCanvasSnapshot({}, store.getState().graph.nodes, [], 100, 0, 0);
    expect(parseCanvasSnapshot(saved)?.nodes.map(item => item.title)).toEqual(["苹果（2）", "苹果1", "苹果（1）"]);
    const legacy = buildCanvasSnapshot({}, [first, second], [], 100, 0, 0);
    expect(parseCanvasSnapshot(legacy)?.nodes.map(item => item.title)).toEqual(["苹果", "苹果（1）"]);
  });

  it("isolates equal node ids, default references, commands, and services by instance", async () => {
    const serviceA = vi.fn(async () => "service-a");
    const serviceB = vi.fn(async () => "service-b");
    const storeA = createCanvasStore();
    const storeB = createCanvasStore();
    const commandsA = createCanvasCommands(storeA, createCanvasServices({ generation: serviceA }));
    const commandsB = createCanvasCommands(storeB, createCanvasServices({ generation: serviceB }));

    expect(storeA.getState().graph.nodes).not.toBe(storeB.getState().graph.nodes);
    expect(storeA.getState().generation.jobProgressByNode)
      .not.toBe(storeB.getState().generation.jobProgressByNode);

    commandsA.graph.setNodes([node("A")]);
    commandsB.graph.setNodes([node("B")]);
    commandsA.ui.setInspectorOpen(true);

    expect(selectCanvasNodes(storeA.getState())[0]?.title).toBe("A");
    expect(selectCanvasNodes(storeB.getState())[0]?.title).toBe("B");
    expect(selectCanvasInspectorOpen(storeA.getState())).toBe(true);
    expect(selectCanvasInspectorOpen(storeB.getState())).toBe(false);
    await expect(commandsA.services.generation(async () => "network-a")).resolves.toBe("service-a");
    await expect(commandsB.services.generation(async () => "network-b")).resolves.toBe("service-b");
    expect(serviceA).toHaveBeenCalledTimes(1);
    expect(serviceB).toHaveBeenCalledTimes(1);
  });

  it("keeps each slice serializable and updates sets through fresh arrays", () => {
    const store = createCanvasStore({ session: { scope: "team" } });
    const commands = createCanvasCommands(store, createCanvasServices());
    const firstSelection = new Set(["one"]);

    commands.graph.setSelectedNodeIds(firstSelection);
    commands.generation.setRunningNodeIds(new Set(["job-one"]));
    firstSelection.add("outside-mutation");

    expect(store.getState().graph.selectedNodeIds).toEqual(["one"]);
    expect(selectCanvasRunningNodeIds(store.getState())).toEqual(["job-one"]);
    expect(selectCanvasSessionScope(store.getState())).toBe("team");
    expect(selectCanvasViewportZoom(store.getState())).toBe(90);
    expect(() => JSON.stringify(canvasSerializableState(store.getState()))).not.toThrow();
  });

  it("commits graph and viewport hydration in one store notification", () => {
    const store = createCanvasStore();
    const commands = createCanvasCommands(store, createCanvasServices());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    commands.commit({
      graph: { nodes: [node("hydrated")], edges: [], groups: [] },
      viewport: { zoom: 125, panX: 40, panY: -20 },
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(selectCanvasNodes(store.getState())[0]?.title).toBe("hydrated");
    expect(selectCanvasViewportZoom(store.getState())).toBe(125);
    unsubscribe();
  });

  it("keeps transient browser and controller objects outside the store source", () => {
    const source = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
    for (const [label, forbidden] of [
      ["DOM elements", /\b(?:Element|HTMLElement|SVGElement|HTMLImageElement|HTMLVideoElement|HTMLAudioElement|HTMLCanvasElement|HTMLMediaElement)\b/],
      ["DOM events", /\b(?:EventTarget|PointerEvent|MouseEvent|KeyboardEvent|WheelEvent|DragEvent)\b/],
      ["file and media objects", /\b(?:Blob|File|FileList|ImageBitmap|MediaStream|AudioContext)\b/],
      ["abort handles", /\b(?:AbortController|AbortSignal)\b/],
      ["animation handles", /\b(?:requestAnimationFrame|cancelAnimationFrame|requestIdleCallback|cancelIdleCallback)\b/],
      ["timer handles", /\b(?:setTimeout|clearTimeout|setInterval|clearInterval)\b/],
      ["object URLs", /\b(?:createObjectURL|revokeObjectURL)\b|blob:/],
      ["async work", /\bPromise\b/],
    ] as const) {
      expect(source, label).not.toMatch(forbidden);
    }
  });

  it("updates group geometry atomically for generation, deletion and history restoration", () => {
    const first = node("first");
    const second = { ...node("second"), id: "second", x: 400 };
    const nodes = [first, second];
    const group = createCanvasGroup(nodes, nodes.map(node => node.id), "group")!;
    const store = createCanvasStore({ graph: { nodes, groups: [{ ...group, width: 100, height: 100 }] } });
    const actions = store.getState().actions;
    expect(store.getState().graph.groups[0]).toEqual(group);
    const onChange = vi.fn();
    store.subscribe(onChange);
    // Loading a different image changes the node's frame and the group together.
    actions.setField("graph", "nodes", current => current.map(node => node.id === second.id ? { ...node, width: 800, height: 500 } : node));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(store.getState().graph.groups[0]).toMatchObject({ width: 1256, height: 574 });
    // Autosave sees exactly the bounds that are drawn.
    expect(canvasSerializableState(store.getState()).graph.groups).toBe(store.getState().graph.groups);
    actions.setField("graph", "nodes", [first]);
    expect(store.getState().graph.groups[0]).toMatchObject({ nodeIds: [first.id], width: 296, height: 234 });
    actions.commit({ graph: { nodes, groups: [{ ...group, width: 1, height: 1 }] } });
    expect(store.getState().graph.groups[0]).toEqual(group);
    const stableGroups = store.getState().graph.groups;
    actions.setField("graph", "nodes", current => current.map(node => ({ ...node, content: "edited text" })));
    expect(store.getState().graph.groups).toBe(stableGroups);
    actions.setField("graph", "groups", []);
    actions.setField("graph", "nodes", current => current.map(node => ({ ...node, x: 20 })));
    expect(store.getState().graph.groups).toEqual([]);
  });
});
