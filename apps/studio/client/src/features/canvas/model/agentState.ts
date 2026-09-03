import type { CanvasAgentViewport } from "@ai-manju/canvas-agent-protocol";

import { canvasViewportFromAgent } from "@/features/canvas/domain/snapshotCodec";
import type {
  CanvasEdgeData,
  CanvasNodeData,
} from "@/features/canvas/domain/types";
import type { CanvasCommands } from "./commands";

type CanvasAgentViewportState = ReturnType<typeof canvasViewportFromAgent>;

export type CanvasAgentSnapshotPersistence = (
  nodes: CanvasNodeData[],
  edges: CanvasEdgeData[],
  zoom: number,
  options: { quiet: true; panX: number; panY: number },
) => Promise<unknown>;

export async function commitCanvasAgentState({
  commands,
  nodes,
  edges,
  selectedNodeIds,
  agentViewport,
  viewportRef,
  closeContextMenu,
  persistSnapshot,
}: {
  commands: CanvasCommands;
  nodes: CanvasNodeData[];
  edges: CanvasEdgeData[];
  selectedNodeIds: readonly string[];
  agentViewport: CanvasAgentViewport;
  viewportRef: { current: CanvasAgentViewportState };
  closeContextMenu: () => void;
  persistSnapshot: CanvasAgentSnapshotPersistence;
}): Promise<CanvasAgentViewportState> {
  const viewport = canvasViewportFromAgent(agentViewport);
  viewportRef.current = viewport;
  commands.commit({
    graph: {
      nodes,
      edges,
      selectedNodeIds: [...selectedNodeIds],
      selectedNodeId: selectedNodeIds.at(-1) || "",
      selectedGroupId: "",
      selectedEdgeId: "",
    },
    viewport,
  });
  closeContextMenu();
  await persistSnapshot(nodes, edges, viewport.zoom, {
    quiet: true,
    panX: viewport.panX,
    panY: viewport.panY,
  });
  return viewport;
}
