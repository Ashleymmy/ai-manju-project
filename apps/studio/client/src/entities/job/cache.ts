import type { QueryClient } from "@tanstack/react-query";

import type { WorkspaceScope } from "@/shared/config";

import type { Job } from "./model";
import { jobQueryKeys } from "./queries";

export function setJobCache(queryClient: QueryClient, job: Job) {
  queryClient.setQueryData(jobQueryKeys.detail(job.id), job);
}

export function invalidateJobLists(
  queryClient: QueryClient,
  scope: WorkspaceScope
) {
  return queryClient.invalidateQueries({
    queryKey: jobQueryKeys.listScope(scope),
  });
}
