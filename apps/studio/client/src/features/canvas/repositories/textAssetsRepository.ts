import {
  createLocalForageStorageAdapter,
  type LocalForageStorageAdapter,
} from "@/shared/storage";

export type CanvasTextAsset = {
  id: string;
  title: string;
  content: string;
  scope: "personal" | "team";
  createdAt: string;
  updatedAt: string;
};

export type CanvasTextAssetStorage = Pick<
  LocalForageStorageAdapter,
  "getItem" | "setItem"
>;

const STORAGE_PREFIX = "ai-manhua-studio:canvas-text-assets";
const canvasTextAssetStorage = createLocalForageStorageAdapter();

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
  input: { userId: string; scope: "personal" | "team"; title: string; content: string; id?: string },
  storage: CanvasTextAssetStorage = canvasTextAssetStorage,
) {
  const userId = input.userId.trim();
  const content = input.content.trim();
  if (!userId) throw new Error("缺少当前用户，无法保存文本资产");
  if (!content) throw new Error("空文本不能加入素材库");
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
  };
  const next = [asset, ...current.filter((item) => item.id !== id)];
  await storage.setItem(canvasTextAssetStorageKey(userId, input.scope), next);
  return asset;
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
    } satisfies CanvasTextAsset];
  });
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}
