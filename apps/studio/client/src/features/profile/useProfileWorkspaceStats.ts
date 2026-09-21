import { useQuery } from "@tanstack/react-query";

import { getAssetLibrary } from "@/entities/asset";
import { getJobs } from "@/entities/job";
import { getProjects } from "@/entities/project";
import { getCollection } from "@/shared/api/http";

/**
 * 个人主页统计（项目/资产/任务计数）。
 * 放在 controller 层而非页面组件里——渲染模块不允许直接接触 HTTP transport。
 * 直接走 entities 层 API，不依赖 features/dashboard，避免
 * member → profile → dashboard → member 依赖环。
 */
export function useProfileWorkspaceStats() {
  const query = useQuery({
    queryKey: ["profile", "workspace-stats"],
    queryFn: async () => {
      const [projects, jobs, assets] = await Promise.allSettled([
        getProjects("personal"),
        getJobs({ status: "running", page: 1, pageSize: 50 }),
        getAssetLibrary(),
      ]);
      const totalOf = (result: PromiseSettledResult<unknown>) => {
        if (result.status !== "fulfilled") return undefined;
        const collection = getCollection(result.value);
        return collection.total ?? collection.items.length;
      };
      return { projects: totalOf(projects), jobs: totalOf(jobs), assets: totalOf(assets) };
    },
  });
  return query.data ?? { projects: undefined, jobs: undefined, assets: undefined };
}
