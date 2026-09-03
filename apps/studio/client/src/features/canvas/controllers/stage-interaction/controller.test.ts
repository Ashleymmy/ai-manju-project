import { describe, expect, it, vi } from "vitest";

import { DEFAULT_CANVAS_SHORTCUTS } from "@/features/canvas/domain/hotkeys";
import type { CanvasEdgeData, CanvasNodeData } from "@/features/canvas/domain/types";
import { CanvasStageInteractionController } from "./controller";
import type {
  CanvasStageInteractionAdapter,
  CanvasStageInteractionBindings,
  CanvasStagePointerEvent,
} from "./types";

class FakeStageAdapter implements CanvasStageInteractionAdapter {
  nowValue = 1_000;
  sequence = 0;
  frames = new Map<number, FrameRequestCallback>();
  timers = new Map<number, { callback: () => void; delay: number }>();
  listeners = new Map<string, Set<(event: Event) => void>>();
  wheelListener: ((event: WheelEvent) => void) | null = null;
  captures: Array<{ element: Element; pointerId: number }> = [];
  releases: Array<{ element: Element; pointerId: number }> = [];
  cursorActive = false;

  now = () => this.nowValue;
  createId = () => `edge-${++this.sequence}`;
  requestFrame = (callback: FrameRequestCallback) => {
    const id = ++this.sequence;
    this.frames.set(id, callback);
    return id;
  };
  cancelFrame = (frame: number) => { this.frames.delete(frame); };
  setTimer = (callback: () => void, delay: number) => {
    const id = ++this.sequence;
    this.timers.set(id, { callback, delay });
    return id as unknown as ReturnType<typeof setTimeout>;
  };
  clearTimer = (timer: ReturnType<typeof setTimeout>) => {
    this.timers.delete(timer as unknown as number);
  };
  getRect = () => ({ left: 0, top: 0, width: 1_000, height: 800 });
  closest = () => null;
  getAttribute = () => "";
  elementFromPoint = () => null;
  isHotkeyEditingTarget = () => false;
  isInlineNodeEditor = () => false;
  blurActiveInlineEditorExcept = () => undefined;
  focusInlineEditor = () => undefined;
  capturePointer = (element: Element, pointerId: number) => {
    this.captures.push({ element, pointerId });
  };
  releasePointer = (element: Element, pointerId: number) => {
    this.releases.push({ element, pointerId });
  };
  setPanCursor = (active: boolean) => { this.cursorActive = active; };
  setConnectionHandleMagnet = () => undefined;
  addWindowListener = (type: string, listener: (event: Event) => void) => {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
    return () => listeners.delete(listener);
  };
  addWheelListener = (_element: Element, listener: (event: WheelEvent) => void) => {
    this.wheelListener = listener;
    return () => { this.wheelListener = null; };
  };
  observeStage = (_element: Element, listener: (bounds: { width: number; height: number }) => void) => {
    listener({ width: 1_000, height: 800 });
    return () => undefined;
  };

  emit(type: string, event: object) {
    this.listeners.get(type)?.forEach(listener => listener(event as Event));
  }

  runFrames() {
    while (this.frames.size) {
      const pending = [...this.frames.entries()];
      this.frames.clear();
      pending.forEach(([, callback]) => callback(this.nowValue));
    }
  }

  runTimers(delay: number) {
    const pending = [...this.timers.entries()].filter(([, timer]) => timer.delay === delay);
    pending.forEach(([id, timer]) => {
      this.timers.delete(id);
      timer.callback();
    });
  }
}

function node(id: string, x = 0): CanvasNodeData {
  return {
    id,
    kind: "text",
    title: id,
    content: "",
    x,
    y: 0,
    width: 100,
    height: 100,
  };
}

function pointer(
  currentTarget: Element,
  values: Partial<CanvasStagePointerEvent<Element>> = {},
): CanvasStagePointerEvent<Element> {
  return {
    button: 0,
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    target: currentTarget,
    currentTarget,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...values,
  };
}

function createHarness(initialNodes: CanvasNodeData[] = [node("a"), node("b", 300)]) {
  const adapter = new FakeStageAdapter();
  let nodes = initialNodes;
  let edges: CanvasEdgeData[] = [];
  let groups: CanvasStageInteractionBindings["getGroups"] extends () => infer Result ? Result : never = [];
  let selectedIds = new Set<string>();
  let selectedId = "";
  let selectedGroupId = "";
  let selectedEdgeId = "";
  let hoveredNodeId = "";
  let viewport = { zoom: 100, panX: 0, panY: 0 };
  const resumeHistory = vi.fn();
  const info = vi.fn();
  const controller = new CanvasStageInteractionController(adapter);
  controller.syncViewport(viewport);
  controller.updateBindings({
    isSwitching: () => false,
    isInteractionBlocked: () => false,
    isProjectActionDisabled: () => false,
    getWheelZoomRequiresCtrl: () => true,
    getShortcuts: () => DEFAULT_CANVAS_SHORTCUTS,
    getMinimapModel: () => ({
      width: 100,
      height: 100,
      world: { x: 0, y: 0, width: 1_000, height: 800 },
      nodes: [],
      viewport: { x: 0, y: 0, width: 100, height: 100 },
    }),
    getNodes: () => nodes,
    setNodes: value => { nodes = value; },
    getEdges: () => edges,
    setEdges: value => { edges = value; },
    getGroups: () => groups,
    setGroups: value => { groups = value; },
    getSelectedNodeIds: () => new Set(selectedIds),
    getSelectedGroupId: () => selectedGroupId,
    setSelectedGroupId: value => { selectedGroupId = value; },
    getSelectedEdgeId: () => selectedEdgeId,
    setSelectedEdgeId: value => { selectedEdgeId = value; },
    setHoveredEdgeId: vi.fn(),
    getHoveredNodeId: () => hoveredNodeId,
    setHoveredNodeId: value => { hoveredNodeId = value; },
    getSelectedNode: () => nodes.find(item => item.id === selectedId) || null,
    commitViewport: value => { viewport = value; },
    setInspectorOpen: vi.fn(),
    setEditingInlineNodeId: vi.fn(),
    applyNodeSelection: (ids, primaryId = "") => {
      selectedIds = new Set(ids);
      selectedId = primaryId && selectedIds.has(primaryId)
        ? primaryId
        : selectedIds.values().next().value || "";
      selectedGroupId = "";
      selectedEdgeId = "";
    },
    pauseHistory: vi.fn(),
    resumeHistory,
    setContextMenu: vi.fn(),
    copySelectedNodes: vi.fn(),
    pasteCopiedNodes: vi.fn(),
    undoCanvas: vi.fn(),
    redoCanvas: vi.fn(),
    runSelectedGeneration: vi.fn(),
    removeNodes: vi.fn(),
    removeEdge: vi.fn(),
    onInfo: info,
    onWarning: vi.fn(),
  });
  const stage = {} as Element;
  controller.mount(stage);
  return {
    adapter,
    controller,
    stage,
    info,
    resumeHistory,
    get nodes() { return nodes; },
    get viewport() { return viewport; },
    get selectedIds() { return selectedIds; },
  };
}

describe("CanvasStageInteractionController", () => {
  it("commits node drag once per frame and releases pointer capture on completion", () => {
    const harness = createHarness();
    const nodeElement = {} as HTMLElement;
    harness.controller.startDrag(pointer(nodeElement), harness.nodes[0]);
    expect(harness.controller.mode).toBe("drag");
    expect(harness.adapter.captures).toEqual([{ element: nodeElement, pointerId: 1 }]);

    harness.controller.moveDrag(pointer(nodeElement, { clientX: 20, clientY: 10 }));
    expect(harness.nodes[0]).toMatchObject({ x: 0, y: 0 });
    harness.adapter.runFrames();
    expect(harness.nodes[0]).toMatchObject({ x: 20, y: 10 });

    harness.controller.endDrag();
    expect(harness.controller.mode).toBe("idle");
    expect(harness.adapter.releases).toContainEqual({ element: nodeElement, pointerId: 1 });
    expect(harness.resumeHistory).toHaveBeenLastCalledWith(true);
    expect([...harness.adapter.timers.values()].map(timer => timer.delay)).toContain(0);
  });

  it("keeps a sub-4px connection as click mode and opens creation at the 4px threshold", () => {
    const harness = createHarness([node("source")]);
    const handle = {} as HTMLElement;
    harness.controller.beginConnection(pointer(handle, { clientX: 200, clientY: 200 }), "source", "source");
    harness.adapter.emit("pointermove", { pointerId: 1, clientX: 203, clientY: 200 });
    harness.adapter.emit("pointerup", { pointerId: 1, clientX: 203, clientY: 200 });
    expect(harness.controller.getSnapshot().connectFrom).toBe("source");
    expect(harness.controller.getSnapshot().pendingConnectionCreate).toBeNull();

    harness.controller.beginConnection(pointer(handle, { clientX: 200, clientY: 200 }), "source", "source");
    harness.adapter.emit("pointermove", { pointerId: 1, clientX: 204, clientY: 200 });
    harness.adapter.emit("pointerup", { pointerId: 1, clientX: 204, clientY: 200 });
    expect(harness.controller.getSnapshot().connectFrom).toBe("");
    expect(harness.controller.getSnapshot().pendingConnectionCreate).toMatchObject({
      canvasX: 204,
      canvasY: 148,
      connection: { nodeId: "source", handleType: "source" },
    });
  });

  it("preserves middle-button locked pan and the Ctrl wheel zoom gate", () => {
    const harness = createHarness();
    harness.controller.handleStagePointerDown(pointer(harness.stage, { button: 1 }));
    harness.adapter.emit("pointerup", { pointerId: 1, clientX: 0, clientY: 0 });
    expect(harness.controller.mode).toBe("idle");

    harness.adapter.nowValue = 1_100;
    harness.controller.handleStagePointerDown(pointer(harness.stage, { button: 1 }));
    harness.adapter.emit("pointerup", { pointerId: 1, clientX: 0, clientY: 0 });
    expect(harness.controller.mode).toBe("pan");
    harness.adapter.emit("pointermove", { pointerId: 1, clientX: 12, clientY: 7 });
    harness.adapter.runFrames();
    expect(harness.viewport).toMatchObject({ zoom: 100, panX: 12, panY: 7 });

    harness.adapter.wheelListener?.({
      target: harness.stage,
      ctrlKey: false,
      metaKey: false,
      deltaX: 5,
      deltaY: 10,
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as WheelEvent);
    harness.adapter.runFrames();
    expect(harness.viewport.zoom).toBe(100);
    expect(harness.viewport.panX).toBe(7);

    harness.adapter.wheelListener?.({
      target: harness.stage,
      ctrlKey: true,
      metaKey: false,
      deltaX: 0,
      deltaY: -100,
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as WheelEvent);
    harness.adapter.runFrames();
    expect(harness.viewport.zoom).toBe(110);
  });

  it("keeps Escape from ending an active drag and dispose flushes and releases it", () => {
    const harness = createHarness();
    const nodeElement = {} as HTMLElement;
    harness.controller.startDrag(pointer(nodeElement), harness.nodes[0]);
    harness.controller.moveDrag(pointer(nodeElement, { clientX: 9, clientY: 4 }));
    harness.controller.handleNodeHoverEnd("a");
    harness.adapter.emit("keydown", {
      code: "Escape",
      key: "Escape",
      target: null,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
    });
    expect(harness.controller.mode).toBe("drag");

    harness.controller.dispose();
    expect(harness.nodes[0]).toMatchObject({ x: 9, y: 4 });
    expect(harness.adapter.frames.size).toBe(0);
    expect(harness.adapter.timers.size).toBe(0);
    expect(harness.adapter.releases).toContainEqual({ element: nodeElement, pointerId: 1 });
    expect(harness.resumeHistory).toHaveBeenLastCalledWith(true);
  });
});
