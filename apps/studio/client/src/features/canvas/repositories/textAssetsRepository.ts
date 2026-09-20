import {
  createLocalForageStorageAdapter,
  type LocalForageStorageAdapter,
} from "@/shared/storage";
import { CANVAS_LIBRARY_CATEGORIES, type CanvasLibraryCategory } from "../domain/assetFolders";
import { canvasTextDisplayValue } from "../domain/text";
import type { CanvasNodeData } from "../domain/types";

export type CanvasTextAsset = {
  id: string;
  title: string;
  content: string;
  scope: "personal" | "team";
  createdAt: string;
  updatedAt: string;
  folderId?: string;
  category?: CanvasLibraryCategory;
  projectId?: string;
  automatic?: boolean;
};

export type CanvasTextAssetStorage = Pick<
  LocalForageStorageAdapter,
  "getItem" | "setItem"
>;

const STORAGE_PREFIX = "ai-manhua-studio:canvas-text-assets";
const canvasTextAssetStorage = createLocalForageStorageAdapter();
// Serialize read/modify/write operations so automatic saves cannot overwrite a
// simultaneous manual classification or another canvas' text assets.
const storageWrites = new WeakMap<CanvasTextAssetStorage, Map<string, Promise<unknown>>>();

function writeTextAssets<T>(storage: CanvasTextAssetStorage, key: string, write: () => Promise<T>): Promise<T> {
  let pending = storageWrites.get(storage);
  if (!pending) storageWrites.set(storage, pending = new Map());
  const result = (pending.get(key) || Promise.resolve()).catch(() => undefined).then(write);
  pending.set(key, result);
  void result.finally(() => { if (pending.get(key) === result) pending.delete(key); }).catch(() => undefined);
  return result;
}

export function canvasNodeTextAssetId(projectId: string, nodeId: string) {
  return `canvas:${encodeURIComponent(projectId)}:${encodeURIComponent(nodeId)}`;
}

export async function syncCanvasTextAssets(
  input: { userId: string; scope: "personal" | "team"; projectId: string; nodes: readonly CanvasNodeData[] },
  storage: CanvasTextAssetStorage = canvasTextAssetStorage,
) {
  if (!input.userId.trim() || !input.projectId) return false;
  return writeTextAssets(storage, canvasTextAssetStorageKey(input.userId, input.scope), async () => {
    const current = await listCanvasTextAssets(input.userId, input.scope, storage);
    const byId = new Map<string, CanvasTextAsset>(current.map(asset => [asset.id, asset]));
    const now = new Date().toISOString();
    let changed = false;
    for (const node of input.nodes) {
      if (node.kind !== "text" || node.metadata?.status === "loading") continue;
      const content = canvasTextDisplayValue(node).trim();
      if (!content) continue;
      const id = node.metadata?.textAssetScope === input.scope && stringValue(node.metadata?.textAssetId)
        || canvasNodeTextAssetId(input.projectId, node.id);
      const previous = byId.get(id);
      // Manually saved text is a snapshot; later edits must not replace it.
      if (previous && !previous.automatic) continue;
      const title = node.title.trim() || "画布文本";
      if (previous?.title === title && previous.content === content) continue;
      byId.set(id, { id, title, content, scope: input.scope, projectId: input.projectId,
        category: "other", automatic: true, createdAt: previous?.createdAt || now, updatedAt: now });
      changed = true;
    }
    if (changed) await storage.setItem(canvasTextAssetStorageKey(input.userId, input.scope), [...byId.values()]);
    return changed;
  });
}

export function canvasTextAssetStorageKey(userId: string, scope: "personal" | "team") {
  return `${STORAGE_PREFIX}:${encodeURIComponent(userId.trim())}:${scope}`;
}

export async function listCanvasTextAssets(
  userId: string,
  scope: "personal" | "team",
  storage: CanvasTextAssetStorage = canvasTextAssetStorage,
) {
  if (!userId.trim()) return [];
  const stored = await storage.getItem<unknown>(canvasTextAssetStorageKey(userId, scope));
  return normalizeCanvasTextAssets(stored, scope);
}

export async function saveCanvasTextAsset(
  input: { userId: string; scope: "personal" | "team"; title: string; content: string; id?: string; folderId?: string; category?: CanvasLibraryCategory; projectId?: string },
  storage: CanvasTextAssetStorage = canvasTextAssetStorage,
) {
  const userId = input.userId.trim();
  const content = input.content.trim();
  if (!userId) throw new Error("缺少当前用户，无法保存文本资产");
  if (!content) throw new Error("空文本不能加入素材库");
  return writeTextAssets(storage, canvasTextAssetStorageKey(userId, input.scope), async () => {
    const now = new Date().toISOString();
    const current = await listCanvasTextAssets(userId, input.scope, storage);
    const id = input.id?.trim() || crypto.randomUUID();
    const existing = current.find((asset) => asset.id === id);
    const asset: CanvasTextAsset = {
      id,
      title: input.title.trim() || "画布文本",
      content,
      scope: input.scope,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      folderId: input.folderId ?? existing?.folderId,
      category: input.category ?? existing?.category,
      projectId: input.projectId ?? existing?.projectId,
      automatic: false,
    };
    const next = [asset, ...current.filter((item) => item.id !== id)];
    await storage.setItem(canvasTextAssetStorageKey(userId, input.scope), next);
    return asset;
  });
}

function normalizeCanvasTextAssets(value: unknown, scope: "personal" | "team") {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const source = item as Record<string, unknown>;
    const id = stringValue(source.id);
    const content = stringValue(source.content).trim();
    if (!id || !content) return [];
    const createdAt = stringValue(source.createdAt) || new Date(0).toISOString();
    return [{
      id,
      title: stringValue(source.title) || "画布文本",
      content,
      scope,
      createdAt,
      updatedAt: stringValue(source.updatedAt) || createdAt,
      folderId: stringValue(source.folderId) || undefined,
      category: CANVAS_LIBRARY_CATEGORIES.find(category => category.value === source.category)?.value,
      projectId: stringValue(source.projectId) || undefined,
      automatic: source.automatic === true,
    } satisfies CanvasTextAsset];
  });
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}
