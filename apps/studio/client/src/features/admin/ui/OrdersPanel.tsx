import { RefreshCcw, Undo2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCents, formatDateTime, StatusPill } from "@/features/member";

import type { OrdersController } from "../controllers/useOrdersController";
import {
  ADMIN_ORDER_STATUS_OPTIONS,
  ADMIN_ORDER_TYPE_OPTIONS,
  adminOrderStatusLabel,
  adminOrderStatusTone,
  adminOrderTypeLabel,
} from "../model/memberAdmin";
import { AdminPagination, AdminQueryState } from "./components/adminBits";

/** 模块3 订单面板：类型/状态筛选 + 分页；已支付订单可退款（确认弹窗）。 */
export function OrdersPanel({ controller, readOnly }: { controller: OrdersController; readOnly: boolean }) {
  const {
    applyOrderType,
    applyStatus,
    closeRefundDialog,
    confirmRefund,
    isError,
    isPending,
    items,
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
  } = controller;

  return (
    <section className="real-admin-section">
      <div className="admin-panel-head">
        <div>
          <p className="eyebrow">BILLING / ORDERS</p>
          <h2>订单管理</h2>
          <small>金额均为实付（折扣后）；退款会回滚该订单发放的积分/会员。</small>
        </div>
        <div className="monitor-actions">
          <select value={orderType} onChange={event => applyOrderType(event.target.value)} aria-label="订单类型">
            {ADMIN_ORDER_TYPE_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select value={status} onChange={event => applyStatus(event.target.value)} aria-label="订单状态">
            {ADMIN_ORDER_STATUS_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <button className="outline-button small" onClick={() => void reload()}>
            <RefreshCcw size={14} /> 刷新
          </button>
        </div>
      </div>

      <AdminQueryState
        isPending={isPending}
        isError={isError}
        isEmpty={items.length === 0}
        emptyText="暂无订单"
        onRetry={() => void reload()}
      >
        <div className="admin-table">
          <div className="admin-table-head admin-order-row">
            <span>订单号</span>
            <span>用户</span>
            <span>类型</span>
            <span>金额</span>
            <span>支付渠道</span>
            <span>状态</span>
            <span>创建时间</span>
            <span />
          </div>
          {items.map(order => (
            <div className="admin-table-row admin-order-row" key={order.id}>
              <span className="admin-cell-main">
                <b className="admin-cell-ellipsis" title={order.id}>{order.id}</b>
                {order.invoice_status && order.invoice_status !== "none" ? (
                  <small>发票：{order.invoice_status === "issued" ? "已开具" : "已申请"}</small>
                ) : null}
              </span>
              <span className="admin-cell-ellipsis" title={order.user_id}>{order.user_id}</span>
              <span>{adminOrderTypeLabel(order.order_type)}</span>
              <span className="member-cell-num">{formatCents(order.amount_cents)}</span>
              <span>{order.pay_channel || "—"}</span>
              <span>
                <StatusPill tone={adminOrderStatusTone(order.status)}>
                  {adminOrderStatusLabel(order.status)}
                </StatusPill>
              </span>
              <span>{formatDateTime(order.created_at)}</span>
              {!readOnly ? (
                <span className="admin-row-actions">
                  {order.status === "paid" ? (
                    <button
                      type="button"
                      title="退款"
                      onClick={() => openRefundDialog(order)}
                      disabled={refundBusy}
                    >
                      <Undo2 size={14} />
                    </button>
                  ) : null}
                </span>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
        <AdminPagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
      </AdminQueryState>

      {/* 退款确认弹窗 */}
      <Dialog
        open={refundTarget !== null}
        onOpenChange={nextOpen => {
          if (!nextOpen) closeRefundDialog();
        }}
      >
        <DialogContent className="sm:max-w-[480px]" showCloseButton={!refundBusy}>
          <DialogHeader>
            <DialogTitle>订单退款</DialogTitle>
            <DialogDescription>
              确认退款订单 {refundTarget?.id}（{refundTarget ? formatCents(refundTarget.amount_cents) : ""}）？
              退款幂等；该订单发放的积分/会员将被回滚，操作写入审计日志。
            </DialogDescription>
          </DialogHeader>
          {refundError ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{refundError}</p>
          ) : null}
          <DialogFooter>
            <button className="outline-button small" type="button" onClick={() => closeRefundDialog()} disabled={refundBusy}>
              取消
            </button>
            <button className="vermilion-button" type="button" onClick={() => void confirmRefund()} disabled={refundBusy}>
              {refundBusy ? "退款中…" : "确认退款"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
