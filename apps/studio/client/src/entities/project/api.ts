import type { CanvasProject, CanvasSnapshotResponse } from "./model";
import { request } from "@/shared/api/http";
import type { WorkspaceScope } from "@/shared/config";

export type { WorkspaceScope } from "@/shared/config";

export function getProjects(scope: WorkspaceScope = "personal") {
  return request<CanvasProject[] | { items: CanvasProject[]; total: number }>(
    "/api/projects",
    { query: { scope } }
  );
}
export function createProject(
  payload: Pick<CanvasProject, "title"> & {
    scope?: WorkspaceScope;
    data?: unknown;
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
