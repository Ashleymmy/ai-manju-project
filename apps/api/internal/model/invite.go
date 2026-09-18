package model

import "time"

// Invite constants.
const (
	// InviteCodeLength: 8 位大写字母数字（image17 原型形如 "MJCreator88"，
	// 但实现统一为随机码，碰撞时重试）。
	InviteCodeLength = 8

	// InviteRewardPendingFirstRecharge: 邀请人奖励与被邀请人首次充值绑定，
	// 未首充保持待发放（image12 原型口径，反刷号关键设计）。
	InviteRewardPendingFirstRecharge = "pending_first_recharge"
	InviteRewardGranted              = "granted"
	InviteRewardExpired              = "expired"
)

// InviteProfile is a user's own invitation code, one per user.
type InviteProfile struct {
	UserID     string    `json:"user_id" gorm:"primaryKey"`
	InviteCode string    `json:"invite_code" gorm:"uniqueIndex;not null"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// InviteRecord binds an invitee to an inviter. InviteeID is unique — a user
// can only ever be invited once, which blocks self-referral farming at the
// data layer. Reward amounts snapshot the configured values at creation time;
// runtime reward values come from billing_configs (invite_rewards).
type InviteRecord struct {
	ID               string     `json:"id" gorm:"primaryKey"`
	InviterID        string     `json:"inviter_id" gorm:"not null;index"`
	InviteeID        string     `json:"invitee_id" gorm:"uniqueIndex;not null"`
	RewardStatus     string     `json:"reward_status" gorm:"not null;index"`
	InviterReward    int64      `json:"inviter_reward" gorm:"not null"`
	InviteeReward    int64      `json:"invitee_reward" gorm:"not null"`
	FirstChargeBonus int64      `json:"first_charge_bonus" gorm:"not null"` // 好友首充额外奖励
	GrantedAt        *time.Time `json:"granted_at"`
	CreatedAt        time.Time  `json:"created_at"`
}
