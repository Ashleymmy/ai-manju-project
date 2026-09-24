import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/shared/api/http";
import type { WorkspaceScope } from "@/shared/config";
import { getProjectSummaries } from "./api";
import { projectSummary, type CanvasProject, type CanvasProjectSummary } from "./model";
import { projectQueryKeys } from "./queries";

// Briefly retry transient failures; permission errors require the user to sign in again.
const PROJECT_LIST_RETRY_COUNT = 1;
const PROJECT_LIST_RETRY_DELAY_MS = 500;
const EMPTY_PROJECTS: CanvasProjectSummary[] = [];

/** Only a successful detail request for the current account/space can supply this fallback. */
export type VerifiedProjectSummary = { project: CanvasProjectSummary; scope: WorkspaceScope; userId: string };

export function useProjectSummaries(scope: WorkspaceScope, userId: string, verified?: VerifiedProjectSummary | null) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: projectQueryKeys.summaries(scope, userId),
    queryFn: ({ signal }) => getProjectSummaries(scope, signal),
    enabled: Boolean(userId),
    retry: (count, error) => count < PROJECT_LIST_RETRY_COUNT
      && error instanceof ApiError && (error.status === 0 || error.status >= 500),
    retryDelay: PROJECT_LIST_RETRY_DELAY_MS,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
  const setProjects = useCallback(async (update: (items: CanvasProjectSummary[]) => CanvasProject[]) => {
    const key = projectQueryKeys.summaries(scope, userId);
    // A list request started before a rename/create/delete must not undo that change.
    await client.cancelQueries({ queryKey: key });
    client.setQueryData<CanvasProjectSummary[]>(key, items => update(items ?? []).map(projectSummary));
    void client.invalidateQueries({ queryKey: projectQueryKeys.list(scope) });
  }, [client, scope, userId]);

  const listedProjects = query.data ?? EMPTY_PROJECTS;
  const currentProject = verified?.userId === userId && verified.scope === scope ? verified.project : undefined;
  const currentMissing = Boolean(currentProject && !listedProjects.some(item => item.id === currentProject.id));
  // Keep verified metadata separate from list cache: it must not mark a failed or
  // incomplete list request successful, nor become a source of editable snapshots.
  const projects = useMemo(() => currentProject && currentMissing
    ? [projectSummary(currentProject), ...listedProjects]
    : listedProjects, [currentProject, currentMissing, listedProjects]);
  const incomplete = query.isSuccess && currentMissing;

  return {
    projects,
    loading: query.isPending,
    refreshing: query.isFetching,
    error: query.isError ? "画布列表加载失败，请重试。" : "",
    warning: incomplete ? "列表暂不完整，已保留当前画布，请刷新重试。" : "",
    hasCachedList: Boolean(query.data?.length),
    hasLoaded: query.data !== undefined,
    refresh: query.refetch,
    setProjects,
  };
}
