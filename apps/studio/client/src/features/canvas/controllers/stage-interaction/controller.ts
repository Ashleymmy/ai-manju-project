import {
  addCanvasConnection,
  canvasClientPointToWorld,
  defaultCanvasConnectionHandle,
  findCanvasConnectionDropTarget,
  isActiveCanvasConnectionPointer,
  isHiddenCanvasBatchChild,
  normalizeCanvasConnection,
  type CanvasConnectionDropTarget,
  type CanvasConnectionHandleType,
} from "@/features/canvas/domain/connections";
import { nearestCanvasEdgeIdAtPoint } from "@/features/canvas/domain/geometry";
import {
  resizeCanvasGroup,
  type CanvasGroupData,
  type CanvasGroupResizeCorner,
} from "@/features/canvas/domain/groups";
import {
  CANVAS_ZOOM_MIN,
  fitCanvasViewport,
  panCanvasViewport,
  zoomCanvasViewportAtPoint,
} from "@/features/canvas/domain/history";
import { eventMatchesShortcut } from "@/features/canvas/domain/hotkeys";
import { canvasMinimapWorldPoint } from "@/features/canvas/domain/minimap";
import {
  canvasNodesInSelectionRect,
  captureCanvasNodeOrigins,
  moveCanvasNodesFromOrigins,
  normalizeCanvasSelectionRect,
  shouldSuppressCanvasNodeClickAfterPointerSelection,
  toggleCanvasNodeSelection,
  type CanvasNodeOrigins,
} from "@/features/canvas/domain/selection";
import type { CanvasNodeData } from "@/features/canvas/domain/types";
import { clamp } from "@/features/canvas/domain/value";
import { createBrowserCanvasStageInteractionAdapter } from "./browser-adapter";
import type {
  CanvasConnectionDraft,
  CanvasSelectionBoxState,
  CanvasStageInteractionAdapter,
  CanvasStageInteractionBindings,
  CanvasStageInteractionMode,
  CanvasStageInteractionView,
  CanvasStageMouseEvent,
  CanvasStagePointerEvent,
  CanvasStageViewport,
  PendingConnectionCreateState,
} from "./types";

export const CANVAS_STAGE_OFFSET = 52;

const CONNECTION_NODE_HIT_PADDING = 28;
const CONNECTION_HANDLE_HIT_RADIUS = 18;
const CANVAS_EDGE_HIT_RADIUS = 22;
const CONNECTION_HANDLE_MAGNET_RADIUS = 56;
const CONNECTION_HANDLE_SNAP_RADIUS = 18;
const MIDDLE_PAN_DOUBLE_CLICK_MS = 260;

type CanvasPanMode = "idle" | "hold-pan" | "locked-pan";

type CanvasPanState = {
  mode: CanvasPanMode;
  startClientX: number;
  startClientY: number;
  lastClientX: number;
  lastClientY: number;
  startPanX: number;
  startPanY: number;
  lastMiddleDownAt: number;
};

type CanvasDragState = {
  id: string;
  startX: number;
  startY: number;
  origins: CanvasNodeOrigins;
  moved: boolean;
  suppressClick: boolean;
};

type CanvasResizeState = {
  id: string;
  startX: number;
  startY: number;
  width: number;
  height: number;
  currentWidth: number;
  currentHeight: number;
  moved: boolean;
};

type CanvasGroupDragState = {
  id: string;
  startX: number;
  startY: number;
  position: { x: number; y: number };
  origins: CanvasNodeOrigins;
  moved: boolean;
};

type CanvasGroupResizeState = {
  id: string;
  corner: CanvasGroupResizeCorner;
  startX: number;
  startY: number;
  group: CanvasGroupData;
  moved: boolean;
};

type CanvasConnectionDragState = {
  active: boolean;
  pointerId: number | null;
  startX: number;
  startY: number;
  moved: boolean;
};

type CaptureKey = "node-drag" | "node-resize" | "group-drag" | "group-resize" | "connection" | "stage";

type CapturedPointer = {
  element: Element;
  pointerId: number;
};

type PendingGraphFrame = {
  nodes?: CanvasNodeData[];
  groups?: CanvasGroupData[];
};

const emptyView: CanvasStageInteractionView = {
  stageBounds: { width: 0, height: 0 },
  connectFrom: "",
  connectHandleType: "source",
  connectionTargetId: "",
  connectionPreviewPoint: null,
  pendingConnectionCreate: null,
  selectionBox: null,
};

const emptyBindings: CanvasStageInteractionBindings = {
  isSwitching: () => true,
  isInteractionBlocked: () => true,
  isProjectActionDisabled: () => true,
  getWheelZoomRequiresCtrl: () => true,
  getShortcuts: () => ({
    undo: [], redo: [], delete: [], copy: [], paste: [], selectAll: [],
    runSelection: [], openSettings: [], resetZoom: [],
  }),
  getMinimapModel: () => ({
    width: 1,
    height: 1,
    world: { x: 0, y: 0, width: 1, height: 1 },
    nodes: [],
    viewport: { x: 0, y: 0, width: 1, height: 1 },
  }),
  getNodes: () => [],
  setNodes: () => undefined,
  getEdges: () => [],
  setEdges: () => undefined,
  getGroups: () => [],
  setGroups: () => undefined,
  getSelectedNodeIds: () => new Set(),
  getSelectedGroupId: () => "",
  setSelectedGroupId: () => undefined,
  getSelectedEdgeId: () => "",
  setSelectedEdgeId: () => undefined,
  setHoveredEdgeId: () => undefined,
  getHoveredNodeId: () => "",
  setHoveredNodeId: () => undefined,
  getSelectedNode: () => null,
  commitViewport: () => undefined,
  setInspectorOpen: () => undefined,
  setEditingInlineNodeId: () => undefined,
  applyNodeSelection: () => undefined,
  pauseHistory: () => undefined,
  resumeHistory: () => undefined,
  setContextMenu: () => undefined,
  copySelectedNodes: () => undefined,
  pasteCopiedNodes: () => undefined,
  undoCanvas: () => undefined,
  redoCanvas: () => undefined,
  runSelectedGeneration: () => undefined,
  removeNodes: () => undefined,
  removeEdge: () => undefined,
  onInfo: () => undefined,
  onWarning: () => undefined,
};

export class CanvasStageInteractionController {
  private bindings = emptyBindings;
  private view: CanvasStageInteractionView = emptyView;
  private readonly listeners = new Set<() => void>();
  private stage: Element | null = null;
  private mountCleanups: Array<() => void> = [];
  private readonly captures = new Map<CaptureKey, CapturedPointer>();
  private viewport: CanvasStageViewport = { zoom: 90, panX: 0, panY: 0 };
  private pan: CanvasPanState = {
    mode: "idle",
    startClientX: 0,
    startClientY: 0,
    lastClientX: 0,
    lastClientY: 0,
    startPanX: 0,
    startPanY: 0,
    lastMiddleDownAt: 0,
  };
  private drag: CanvasDragState | null = null;
  private resize: CanvasResizeState | null = null;
  private groupDrag: CanvasGroupDragState | null = null;
  private groupResize: CanvasGroupResizeState | null = null;
  private selectionBox: CanvasSelectionBoxState | null = null;
  private connectionDrag: CanvasConnectionDragState = {
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    moved: false,
  };
  private connectFrom = "";
  private connectHandleType: CanvasConnectionHandleType = "source";
  private connectionTargetId = "";
  private connectionPreviewPoint: { x: number; y: number } | null = null;
  private pendingConnectionCreate: PendingConnectionCreateState | null = null;
  private isSpacePressed = false;
  private suppressNodeClick = "";
  private readonly connectionHandles = new Map<string, HTMLElement>();
  private hoveredHandleKey = "";
  private pendingGraphFrame: PendingGraphFrame = {};
  private graphFrame: number | null = null;
  private viewportFrame: number | null = null;
  private selectionFrame: number | null = null;
  private connectionFrame: number | null = null;
  private inlineEditorFrame: number | null = null;
  private hoverLeaveTimer: ReturnType<typeof setTimeout> | null = null;
  private suppressClickTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly adapter: CanvasStageInteractionAdapter = createBrowserCanvasStageInteractionAdapter(),
  ) {}

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = () => this.view;

  get mode(): CanvasStageInteractionMode {
    if (this.drag) return "drag";
    if (this.resize) return "resize";
    if (this.groupDrag) return "group-drag";
    if (this.groupResize) return "group-resize";
    if (this.selectionBox) return "select";
    if (this.connectionDrag.active || this.connectFrom) return "connect";
    if (this.pan.mode !== "idle") return "pan";
    return "idle";
  }

  updateBindings(bindings: CanvasStageInteractionBindings) {
    this.bindings = bindings;
  }

  syncViewport(viewport: CanvasStageViewport) {
    this.viewport = { ...viewport };
  }

  mount(stage: Element | null) {
    this.unmount();
    this.stage = stage;
    if (!stage) return () => undefined;

    this.mountCleanups = [
      this.adapter.addWindowListener("pointermove", this.handleWindowPointerMove, { passive: true }),
      this.adapter.addWindowListener("pointerup", this.handleWindowPointerUp),
      this.adapter.addWindowListener("pointercancel", this.handleWindowPointerCancel),
      this.adapter.addWindowListener("keydown", this.handleWindowKeyDown),
      this.adapter.addWindowListener("keyup", this.handleWindowKeyUp),
      this.adapter.addWindowListener("blur", this.handleWindowBlur),
      this.adapter.addWheelListener(stage, this.handleWheel),
      this.adapter.observeStage(stage, stageBounds => this.patchView({ stageBounds })),
    ];
    return () => {
      if (this.stage === stage) this.unmount();
    };
  }

  unmount() {
    this.mountCleanups.splice(0).forEach(cleanup => cleanup());
    this.cancelActiveCanvasInteractions();
    this.flushGraphFrame();
    this.flushViewportFrame();
    this.cancelSelectionFrame();
    this.cancelConnectionFrame();
    this.cancelInlineEditorFrame();
    this.clearHoverTimer();
    this.clearSuppressClickTimer();
    this.releaseAllCaptures();
    this.resetMagnet();
    this.adapter.setPanCursor(false);
    this.stage = null;
  }

  dispose() {
    this.unmount();
    this.bindings = emptyBindings;
  }

  readonly screenToCanvasPoint = (clientX: number, clientY: number) => {
    return canvasClientPointToWorld(
      clientX,
      clientY,
      this.adapter.getRect(this.stage),
      this.viewport,
      CANVAS_STAGE_OFFSET,
    );
  };

  readonly clientToStagePoint = (clientX: number, clientY: number) => {
    const rect = this.adapter.getRect(this.stage);
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };

  readonly applyCanvasViewport = (next: CanvasStageViewport) => {
    this.cancelViewportFrame();
    this.viewport = this.normalizeViewport(next);
    this.bindings.commitViewport(this.viewport);
    this.bindings.setContextMenu(null);
  };

  readonly zoomCanvasAroundCenter = (nextZoom: number) => {
    const rect = this.adapter.getRect(this.stage);
    if (!rect) return;
    this.applyCanvasViewport(zoomCanvasViewportAtPoint(
      this.viewport,
      { x: rect.width / 2, y: Math.max(0, rect.height - CANVAS_STAGE_OFFSET) / 2 },
      nextZoom,
    ));
  };

  readonly fitCanvasToContent = () => {
    const rect = this.adapter.getRect(this.stage);
    if (!rect) return;
    const nodes = this.currentNodes();
    this.applyCanvasViewport(fitCanvasViewport(
      nodes.filter(node => !isHiddenCanvasBatchChild(node, nodes)),
      { width: rect.width, height: rect.height },
      CANVAS_STAGE_OFFSET,
    ));
  };

  readonly focusNodeInViewport = (nodeId: string) => {
    const node = this.currentNodes().find(item => item.id === nodeId);
    if (!node) return;
    const rect = this.adapter.getRect(this.stage);
    const width = rect?.width ?? this.view.stageBounds.width;
    const height = rect?.height ?? this.view.stageBounds.height;
    const currentZoom = Math.max(0.05, this.viewport.zoom / 100);
    let nextZoom = currentZoom;
    if (width > 0 && height > 0) {
      const availableWidth = Math.max(240, width - 200);
      const availableHeight = Math.max(180, height - CANVAS_STAGE_OFFSET - 140);
      const fitZoom = Math.min(
        availableWidth / Math.max(node.width, 1),
        availableHeight / Math.max(node.height, 1),
      );
      if (
        node.width * currentZoom > availableWidth * 0.8
        || node.height * currentZoom > availableHeight * 0.8
      ) {
        nextZoom = clamp(fitZoom * 0.9, 0.05, 5);
      } else if (
        node.width * currentZoom < availableWidth * 0.15
        && node.height * currentZoom < availableHeight * 0.15
      ) {
        nextZoom = clamp(Math.max(currentZoom, fitZoom * 0.75), currentZoom, 5);
      }
    }
    this.applyCanvasViewport({
      zoom: nextZoom * 100,
      panX: (width > 0 ? width / 2 : 0) - (node.x + node.width / 2) * nextZoom,
      panY: (height > 0 ? (height - CANVAS_STAGE_OFFSET) / 2 : 0)
        - (node.y + node.height / 2) * nextZoom,
    });
    this.bindings.applyNodeSelection([node.id], node.id, true);
    this.resetConnectionAndPending();
  };

  readonly navigateFromMinimap = (event: CanvasStageMouseEvent<SVGSVGElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = this.adapter.getRect(event.currentTarget);
    if (!rect) return;
    const world = canvasMinimapWorldPoint(this.bindings.getMinimapModel(), {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    const scale = Math.max(0.05, this.viewport.zoom / 100);
    this.applyCanvasViewport({
      zoom: this.viewport.zoom,
      panX: this.view.stageBounds.width / 2 - world.x * scale,
      panY: Math.max(1, this.view.stageBounds.height - CANVAS_STAGE_OFFSET) / 2 - world.y * scale,
    });
  };

  readonly getCanvasCenter = () => {
    const rect = this.adapter.getRect(this.stage);
    if (!rect) return { x: 0, y: 0 };
    return this.screenToCanvasPoint(
      rect.left + rect.width / 2,
      rect.top + CANVAS_STAGE_OFFSET + Math.max(0, rect.height - CANVAS_STAGE_OFFSET) / 2,
    );
  };

  readonly beginInlineNodeEdit = (nodeId: string) => {
    this.bindings.setEditingInlineNodeId(nodeId);
    this.cancelInlineEditorFrame();
    this.inlineEditorFrame = this.adapter.requestFrame(() => {
      this.inlineEditorFrame = null;
      this.adapter.focusInlineEditor(this.stage, nodeId);
    });
  };

  readonly handleNodeHoverStart = (id: string) => {
    this.clearHoverTimer();
    this.setHoveredNodeId(id);
  };

  readonly handleNodeHoverEnd = (id: string) => {
    this.clearHoverTimer();
    this.hoverLeaveTimer = this.adapter.setTimer(() => {
      this.hoverLeaveTimer = null;
      if (this.bindings.getHoveredNodeId() === id) this.setHoveredNodeId("");
    }, 180);
  };

  readonly registerConnectionHandle = (
    nodeId: string,
    side: "source" | "target",
    element: HTMLElement | null,
  ) => {
    const key = `${nodeId}:${side}`;
    if (element) {
      this.connectionHandles.set(key, element);
      return;
    }
    if (this.hoveredHandleKey === key) this.resetMagnet();
    this.connectionHandles.delete(key);
  };

  private setHoveredNodeId(id: string) {
    if (this.bindings.getHoveredNodeId() !== id) this.bindings.setHoveredNodeId(id);
  }

  private patchView(patch: Partial<CanvasStageInteractionView>) {
    const next = { ...this.view, ...patch };
    if ((Object.keys(patch) as Array<keyof CanvasStageInteractionView>).every(
      key => Object.is(this.view[key], next[key]),
    )) return;
    this.view = next;
    this.listeners.forEach(listener => listener());
  }

  private normalizeViewport(viewport: CanvasStageViewport): CanvasStageViewport {
    return {
      zoom: Math.round(viewport.zoom),
      panX: Math.round(viewport.panX),
      panY: Math.round(viewport.panY),
    };
  }

  private applyCanvasViewportFrame(next: CanvasStageViewport) {
    this.viewport = this.normalizeViewport(next);
    this.bindings.setContextMenu(null);
    if (this.viewportFrame !== null) return;
    this.viewportFrame = this.adapter.requestFrame(() => {
      this.viewportFrame = null;
      this.bindings.commitViewport(this.viewport);
    });
  }

  private cancelViewportFrame() {
    if (this.viewportFrame === null) return;
    this.adapter.cancelFrame(this.viewportFrame);
    this.viewportFrame = null;
  }

  private flushViewportFrame() {
    if (this.viewportFrame === null) return;
    this.cancelViewportFrame();
    this.bindings.commitViewport(this.viewport);
  }

  private cancelInlineEditorFrame() {
    if (this.inlineEditorFrame === null) return;
    this.adapter.cancelFrame(this.inlineEditorFrame);
    this.inlineEditorFrame = null;
  }

  private clearHoverTimer() {
    if (this.hoverLeaveTimer === null) return;
    this.adapter.clearTimer(this.hoverLeaveTimer);
    this.hoverLeaveTimer = null;
  }

  private clearSuppressClickTimer() {
    if (this.suppressClickTimer === null) return;
    this.adapter.clearTimer(this.suppressClickTimer);
    this.suppressClickTimer = null;
  }

  private resetMagnet() {
    const element = this.hoveredHandleKey
      ? this.connectionHandles.get(this.hoveredHandleKey)
      : undefined;
    if (element) this.adapter.setConnectionHandleMagnet(element, false);
    this.hoveredHandleKey = "";
  }

  private updateConnectionHandleMagnet(event: PointerEvent) {
    if (this.connectionDrag.active || this.pan.mode !== "idle") return;
    let nearestKey = "";
    let nearestDistance = Number.POSITIVE_INFINITY;
    let nearestDx = 0;
    let nearestDy = 0;
    this.connectionHandles.forEach((element, key) => {
      const rect = this.adapter.getRect(element);
      if (!rect) return;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const distance = Math.hypot(event.clientX - centerX, event.clientY - centerY);
      if (distance >= nearestDistance) return;
      nearestDistance = distance;
      nearestKey = key;
      nearestDx = event.clientX - centerX;
      nearestDy = event.clientY - centerY;
    });
    const next = nearestDistance <= CONNECTION_HANDLE_MAGNET_RADIUS ? nearestKey : "";
    if (next !== this.hoveredHandleKey) {
      this.resetMagnet();
      this.hoveredHandleKey = next;
      const element = next ? this.connectionHandles.get(next) : undefined;
      if (element) this.adapter.setConnectionHandleMagnet(element, true, { x: 0, y: 0, strength: 0 });
    }
    if (!next) return;
    const element = this.connectionHandles.get(next);
    if (!element) return;
    const strength = nearestDistance <= CONNECTION_HANDLE_SNAP_RADIUS
      ? 1
      : Math.max(
        0,
        1 - (nearestDistance - CONNECTION_HANDLE_SNAP_RADIUS)
          / (CONNECTION_HANDLE_MAGNET_RADIUS - CONNECTION_HANDLE_SNAP_RADIUS),
      );
    this.adapter.setConnectionHandleMagnet(element, true, {
      x: nearestDx,
      y: nearestDy,
      strength,
    });
  }

  readonly selectCanvasGroup = (group: CanvasGroupData, openInspector = true) => {
    const memberIds = group.nodeIds.filter(
      nodeId => this.currentNodes().some(node => node.id === nodeId),
    );
    this.bindings.applyNodeSelection(memberIds, memberIds[0] || "", false);
    this.bindings.setSelectedGroupId(group.id);
    this.bindings.setInspectorOpen(openInspector);
    this.bindings.setContextMenu(null);
  };

  readonly startGroupDrag = (
    event: CanvasStagePointerEvent<HTMLElement>,
    group: CanvasGroupData,
  ) => {
    if (this.bindings.isSwitching() || event.button !== 0) return;
    if (this.adapter.isHotkeyEditingTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    this.selectCanvasGroup(group, false);
    this.capturePointer("group-drag", event.currentTarget, event.pointerId);
    this.groupDrag = {
      id: group.id,
      startX: event.clientX,
      startY: event.clientY,
      position: { ...group.position },
      origins: captureCanvasNodeOrigins(this.currentNodes(), new Set(group.nodeIds)),
      moved: false,
    };
    this.bindings.pauseHistory();
  };

  readonly moveGroupDrag = (event: CanvasStagePointerEvent<HTMLElement>) => {
    const drag = this.groupDrag;
    if (!drag || this.bindings.isSwitching()) return;
    const scale = this.viewport.zoom / 100;
    const deltaX = (event.clientX - drag.startX) / scale;
    const deltaY = (event.clientY - drag.startY) / scale;
    if (!drag.moved && Math.abs(deltaX) < 2 && Math.abs(deltaY) < 2) return;
    drag.moved = Math.abs(deltaX) > 0.01 || Math.abs(deltaY) > 0.01;
    const nextGroups = this.currentGroups().map(group => group.id === drag.id ? {
      ...group,
      position: {
        x: drag.position.x + deltaX,
        y: drag.position.y + deltaY,
      },
    } : group);
    const nextNodes = moveCanvasNodesFromOrigins(
      this.currentNodes(),
      drag.origins,
      deltaX,
      deltaY,
    );
    this.scheduleGraphFrame({ groups: nextGroups, nodes: nextNodes });
  };

  readonly endGroupDrag = () => {
    const drag = this.groupDrag;
    this.groupDrag = null;
    this.releaseCapture("group-drag");
    this.flushGraphFrame();
    this.bindings.resumeHistory(Boolean(drag?.moved));
  };

  readonly startGroupResize = (
    event: CanvasStagePointerEvent<HTMLElement>,
    group: CanvasGroupData,
    corner: CanvasGroupResizeCorner,
  ) => {
    if (this.bindings.isSwitching() || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.capturePointer("group-resize", event.currentTarget, event.pointerId);
    this.selectCanvasGroup(group, false);
    this.groupResize = {
      id: group.id,
      corner,
      startX: event.clientX,
      startY: event.clientY,
      group: structuredClone(group),
      moved: false,
    };
    this.bindings.pauseHistory();
  };

  readonly moveGroupResize = (event: CanvasStagePointerEvent<HTMLElement>) => {
    const resize = this.groupResize;
    if (!resize || this.bindings.isSwitching()) return;
    event.preventDefault();
    event.stopPropagation();
    const scale = this.viewport.zoom / 100;
    const deltaX = (event.clientX - resize.startX) / scale;
    const deltaY = (event.clientY - resize.startY) / scale;
    if (!resize.moved && Math.abs(deltaX) < 2 && Math.abs(deltaY) < 2) return;
    resize.moved = Math.abs(deltaX) > 0.01 || Math.abs(deltaY) > 0.01;
    const nextGroups = this.currentGroups().map(group => group.id === resize.id
      ? resizeCanvasGroup(resize.group, resize.corner, deltaX, deltaY)
      : group);
    this.scheduleGraphFrame({ groups: nextGroups });
  };

  readonly endGroupResize = (event: CanvasStagePointerEvent<HTMLElement>) => {
    const resize = this.groupResize;
    if (!resize) return;
    event.preventDefault();
    event.stopPropagation();
    this.groupResize = null;
    this.releaseCapture("group-resize");
    this.flushGraphFrame();
    this.bindings.resumeHistory(resize.moved);
  };

  readonly startDrag = (
    event: CanvasStagePointerEvent<HTMLElement>,
    node: CanvasNodeData,
  ) => {
    if (this.bindings.isSwitching() || event.button !== 0) return;
    if (this.adapter.closest(
      event.target,
      "button, input, textarea, select, [contenteditable='true'], .node-inline-editor, .canvas-connection-handle, [data-canvas-ui]",
    )) return;
    if (this.connectFrom || this.pendingConnectionCreate) return;
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    const current = this.bindings.getSelectedNodeIds();
    const suppressClick = shouldSuppressCanvasNodeClickAfterPointerSelection(
      current,
      node.id,
      additive,
    );
    const nextSelection = additive
      ? toggleCanvasNodeSelection(current, node.id, true)
      : current.has(node.id) && current.size > 1
        ? new Set(current)
        : toggleCanvasNodeSelection(current, node.id, false);
    const primary = nextSelection.has(node.id)
      ? node.id
      : nextSelection.values().next().value || "";
    this.bindings.applyNodeSelection(
      nextSelection,
      primary,
      nextSelection.size === 1,
    );
    if (!nextSelection.has(node.id)) {
      if (suppressClick) this.suppressNodeClick = node.id;
      return;
    }
    this.capturePointer("node-drag", event.currentTarget, event.pointerId);
    const dragIds = new Set(nextSelection);
    this.currentNodes().forEach(item => {
      if (!item.metadata?.isBatchRoot || !dragIds.has(item.id)) return;
      (item.metadata.batchChildIds || []).forEach(childId => {
        if (typeof childId === "string") dragIds.add(childId);
      });
    });
    this.drag = {
      id: node.id,
      startX: event.clientX,
      startY: event.clientY,
      origins: captureCanvasNodeOrigins(this.currentNodes(), dragIds),
      moved: false,
      suppressClick,
    };
    this.bindings.pauseHistory();
  };

  readonly moveDrag = (event: CanvasStagePointerEvent<HTMLElement>) => {
    const drag = this.drag;
    if (!drag || this.bindings.isSwitching()) return;
    const scale = this.viewport.zoom / 100;
    const deltaX = (event.clientX - drag.startX) / scale;
    const deltaY = (event.clientY - drag.startY) / scale;
    if (!drag.moved && Math.abs(deltaX) < 2 && Math.abs(deltaY) < 2) return;
    drag.moved = Math.abs(deltaX) > 0.01 || Math.abs(deltaY) > 0.01;
    this.scheduleGraphFrame({
      nodes: moveCanvasNodesFromOrigins(
        this.currentNodes(),
        drag.origins,
        deltaX,
        deltaY,
      ),
    });
  };

  readonly endDrag = () => {
    const drag = this.drag;
    if (drag?.moved || drag?.suppressClick) {
      this.suppressNodeClick = drag.id;
      this.clearSuppressClickTimer();
      this.suppressClickTimer = this.adapter.setTimer(() => {
        this.suppressClickTimer = null;
        if (this.suppressNodeClick === drag.id) this.suppressNodeClick = "";
      }, 0);
    }
    this.drag = null;
    this.releaseCapture("node-drag");
    this.flushGraphFrame();
    this.bindings.resumeHistory(Boolean(drag?.moved));
  };

  readonly startResize = (
    event: CanvasStagePointerEvent<HTMLButtonElement>,
    node: CanvasNodeData,
  ) => {
    if (this.bindings.isSwitching()) return;
    event.stopPropagation();
    event.preventDefault();
    this.capturePointer("node-resize", event.currentTarget, event.pointerId);
    this.resize = {
      id: node.id,
      startX: event.clientX,
      startY: event.clientY,
      width: node.width,
      height: node.height,
      currentWidth: node.width,
      currentHeight: node.height,
      moved: false,
    };
    this.bindings.pauseHistory();
  };

  readonly moveResize = (event: CanvasStagePointerEvent<HTMLButtonElement>) => {
    const resize = this.resize;
    if (!resize || this.bindings.isSwitching()) return;
    const scale = this.viewport.zoom / 100;
    const width = Math.round(clamp(
      resize.width + (event.clientX - resize.startX) / scale,
      220,
      960,
    ));
    const height = Math.round(clamp(
      resize.height + (event.clientY - resize.startY) / scale,
      120,
      720,
    ));
    if (width === resize.currentWidth && height === resize.currentHeight) return;
    resize.currentWidth = width;
    resize.currentHeight = height;
    resize.moved = width !== resize.width || height !== resize.height;
    this.scheduleGraphFrame({
      nodes: this.currentNodes().map(node => node.id === resize.id
        ? { ...node, width, height }
        : node),
    });
  };

  readonly endResize = () => {
    const resize = this.resize;
    this.resize = null;
    this.releaseCapture("node-resize");
    this.flushGraphFrame();
    this.bindings.resumeHistory(Boolean(resize?.moved));
  };

  private currentNodes() {
    return this.pendingGraphFrame.nodes || this.bindings.getNodes();
  }

  private currentGroups() {
    return this.pendingGraphFrame.groups || this.bindings.getGroups();
  }

  private scheduleGraphFrame(patch: PendingGraphFrame) {
    this.pendingGraphFrame = { ...this.pendingGraphFrame, ...patch };
    if (this.graphFrame !== null) return;
    this.graphFrame = this.adapter.requestFrame(() => {
      this.graphFrame = null;
      this.commitPendingGraphFrame();
    });
  }

  private flushGraphFrame() {
    if (this.graphFrame !== null) {
      this.adapter.cancelFrame(this.graphFrame);
      this.graphFrame = null;
    }
    this.commitPendingGraphFrame();
  }

  private commitPendingGraphFrame() {
    const pending = this.pendingGraphFrame;
    this.pendingGraphFrame = {};
    if (pending.nodes) this.bindings.setNodes(pending.nodes);
    if (pending.groups) this.bindings.setGroups(pending.groups);
  }

  private capturePointer(key: CaptureKey, element: Element, pointerId: number) {
    this.releaseCapture(key);
    this.captures.set(key, { element, pointerId });
    this.adapter.capturePointer(element, pointerId);
  }

  private releaseCapture(key: CaptureKey, pointerId?: number) {
    const capture = this.captures.get(key);
    if (!capture || (pointerId !== undefined && capture.pointerId !== pointerId)) return;
    this.captures.delete(key);
    this.adapter.releasePointer(capture.element, capture.pointerId);
  }

  private releaseAllCaptures() {
    [...this.captures.keys()].forEach(key => this.releaseCapture(key));
  }

  readonly activateConnectionMode = (
    nodeId: string,
    handleType?: CanvasConnectionHandleType,
  ) => {
    const node = this.currentNodes().find(item => item.id === nodeId);
    this.connectFrom = nodeId;
    this.connectHandleType = handleType || defaultCanvasConnectionHandle(node);
    this.connectionTargetId = "";
    this.connectionPreviewPoint = null;
    this.pendingConnectionCreate = null;
    this.publishConnectionState();
    this.bindings.setContextMenu(null);
    this.bindings.onInfo("已选择连接起点，请点击目标节点完成连线；按 Esc 可取消");
  };

  readonly beginConnection = (
    event: CanvasStagePointerEvent<HTMLElement>,
    nodeId: string,
    handleType: CanvasConnectionHandleType,
  ) => {
    if (this.bindings.isSwitching() || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.capturePointer("connection", event.currentTarget, event.pointerId);
    const previewPoint = this.screenToCanvasPoint(event.clientX, event.clientY);
    this.connectionDrag = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    this.connectFrom = nodeId;
    this.connectHandleType = handleType;
    this.connectionPreviewPoint = previewPoint;
    this.connectionTargetId = "";
    this.pendingConnectionCreate = null;
    this.publishConnectionState();
    this.bindings.setContextMenu(null);
  };

  readonly chooseNode = (
    id: string,
    event?: CanvasStageMouseEvent<HTMLElement>,
  ): boolean => {
    this.adapter.blurActiveInlineEditorExcept(id);
    if (this.suppressNodeClick === id) {
      this.suppressNodeClick = "";
      this.bindings.setContextMenu(null);
      return false;
    }
    if (this.connectFrom && this.connectFrom !== id) {
      this.connectNodes(this.connectFrom, id, this.connectHandleType);
      return false;
    }
    if (this.connectFrom === id) {
      this.resetConnectionAndPending();
      return false;
    }
    const additive = Boolean(event && (event.shiftKey || event.ctrlKey || event.metaKey));
    if (additive) {
      const nextSelection = toggleCanvasNodeSelection(
        this.bindings.getSelectedNodeIds(),
        id,
        true,
      );
      const primary = nextSelection.has(id)
        ? id
        : nextSelection.values().next().value || "";
      this.bindings.applyNodeSelection(
        nextSelection,
        primary,
        nextSelection.size === 1,
      );
    } else {
      this.bindings.applyNodeSelection([id], id, true);
    }
    this.bindings.setContextMenu(null);
    return true;
  };

  readonly clearConnectionDraft = () => {
    this.releaseCapture("connection");
    this.connectionDrag = {
      active: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      moved: false,
    };
    this.connectFrom = "";
    this.connectHandleType = "source";
    this.connectionTargetId = "";
    this.connectionPreviewPoint = null;
    this.publishConnectionState(false);
  };

  readonly cancelPendingConnectionCreate = () => {
    this.clearConnectionDraft();
    this.pendingConnectionCreate = null;
    this.publishConnectionState();
  };

  readonly resetConnectionAndPending = () => {
    this.clearConnectionDraft();
    this.pendingConnectionCreate = null;
    this.publishConnectionState();
  };

  readonly prepareProjectReset = () => {
    this.flushGraphFrame();
    this.flushViewportFrame();
    this.drag = null;
    this.resize = null;
    this.groupDrag = null;
    this.groupResize = null;
    this.connectionDrag.active = false;
    this.connectionDrag.pointerId = null;
    this.releaseAllCaptures();
    this.pan.mode = "idle";
    this.adapter.setPanCursor(false);
  };

  readonly resetAfterNodesRemoved = (removedIds: ReadonlySet<string>) => {
    this.resetConnectionAndPending();
    this.clearSelectionBox();
    if (removedIds.has(this.bindings.getHoveredNodeId())) {
      this.bindings.setHoveredNodeId("");
    }
    this.bindings.setHoveredEdgeId("");
    this.bindings.setContextMenu(null);
  };

  readonly connectNodes = (
    fromId: string,
    toId: string,
    handleType: CanvasConnectionHandleType = "source",
  ) => {
    const nodes = this.currentNodes();
    const normalized = normalizeCanvasConnection(fromId, toId, nodes, handleType);
    if (!normalized) {
      this.bindings.onWarning("该连接不符合节点规则");
      this.resetConnectionAndPending();
      return false;
    }
    const nextEdges = addCanvasConnection(
      this.bindings.getEdges(),
      normalized,
      this.adapter.createId,
    );
    this.bindings.setEdges(nextEdges);
    this.resetConnectionAndPending();
    this.bindings.setContextMenu(null);
    return true;
  };

  private getConnectionDropTarget(
    clientX: number,
    clientY: number,
    current: CanvasConnectionDraft,
  ): CanvasConnectionDropTarget {
    return findCanvasConnectionDropTarget(
      this.currentNodes(),
      current,
      this.screenToCanvasPoint(clientX, clientY),
      {
        padding: CONNECTION_NODE_HIT_PADDING,
        handleRadius: CONNECTION_HANDLE_HIT_RADIUS,
        zoom: this.viewport.zoom,
      },
    );
  }

  private getConnectionDomDropTargetId(
    clientX: number,
    clientY: number,
    current: CanvasConnectionDraft,
  ) {
    const target = this.adapter.elementFromPoint(clientX, clientY);
    const nodeElement = this.adapter.closest(target, ".real-canvas-node");
    const nodeId = this.adapter.getAttribute(nodeElement, "data-node-id");
    if (!nodeId || nodeId === current.nodeId) return "";
    const nodes = this.currentNodes();
    const node = nodes.find(item => item.id === nodeId);
    if (!node || isHiddenCanvasBatchChild(node, nodes)) return "";
    return normalizeCanvasConnection(
      current.nodeId,
      nodeId,
      nodes,
      current.handleType,
    ) ? nodeId : "";
  }

  private finishConnectionDrag(event: Pick<PointerEvent, "clientX" | "clientY">) {
    if (this.bindings.isSwitching()) {
      this.clearConnectionDraft();
      return;
    }
    if (!this.connectionDrag.active) return;
    const current = this.connectFrom;
    if (!current) {
      this.clearConnectionDraft();
      return;
    }
    const handleType = this.connectHandleType;
    const dropTarget = this.getConnectionDropTarget(
      event.clientX,
      event.clientY,
      { nodeId: current, handleType },
    );
    const targetNodeId = dropTarget.nodeId || this.getConnectionDomDropTargetId(
      event.clientX,
      event.clientY,
      { nodeId: current, handleType },
    );
    if (targetNodeId) {
      this.connectNodes(current, targetNodeId, handleType);
      this.clearConnectionDraft();
      return;
    }
    if (!this.connectionDrag.moved) {
      this.releaseCapture("connection");
      this.connectionDrag.active = false;
      this.connectionDrag.pointerId = null;
      this.connectionTargetId = "";
      this.connectionPreviewPoint = null;
      this.pendingConnectionCreate = null;
      this.publishConnectionState();
      this.bindings.onInfo("已选择连接起点，请点击目标节点完成连线；按 Esc 可取消");
      return;
    }
    if (!dropTarget.isNearNode) {
      const point = this.screenToCanvasPoint(event.clientX, event.clientY);
      const stagePoint = this.clientToStagePoint(event.clientX, event.clientY);
      this.pendingConnectionCreate = {
        x: stagePoint.x,
        y: stagePoint.y,
        canvasX: point.x,
        canvasY: point.y,
        connection: { nodeId: current, handleType },
      };
    }
    this.clearConnectionDraft();
    this.publishConnectionState();
  }

  private publishConnectionState(includePending = true) {
    this.cancelConnectionFrame();
    this.patchView({
      connectFrom: this.connectFrom,
      connectHandleType: this.connectHandleType,
      connectionTargetId: this.connectionTargetId,
      connectionPreviewPoint: this.connectionPreviewPoint,
      ...(includePending ? { pendingConnectionCreate: this.pendingConnectionCreate } : {}),
    });
  }

  private scheduleConnectionFrame() {
    if (this.connectionFrame !== null) return;
    this.connectionFrame = this.adapter.requestFrame(() => {
      this.connectionFrame = null;
      this.patchView({
        connectionTargetId: this.connectionTargetId,
        connectionPreviewPoint: this.connectionPreviewPoint,
      });
    });
  }

  private cancelConnectionFrame() {
    if (this.connectionFrame === null) return;
    this.adapter.cancelFrame(this.connectionFrame);
    this.connectionFrame = null;
  }

  private clearSelectionBox() {
    this.cancelSelectionFrame();
    this.selectionBox = null;
    this.patchView({ selectionBox: null });
    this.releaseCapture("stage");
  }

  private finishSelectionBox() {
    const current = this.selectionBox;
    if (!current) return false;
    const rect = normalizeCanvasSelectionRect(current.start, current.current);
    const nodes = this.currentNodes();
    const hitIds = canvasNodesInSelectionRect(
      nodes.filter(node => !isHiddenCanvasBatchChild(node, nodes)),
      rect,
    );
    const next = current.additive ? new Set(current.baseIds) : new Set<string>();
    hitIds.forEach(id => next.add(id));
    this.bindings.applyNodeSelection(
      next,
      hitIds.at(-1) || next.values().next().value || "",
      false,
    );
    this.clearSelectionBox();
    this.bindings.setContextMenu(null);
    this.pendingConnectionCreate = null;
    this.clearConnectionDraft();
    this.publishConnectionState();
    return true;
  }

  private startSelectionBox(event: CanvasStagePointerEvent<Element>) {
    if (
      this.bindings.isInteractionBlocked()
      || event.button !== 0
      || this.isSpacePressed
    ) return false;
    if (
      this.adapter.isHotkeyEditingTarget(event.target)
      || this.adapter.closest(
        event.target,
        ".real-canvas-node, .real-canvas-edge-hit, .canvas-context-menu, .canvas-connection-create-menu",
      )
    ) return false;
    event.preventDefault();
    this.capturePointer("stage", event.currentTarget, event.pointerId);
    const point = this.screenToCanvasPoint(event.clientX, event.clientY);
    this.selectionBox = {
      start: point,
      current: point,
      additive: event.shiftKey,
      baseIds: new Set(this.bindings.getSelectedNodeIds()),
    };
    this.patchView({ selectionBox: this.selectionBox });
    return true;
  }

  private scheduleSelectionFrame() {
    if (this.selectionFrame !== null) return;
    this.selectionFrame = this.adapter.requestFrame(() => {
      this.selectionFrame = null;
      if (this.selectionBox) this.patchView({ selectionBox: { ...this.selectionBox } });
    });
  }

  private cancelSelectionFrame() {
    if (this.selectionFrame === null) return;
    this.adapter.cancelFrame(this.selectionFrame);
    this.selectionFrame = null;
  }

  private startPan(event: CanvasStagePointerEvent<Element>) {
    if (this.bindings.isInteractionBlocked()) return false;
    if (
      this.adapter.isHotkeyEditingTarget(event.target)
      || this.adapter.closest(
        event.target,
        ".real-canvas-node, .canvas-context-menu, .canvas-connection-create-menu",
      )
    ) return false;
    const shouldPan = event.button === 1 || (event.button === 0 && this.isSpacePressed);
    if (!shouldPan) return false;
    event.preventDefault();
    this.capturePointer("stage", event.currentTarget, event.pointerId);
    if (event.button === 1 && this.pan.mode === "locked-pan") {
      this.stopPanInteraction();
      return true;
    }
    const now = this.adapter.now();
    const shouldLock = event.button === 1
      && now - this.pan.lastMiddleDownAt <= MIDDLE_PAN_DOUBLE_CLICK_MS;
    this.pan.lastMiddleDownAt = event.button === 1
      ? now
      : this.pan.lastMiddleDownAt;
    this.pan.mode = shouldLock ? "locked-pan" : "hold-pan";
    this.pan.startClientX = event.clientX;
    this.pan.startClientY = event.clientY;
    this.pan.lastClientX = event.clientX;
    this.pan.lastClientY = event.clientY;
    this.pan.startPanX = this.viewport.panX;
    this.pan.startPanY = this.viewport.panY;
    this.adapter.setPanCursor(true);
    return true;
  }

  private movePanGrid(event: Pick<PointerEvent, "clientX" | "clientY">) {
    if (this.bindings.isSwitching() || this.pan.mode === "idle") return;
    if (this.pan.mode === "locked-pan") {
      const deltaX = event.clientX - this.pan.lastClientX;
      const deltaY = event.clientY - this.pan.lastClientY;
      this.pan.lastClientX = event.clientX;
      this.pan.lastClientY = event.clientY;
      this.applyCanvasViewportFrame({
        ...this.viewport,
        panX: this.viewport.panX + deltaX,
        panY: this.viewport.panY + deltaY,
      });
      return;
    }
    this.applyCanvasViewportFrame({
      ...this.viewport,
      panX: this.pan.startPanX + event.clientX - this.pan.startClientX,
      panY: this.pan.startPanY + event.clientY - this.pan.startClientY,
    });
  }

  private endPanGrid(pointerId?: number) {
    this.releaseCapture("stage", pointerId);
    if (this.pan.mode === "hold-pan") this.stopPanInteraction();
  }

  private stopPanInteraction() {
    this.pan.mode = "idle";
    this.releaseCapture("stage");
    this.adapter.setPanCursor(false);
  }

  readonly handleStagePointerDown = (event: CanvasStagePointerEvent<HTMLElement>) => {
    if (this.pendingConnectionCreate) this.cancelPendingConnectionCreate();
    if (this.startPan(event)) return;
    this.startSelectionBox(event);
  };

  readonly openCanvasContextMenu = (event: CanvasStageMouseEvent<Element>) => {
    event.preventDefault();
    if (this.bindings.isSwitching() || this.adapter.isHotkeyEditingTarget(event.target)) return;
    this.clearConnectionDraft();
    this.pendingConnectionCreate = null;
    this.publishConnectionState();
    const nodeElement = this.adapter.closest(event.target, ".real-canvas-node");
    const edgeElement = this.adapter.closest(event.target, ".real-canvas-edge-hit");
    const point = this.clientToStagePoint(event.clientX, event.clientY);
    const canvasPoint = this.screenToCanvasPoint(event.clientX, event.clientY);
    this.bindings.setContextMenu({
      x: point.x,
      y: point.y,
      canvasX: canvasPoint.x,
      canvasY: canvasPoint.y,
      nodeId: this.adapter.getAttribute(nodeElement, "data-node-id") || undefined,
      edgeId: this.adapter.getAttribute(edgeElement, "data-edge-id") || undefined,
    });
    if (!nodeElement) this.bindings.applyNodeSelection([]);
  };

  readonly handleCanvasDoubleClick = (event: CanvasStageMouseEvent<Element>) => {
    if (this.bindings.isSwitching()) return;
    if (
      this.adapter.isHotkeyEditingTarget(event.target)
      || this.adapter.closest(
        event.target,
        ".canvas-node-handle, .canvas-node-label, .real-canvas-edge-hit",
      )
      || this.adapter.closest(event.target, ".real-canvas-node")
    ) return;
    this.resetConnectionAndPending();
    this.bindings.applyNodeSelection([]);
    const point = this.clientToStagePoint(event.clientX, event.clientY);
    const canvasPoint = this.screenToCanvasPoint(event.clientX, event.clientY);
    this.bindings.setContextMenu({
      x: point.x,
      y: point.y,
      canvasX: canvasPoint.x,
      canvasY: canvasPoint.y,
    });
  };

  readonly openNodeContextMenu = (
    event: CanvasStageMouseEvent<HTMLElement>,
    nodeId: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const point = this.clientToStagePoint(event.clientX, event.clientY);
    const canvasPoint = this.screenToCanvasPoint(event.clientX, event.clientY);
    const selected = this.bindings.getSelectedNodeIds();
    this.bindings.applyNodeSelection(
      selected.has(nodeId) ? selected : [nodeId],
      nodeId,
      selected.has(nodeId) ? selected.size === 1 : true,
    );
    this.bindings.setContextMenu({
      x: point.x,
      y: point.y,
      canvasX: canvasPoint.x,
      canvasY: canvasPoint.y,
      nodeId,
    });
  };

  readonly handleEdgeClick = (edgeId: string) => {
    this.bindings.applyNodeSelection([]);
    this.bindings.setSelectedEdgeId(edgeId);
    this.bindings.setContextMenu(null);
  };

  readonly handleCanvasLinesPointerDown = (
    event: CanvasStagePointerEvent<SVGSVGElement>,
  ) => {
    if (event.button !== 0) return;
    if (this.selectEdgeFromCanvasEvent(event)) return;
    if (this.startPan(event)) return;
    this.startSelectionBox(event);
  };

  readonly handleCanvasLinesClick = (event: CanvasStageMouseEvent<SVGSVGElement>) => {
    this.selectEdgeFromCanvasEvent(event);
  };

  readonly handleCanvasLinesPointerMove = (
    event: CanvasStagePointerEvent<SVGSVGElement>,
  ) => {
    if (this.bindings.isProjectActionDisabled()) return;
    const edgeId = this.edgeIdAtClientPoint(event.clientX, event.clientY);
    this.bindings.setHoveredEdgeId(edgeId);
  };

  readonly handleCanvasLinesPointerLeave = () => {
    this.bindings.setHoveredEdgeId("");
  };

  readonly handleCanvasLinesDoubleClick = (
    event: CanvasStageMouseEvent<SVGSVGElement>,
  ) => {
    const edgeId = this.selectEdgeFromCanvasEvent(event);
    if (edgeId) this.bindings.removeEdge(edgeId);
    else if (!this.bindings.isProjectActionDisabled()) this.handleCanvasDoubleClick(event);
  };

  readonly handleCanvasLinesContextMenu = (
    event: CanvasStageMouseEvent<SVGSVGElement>,
  ) => {
    if (this.bindings.isProjectActionDisabled()) {
      event.preventDefault();
      return;
    }
    const edgeId = this.edgeIdFromCanvasEvent(event);
    if (!edgeId) {
      this.openCanvasContextMenu(event);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const point = this.clientToStagePoint(event.clientX, event.clientY);
    const canvasPoint = this.screenToCanvasPoint(event.clientX, event.clientY);
    this.handleEdgeClick(edgeId);
    this.bindings.setContextMenu({
      x: point.x,
      y: point.y,
      canvasX: canvasPoint.x,
      canvasY: canvasPoint.y,
      edgeId,
    });
  };

  readonly cancelActiveCanvasInteractions = () => {
    const drag = this.drag;
    const resize = this.resize;
    const groupDrag = this.groupDrag;
    const groupResize = this.groupResize;
    this.drag = null;
    this.resize = null;
    this.groupDrag = null;
    this.groupResize = null;
    this.flushGraphFrame();
    this.releaseAllCaptures();
    this.resetConnectionAndPending();
    this.clearSelectionBox();
    this.stopPanInteraction();
    this.isSpacePressed = false;
    if (drag || resize || groupDrag || groupResize) {
      this.bindings.resumeHistory(Boolean(
        drag?.moved || resize?.moved || groupDrag?.moved || groupResize?.moved,
      ));
    }
  };

  private edgeIdAtClientPoint(clientX: number, clientY: number) {
    const scale = Math.max(CANVAS_ZOOM_MIN / 100, this.viewport.zoom / 100);
    return nearestCanvasEdgeIdAtPoint(
      this.screenToCanvasPoint(clientX, clientY),
      this.bindings.getEdges(),
      this.currentNodes(),
      CANVAS_EDGE_HIT_RADIUS / scale,
    );
  }

  private edgeIdFromCanvasEvent(event: {
    clientX: number;
    clientY: number;
    target: EventTarget | null;
  }) {
    const direct = this.adapter.getAttribute(
      this.adapter.closest(event.target, ".real-canvas-edge-hit"),
      "data-edge-id",
    );
    return direct || this.edgeIdAtClientPoint(event.clientX, event.clientY);
  }

  private selectEdgeFromCanvasEvent(event: {
    clientX: number;
    clientY: number;
    target: EventTarget | null;
    preventDefault(): void;
    stopPropagation(): void;
  }) {
    if (this.bindings.isProjectActionDisabled()) return "";
    const edgeId = this.edgeIdFromCanvasEvent(event);
    if (!edgeId) return "";
    event.preventDefault();
    event.stopPropagation();
    this.handleEdgeClick(edgeId);
    return edgeId;
  }

  private readonly handleWindowPointerMove = (rawEvent: Event) => {
    const event = rawEvent as PointerEvent;
    this.updateConnectionHandleMagnet(event);
    if (this.bindings.isSwitching()) return;
    if (this.selectionBox) {
      this.selectionBox = {
        ...this.selectionBox,
        current: this.screenToCanvasPoint(event.clientX, event.clientY),
      };
      this.scheduleSelectionFrame();
      return;
    }
    if (this.connectionDrag.active && this.connectFrom) {
      if (!isActiveCanvasConnectionPointer(
        true,
        this.connectionDrag.pointerId,
        event.pointerId,
      )) return;
      if (
        !this.connectionDrag.moved
        && Math.hypot(
          event.clientX - this.connectionDrag.startX,
          event.clientY - this.connectionDrag.startY,
        ) >= 4
      ) {
        this.connectionDrag.moved = true;
      }
      const previewPoint = this.screenToCanvasPoint(event.clientX, event.clientY);
      const dropTarget = this.getConnectionDropTarget(
        event.clientX,
        event.clientY,
        { nodeId: this.connectFrom, handleType: this.connectHandleType },
      );
      this.connectionPreviewPoint = previewPoint;
      this.connectionTargetId = dropTarget.nodeId;
      this.scheduleConnectionFrame();
      return;
    }
    this.movePanGrid(event);
  };

  private readonly handleWindowPointerUp = (rawEvent: Event) => {
    const event = rawEvent as PointerEvent;
    if (this.bindings.isSwitching()) return;
    if (this.finishSelectionBox()) return;
    if (this.connectionDrag.active) {
      if (!isActiveCanvasConnectionPointer(
        true,
        this.connectionDrag.pointerId,
        event.pointerId,
      )) return;
      this.finishConnectionDrag(event);
      return;
    }
    this.endPanGrid(event.pointerId);
  };

  private readonly handleWindowPointerCancel = (rawEvent: Event) => {
    const event = rawEvent as PointerEvent;
    if (
      this.connectionDrag.active
      && !isActiveCanvasConnectionPointer(
        true,
        this.connectionDrag.pointerId,
        event.pointerId,
      )
    ) return;
    this.clearConnectionDraft();
    this.pendingConnectionCreate = null;
    this.publishConnectionState();
    this.clearSelectionBox();
    this.stopPanInteraction();
  };

  private readonly handleWindowBlur = () => {
    this.isSpacePressed = false;
    this.stopPanInteraction();
    const drag = this.drag;
    const resize = this.resize;
    const groupDrag = this.groupDrag;
    const groupResize = this.groupResize;
    this.drag = null;
    this.resize = null;
    this.groupDrag = null;
    this.groupResize = null;
    this.flushGraphFrame();
    this.releaseCapture("node-drag");
    this.releaseCapture("node-resize");
    this.releaseCapture("group-drag");
    this.releaseCapture("group-resize");
    if (drag || resize) this.bindings.resumeHistory(Boolean(drag?.moved || resize?.moved));
    if (groupDrag) this.bindings.resumeHistory(Boolean(groupDrag.moved));
    if (groupResize) this.bindings.resumeHistory(Boolean(groupResize.moved));
    this.clearConnectionDraft();
    this.pendingConnectionCreate = null;
    this.publishConnectionState();
    this.clearSelectionBox();
    this.stopPanInteraction();
  };

  private readonly handleWheel = (event: WheelEvent) => {
    if (this.bindings.isInteractionBlocked()) {
      event.preventDefault();
      return;
    }
    if (
      this.adapter.isHotkeyEditingTarget(event.target)
      || this.adapter.isInlineNodeEditor(event.target)
    ) {
      if (event.ctrlKey || event.metaKey) event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (this.adapter.closest(event.target, "[data-canvas-ui]")) return;
    event.preventDefault();
    if (
      !this.bindings.getWheelZoomRequiresCtrl()
      || event.ctrlKey
      || event.metaKey
    ) {
      const rect = this.adapter.getRect(this.stage);
      if (!rect) return;
      const factor = Math.pow(1.1, -event.deltaY / 100);
      this.applyCanvasViewportFrame(zoomCanvasViewportAtPoint(
        this.viewport,
        {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top - CANVAS_STAGE_OFFSET,
        },
        this.viewport.zoom * factor,
      ));
      return;
    }
    this.applyCanvasViewportFrame(panCanvasViewport(
      this.viewport,
      event.deltaX,
      event.deltaY,
    ));
  };

  private readonly handleWindowKeyDown = (rawEvent: Event) => {
    const event = rawEvent as KeyboardEvent;
    if (this.adapter.isHotkeyEditingTarget(event.target)) return;
    if (this.bindings.isInteractionBlocked()) return;
    if (event.code === "Space") {
      this.isSpacePressed = true;
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      this.resetConnectionAndPending();
      this.stopPanInteraction();
      this.bindings.setContextMenu(null);
      this.bindings.setInspectorOpen(false);
      this.bindings.applyNodeSelection([]);
      return;
    }
    if (
      event.code === "Backquote"
      && !event.ctrlKey
      && !event.metaKey
      && !event.altKey
    ) {
      const nodes = this.currentNodes();
      const hovered = nodes.find(
        item => item.id === this.bindings.getHoveredNodeId()
          && !isHiddenCanvasBatchChild(item, nodes),
      ) || (() => {
        const selected = this.bindings.getSelectedNode();
        return selected && !isHiddenCanvasBatchChild(selected, nodes) ? selected : null;
      })() || nodes.find(item => !isHiddenCanvasBatchChild(item, nodes));
      if (hovered) {
        event.preventDefault();
        this.focusNodeInViewport(hovered.id);
      }
      return;
    }
    const shortcuts = this.bindings.getShortcuts();
    if (eventMatchesShortcut(event, shortcuts.copy)) {
      event.preventDefault();
      this.bindings.copySelectedNodes();
      return;
    }
    if (eventMatchesShortcut(event, shortcuts.paste)) {
      event.preventDefault();
      this.bindings.pasteCopiedNodes();
      return;
    }
    if (eventMatchesShortcut(event, shortcuts.redo)) {
      event.preventDefault();
      this.bindings.redoCanvas();
      return;
    }
    if (eventMatchesShortcut(event, shortcuts.undo)) {
      event.preventDefault();
      this.bindings.undoCanvas();
      return;
    }
    if (eventMatchesShortcut(event, shortcuts.runSelection)) {
      event.preventDefault();
      this.bindings.runSelectedGeneration();
      return;
    }
    if (eventMatchesShortcut(event, shortcuts.selectAll)) {
      event.preventDefault();
      const nodes = this.currentNodes();
      const allIds = nodes
        .filter(item => !isHiddenCanvasBatchChild(item, nodes))
        .map(item => item.id);
      if (allIds.length) this.bindings.applyNodeSelection(allIds);
      return;
    }
    if (eventMatchesShortcut(event, shortcuts.openSettings)) {
      event.preventDefault();
      this.bindings.setInspectorOpen(true);
      return;
    }
    if (eventMatchesShortcut(event, shortcuts.resetZoom)) {
      event.preventDefault();
      this.viewport = { ...this.viewport, zoom: 90 };
      this.bindings.commitViewport(this.viewport);
      return;
    }
    const matchesDelete = eventMatchesShortcut(event, shortcuts.delete);
    const selectedGroupId = this.bindings.getSelectedGroupId();
    if (matchesDelete && selectedGroupId) {
      event.preventDefault();
      this.bindings.setGroups(
        this.currentGroups().filter(group => group.id !== selectedGroupId),
      );
      this.bindings.setSelectedGroupId("");
      this.bindings.setInspectorOpen(false);
      return;
    }
    const selectedNodeIds = this.bindings.getSelectedNodeIds();
    if (matchesDelete && selectedNodeIds.size) {
      event.preventDefault();
      this.bindings.removeNodes(selectedNodeIds);
      return;
    }
    const selectedEdgeId = this.bindings.getSelectedEdgeId();
    if (matchesDelete && selectedEdgeId) {
      event.preventDefault();
      this.bindings.removeEdge(selectedEdgeId);
    }
  };

  private readonly handleWindowKeyUp = (rawEvent: Event) => {
    const event = rawEvent as KeyboardEvent;
    if (event.code === "Space") this.isSpacePressed = false;
  };
}
