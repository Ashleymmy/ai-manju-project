import { assetIdFromNode } from "./nodes";
import type { CanvasNodeData } from "./types";
import { workspaceScopeValue } from "./workspace";
import type { WorkspaceScope } from "@/shared/config";
import { generatedImageTitle, looksLikeGeneratedAssetName, normalizeGeneratedImageTitle } from "./imageTitles";

export { looksLikeGeneratedAssetName } from "./imageTitles";

export function collectLinkedAssetRefs(
  nodes: readonly CanvasNodeData[],
  fallbackScope: WorkspaceScope,
): Array<{ assetId: string; scope: WorkspaceScope }> {
  const seen = new Set<string>();
  const refs: Array<{ assetId: string; scope: WorkspaceScope }> = [];
  for (const node of nodes) {
    const assetId = assetIdFromNode(node);
    if (!assetId) continue;
    const scope = workspaceScopeValue(node.metadata?.assetScope) || fallbackScope;
    const key = `${scope}:${assetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ assetId, scope });
  }
  return refs;
}

export function applyAssetNameToLinkedNodes(
  nodes: readonly CanvasNodeData[],
  assetId: string,
  name: string,
  fallbackNodeId = "",
): CanvasNodeData[] {
  const title = name.trim();
  if (!title) return nodes as CanvasNodeData[];
  let changed = false;
  const next = nodes.map(node => {
    const matches = assetId
      ? assetIdFromNode(node) === assetId
      : Boolean(fallbackNodeId) && node.id === fallbackNodeId;
    if (!matches || node.title === title) return node;
    changed = true;
    return { ...node, title };
  });
  return changed ? next : nodes as CanvasNodeData[];
}

/** Apply a library event while keeping provider-generated filenames out of cards. */
export function applySyncedAssetNameToLinkedNodes(
  nodes: readonly CanvasNodeData[],
  assetId: string,
  name: string,
): CanvasNodeData[] {
  const next = nodes.map(node => {
    if (assetIdFromNode(node) !== assetId || node.metadata?.isBatchRoot) return node;
    if (node.kind !== "image" || node.metadata?.canvasOrigin === "imported") {
      return node.title === name ? node : { ...node, title: name };
    }
    const title = normalizeGeneratedImageTitle({ ...node, title: name });
    return node.title === title ? node : { ...node, title };
  });
  return next.every((node, index) => node === nodes[index]) ? nodes as CanvasNodeData[] : next;
}

export type AssetNamePush = {
  assetId: string;
  name: string;
  scope: WorkspaceScope;
};

export function reconcileLinkedAssetNames(
  nodes: readonly CanvasNodeData[],
  namesByAssetId: Readonly<Record<string, string>>,
  fallbackScope: WorkspaceScope,
): { nodes: CanvasNodeData[]; pushes: AssetNamePush[] } {
  const groups = new Map<string, CanvasNodeData[]>();
  for (const node of nodes) {
    // A batch root title reports progress for the group, not the asset name.
    if (node.metadata?.isBatchRoot) continue;
    const assetId = assetIdFromNode(node);
    if (!assetId || !namesByAssetId[assetId]) continue;
    const group = groups.get(assetId) || [];
    group.push(node);
    groups.set(assetId, group);
  }

  const titleByAsset = new Map<string, string>();
  const pushes: AssetNamePush[] = [];
  for (const [assetId, group] of groups) {
    const assetName = namesByAssetId[assetId]?.trim() || "";
    const preferred = group
      .map(node => node.title.trim())
      .find(title => title && !looksLikeGeneratedAssetName(title)) || "";
    const scope = workspaceScopeValue(group[0]?.metadata?.assetScope) || fallbackScope;
    if (preferred && looksLikeGeneratedAssetName(assetName) && preferred !== assetName) {
      titleByAsset.set(assetId, preferred);
      pushes.push({ assetId, name: preferred, scope });
    } else if (assetName) {
      const image = group.find(node => node.kind === "image" && node.metadata?.canvasOrigin !== "imported");
      // Keep a generated title extension-free when the library still has the
      // original filename. Explicit library renames continue to take priority.
      const title = image && image.title === generatedImageTitle(assetName)
        ? image.title
        : image ? normalizeGeneratedImageTitle({ ...image, title: assetName }) : assetName;
      titleByAsset.set(assetId, title);
    }
  }

  let changed = false;
  const next = nodes.map(node => {
    if (node.metadata?.isBatchRoot) return node;
    const assetId = assetIdFromNode(node);
    const title = assetId ? titleByAsset.get(assetId) : "";
    if (!title || node.title === title) return node;
    changed = true;
    return { ...node, title };
  });
  return { nodes: changed ? next : nodes as CanvasNodeData[], pushes };
}
