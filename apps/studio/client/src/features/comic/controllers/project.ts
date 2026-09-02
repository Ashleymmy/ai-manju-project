import {
  createComicProject,
  deleteComicProject,
  downloadComicProjectSource,
  getComicProject,
  updateComicProject,
  type ComicAssetProject,
} from "@/entities/comic";
import type { WorkspaceScope } from "@/shared/config";

import {
  comicProjectInput,
  comicProjectSourceName,
  type ComicProjectDraft,
} from "../model/workflow";

export function createEmptyComicProject(
  draft: ComicProjectDraft,
  scope: WorkspaceScope
) {
  return createComicProject(comicProjectInput(draft), scope);
}

export function loadComicProject(projectId: string, scope: WorkspaceScope) {
  return getComicProject(projectId, scope);
}

export function renameComicProject(
  projectId: string,
  title: string,
  scope: WorkspaceScope
) {
  return updateComicProject(projectId, { title }, scope);
}

export function removeComicProject(
  projectId: string,
  scope: WorkspaceScope
) {
  return deleteComicProject(projectId, scope);
}

export async function downloadComicSource(
  project: ComicAssetProject,
  scope: WorkspaceScope
) {
  const result = await downloadComicProjectSource(project.id, scope);
  return {
    blob: result.blob,
    fileName: result.fileName || comicProjectSourceName(project),
  };
}
