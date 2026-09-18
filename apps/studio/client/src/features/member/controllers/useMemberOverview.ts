import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { memberQueryKeys } from "../model/queryKeys";
import { fetchMemberOverview } from "../services/memberApi";

/** 会员总览查询（双余额 / 会员 / 本月消耗）。 */
export function useMemberOverviewQuery(active = true) {
  return useQuery({
    queryKey: memberQueryKeys.overview(),
    queryFn: fetchMemberOverview,
    placeholderData: previous => previous,
    enabled: active,
  });
}

/** 支付/取消成功后刷新会员域所有缓存（余额、流水、订单会联动变化）。 */
export function useInvalidateMemberData() {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: memberQueryKeys.all }),
    [queryClient],
  );
}
