import { useQuery } from "@tanstack/react-query";

import { getAssetLibrary } from "@/entities/asset";
import { listComicProjects } from "@/entities/comic";
import { getJobs } from "@/entities/job";
import { getProjects } from "@/entities/project";
import { getCollection } from "@/shared/api/http";

type SourceState = "idle" | "loading" | "ready" | "error";
type Metric = { total?: number; state: SourceState; error?: string };
export type WorkspaceData = {
  projects: Metric;
  comicProjects: Metric;
  jobs: Metric;
  assets: Metric;
};

const loadingData: WorkspaceData = {
  projects: { state: "loading" },
  comicProjects: { state: "loading" },
  jobs: { state: "loading" },
  assets: { state: "loading" },
};

function metricFrom(value: unknown): Metric {
  const collection = getCollection(value);
  return {
    state: "ready",
    total: collection.total ?? collection.items.length,
  };
}

function metricError(error: unknown): Metric {
  return {
    state: "error",
    error: error instanceof Error && error.message ? error.message : "请求失败",
  };
}

async function loadWorkspaceData(): Promise<WorkspaceData> {
  const [projects, comicProjects, jobs, assets] = await Promise.allSettled([
    getProjects("personal"),
    listComicProjects("personal"),
    getJobs({ status: "running", page: 1, pageSize: 50 }),
    getAssetLibrary(),
  ]);
  return {
    projects:
      projects.status === "fulfilled"
        ? metricFrom(projects.value)
        : metricError(projects.reason),
    comicProjects:
      comicProjects.status === "fulfilled"
        ? metricFrom(comicProjects.value)
        : metricError(comicProjects.reason),
    jobs:
      jobs.status === "fulfilled"
        ? metricFrom(jobs.value)
        : metricError(jobs.reason),
    assets:
      assets.status === "fulfilled"
        ? metricFrom(assets.value)
        : metricError(assets.reason),
  };
}

export const dashboardQueryKeys = {
  workspace: () => ["dashboard", "workspace", "personal"] as const,
};

export function useWorkspaceDashboardData() {
  const query = useQuery({
    queryKey: dashboardQueryKeys.workspace(),
    queryFn: loadWorkspaceData,
  });
  return {
    data: query.isFetching ? loadingData : query.data ?? loadingData,
    loading: query.isFetching,
    refresh: query.refetch,
  };
}
