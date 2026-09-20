import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { memberQueryKeys } from "../model/queryKeys";
import type { ConsumptionItem } from "../model/types";
import { fetchMemberLedger } from "../services/memberApi";
import { useMemberConsumptionsQuery } from "./useMemberConsumptions";

export type UsageBoardTab = "consumptions" | "ledger";

/**
 * 积分明细页控制器：消耗明细（主）+ 积分流水（辅）双 tab。
 * 注意：后端 consumptions 仅支持 status/page 服务端筛选；任务类型、积分类型、
 * 时间范围为当前页内过滤（契约缺口已记录，待后端补参后改为服务端筛选）。
 */
export function useUsageController(active = true) {
  const [boardTab, setBoardTab] = useState<UsageBoardTab>("consumptions");
  const [status, setStatus] = useState("");
  const [taskType, setTaskType] = useState("");
  const [creditKind, setCreditKind] = useState("");
  const [timeRangeDays, setTimeRangeDays] = useState(0);
  const [ledgerType, setLedgerType] = useState("");
  const [page, setPage] = useState(1);

  const consumptionsQuery = useMemberConsumptionsQuery(
    status,
    page,
    active && boardTab === "consumptions"
  );
  const ledgerQuery = useQuery({
    queryKey: memberQueryKeys.ledger(ledgerType, page),
    queryFn: () => fetchMemberLedger(ledgerType, page),
    placeholderData: previous => previous,
    enabled: active && boardTab === "ledger",
  });

  /** 页内过滤（类型/积分类型/时间范围）。 */
  const filteredConsumptions = useMemo(() => {
    const items = consumptionsQuery.data?.items || [];
    const since = timeRangeDays > 0 ? Date.now() - timeRangeDays * 86_400_000 : 0;
    return items.filter((item: ConsumptionItem) => {
      if (taskType && item.task_type !== taskType) return false;
      if (creditKind === "limited" && !(item.limited_credits > 0)) return false;
      if (creditKind === "permanent" && !(item.permanent_credits > 0)) return false;
      if (since > 0) {
        const created = new Date(item.created_at).getTime();
        if (!Number.isFinite(created) || created < since) return false;
      }
      return true;
    });
  }, [consumptionsQuery.data?.items, taskType, creditKind, timeRangeDays]);

  const activeQuery = boardTab === "consumptions" ? consumptionsQuery : ledgerQuery;
  const total = activeQuery.data?.total ?? 0;
  const pageSize = activeQuery.data?.page_size ?? 10;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

  const changeBoardTab = (tab: UsageBoardTab) => {
    setBoardTab(tab);
    setPage(1);
  };
  const applyStatus = (value: string) => {
    setStatus(value);
    setPage(1);
  };
  const applyLedgerType = (value: string) => {
    setLedgerType(value);
    setPage(1);
  };

  return {
    boardTab,
    changeBoardTab,
    consumptions: filteredConsumptions,
    consumptionsQuery,
    creditKind,
    isPending: activeQuery.isPending,
    isError: activeQuery.isError,
    ledgerEntries: ledgerQuery.data?.items || [],
    ledgerQuery,
    ledgerType,
    page,
    pageSize,
    reload: () => void activeQuery.refetch(),
    setCreditKind,
    setTaskType,
    setTimeRangeDays,
    applyLedgerType,
    applyStatus,
    setPage,
    status,
    taskType,
    timeRangeDays,
    total,
    totalPages,
  };
}

export type UsageController = ReturnType<typeof useUsageController>;
