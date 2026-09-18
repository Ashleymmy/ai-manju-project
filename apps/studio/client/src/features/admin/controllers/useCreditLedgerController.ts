import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import { aggregateLedgerAmounts, timeRangeStartIso } from "../model/memberAdmin";
import { adminQueryKeys } from "../model/queryKeys";
import { listAdminLedger } from "../services/adminMemberApi";

/**
 * 模块2 积分流水控制器：类型筛选 + 用户筛选 + 时间范围 + 分页。
 * 顶部统计卡口径（任务约定）：总条数取响应 total；累计增加/扣减为当前页 items 聚合。
 */
export function useCreditLedgerController(active: boolean) {
  const [entryType, setEntryType] = useState("");
  const [userId, setUserId] = useState("");
  const [appliedUserId, setAppliedUserId] = useState("");
  const [timeRangeDays, setTimeRangeDays] = useState(0);
  const [page, setPage] = useState(1);

  const filters = useMemo(
    () => ({
      userId: appliedUserId || undefined,
      entryType: entryType || undefined,
      start: timeRangeStartIso(timeRangeDays),
      page,
    }),
    [appliedUserId, entryType, timeRangeDays, page],
  );

  const listQuery = useQuery({
    queryKey: adminQueryKeys.billingLedger(filters),
    queryFn: () => listAdminLedger(filters),
    placeholderData: previous => previous,
    enabled: active,
  });

  const items = listQuery.data?.items || [];
  /** 统计卡：total 来自响应；增/减为当前页聚合（任务约定口径）。 */
  const ledgerStats = useMemo(() => aggregateLedgerAmounts(items), [items]);

  const total = listQuery.data?.total ?? 0;
  const pageSize = listQuery.data?.page_size ?? 20;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

  const applyEntryType = (value: string) => {
    setEntryType(value);
    setPage(1);
  };
  const applyTimeRange = (days: number) => {
    setTimeRangeDays(days);
    setPage(1);
  };
  const applyUserId = () => {
    setAppliedUserId(userId.trim());
    setPage(1);
  };

  const reload = useCallback(async () => {
    if (!active) return;
    await listQuery.refetch();
  }, [active, listQuery]);

  return {
    applyEntryType,
    applyTimeRange,
    applyUserId,
    entryType,
    isError: active && listQuery.isError,
    isPending: active && listQuery.isPending,
    items,
    ledgerStats,
    page,
    reload,
    setPage,
    setUserId,
    timeRangeDays,
    total,
    totalPages,
    userId,
  };
}

export type CreditLedgerController = ReturnType<typeof useCreditLedgerController>;
