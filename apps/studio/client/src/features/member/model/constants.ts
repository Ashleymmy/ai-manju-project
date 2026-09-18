/**
 * 会员中心常量集中定义（项目规范：常量集中 + 注释，不散落魔法数字）。
 * 口径来源：docs/MEMBERSHIP-SYSTEM-PRICING-DATA.md（image18/19 权威定价页）
 * 与 2026-09-17 定稿决策（只开 2 付费档、新用户赠 1000）。
 * 后端 billing_configs 可运行时覆盖的部分，页面以接口值为准、此处仅作兜底/文案。
 */

/** 积分兑换基准：1 元 = 100 积分（接口 credits_per_yuan 兜底值）。 */
export const CREDITS_PER_YUAN_FALLBACK = 100;

/** 直购积分滑杆范围（TapNow 参考图 8：500–500,000）。 */
export const RECHARGE_SLIDER_MIN = 500;
export const RECHARGE_SLIDER_MAX = 500_000;
export const RECHARGE_SLIDER_STEP = 100;
/** 预设额度胶囊（参考图 8 口径）。 */
export const RECHARGE_PRESETS = [1_000, 2_000, 3_000, 5_000, 10_000] as const;

/** 邀请奖励文案兜底值（与后端种子 invite_rewards 一致；配置以后台为准）。 */
export const INVITE_REWARD_INVITER = 2_000; // 每邀请 1 位新用户注册
export const INVITE_REWARD_INVITEE = 500; // 被邀请人注册即得
export const INVITE_REWARD_FIRST_CHARGE = 1_000; // 好友首充额外奖励
export const INVITE_REWARD_TTL_DAYS = 30; // 奖励积分有效期

/** 新用户注册赠送体验积分（已定稿 1000，见定价文档冲突裁决 #4）。 */
export const REGISTER_BONUS_CREDITS = 1_000;

/** 会员赠送积分有效期（文档口径：31 天，到期自动清零）。 */
export const MEMBER_GRANT_TTL_DAYS = 31;

/** 折扣基点满分：10000 = 无折扣，8000 = 8 折。 */
export const DISCOUNT_BPS_FULL = 10_000;

/**
 * 定价规则页默认值（image18/19 权威口径）。接口 pricing_rules 缺项时用这些值。
 * 注意：后端 pricing_rules 目前只有 image/video_fast/video_standard/agent_skill
 * 四类键；风格迁移、提示词、音色为文档口径补充行，暂无配置键。
 */
export const DEFAULT_PRICING = {
  image: { small_512: 20, standard_1024: 50, large: 80 },
  styleTransfer: 40, // 风格迁移 1024×1024（文档口径，后端暂无配置键）
  videoFastPerSecond: 8,
  videoStandardPerSecond: 12,
  agentStoryboard: 30, // 漫剧导演 Agent 生成分镜节点树 / 次
  agentPrompt: 20, // 剧本直出美术资产提示词 / 次
  agentVoice: 15, // 角色音色定制 / 次 / 角色
} as const;

/** 免费版（非会员）基线口径：并发 2 图 / 1 视频（文档 image18 对比表）。 */
export const FREE_TIER = {
  name: "免费版",
  imageConcurrency: 2,
  videoConcurrency: 1,
  discountBps: DISCOUNT_BPS_FULL,
} as const;

/** 列表分页大小（消耗明细 / 积分流水 / 邀请记录）。 */
export const MEMBER_PAGE_SIZE = 10;

/** 消耗明细任务类型筛选选项（后端 TaskType*）。 */
export const TASK_TYPE_OPTIONS = [
  { value: "", label: "全部类型" },
  { value: "image", label: "图片生成" },
  { value: "video_fast", label: "视频 Fast 渲染" },
  { value: "video_standard", label: "视频标准版渲染" },
  { value: "agent_skill", label: "Agent 技能调用" },
] as const;

/** 消耗明细积分类型筛选（按限时/永久拆分列归并）。 */
export const CREDIT_KIND_OPTIONS = [
  { value: "", label: "全部积分" },
  { value: "limited", label: "限时积分" },
  { value: "permanent", label: "永久积分" },
] as const;

/** 消耗明细状态筛选（对应后端 consumptions 的 status 参数）。 */
export const CONSUMPTION_STATUS_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: "settled", label: "成功（已扣费）" },
  { value: "reserved", label: "进行中（冻结中）" },
  { value: "released", label: "失败/取消（未扣费）" },
] as const;

/** 积分流水类型筛选（后端 LedgerType*，文档 7 类型）。 */
export const LEDGER_TYPE_OPTIONS = [
  { value: "", label: "全部流水" },
  { value: "recharge", label: "充值购买" },
  { value: "member_monthly", label: "会员月发" },
  { value: "consume", label: "任务消耗" },
  { value: "admin_add", label: "后台调增" },
  { value: "admin_subtract", label: "后台调减" },
  { value: "expire", label: "过期扣减" },
  { value: "activity_bonus", label: "活动赠送" },
] as const;

/** 时间范围快捷筛选（天）；0 = 全部。 */
export const TIME_RANGE_OPTIONS = [
  { value: 0, label: "全部时间" },
  { value: 7, label: "近 7 天" },
  { value: 30, label: "近 30 天" },
  { value: 90, label: "近 90 天" },
] as const;

/**
 * 支付渠道。真实渠道（支付宝/微信）后端商户凭证未接入，固定禁用态「即将上线」；
 * mock 渠道仅开发环境可用（生产构建中隐藏）。
 */
export const PAY_CHANNELS = [
  { value: "alipay", label: "支付宝", enabled: false, note: "即将上线" },
  { value: "wechat", label: "微信支付", enabled: false, note: "即将上线" },
  { value: "mock", label: "模拟支付", enabled: import.meta.env.DEV, note: "仅开发环境" },
] as const;
