import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  getMonitoringUsers,
  getRuntimeMonitoring,
  MONITORING_HOUR_MS,
  MONITORING_PAGE_SIZE,
  MONITORING_REFRESH_MS,
  type MonitoringFilters,
} from "../services/runtimeMonitoringApi";

export const ADMIN_MONITORING_REFRESH_INTERVAL_MS = MONITORING_REFRESH_MS;
const windowFor = (hours: number) => ({
  start: new Date(Date.now() - hours * MONITORING_HOUR_MS).toISOString(),
  end: new Date().toISOString(),
});

export function useMonitoringController(active: boolean) {
  const { user } = useAuth();
  const canViewAll = user?.role === "super_admin";
  const [hours, setHoursValue] = useState(24);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filters, setFilters] = useState<MonitoringFilters>(() => ({
    ...windowFor(24),
    user_id: "",
    source: "",
    status: "error",
    code: "",
    model: "",
    q: "",
    page: 1,
    page_size: MONITORING_PAGE_SIZE,
  }));
  const scopedFilters = {
    ...filters,
    user_id: canViewAll ? filters.user_id : user?.id || "",
  };
  const query = useQuery({
    queryKey: [
      "runtime-monitoring",
      user?.id,
      user?.role,
      scopedFilters,
      hours,
    ],
    queryFn: ({ signal }) => getRuntimeMonitoring(scopedFilters, signal),
    enabled: active && !!user,
    // Never reuse a previous scope's results while another account is loading.
    placeholderData: (previous, previousQuery) => {
      const key = previousQuery?.queryKey;
      const prior = key?.[3] as MonitoringFilters | undefined;
      if (
        key?.[1] !== user?.id ||
        key?.[2] !== user?.role ||
        key?.[4] !== hours ||
        !prior
      )
        return undefined;
      const { start: _start, end: _end, ...oldScope } = prior;
      const { start: _nextStart, end: _nextEnd, ...newScope } = scopedFilters;
      return JSON.stringify(oldScope) === JSON.stringify(newScope)
        ? previous
        : undefined;
    },
  });
  useEffect(() => {
    if (!active || !autoRefresh || filters.page !== 1 || hours === 0) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible")
        setFilters(current => ({ ...current, ...windowFor(hours) }));
    }, MONITORING_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [active, autoRefresh, filters.page, hours]);
  const users = useQuery({
    queryKey: ["monitoring-users", user?.id, user?.role],
    queryFn: ({ signal }) => getMonitoringUsers(signal),
    enabled: active && canViewAll,
  });
  const updateFilters = (changes: Partial<MonitoringFilters>) =>
    setFilters(current => ({ ...current, ...changes, page: 1 }));
  const refresh = async () => {
    if (hours === 0) {
      await query.refetch();
      return;
    }
    setFilters(current => ({ ...current, ...windowFor(hours), page: 1 }));
  };
  const setHours = (value: number) => {
    setHoursValue(value);
    if (value > 0) updateFilters(windowFor(value));
  };
  return {
    monitoring: query.data || null,
    isPending: active && query.isPending,
    error: query.error,
    refreshing: query.isFetching,
    refresh,
    reload: refresh,
    filters: scopedFilters,
    updateFilters,
    setPage: (page: number) => setFilters(current => ({ ...current, page })),
    hours,
    setHours,
    autoRefresh,
    setAutoRefresh,
    canViewAll,
    users: users.data || [],
    usersError: users.error,
    reloadUsers: users.refetch,
  };
}
export type MonitoringController = ReturnType<typeof useMonitoringController>;
