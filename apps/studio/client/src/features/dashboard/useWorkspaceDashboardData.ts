import { useQuery } from "@tanstack/react-query";

import { getAssetLibrary } from "@/entities/asset";
import { listComicProjects } from "@/entities/comic";
import { getJobs } from "@/entities/job";
import { useProjectSummaries } from "@/entities/project";
import { useAuth } from "@/contexts/AuthContext";
import { getCollection } from "@/shared/api/http";

type SourceState = "idle" | "loading" | "ready" | "error";
type Metric = { total?: number; state: SourceState; error?: string };
export type WorkspaceData = {
  projects: Metric;
  comicProjects: Metric;
  jobs: Metric;
  assets: Metric;
};

type OtherWorkspaceData = Omit<WorkspaceData, "projects">;
const loadingData: OtherWorkspaceData = {
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

async function loadWorkspaceData(): Promise<OtherWorkspaceData> {
  const [comicProjects, jobs, assets] = await Promise.allSettled([
    listComicProjects("personal"),
    getJobs({ status: "running", page: 1, pageSize: 50 }),
    getAssetLibrary(),
  ]);
  return {
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
  workspace: (userId: string) => ["dashboard", "workspace", "personal", userId] as const,
};

export function useWorkspaceDashboardData() {
  const { user } = useAuth();
  // Shared with project cards and the canvas switcher; other metrics cannot delay this count.
  const projects = useProjectSummaries("personal", user?.id || "");
  const query = useQuery({
    queryKey: dashboardQueryKeys.workspace(user?.id || ""),
    queryFn: loadWorkspaceData,
    enabled: Boolean(user),
  });
  const projectMetric: Metric = {
    total: projects.hasLoaded ? projects.projects.length : undefined,
    state: projects.loading ? "loading" : projects.error ? "error" : "ready",
    error: projects.error || undefined,
  };
  return {
    data: { ...(query.data ?? loadingData), projects: projectMetric },
    loading: query.isFetching || projects.refreshing,
    refresh: () => Promise.all([query.refetch(), projects.refresh()]),
  };
}
