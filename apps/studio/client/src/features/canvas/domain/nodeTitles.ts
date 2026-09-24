import type { CanvasNodeData, CanvasNodeKind } from "./types";

/** Compact canvas labels keep the full stored name for editing and references. */
export const CANVAS_NODE_TITLE_VISIBLE_CHARACTERS = 8;
const CANVAS_NODE_COPY_SUFFIX = "副本";
/** Recognized file types only: decimal numbers and dots in user names are meaningful. */
const CANVAS_NODE_FILE_EXTENSION = /(?:\.(?:png|jpe?g|webp|gif|avif|bmp|tiff?|svg|heic|heif|ico|mp4|m4v|mov|webm|mkv|avi|wmv|flv|mpeg|mpg|3gp|mp3|wav|wave|ogg|oga|opus|aac|flac|m4a|aiff?|wma|pcm|txt|md|markdown|pdf|docx?|xlsx?|pptx?|csv|json|srt|vtt))+(?=(?:副本(?:\d+|（\d+）)?|（\d+）)*$)/i;
/** Keep the collision index visible even when the descriptive title is shortened. */
const CANVAS_NODE_NUMBER_SUFFIX = /(?:(?:image|text|video|audio|config|director)?-\d+|（\d+）)$/;
/** Copies may come from older snapshots using 副本2, or the current 副本（1）. */
const CANVAS_NODE_COPY_PATTERN = /\s*副本(?:\d+|（\d+）)?$/;
/** Legacy text aliases share the text sequence; every other kind has its own counter. */
const CANVAS_NODE_TITLE_KIND: Record<CanvasNodeKind, string> = {
  image: "image", text: "text", prompt: "text", note: "text",
  video: "video", audio: "audio", config: "config", director: "director",
};
/** Used only when a completed output has no project context yet. */
const CANVAS_UNTITLED_PROJECT = "未命名画布";
/** Shared with node creation so every placeholder keeps its existing kind label. */
export const CANVAS_NODE_PLACEHOLDER_TITLES: Record<CanvasNodeKind, string> = {
  prompt: "新提示词", text: "剧本提示词", note: "备注", image: "图片占位",
  config: "生成配置", video: "视频片段", audio: "音频轨道", director: "3D 导演台",
};
/** Recognize historical numeric/parenthesized labels and the current suffix. */
const CANVAS_PLACEHOLDER_INDEX = /^(?:-?\d+|\s*[（(]\d+[）)])?$/;

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

/** Keep the original import collision format outside managed names. */
function ensureLegacyCanvasNodeTitles(nodes: CanvasNodeData[], previous: readonly CanvasNodeData[] = []): CanvasNodeData[] {
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
    return { ...node, title };
  });
  return changed ? next : nodes;
}

export function isGeneratedCanvasNode(node: Pick<CanvasNodeData, "metadata">): boolean {
  const meta = node.metadata;
  if (meta?.generatedInCanvas) return true;
  if (meta?.canvasOrigin === "imported") return false;
  // Older snapshots predate the explicit marker. Do not infer generation from prompts.
  return Boolean(meta?.generatedAt || (meta?.sourceNodeId && meta?.generationMode && meta?.status === "success"));
}

export function canvasNodePlaceholderTitle(
  node: Pick<CanvasNodeData, "title" | "metadata"> & Partial<Pick<CanvasNodeData, "kind" | "imageAssetId" | "imageSrc">>,
): string | undefined {
  if (!node.kind || isGeneratedCanvasNode(node) || node.metadata?.canvasOrigin === "imported"
    || node.imageAssetId || node.imageSrc || node.metadata?.assetId || node.metadata?.titleMode === "custom") return;
  const base = CANVAS_NODE_PLACEHOLDER_TITLES[node.kind];
  if (node.metadata?.titleMode === "placeholder") return base;
  const title = node.title.trim();
  // Old automatic deduplication also set titleEdited. Recognize its exact default
  // labels; explicit renames now carry titleMode=custom to avoid this ambiguity.
  return title.startsWith(base) && CANVAS_PLACEHOLDER_INDEX.test(title.slice(base.length)) ? base : undefined;
}

export function preserveCanvasNodeTitle(node: CanvasNodeData, fallback: string): string {
  return node.metadata?.titleEdited || isGeneratedCanvasNode(node) ? node.title : fallback;
}

/** Recompute generated, placeholder and explicitly named groups, in graph creation order.
 * Keep the literal custom base in metadata: a user-written '-1' is never stripped. */
export function ensureUniqueCanvasNodeTitles(
  nodes: CanvasNodeData[], previous: readonly CanvasNodeData[] = [], projectTitle?: string,
): CanvasNodeData[] {
  const previousById = new Map(previous.map(node => [node.id, node]));
  const placeholderBases = new Map(nodes.flatMap(node => {
    const base = canvasNodePlaceholderTitle(node);
    return base ? [[node.id, base] as const] : [];
  }));
  const customBases = new Map<string, string>();
  for (const node of nodes) {
    if (!node.metadata?.titleEdited || placeholderBases.has(node.id)) continue;
    const old = previousById.get(node.id);
    const base = node.metadata.titleBase || old?.metadata?.titleBase
      || (old?.metadata?.titleEdited ? old.title : node.title);
    customBases.set(node.id, canvasNodeTitle(base));
  }
  const requestedNames = new Set(customBases.values());
  // An existing literal name joins a custom collision group instead of winning silently.
  for (const node of nodes) {
    if (!customBases.has(node.id) && !placeholderBases.has(node.id) && !isGeneratedCanvasNode(node) && requestedNames.has(canvasNodeTitle(node.title))) {
      customBases.set(node.id, canvasNodeTitle(node.title));
    }
  }
  const generated = nodes.filter(node => !customBases.has(node.id) && isGeneratedCanvasNode(node));
  const generatedIds = new Set(generated.map(node => node.id));
  const legacy = ensureLegacyCanvasNodeTitles(nodes.filter(node => !customBases.has(node.id) && !generatedIds.has(node.id) && !placeholderBases.has(node.id)), previous);
  const nextById = new Map(legacy.map(node => [node.id, node]));
  const used = new Set(legacy.map(node => node.title));
  const customGroups = new Map<string, CanvasNodeData[]>();
  for (const node of nodes) {
    const base = customBases.get(node.id);
    if (base === undefined) continue;
    const group = customGroups.get(base) || [];
    group.push(node);
    customGroups.set(base, group);
  }
  // Reserve literal names before assigning indices, including literal names like 'Apple-1'.
  for (const [base, group] of customGroups) if (group.length === 1) used.add(base);
  for (const [base, group] of customGroups) {
    let number = 1;
    for (const node of group) {
      let title = base;
      if (group.length > 1) {
        while (used.has(`${base}-${number}`)) number += 1;
        title = `${base}-${number++}`;
        used.add(title);
      }
      nextById.set(node.id, node.title === title && node.metadata?.titleBase === base && node.metadata.titleEdited && node.metadata.titleMode === "custom"
        ? node : { ...node, title, metadata: { ...node.metadata, titleEdited: true, titleBase: base, titleMode: "custom" } });
    }
  }
  const counters = new Map<string, number>();
  for (const node of nodes) {
    const base = placeholderBases.get(node.id);
    if (!base) continue;
    let number = counters.get(base) || 1;
    while (used.has(`${base}-${number}`)) number += 1;
    const title = `${base}-${number}`;
    counters.set(base, number + 1);
    used.add(title);
    nextById.set(node.id, node.title === title && node.metadata?.titleMode === "placeholder" && !node.metadata.titleEdited
      ? node : { ...node, title, metadata: { ...node.metadata, titleMode: "placeholder", titleEdited: false, titleBase: undefined } });
  }
  for (const node of generated) {
    const project = projectTitle?.trim() || node.metadata?.titleProjectName || CANVAS_UNTITLED_PROJECT;
    const base = `${project}${CANVAS_NODE_TITLE_KIND[node.kind]}`;
    let number = counters.get(base) || 1;
    while (used.has(`${base}-${number}`)) number += 1;
    const title = `${base}-${number}`;
    counters.set(base, number + 1);
    used.add(title);
    nextById.set(node.id, node.title === title && node.metadata?.titleProjectName === project && node.metadata.generatedInCanvas
      ? node : { ...node, title, metadata: { ...node.metadata, generatedInCanvas: true, titleProjectName: project } });
  }
  const next = nodes.map(node => nextById.get(node.id)!);
  return next.every((node, index) => node === nodes[index]) ? nodes : next;
}

export function canvasNodeRenamePatch(node: CanvasNodeData, name: string): Partial<CanvasNodeData> {
  const title = canvasNodeTitle(name);
  return { title, metadata: { ...node.metadata, titleEdited: true, titleBase: title, titleMode: "custom" } };
}

/** A title belongs to one canvas node, even when several nodes share its media. */
export function renameCanvasNode(nodes: CanvasNodeData[], nodeId: string, name: string): CanvasNodeData[] {
  if (!name.trim()) return nodes;
  const title = canvasNodeTitle(name);
  let changed = false;
  const next = nodes.map(node => {
    if (node.id !== nodeId || (node.title === title && node.metadata?.titleEdited)) return node;
    changed = true;
    return { ...node, ...canvasNodeRenamePatch(node, title) };
  });
  return changed ? ensureUniqueCanvasNodeTitles(next, nodes) : nodes;
}
