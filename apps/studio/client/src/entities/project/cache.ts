import type { QueryClient } from "@tanstack/react-query";

import type { WorkspaceScope } from "@/shared/config";

import type { CanvasProject, CanvasSnapshotResponse } from "./model";
import { projectQueryKeys } from "./queries";

export function invalidateProjectList(
  queryClient: QueryClient,
  scope: WorkspaceScope
) {
  return queryClient.invalidateQueries({
    queryKey: projectQueryKeys.list(scope),
  });
}

export function setProjectCache(
  queryClient: QueryClient,
  scope: WorkspaceScope,
  project: CanvasProject
) {
  queryClient.setQueryData(projectQueryKeys.detail(scope, project.id), project);
}

export function setProjectSnapshotCache(
  queryClient: QueryClient,
  scope: WorkspaceScope,
  projectId: string,
  snapshot: CanvasSnapshotResponse
) {
  queryClient.setQueryData(
    projectQueryKeys.snapshot(scope, projectId),
    snapshot
  );
}
