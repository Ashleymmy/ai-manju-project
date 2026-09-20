import { useQuery } from "@tanstack/react-query";

import { memberQueryKeys } from "../model/queryKeys";
import { fetchMemberConsumptions } from "../services/memberApi";

/**
 * 消耗明细查询（与积分明细页共用同一 queryKey 与默认分页大小，
 * 工作台积分面板只取第 1 页再在渲染层截断，避免同键不同 page_size 的缓存串扰）。
 */
export function useMemberConsumptionsQuery(
  status: string,
  page: number,
  active = true
) {
  return useQuery({
    queryKey: memberQueryKeys.consumptions(status, page),
    queryFn: () => fetchMemberConsumptions(status, page),
    placeholderData: previous => previous,
    enabled: active,
  });
}
