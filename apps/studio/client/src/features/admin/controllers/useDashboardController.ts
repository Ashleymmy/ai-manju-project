import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import { adminQueryKeys } from "../model/queryKeys";
import { fetchAdminBillingDashboard } from "../services/adminMemberApi";

/** 模块6 运营看板控制器：7 项核心指标（GMV 金额一律 cents，面板 formatCents）。 */
export function useDashboardController(active: boolean) {
  const dashboardQuery = useQuery({
    queryKey: adminQueryKeys.billingDashboard(),
    queryFn: fetchAdminBillingDashboard,
    placeholderData: previous => previous,
    enabled: active,
  });

  const reload = useCallback(async () => {
    if (!active) return;
    await dashboardQuery.refetch();
  }, [active, dashboardQuery]);

  return {
    dashboard: dashboardQuery.data ?? null,
    isError: active && dashboardQuery.isError,
    isPending: active && dashboardQuery.isPending,
    reload,
  };
}

export type DashboardController = ReturnType<typeof useDashboardController>;
