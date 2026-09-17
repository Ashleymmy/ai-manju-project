import { isDateArchiveFolder, visibleAssetLibraryFolders, type AssetFolder } from "@/entities/asset";

/** Stable backend category identities for a canvas's linked library. */
export const CANVAS_LIBRARY_CATEGORIES = [
  { value: "character", label: "角色" },
  { value: "environment", label: "场景" },
  { value: "prop", label: "道具" },
  { value: "other", label: "其他" },
] as const;
export type CanvasLibraryCategory = typeof CANVAS_LIBRARY_CATEGORIES[number]["value"];
export const DEFAULT_CANVAS_LIBRARY_CATEGORY: CanvasLibraryCategory = "other";

export function canvasCategoryFolder(folders: readonly AssetFolder[], projectId: string, category: CanvasLibraryCategory) {
  const project = folders.find(folder => folder.system_key === "canvas_project" && folder.source_ref_id === projectId);
  return project && folders.find(folder => folder.parent_id === project.id
    && folder.system_key === "canvas_category" && folder.source_ref_id === `${projectId}:${category}`);
}

export const isCanvasDateArchiveFolder = isDateArchiveFolder;
export const visibleCanvasAssetFolders = visibleAssetLibraryFolders;
