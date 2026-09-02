import type { QueryClient } from "@tanstack/react-query";

import type { WorkspaceScope } from "@/shared/config";

import { comicQueryKeys } from "./queries";

export function invalidateComicProjects(
  queryClient: QueryClient,
  scope: WorkspaceScope
) {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: comicQueryKeys.projects(scope),
    }),
    queryClient.invalidateQueries({
      queryKey: comicQueryKeys.projectDetails(scope),
    }),
    queryClient.invalidateQueries({
      queryKey: comicQueryKeys.analysisSessions(scope),
    }),
    queryClient.invalidateQueries({
      queryKey: comicQueryKeys.batchLists(scope),
    }),
    queryClient.invalidateQueries({
      queryKey: comicQueryKeys.batchDetails(scope),
    }),
  ]);
}
