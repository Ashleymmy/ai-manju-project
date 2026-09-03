import type { CanvasGroupData } from "@/features/canvas/domain/groups";
import type { CanvasMinimapModel } from "@/features/canvas/domain/minimap";
import type { CanvasPoint } from "@/features/canvas/domain/selection";
import type { CanvasConnectionHandleType } from "@/features/canvas/domain/connections";
import type { CanvasShortcutBindings } from "@/features/canvas/domain/hotkeys";
import type {
  CanvasEdgeData,
  CanvasNodeData,
} from "@/features/canvas/domain/types";

export type CanvasStageBounds = {
  width: number;
  height: number;
};

export type CanvasStageViewport = {
  zoom: number;
  panX: number;
  panY: number;
};

export type CanvasContextMenuState = {
  x: number;
  y: number;
  canvasX: number;
  canvasY: number;
  nodeId?: string;
  edgeId?: string;
};

export type CanvasSelectionBoxState = {
  start: CanvasPoint;
  current: CanvasPoint;
  additive: boolean;
  baseIds: Set<string>;
};

export type CanvasConnectionDraft = {
  nodeId: string;
  handleType: CanvasConnectionHandleType;
};

export type PendingConnectionCreateState = {
  x: number;
  y: number;
  canvasX: number;
  canvasY: number;
  connection: CanvasConnectionDraft;
};

export type CanvasStageInteractionView = {
  stageBounds: CanvasStageBounds;
  connectFrom: string;
  connectHandleType: CanvasConnectionHandleType;
  connectionTargetId: string;
  connectionPreviewPoint: CanvasPoint | null;
  pendingConnectionCreate: PendingConnectionCreateState | null;
  selectionBox: CanvasSelectionBoxState | null;
};

export type CanvasStageInteractionMode =
  | "idle"
  | "drag"
  | "resize"
  | "group-drag"
  | "group-resize"
  | "pan"
  | "connect"
  | "select";

export type CanvasStagePointerEvent<T extends Element = Element> = {
  button: number;
  pointerId: number;
  clientX: number;
  clientY: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  target: EventTarget | null;
  currentTarget: T;
  preventDefault(): void;
  stopPropagation(): void;
};

export type CanvasStageMouseEvent<T extends Element = Element> = {
  clientX: number;
  clientY: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  target: EventTarget | null;
  currentTarget: T;
  preventDefault(): void;
  stopPropagation(): void;
};

export type CanvasStageInteractionBindings = {
  isSwitching(): boolean;
  isInteractionBlocked(): boolean;
  isProjectActionDisabled(): boolean;
  getWheelZoomRequiresCtrl(): boolean;
  getShortcuts(): CanvasShortcutBindings;
  getMinimapModel(): CanvasMinimapModel;
  getNodes(): CanvasNodeData[];
  setNodes(nodes: CanvasNodeData[]): void;
  getEdges(): CanvasEdgeData[];
  setEdges(edges: CanvasEdgeData[]): void;
  getGroups(): CanvasGroupData[];
  setGroups(groups: CanvasGroupData[]): void;
  getSelectedNodeIds(): Set<string>;
  getSelectedGroupId(): string;
  setSelectedGroupId(groupId: string): void;
  getSelectedEdgeId(): string;
  setSelectedEdgeId(edgeId: string): void;
  setHoveredEdgeId(edgeId: string): void;
  getHoveredNodeId(): string;
  setHoveredNodeId(nodeId: string): void;
  getSelectedNode(): CanvasNodeData | null;
  commitViewport(viewport: CanvasStageViewport): void;
  setInspectorOpen(open: boolean): void;
  setEditingInlineNodeId(nodeId: string): void;
  applyNodeSelection(ids: Iterable<string>, primaryId?: string, openInspector?: boolean): void;
  pauseHistory(): void;
  resumeHistory(changed: boolean): void;
  setContextMenu(menu: CanvasContextMenuState | null): void;
  copySelectedNodes(): unknown;
  pasteCopiedNodes(): unknown;
  undoCanvas(): void;
  redoCanvas(): void;
  runSelectedGeneration(): void;
  removeNodes(ids: Iterable<string>): void;
  removeEdge(edgeId: string): void;
  onInfo(message: string): void;
  onWarning(message: string): void;
};

export type CanvasStageInteractionAdapter = {
  now(): number;
  createId(): string;
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(frame: number): void;
  setTimer(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimer(timer: ReturnType<typeof setTimeout>): void;
  getRect(element: Element | null): CanvasStageBounds & { left: number; top: number } | null;
  closest(target: EventTarget | null, selector: string): Element | null;
  getAttribute(element: Element | null, name: string): string;
  elementFromPoint(clientX: number, clientY: number): Element | null;
  isHotkeyEditingTarget(target: EventTarget | null): boolean;
  isInlineNodeEditor(target: EventTarget | null): boolean;
  blurActiveInlineEditorExcept(nodeId: string): void;
  focusInlineEditor(stage: Element | null, nodeId: string): void;
  capturePointer(element: Element, pointerId: number): void;
  releasePointer(element: Element, pointerId: number): void;
  setPanCursor(active: boolean): void;
  setConnectionHandleMagnet(
    element: HTMLElement,
    active: boolean,
    offset?: { x: number; y: number; strength: number },
  ): void;
  addWindowListener(
    type: string,
    listener: (event: Event) => void,
    options?: AddEventListenerOptions | boolean,
  ): () => void;
  addWheelListener(element: Element, listener: (event: WheelEvent) => void): () => void;
  observeStage(element: Element, listener: (bounds: CanvasStageBounds) => void): () => void;
};

export type CanvasGroupSelection = {
  group: CanvasGroupData;
  openInspector?: boolean;
};
