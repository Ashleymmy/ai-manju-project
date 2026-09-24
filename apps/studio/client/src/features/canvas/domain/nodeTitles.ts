import type { CanvasNodeData } from "./types";

/** Compact canvas labels keep the full stored name for editing and references. */
export const CANVAS_NODE_TITLE_VISIBLE_CHARACTERS = 8;
const CANVAS_NODE_COPY_SUFFIX = "副本";
/** Recognized file types only: decimal numbers and dots in user names are meaningful. */
const CANVAS_NODE_FILE_EXTENSION = /(?:\.(?:png|jpe?g|webp|gif|avif|bmp|tiff?|svg|heic|heif|ico|mp4|m4v|mov|webm|mkv|avi|wmv|flv|mpeg|mpg|3gp|mp3|wav|wave|ogg|oga|opus|aac|flac|m4a|aiff?|wma|pcm|txt|md|markdown|pdf|docx?|xlsx?|pptx?|csv|json|srt|vtt))+(?=(?:副本(?:\d+|（\d+）)?|（\d+）)*$)/i;
/** Keep the collision index visible even when the descriptive title is shortened. */
const CANVAS_NODE_NUMBER_SUFFIX = /（\d+）$/;
/** Copies may come from older snapshots using 副本2, or the current 副本（1）. */
const CANVAS_NODE_COPY_PATTERN = /\s*副本(?:\d+|（\d+）)?$/;

/** Node names are independent of filenames, including imported and explicitly edited nodes. */
export function canvasNodeTitle(name: string): string {
  return name.trim().replace(CANVAS_NODE_FILE_EXTENSION, "").trim() || "节点";
}

export function canvasNodeDisplayTitle(title: string): string {
  const name = canvasNodeTitle(title);
  const suffix = CANVAS_NODE_NUMBER_SUFFIX.exec(name)?.[0] || "";
  const characters = Array.from(suffix ? name.slice(0, -suffix.length) : name);
  return characters.length > CANVAS_NODE_TITLE_VISIBLE_CHARACTERS
    ? `${characters.slice(0, CANVAS_NODE_TITLE_VISIBLE_CHARACTERS).join("")}…${suffix}`
    : name;
}

export function uniqueCanvasNodeTitle(name: string, used: ReadonlySet<string>): string {
  return uniqueNormalizedTitle(canvasNodeTitle(name), new Set(Array.from(used, canvasNodeTitle)));
}

/** The graph already normalizes its namespace once; avoid rebuilding it for each collision. */
function uniqueNormalizedTitle(base: string, used: ReadonlySet<string>): string {
  if (!used.has(base)) return base;
  // Never interpret a user's trailing digits as an automatically added index.
  let number = 1;
  while (used.has(`${base}（${number}）`)) number += 1;
  return `${base}（${number}）`;
}

export function canvasNodeCopyTitle(name: string, used: ReadonlySet<string>): string {
  const base = canvasNodeTitle(name).replace(CANVAS_NODE_COPY_PATTERN, "") || "节点";
  return uniqueCanvasNodeTitle(`${base}${CANVAS_NODE_COPY_SUFFIX}`, used);
}

/** One namespace for every node kind. Existing names win over new/renamed nodes. */
export function ensureUniqueCanvasNodeTitles(nodes: CanvasNodeData[], previous: readonly CanvasNodeData[] = []): CanvasNodeData[] {
  if (nodes === previous) return nodes;
  const previousTitles = new Map(previous.map(node => [node.id, node.title]));
  const owners = new Map<string, string>();
  for (const node of nodes) {
    const title = canvasNodeTitle(node.title);
    if (previousTitles.get(node.id) === node.title && !owners.has(title)) {
      owners.set(title, node.id);
    }
  }
  for (const node of nodes) {
    const title = canvasNodeTitle(node.title);
    if (!owners.has(title)) owners.set(title, node.id);
  }
  const used = new Set(owners.keys());
  let changed = false;
  const next = nodes.map(node => {
    const base = canvasNodeTitle(node.title);
    const title = owners.get(base) === node.id ? base : uniqueNormalizedTitle(base, used);
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
