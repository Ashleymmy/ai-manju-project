/**
 * 会员中心（WP-M10）API 类型。与 apps/api internal/handler/member.go、billing.go
 * 的响应字段一一对应；金额一律为 cents，展示前必须经 formatCents 转换。
 */

/** 双余额 + 会员 + 本月消耗总览（GET /api/member/overview）。 */
export type MemberOverview = {
  permanent_balance: number;
  permanent_frozen: number;
  permanent_available: number;
  limited_available: number;
  limited_frozen: number;
  /** 最近一批将过期的限时积分到期时间（RFC3339），无则缺省/空。 */
  next_expiry_at?: string | null;
  next_expiry_amount?: number;
  membership: {
    plan_code: string;
    plan_name: string;
    expires_at: string;
    started_at: string;
  } | null;
  monthly_usage?: {
    image_count: number;
    video_seconds: number;
    total_credits: number;
  };
};

/** 积分流水类型（后端 LedgerType*，文档 7 类型 + 退款回滚）。 */
export type LedgerEntryType =
  | "recharge"
  | "member_monthly"
  | "consume"
  | "admin_add"
  | "admin_subtract"
  | "expire"
  | "activity_bonus"
  | "refund_rollback";

export type LedgerEntry = {
  id: string;
  entry_type: LedgerEntryType | string;
  /** 有符号：增正减负。 */
  amount: number;
  bucket: "permanent" | "grant" | string;
  permanent_after: number;
  grant_remaining_after?: number | null;
  order_id?: string;
  job_id?: string;
  operator_id?: string;
  created_at: string;
};

export type ConsumptionStatus = "reserved" | "settled" | "released";

/** 消耗明细行（含限时/永久拆分与扣费状态）。 */
export type ConsumptionItem = {
  id: string;
  job_id: string;
  task_type: "image" | "video_fast" | "video_standard" | "agent_skill" | string;
  model: string;
  params?: Record<string, unknown> | null;
  credits_quoted: number;
  credits_settled?: number | null;
  status: ConsumptionStatus | string;
  created_at: string;
  settled_at?: string | null;
  limited_credits: number;
  permanent_credits: number;
  /** charged=成功已扣费；not_charged=冻结中或失败/取消未扣费。 */
  charge_state: "charged" | "not_charged" | string;
};

export type PagedResult<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
};

/** 会员套餐（billing_configs 可配；价格 cents；折扣为基点，8000=8 折）。 */
export type MembershipPlan = {
  id: string;
  code: string;
  name: string;
  price_month_cents: number;
  /** 0 = 年付未开通。 */
  price_year_cents: number;
  monthly_credits: number;
  image_concurrency: number;
  video_concurrency: number;
  credit_discount_bps: number;
  priority_rank: number;
  features?: Record<string, unknown> | null;
  enabled: boolean;
};

/** 直购积分包。 */
export type CreditPackage = {
  id: string;
  name: string;
  credits: number;
  price_cents: number;
  enabled: boolean;
  sort_order: number;
};

/** 定价规则配置（billing_configs["pricing_rules"] 镜像，缺省字段用文档默认值）。 */
export type PricingRulesConfig = {
  image?: { small_512?: number; standard_1024?: number; large?: number };
  video_fast?: { per_second?: number };
  video_standard?: { per_second?: number };
  agent_skill?: { per_call?: number };
};

/** 限时活动配置（billing_configs["activity_discount"] 镜像）。 */
export type ActivityConfig = {
  enabled?: boolean;
  starts_at?: string;
  ends_at?: string;
  /** 基点：5000 = 五折。 */
  discount_bps?: number;
  applies_to?: string[];
};

/** GET /api/member/pricing 聚合响应。 */
export type MemberPricing = {
  plans?: MembershipPlan[];
  packages?: CreditPackage[];
  credits_per_yuan?: number;
  pricing_rules?: PricingRulesConfig;
  activity?: ActivityConfig;
};

/** 邀请记录（奖励与好友首充绑定）。 */
export type InviteRecord = {
  id: string;
  inviter_id: string;
  invitee_id: string;
  /** pending_first_recharge=待发放（待首充）/ granted=已发放 / expired=已过期。 */
  reward_status: "pending_first_recharge" | "granted" | "expired" | string;
  inviter_reward: number;
  invitee_reward: number;
  first_charge_bonus: number;
  granted_at?: string | null;
  created_at: string;
};

export type InviteOverview = {
  invite_code: string;
  invite_url: string;
  invited_count: number;
  total_reward_earned: number;
  records: InviteRecord[];
};

export type BillingOrder = {
  id: string;
  order_type: "credit_pack" | "member_monthly" | "member_yearly" | string;
  plan_id?: string;
  package_id?: string;
  amount_cents: number;
  currency: string;
  pay_channel: string;
  status: "pending" | "paid" | "refunded" | "closed" | string;
  created_at: string;
};

export type CreatedOrder = {
  order: BillingOrder;
  pay_params?: unknown;
};

/**
 * 礼包超市货架项（WP-M15；GET /api/member/gifts → billing_configs["gift_packs"]）。
 * 内容量为 credits（积分）或 membership_days（会员天数）二选一；
 * 字段全部容错缺省（normalizeGiftPacks 兜底）。
 */
export type GiftPack = {
  id: string;
  name: string;
  description: string;
  /** 封面图 URL；空串走占位样式。 */
  cover: string;
  /** 价格（cents）。 */
  price_cents: number;
  credits: number;
  membership_days: number;
  enabled: boolean;
  sort_order: number;
};
