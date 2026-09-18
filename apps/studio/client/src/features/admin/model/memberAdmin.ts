/**
 * 会员系统后台（WP-M7，8 模块）的类型、常量与纯函数。
 * 契约：docs/MEMBERSHIP-SYSTEM-WP-M7-API-CONTRACT.md
 * 字段与 apps/api internal/handler/admin_member.go、admin_billing.go 一一对应；
 * 金额一律 cents，展示前经 formatCents（复用 member feature 的 model/format）。
 *
 * 契约缺口（已记录，本期不改后端）：
 * 1. GET /admin/member-users 无会员等级/账号状态查询参数 —— 这两个筛选在
 *    前端按当前页数据过滤。
 * 2. consumptions 响应里的 stats 由 repository.ConsumptionStats 直接序列化
 *    （Go struct 无 json tag），键为 PascalCase —— normalizeConsumptionStats
 *    同时兼容 PascalCase / snake_case 两种键名。
 * 3. stats.failed_count 仓储层恒为 0（失败需关联任务状态，由 service 层补），
 *    面板「失败/取消」口径取 released_count。
 */

import { createRandomUUID } from "@/shared/lib/cryptoRandomUuid";

/* ------------------------------------------------------------------ */
/* 类型                                                                */
/* ------------------------------------------------------------------ */

/** 模块1 会员用户列表行（AdminMemberUserRow）。 */
export type AdminMemberUser = {
  user_id: string;
  username: string;
  display_name?: string;
  /** 套餐名；非会员为 ""。 */
  member_level?: string;
  member_expires_at?: string | null;
  /** active / disabled。 */
  status: string;
  permanent_balance: number;
  limited_balance: number;
  registered_at?: string;
  last_login_at?: string | null;
  /** 累计充值（cents）。 */
  total_recharge_cents: number;
};

/** 后台分页响应统一形状。 */
export type AdminPaged<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
};

/** 模块2 积分流水行（CreditLedgerEntry）。 */
export type AdminLedgerEntry = {
  id: string;
  user_id: string;
  entry_type: string;
  /** 有符号：增正减负。 */
  amount: number;
  /** permanent / grant。 */
  bucket: string;
  permanent_after?: number;
  grant_remaining_after?: number;
  order_id?: string;
  job_id?: string;
  operator_id?: string;
  created_at: string;
};

/** 模块3 订单行（model.Order）。 */
export type AdminOrder = {
  id: string;
  user_id: string;
  order_type: string;
  plan_id?: string;
  package_id?: string;
  amount_cents: number;
  currency?: string;
  pay_channel?: string;
  /** pending / paid / refunded / closed。 */
  status: string;
  invoice_status?: string;
  paid_at?: string | null;
  refunded_at?: string | null;
  created_at: string;
};

/** 模块4 任务消耗行（model.TaskConsumption）。 */
export type AdminConsumption = {
  id: string;
  job_id?: string;
  user_id: string;
  task_type: string;
  model?: string;
  params?: Record<string, unknown> | null;
  credits_quoted: number;
  credits_settled?: number | null;
  /** reserved / settled / released。 */
  status: string;
  created_at: string;
  settled_at?: string | null;
};

/** 模块4 顶部统计卡（normalizeConsumptionStats 归一后的 snake_case 口径）。 */
export type AdminConsumptionStats = {
  total_credits_settled: number;
  success_count: number;
  /** 仓储层恒为 0（见文件头说明 3），保留字段兼容未来 service 层填充。 */
  failed_count: number;
  released_count: number;
  reserved_count: number;
  image_count: number;
  video_seconds: number;
  agent_calls: number;
};

/** 模块5 会员套餐（model.MembershipPlan）。 */
export type AdminMembershipPlan = {
  id: string;
  code: string;
  name: string;
  price_month_cents: number;
  /** 0 = 年付未开通。 */
  price_year_cents: number;
  monthly_credits: number;
  image_concurrency: number;
  video_concurrency: number;
  /** 基点：10000 = 无折扣，8000 = 8 折。 */
  credit_discount_bps: number;
  priority_rank: number;
  features?: Record<string, unknown> | null;
  enabled: boolean;
};

/** 模块5 直购积分包（model.CreditPackage）。 */
export type AdminCreditPackage = {
  id: string;
  name: string;
  credits: number;
  price_cents: number;
  enabled: boolean;
  sort_order: number;
};

/** 模块5 计费配置（model.BillingConfig；value 为任意 JSON）。 */
export type AdminBillingConfig = {
  key: string;
  value: unknown;
  updated_by?: string;
  updated_at?: string;
};

/** 模块6 看板（AdminDashboard）。 */
export type AdminDashboard = {
  total_users: number;
  paid_users: number;
  gmv_today_cents: number;
  gmv_month_cents: number;
  credits_consumed_today: number;
  image_generation_total: number;
  video_seconds_total: number;
};

/** 模块7 邀请记录（model.InviteRecord；奖励为创建时快照）。 */
export type AdminInviteRecord = {
  id: string;
  inviter_id: string;
  invitee_id: string;
  /** pending_first_recharge / granted / expired。 */
  reward_status: string;
  inviter_reward: number;
  invitee_reward: number;
  first_charge_bonus: number;
  granted_at?: string | null;
  created_at: string;
};

/** 模块8 审计日志（model.AdminAuditLog；追加式，不可删除）。 */
export type AdminAuditLog = {
  id: string;
  admin_id: string;
  action: string;
  target_type?: string;
  target_id?: string;
  /** 变更快照 JSON（如调价前后值），展示时经 formatAuditDetail 可读化。 */
  detail?: unknown;
  ip?: string;
  created_at: string;
};

/* ------------------------------------------------------------------ */
/* 常量（项目规范：集中 + 注释，不散落魔法值）                            */
/* ------------------------------------------------------------------ */

/** 后台列表分页大小（与后端 parseAdminPagination 默认值 20 对齐）。 */
export const ADMIN_LIST_PAGE_SIZE = 20;

/** 积分调整 nonce 前缀（nonce 为幂等键，必填；UUID 保证唯一）。 */
export const ADJUST_NONCE_PREFIX = "adj";

/** 模块1 会员等级筛选（契约缺口 1：前端按当前页过滤）。 */
export const MEMBER_LEVEL_OPTIONS = [
  { value: "", label: "全部等级" },
  { value: "member", label: "会员" },
  { value: "free", label: "非会员" },
] as const;

/** 模块1 账号状态筛选（同上，页内过滤）。 */
export const ACCOUNT_STATUS_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: "active", label: "正常" },
  { value: "disabled", label: "已禁用" },
] as const;

/** 模块2 流水类型筛选（model.LedgerType*：文档 7 类型 + 退款回滚）。 */
export const ADMIN_LEDGER_TYPE_OPTIONS = [
  { value: "", label: "全部流水" },
  { value: "recharge", label: "充值购买" },
  { value: "member_monthly", label: "会员月发" },
  { value: "consume", label: "任务消耗" },
  { value: "admin_add", label: "后台调增" },
  { value: "admin_subtract", label: "后台调减" },
  { value: "expire", label: "过期扣减" },
  { value: "activity_bonus", label: "活动赠送" },
  { value: "refund_rollback", label: "退款回滚" },
] as const;

/** 模块3 订单类型筛选（model.OrderType*）。 */
export const ADMIN_ORDER_TYPE_OPTIONS = [
  { value: "", label: "全部类型" },
  { value: "credit_pack", label: "积分直购" },
  { value: "member_monthly", label: "会员月付" },
  { value: "member_yearly", label: "会员年付" },
] as const;

/** 模块3 订单状态筛选（model.OrderStatus*）。 */
export const ADMIN_ORDER_STATUS_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: "pending", label: "待支付" },
  { value: "paid", label: "已支付" },
  { value: "refunded", label: "已退款" },
  { value: "closed", label: "已关闭" },
] as const;

/** 模块4 任务类型筛选（model.TaskType*）。 */
export const ADMIN_TASK_TYPE_OPTIONS = [
  { value: "", label: "全部类型" },
  { value: "image", label: "图片生成" },
  { value: "video_fast", label: "视频 Fast 渲染" },
  { value: "video_standard", label: "视频标准版渲染" },
  { value: "agent_skill", label: "Agent 技能调用" },
] as const;

/** 模块4 任务状态筛选（model.TaskConsumptionStatus*）。 */
export const ADMIN_CONSUMPTION_STATUS_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: "settled", label: "成功（已扣费）" },
  { value: "reserved", label: "进行中（冻结中）" },
  { value: "released", label: "失败/取消（未扣费）" },
] as const;

/** 时间范围快捷筛选（天）；0 = 全部。与 member feature 口径一致。 */
export const ADMIN_TIME_RANGE_OPTIONS = [
  { value: 0, label: "全部时间" },
  { value: 7, label: "近 7 天" },
  { value: 30, label: "近 30 天" },
  { value: 90, label: "近 90 天" },
] as const;

/**
 * 模块5 可编辑配置白名单（镜像后端 adminEditableConfigKeys，
 * 见 admin_billing.go；白名单外的 key 后端一律 400）。
 * schema 用于前端轻校验："int" = 数字 JSON；"json" = 任意合法 JSON。
 */
export const ADMIN_EDITABLE_CONFIGS = [
  { key: "register_bonus_credits", label: "注册赠送积分", schema: "int", hint: "整数，如 1000" },
  { key: "register_bonus_ttl_days", label: "注册积分有效期（天）", schema: "int", hint: "整数天数，如 31" },
  { key: "invite_rewards", label: "邀请奖励", schema: "json", hint: '{"inviter":2000,"invitee":500,"first_charge_bonus":1000}' },
  { key: "invite_reward_ttl_days", label: "邀请奖励有效期（天）", schema: "int", hint: "整数天数，如 30" },
  { key: "activity_discount", label: "限时活动", schema: "json", hint: '{"enabled":true,"starts_at":"...","ends_at":"...","discount_bps":8000,"applies_to":["image"]}' },
  { key: "pricing_rules", label: "定价规则", schema: "json", hint: '{"image":{"small_512":20,"standard_1024":50,"large":80},...}' },
  { key: "gift_packs", label: "礼包超市货架", schema: "json", hint: '[{"id":"...","name":"...","price_cents":9900,"credits":1000,"enabled":true,"sort_order":1}]' },
] as const;

/** 模块8 审计操作筛选（model.AuditAction*）。 */
export const ADMIN_AUDIT_ACTION_OPTIONS = [
  { value: "", label: "全部操作" },
  { value: "login", label: "后台登录" },
  { value: "refund", label: "订单退款" },
  { value: "adjust_credits", label: "调整积分" },
  { value: "disable_user", label: "禁用账号" },
  { value: "reset_invite_code", label: "重置邀请码" },
  { value: "update_plan", label: "更新套餐" },
  { value: "update_activity", label: "更新活动" },
] as const;

/* ------------------------------------------------------------------ */
/* 纯函数（label / 状态映射 / 聚合 / 归一化；均有单测覆盖）               */
/* ------------------------------------------------------------------ */

type OptionList = ReadonlyArray<{ value: string; label: string }>;

function optionLabel(options: OptionList, value: string, fallback = "—") {
  return options.find(option => option.value === value)?.label || value || fallback;
}

export const adminLedgerTypeLabel = (value: string) => optionLabel(ADMIN_LEDGER_TYPE_OPTIONS, value);
export const adminOrderTypeLabel = (value: string) => optionLabel(ADMIN_ORDER_TYPE_OPTIONS, value);
export const adminOrderStatusLabel = (value: string) => optionLabel(ADMIN_ORDER_STATUS_OPTIONS, value);
export const adminTaskTypeLabel = (value: string) => optionLabel(ADMIN_TASK_TYPE_OPTIONS, value);
export const adminConsumptionStatusLabel = (value: string) =>
  optionLabel(ADMIN_CONSUMPTION_STATUS_OPTIONS, value);
export const auditActionLabel = (value: string) => optionLabel(ADMIN_AUDIT_ACTION_OPTIONS, value);

export type PillTone = "green" | "red" | "gray" | "blue";

/** 订单状态 → 状态胶囊色（TapNow 口径：成功绿 / 失败红 / 取消·待处理灰）。 */
export function adminOrderStatusTone(status: string): PillTone {
  if (status === "paid") return "green";
  if (status === "refunded") return "red";
  return "gray"; // pending / closed
}

/** 任务消耗状态 → 胶囊色：成功绿、失败/取消红（未扣费）、冻结灰。 */
export function adminConsumptionStatusTone(status: string): PillTone {
  if (status === "settled") return "green";
  if (status === "released") return "red";
  return "gray"; // reserved
}

/** 账号状态 → 胶囊色。 */
export function adminUserStatusTone(status: string): PillTone {
  return status === "active" ? "green" : "red";
}

/** 账号状态中文文案。 */
export function adminUserStatusLabel(status: string) {
  return ACCOUNT_STATUS_OPTIONS.find(option => option.value === status)?.label || status || "—";
}

/** 会员等级展示：非会员统一显示「免费版」。 */
export function memberLevelLabel(level?: string) {
  return level && level.trim() ? level : "免费版";
}

/** 邀请奖励状态 → 文案（pending_first_recharge = 待发放，反刷号设计）。 */
export function inviteRewardStatusLabel(status: string) {
  switch (status) {
    case "granted":
      return "已发放";
    case "expired":
      return "已过期";
    case "pending_first_recharge":
      return "待发放（待首充）";
    default:
      return status || "—";
  }
}

export function inviteRewardStatusTone(status: string): PillTone {
  if (status === "granted") return "green";
  if (status === "expired") return "gray";
  return "blue"; // 待发放
}

/** 模块2 统计卡：当前页 items 聚合累计增加（正）/ 累计扣减（负的绝对值）。 */
export function aggregateLedgerAmounts(items: ReadonlyArray<Pick<AdminLedgerEntry, "amount">>) {
  let increase = 0;
  let decrease = 0;
  for (const item of items) {
    const amount = Number(item.amount) || 0;
    if (amount >= 0) increase += amount;
    else decrease += -amount;
  }
  return { increase, decrease };
}

/**
 * 模块4 成功率（%）：success / (success + released)，分母只含终态；
 * failed_count 仓储层恒 0，不计入。无终态任务时为 100。
 */
export function adminConsumptionSuccessRate(stats?: AdminConsumptionStats | null) {
  if (!stats) return 100;
  const terminal = (Number(stats.success_count) || 0) + (Number(stats.released_count) || 0);
  if (terminal <= 0) return 100;
  return ((Number(stats.success_count) || 0) / terminal) * 100;
}

function numberField(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

/**
 * consumptions stats 归一化：兼容后端 PascalCase（ConsumptionStats 无 json tag）
 * 与规范 snake_case 两种键名（契约缺口 2）。
 */
export function normalizeConsumptionStats(raw: unknown): AdminConsumptionStats {
  const record = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    total_credits_settled: numberField(record, "total_credits_settled", "TotalCreditsSettled"),
    success_count: numberField(record, "success_count", "SuccessCount"),
    failed_count: numberField(record, "failed_count", "FailedCount"),
    released_count: numberField(record, "released_count", "ReleasedCount"),
    reserved_count: numberField(record, "reserved_count", "ReservedCount"),
    image_count: numberField(record, "image_count", "ImageCount"),
    video_seconds: numberField(record, "video_seconds", "VideoSeconds"),
    agent_calls: numberField(record, "agent_calls", "AgentCalls"),
  };
}

/** 后台分页响应归一化：缺字段时给安全默认（items=[] / page=1 / page_size=默认）。 */
export function normalizeAdminPaged<T>(raw: Partial<AdminPaged<T>> | null | undefined): AdminPaged<T> {
  const items = Array.isArray(raw?.items) ? raw.items : [];
  const total = Number(raw?.total);
  const page = Number(raw?.page);
  const pageSize = Number(raw?.page_size);
  return {
    items,
    total: Number.isFinite(total) ? total : items.length,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    page_size: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : ADMIN_LIST_PAGE_SIZE,
  };
}

/**
 * 模块5 配置编辑校验：textarea JSON 解析 + schema 轻校验。
 * 成功返回解析后的 value；失败返回可读错误文案。
 */
export function parseConfigValue(
  text: string,
  schema: "int" | "json",
): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "请输入配置值" };
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: "不是合法的 JSON，请检查格式" };
  }
  if (schema === "int" && !Number.isInteger(value)) {
    return { ok: false, error: "该配置需为整数" };
  }
  return { ok: true, value };
}

/** 审计 detail 可读化：对象 → 紧凑 JSON 串；空 → "—"。 */
export function formatAuditDetail(detail: unknown): string {
  if (detail === null || detail === undefined || detail === "") return "—";
  if (typeof detail === "string") return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

/** 快捷时间范围 → RFC3339 start（UTC ISO）；0 = 不传（不筛）。 */
export function timeRangeStartIso(days: number, now: Date = new Date()) {
  if (!Number.isFinite(days) || days <= 0) return undefined;
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

/** 元 → cents（编辑表单输入换算；空串/非法/负数返回 null）。 */
export function yuanToCents(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** 积分调整幂等 nonce（UUID v4，带前缀便于审计日志检索）。 */
export function createAdjustNonce() {
  return `${ADJUST_NONCE_PREFIX}-${createRandomUUID()}`;
}
