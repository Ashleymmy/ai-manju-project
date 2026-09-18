import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { publicApiError } from "@/shared/api/errors";

import type { AdminOrder } from "../model/memberAdmin";
import { adminQueryKeys } from "../model/queryKeys";
import { listAdminOrders, refundAdminOrder } from "../services/adminMemberApi";

/** 模块3 订单控制器：类型/状态筛选 + 分页 + 已支付订单退款（确认弹窗，引擎幂等）。 */
export function useOrdersController(active: boolean) {
  const [orderType, setOrderType] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const filters = useMemo(
    () => ({ orderType: orderType || undefined, status: status || undefined, page }),
    [orderType, status, page],
  );

  const listQuery = useQuery({
    queryKey: adminQueryKeys.billingOrders(filters),
    queryFn: () => listAdminOrders(filters),
    placeholderData: previous => previous,
    enabled: active,
  });

  const [refundTarget, setRefundTarget] = useState<AdminOrder | null>(null);
  const [refundBusy, setRefundBusy] = useState(false);
  const [refundError, setRefundError] = useState("");

  const openRefundDialog = (order: AdminOrder) => {
    if (refundBusy || order.status !== "paid") return;
    setRefundTarget(order);
    setRefundError("");
  };

  const closeRefundDialog = (force = false) => {
    if (refundBusy && !force) return;
    setRefundTarget(null);
    setRefundError("");
  };

  /** 退款：成功后刷新列表并提示（回滚积分由后端引擎完成）。 */
  const confirmRefund = async () => {
    if (refundBusy || !refundTarget) return;
    setRefundBusy(true);
    try {
      await refundAdminOrder(refundTarget.id);
      toast.success(`订单 ${refundTarget.id} 已退款，积分已回滚`);
      closeRefundDialog(true);
      await listQuery.refetch();
    } catch (error) {
      setRefundError(publicApiError(error, "退款失败"));
    } finally {
      setRefundBusy(false);
    }
  };

  const total = listQuery.data?.total ?? 0;
  const pageSize = listQuery.data?.page_size ?? 20;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

  const applyOrderType = (value: string) => {
    setOrderType(value);
    setPage(1);
  };
  const applyStatus = (value: string) => {
    setStatus(value);
    setPage(1);
  };

  const reload = useCallback(async () => {
    if (!active) return;
    await listQuery.refetch();
  }, [active, listQuery]);

  return {
    applyOrderType,
    applyStatus,
    closeRefundDialog,
    confirmRefund,
    isError: active && listQuery.isError,
    isPending: active && listQuery.isPending,
    items: listQuery.data?.items || [],
    openRefundDialog,
    orderType,
    page,
    refundBusy,
    refundError,
    refundTarget,
    reload,
    setPage,
    status,
    total,
    totalPages,
  };
}

export type OrdersController = ReturnType<typeof useOrdersController>;
