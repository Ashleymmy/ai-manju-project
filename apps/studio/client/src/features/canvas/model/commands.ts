import type { CanvasGroupData } from "@/features/canvas/domain/groups";
import type {
  CanvasBackgroundMode,
  CanvasEdgeData,
  CanvasNodeData,
} from "@/features/canvas/domain/types";
import type { WorkspaceScope } from "@/shared/config";
import type { CanvasServices, CanvasServiceOperation } from "@/features/canvas/services/contracts";
import type {
  CanvasStateSetter,
  CanvasStoreApi,
  CanvasStoreSlices,
  CanvasStoreTransaction,
  CanvasSyncStatus,
} from "./store";

export type CanvasGraphCommands = {
  setNodes: CanvasStateSetter<CanvasNodeData[]>;
  setEdges: CanvasStateSetter<CanvasEdgeData[]>;
  setGroups: CanvasStateSetter<CanvasGroupData[]>;
  setSelectedNodeId: CanvasStateSetter<string>;
  setSelectedNodeIds: CanvasStateSetter<Set<string>>;
  setSelectedGroupId: CanvasStateSetter<string>;
  setSelectedEdgeId: CanvasStateSetter<string>;
};

export type CanvasViewportCommands = {
  setZoom: CanvasStateSetter<number>;
  setPanX: CanvasStateSetter<number>;
  setPanY: CanvasStateSetter<number>;
  setBackgroundMode: CanvasStateSetter<CanvasBackgroundMode>;
  setShowImageInfo: CanvasStateSetter<boolean>;
};

export type CanvasSessionCommands = {
  setScope: CanvasStateSetter<WorkspaceScope>;
  setProjectTitle: CanvasStateSetter<string>;
  setCanonicalProjectScope: CanvasStateSetter<WorkspaceScope | null>;
  setLoading: CanvasStateSetter<boolean>;
  setSaving: CanvasStateSetter<boolean>;
  setSnapshotWriteReady: CanvasStateSetter<boolean>;
  setSyncStatus: CanvasStateSetter<CanvasSyncStatus>;
  setSnapshotVersion: CanvasStateSetter<number>;
  setSnapshotUpdatedAt: CanvasStateSetter<string>;
  setSyncError: CanvasStateSetter<string>;
  setSwitching: CanvasStateSetter<boolean>;
};

export type CanvasGenerationCommands = {
  setRunningNodeIds: CanvasStateSetter<Set<string>>;
  setRunningGroupId: CanvasStateSetter<string>;
  setJobProgressByNode: CanvasStateSetter<Record<string, number>>;
};

export type CanvasUiCommands = {
  setCreateDialogOpen: CanvasStateSetter<boolean>;
  setDeleteProjectOpen: CanvasStateSetter<boolean>;
  setClearCanvasOpen: CanvasStateSetter<boolean>;
  setConnectSelectionOpen: CanvasStateSetter<boolean>;
  setAgentOpen: CanvasStateSetter<boolean>;
  setInspectorOpen: CanvasStateSetter<boolean>;
  setPinnedToolbarNodeId: CanvasStateSetter<string>;
  setPromptLibraryNodeId: CanvasStateSetter<string>;
  setSeedanceAssetNodeId: CanvasStateSetter<string>;
  setMaterialNodeId: CanvasStateSetter<string>;
  setHoveredNodeId: CanvasStateSetter<string>;
  setHoveredEdgeId: CanvasStateSetter<string>;
  setEditingInlineNodeId: CanvasStateSetter<string>;
  setTitleEditingNodeId: CanvasStateSetter<string>;
  setTitleDraft: CanvasStateSetter<string>;
  setSkillLibraryOpen: CanvasStateSetter<boolean>;
  setPresetManagerOpen: CanvasStateSetter<boolean>;
  setCanvasSwitcherOpen: CanvasStateSetter<boolean>;
  setCanvasSwitcherQuery: CanvasStateSetter<string>;
  setMinimapOpen: CanvasStateSetter<boolean>;
  setImageAnnotationNodeId: CanvasStateSetter<string>;
  setImageMaskNodeId: CanvasStateSetter<string>;
  setImagePreviewNodeId: CanvasStateSetter<string>;
  setStoryboardNodeId: CanvasStateSetter<string>;
  setStoryboardEditorNodeId: CanvasStateSetter<string>;
  setReplaceImageNodeId: CanvasStateSetter<string>;
  setPanelHeight: CanvasStateSetter<number>;
};

export type CanvasServiceCommands = {
  project: <Result>(operation: CanvasServiceOperation<Result>) => Promise<Result>;
  generation: <Result>(operation: CanvasServiceOperation<Result>) => Promise<Result>;
  assets: <Result>(operation: CanvasServiceOperation<Result>) => Promise<Result>;
  agent: <Result>(operation: CanvasServiceOperation<Result>) => Promise<Result>;
};

export type CanvasCommands = {
  commit: (transaction: CanvasStoreTransaction) => void;
  graph: CanvasGraphCommands;
  viewport: CanvasViewportCommands;
  session: CanvasSessionCommands;
  generation: CanvasGenerationCommands;
  ui: CanvasUiCommands;
  services: CanvasServiceCommands;
};

export type LatestCanvasCommandProxy<CommandSet extends object> = {
  commands: CommandSet;
  update: (commands: CommandSet) => void;
};

export function createLatestCanvasCommandProxy<CommandSet extends object>(
  initialCommands: CommandSet,
): LatestCanvasCommandProxy<CommandSet> {
  let latestCommands = initialCommands;
  const stableFunctions = new Map<PropertyKey, (...args: unknown[]) => unknown>();
  const commands = new Proxy({} as CommandSet, {
    get: (_target, property) => {
      const current = Reflect.get(latestCommands, property) as unknown;
      if (typeof current !== "function") return current;

      let stableFunction = stableFunctions.get(property);
      if (!stableFunction) {
        stableFunction = (...args: unknown[]) => {
          const latest = Reflect.get(latestCommands, property) as unknown;
          if (typeof latest !== "function") {
            throw new TypeError(`Canvas command ${String(property)} is no longer callable`);
          }
          return Reflect.apply(latest, undefined, args) as unknown;
        };
        stableFunctions.set(property, stableFunction);
      }
      return stableFunction;
    },
  });

  return {
    commands,
    update: (nextCommands) => {
      latestCommands = nextCommands;
    },
  };
}

function fieldCommand<
  Slice extends keyof CanvasStoreSlices,
  Field extends keyof CanvasStoreSlices[Slice],
>(
  store: CanvasStoreApi,
  slice: Slice,
  field: Field,
): CanvasStateSetter<CanvasStoreSlices[Slice][Field]> {
  return (update) => store.getState().actions.setField(slice, field, update);
}

export function createCanvasCommands(
  store: CanvasStoreApi,
  services: CanvasServices,
): CanvasCommands {
  return {
    commit: store.getState().actions.commit,
    graph: {
      setNodes: fieldCommand(store, "graph", "nodes"),
      setEdges: fieldCommand(store, "graph", "edges"),
      setGroups: fieldCommand(store, "graph", "groups"),
      setSelectedNodeId: fieldCommand(store, "graph", "selectedNodeId"),
      setSelectedNodeIds: store.getState().actions.setSelectedNodeIds,
      setSelectedGroupId: fieldCommand(store, "graph", "selectedGroupId"),
      setSelectedEdgeId: fieldCommand(store, "graph", "selectedEdgeId"),
    },
    viewport: {
      setZoom: fieldCommand(store, "viewport", "zoom"),
      setPanX: fieldCommand(store, "viewport", "panX"),
      setPanY: fieldCommand(store, "viewport", "panY"),
      setBackgroundMode: fieldCommand(store, "viewport", "backgroundMode"),
      setShowImageInfo: fieldCommand(store, "viewport", "showImageInfo"),
    },
    session: {
      setScope: fieldCommand(store, "session", "scope"),
      setProjectTitle: fieldCommand(store, "session", "projectTitle"),
      setCanonicalProjectScope: fieldCommand(store, "session", "canonicalProjectScope"),
      setLoading: fieldCommand(store, "session", "loading"),
      setSaving: fieldCommand(store, "session", "saving"),
      setSnapshotWriteReady: fieldCommand(store, "session", "snapshotWriteReady"),
      setSyncStatus: fieldCommand(store, "session", "syncStatus"),
      setSnapshotVersion: fieldCommand(store, "session", "snapshotVersion"),
      setSnapshotUpdatedAt: fieldCommand(store, "session", "snapshotUpdatedAt"),
      setSyncError: fieldCommand(store, "session", "syncError"),
      setSwitching: fieldCommand(store, "session", "switching"),
    },
    generation: {
      setRunningNodeIds: store.getState().actions.setRunningNodeIds,
      setRunningGroupId: fieldCommand(store, "generation", "runningGroupId"),
      setJobProgressByNode: fieldCommand(store, "generation", "jobProgressByNode"),
    },
    ui: {
      setCreateDialogOpen: fieldCommand(store, "ui", "createDialogOpen"),
      setDeleteProjectOpen: fieldCommand(store, "ui", "deleteProjectOpen"),
      setClearCanvasOpen: fieldCommand(store, "ui", "clearCanvasOpen"),
      setConnectSelectionOpen: fieldCommand(store, "ui", "connectSelectionOpen"),
      setAgentOpen: fieldCommand(store, "ui", "agentOpen"),
      setInspectorOpen: fieldCommand(store, "ui", "inspectorOpen"),
      setPinnedToolbarNodeId: fieldCommand(store, "ui", "pinnedToolbarNodeId"),
      setPromptLibraryNodeId: fieldCommand(store, "ui", "promptLibraryNodeId"),
      setSeedanceAssetNodeId: fieldCommand(store, "ui", "seedanceAssetNodeId"),
      setMaterialNodeId: fieldCommand(store, "ui", "materialNodeId"),
      setHoveredNodeId: fieldCommand(store, "ui", "hoveredNodeId"),
      setHoveredEdgeId: fieldCommand(store, "ui", "hoveredEdgeId"),
      setEditingInlineNodeId: fieldCommand(store, "ui", "editingInlineNodeId"),
      setTitleEditingNodeId: fieldCommand(store, "ui", "titleEditingNodeId"),
      setTitleDraft: fieldCommand(store, "ui", "titleDraft"),
      setSkillLibraryOpen: fieldCommand(store, "ui", "skillLibraryOpen"),
      setPresetManagerOpen: fieldCommand(store, "ui", "presetManagerOpen"),
      setCanvasSwitcherOpen: fieldCommand(store, "ui", "canvasSwitcherOpen"),
      setCanvasSwitcherQuery: fieldCommand(store, "ui", "canvasSwitcherQuery"),
      setMinimapOpen: fieldCommand(store, "ui", "minimapOpen"),
      setImageAnnotationNodeId: fieldCommand(store, "ui", "imageAnnotationNodeId"),
      setImageMaskNodeId: fieldCommand(store, "ui", "imageMaskNodeId"),
      setImagePreviewNodeId: fieldCommand(store, "ui", "imagePreviewNodeId"),
      setStoryboardNodeId: fieldCommand(store, "ui", "storyboardNodeId"),
      setStoryboardEditorNodeId: fieldCommand(store, "ui", "storyboardEditorNodeId"),
      setReplaceImageNodeId: fieldCommand(store, "ui", "replaceImageNodeId"),
      setPanelHeight: fieldCommand(store, "ui", "panelHeight"),
    },
    services: {
      project: services.project,
      generation: services.generation,
      assets: services.assets,
      agent: services.agent,
    },
  };
}
