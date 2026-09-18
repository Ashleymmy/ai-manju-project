import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { normalizeGiftPacks } from "../model/gifts";
import { memberQueryKeys } from "../model/queryKeys";
import { fetchGiftPacks } from "../services/memberApi";

/** 礼包超市控制器：配置驱动货架，未配置/空货架渲染空态。 */
export function useGiftsController(active = true) {
  const giftsQuery = useQuery({
    queryKey: memberQueryKeys.gifts(),
    queryFn: fetchGiftPacks,
    placeholderData: previous => previous,
    enabled: active,
  });

  /** 脏数据容错：任意形状都归一为已上架、按 sort_order 排序的货架数组。 */
  const gifts = useMemo(() => normalizeGiftPacks(giftsQuery.data), [giftsQuery.data]);

  return {
    gifts,
    isError: giftsQuery.isError,
    isPending: giftsQuery.isPending,
    reload: () => void giftsQuery.refetch(),
  };
}

export type GiftsController = ReturnType<typeof useGiftsController>;
