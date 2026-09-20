import { useState } from "react";
import { toast } from "sonner";

import {
  deleteProject,
  updateProject,
  type CanvasProject,
} from "@/entities/project";
import { publicApiError } from "@/shared/api/errors";
import type { WorkspaceScope } from "@/shared/config";

/** Shared by the archive and dashboard so card actions use the same API and confirmations. */
export function useProjectActions(
  scope: WorkspaceScope,
  onChanged: () => void
) {
  const [coverProject, setCoverProject] = useState<CanvasProject | null>(null);

  const renameProject = async (project: CanvasProject) => {
    const title = window.prompt("项目名称", project.title)?.trim();
    if (!title || title === project.title) return;
    try {
      await updateProject(project.id, { title, scope });
      toast.success("项目已重命名");
      onChanged();
    } catch (error) {
      toast.error(publicApiError(error, "重命名项目失败"));
    }
  };

  const saveCover = async (assetId: string) => {
    if (!coverProject) return;
    try {
      await updateProject(coverProject.id, { cover_asset_id: assetId, scope });
      toast.success(assetId ? "封面已更新" : "已恢复默认封面");
      setCoverProject(null);
      onChanged();
    } catch (error) {
      toast.error(publicApiError(error, "设置封面失败"));
    }
  };

  const deleteProjects = async (ids: string[]) => {
    if (
      !ids.length ||
      !window.confirm(`删除 ${ids.length} 个画布项目及其快照？此操作不可恢复。`)
    ) {
      return false;
    }
    let failed = 0;
    for (const id of ids) {
      try {
        await deleteProject(id, scope);
      } catch {
        failed += 1;
      }
    }
    toast[failed ? "warning" : "success"](
      failed ? `删除完成，${failed} 个失败` : `已删除 ${ids.length} 个项目`
    );
    onChanged();
    return true;
  };

  return {
    coverProject,
    setCoverProject,
    renameProject,
    saveCover,
    deleteProjects,
  };
}
