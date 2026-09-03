import { createStore, type StoreApi } from "zustand/vanilla";
import type { WorkspaceScope } from "@/shared/config";
import type { CanvasGroupData } from "@/features/canvas/domain/groups";
import type {
  CanvasBackgroundMode,
  CanvasEdgeData,
  CanvasNodeData,
} from "@/features/canvas/domain/types";

export type CanvasSyncStatus = "loading" | "pending" | "saving" | "synced" | "error";

export type CanvasGraphSlice = {
  nodes: CanvasNodeData[];
  edges: CanvasEdgeData[];
  groups: CanvasGroupData[];
  selectedNodeId: string;
  selectedNodeIds: string[];
  selectedGroupId: string;
  selectedEdgeId: string;
};

export type CanvasViewportSlice = {
  zoom: number;
  panX: number;
  panY: number;
  backgroundMode: CanvasBackgroundMode;
  showImageInfo: boolean;
};

export type CanvasSessionSlice = {
  scope: WorkspaceScope;
  projectTitle: string;
  canonicalProjectScope: WorkspaceScope | null;
  loading: boolean;
  saving: boolean;
  snapshotWriteReady: boolean;
  syncStatus: CanvasSyncStatus;
  snapshotVersion: number;
  snapshotUpdatedAt: string;
  syncError: string;
  switching: boolean;
};

export type CanvasGenerationSlice = {
  runningNodeIds: string[];
  runningGroupId: string;
  jobProgressByNode: Record<string, number>;
};

export type CanvasUiSlice = {
  createDialogOpen: boolean;
  deleteProjectOpen: boolean;
  clearCanvasOpen: boolean;
  connectSelectionOpen: boolean;
  agentOpen: boolean;
  inspectorOpen: boolean;
  pinnedToolbarNodeId: string;
  promptLibraryNodeId: string;
  seedanceAssetNodeId: string;
  materialNodeId: string;
  hoveredNodeId: string;
  hoveredEdgeId: string;
  editingInlineNodeId: string;
  titleEditingNodeId: string;
  titleDraft: string;
  skillLibraryOpen: boolean;
  presetManagerOpen: boolean;
  canvasSwitcherOpen: boolean;
  canvasSwitcherQuery: string;
  minimapOpen: boolean;
  imageAnnotationNodeId: string;
  imageMaskNodeId: string;
  imagePreviewNodeId: string;
  storyboardNodeId: string;
  storyboardEditorNodeId: string;
  replaceImageNodeId: string;
  panelHeight: number;
};

export type CanvasStoreSlices = {
  graph: CanvasGraphSlice;
  viewport: CanvasViewportSlice;
  session: CanvasSessionSlice;
  generation: CanvasGenerationSlice;
  ui: CanvasUiSlice;
};

export type CanvasSliceName = keyof CanvasStoreSlices;
export type CanvasStateUpdate<T> = T | ((current: T) => T);
export type CanvasStateSetter<T> = (update: CanvasStateUpdate<T>) => void;
export type CanvasStorePatch = {
  [Slice in CanvasSliceName]?: Partial<CanvasStoreSlices[Slice]>;
};
export type CanvasStoreTransaction = CanvasStorePatch | ((state: CanvasStoreSlices) => CanvasStorePatch);

export type CanvasStoreActions = {
  setField: <
    Slice extends CanvasSliceName,
    Field extends keyof CanvasStoreSlices[Slice],
  >(
    slice: Slice,
    field: Field,
    update: CanvasStateUpdate<CanvasStoreSlices[Slice][Field]>,
  ) => void;
  commit: (transaction: CanvasStoreTransaction) => void;
  setSelectedNodeIds: CanvasStateSetter<Set<string>>;
  setRunningNodeIds: CanvasStateSetter<Set<string>>;
};

export type CanvasStoreState = CanvasStoreSlices & {
  actions: CanvasStoreActions;
};

export type CanvasStoreInitialState = CanvasStorePatch;

export type CanvasStoreApi = StoreApi<CanvasStoreState>;

function defaultGraphSlice(): CanvasGraphSlice {
  return {
    nodes: [], edges: [], groups: [], selectedNodeId: "", selectedNodeIds: [],
    selectedGroupId: "", selectedEdgeId: "",
  };
}

function defaultViewportSlice(): CanvasViewportSlice {
  return { zoom: 90, panX: 0, panY: 0, backgroundMode: "dots", showImageInfo: false };
}

function defaultSessionSlice(): CanvasSessionSlice {
  return {
    scope: "personal", projectTitle: "", canonicalProjectScope: null, loading: true,
    saving: false, snapshotWriteReady: false, syncStatus: "loading", snapshotVersion: 0,
    snapshotUpdatedAt: "", syncError: "", switching: false,
  };
}

function defaultGenerationSlice(): CanvasGenerationSlice {
  return { runningNodeIds: [], runningGroupId: "", jobProgressByNode: {} };
}

function defaultUiSlice(): CanvasUiSlice {
  return {
    createDialogOpen: false, deleteProjectOpen: false, clearCanvasOpen: false,
    connectSelectionOpen: false, agentOpen: false, inspectorOpen: false,
    pinnedToolbarNodeId: "", promptLibraryNodeId: "", seedanceAssetNodeId: "",
    materialNodeId: "", hoveredNodeId: "", hoveredEdgeId: "", editingInlineNodeId: "",
    titleEditingNodeId: "", titleDraft: "", skillLibraryOpen: false,
    presetManagerOpen: false, canvasSwitcherOpen: false, canvasSwitcherQuery: "",
    minimapOpen: false, imageAnnotationNodeId: "", imageMaskNodeId: "",
    imagePreviewNodeId: "", storyboardNodeId: "", storyboardEditorNodeId: "",
    replaceImageNodeId: "", panelHeight: 300,
  };
}

function resolveCanvasStateUpdate<T>(update: CanvasStateUpdate<T>, current: T): T {
  return typeof update === "function"
    ? (update as (value: T) => T)(current)
    : update;
}

function mergeInitialState(initialState: CanvasStoreInitialState): CanvasStoreSlices {
  return {
    graph: { ...defaultGraphSlice(), ...initialState.graph },
    viewport: { ...defaultViewportSlice(), ...initialState.viewport },
    session: { ...defaultSessionSlice(), ...initialState.session },
    generation: { ...defaultGenerationSlice(), ...initialState.generation },
    ui: { ...defaultUiSlice(), ...initialState.ui },
  };
}

export function createCanvasStore(initialState: CanvasStoreInitialState = {}): CanvasStoreApi {
  const initial = mergeInitialState(initialState);

  return createStore<CanvasStoreState>()((set) => ({
    ...initial,
    actions: {
      setField: (slice, field, update) => {
        set((state) => {
          const current = state[slice][field];
          const next = resolveCanvasStateUpdate(update, current);
          if (Object.is(current, next)) return state;
          return {
            ...state,
            [slice]: {
              ...state[slice],
              [field]: next,
            },
          } as CanvasStoreState;
        });
      },
      commit: (transaction) => {
        set((state) => {
          const patch = typeof transaction === "function"
            ? transaction(canvasSerializableState(state))
            : transaction;
          return {
            ...state,
            graph: patch.graph ? { ...state.graph, ...patch.graph } : state.graph,
            viewport: patch.viewport ? { ...state.viewport, ...patch.viewport } : state.viewport,
            session: patch.session ? { ...state.session, ...patch.session } : state.session,
            generation: patch.generation ? { ...state.generation, ...patch.generation } : state.generation,
            ui: patch.ui ? { ...state.ui, ...patch.ui } : state.ui,
          };
        });
      },
      setSelectedNodeIds: (update) => {
        set((state) => {
          const current = new Set(state.graph.selectedNodeIds);
          const next = resolveCanvasStateUpdate(update, current);
          if (next === current) return state;
          const nextIds = [...next];
          if (nextIds.length === state.graph.selectedNodeIds.length
            && nextIds.every((id, index) => id === state.graph.selectedNodeIds[index])) return state;
          return {
            ...state,
            graph: {
              ...state.graph,
              selectedNodeIds: nextIds,
            },
          };
        });
      },
      setRunningNodeIds: (update) => {
        set((state) => {
          const current = new Set(state.generation.runningNodeIds);
          const next = resolveCanvasStateUpdate(update, current);
          if (next === current) return state;
          const nextIds = [...next];
          if (nextIds.length === state.generation.runningNodeIds.length
            && nextIds.every((id, index) => id === state.generation.runningNodeIds[index])) return state;
          return {
            ...state,
            generation: {
              ...state.generation,
              runningNodeIds: nextIds,
            },
          };
        });
      },
    },
  }));
}

export const selectCanvasNodes = (state: CanvasStoreState) => state.graph.nodes;
export const selectCanvasViewportZoom = (state: CanvasStoreState) => state.viewport.zoom;
export const selectCanvasSessionScope = (state: CanvasStoreState) => state.session.scope;
export const selectCanvasRunningNodeIds = (state: CanvasStoreState) => state.generation.runningNodeIds;
export const selectCanvasInspectorOpen = (state: CanvasStoreState) => state.ui.inspectorOpen;

export function canvasSerializableState(state: CanvasStoreState): CanvasStoreSlices {
  return {
    graph: state.graph,
    viewport: state.viewport,
    session: state.session,
    generation: state.generation,
    ui: state.ui,
  };
}
