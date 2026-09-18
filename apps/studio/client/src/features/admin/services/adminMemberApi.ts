/**
 * 会员系统后台（WP-M7）8 模块的 API 客户端。
 * 路由与参数严格对齐 docs/MEMBERSHIP-SYSTEM-WP-M7-API-CONTRACT.md，
 * 统一走 {success,data,error,request_id} 信封（@/shared/api/http）。
 */

import { request } from "@/shared/api/http";

import {
  ADMIN_LIST_PAGE_SIZE,
  normalizeAdminPaged,
  normalizeConsumptionStats,
  type AdminAuditLog,
  type AdminBillingConfig,
  type AdminConsumption,
  type AdminConsumptionStats,
  type AdminCreditPackage,
  type AdminDashboard,
  type AdminInviteRecord,
  type AdminLedgerEntry,
  type AdminMemberUser,
  type AdminMembershipPlan,
  type AdminOrder,
  type AdminPaged,
} from "../model/memberAdmin";

/* ---- 模块1 用户会员管理 ---- */

export function listAdminMemberUsers(page: number, pageSize = ADMIN_LIST_PAGE_SIZE) {
  return request<Partial<AdminPaged<AdminMemberUser>>>("/api/admin/member-users", {
    query: { page, page_size: pageSize },
  }).then(raw => normalizeAdminPaged<AdminMemberUser>(raw));
}

/** 调积分：delta 有符号（正增负减），nonce 为幂等键（前端自动生成 UUID）。 */
export function adjustMemberUserCredits(
  userId: string,
  payload: { delta: number; reason: string; nonce: string },
) {
  return request<{ account?: unknown; applied?: boolean }>(
    `/api/admin/member-users/${encodeURIComponent(userId)}/credits/adjust`,
    { method: "POST", body: payload },
  );
}

/** 重置邀请码：返回新 code。 */
export function resetMemberUserInviteCode(userId: string) {
  return request<{ invite_code: string }>(
    `/api/admin/member-users/${encodeURIComponent(userId)}/invite/reset`,
    { method: "POST" },
  );
}

/* ---- 模块2 积分流水 ---- */

export type AdminLedgerFilters = {
  userId?: string;
  entryType?: string;
  /** RFC3339，可空。 */
  start?: string;
  end?: string;
  page?: number;
  pageSize?: number;
};

export function listAdminLedger(filters: AdminLedgerFilters) {
  return request<Partial<AdminPaged<AdminLedgerEntry>>>("/api/admin/billing/ledger", {
    query: {
      user_id: filters.userId || undefined,
      entry_type: filters.entryType || undefined,
      start: filters.start || undefined,
      end: filters.end || undefined,
      page: filters.page ?? 1,
      page_size: filters.pageSize ?? ADMIN_LIST_PAGE_SIZE,
    },
  }).then(raw => normalizeAdminPaged<AdminLedgerEntry>(raw));
}

/* ---- 模块3 订单 ---- */

export type AdminOrderFilters = {
  userId?: string;
  status?: string;
  orderType?: string;
  page?: number;
  pageSize?: number;
};

export function listAdminOrders(filters: AdminOrderFilters) {
  return request<Partial<AdminPaged<AdminOrder>>>("/api/admin/billing/orders", {
    query: {
      user_id: filters.userId || undefined,
      status: filters.status || undefined,
      order_type: filters.orderType || undefined,
      page: filters.page ?? 1,
      page_size: filters.pageSize ?? ADMIN_LIST_PAGE_SIZE,
    },
  }).then(raw => normalizeAdminPaged<AdminOrder>(raw));
}

/** 退款（幂等；非 paid 后端 409）。 */
export function refundAdminOrder(orderId: string) {
  return request<AdminOrder>(`/api/admin/billing/orders/${encodeURIComponent(orderId)}/refund`, {
    method: "POST",
  });
}

/* ---- 模块4 任务消耗 ---- */

export type AdminConsumptionFilters = {
  userId?: string;
  taskType?: string;
  status?: string;
  start?: string;
  end?: string;
  page?: number;
  pageSize?: number;
};

export type AdminConsumptionPage = AdminPaged<AdminConsumption> & { stats: AdminConsumptionStats };

export async function listAdminConsumptions(filters: AdminConsumptionFilters): Promise<AdminConsumptionPage> {
  const raw = await request<Partial<AdminPaged<AdminConsumption>> & { stats?: unknown }>(
    "/api/admin/billing/consumptions",
    {
      query: {
        user_id: filters.userId || undefined,
        task_type: filters.taskType || undefined,
        status: filters.status || undefined,
        start: filters.start || undefined,
        end: filters.end || undefined,
        page: filters.page ?? 1,
        page_size: filters.pageSize ?? ADMIN_LIST_PAGE_SIZE,
      },
    },
  );
  return { ...normalizeAdminPaged(raw), stats: normalizeConsumptionStats(raw?.stats) };
}

/* ---- 模块5 套餐与活动配置 ---- */

export async function listAdminBillingPlans() {
  const raw = await request<AdminMembershipPlan[] | null>("/api/admin/billing/plans");
  return Array.isArray(raw) ? raw : [];
}

export type AdminPlanPatch = Partial<
  Pick<
    AdminMembershipPlan,
    | "name"
    | "price_month_cents"
    | "price_year_cents"
    | "monthly_credits"
    | "image_concurrency"
    | "video_concurrency"
    | "credit_discount_bps"
    | "priority_rank"
    | "features"
    | "enabled"
  >
>;

export function updateAdminBillingPlan(planId: string, patch: AdminPlanPatch) {
  return request<AdminMembershipPlan>(`/api/admin/billing/plans/${encodeURIComponent(planId)}`, {
    method: "PUT",
    body: patch,
  });
}

export async function listAdminBillingPackages() {
  const raw = await request<AdminCreditPackage[] | null>("/api/admin/billing/packages");
  return Array.isArray(raw) ? raw : [];
}

export type AdminPackagePatch = Partial<
  Pick<AdminCreditPackage, "name" | "credits" | "price_cents" | "enabled" | "sort_order">
>;

export function updateAdminBillingPackage(packageId: string, patch: AdminPackagePatch) {
  return request<AdminCreditPackage>(`/api/admin/billing/packages/${encodeURIComponent(packageId)}`, {
    method: "PUT",
    body: patch,
  });
}

export async function listAdminBillingConfigs() {
  const raw = await request<AdminBillingConfig[] | null>("/api/admin/billing/configs");
  return Array.isArray(raw) ? raw : [];
}

/** 更新配置（key 白名单见 ADMIN_EDITABLE_CONFIGS；body {"value": <any json>}）。 */
export function updateAdminBillingConfig(key: string, value: unknown) {
  return request<{ key: string; value: unknown }>(`/api/admin/billing/configs/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: { value },
  });
}

/* ---- 模块6 看板 ---- */

export async function fetchAdminBillingDashboard(): Promise<AdminDashboard> {
  const raw = await request<Partial<Record<keyof AdminDashboard, unknown>> | null>("/api/admin/billing/dashboard");
  const numberOf = (key: keyof AdminDashboard) => {
    const value = Number(raw?.[key]);
    return Number.isFinite(value) ? value : 0;
  };
  return {
    total_users: numberOf("total_users"),
    paid_users: numberOf("paid_users"),
    gmv_today_cents: numberOf("gmv_today_cents"),
    gmv_month_cents: numberOf("gmv_month_cents"),
    credits_consumed_today: numberOf("credits_consumed_today"),
    image_generation_total: numberOf("image_generation_total"),
    video_seconds_total: numberOf("video_seconds_total"),
  };
}

/* ---- 模块7 邀请 ---- */

export function listAdminInvites(page: number, pageSize = ADMIN_LIST_PAGE_SIZE) {
  return request<Partial<AdminPaged<AdminInviteRecord>>>("/api/admin/invites", {
    query: { page, page_size: pageSize },
  }).then(raw => normalizeAdminPaged<AdminInviteRecord>(raw));
}

/* ---- 模块8 审计 ---- */

export function listAdminAuditLogs(filters: { adminId?: string; action?: string; page?: number; pageSize?: number }) {
  return request<Partial<AdminPaged<AdminAuditLog>>>("/api/admin/audit-logs", {
    query: {
      admin_id: filters.adminId || undefined,
      action: filters.action || undefined,
      page: filters.page ?? 1,
      page_size: filters.pageSize ?? ADMIN_LIST_PAGE_SIZE,
    },
  }).then(raw => normalizeAdminPaged<AdminAuditLog>(raw));
}
