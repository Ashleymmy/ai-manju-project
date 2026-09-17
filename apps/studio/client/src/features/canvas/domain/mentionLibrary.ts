import type { AssetFolder } from "@/entities/asset";
import type { WorkspaceScope } from "@/shared/config";
import { visibleCanvasAssetFolders } from "./assetFolders";
import { filterCanvasMentionReferences, type CanvasMentionReference } from "./mentions";

/** Virtual views never become API folder IDs. Only folder:<server ID> does. */
export type CanvasMentionLibraryTarget = "root" | "favorites" | `folder:${string}`;
export type CanvasMentionLibraryState = {
  projectId: string;
  scope: WorkspaceScope;
  folders: AssetFolder[];
  target: CanvasMentionLibraryTarget;
  query: string;
  assetIds: string[];
  loading: boolean;
  error: string;
  page: number;
  hasMore: boolean;
};
export type CanvasMentionLibraryItem =
  | { kind: "reference"; id: string; reference: CanvasMentionReference }
  | { kind: "folder"; id: string; label: string; target: CanvasMentionLibraryTarget; currentProject?: boolean };

/** Shared request defaults for the mention browser. */
export const CANVAS_MENTION_PAGE_SIZE = 100;
export const CANVAS_MENTION_SEARCH_DELAY_MS = 240;

export function emptyCanvasMentionLibrary(projectId = "", scope: WorkspaceScope = "personal"): CanvasMentionLibraryState {
  return { projectId, scope, folders: [], target: "root", query: "", assetIds: [], loading: false, error: "", page: 0, hasMore: false };
}

export function mentionLibraryFolderId(target: CanvasMentionLibraryTarget) {
  return target.startsWith("folder:") ? target.slice("folder:".length) : undefined;
}

export function mentionLibraryTargetLabel(target: CanvasMentionLibraryTarget, folders: readonly AssetFolder[]) {
  if (target === "favorites") return "收藏夹";
  return folders.find(folder => folder.id === mentionLibraryFolderId(target))?.name || "资产库";
}

export function buildCanvasMentionLibraryMenu(
  references: readonly CanvasMentionReference[],
  query: string,
  target: CanvasMentionLibraryTarget,
  library: CanvasMentionLibraryState,
): CanvasMentionLibraryItem[] {
  const nodes: CanvasMentionLibraryItem[] = filterCanvasMentionReferences(references, query)
    .filter(ref => ref.group === "canvas-node" && ref.upstreamDistance !== undefined)
    .sort((a, b) => a.upstreamDistance! - b.upstreamDistance!)
    .map(reference => ({ kind: "reference", id: reference.id, reference }));
  const visibleFolders = visibleCanvasAssetFolders(library.folders);
  const projectFolder = visibleFolders.find(folder => folder.system_key === "canvas_project" && folder.source_ref_id === library.projectId);
  const folderItem = (folder: AssetFolder): CanvasMentionLibraryItem => ({
    kind: "folder", id: `folder:${folder.id}`, target: `folder:${folder.id}`, label: folder.name,
    currentProject: folder.id === projectFolder?.id,
  });
  let folders: CanvasMentionLibraryItem[] = [];
  if (target === "root") {
    // Show archive categories directly after favorites, followed by user roots.
    const libraryRoots = visibleFolders
      .filter(folder => !folder.parent_id && folder.id !== projectFolder?.id)
      .sort((a, b) => Number(b.kind === "system") - Number(a.kind === "system")
        || a.sort_order - b.sort_order || a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
    folders = [
      ...(projectFolder ? [folderItem(projectFolder)] : []),
      { kind: "folder", id: "favorites", target: "favorites", label: "收藏夹" },
      ...libraryRoots.map(folderItem),
    ];
  } else if (target !== "favorites") {
    const parentId = mentionLibraryFolderId(target) || "";
    const keyword = query.trim().toLowerCase();
    folders = visibleFolders
      .filter(folder => folder.parent_id === parentId && folder.id !== projectFolder?.id)
      .filter(folder => !keyword || folder.name.toLowerCase().includes(keyword))
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "zh-CN", { numeric: true }))
      .map(folderItem);
  }
  // The reference cache also resolves saved chips. Only this response's IDs may
  // appear in a folder/favorites view; earlier searches must not leak into it.
  const ready = library.target === target && library.query === query.trim();
  const showAssets = target !== "root" || Boolean(query.trim());
  const byId = new Map(references.filter(ref => ref.group === "asset-library" && ref.assetScope === library.scope).map(ref => [ref.assetId, ref]));
  const assets: CanvasMentionLibraryItem[] = ready && showAssets
    ? library.assetIds.flatMap(id => {
      const reference = byId.get(id);
      return reference ? [{ kind: "reference" as const, id: reference.id, reference }] : [];
    }) : [];
  return [...nodes, ...folders, ...assets];
}
