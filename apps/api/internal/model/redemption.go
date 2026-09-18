package model

import "time"

// Redemption constants（WP-M14 兑换码中心）。
const (
	// RedemptionKindCredits 兑换积分（活动赠送批次，有效期按 ValidDays）。
	RedemptionKindCredits = "credits"
	// RedemptionKindMembershipDays 兑换会员天数（「学费送一个月会员」推广的载体）。
	RedemptionKindMembershipDays = "membership_days"

	// RedemptionCodeLength 兑换码长度（TAP-XXXX-XXXX 风格，不含连字符）。
	RedemptionCodeLength = 12
	// RedemptionDefaultValidDays 兑换所得积分的默认有效期（活动积分 30 天）。
	RedemptionDefaultValidDays = 30
)

// RedemptionCode 兑换码。MaxUses=0 表示不限使用次数；每人每码限用一次
// （redemption_records 的 code_id+user_id 唯一约束兜底）。
type RedemptionCode struct {
	ID             string     `json:"id" gorm:"primaryKey"`
	Code           string     `json:"code" gorm:"uniqueIndex;not null"`
	Kind           string     `json:"kind" gorm:"not null;index"`
	CreditsAmount  int64      `json:"credits_amount" gorm:"not null;default:0"`
	MembershipDays int        `json:"membership_days" gorm:"not null;default:0"`
	PlanID         string     `json:"plan_id" gorm:"index"`                  // kind=membership_days 时的套餐
	ValidDays      int        `json:"valid_days" gorm:"not null;default:30"` // 兑换所得积分的有效期
	MaxUses        int        `json:"max_uses" gorm:"not null;default:0"`
	UsedCount      int        `json:"used_count" gorm:"not null;default:0"`
	ExpiresAt      *time.Time `json:"expires_at"`
	Enabled        bool       `json:"enabled" gorm:"not null;default:true"`
	CreatedBy      string     `json:"created_by"`
	CreatedAt      time.Time  `json:"created_at"`
}

// RedemptionRecord 一次核销记录（append-only）。
type RedemptionRecord struct {
	ID        string    `json:"id" gorm:"primaryKey"`
	CodeID    string    `json:"code_id" gorm:"not null;uniqueIndex:idx_redemption_code_user"`
	UserID    string    `json:"user_id" gorm:"not null;uniqueIndex:idx_redemption_code_user;index"`
	CreatedAt time.Time `json:"created_at"`
}
