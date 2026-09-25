package service

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

// Invite service errors.
var (
	ErrInvalidInviteCode = errors.New("invite code is invalid")
	ErrCannotInviteSelf  = errors.New("cannot bind your own invite code")
)

// 邀请奖励默认值；运行时可由 billing_configs["invite_rewards"] 覆盖。
// 口径：image12 后台配置（邀请人 2000 / 被邀请人 500）+ image17 首充额外 1000。
const (
	defaultInviteInviterReward    int64 = 2000
	defaultInviteInviteeReward    int64 = 500
	defaultInviteFirstChargeBonus int64 = 1000
)

// inviteRewardsConfig mirrors billing_configs["invite_rewards"].
type inviteRewardsConfig struct {
	Inviter          int64 `json:"inviter"`
	Invitee          int64 `json:"invitee"`
	FirstChargeBonus int64 `json:"first_charge_bonus"`
}

// InviteService 邀请有礼（WP-M9）。反刷号关键设计（文档原型口径）：
// 被邀请人注册即得奖励；邀请人奖励与被邀请人首次充值绑定，未首充保持
// pending_first_recharge（待发放）。
type InviteService struct {
	invites repository.InviteRepository
	engine  *CreditLedgerService
	billing repository.BillingRepository
	clock   func() time.Time
}

func NewInviteService(invites repository.InviteRepository, engine *CreditLedgerService, billing repository.BillingRepository) *InviteService {
	return &InviteService{
		invites: invites, engine: engine, billing: billing,
		clock: func() time.Time { return time.Now().UTC() },
	}
}

// SetClock overrides the time source (tests).
func (s *InviteService) SetClock(clock func() time.Time) {
	if clock != nil {
		s.clock = clock
	}
}

// ValidateInviteCode checks a code exists — 注册前置校验：码不合规则不建账号，
// 避免注册成功但绑定失败的半成品状态。
func (s *InviteService) ValidateInviteCode(code string) error {
	if strings.TrimSpace(code) == "" {
		return ErrInvalidInviteCode
	}
	if _, err := s.invites.GetProfileByCode(code); err != nil {
		if errors.Is(err, repository.ErrInviteProfileNotFound) {
			return ErrInvalidInviteCode
		}
		return err
	}
	return nil
}

// BindInviteCode binds a new registrant to an inviter and grants the invitee
// reward immediately. 被邀请人终身只能绑定一次（数据层唯一约束防刷）。
func (s *InviteService) BindInviteCode(inviteeID string, code string) error {
	profile, err := s.invites.GetProfileByCode(code)
	if err != nil {
		if errors.Is(err, repository.ErrInviteProfileNotFound) {
			return ErrInvalidInviteCode
		}
		return err
	}
	if profile.UserID == inviteeID {
		return ErrCannotInviteSelf
	}

	rewards := s.loadRewards()
	record, err := s.invites.CreateRecord(model.InviteRecord{
		InviterID: profile.UserID, InviteeID: inviteeID,
		RewardStatus:     model.InviteRewardPendingFirstRecharge,
		InviterReward:    rewards.Inviter,
		InviteeReward:    rewards.Invitee,
		FirstChargeBonus: rewards.FirstChargeBonus,
		CreatedAt:        s.clock(),
	})
	if err != nil {
		return err
	}

	// 被邀请人注册即得（活动积分，30 天有效）。
	if _, err := s.engine.Grant(GrantInput{
		UserID:     inviteeID,
		SourceType: model.GrantSourceInviteReward,
		Amount:     record.InviteeReward,
		TTL:        time.Duration(model.CreditGrantInviteRewardTTLDays) * 24 * time.Hour,
		PeriodKey:  "invite:invitee:" + record.ID,
		RelatedID:  record.ID,
	}); err != nil {
		return err
	}
	return nil
}

// OnFirstPaidOrder releases the inviter's reward once the invitee pays for the
// first time. The guarded status transition makes concurrent/duplicate calls
// grant exactly once. Returns whether rewards were granted by this call.
func (s *InviteService) OnFirstPaidOrder(inviteeUserID string) (bool, error) {
	record, err := s.invites.GetRecordByInvitee(inviteeUserID)
	if err != nil {
		if errors.Is(err, repository.ErrInviteRecordNotFound) {
			return false, nil
		}
		return false, err
	}
	if record.RewardStatus != model.InviteRewardPendingFirstRecharge && record.RewardStatus != model.InviteRewardGranted {
		return false, nil
	}

	// 邀请人注册奖励 + 首充额外奖励合并发放为一批活动积分。
	total := record.InviterReward + record.FirstChargeBonus
	outcome, err := s.engine.Grant(GrantInput{
		UserID:     record.InviterID,
		SourceType: model.GrantSourceInviteReward,
		Amount:     total,
		TTL:        time.Duration(model.CreditGrantInviteRewardTTLDays) * 24 * time.Hour,
		PeriodKey:  "invite:inviter:" + record.ID,
		RelatedID:  record.ID,
	})
	if err != nil {
		return false, err
	}
	// Mark the reward delivered only after the idempotent ledger transaction.
	// Also replay legacy "granted" rows whose original grant failed midway.
	if _, err := s.invites.UpdateRewardStatus(record.ID, model.InviteRewardPendingFirstRecharge, model.InviteRewardGranted, s.clock()); err != nil {
		return false, err
	}
	return outcome.Created, nil
}

// InviteOverview is the user-side 邀请有礼页数据：我的邀请码 + 记录 + 累计奖励。
type InviteOverview struct {
	InviteCode        string               `json:"invite_code"`
	InviteUrl         string               `json:"invite_url"`
	InvitedCount      int                  `json:"invited_count"`
	TotalRewardEarned int64                `json:"total_reward_earned"`
	Records           []model.InviteRecord `json:"records"`
}

// Overview composes the member-center invite page. inviteBaseURL 由调用方
// （handler）从配置拼接，service 不感知域名。
func (s *InviteService) Overview(userID string, inviteBaseURL string) (InviteOverview, error) {
	profile, err := s.invites.GetOrCreateProfile(userID, s.clock())
	if err != nil {
		return InviteOverview{}, err
	}
	records, err := s.invites.ListRecordsByInviter(userID)
	if err != nil {
		return InviteOverview{}, err
	}
	overview := InviteOverview{
		InviteCode: profile.InviteCode,
		InviteUrl:  inviteBaseURL + profile.InviteCode,
		Records:    records,
	}
	for _, record := range records {
		if record.RewardStatus == model.InviteRewardGranted {
			overview.TotalRewardEarned += record.InviterReward + record.FirstChargeBonus
		}
	}
	overview.InvitedCount = len(records)
	return overview, nil
}

func (s *InviteService) loadRewards() inviteRewardsConfig {
	rewards := inviteRewardsConfig{
		Inviter:          defaultInviteInviterReward,
		Invitee:          defaultInviteInviteeReward,
		FirstChargeBonus: defaultInviteFirstChargeBonus,
	}
	config, err := s.billing.GetConfig(model.BillingConfigKeyInviteRewards)
	if err != nil {
		return rewards
	}
	var override inviteRewardsConfig
	if err := json.Unmarshal(config.Value, &override); err != nil {
		return rewards
	}
	if override.Inviter > 0 {
		rewards.Inviter = override.Inviter
	}
	if override.Invitee > 0 {
		rewards.Invitee = override.Invitee
	}
	if override.FirstChargeBonus > 0 {
		rewards.FirstChargeBonus = override.FirstChargeBonus
	}
	return rewards
}
