import { describe, expect, it, vi } from "vitest";

import { DEFAULT_CANVAS_SHORTCUTS } from "@/features/canvas/domain/hotkeys";
import { CANVAS_NODE_DOCK_GAP } from "@/features/canvas/domain/nodeSnap";
import { createCanvasGroup, type CanvasGroupData } from "@/features/canvas/domain/groups";
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
  focusStage = vi.fn();
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
    altKey: false,
    target: currentTarget,
    currentTarget,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...values,
  };
}

function createHarness(initialNodes: CanvasNodeData[] = [node("a"), node("b", 300)], initialGroups: CanvasGroupData[] = [], overrides: Partial<CanvasStageInteractionBindings> = {}) {
  const adapter = new FakeStageAdapter();
  let nodes = initialNodes;
  let edges: CanvasEdgeData[] = [];
  let groups = initialGroups;
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
    pasteClipboardData: vi.fn(() => true),
    undoCanvas: vi.fn(),
    redoCanvas: vi.fn(),
    runSelectedGeneration: vi.fn(),
    removeNodes: vi.fn(),
    removeEdge: vi.fn(),
    onInfo: info,
    onWarning: vi.fn(),
    ...overrides,
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
    get edges() { return edges; },
    get groups() { return groups; },
    get selectedGroupId() { return selectedGroupId; },
    get viewport() { return viewport; },
    get selectedIds() { return selectedIds; },
  };
}

describe("CanvasStageInteractionController", () => {
  it.each(["source", "target"] as const)("connects an entire temporary selection with the %s port without duplicates", handleType => {
    const nodes = [node("a"), node("b", 150), node("outside", 600)];
    const group = { ...createCanvasGroup(nodes, ["a", "b"], "selection")!, pending: true };
    const harness = createHarness(nodes, [group]);
    expect(harness.controller.connectNodes("a", "outside", handleType)).toBe(true);
    expect(harness.controller.connectNodes("b", "outside", handleType)).toBe(true);
    expect(harness.edges.map(({ from, to }) => ({ from, to }))).toEqual(handleType === "source"
      ? [{ from: "a", to: "outside" }, { from: "b", to: "outside" }]
      : [{ from: "outside", to: "a" }, { from: "outside", to: "b" }]);
    expect(harness.controller.connectNodes("a", "b")).toBe(false);
    expect(harness.edges).toHaveLength(2);
    harness.controller.dispose();
  });

  it("drops onto a temporary frame boundary away from its member cards", () => {
    const nodes = [node("outside"), { ...node("a", 400), y: 200 }, { ...node("b", 600), y: 400 }];
    const group = { ...createCanvasGroup(nodes, ["a", "b"], "selection")!, pending: true };
    const harness = createHarness(nodes, [group]);
    const handle = {} as HTMLElement;
    harness.controller.beginConnection(pointer(handle, { clientX: 100, clientY: 102 }), "outside", "source");
    const drop = { pointerId: 1, clientX: group.position.x, clientY: group.position.y + group.height / 2 + 52 };
    harness.adapter.emit("pointermove", drop);
    harness.adapter.emit("pointerup", drop);
    expect(harness.edges.map(({ from, to }) => ({ from, to }))).toEqual([{ from: "outside", to: "a" }, { from: "outside", to: "b" }]);
    expect(harness.controller.getSnapshot().pendingConnectionCreate).toBeNull();
    harness.controller.dispose();
  });

  it("keeps a temporary group while click-connecting to a node body", () => {
    const nodes = [node("a"), node("b", 150), node("outside", 600)];
    const group = { ...createCanvasGroup(nodes, ["a", "b"], "selection")!, pending: true };
    const dismissPendingGroup = vi.fn();
    const harness = createHarness(nodes, [group], { dismissPendingGroup });
    const target = {} as HTMLElement;
    harness.controller.beginConnection(pointer(target), "b", "source");
    vi.spyOn(harness.adapter, "closest").mockReturnValue(target);
    harness.controller.handleStagePointerDown(pointer(target));
    expect(dismissPendingGroup).not.toHaveBeenCalled();
    harness.controller.chooseNode("outside");
    expect(harness.edges).toHaveLength(2);
    harness.controller.dispose();
  });

  it.each(["image", "video"] as const)("resizes %s proportionally at different zoom levels and records one history entry", kind => {
    for (const zoom of [50, 100, 200]) {
      const media = { ...node("media"), kind, width: 320, height: 180, metadata: { naturalWidth: 1920, naturalHeight: 1080 } };
      const pauseHistory = vi.fn();
      const harness = createHarness([media, node("untouched")], [], { pauseHistory });
      const handle = {} as HTMLButtonElement;
      const event = (x: number, y: number) => pointer(handle, { clientX: x, clientY: y }) as CanvasStagePointerEvent<HTMLButtonElement>;
      harness.controller.syncViewport({ zoom, panX: 0, panY: 0 });
      harness.controller.startResize(event(10, 20), media);
      harness.controller.moveResize(event(10 + 160 * zoom / 100, 20 + 90 * zoom / 100));
      harness.adapter.runFrames();
      expect(harness.nodes[0]).toMatchObject({ width: 480, height: 270, x: 0, y: 0 });
      expect(harness.nodes[1]).toEqual(node("untouched"));
      harness.controller.endResize();
      expect(pauseHistory).toHaveBeenCalledTimes(1);
      expect(harness.resumeHistory).toHaveBeenCalledTimes(1);
      expect(harness.resumeHistory).toHaveBeenCalledWith(true);
      expect(harness.adapter.releases).toEqual([{ element: handle, pointerId: 1 }]);
      harness.controller.dispose();
    }
  });

  it("does not resize or create history when the handle is only clicked", () => {
    const media = { ...node("media"), kind: "image" as const, width: 320, height: 180 };
    const harness = createHarness([media]);
    const event = pointer({} as HTMLButtonElement) as CanvasStagePointerEvent<HTMLButtonElement>;
    harness.controller.startResize(event, media);
    harness.controller.moveResize(event);
    harness.controller.endResize();
    expect(harness.nodes[0]).toBe(media);
    expect(harness.resumeHistory).toHaveBeenCalledTimes(1);
    expect(harness.resumeHistory).toHaveBeenCalledWith(false);
    harness.controller.dispose();
  });

  it.each([0, 1])("returns keyboard focus to the canvas for background pointer button %s", button => {
    const harness = createHarness();
    harness.controller.handleStagePointerDown(pointer(harness.stage, { button }) as CanvasStagePointerEvent<HTMLElement>);
    expect(harness.adapter.focusStage).toHaveBeenCalledWith(harness.stage);
  });

  it("does not steal focus from editors or controls on pointer down", () => {
    const harness = createHarness();
    harness.adapter.isHotkeyEditingTarget = () => true;
    harness.controller.handleStagePointerDown(pointer(harness.stage) as CanvasStagePointerEvent<HTMLElement>);
    expect(harness.adapter.focusStage).not.toHaveBeenCalled();
  });

  it.each(["ctrlKey", "metaKey"])("lets %s+V deliver the actual clipboard event exactly once", modifier => {
    const paste = vi.fn(() => true);
    const menuPaste = vi.fn();
    const harness = createHarness([], [], { pasteClipboardData: paste, pasteCopiedNodes: menuPaste });
    const preventDefault = vi.fn();
    harness.adapter.emit("keydown", { key: "v", [modifier]: true, preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(menuPaste).not.toHaveBeenCalled();
    const clipboardData = {} as DataTransfer;
    harness.adapter.emit("paste", { clipboardData, preventDefault });
    expect(paste).toHaveBeenCalledTimes(1);
    expect(paste).toHaveBeenCalledWith(clipboardData);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    harness.controller.dispose();
    harness.adapter.emit("paste", { clipboardData, preventDefault });
    expect(paste).toHaveBeenCalledTimes(1);
  });

  it("routes custom paste shortcuts to the system clipboard reader", () => {
    const paste = vi.fn();
    const harness = createHarness([], [], { pasteCopiedNodes: paste, getShortcuts: () => ({ ...DEFAULT_CANVAS_SHORTCUTS, paste: ["Ctrl+P"] }) });
    const preventDefault = vi.fn();
    harness.adapter.emit("keydown", { key: "p", ctrlKey: true, preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(paste).toHaveBeenCalledTimes(1);
  });

  it.each(["editing", "dialog", "blocked", "disabled", "handled"])("ignores %s paste without changing the clipboard", reason => {
    const paste = vi.fn(() => true);
    const harness = createHarness([], [], {
      pasteClipboardData: paste,
      isInteractionBlocked: () => reason === "blocked",
      isProjectActionDisabled: () => reason === "disabled",
    });
    harness.adapter.isHotkeyEditingTarget = () => reason === "editing";
    if (reason === "dialog") vi.spyOn(harness.adapter, "closest").mockReturnValue({} as never);
    const preventDefault = vi.fn();
    harness.adapter.emit("paste", { clipboardData: {}, defaultPrevented: reason === "handled", preventDefault });
    expect(paste).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it.each(["member", "background"])("moves the complete confirmed group from its %s at any zoom", entry => {
    const nodes = [node("a"), { ...node("b", 300), y: 80, width: 220, height: 170 }, node("outside", 1400)];
    const group = createCanvasGroup(nodes, ["a", "b"], "group")!;
    const harness = createHarness(nodes, [group]);
    harness.controller.syncViewport({ zoom: 50, panX: 0, panY: 0 });
    const element = {} as HTMLElement;
    if (entry === "member") harness.controller.startDrag(pointer(element), nodes[1]);
    else harness.controller.startGroupDrag(pointer(element), group);
    expect(harness.controller.mode).toBe("group-drag");
    const move = pointer(element, { clientX: 80, clientY: 40, altKey: true });
    if (entry === "member") harness.controller.moveDrag(move);
    else harness.controller.moveGroupDrag(move);
    harness.adapter.runFrames();
    expect(harness.nodes[0]).toMatchObject({ x: 160, y: 80 });
    expect(harness.nodes[1]).toMatchObject({ x: 460, y: 160 });
    expect(harness.nodes[2]).toBe(nodes[2]);
    expect(harness.groups[0]).toMatchObject({ position: { x: group.position.x + 160, y: group.position.y + 80 }, width: group.width, height: group.height });
    if (entry === "member") harness.controller.endDrag();
    else harness.controller.endGroupDrag();
    expect(harness.controller.mode).toBe("idle");
    expect(harness.resumeHistory).toHaveBeenCalledTimes(1);
    expect(harness.resumeHistory).toHaveBeenCalledWith(true);
    expect(harness.adapter.releases).toContainEqual({ element, pointerId: 1 });
    if (entry === "member") expect(harness.controller.chooseNode("b")).toBe(false);
    expect(harness.selectedGroupId).toBe(group.id);
  });

  it("does not lock temporary selections into a group and restores independent drag after ungrouping", () => {
    const nodes = [node("a"), node("b", 300)];
    const group = createCanvasGroup(nodes, ["a", "b"], "group")!;
    for (const groups of [[{ ...group, pending: true }], []]) {
      const harness = createHarness(nodes, groups);
      const element = {} as HTMLElement;
      harness.controller.startDrag(pointer(element), nodes[0]);
      expect(harness.controller.mode).toBe("drag");
      harness.controller.moveDrag(pointer(element, { clientX: 60, clientY: 30, altKey: true }));
      harness.controller.endDrag();
      expect(harness.nodes[0]).toMatchObject({ x: 60, y: 30 });
      expect(harness.nodes[1]).toBe(nodes[1]);
    }
  });

  it("keeps collapsed batch children with a dragged group and preserves unrelated nodes on cancellation", () => {
    const root = { ...node("a"), metadata: { isBatchRoot: true, batchChildIds: ["child"] } };
    const nodes = [root, node("b", 300), node("child", 600), node("outside", 1200)];
    const group = createCanvasGroup(nodes, ["a", "b"], "group")!;
    const harness = createHarness(nodes, [group]);
    const element = {} as HTMLElement;
    harness.controller.startDrag(pointer(element), root);
    harness.controller.moveDrag(pointer(element, { clientX: 40, clientY: 30, altKey: true }));
    harness.controller.cancelActiveCanvasInteractions();
    expect(harness.nodes.map(node => node.x)).toEqual([40, 340, 640, 1200]);
    expect(harness.controller.mode).toBe("idle");
    expect(harness.resumeHistory).toHaveBeenCalledTimes(1);
    expect(harness.adapter.releases).toContainEqual({ element, pointerId: 1 });
  });

  it("keeps inputs and connection handles interactive inside confirmed groups", () => {
    const nodes = [node("a"), node("b", 300)];
    const group = createCanvasGroup(nodes, ["a", "b"], "group")!;
    const harness = createHarness(nodes, [group]);
    const input = {} as HTMLElement;
    vi.spyOn(harness.adapter, "closest").mockReturnValue(input as never);
    harness.controller.startDrag(pointer(input), nodes[0]);
    expect(harness.controller.mode).toBe("idle");
    expect(harness.adapter.captures).toEqual([]);
  });

  it("commits node drag once per frame and releases pointer capture on completion", () => {
    const harness = createHarness();
    const nodeElement = {} as HTMLElement;
    harness.controller.startDrag(pointer(nodeElement), harness.nodes[0]);
    expect(harness.controller.mode).toBe("drag");
    expect(harness.adapter.captures).toEqual([{ element: nodeElement, pointerId: 1 }]);

    harness.controller.moveDrag(pointer(nodeElement, { clientX: 20, clientY: 10 }));
    expect(harness.nodes[0]).toMatchObject({ x: 0, y: 0 });
    harness.adapter.runFrames();
    expect(harness.nodes[0]).toMatchObject({ x: 20, y: 0 });

    harness.controller.endDrag();
    expect(harness.controller.mode).toBe("idle");
    expect(harness.adapter.releases).toContainEqual({ element: nodeElement, pointerId: 1 });
    expect(harness.resumeHistory).toHaveBeenLastCalledWith(true);
    expect([...harness.adapter.timers.values()].map(timer => timer.delay)).toContain(0);
  });

  it("docks a dragged node beside a sibling and shows white alignment guides", () => {
    const harness = createHarness();
    const nodeElement = {} as HTMLElement;
    const dockX = 300 - 100 - CANVAS_NODE_DOCK_GAP;
    harness.controller.startDrag(pointer(nodeElement), harness.nodes[0]);
    harness.controller.moveDrag(pointer(nodeElement, { clientX: dockX + 4, clientY: 0 }));
    harness.adapter.runFrames();
    expect(harness.nodes[0]).toMatchObject({ x: dockX, y: 0 });
    expect(harness.controller.getSnapshot().alignmentGuides).toEqual([
      { axis: "y", position: 0, start: dockX, end: 400 },
      { axis: "y", position: 50, start: dockX, end: 400 },
      { axis: "y", position: 100, start: dockX, end: 400 },
    ]);

    harness.controller.endDrag();
    expect(harness.controller.getSnapshot().alignmentGuides).toEqual([]);
  });

  it("skips magnetic dock while Alt is held", () => {
    const harness = createHarness();
    const nodeElement = {} as HTMLElement;
    const dockX = 300 - 100 - CANVAS_NODE_DOCK_GAP;
    harness.controller.startDrag(pointer(nodeElement), harness.nodes[0]);
    harness.controller.moveDrag(pointer(nodeElement, { clientX: dockX + 4, clientY: 0, altKey: true }));
    harness.adapter.runFrames();
    expect(harness.nodes[0]).toMatchObject({ x: dockX + 4, y: 0 });
    expect(harness.controller.getSnapshot().alignmentGuides).toEqual([]);
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
    harness.controller.moveDrag(pointer(nodeElement, { clientX: 9, clientY: 20 }));
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
    expect(harness.nodes[0]).toMatchObject({ x: 9, y: 20 });
    expect(harness.adapter.frames.size).toBe(0);
    expect(harness.adapter.timers.size).toBe(0);
    expect(harness.adapter.releases).toContainEqual({ element: nodeElement, pointerId: 1 });
    expect(harness.resumeHistory).toHaveBeenLastCalledWith(true);
  });

  it("pans pinned nodes into view without changing zoom", () => {
    const harness = createHarness([node("a", 0), node("b", 400)]);
    harness.controller.syncViewport({ zoom: 50, panX: 12, panY: 8 });
    harness.controller.panNodesIntoViewport(["a", "b"]);
    expect(harness.viewport.zoom).toBe(50);
    expect(harness.viewport.panX).toBe(375);
    expect(harness.viewport.panY).toBe(349);
  });
});
