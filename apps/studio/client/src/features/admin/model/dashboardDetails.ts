import { formatCents, formatCredits, formatDateTime } from "@/features/member";

import {
  ACCOUNT_STATUS_OPTIONS,
  ADMIN_ORDER_STATUS_OPTIONS,
  adminOrderStatusLabel,
  adminOrderTypeLabel,
  adminTaskTypeLabel,
  adminUserStatusLabel,
  memberLevelLabel,
  type AdminConsumption,
  type AdminMemberUser,
  type AdminOrder,
} from "./memberAdmin";

export type DashboardDetailKind = "users" | "orders" | "consumptions";
export type DashboardDetailCell = {
  text: string;
  secondary?: string;
  tone?: "good" | "bad" | "muted";
};
export type DashboardDetailRow = {
  id: string;
  kind: DashboardDetailKind;
  cells: DashboardDetailCell[];
  fields: [string, string][];
  parameters?: string;
};

/** The consumption API exposes settlement status, not generation job success. */
const SETTLEMENT_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: "reserved", label: "已冻结" },
  { value: "settled", label: "已扣费" },
  { value: "released", label: "已释放" },
] as const;

/** Detail categories and columns mirror existing paginated admin endpoints. */
export const DASHBOARD_DETAIL_VIEWS = {
  users: {
    label: "用户明细",
    title: "用户详情",
    statusLabel: "账号状态",
    statuses: ACCOUNT_STATUS_OPTIONS,
    columns: [
      "注册时间",
      "用户 / 账号",
      "会员 / 状态",
      "累计充值",
      "积分余额",
      "最近登录",
    ],
  },
  orders: {
    label: "订单明细",
    title: "订单详情",
    statusLabel: "订单状态",
    statuses: ADMIN_ORDER_STATUS_OPTIONS,
    columns: [
      "创建时间",
      "用户",
      "订单 / 类型",
      "订单金额",
      "状态 / 渠道",
      "支付时间",
    ],
  },
  consumptions: {
    label: "消耗明细",
    title: "消耗详情",
    statusLabel: "积分状态",
    statuses: SETTLEMENT_OPTIONS,
    columns: [
      "创建时间",
      "用户",
      "任务 / 模型",
      "报价 / 实扣积分",
      "积分状态",
      "结算时间",
    ],
  },
} as const;

const text = (value: string | null | undefined) => value || "—";
const credits = (value: number | null | undefined) =>
  value == null ? "—" : formatCredits(value);
const money = (value: number | null | undefined, currency = "CNY") =>
  value == null
    ? "—"
    : currency === "CNY"
      ? formatCents(value)
      : `${currency} ${(value / 100).toFixed(2)}`;
const settlement = (status: string) =>
  SETTLEMENT_OPTIONS.find(option => option.value === status)?.label ||
  text(status);

export function dashboardUserRow(user: AdminMemberUser): DashboardDetailRow {
  return {
    id: user.user_id,
    kind: "users",
    cells: [
      { text: formatDateTime(user.registered_at) },
      {
        text: user.display_name || user.username || user.user_id,
        secondary: user.username || user.user_id,
      },
      {
        text: memberLevelLabel(user.member_level),
        secondary: adminUserStatusLabel(user.status),
        tone: user.status === "disabled" ? "bad" : undefined,
      },
      { text: money(user.total_recharge_cents) },
      {
        text: `永久 ${credits(user.permanent_balance)}`,
        secondary: `限时 ${credits(user.limited_balance)}`,
      },
      { text: formatDateTime(user.last_login_at) },
    ],
    fields: [
      ["用户 ID", user.user_id],
      ["账号", text(user.username)],
      ["昵称", text(user.display_name)],
      ["账号状态", adminUserStatusLabel(user.status)],
      ["角色", text(user.role)],
      ["会员等级", memberLevelLabel(user.member_level)],
      ["会员到期", formatDateTime(user.member_expires_at)],
      ["永久积分", credits(user.permanent_balance)],
      ["限时积分", credits(user.limited_balance)],
      ["累计充值", money(user.total_recharge_cents)],
      ["注册时间", formatDateTime(user.registered_at)],
      ["最近登录", formatDateTime(user.last_login_at)],
    ],
  };
}

export function dashboardOrderRow(order: AdminOrder): DashboardDetailRow {
  return {
    id: order.id,
    kind: "orders",
    cells: [
      { text: formatDateTime(order.created_at) },
      { text: order.user_id },
      { text: adminOrderTypeLabel(order.order_type), secondary: order.id },
      { text: money(order.amount_cents, order.currency) },
      {
        text: adminOrderStatusLabel(order.status),
        secondary: text(order.pay_channel),
        tone:
          order.status === "paid"
            ? "good"
            : order.status === "refunded"
              ? "bad"
              : "muted",
      },
      { text: formatDateTime(order.paid_at) },
    ],
    fields: [
      ["订单编号", order.id],
      ["用户 ID", order.user_id],
      ["订单类型", adminOrderTypeLabel(order.order_type)],
      ["订单状态", adminOrderStatusLabel(order.status)],
      ["订单金额", money(order.amount_cents, order.currency)],
      ["支付渠道", text(order.pay_channel)],
      ["套餐 ID", text(order.plan_id)],
      ["积分包 ID", text(order.package_id)],
      ["创建时间", formatDateTime(order.created_at)],
      ["支付时间", formatDateTime(order.paid_at)],
      ["退款时间", formatDateTime(order.refunded_at)],
      ["发票状态", text(order.invoice_status)],
    ],
  };
}

export function dashboardConsumptionRow(
  item: AdminConsumption
): DashboardDetailRow {
  return {
    id: item.id,
    kind: "consumptions",
    cells: [
      { text: formatDateTime(item.created_at) },
      { text: item.user_id },
      { text: adminTaskTypeLabel(item.task_type), secondary: text(item.model) },
      {
        text: `报价 ${credits(item.credits_quoted)}`,
        secondary: `实扣 ${credits(item.credits_settled)}`,
      },
      {
        text: settlement(item.status),
        tone: item.status === "settled" ? "good" : "muted",
      },
      { text: formatDateTime(item.settled_at) },
    ],
    fields: [
      ["消耗编号", item.id],
      ["任务编号", text(item.job_id)],
      ["用户 ID", item.user_id],
      ["任务类型", adminTaskTypeLabel(item.task_type)],
      ["模型", text(item.model)],
      ["积分状态", settlement(item.status)],
      ["报价积分", credits(item.credits_quoted)],
      ["实扣积分", credits(item.credits_settled)],
      ["创建时间", formatDateTime(item.created_at)],
      ["结算时间", formatDateTime(item.settled_at)],
    ],
    parameters: item.params ? JSON.stringify(item.params, null, 2) : undefined,
  };
}
