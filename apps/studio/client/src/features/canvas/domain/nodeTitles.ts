import type { CanvasNodeData } from "./types";

/** Compact canvas labels keep the full stored name for editing and references. */
export const CANVAS_NODE_TITLE_VISIBLE_CHARACTERS = 5;
const CANVAS_NODE_COPY_SUFFIX = "副本";

export function canvasNodeDisplayTitle(title: string): string {
  const characters = Array.from(title);
  return characters.length > CANVAS_NODE_TITLE_VISIBLE_CHARACTERS
    ? `${characters.slice(0, CANVAS_NODE_TITLE_VISIBLE_CHARACTERS).join("")}…`
    : title;
}

export function uniqueCanvasNodeTitle(name: string, used: ReadonlySet<string>): string {
  const base = name.trim() || "节点";
  if (!used.has(base)) return base;
  // Copies start at 副本, 副本2; ordinary names start at 苹果, 苹果1.
  const copy = /^(.*副本)(?:\d+)?$/.exec(base);
  const prefix = copy?.[1] || base;
  let number = copy ? 2 : 1;
  while (used.has(`${prefix}${number}`)) number += 1;
  return `${prefix}${number}`;
}

export function canvasNodeCopyTitle(name: string, used: ReadonlySet<string>): string {
  const base = name.trim().replace(/\s*副本(?:\d+)?$/, "") || "节点";
  return uniqueCanvasNodeTitle(`${base}${CANVAS_NODE_COPY_SUFFIX}`, used);
}

/** One namespace for every node kind. Existing names win over new/renamed nodes. */
export function ensureUniqueCanvasNodeTitles(nodes: CanvasNodeData[], previous: readonly CanvasNodeData[] = []): CanvasNodeData[] {
  if (nodes === previous) return nodes;
  const previousTitles = new Map(previous.map(node => [node.id, node.title]));
  const owners = new Map<string, string>();
  for (const node of nodes) {
    if (previousTitles.get(node.id) === node.title && !owners.has(node.title.trim())) {
      owners.set(node.title.trim(), node.id);
    }
  }
  for (const node of nodes) {
    const title = node.title.trim() || "节点";
    if (!owners.has(title)) owners.set(title, node.id);
  }
  const used = new Set(owners.keys());
  let changed = false;
  const next = nodes.map(node => {
    const base = node.title.trim() || "节点";
    const title = owners.get(base) === node.id ? base : uniqueCanvasNodeTitle(base, used);
    used.add(title);
    if (title === node.title) return node;
    changed = true;
    return { ...node, title, metadata: { ...node.metadata, titleEdited: true } };
  });
  return changed ? next : nodes;
}

/** A title belongs to one canvas node, even when several nodes share its media. */
export function renameCanvasNode(nodes: CanvasNodeData[], nodeId: string, name: string): CanvasNodeData[] {
  if (!name.trim()) return nodes;
  const title = uniqueCanvasNodeTitle(name, new Set(nodes.filter(node => node.id !== nodeId).map(node => node.title)));
  let changed = false;
  const next = nodes.map(node => {
    if (node.id !== nodeId || (node.title === title && node.metadata?.titleEdited)) return node;
    changed = true;
    return { ...node, title, metadata: { ...node.metadata, titleEdited: true } };
  });
  return changed ? next : nodes;
}
