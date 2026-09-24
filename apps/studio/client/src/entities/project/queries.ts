import type { WorkspaceScope } from "@/shared/config";

export const projectQueryKeys = {
  all: ["projects"] as const,
  lists: () => [...projectQueryKeys.all, "list"] as const,
  list: (scope: WorkspaceScope) =>
    [...projectQueryKeys.lists(), scope] as const,
  summaries: (scope: WorkspaceScope, userId: string) =>
    [...projectQueryKeys.list(scope), "summaries", userId] as const,
  detail: (scope: WorkspaceScope, projectId: string) =>
    [...projectQueryKeys.all, "detail", scope, projectId] as const,
  snapshot: (scope: WorkspaceScope, projectId: string) =>
    [...projectQueryKeys.all, "snapshot", scope, projectId] as const,
};
