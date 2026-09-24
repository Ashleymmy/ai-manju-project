import { getProjectSnapshot, type CanvasProjectSummary } from "@/entities/project";
import type { WorkspaceScope } from "@/shared/config";

/** List summaries cannot substitute for the full canvas in an export. */
export async function readProjectExport(project: CanvasProjectSummary, scope: WorkspaceScope) {
  const snapshot = await getProjectSnapshot(project.id, scope);
  const data = snapshot?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`画布“${project.title}”的完整数据不可用，未导出`);
  }
  return { project: { ...project, data }, snapshot: data, exportedAt: new Date().toISOString() };
}
