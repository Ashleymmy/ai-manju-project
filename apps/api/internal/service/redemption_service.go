package service

import (
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

// RedeemResult 兑换结果（用户端回执）。
type RedeemResult struct {
	Kind           string `json:"kind"`
	CreditsGranted int64  `json:"credits_granted,omitempty"`
	MembershipDays int    `json:"membership_days,omitempty"`
	PlanName       string `json:"plan_name,omitempty"`
}

// RedemptionService 兑换码核销（WP-M14）。「学费送一个月会员」推广通过
// kind=membership_days 的码实现，无需独立通道。
type RedemptionService struct {
	redemptions repository.RedemptionRepository
	memberships repository.MembershipRepository
	engine      *CreditLedgerService
	clock       func() time.Time
}

func NewRedemptionService(redemptions repository.RedemptionRepository, memberships repository.MembershipRepository, engine *CreditLedgerService) *RedemptionService {
	return &RedemptionService{
		redemptions: redemptions, memberships: memberships, engine: engine,
		clock: func() time.Time { return time.Now().UTC() },
	}
}

// SetClock overrides the time source (tests).
func (s *RedemptionService) SetClock(clock func() time.Time) {
	if clock != nil {
		s.clock = clock
	}
}

func (s *RedemptionService) now() time.Time { return s.clock() }

// Redeem 核销一个兑换码。核销记录先行（原子防重），发放失败可安全重试——
// 但发放幂等键挂在核销记录上，因此同一用户同码只会成功一次。
func (s *RedemptionService) Redeem(userID string, code string) (RedeemResult, error) {
	now := s.now()
	rc, err := s.redemptions.GetCodeByCode(code)
	if err != nil {
		return RedeemResult{}, err
	}
	record, err := s.redemptions.RedeemAtomic(rc.ID, userID, now)
	if err != nil {
		return RedeemResult{}, err
	}

	switch rc.Kind {
	case model.RedemptionKindCredits:
		if rc.CreditsAmount <= 0 {
			return RedeemResult{}, repository.ErrRedemptionUnavailable
		}
		validDays := rc.ValidDays
		if validDays <= 0 {
			validDays = model.RedemptionDefaultValidDays
		}
		if _, err := s.engine.Grant(GrantInput{
			UserID:     userID,
			SourceType: model.GrantSourceActivity,
			Amount:     rc.CreditsAmount,
			TTL:        time.Duration(validDays) * 24 * time.Hour,
			PeriodKey:  "redeem:" + record.ID,
			RelatedID:  rc.ID,
		}); err != nil {
			return RedeemResult{}, err
		}
		return RedeemResult{Kind: rc.Kind, CreditsGranted: rc.CreditsAmount}, nil

	case model.RedemptionKindMembershipDays:
		if rc.MembershipDays <= 0 || rc.PlanID == "" {
			return RedeemResult{}, repository.ErrRedemptionUnavailable
		}
		plan, err := s.memberships.GetPlanByID(rc.PlanID)
		if err != nil {
			return RedeemResult{}, err
		}
		// 已有活跃会员则在到期后续接（与购买续费同语义）。
		startedAt := now
		if existing, err := s.memberships.GetActiveMembership(userID, now); err == nil && existing.ExpiresAt.After(now) {
			startedAt = existing.ExpiresAt
			if _, err := s.memberships.UpdateMembershipStatus(existing.ID, model.MembershipStatusActive, model.MembershipStatusExpired); err != nil {
				return RedeemResult{}, err
			}
		}
		membership, err := s.memberships.CreateMembership(model.UserMembership{
			UserID: userID, PlanID: plan.ID, Status: model.MembershipStatusActive,
			Source:    model.MembershipSourceRedeem,
			StartedAt: startedAt, ExpiresAt: startedAt.Add(time.Duration(rc.MembershipDays) * 24 * time.Hour),
			CreatedAt: now, UpdatedAt: now,
		})
		if err != nil {
			return RedeemResult{}, err
		}
		if _, err := s.engine.GrantMonthlyMembershipCredits(membership, plan); err != nil {
			return RedeemResult{}, err
		}
		return RedeemResult{Kind: rc.Kind, MembershipDays: rc.MembershipDays, PlanName: plan.Name}, nil
	default:
		return RedeemResult{}, repository.ErrRedemptionUnavailable
	}
}
