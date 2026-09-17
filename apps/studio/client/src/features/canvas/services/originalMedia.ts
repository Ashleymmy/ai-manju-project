import { getAssetContentBlob } from "@/entities/asset";
import type { WorkspaceScope } from "@/shared/config";
import { assetIdFromNode, imageSrcFromNode } from "../domain/nodes";
import type { CanvasNodeData } from "../domain/types";
import { workspaceScopeValue } from "../domain/workspace";

/** Download stored bytes unchanged; display previews must never be a download fallback. */
export async function downloadCanvasOriginalMedia(node: CanvasNodeData, scope: WorkspaceScope | null): Promise<Blob> {
  const assetId = assetIdFromNode(node);
  if (assetId) {
    const sourceScope = workspaceScopeValue(node.metadata?.assetScope) || scope;
    if (!sourceScope) throw new Error("正在确认项目工作区，暂不能下载原文件");
    return getAssetContentBlob(assetId, sourceScope);
  }
  const source = imageSrcFromNode(node, {});
  if (!source) throw new Error("当前节点没有可下载的原文件");
  const response = await fetch(source);
  if (!response.ok) throw new Error(`读取原文件失败（${response.status}）`);
  return response.blob();
}
