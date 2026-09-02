import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { publicApiError } from "@/shared/api/errors";

import { adminQueryKeys } from "../model/queryKeys";
import { fetchAdminMonitoring } from "../services/adminApi";

export const ADMIN_MONITORING_REFRESH_INTERVAL_MS = 15_000;

export function useMonitoringController(active: boolean) {
  const queryClient = useQueryClient();
  const [hours, setHours] = useState(24);
  const [refreshing, setRefreshing] = useState(false);
  const monitoringQuery = useQuery({
    queryKey: adminQueryKeys.monitoring(hours),
    queryFn: () => fetchAdminMonitoring(hours),
    placeholderData: previous => previous,
    refetchInterval: active ? ADMIN_MONITORING_REFRESH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  });

  const refresh = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      try {
        const next = await fetchAdminMonitoring(hours);
        queryClient.setQueryData(adminQueryKeys.monitoring(hours), next);
      } catch (error) {
        if (!silent) {
          toast.error(publicApiError(error, "监控数据加载失败"));
        }
      } finally {
        if (silent) setRefreshing(false);
      }
    },
    [hours, queryClient]
  );

  useEffect(() => {
    if (!active) return;
    void refresh(true);
    const tick = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    document.addEventListener("visibilitychange", tick);
    return () => document.removeEventListener("visibilitychange", tick);
  }, [active, refresh]);

  const monitoring = monitoringQuery.data || null;
  const summary = monitoring?.summary;
  const successRate = summary?.total_requests
    ? (summary.success_requests / summary.total_requests) * 100
    : 100;
  const errorRate = summary?.total_requests
    ? (summary.error_requests / summary.total_requests) * 100
    : 0;
  const averageDuration = summary?.total_requests
    ? summary.total_duration_ms / summary.total_requests
    : 0;
  const latestErrors = useMemo(
    () =>
      (monitoring?.recent || [])
        .filter(item => item.status === "error")
        .slice(0, 6),
    [monitoring]
  );

  const reload = useCallback(async () => {
    await monitoringQuery.refetch();
  }, [monitoringQuery]);

  return {
    averageDuration,
    errorRate,
    hours,
    isPending: monitoringQuery.isPending,
    latestErrors,
    monitoring,
    refresh,
    refreshing: refreshing || monitoringQuery.isFetching,
    reload,
    setHours,
    successRate,
    summary,
  };
}

export type MonitoringController = ReturnType<typeof useMonitoringController>;
