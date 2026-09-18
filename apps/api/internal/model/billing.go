package model

import "time"

// Billing constants: order types, channels, statuses, and the config keys read
// at runtime from billing_configs (定价可配，严禁硬编码).
const (
	// OrderTypeCreditPack is a direct credit purchase; OrderTypeMemberMonthly /
	// OrderTypeMemberYearly are subscription orders (后台模块3 口径).
	OrderTypeCreditPack    = "credit_pack"
	OrderTypeMemberMonthly = "member_monthly"
	OrderTypeMemberYearly  = "member_yearly"

	// PayChannelBalance is platform balance payment (文档原型第三种渠道).
	PayChannelAlipay  = "alipay"
	PayChannelWechat  = "wechat"
	PayChannelBalance = "balance"

	// OrderStatusPending → Paid; Paid → Refunded; Pending → Closed.
	OrderStatusPending  = "pending"
	OrderStatusPaid     = "paid"
	OrderStatusRefunded = "refunded"
	OrderStatusClosed   = "closed"

	// InvoiceStatusNone is default; Requested/Issued reserved for a later
	// e-invoice integration. 第一期用户端只展示「联系客服开票」。
	InvoiceStatusNone      = "none"
	InvoiceStatusRequested = "requested"
	InvoiceStatusIssued    = "issued"

	// BillingConfigKey* are the runtime-editable keys in billing_configs.
	BillingConfigKeyRegisterBonus    = "register_bonus_credits"  // int，种子 1000
	BillingConfigKeyRegisterBonusTTL = "register_bonus_ttl_days" // int，种子 31（体验积分有效期，文档未明确定义，默认与会员赠送一致）
	BillingConfigKeyInviteRewards    = "invite_rewards"          // {"inviter":2000,"invitee":500,"first_charge_bonus":1000}
	BillingConfigKeyInviteRewardTTL  = "invite_reward_ttl_days"  // int，种子 30
	BillingConfigKeyActivity         = "activity_discount"       // {"enabled":bool,"starts_at":ts,"ends_at":ts,"discount_bps":int,"applies_to":[...]}
	BillingConfigKeyPricingRules     = "pricing_rules"           // 定价规则页内容（模型/分辨率 → 积分）
	BillingConfigKeyGiftPacks        = "gift_packs"              // 礼包超市货架：[{"id","name","description","cover","price_cents","credits"|"membership_days","enabled","sort_order"}]（WP-M15，内容后定，默认空货架）
)

// CreditPackage is a direct-purchase credit bundle (后台模块5 可上下架).
type CreditPackage struct {
	ID         string    `json:"id" gorm:"primaryKey"`
	Name       string    `json:"name" gorm:"not null"`
	Credits    int64     `json:"credits" gorm:"not null"`
	PriceCents int64     `json:"price_cents" gorm:"not null"`
	Enabled    bool      `json:"enabled" gorm:"not null;default:true"`
	SortOrder  int       `json:"sort_order" gorm:"not null;default:0"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// Order is one purchase. Refund flows transition paid → refunded and roll back
// the credits the order granted (credit pack: deduct permanent, allowing a
// negative balance; membership: revoke + expire the current month's grant).
type Order struct {
	ID            string     `json:"id" gorm:"primaryKey"`
	UserID        string     `json:"user_id" gorm:"not null;index"`
	OrderType     string     `json:"order_type" gorm:"not null;index"`
	PlanID        string     `json:"plan_id" gorm:"index"`
	PackageID     string     `json:"package_id" gorm:"index"`
	AmountCents   int64      `json:"amount_cents" gorm:"not null"` // 实付（折扣后）
	Currency      string     `json:"currency" gorm:"not null;default:CNY"`
	PayChannel    string     `json:"pay_channel"`
	Status        string     `json:"status" gorm:"not null;index"`
	InvoiceStatus string     `json:"invoice_status" gorm:"not null;default:none"`
	PaidAt        *time.Time `json:"paid_at"`
	RefundedAt    *time.Time `json:"refunded_at"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

// BillingConfig is a runtime-editable key/value row. Business code reads
// through the service layer with defaults from constants — never hard-codes.
type BillingConfig struct {
	Key       string    `json:"key" gorm:"primaryKey"`
	Value     JSONB     `json:"value" gorm:"type:jsonb"`
	UpdatedBy string    `json:"updated_by"`
	UpdatedAt time.Time `json:"updated_at"`
}
