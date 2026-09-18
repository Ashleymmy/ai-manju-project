import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import { adminQueryKeys } from "../model/queryKeys";
import { listAdminAuditLogs } from "../services/adminMemberApi";

/**
 * 模块8 审计日志控制器：操作人/操作类型筛选 + 分页。
 * 日志为追加式留痕（应用层与数据库双重禁删改），面板只读、不提供任何删除入口。
 */
export function useAuditLogsController(active: boolean) {
  const [action, setAction] = useState("");
  const [adminId, setAdminId] = useState("");
  const [appliedAdminId, setAppliedAdminId] = useState("");
  const [page, setPage] = useState(1);

  const filters = useMemo(
    () => ({ adminId: appliedAdminId || undefined, action: action || undefined, page }),
    [appliedAdminId, action, page],
  );

  const listQuery = useQuery({
    queryKey: adminQueryKeys.auditLogs(filters),
    queryFn: () => listAdminAuditLogs(filters),
    placeholderData: previous => previous,
    enabled: active,
  });

  const total = listQuery.data?.total ?? 0;
  const pageSize = listQuery.data?.page_size ?? 20;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

  const applyAction = (value: string) => {
    setAction(value);
    setPage(1);
  };
  const applyAdminId = () => {
    setAppliedAdminId(adminId.trim());
    setPage(1);
  };

  const reload = useCallback(async () => {
    if (!active) return;
    await listQuery.refetch();
  }, [active, listQuery]);

  return {
    action,
    adminId,
    applyAction,
    applyAdminId,
    isError: active && listQuery.isError,
    isPending: active && listQuery.isPending,
    items: listQuery.data?.items || [],
    page,
    reload,
    setAdminId,
    setPage,
    total,
    totalPages,
  };
}

export type AuditLogsController = ReturnType<typeof useAuditLogsController>;
