import type { WorkspaceScope } from "@/shared/config";

export const comicQueryKeys = {
  all: ["comic"] as const,
  projects: (scope: WorkspaceScope) =>
    [...comicQueryKeys.all, "projects", scope] as const,
  projectDetails: (scope: WorkspaceScope) =>
    [...comicQueryKeys.all, "project", scope] as const,
  project: (scope: WorkspaceScope, projectId: string) =>
    [...comicQueryKeys.projectDetails(scope), projectId] as const,
  analysisSessions: (scope: WorkspaceScope) =>
    [...comicQueryKeys.all, "analysis-session", scope] as const,
  analysisSession: (scope: WorkspaceScope, sessionId: string) =>
    [...comicQueryKeys.analysisSessions(scope), sessionId] as const,
  batchLists: (scope: WorkspaceScope) =>
    [...comicQueryKeys.all, "batches", scope] as const,
  batches: (scope: WorkspaceScope, projectId: string) =>
    [...comicQueryKeys.batchLists(scope), projectId] as const,
  batchDetails: (scope: WorkspaceScope) =>
    [...comicQueryKeys.all, "batch", scope] as const,
  batch: (scope: WorkspaceScope, batchId: string) =>
    [...comicQueryKeys.batchDetails(scope), batchId] as const,
};
