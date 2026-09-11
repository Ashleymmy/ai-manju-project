import { assetIdFromNode } from "./nodes";
import type { CanvasNodeData } from "./types";
import { workspaceScopeValue } from "./workspace";
import type { WorkspaceScope } from "@/shared/config";

const GENERATED_EXACT =
  /^(provider_\d+|untitled|未命名|图片占位|新图片|图片)$/i;
const GENERATED_PREFIX = /^(screenshot|image[-_]?\d+|img[-_]?\d+)/i;

export function looksLikeGeneratedAssetName(name: string): boolean {
  const value = name.trim();
  if (!value) return true;
  const base = value.replace(/\.[a-zA-Z0-9]{1,8}$/i, "");
  return GENERATED_EXACT.test(base) || GENERATED_PREFIX.test(base) || /^[0-9a-f]{8}$/i.test(base);
}

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
      titleByAsset.set(assetId, assetName);
    }
  }

  let changed = false;
  const next = nodes.map(node => {
    const assetId = assetIdFromNode(node);
    const title = assetId ? titleByAsset.get(assetId) : "";
    if (!title || node.title === title) return node;
    changed = true;
    return { ...node, title };
  });
  return { nodes: changed ? next : nodes as CanvasNodeData[], pushes };
}
