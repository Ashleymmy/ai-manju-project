import localforage from "localforage";
import { publishAssetNameChange, updateAssetMetadata } from "@/entities/asset";
import type { WorkspaceScope } from "@/shared/config";
import { assetIdFromNode } from "../domain/nodes";
import { canvasNodeTitle } from "../domain/nodeTitles";
import type { CanvasNodeData } from "../domain/types";
import { workspaceScopeValue } from "../domain/workspace";
import { canvasNodeTextAssetId, renameCanvasTextAsset } from "../repositories/textAssetsRepository";

// Serialize writes to each real asset, including across canvas switches. A slow
// earlier rename must never overwrite the user's newer name.
const pendingWrites = new Map<string, Promise<unknown>>();
export function queueCanvasAssetWrite<T>(key: string, write: () => Promise<T>): Promise<T> {
  const result = (pendingWrites.get(key) || Promise.resolve()).catch(() => undefined).then(write);
  pendingWrites.set(key, result);
  void result.finally(() => { if (pendingWrites.get(key) === result) pendingWrites.delete(key); }).catch(() => undefined);
  return result;
}

export type CanvasAssetNameContext = { scope: WorkspaceScope; projectId: string; userId: string };

export function canvasNodeAssetNameTarget(node: CanvasNodeData, context: CanvasAssetNameContext) {
  if (node.kind === "text" || node.kind === "prompt" || node.kind === "note") {
    const scope = workspaceScopeValue(node.metadata?.textAssetScope) || context.scope;
    const id = String(node.metadata?.textAssetId || canvasNodeTextAssetId(context.projectId, node.id));
    return { id, scope, text: true, key: `text:${context.userId}:${scope}:${id}` };
  }
  if (!["image", "video", "audio"].includes(node.kind)) return;
  const id = assetIdFromNode(node);
  if (!id) return;
  const scope = workspaceScopeValue(node.metadata?.assetScope) || context.scope;
  return { id, scope, text: false, key: `media:${scope}:${id}` };
}

const pendingNameStore = localforage.createInstance({
  name: "ai-manhua-studio",
  storeName: "canvas_asset_name_sync_v1",
});
const pendingNamePrefix = (context: CanvasAssetNameContext) => `${context.userId}:${context.projectId}:`;
export type PendingCanvasAssetName = { targetKey: string; nodeId: string; title: string };

/** Library renames that failed transiently; the next open of the same canvas finishes them silently.
 * Kept outside the graph so the marker never becomes an undo step. Storage failures are ignored. */
export const pendingCanvasAssetNames = {
  async remember(context: CanvasAssetNameContext, targetKey: string, node: Pick<CanvasNodeData, "id" | "title">) {
    await pendingNameStore.setItem(pendingNamePrefix(context) + targetKey, { nodeId: node.id, title: node.title }).catch(() => undefined);
  },
  async forget(context: CanvasAssetNameContext, targetKey: string) {
    await pendingNameStore.removeItem(pendingNamePrefix(context) + targetKey).catch(() => undefined);
  },
  async list(context: CanvasAssetNameContext): Promise<PendingCanvasAssetName[]> {
    const prefix = pendingNamePrefix(context);
    const keys = (await pendingNameStore.keys().catch(() => [] as string[])).filter(key => key.startsWith(prefix));
    const items = await Promise.all(keys.map(async key => {
      const item = await pendingNameStore.getItem<Omit<PendingCanvasAssetName, "targetKey">>(key).catch(() => null);
      return item ? { targetKey: key.slice(prefix.length), nodeId: item.nodeId, title: item.title } : undefined;
    }));
    return items.filter((item): item is PendingCanvasAssetName => Boolean(item));
  },
};

const services = { updateAssetMetadata, renameCanvasTextAsset, publishAssetNameChange };
export async function syncCanvasNodeAssetName(node: CanvasNodeData, context: CanvasAssetNameContext, api = services) {
  const target = canvasNodeAssetNameTarget(node, context);
  if (!target) return;
  const name = canvasNodeTitle(node.title);
  return queueCanvasAssetWrite(target.key, async () => {
    if (target.text) {
      const saved = await api.renameCanvasTextAsset({ userId: context.userId, scope: target.scope, id: target.id, title: name });
      if (saved) api.publishAssetNameChange({ assetId: `local-text:${saved.id}`, name: saved.title, scope: target.scope });
    } else {
      const saved = await api.updateAssetMetadata(target.id, { name }, target.scope);
      api.publishAssetNameChange({ assetId: target.id, name: saved.name || name, scope: target.scope });
    }
  });
}
