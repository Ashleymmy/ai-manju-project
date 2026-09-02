import type { WorkspaceScope } from "@/shared/config/workspace";

export function isWorkspaceScope(value: unknown): value is WorkspaceScope {
  return value === "personal" || value === "team";
}

export function workspaceScopeValue(
  value: unknown
): WorkspaceScope | undefined {
  return isWorkspaceScope(value) ? value : undefined;
}

export function scopeFromCanvasSearch(search: string): WorkspaceScope {
  return new URLSearchParams(search.replace(/^\?/, "")).get("scope") === "team"
    ? "team"
    : "personal";
}

export function canvasProjectHref(
  projectId: string,
  scope: WorkspaceScope
) {
  return `/canvas/${encodeURIComponent(projectId)}?scope=${encodeURIComponent(scope)}`;
}

export function canvasListHref(scope: WorkspaceScope) {
  return `/canvas?scope=${encodeURIComponent(scope)}`;
}

export function projectScopeFromServer(
  project: { scope?: unknown } | null | undefined,
  fallback: WorkspaceScope
) {
  return isWorkspaceScope(project?.scope) ? project.scope : fallback;
}
