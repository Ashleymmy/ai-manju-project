import { useRef, useState } from "react";
import { toast } from "sonner";

import {
  deleteProject,
  updateProject,
  type CanvasProject,
} from "@/entities/project";
import { publicApiError } from "@/shared/api/errors";
import type { WorkspaceScope } from "@/shared/config";
import { copyProject } from "./copyProject";

/** Shared by the archive and dashboard so card actions use the same API and confirmations. */
export function useProjectActions(
  scope: WorkspaceScope,
  onChanged: () => void
) {
  const [coverProject, setCoverProject] = useState<CanvasProject | null>(null);
  const copying = useRef(false);
  const [copyingIds, setCopyingIds] = useState<string[]>([]);

  const duplicateProjects = async (ids: string[]) => {
    if (copying.current || !ids.length) return [];
    copying.current = true;
    setCopyingIds(ids);
    const createdIds: string[] = [];
    try {
      for (const id of ids) {
        const created = await copyProject(id, scope);
        createdIds.push(created.id);
      }
      toast.success(`已复制 ${createdIds.length} 个画布`);
    } catch (error) {
      toast.error(`${createdIds.length ? `已复制 ${createdIds.length} 个画布；` : ""}${publicApiError(error, "复制画布失败")}`);
    } finally {
      copying.current = false;
      setCopyingIds([]);
      onChanged();
    }
    return createdIds;
  };

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
    copyingIds,
    duplicateProjects,
    coverProject,
    setCoverProject,
    renameProject,
    saveCover,
    deleteProjects,
  };
}
