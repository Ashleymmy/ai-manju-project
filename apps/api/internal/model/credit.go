package model

import "time"

// Credit ledger constants. Centralized per project rule; every value carries a
// comment so behavior stays reviewable without reading the engine code.
const (
	// CreditsPerYuan is the base exchange rate (1 元 = 100 积分). Runtime
	// overrides live in billing_configs; this is only the fallback default.
	CreditsPerYuan = 100

	// CreditGrantMemberMonthlyTTLDays: member-monthly credits expire after
	// 31 days (文档口径：31 天有效期，非自然月), measured from GrantedAt.
	CreditGrantMemberMonthlyTTLDays = 31

	// CreditMembershipPeriodDays: monthly grants follow the membership's own
	// 30-day anniversary cycle (从 started_at 起算), not calendar months — 否则
	// 月末开通的用户会在次月 1 日立刻领到第二批，形成双发窗口。
	CreditMembershipPeriodDays = 30

	// CreditGrantInviteRewardTTLDays: invite rewards expire after 30 days
	// (image12/image17 原型口径).
	CreditGrantInviteRewardTTLDays = 30

	// CreditBucketPermanent: cash-purchased credits, never expire.
	CreditBucketPermanent = "permanent"
	// CreditBucketGrant: time-limited credits tracked per grant batch.
	CreditBucketGrant = "grant"

	// GrantSourceMemberMonthly / RegisterBonus / InviteReward / Activity /
	// AdminAdjust identify why a grant batch exists. PeriodKey uniqueness
	// derives from these, e.g. "member_monthly:{membership_id}:p03".
	GrantSourceMemberMonthly = "member_monthly"
	GrantSourceRegisterBonus = "register_bonus"
	GrantSourceInviteReward  = "invite_reward"
	GrantSourceActivity      = "activity"
	GrantSourceAdminAdjust   = "admin_adjust"

	// GrantStatusActive has spendable balance; GrantStatusExhausted is fully
	// consumed; GrantStatusExpired passed ExpiresAt and was swept.
	GrantStatusActive    = "active"
	GrantStatusExhausted = "exhausted"
	GrantStatusExpired   = "expired"

	// Ledger entry types follow the document's seven categories. Invite and
	// register rewards are recorded as LedgerTypeActivityBonus (活动赠送)
	// because the document treats them as campaign credits.
	LedgerTypeRecharge      = "recharge"       // 充值购买
	LedgerTypeMemberMonthly = "member_monthly" // 会员每月发放
	LedgerTypeConsume       = "consume"        // 任务消耗
	LedgerTypeAdminAdd      = "admin_add"      // 后台手动调增
	LedgerTypeAdminSubtract = "admin_subtract" // 后台手动调减
	LedgerTypeExpire        = "expire"         // 过期扣减
	LedgerTypeActivityBonus = "activity_bonus" // 活动赠送（注册/邀请/活动）
	// LedgerTypeRefundRollback is an engineering addition for WP-M8 refunds:
	// deducting credits that a refunded order previously granted.
	LedgerTypeRefundRollback = "refund_rollback"

	// TaskConsumptionStatusReserved means credits are frozen against the job;
	// Settled means the job succeeded and credits were charged from the frozen
	// snapshot; Released means the job failed/was canceled and the freeze was
	// returned without any ledger movement (失败/取消不扣费).
	TaskConsumptionStatusReserved = "reserved"
	TaskConsumptionStatusSettled  = "settled"
	TaskConsumptionStatusReleased = "released"

	// Consumption task types per 后台模块4：图片生成 / 视频 Fast / 视频标准 /
	// Agent 技能调用。
	TaskTypeImage         = "image"
	TaskTypeVideoFast     = "video_fast"
	TaskTypeVideoStandard = "video_standard"
	TaskTypeAgentSkill    = "agent_skill"
)

// CreditAccount is the per-user permanent credit pool. Time-limited credits
// live in CreditGrant batches instead — a user's visible 限时积分余额 is
// Σ(AmountRemaining - AmountFrozen) over unexpired active grants.
type CreditAccount struct {
	UserID           string    `json:"user_id" gorm:"primaryKey"`
	PermanentBalance int64     `json:"permanent_balance" gorm:"not null;default:0"` // 允许为负（退款回滚已消耗场景）
	PermanentFrozen  int64     `json:"permanent_frozen" gorm:"not null;default:0"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// CreditGrant is one batch of time-limited credits. Each batch carries its own
// ExpiresAt because 会员月发 / 注册赠送 / 邀请奖励 / 活动赠送 have different TTLs.
// PeriodKey is the idempotency backbone: re-granting the same period key is a
// no-op enforced by a unique index.
type CreditGrant struct {
	ID              string    `json:"id" gorm:"primaryKey"`
	UserID          string    `json:"user_id" gorm:"not null;index:idx_grant_user_expiry"`
	SourceType      string    `json:"source_type" gorm:"not null;index"`
	AmountTotal     int64     `json:"amount_total" gorm:"not null"`
	AmountRemaining int64     `json:"amount_remaining" gorm:"not null"`
	AmountFrozen    int64     `json:"amount_frozen" gorm:"not null;default:0"`
	GrantedAt       time.Time `json:"granted_at" gorm:"not null"`
	ExpiresAt       time.Time `json:"expires_at" gorm:"not null;index:idx_grant_user_expiry"` // FEFO 排序与过期扫描共用
	Status          string    `json:"status" gorm:"not null;index"`
	PeriodKey       string    `json:"period_key" gorm:"uniqueIndex"` // 幂等键；空字符串表示无需幂等（后台单笔调账）
	RelatedID       string    `json:"related_id" gorm:"index"`       // 订单/会员/邀请记录 id
	CreatedAt       time.Time `json:"created_at"`
}

// CreditLedgerEntry is append-only. The application layer exposes no update or
// delete path, and Postgres additionally REVOKEs UPDATE/DELETE (database.go).
// *After fields snapshot balances at write time so the ledger alone can be
// reconciled without replaying.
type CreditLedgerEntry struct {
	ID                  string    `json:"id" gorm:"primaryKey"`
	UserID              string    `json:"user_id" gorm:"not null;index:idx_ledger_user_time"`
	EntryType           string    `json:"entry_type" gorm:"not null;index"`
	Amount              int64     `json:"amount" gorm:"not null"` // 有符号：增正减负
	Bucket              string    `json:"bucket" gorm:"not null"`
	GrantID             string    `json:"grant_id" gorm:"index"` // bucket=grant 时必填
	PermanentAfter      int64     `json:"permanent_after" gorm:"not null"`
	GrantRemainingAfter int64     `json:"grant_remaining_after"` // bucket=grant 时为本批剩余快照
	OrderID             string    `json:"order_id" gorm:"index"`
	JobID               string    `json:"job_id" gorm:"index"`
	OperatorID          string    `json:"operator_id"` // "system" 或管理员 id
	IdempotencyKey      string    `json:"idempotency_key" gorm:"uniqueIndex;not null"`
	CreatedAt           time.Time `json:"created_at" gorm:"index:idx_ledger_user_time"`
}

// TaskConsumption is the reservation + settlement record for one generation
// job. Allocation snapshots the freeze-time distribution across grant batches
// and the permanent pool; Settle replays exactly this snapshot and never
// re-reads balances, so grants expiring mid-task cannot corrupt settlement.
type TaskConsumption struct {
	ID             string     `json:"id" gorm:"primaryKey"`
	JobID          string     `json:"job_id" gorm:"uniqueIndex;not null"` // 幂等：一个 job 最多一条
	UserID         string     `json:"user_id" gorm:"not null;index"`
	TaskType       string     `json:"task_type" gorm:"not null;index"`
	Model          string     `json:"model" gorm:"not null"`
	Params         JSONB      `json:"params" gorm:"type:jsonb"` // {"resolution":"1024x1024","duration_sec":10,...}
	CreditsQuoted  int64      `json:"credits_quoted" gorm:"not null"`
	CreditsSettled int64      `json:"credits_settled"` // settle 后写入实际扣减
	Allocation     JSONB      `json:"allocation" gorm:"type:jsonb"`
	Status         string     `json:"status" gorm:"not null;index"`
	CreatedAt      time.Time  `json:"created_at"`
	SettledAt      *time.Time `json:"settled_at"`
}

// CreditAllocationItem is one line of TaskConsumption.Allocation.
type CreditAllocationItem struct {
	Bucket  string `json:"bucket"`             // permanent / grant
	GrantID string `json:"grant_id,omitempty"` // bucket=grant 时必填
	Amount  int64  `json:"amount"`
}
