import { request } from "@/shared/api/http";

import { MEMBER_PAGE_SIZE } from "../model/constants";
import type {
  BillingOrder,
  ConsumptionItem,
  CreatedOrder,
  InviteOverview,
  LedgerEntry,
  MemberOverview,
  MemberPricing,
  PagedResult,
} from "../model/types";

/** 会员首页总览：双余额 + 会员 + 本月消耗。 */
export function fetchMemberOverview() {
  return request<MemberOverview>("/api/member/overview");
}

/** 积分流水（7 类型筛选 + 分页）。 */
export function fetchMemberLedger(entryType: string, page: number, pageSize = MEMBER_PAGE_SIZE) {
  return request<PagedResult<LedgerEntry>>("/api/member/ledger", {
    query: { entry_type: entryType || undefined, page, page_size: pageSize },
  });
}

/** 消耗明细（状态筛选 + 分页；任务类型/积分类型/时间为前端过滤）。 */
export function fetchMemberConsumptions(status: string, page: number, pageSize = MEMBER_PAGE_SIZE) {
  return request<PagedResult<ConsumptionItem>>("/api/member/consumptions", {
    query: { status: status || undefined, page, page_size: pageSize },
  });
}

/** 邀请有礼总览。 */
export function fetchInviteOverview() {
  return request<InviteOverview>("/api/member/invite");
}

/** 礼包超市货架（WP-M15；配置驱动，未配置 = 空货架）。 */
export function fetchGiftPacks() {
  return request<{ items?: unknown }>("/api/member/gifts");
}

/** 定价规则页聚合数据（套餐 + 积分包 + 规则 + 活动）。 */
export function fetchMemberPricing() {
  return request<MemberPricing>("/api/member/pricing");
}

/** 我的订单（最新在前）。 */
export function fetchMyOrders(page = 1, pageSize = MEMBER_PAGE_SIZE) {
  return request<PagedResult<BillingOrder>>("/api/billing/orders", {
    query: { page, page_size: pageSize },
  });
}

export type CreateOrderPayload =
  | { plan_id: string; period: "month" | "year"; pay_channel: string }
  | { package_id: string; pay_channel: string };

/** 下单（201 → {order, pay_params}）。 */
export function createBillingOrder(payload: CreateOrderPayload) {
  return request<CreatedOrder>("/api/billing/orders", { method: "POST", body: payload });
}

/** 模拟支付（仅开发环境可用，生产 404）。 */
export function mockPayOrder(orderId: string) {
  return request<BillingOrder>(`/api/billing/orders/${encodeURIComponent(orderId)}/mock-pay`, {
    method: "POST",
  });
}

/** 取消待支付订单。 */
export function cancelBillingOrder(orderId: string) {
  return request<BillingOrder>(`/api/billing/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: "POST",
  });
}
