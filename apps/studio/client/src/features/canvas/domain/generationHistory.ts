import { assetIdFromNode, imageSrcFromNode } from "./nodes";
import { promptTextFromNode } from "./nodeUtils";
import type { CanvasNodeData, CanvasNodeGenerationRevision } from "./types";
import { numberValue, stringValue } from "./value";

export type CanvasGenerationHistoryKind = "image" | "video";

export type CanvasGenerationHistoryItem = {
  nodeId: string;
  kind: CanvasGenerationHistoryKind;
  title: string;
  prompt: string;
  model: string;
  generatedAt: string;
  previewUrl: string;
  assetId: string;
  seed: string;
  size: string;
  seconds: string;
  typeLabel: string;
  modeLabel: string;
};

export type CanvasGenerationHistoryGroup = {
  key: string;
  label: string;
  items: CanvasGenerationHistoryItem[];
};

export type CanvasGenerationHistoryAsset = {
  id: string;
  created_at?: string;
};

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function formatCanvasGenerationClock(iso: string) {
  const stamp = Date.parse(iso);
  if (!Number.isFinite(stamp)) return "";
  const date = new Date(stamp);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export function formatCanvasGenerationDateTime(iso: string) {
  const stamp = Date.parse(iso);
  if (!Number.isFinite(stamp)) return "—";
  const date = new Date(stamp);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export type CanvasGenerationHistoryView = "tile" | "day" | "month";

export function canvasGenerationHistoryDayKey(iso: string) {
  const stamp = Date.parse(iso);
  if (!Number.isFinite(stamp)) return "";
  const date = new Date(stamp);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function canvasGenerationHistoryDayLabel(iso: string, now = new Date()) {
  const stamp = Date.parse(iso);
  if (!Number.isFinite(stamp)) return "未标注时间";
  const date = new Date(stamp);
  const diffDays = Math.round((startOfLocalDay(now) - startOfLocalDay(date)) / MS_PER_DAY);
  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "昨天";
  return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[date.getDay()]}`;
}

export function canvasGenerationHistoryMonthLabel(year: number, monthIndex: number) {
  return `${year}年${monthIndex + 1}月`;
}

export function canvasGenerationHistoryMonthFromIso(iso: string, fallback = new Date()) {
  const stamp = Date.parse(iso);
  const date = Number.isFinite(stamp) ? new Date(stamp) : fallback;
  return { year: date.getFullYear(), monthIndex: date.getMonth() };
}

export function shiftCanvasGenerationHistoryMonth(year: number, monthIndex: number, delta: number) {
  const date = new Date(year, monthIndex + delta, 1);
  return { year: date.getFullYear(), monthIndex: date.getMonth() };
}

export type CanvasGenerationHistoryMonthCell = {
  key: string;
  day: number;
  inMonth: boolean;
  isoDate: string;
  items: CanvasGenerationHistoryItem[];
};

export function buildCanvasGenerationHistoryMonth(
  items: readonly CanvasGenerationHistoryItem[],
  year: number,
  monthIndex: number,
): CanvasGenerationHistoryMonthCell[][] {
  const byDay = new Map<string, CanvasGenerationHistoryItem[]>();
  for (const item of items) {
    const key = canvasGenerationHistoryDayKey(item.generatedAt);
    if (!key) continue;
    const bucket = byDay.get(key);
    if (bucket) bucket.push(item);
    else byDay.set(key, [item]);
  }

  const cursor = new Date(year, monthIndex, 1);
  cursor.setDate(cursor.getDate() - cursor.getDay());
  const weeks: CanvasGenerationHistoryMonthCell[][] = [];
  for (let week = 0; week < 6; week += 1) {
    const row: CanvasGenerationHistoryMonthCell[] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const isoDate = `${cursor.getFullYear()}-${pad2(cursor.getMonth() + 1)}-${pad2(cursor.getDate())}`;
      row.push({
        key: `${isoDate}-${week}-${weekday}`,
        day: cursor.getDate(),
        inMonth: cursor.getFullYear() === year && cursor.getMonth() === monthIndex,
        isoDate,
        items: byDay.get(isoDate) || [],
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    const allOutside = row.every((cell) => !cell.inMonth);
    if (allOutside && week > 0) break;
    weeks.push(row);
  }
  return weeks;
}

function historySizeLabel(node: CanvasNodeData) {
  const size = stringValue(node.metadata?.size);
  if (size) return size;
  const width = numberValue(node.metadata?.naturalWidth);
  const height = numberValue(node.metadata?.naturalHeight);
  if (width && height) return `${Math.round(width)}×${Math.round(height)}`;
  return "";
}

function historyModeLabel(node: CanvasNodeData, kind: CanvasGenerationHistoryKind) {
  if (kind === "video") {
    const sub = stringValue(node.metadata?.videoSubMode);
    if (sub === "image" || sub === "firstlast") return "图生视频";
    return "文生视频";
  }
  if (node.metadata?.generationType === "edit") return "图生图";
  const refs = node.metadata?.referenceInputs;
  if (Array.isArray(refs) && refs.length) return "图生图";
  return "文生图";
}

function historySeed(node: CanvasNodeData) {
  const seed = node.metadata?.seed;
  if (typeof seed === "number" && Number.isFinite(seed)) return String(Math.trunc(seed));
  const text = stringValue(seed);
  if (text) return text;
  return node.id;
}

/** Keep a bounded stack of overwritten generations so history can still show them. */
const MAX_GENERATION_REVISIONS = 40;
const HISTORY_REVISION_SEP = "::rev::";

export function canvasGenerationHistoryItemId(nodeId: string, revisionId?: string) {
  return revisionId ? `${nodeId}${HISTORY_REVISION_SEP}${revisionId}` : nodeId;
}

export function parseCanvasGenerationHistoryItemId(id: string) {
  const index = id.indexOf(HISTORY_REVISION_SEP);
  if (index < 0) return { nodeId: id };
  return {
    nodeId: id.slice(0, index),
    revisionId: id.slice(index + HISTORY_REVISION_SEP.length),
  };
}

export function snapshotCanvasGenerationRevision(
  node: CanvasNodeData,
  revisionId: string,
): CanvasNodeGenerationRevision | null {
  const kind = node.kind === "video" ? "video" : node.kind === "image" ? "image" : null;
  if (!kind) return null;
  const assetId = assetIdFromNode(node);
  const imageSrc = looksLikeStoredImageSrc(node);
  if (!assetId && !imageSrc) return null;
  return {
    id: revisionId,
    kind,
    title: node.title || (kind === "video" ? "生成视频" : "生成图片"),
    prompt: promptTextFromNode(node),
    model: stringValue(node.metadata?.model),
    generatedAt: stringValue(node.metadata?.generatedAt),
    assetId,
    imageSrc: assetId ? undefined : imageSrc,
    seed: historySeed(node),
    size: historySizeLabel(node),
    seconds: stringValue(node.metadata?.seconds),
    width: node.width,
    height: node.height,
    naturalWidth: numberValue(node.metadata?.naturalWidth) || undefined,
    naturalHeight: numberValue(node.metadata?.naturalHeight) || undefined,
    mimeType: stringValue(node.metadata?.mimeType) || undefined,
    bytes: numberValue(node.metadata?.bytes) || undefined,
    typeLabel: kind === "video" ? "视频生成" : "图片生成",
    modeLabel: historyModeLabel(node, kind),
    assetScope: node.metadata?.assetScope,
  };
}

function looksLikeStoredImageSrc(node: CanvasNodeData) {
  const candidate = node.imageSrc || stringValue(node.metadata?.content);
  return candidate && !assetIdFromNode(node) ? candidate : "";
}

export function appendCanvasGenerationRevision(
  node: CanvasNodeData,
  revisionId: string,
): CanvasNodeGenerationRevision[] {
  const existing = Array.isArray(node.metadata?.generationRevisions)
    ? node.metadata.generationRevisions.filter((item): item is CanvasNodeGenerationRevision => Boolean(item?.id))
    : [];
  const snapshot = snapshotCanvasGenerationRevision(node, revisionId);
  if (!snapshot) return existing;
  const duplicate = existing.some((item) => (
    (snapshot.assetId && item.assetId === snapshot.assetId)
    || (!snapshot.assetId && snapshot.imageSrc && item.imageSrc === snapshot.imageSrc)
  ));
  if (duplicate) return existing;
  return [snapshot, ...existing].slice(0, MAX_GENERATION_REVISIONS);
}

export function collectCanvasPreviewAssetRefs(nodes: readonly CanvasNodeData[]) {
  const refs: Array<{ id: string; kind: "image" | "video" | "audio"; scope?: "personal" | "team" }> = [];
  const seen = new Set<string>();
  const push = (id: string, kind: "image" | "video" | "audio", scope?: "personal" | "team") => {
    const key = `${scope || ""}:${kind}:${id}`;
    if (!id || seen.has(key)) return;
    seen.add(key);
    refs.push({ id, kind, scope });
  };
  for (const node of nodes) {
    const id = assetIdFromNode(node);
    if (id) {
      push(
        id,
        node.kind === "video" ? "video" : node.kind === "audio" ? "audio" : "image",
        node.metadata?.assetScope,
      );
    }
    for (const revision of node.metadata?.generationRevisions || []) {
      const revId = stringValue(revision.assetId);
      if (!revId) continue;
      push(revId, revision.kind === "video" ? "video" : "image", revision.assetScope || node.metadata?.assetScope);
    }
  }
  return refs;
}

export function collectCanvasGenerationHistory(
  nodes: readonly CanvasNodeData[],
  previews: Record<string, string> = {},
  assets: readonly CanvasGenerationHistoryAsset[] = [],
): CanvasGenerationHistoryItem[] {
  const createdAtByAsset = new Map(assets.map(asset => [asset.id, stringValue(asset.created_at)]));
  const items: CanvasGenerationHistoryItem[] = [];
  for (const node of nodes) {
    const kind = node.kind === "video" ? "video" : node.kind === "image" ? "image" : null;
    if (!kind) continue;
    if (node.metadata?.appliedFromHistory) continue;
    const currentAssetId = assetIdFromNode(node);
    const currentPreview = imageSrcFromNode(node, previews);
    const includeCurrent = node.metadata?.status !== "loading" && node.metadata?.status !== "error" && Boolean(currentAssetId || currentPreview);
    if (includeCurrent) {
      items.push({
        nodeId: node.id,
        kind,
        title: node.title || (kind === "video" ? "生成视频" : "生成图片"),
        prompt: promptTextFromNode(node),
        model: stringValue(node.metadata?.model),
        generatedAt: stringValue(node.metadata?.generatedAt)
          || (currentAssetId ? createdAtByAsset.get(currentAssetId) || "" : ""),
        previewUrl: currentPreview,
        assetId: currentAssetId,
        seed: historySeed(node),
        size: historySizeLabel(node),
        seconds: stringValue(node.metadata?.seconds),
        typeLabel: kind === "video" ? "视频生成" : "图片生成",
        modeLabel: historyModeLabel(node, kind),
      });
    }
    const revisions = Array.isArray(node.metadata?.generationRevisions) ? node.metadata.generationRevisions : [];
    for (const revision of revisions) {
      if (!revision?.id) continue;
      const assetId = stringValue(revision.assetId);
      const previewUrl = (assetId && previews[assetId]) || stringValue(revision.imageSrc);
      if (!assetId && !previewUrl) continue;
      if (includeCurrent && assetId && assetId === currentAssetId) continue;
      const revisionKind = revision.kind === "video" ? "video" : "image";
      items.push({
        nodeId: canvasGenerationHistoryItemId(node.id, revision.id),
        kind: revisionKind,
        title: stringValue(revision.title) || (revisionKind === "video" ? "生成视频" : "生成图片"),
        prompt: stringValue(revision.prompt),
        model: stringValue(revision.model),
        generatedAt: stringValue(revision.generatedAt)
          || (assetId ? createdAtByAsset.get(assetId) || "" : ""),
        previewUrl,
        assetId,
        seed: typeof revision.seed === "number" && Number.isFinite(revision.seed)
          ? String(Math.trunc(revision.seed))
          : (stringValue(revision.seed) || revision.id),
        size: stringValue(revision.size),
        seconds: stringValue(revision.seconds),
        typeLabel: stringValue(revision.typeLabel) || (revisionKind === "video" ? "视频生成" : "图片生成"),
        modeLabel: stringValue(revision.modeLabel) || (revisionKind === "video" ? "文生视频" : "文生图"),
      });
    }
  }
  return items.sort((left, right) => {
    const leftStamp = Date.parse(left.generatedAt) || 0;
    const rightStamp = Date.parse(right.generatedAt) || 0;
    if (leftStamp !== rightStamp) return rightStamp - leftStamp;
    return left.nodeId.localeCompare(right.nodeId);
  });
}

const HISTORY_CLONE_STRIP_KEYS = [
  "batchRootId",
  "isBatchRoot",
  "batchChildIds",
  "batchModelV2",
  "primaryImageId",
  "ownAssetId",
  "ownImageSrc",
  "imageBatchExpanded",
  "jobId",
  "jobProgress",
  "pinColor",
  "generationRevisions",
] as const;

/** 把历史记录对应的节点复制成画布上的独立图片 / 视频，不带批次关系和入边。 */
export function cloneCanvasNodeFromGenerationHistory(
  source: CanvasNodeData,
  options: { id: string; x: number; y: number },
): CanvasNodeData {
  const metadata = { ...(source.metadata || {}) };
  for (const key of HISTORY_CLONE_STRIP_KEYS) delete metadata[key];
  metadata.appliedFromHistory = true;
  return {
    ...source,
    id: options.id,
    x: options.x,
    y: options.y,
    metadata,
  };
}

export function cloneCanvasNodeFromGenerationRevision(
  host: CanvasNodeData,
  revision: CanvasNodeGenerationRevision,
  options: { id: string; x: number; y: number },
): CanvasNodeData {
  const kind = revision.kind === "video" ? "video" : "image";
  const metadata = { ...(host.metadata || {}) };
  for (const key of HISTORY_CLONE_STRIP_KEYS) delete metadata[key];
  const prompt = stringValue(revision.prompt) || host.content;
  const assetId = stringValue(revision.assetId);
  metadata.appliedFromHistory = true;
  metadata.assetId = assetId || undefined;
  metadata.assetScope = revision.assetScope || host.metadata?.assetScope;
  metadata.prompt = prompt;
  metadata.content = prompt;
  metadata.model = stringValue(revision.model) || metadata.model;
  metadata.generatedAt = stringValue(revision.generatedAt) || metadata.generatedAt;
  metadata.seed = stringValue(revision.seed) || revision.seed || metadata.seed;
  metadata.size = stringValue(revision.size) || metadata.size;
  metadata.seconds = stringValue(revision.seconds) || metadata.seconds;
  metadata.mimeType = stringValue(revision.mimeType) || metadata.mimeType;
  metadata.bytes = numberValue(revision.bytes) ?? metadata.bytes;
  metadata.naturalWidth = numberValue(revision.naturalWidth) ?? metadata.naturalWidth;
  metadata.naturalHeight = numberValue(revision.naturalHeight) ?? metadata.naturalHeight;
  metadata.status = "success";
  metadata.errorDetails = undefined;
  return {
    ...host,
    id: options.id,
    kind,
    title: stringValue(revision.title) || host.title,
    content: prompt,
    x: options.x,
    y: options.y,
    width: numberValue(revision.width) || host.width,
    height: numberValue(revision.height) || host.height,
    imageAssetId: assetId || undefined,
    imageSrc: assetId ? undefined : stringValue(revision.imageSrc) || undefined,
    metadata,
  };
}

export function groupCanvasGenerationHistory(
  items: readonly CanvasGenerationHistoryItem[],
  kind: CanvasGenerationHistoryKind,
  now = new Date(),
): CanvasGenerationHistoryGroup[] {
  const filtered = items.filter(item => item.kind === kind);
  const groups: CanvasGenerationHistoryGroup[] = [];
  const indexByKey = new Map<string, number>();
  for (const item of filtered) {
    const label = canvasGenerationHistoryDayLabel(item.generatedAt, now);
    const key = item.generatedAt ? label : "undated";
    const existing = indexByKey.get(key);
    if (existing !== undefined) {
      groups[existing].items.push(item);
      continue;
    }
    indexByKey.set(key, groups.length);
    groups.push({ key, label, items: [item] });
  }
  return groups;
}
