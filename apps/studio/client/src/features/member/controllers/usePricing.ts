import { useQuery } from "@tanstack/react-query";

import { memberQueryKeys } from "../model/queryKeys";
import { PRICE_REFRESH_INTERVAL_MS } from "../model/constants";
import { fetchMemberPricing } from "../services/memberApi";

/** 定价规则页数据查询（套餐 + 积分包 + 定价规则 + 活动）。 */
export function usePricingQuery(active = true) {
  return useQuery({
    queryKey: memberQueryKeys.pricing(),
    queryFn: fetchMemberPricing,
    placeholderData: previous => previous,
    enabled: active,
    refetchInterval: PRICE_REFRESH_INTERVAL_MS,
  });
}
