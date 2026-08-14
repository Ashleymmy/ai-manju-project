import { request } from "./request";

export type WorkspaceScope = "personal" | "team";
export type CanvasProject = { id: string; title: string; owner_id: string; workspace_id?: string; scope?: WorkspaceScope; data?: unknown; created_at: string; updated_at: string };

export function getProjects(scope: WorkspaceScope = "personal") { return request<CanvasProject[] | { items: CanvasProject[]; total: number }>("/api/projects", { query: { scope } }); }
export function createProject(payload: Pick<CanvasProject, "title"> & { scope?: WorkspaceScope; data?: unknown }) { return request<CanvasProject>("/api/projects", { method: "POST", body: payload }); }
export function getProject(id: string) { return request<CanvasProject>(`/api/projects/${id}`); }
export function updateProject(id: string, payload: Partial<CanvasProject>) { return request<CanvasProject>(`/api/projects/${id}`, { method: "PUT", body: payload }); }
export function deleteProject(id: string) { return request<void>(`/api/projects/${id}`, { method: "DELETE" }); }
export function getProjectSnapshot(id: string) { return request<unknown>(`/api/projects/${id}/snapshot`); }
export function saveProjectSnapshot(id: string, data: unknown) { return request<unknown>(`/api/projects/${id}/snapshot`, { method: "PUT", body: data }); }

export function getComicProjects(scope: WorkspaceScope = "personal") { return request<unknown>("/api/comic-asset-projects", { query: { scope } }); }
