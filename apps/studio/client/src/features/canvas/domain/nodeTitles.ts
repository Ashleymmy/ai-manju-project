import type { CanvasNodeData } from "./types";

/** A title belongs to one canvas node, even when several nodes share its media. */
export function renameCanvasNode(nodes: CanvasNodeData[], nodeId: string, name: string): CanvasNodeData[] {
  const title = name.trim();
  if (!title) return nodes;
  let changed = false;
  const next = nodes.map(node => {
    if (node.id !== nodeId || (node.title === title && node.metadata?.titleEdited)) return node;
    changed = true;
    return { ...node, title, metadata: { ...node.metadata, titleEdited: true } };
  });
  return changed ? next : nodes;
}
