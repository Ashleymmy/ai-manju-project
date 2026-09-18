package model

import "time"

// Membership plan and user-membership constants. All values are centralized
// here (project rule: no scattered magic strings) and referenced by the
// repository, service, and (later) handler layers.
const (
	// PlanCodeMember198 / PlanCodeMember1980 are the two seeded paid tiers.
	// 2026-09-17 定稿：只开 ¥198 / ¥1980 两档；其余档位草案一律不进库。
	PlanCodeMember198  = "member_198"
	PlanCodeMember1980 = "member_1980"

	// MembershipStatusActive grants benefits while ExpiresAt is in the future.
	MembershipStatusActive = "active"
	// MembershipStatusExpired means the term ended; granted monthly credits for
	// the final period are swept by the ledger engine.
	MembershipStatusExpired = "expired"
	// MembershipStatusRevoked means an order refund rolled the membership back.
	MembershipStatusRevoked = "revoked"

	// MembershipSourcePurchase is a paid order; MembershipSourceAdmin is a
	// manual grant; MembershipSourceRedeem is a redemption code (WP-M14);
	// MembershipSourceCampaign covers promotions such as the 学费赠会员活动.
	MembershipSourcePurchase = "purchase"
	MembershipSourceAdmin    = "admin"
	MembershipSourceRedeem   = "redeem"
	MembershipSourceCampaign = "campaign"

	// 非会员（免费态）并发上限（已定稿档位表：Origin 图片 2 路 / 视频 1 路）。
	// 会员的上限来自其套餐的 ImageConcurrency / VideoConcurrency。
	FreeImageConcurrency = 2
	FreeVideoConcurrency = 1
)

// MembershipPlan is a purchasable membership tier. Prices are stored in cents;
// CreditDiscountBps uses basis points (10000 = no discount, 8000 = 8 折).
// All benefit fields are runtime-editable through the admin console — nothing
// here is hard-coded into business logic.
type MembershipPlan struct {
	ID                string    `json:"id" gorm:"primaryKey"`
	Code              string    `json:"code" gorm:"uniqueIndex;not null"`
	Name              string    `json:"name" gorm:"not null"`
	PriceMonthCents   int64     `json:"price_month_cents" gorm:"not null"`
	PriceYearCents    int64     `json:"price_year_cents" gorm:"not null;default:0"` // 0 = 年付未开通
	MonthlyCredits    int64     `json:"monthly_credits" gorm:"not null"`
	ImageConcurrency  int       `json:"image_concurrency" gorm:"not null;default:2"`
	VideoConcurrency  int       `json:"video_concurrency" gorm:"not null;default:1"`
	CreditDiscountBps int       `json:"credit_discount_bps" gorm:"not null;default:10000"`
	PriorityRank      int       `json:"priority_rank" gorm:"not null;default:0"` // 排队优先级，大者靠前
	Features          JSONB     `json:"features" gorm:"type:jsonb"`              // {"remove_watermark":true,"commercial":true,"agent_free":true,...}
	Enabled           bool      `json:"enabled" gorm:"not null;default:true"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

// UserMembership is one user's membership term. A user may hold many historical
// rows but at most one active row; Postgres enforces this with a partial unique
// index (WHERE status='active') created in database.go because AutoMigrate
// cannot express it, and the Memory repository enforces the same rule.
type UserMembership struct {
	ID        string    `json:"id" gorm:"primaryKey"`
	UserID    string    `json:"user_id" gorm:"not null;index"`
	PlanID    string    `json:"plan_id" gorm:"not null;index"`
	Status    string    `json:"status" gorm:"not null;index"`
	Source    string    `json:"source" gorm:"not null"`
	OrderID   string    `json:"order_id" gorm:"index"` // 来源订单，可空
	StartedAt time.Time `json:"started_at" gorm:"not null"`
	ExpiresAt time.Time `json:"expires_at" gorm:"not null;index"` // 到期判断的唯一事实源
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
