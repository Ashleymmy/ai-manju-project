import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { memberQueryKeys } from "../model/queryKeys";
import { fetchInviteOverview } from "../services/memberApi";

/** 邀请有礼页控制器：邀请码 + 复制链接 + 记录列表。 */
export function useInviteController(active = true) {
  const inviteQuery = useQuery({
    queryKey: memberQueryKeys.invite(),
    queryFn: fetchInviteOverview,
    placeholderData: previous => previous,
    enabled: active,
  });
  const [copied, setCopied] = useState(false);

  const copyInviteUrl = async () => {
    const url = inviteQuery.data?.invite_url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("邀请链接已复制");
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      toast.error("复制失败，请手动复制链接");
    }
  };

  return {
    copied,
    copyInviteUrl,
    isError: inviteQuery.isError,
    isPending: inviteQuery.isPending,
    overview: inviteQuery.data || null,
    reload: () => void inviteQuery.refetch(),
  };
}

export type InviteController = ReturnType<typeof useInviteController>;
