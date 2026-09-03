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
    for (const forbidden of [
      "HTMLElement",
      "PointerEvent",
      "AbortController",
      "requestAnimationFrame",
      "setTimeout",
      "createObjectURL",
      "blob:",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
