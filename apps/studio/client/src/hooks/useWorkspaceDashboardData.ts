import { useCallback, useEffect, useState } from "react";
import { getAssetLibrary, getCollection, getComicProjects, getJobs, getProjects, type ApiError } from "@/services/api";

type SourceState = "idle" | "loading" | "ready" | "error";
type Metric = { total?: number; state: SourceState; error?: string };
export type WorkspaceData = { projects: Metric; comicProjects: Metric; jobs: Metric; assets: Metric };

const emptyMetric: Metric = { state: "idle" };
const initialData: WorkspaceData = { projects: emptyMetric, comicProjects: emptyMetric, jobs: emptyMetric, assets: emptyMetric };

function metricFrom(value: unknown): Metric { const collection = getCollection(value); return { state: "ready", total: collection.total ?? collection.items.length }; }
function metricError(error: unknown): Metric { return { state: "error", error: (error as ApiError)?.message || "请求失败" }; }

export function useWorkspaceDashboardData() {
  const [data, setData] = useState<WorkspaceData>(initialData);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setData({ projects: { state: "loading" }, comicProjects: { state: "loading" }, jobs: { state: "loading" }, assets: { state: "loading" } });
    const [projects, comicProjects, jobs, assets] = await Promise.allSettled([
      getProjects("personal"), getComicProjects("personal"), getJobs({ status: "running", page: 1, pageSize: 50 }), getAssetLibrary(),
    ]);
    setData({
      projects: projects.status === "fulfilled" ? metricFrom(projects.value) : metricError(projects.reason),
      comicProjects: comicProjects.status === "fulfilled" ? metricFrom(comicProjects.value) : metricError(comicProjects.reason),
      jobs: jobs.status === "fulfilled" ? metricFrom(jobs.value) : metricError(jobs.reason),
      assets: assets.status === "fulfilled" ? metricFrom(assets.value) : metricError(assets.reason),
    });
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  return { data, loading, refresh };
}
