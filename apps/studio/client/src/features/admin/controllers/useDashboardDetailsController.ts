import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  dashboardConsumptionRow,
  dashboardOrderRow,
  dashboardUserRow,
  type DashboardDetailKind,
  type DashboardDetailRow,
} from "../model/dashboardDetails";
import { ADMIN_LIST_PAGE_SIZE } from "../model/memberAdmin";
import {
  listAdminConsumptions,
  listAdminMemberUsers,
  listAdminOrders,
} from "../services/adminMemberApi";

/** A single active query keeps paging and failures isolated from the KPI request. */
export function useDashboardDetailsController(active: boolean) {
  const [kind, setKind] = useState<DashboardDetailKind>("users");
  const [draft, setDraft] = useState({ search: "", status: "" });
  const [filters, setFilters] = useState({ search: "", status: "", page: 1 });
  const [detail, setDetail] = useState<DashboardDetailRow | null>(null);
  const query = useQuery({
    queryKey: ["admin", "dashboard-details", kind, filters],
    enabled: active,
    queryFn: async () => {
      const common = {
        userId: filters.search || undefined,
        status: filters.status || undefined,
        page: filters.page,
        pageSize: ADMIN_LIST_PAGE_SIZE,
      };
      if (kind === "users") {
        const result = await listAdminMemberUsers(
          filters.page,
          ADMIN_LIST_PAGE_SIZE,
          {
            search: filters.search || undefined,
            status: filters.status || undefined,
          }
        );
        return { ...result, rows: result.items.map(dashboardUserRow) };
      }
      if (kind === "orders") {
        const result = await listAdminOrders(common);
        return { ...result, rows: result.items.map(dashboardOrderRow) };
      }
      const result = await listAdminConsumptions(common);
      return { ...result, rows: result.items.map(dashboardConsumptionRow) };
    },
  });
  const reload = async () => {
    if (active) await query.refetch();
  };
  const selectKind = (next: DashboardDetailKind) => {
    if (next === kind) return;
    setKind(next);
    setDraft({ search: "", status: "" });
    setFilters({ search: "", status: "", page: 1 });
    setDetail(null);
  };
  const apply = () => {
    const next = { ...draft, search: draft.search.trim(), page: 1 };
    setDetail(null);
    setFilters(next);
    if (JSON.stringify(next) === JSON.stringify(filters)) void reload();
  };
  const reset = () => {
    setDraft({ search: "", status: "" });
    setFilters({ search: "", status: "", page: 1 });
    setDetail(null);
  };
  const total = query.isError ? 0 : (query.data?.total ?? 0);
  return {
    kind,
    selectKind,
    draft,
    setDraft,
    filters,
    apply,
    reset,
    detail,
    setDetail,
    reload,
    rows: query.isError ? [] : query.data?.rows || [],
    total,
    totalPages: Math.max(
      1,
      Math.ceil(total / (query.data?.page_size || ADMIN_LIST_PAGE_SIZE))
    ),
    setPage: (page: number) => {
      setDetail(null);
      setFilters(previous => ({ ...previous, page }));
    },
    isPending: active && query.isPending,
    isError: active && query.isError,
    isFetching: active && query.isFetching,
    hasUnappliedChanges:
      draft.search.trim() !== filters.search || draft.status !== filters.status,
  };
}

export type DashboardDetailsController = ReturnType<
  typeof useDashboardDetailsController
>;
