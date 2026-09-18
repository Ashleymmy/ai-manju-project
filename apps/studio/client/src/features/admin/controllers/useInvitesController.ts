import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { adminQueryKeys } from "../model/queryKeys";
import { listAdminInvites } from "../services/adminMemberApi";

/**
 * 模块7 邀请记录控制器：全量列表（邀请人/被邀请人/奖励/状态/时间）+ 分页。
 * 记录中的奖励金额为创建时快照（model.InviteRecord），现行规则以后台
 * billing_configs["invite_rewards"] 为准（面板提示卡说明）。
 */
export function useInvitesController(active: boolean) {
  const [page, setPage] = useState(1);

  const listQuery = useQuery({
    queryKey: adminQueryKeys.invites(page),
    queryFn: () => listAdminInvites(page),
    placeholderData: previous => previous,
    enabled: active,
  });

  const total = listQuery.data?.total ?? 0;
  const pageSize = listQuery.data?.page_size ?? 20;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

  const reload = useCallback(async () => {
    if (!active) return;
    await listQuery.refetch();
  }, [active, listQuery]);

  return {
    isError: active && listQuery.isError,
    isPending: active && listQuery.isPending,
    items: listQuery.data?.items || [],
    page,
    reload,
    setPage,
    total,
    totalPages,
  };
}

export type InvitesController = ReturnType<typeof useInvitesController>;
