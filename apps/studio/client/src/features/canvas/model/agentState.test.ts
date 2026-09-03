import { describe, expect, it, vi } from "vitest";

import {
  applyCanvasAgentOps,
  type CanvasAgentSnapshot,
} from "@/lib/canvas-agent";
import {
  canvasAgentSnapshotFromCanvas,
  canvasViewportFromAgent,
} from "@/features/canvas/domain/snapshotCodec";
import {
  normalizeCanvasEdge,
  normalizeCanvasNode,
} from "@/features/canvas/domain/nodes";
import type {
  CanvasEdgeData,
  CanvasNodeData,
} from "@/features/canvas/domain/types";
import { createCanvasServices } from "@/features/canvas/services/contracts";
import { createCanvasCommands } from "./commands";
import { commitCanvasAgentState } from "./agentState";
import { createCanvasStore } from "./store";

const before: CanvasAgentSnapshot = {
  projectId: "canvas-1",
  title: "测试画布",
  nodes: [{
    id: "text-1",
    type: "text",
    title: "提示词",
    position: { x: 0, y: 0 },
    width: 300,
    height: 170,
    metadata: { content: "原文" },
  }],
  connections: [],
  selectedNodeIds: ["text-1"],
  viewport: { x: -8, y: 4, k: 0.91 },
};

function canvasStateFromAgent(snapshot: CanvasAgentSnapshot) {
  const nodes = snapshot.nodes
    .map(normalizeCanvasNode)
    .filter((node): node is CanvasNodeData => Boolean(node));
  const edges = snapshot.connections
    .map(normalizeCanvasEdge)
    .filter((edge): edge is CanvasEdgeData => Boolean(edge));
  const selectedNodeIds = snapshot.selectedNodeIds.filter((id) => nodes.some((node) => node.id === id));
  return { nodes, edges, selectedNodeIds };
}

describe("Canvas Agent state commit", () => {
  it("normalizes one fractional apply and restores undo with atomic state, persistence, and menu cleanup", async () => {
    const initial = canvasStateFromAgent(before);
    const initialViewport = canvasViewportFromAgent(before.viewport);
    const store = createCanvasStore({
      graph: initial,
      viewport: initialViewport,
    });
    const commands = createCanvasCommands(store, createCanvasServices());
    const viewportRef = { current: initialViewport };
    const persistSnapshot = vi.fn(async () => true);
    let contextMenuOpen = true;
    const closeContextMenu = vi.fn(() => { contextMenuOpen = false; });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    const appliedAgentSnapshot = applyCanvasAgentOps(before, [{
      type: "set_viewport",
      viewport: { x: 12.6, y: -3.4, k: 1.234 },
    }]);
    const applied = canvasStateFromAgent(appliedAgentSnapshot);
    const appliedViewport = await commitCanvasAgentState({
      commands,
      ...applied,
      agentViewport: appliedAgentSnapshot.viewport,
      viewportRef,
      closeContextMenu,
      persistSnapshot,
    });

    expect(appliedViewport).toEqual({ zoom: 123, panX: 13, panY: -3 });
    expect(store.getState().viewport).toMatchObject(appliedViewport);
    expect(viewportRef.current).toEqual(appliedViewport);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(persistSnapshot).toHaveBeenLastCalledWith(
      applied.nodes,
      applied.edges,
      123,
      { quiet: true, panX: 13, panY: -3 },
    );
    expect(canvasAgentSnapshotFromCanvas(
      before.projectId,
      before.title,
      applied.nodes,
      applied.edges,
      new Set(applied.selectedNodeIds),
      viewportRef.current,
    ).viewport).toEqual({ x: 13, y: -3, k: 1.23 });
    expect(contextMenuOpen).toBe(false);

    contextMenuOpen = true;
    listener.mockClear();
    const restoredViewport = await commitCanvasAgentState({
      commands,
      ...initial,
      agentViewport: before.viewport,
      viewportRef,
      closeContextMenu,
      persistSnapshot,
    });

    expect(restoredViewport).toEqual({ zoom: 91, panX: -8, panY: 4 });
    expect(store.getState().viewport).toMatchObject(restoredViewport);
    expect(viewportRef.current).toEqual(restoredViewport);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(persistSnapshot).toHaveBeenLastCalledWith(
      initial.nodes,
      initial.edges,
      91,
      { quiet: true, panX: -8, panY: 4 },
    );
    expect(canvasAgentSnapshotFromCanvas(
      before.projectId,
      before.title,
      initial.nodes,
      initial.edges,
      new Set(initial.selectedNodeIds),
      viewportRef.current,
    ).viewport).toEqual(before.viewport);
    expect(closeContextMenu).toHaveBeenCalledTimes(2);
    expect(contextMenuOpen).toBe(false);

    unsubscribe();
  });
});
