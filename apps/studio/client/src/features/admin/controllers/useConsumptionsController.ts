import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import { adminConsumptionSuccessRate, timeRangeStartIso } from "../model/memberAdmin";
import { adminQueryKeys } from "../model/queryKeys";
import { listAdminConsumptions } from "../services/adminMemberApi";

/**
 * 模块4 任务消耗控制器：类型/状态/用户/时间范围筛选 + 分页。
 * 顶部统计卡来自响应 stats（user_id 空 = 全平台口径）；注意 stats 为
 * Go struct 直接序列化的 PascalCase 键，已在 service 层归一（契约缺口 2）。
 */
export function useConsumptionsController(active: boolean) {
  const [taskType, setTaskType] = useState("");
  const [status, setStatus] = useState("");
  const [userId, setUserId] = useState("");
  const [appliedUserId, setAppliedUserId] = useState("");
  const [timeRangeDays, setTimeRangeDays] = useState(0);
  const [page, setPage] = useState(1);

  const filters = useMemo(
    () => ({
      userId: appliedUserId || undefined,
      taskType: taskType || undefined,
      status: status || undefined,
      start: timeRangeStartIso(timeRangeDays),
      page,
    }),
    [appliedUserId, taskType, status, timeRangeDays, page],
  );

  const listQuery = useQuery({
    queryKey: adminQueryKeys.billingConsumptions(filters),
    queryFn: () => listAdminConsumptions(filters),
    placeholderData: previous => previous,
    enabled: active,
  });

  const stats = listQuery.data?.stats ?? null;
  /** 成功率只计终态（success + released）；reserved 为冻结中不计入。 */
  const successRate = adminConsumptionSuccessRate(stats);

  const total = listQuery.data?.total ?? 0;
  const pageSize = listQuery.data?.page_size ?? 20;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

  const applyTaskType = (value: string) => {
    setTaskType(value);
    setPage(1);
  };
  const applyStatus = (value: string) => {
    setStatus(value);
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
    applyStatus,
    applyTaskType,
    applyTimeRange,
    applyUserId,
    isError: active && listQuery.isError,
    isPending: active && listQuery.isPending,
    items: listQuery.data?.items || [],
    page,
    reload,
    setPage,
    setUserId,
    stats,
    status,
    successRate,
    taskType,
    timeRangeDays,
    total,
    totalPages,
    userId,
  };
}

export type ConsumptionsController = ReturnType<typeof useConsumptionsController>;
