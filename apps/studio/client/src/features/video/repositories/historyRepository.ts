import localforage from "localforage";

import type { WorkspaceScope } from "@/shared/config";

import type {
  VideoGenerationConfig,
  VideoGenerationTask,
  VideoProvider,
} from "../services/generationGateway";

export type StoredVideoReferenceKind = "image" | "video" | "audio";
export type StoredVideoReferenceSource = "local" | "asset";
export type VideoArchiveState = "not_needed" | "pending" | "archived" | "failed";

export type StoredVideoReference = {
  id: string;
  kind: StoredVideoReferenceKind;
  source: StoredVideoReferenceSource;
  name: string;
  mime: string;
  bytes: number;
  width?: number;
  height?: number;
  durationMs?: number;
  storageKey?: string;
  assetId?: string;
  scope?: WorkspaceScope;
};

export type StoredVideoReferenceSnapshot = {
  images: StoredVideoReference[];
  videos: StoredVideoReference[];
  audios: StoredVideoReference[];
};

export type StoredVideoHistoryStatus = "queued" | "running" | "succeeded" | "failed";

export type StoredVideoHistoryItem = {
  id: string;
  model: string;
  prompt: string;
  status: StoredVideoHistoryStatus;
  createdAt: number;
  updatedAt?: number;
  provider?: VideoProvider;
  config: VideoGenerationConfig;
  task?: VideoGenerationTask;
  assetId?: string;
  scope?: WorkspaceScope;
  mimeType?: string;
  fileName?: string;
  resultStorageKey?: string;
  references?: StoredVideoReferenceSnapshot;
  archiveState?: VideoArchiveState;
  archiveError?: string;
  error?: string;
  progress?: number;
};

export type StoredVideoMediaEntry = {
  blob: Blob;
  name: string;
  mime: string;
  bytes: number;
  kind: StoredVideoReferenceKind | "result";
  width?: number;
  height?: number;
  durationMs?: number;
};

type StoredHistoryEnvelope = {
  version: 1;
  revision: number;
  items: StoredVideoHistoryItem[];
};

const databaseName = "ai-manhua-studio";
const historyKey = "history";
const migrationKey = "legacy-local-storage-v1";
const legacyLocalStorageKey = "ai-manhua-studio:video-generation-history";
const historyStore = localforage.createInstance({
  name: databaseName,
  storeName: "video_generation_history_v3",
});

const mediaStore = localforage.createInstance({
  name: databaseName,
  storeName: "video_generation_media_v3",
});

let historyWriteTail: Promise<void> = Promise.resolve();
let requestedRevision = 0;

export async function loadStoredVideoHistory() {
  await flushVideoHistoryWrites();
  const envelope = await historyStore.getItem<StoredHistoryEnvelope>(historyKey);
  requestedRevision = Math.max(requestedRevision, envelope?.revision || 0);
  const stored = normalizeHistoryItems(envelope?.items);
  const migrated = await historyStore.getItem<boolean>(migrationKey);
  if (migrated) return stored;

  const legacy = readLegacyLocalStorageHistory();
  const merged = mergeHistory(legacy, stored);
  await queueStoredVideoHistoryWrite(merged);
  await historyStore.setItem(migrationKey, true);
  try {
    localStorage.removeItem(legacyLocalStorageKey);
  } catch {
    // IndexedDB is already authoritative; an unavailable localStorage is harmless.
  }
  return merged;
}

export function queueStoredVideoHistoryWrite(items: StoredVideoHistoryItem[]) {
  const revision = ++requestedRevision;
  const snapshot = normalizeHistoryItems(items);
  const operation = historyWriteTail
    .catch(() => undefined)
    .then(async () => {
      await historyStore.setItem<StoredHistoryEnvelope>(historyKey, {
        version: 1,
        revision,
        items: snapshot,
      });
    });
  historyWriteTail = operation;
  return operation;
}

export async function flushVideoHistoryWrites() {
  await historyWriteTail;
}

export async function persistHistoryThenCleanup(
  nextItems: StoredVideoHistoryItem[],
  removedItems: StoredVideoHistoryItem[],
) {
  await queueStoredVideoHistoryWrite(nextItems);
  const cleanupErrors: Error[] = [];
  for (const item of removedItems) {
    try {
      await removeStoredHistoryMedia(item);
    } catch (error) {
      cleanupErrors.push(error instanceof Error ? error : new Error("清理视频历史媒体失败"));
    }
  }
  return cleanupErrors;
}

export async function storeDraftVideoMedia(
  file: File,
  metadata: {
    kind: StoredVideoReferenceKind;
    width?: number;
    height?: number;
    durationMs?: number;
  },
) {
  const key = `draft:${runtimeId()}`;
  await mediaStore.setItem<StoredVideoMediaEntry>(key, mediaEntryFromFile(file, metadata));
  return key;
}

export async function removeDraftVideoMedia(key?: string) {
  if (!key || !key.startsWith("draft:")) return;
  await mediaStore.removeItem(key);
}

export async function privatizeVideoReferences(
  logId: string,
  references: StoredVideoReferenceSnapshot,
) {
  const createdKeys: string[] = [];
  try {
    const copyList = async (
      items: StoredVideoReference[],
      expectedKind: StoredVideoReferenceKind,
    ) => {
      const result: StoredVideoReference[] = [];
      for (const item of items) {
        const normalized = normalizeStoredReference(item);
        if (!normalized || normalized.kind !== expectedKind) throw new Error("参考素材记录无效");
        if (normalized.source === "asset") {
          if (!normalized.assetId) throw new Error(`${normalized.name} 缺少资产 ID`);
          result.push({ ...normalized, storageKey: undefined });
          continue;
        }
        if (!normalized.storageKey?.startsWith("draft:")) {
          throw new Error(`${normalized.name} 缺少草稿媒体`);
        }
        const entry = await mediaStore.getItem<StoredVideoMediaEntry>(normalized.storageKey);
        if (!isStoredMediaEntry(entry)) throw new Error(`${normalized.name} 的草稿媒体已丢失`);
        const privateKey = historyReferenceKey(logId, normalized.id);
        await mediaStore.setItem(privateKey, cloneMediaEntry(entry));
        createdKeys.push(privateKey);
        result.push({ ...normalized, storageKey: privateKey });
      }
      return result;
    };

    return {
      images: await copyList(references.images, "image"),
      videos: await copyList(references.videos, "video"),
      audios: await copyList(references.audios, "audio"),
    } satisfies StoredVideoReferenceSnapshot;
  } catch (error) {
    await removeMediaKeys(createdKeys);
    throw error;
  }
}

export async function storeVideoHistoryResult(
  logId: string,
  blob: Blob,
  fileName: string,
  mimeType = "video/mp4",
) {
  const key = historyResultKey(logId);
  const normalized = blob.type ? blob : new Blob([blob], { type: mimeType });
  await mediaStore.setItem<StoredVideoMediaEntry>(key, {
    blob: normalized,
    name: safeFileName(fileName, "generated-video.mp4"),
    mime: normalized.type || mimeType,
    bytes: normalized.size,
    kind: "result",
  });
  return key;
}

export async function loadStoredVideoMedia(key: string) {
  const entry = await mediaStore.getItem<StoredVideoMediaEntry>(key);
  if (!isStoredMediaEntry(entry)) throw new Error("本地视频媒体已丢失");
  return cloneMediaEntry(entry);
}

export async function removeStoredHistoryResult(logId: string, key?: string) {
  const expected = historyResultKey(logId);
  if (!key || key !== expected) return;
  await mediaStore.removeItem(key);
}

export async function removeStoredHistoryMedia(item: StoredVideoHistoryItem) {
  const keys = historyMediaKeys(item);
  await removeMediaKeys(keys);
}

export function emptyStoredVideoReferences(): StoredVideoReferenceSnapshot {
  return { images: [], videos: [], audios: [] };
}

export function historyReferenceKey(logId: string, referenceId: string) {
  return `${historyPrefix(logId)}ref:${encodeURIComponent(referenceId)}`;
}

export function historyResultKey(logId: string) {
  return `${historyPrefix(logId)}result`;
}

function readLegacyLocalStorageHistory() {
  try {
    const raw = localStorage.getItem(legacyLocalStorageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return normalizeHistoryItems(parsed);
  } catch {
    return [];
  }
}

function mergeHistory(
  legacy: StoredVideoHistoryItem[],
  stored: StoredVideoHistoryItem[],
) {
  const merged = new Map<string, StoredVideoHistoryItem>();
  legacy.forEach((item) => merged.set(item.id, item));
  stored.forEach((item) => merged.set(item.id, item));
  return Array.from(merged.values())
    .sort((left, right) => right.createdAt - left.createdAt);
}

function normalizeHistoryItems(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeHistoryItem)
    .filter((item): item is StoredVideoHistoryItem => Boolean(item))
    .sort((left, right) => right.createdAt - left.createdAt);
}

export function paginateStoredVideoHistory<T>(items: readonly T[], page: number, pageSize = 20) {
  const safePageSize = Math.max(1, Math.floor(pageSize) || 20);
  const pageCount = Math.max(1, Math.ceil(items.length / safePageSize));
  const safePage = Math.min(pageCount, Math.max(1, Math.floor(page) || 1));
  const start = (safePage - 1) * safePageSize;
  return { items: items.slice(start, start + safePageSize), page: safePage, pageCount, pageSize: safePageSize };
}

function normalizeHistoryItem(value: unknown): StoredVideoHistoryItem | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const model = stringValue(value.model);
  if (!id || !model) return null;
  const configValue = isRecord(value.config) ? value.config : {};
  const config = normalizeConfig(configValue, model);
  const status = normalizeStatus(stringValue(value.status));
  const provider = normalizeProvider(value.provider) || providerFromModel(model);
  const task = normalizeTask(value.task, provider, model, id, status);
  const result = isRecord(value.result) ? value.result : {};
  const references = normalizeStoredReferences(value.references || value.referenceRecords, id);
  const resultStorageKey = normalizeResultStorageKey(id, stringValue(value.resultStorageKey));
  return {
    id,
    model,
    prompt: stringValue(value.prompt),
    status,
    createdAt: finiteNumber(value.createdAt) || Date.now(),
    updatedAt: finiteNumber(value.updatedAt),
    provider,
    config,
    task,
    assetId: stringValue(value.assetId) || stringValue(result.assetId) || undefined,
    scope: normalizeScope(value.scope),
    mimeType: stringValue(value.mimeType) || stringValue(result.mimeType) || undefined,
    fileName: safeOptionalFileName(value.fileName),
    resultStorageKey,
    references,
    archiveState: normalizeArchiveState(value.archiveState),
    archiveError: stringValue(value.archiveError) || undefined,
    error: stringValue(value.error) || undefined,
    progress: finiteNumber(value.progress),
  };
}

function normalizeStoredReferences(value: unknown, logId: string) {
  if (!isRecord(value)) return undefined;
  const normalizeList = (list: unknown, kind: StoredVideoReferenceKind) => {
    if (!Array.isArray(list)) return [];
    return list
      .map(normalizeStoredReference)
      .filter((item): item is StoredVideoReference => Boolean(item))
      .filter((item) => item.kind === kind)
      .map((item) => {
        if (item.source === "asset") return { ...item, storageKey: undefined };
        const expected = historyReferenceKey(logId, item.id);
        return item.storageKey === expected ? item : { ...item, storageKey: undefined };
      })
      .filter((item) => item.source === "asset" ? Boolean(item.assetId) : Boolean(item.storageKey));
  };
  const references = {
    images: normalizeList(value.images, "image"),
    videos: normalizeList(value.videos, "video"),
    audios: normalizeList(value.audios, "audio"),
  };
  return references.images.length || references.videos.length || references.audios.length
    ? references
    : undefined;
}

function normalizeStoredReference(value: unknown): StoredVideoReference | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const kind = normalizeReferenceKind(value.kind);
  const source = value.source === "asset" ? "asset" : "local";
  const name = safeFileName(stringValue(value.name), `${kind || "reference"}.bin`);
  const mime = stringValue(value.mime) || "application/octet-stream";
  if (!id || !kind) return null;
  return {
    id,
    kind,
    source,
    name,
    mime,
    bytes: finiteNumber(value.bytes) || 0,
    width: finiteNumber(value.width),
    height: finiteNumber(value.height),
    durationMs: finiteNumber(value.durationMs),
    storageKey: stringValue(value.storageKey) || undefined,
    assetId: stringValue(value.assetId) || undefined,
    scope: normalizeScope(value.scope),
  };
}

function normalizeConfig(value: Record<string, unknown>, model: string): VideoGenerationConfig {
  return {
    model: stringValue(value.model) || model,
    size: stringValue(value.size) || "1280x720",
    resolution: stringValue(value.resolution) || stringValue(value.vquality) || "720p",
    seconds: stringValue(value.seconds) || stringValue(value.videoSeconds) || "6",
    generateAudio: booleanValue(value.generateAudio, true),
    watermark: booleanValue(value.watermark, false),
  };
}

function normalizeTask(
  value: unknown,
  provider: VideoProvider,
  model: string,
  fallbackId: string,
  status: StoredVideoHistoryStatus,
) {
  if (isRecord(value)) {
    const id = stringValue(value.id) || fallbackId;
    const taskModel = stringValue(value.model) || model;
    if (id && taskModel) {
      return {
        id,
        model: taskModel,
        provider: normalizeProvider(value.provider) || provider,
      } satisfies VideoGenerationTask;
    }
  }
  return status === "queued" || status === "running"
    ? { id: fallbackId, model, provider }
    : undefined;
}

function historyMediaKeys(item: StoredVideoHistoryItem) {
  const prefix = historyPrefix(item.id);
  const keys = new Set<string>();
  const references = item.references || emptyStoredVideoReferences();
  [...references.images, ...references.videos, ...references.audios].forEach((reference) => {
    if (reference.storageKey?.startsWith(prefix)) keys.add(reference.storageKey);
  });
  if (item.resultStorageKey?.startsWith(prefix)) keys.add(item.resultStorageKey);
  return Array.from(keys);
}

async function removeMediaKeys(keys: string[]) {
  await Promise.all(keys.map((key) => mediaStore.removeItem(key)));
}

function mediaEntryFromFile(
  file: File,
  metadata: Omit<StoredVideoMediaEntry, "blob" | "name" | "mime" | "bytes">,
): StoredVideoMediaEntry {
  return {
    ...metadata,
    blob: file.slice(0, file.size, file.type || "application/octet-stream"),
    name: safeFileName(file.name, `${metadata.kind}.bin`),
    mime: file.type || "application/octet-stream",
    bytes: file.size,
  };
}

function cloneMediaEntry(entry: StoredVideoMediaEntry): StoredVideoMediaEntry {
  return {
    ...entry,
    blob: entry.blob.slice(0, entry.blob.size, entry.mime || entry.blob.type),
  };
}

function isStoredMediaEntry(value: unknown): value is StoredVideoMediaEntry {
  return isRecord(value)
    && value.blob instanceof Blob
    && typeof value.name === "string"
    && typeof value.mime === "string"
    && typeof value.bytes === "number"
    && (value.kind === "image" || value.kind === "video" || value.kind === "audio" || value.kind === "result");
}

function historyPrefix(logId: string) {
  return `history:${encodeURIComponent(logId)}:`;
}

function normalizeResultStorageKey(logId: string, value: string) {
  return value === historyResultKey(logId) ? value : undefined;
}

function normalizeStatus(value: string): StoredVideoHistoryStatus {
  const status = value.toLowerCase();
  if (status === "completed" || status === "succeeded" || status === "success") return "succeeded";
  if (status === "failed" || status === "error") return "failed";
  if (status === "running" || status === "processing" || status === "in_progress") return "running";
  return "queued";
}

function normalizeProvider(value: unknown): VideoProvider | undefined {
  return value === "openai" || value === "seedance" ? value : undefined;
}

function providerFromModel(model: string): VideoProvider {
  const value = model.toLowerCase();
  return value.includes("seedance") || value.includes("wan3") ? "seedance" : "openai";
}

function normalizeScope(value: unknown): WorkspaceScope {
  return value === "team" ? "team" : "personal";
}

function normalizeArchiveState(value: unknown): VideoArchiveState | undefined {
  return value === "not_needed" || value === "pending" || value === "archived" || value === "failed"
    ? value
    : undefined;
}

function normalizeReferenceKind(value: unknown): StoredVideoReferenceKind | undefined {
  return value === "image" || value === "video" || value === "audio" ? value : undefined;
}

function safeOptionalFileName(value: unknown) {
  const name = stringValue(value);
  return name ? safeFileName(name, "generated-video.mp4") : undefined;
}

function safeFileName(value: string, fallback: string) {
  const normalized = value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  return normalized.slice(0, 180) || fallback;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function runtimeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
