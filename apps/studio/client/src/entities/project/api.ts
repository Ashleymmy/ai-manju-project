import type { CanvasProject, CanvasSnapshotResponse } from "./model";
import { projectSummary } from "./model";
import { request } from "@/shared/api/http";
import type { WorkspaceScope } from "@/shared/config";

export type { WorkspaceScope } from "@/shared/config";

export function getProjects(scope: WorkspaceScope = "personal") {
  return request<CanvasProject[] | { items: CanvasProject[]; total: number }>(
    "/api/projects",
    { query: { scope } }
  );
}

export async function getProjectSummaries(scope: WorkspaceScope = "personal", signal?: AbortSignal) {
  const result = await request<CanvasProject[] | { items: CanvasProject[]; total: number }>(
    "/api/projects", { query: { scope, include_data: false }, signal },
  );
  const items = Array.isArray(result) ? result : result?.items;
  // A broken response must not masquerade as an empty workspace.
  if (!Array.isArray(items) || items.some(item => !item || typeof item.id !== "string" || typeof item.title !== "string")) {
    throw new Error("画布列表返回异常，请重试");
  }
  // Older servers can ignore include_data; never cache their full snapshots here.
  return items.map(projectSummary);
}
export function createProject(
  payload: Pick<CanvasProject, "title"> & {
    scope?: WorkspaceScope;
    data?: unknown;
    cover_asset_id?: string;
  }
) {
  const { scope = "personal", ...body } = payload;
  return request<CanvasProject>("/api/projects", {
    method: "POST",
    query: { scope },
    body,
  });
}
export function getProject(id: string, scope: WorkspaceScope = "personal") {
  return request<CanvasProject>(`/api/projects/${encodeURIComponent(id)}`, {
    query: { scope },
  });
}
export function updateProject(
  id: string,
  payload: Partial<CanvasProject> & { scope?: WorkspaceScope }
) {
  const { scope = "personal", ...body } = payload;
  return request<CanvasProject>(`/api/projects/${encodeURIComponent(id)}`, {
    method: "PUT",
    query: { scope },
    body,
  });
}
export function deleteProject(id: string, scope: WorkspaceScope = "personal") {
  return request<void>(`/api/projects/${encodeURIComponent(id)}`, {
    method: "DELETE",
    query: { scope },
  });
}
export function getProjectSnapshot(
  id: string,
  scope: WorkspaceScope = "personal"
) {
  return request<CanvasSnapshotResponse>(
    `/api/projects/${encodeURIComponent(id)}/snapshot`,
    { query: { scope } }
  );
}
export function saveProjectSnapshot(
  id: string,
  data: unknown,
  scope: WorkspaceScope = "personal"
) {
  return request<CanvasSnapshotResponse>(
    `/api/projects/${encodeURIComponent(id)}/snapshot`,
    { method: "PUT", query: { scope }, body: { data } }
  );
}
