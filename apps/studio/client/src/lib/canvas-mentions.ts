import {
  buildCanvasGenerationInputs,
  promptFromCanvasTopology,
  type CanvasConnectionEdge,
  type CanvasConnectionNode,
  type CanvasGenerationInput,
} from "./canvas-connections";

export const CANVAS_MENTION_PATTERN = /@\[(node|asset):([^\]]+)\]/g;
const CANVAS_MENTION_TRIGGER_PATTERN = /(^|[^A-Za-z0-9_])@([^\s@]*)$/;

export type CanvasMentionSource = "node" | "asset";
export type CanvasMentionKind = "text" | "image" | "video" | "audio";
export type CanvasMentionGroup = "canvas-node" | "asset-library";

export type CanvasMentionAsset = {
  id: string;
  type: "image" | "video" | "audio";
  name: string;
  category?: string;
  note?: string;
  tags?: string[];
  source_type?: string;
  scope?: "personal" | "team";
};

export type CanvasMentionReference = {
  id: string;
  key: string;
  source: CanvasMentionSource;
  group: CanvasMentionGroup;
  targetId: string;
  kind: CanvasMentionKind;
  label: string;
  title: string;
  searchText: string;
  active: boolean;
  nodeId?: string;
  assetId?: string;
  assetScope?: "personal" | "team";
  text?: string;
  content?: string;
};

export type CanvasMentionTextPart =
  | { type: "text"; value: string }
  | { type: "reference"; key: string; label: string; missing: boolean };

/** 编辑态给 mention 预留的不可见宽度，用来容纳缩略图和 chip 间距。 */
export const CANVAS_MENTION_EDITOR_SPACER = "\u2003";

export function canvasMentionEditorSpacer(kind?: CanvasMentionKind) {
  // 图片 chip 还包含缩略图，textarea 需要额外预留这段不可见宽度来对齐光标。
  return kind === "image"
    ? `${CANVAS_MENTION_EDITOR_SPACER}${CANVAS_MENTION_EDITOR_SPACER}${CANVAS_MENTION_EDITOR_SPACER}`
    : CANVAS_MENTION_EDITOR_SPACER;
}

export type CanvasMentionEditorSegment = {
  start: number;
  end: number;
  key: string;
  label: string;
  token: string;
};

export type CanvasMentionEditorPart =
  | { type: "text"; value: string }
  | { type: "reference"; key: string; label: string; missing: boolean };

export function buildCanvasMentionEditorModel(
  value: string,
  references: readonly CanvasMentionReference[]
) {
  const byKey = new Map(
    references.map(reference => [reference.key, reference])
  );
  const segments: CanvasMentionEditorSegment[] = [];
  let displayValue = "";
  let cursor = 0;
  for (const token of extractCanvasMentionTokens(value)) {
    if (token.index > cursor) displayValue += value.slice(cursor, token.index);
    const reference = byKey.get(token.key);
    const label = reference?.label || "引用已失效";
    const start = displayValue.length;
    displayValue += `${label}${canvasMentionEditorSpacer(reference?.kind)}`;
    segments.push({
      start,
      end: displayValue.length,
      key: token.key,
      label,
      token: token.raw,
    });
    cursor = token.index + token.raw.length;
  }
  displayValue += value.slice(cursor);
  return { displayValue, segments };
}

export function applyCanvasMentionEditorEdit(
  previousValue: string,
  nextValue: string,
  segments: readonly CanvasMentionEditorSegment[]
) {
  let start = 0;
  while (
    start < previousValue.length &&
    start < nextValue.length &&
    previousValue[start] === nextValue[start]
  )
    start += 1;
  let previousEnd = previousValue.length - 1;
  let nextEnd = nextValue.length - 1;
  while (
    previousEnd >= start &&
    nextEnd >= start &&
    previousValue[previousEnd] === nextValue[nextEnd]
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }
  const removedEnd = previousEnd + 1;
  const delta = nextValue.length - previousValue.length;
  return segments
    .filter(segment => segment.end <= start || segment.start >= removedEnd)
    .map(segment =>
      segment.start >= removedEnd
        ? { ...segment, start: segment.start + delta, end: segment.end + delta }
        : segment
    )
    .sort((left, right) => left.start - right.start);
}

export function serializeCanvasMentionEditorValue(
  value: string,
  segments: readonly CanvasMentionEditorSegment[]
) {
  let result = "";
  let cursor = 0;
  for (const segment of segments) {
    if (segment.start < cursor || segment.end > value.length) continue;
    result += value.slice(cursor, segment.start);
    result += segment.token;
    cursor = segment.end;
  }
  return result + value.slice(cursor);
}

export function splitCanvasMentionEditorDisplay(
  value: string,
  segments: readonly CanvasMentionEditorSegment[],
  references: readonly CanvasMentionReference[]
): CanvasMentionEditorPart[] {
  const byKey = new Map(
    references.map(reference => [reference.key, reference])
  );
  const parts: CanvasMentionEditorPart[] = [];
  let cursor = 0;
  for (const segment of segments) {
    if (segment.start < cursor || segment.end > value.length) continue;
    if (segment.start > cursor)
      parts.push({ type: "text", value: value.slice(cursor, segment.start) });
    const reference = byKey.get(segment.key);
    parts.push({
      type: "reference",
      key: segment.key,
      label: reference?.label || segment.label || "引用已失效",
      missing: !reference,
    });
    cursor = segment.end;
  }
  if (cursor < value.length)
    parts.push({ type: "text", value: value.slice(cursor) });
  return parts.length ? parts : [{ type: "text", value }];
}

export function canvasMentionToken(
  source: CanvasMentionSource,
  targetId: string
) {
  return `@[${source}:${targetId}]`;
}

export function extractCanvasMentionTokens(value: string) {
  return Array.from(value.matchAll(CANVAS_MENTION_PATTERN)).flatMap(match => {
    if (match.index === undefined) return [];
    const source = match[1] as CanvasMentionSource;
    const targetId = match[2];
    return [
      {
        source,
        targetId,
        key: `${source}:${targetId}`,
        raw: match[0],
        index: match.index,
      },
    ];
  });
}

export function matchCanvasMentionTrigger(value: string) {
  const match = CANVAS_MENTION_TRIGGER_PATTERN.exec(value);
  if (!match) return null;
  return { start: value.length - match[2].length - 1, query: match[2] || "" };
}

export function filterCanvasMentionReferences(
  references: readonly CanvasMentionReference[],
  query: string
) {
  const normalized = query.trim().toLowerCase();
  return references
    .filter(
      reference =>
        reference.active &&
        (!normalized || reference.searchText.includes(normalized))
    )
    .sort((left, right) => groupOrder(left.group) - groupOrder(right.group));
}

export function splitCanvasMentionText(
  value: string,
  references: readonly CanvasMentionReference[]
): CanvasMentionTextPart[] {
  const byKey = new Map(
    references.map(reference => [reference.key, reference])
  );
  const parts: CanvasMentionTextPart[] = [];
  let cursor = 0;
  for (const token of extractCanvasMentionTokens(value)) {
    if (token.index > cursor)
      parts.push({ type: "text", value: value.slice(cursor, token.index) });
    const reference = byKey.get(token.key);
    parts.push({
      type: "reference",
      key: token.key,
      label: reference?.label || "引用已失效",
      missing: !reference,
    });
    cursor = token.index + token.raw.length;
  }
  if (cursor < value.length)
    parts.push({ type: "text", value: value.slice(cursor) });
  return parts.length ? parts : [{ type: "text", value }];
}

export function buildCanvasMentionReferences(
  contextNodeId: string,
  nodes: readonly CanvasConnectionNode[],
  edges: readonly Pick<CanvasConnectionEdge, "from" | "to">[],
  assets: readonly CanvasMentionAsset[],
  assetScope: "personal" | "team"
) {
  const connectedIds = connectedComponentIds(contextNodeId, nodes, edges);
  const nodeReferences = nodes.flatMap((node): CanvasMentionReference[] => {
    if (node.id === contextNodeId) return [];
    const input = inputFromNode(node);
    if (!input) return [];
    const title = node.title?.trim() || node.id;
    return [
      {
        id: `node:${node.id}`,
        key: `node:${node.id}`,
        source: "node",
        group: "canvas-node",
        targetId: node.id,
        nodeId: node.id,
        assetId: input.assetId,
        kind: input.type,
        label: title,
        title,
        searchText: `${title} ${input.type} ${input.text || ""}`.toLowerCase(),
        active: connectedIds.has(node.id),
        assetScope: input.assetScope,
        text: input.text,
        content: input.content,
      },
    ];
  });
  const assetReferences = assets.map((asset): CanvasMentionReference => ({
    id: `asset:${asset.id}`,
    key: `asset:${asset.id}`,
    source: "asset",
    group: "asset-library",
    targetId: asset.id,
    assetId: asset.id,
    assetScope: asset.scope || assetScope,
    kind: asset.type,
    label: asset.name || asset.id,
    title: asset.name || asset.id,
    searchText: [
      asset.name,
      asset.type,
      asset.category,
      asset.note,
      asset.source_type,
      ...(asset.tags || []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
    active: true,
  }));
  return [...nodeReferences, ...assetReferences];
}

export function buildCanvasMentionGenerationContext(
  nodeId: string,
  nodes: readonly CanvasConnectionNode[],
  edges: readonly Pick<CanvasConnectionEdge, "from" | "to">[],
  ownPrompt: string,
  assets: readonly CanvasMentionAsset[],
  assetScope: "personal" | "team"
) {
  const tokens = extractCanvasMentionTokens(ownPrompt);
  const topologyInputs = buildCanvasGenerationInputs(nodeId, nodes, edges);
  if (!tokens.length) {
    return {
      prompt: promptFromCanvasTopology(nodeId, nodes, edges, ownPrompt),
      inputs: topologyInputs,
      missingKeys: [] as string[],
    };
  }

  const references = buildCanvasMentionReferences(
    nodeId,
    nodes,
    edges,
    assets,
    assetScope
  );
  const byKey = new Map(
    references.map(reference => [reference.key, reference])
  );
  const missingKeys = Array.from(
    new Set(
      tokens.filter(token => !byKey.has(token.key)).map(token => token.key)
    )
  );
  const selected: CanvasMentionReference[] = [];
  const selectedKeys = new Set<string>();
  tokens.forEach(token => {
    const reference = byKey.get(token.key);
    if (reference && !selectedKeys.has(reference.key)) {
      selected.push(reference);
      selectedKeys.add(reference.key);
    }
  });

  const labels = new Map<string, string>();
  const counts: Record<CanvasMentionKind, number> = {
    text: 0,
    image: 0,
    video: 0,
    audio: 0,
  };
  const textBlocks: string[] = [];
  let cursor = 0;
  let prompt = "";
  tokens.forEach(token => {
    prompt += ownPrompt.slice(cursor, token.index);
    const reference = byKey.get(token.key);
    if (!reference) {
      prompt += token.raw;
    } else {
      let label = labels.get(reference.key);
      if (!label) {
        label =
          reference.source === "asset"
            ? reference.title
            : mentionLabel(reference.kind, counts[reference.kind]++);
        labels.set(reference.key, label);
        if (reference.kind === "text")
          textBlocks.push(`【${label}】\n${reference.text || ""}`);
      }
      prompt += reference.kind === "text" ? `【${label}】` : label;
    }
    cursor = token.index + token.raw.length;
  });
  prompt += ownPrompt.slice(cursor);
  if (textBlocks.length)
    prompt = `${prompt.trim()}\n\n${textBlocks.join("\n\n")}`.trim();

  return {
    prompt,
    inputs: selected.map(referenceToInput),
    missingKeys,
  };
}

function referenceToInput(
  reference: CanvasMentionReference
): CanvasGenerationInput {
  return {
    nodeId: reference.nodeId || reference.assetId || reference.targetId,
    type: reference.kind,
    title: reference.title,
    text: reference.text,
    content: reference.content,
    assetId: reference.assetId,
    assetScope: reference.assetScope,
  };
}

function inputFromNode(
  node: CanvasConnectionNode
): Pick<
  CanvasGenerationInput,
  "type" | "text" | "content" | "assetId" | "assetScope"
> | null {
  const type =
    node.kind === "prompt" || node.kind === "text"
      ? "text"
      : node.kind === "image" || node.kind === "video" || node.kind === "audio"
        ? node.kind
        : null;
  if (!type) return null;
  const metadata = node.metadata || {};
  const value = (key: string) =>
    typeof metadata[key] === "string" ? String(metadata[key]).trim() : "";
  if (type === "text") {
    const text = value("prompt") || node.content?.trim() || value("content");
    return text ? { type, text } : null;
  }
  const content = node.imageSrc || value("content");
  const assetId = node.imageAssetId || value("assetId");
  const assetScope =
    metadata.assetScope === "personal" || metadata.assetScope === "team"
      ? metadata.assetScope
      : undefined;
  return content || assetId ? { type, content, assetId, assetScope } : null;
}

function connectedComponentIds(
  nodeId: string,
  nodes: readonly CanvasConnectionNode[],
  edges: readonly Pick<CanvasConnectionEdge, "from" | "to">[]
) {
  const known = new Set(nodes.map(node => node.id));
  if (!known.has(nodeId)) return new Set<string>();
  const related = new Map<string, Set<string>>();
  edges.forEach(edge => {
    if (!related.has(edge.from)) related.set(edge.from, new Set());
    if (!related.has(edge.to)) related.set(edge.to, new Set());
    related.get(edge.from)?.add(edge.to);
    related.get(edge.to)?.add(edge.from);
  });
  const visited = new Set<string>();
  const queue = [nodeId];
  while (queue.length) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    related.get(current)?.forEach(next => {
      if (known.has(next) && !visited.has(next)) queue.push(next);
    });
  }
  visited.delete(nodeId);
  return visited;
}

function mentionLabel(kind: CanvasMentionKind, index: number) {
  if (kind === "image") return `图片${index + 1}`;
  if (kind === "video") return `视频${index + 1}`;
  if (kind === "audio") return `音频${index + 1}`;
  return `文本${index + 1}`;
}

function groupOrder(group: CanvasMentionGroup) {
  return group === "canvas-node" ? 0 : 1;
}
