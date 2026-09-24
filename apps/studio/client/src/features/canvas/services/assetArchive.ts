import { getAssetContentObjectUrl, getAssetFolders, updateAssetMetadata, uploadAsset } from "@/entities/asset";
import { assetDownloadFileName } from "@/entities/asset/fileName";
import { getProject } from "@/entities/project";
import type { WorkspaceScope } from "@/shared/config";
import { canvasCategoryFolder, DEFAULT_CANVAS_LIBRARY_CATEGORY, type CanvasLibraryCategory } from "../domain/assetFolders";
import { assetIdFromNode } from "../domain/nodes";
import { defaultMediaMimeType, isReadableMediaSource, mediaKindFromNode, mediaKindLabel } from "../domain/nodeUtils";
import { stringValue } from "../domain/value";
import { workspaceScopeValue } from "../domain/workspace";
import type { CanvasNodeData } from "../domain/types";
import { canvasNodeTitle } from "../domain/nodeTitles";
import { queueCanvasAssetWrite } from "./assetNames";

const browserServices = {
  getProject: (...args: Parameters<typeof getProject>) => getProject(...args),
  getAssetFolders: (...args: Parameters<typeof getAssetFolders>) => getAssetFolders(...args),
  getAssetContentObjectUrl: (...args: Parameters<typeof getAssetContentObjectUrl>) => getAssetContentObjectUrl(...args),
  updateAssetMetadata: (...args: Parameters<typeof updateAssetMetadata>) => updateAssetMetadata(...args),
  uploadAsset: (...args: Parameters<typeof uploadAsset>) => uploadAsset(...args),
  fetch: (url: string) => fetch(url),
  revokeObjectURL: (url: string) => URL.revokeObjectURL(url),
};

export async function resolveCanvasArchiveFolder(projectId: string, scope: WorkspaceScope, category: CanvasLibraryCategory = DEFAULT_CANVAS_LIBRARY_CATEGORY,
  services: Pick<typeof browserServices, "getProject" | "getAssetFolders"> = browserServices) {
  // Opening also provisions missing categories for existing canvases. Match the
  // stable project/category IDs: titles can be duplicated or renamed.
  await services.getProject(projectId, scope);
  const folders = await services.getAssetFolders(scope);
  const folder = canvasCategoryFolder(folders, projectId, category);
  if (!folder) throw new Error("当前画布的分类文件夹尚未就绪，请刷新后重试");
  return folder;
}

export async function archiveCanvasMediaAsset(input: {
  node: CanvasNodeData;
  projectId: string;
  projectTitle: string;
  scope: WorkspaceScope;
  folderId: string;
  category: CanvasLibraryCategory;
  copySharedAsset?: boolean;
}, services: Omit<typeof browserServices, "getProject" | "getAssetFolders"> = browserServices) {
  const { node, scope, folderId, category } = input;
  const kind = mediaKindFromNode(node);
  const existingAssetId = assetIdFromNode(node);
  const sourceScope = workspaceScopeValue(node.metadata?.assetScope) || scope;
  if (existingAssetId && sourceScope === scope && !input.copySharedAsset) {
    // Uploaded/generated media already have an asset ID. Reclassify the real
    // asset instead of treating it as a no-op or uploading a duplicate.
    return queueCanvasAssetWrite(`media:${scope}:${existingAssetId}`, () =>
      services.updateAssetMetadata(existingAssetId, { name: canvasNodeTitle(node.title), folder_id: folderId, category }, scope));
  }
  let objectUrl = "";
  try {
    const source = existingAssetId
      ? (objectUrl = await services.getAssetContentObjectUrl(existingAssetId, sourceScope))
      : node.imageSrc || stringValue(node.metadata?.content);
    if (!isReadableMediaSource(source)) throw new Error(`当前${mediaKindLabel(kind)}没有可读取的原始内容`);
    const response = await services.fetch(source);
    if (!response.ok) throw new Error(`读取${mediaKindLabel(kind)}失败（${response.status}）`);
    const blob = await response.blob();
    const contentType = blob.type || stringValue(node.metadata?.mimeType) || defaultMediaMimeType(kind);
    const fileName = assetDownloadFileName({ name: node.title, type: kind, content_type: contentType });
    return await services.uploadAsset(new File([blob], fileName, { type: contentType }), {
      type: kind, name: canvasNodeTitle(node.title), folder_id: folderId, category,
      source_type: "canvas", source_project_id: input.projectId, source_project_name: input.projectTitle,
      source_node_id: node.id,
      source_metadata: JSON.stringify({ node_id: node.id, operation: input.copySharedAsset ? "shared_asset_copy" : existingAssetId ? "cross_scope_copy" : "archive" }),
    }, scope);
  } finally {
    if (objectUrl) services.revokeObjectURL(objectUrl);
  }
}
