package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

// Credit ledger engine errors.
var (
	ErrInvalidCreditAmount = errors.New("credit amount must be positive")
	ErrOrderNotRefundable  = errors.New("order is not in a refundable state")
)

// Default register bonus values; runtime overrides live in billing_configs.
// 已定稿（2026-09-17）：新用户注册赠 1000 体验积分。
const (
	defaultRegisterBonusCredits  = 1000
	defaultRegisterBonusTTLDays  = model.CreditGrantMemberMonthlyTTLDays // 体验积分默认与会员赠送一致：31 天
	creditLedgerOperatorSystem   = "system"
	creditLedgerOperatorAdminTag = "admin:"
)

// CreditQuote is a fully priced charge request. Pricing comes from
// billing_configs upstream (WP-M7/M13); the engine never interprets prices.
type CreditQuote struct {
	JobID    string
	TaskType string
	Model    string
	Params   map[string]any
	Credits  int64
}

// GrantInput describes one time-limited grant. Permanent credits (recharge,
// admin adjustments) do not use this path — they move the account directly.
type GrantInput struct {
	UserID     string
	SourceType string // model.GrantSource*
	Amount     int64
	TTL        time.Duration // 过期时长；<= 0 时按来源取默认
	PeriodKey  string        // 幂等键；空则仓储生成一次性键
	RelatedID  string
	OrderID    string
	OperatorID string
}

// CreditOverview is the user-facing dual-balance snapshot
// (永久余额/冻结 + 限时可用/冻结 + 最近到期批次).
type CreditOverview struct {
	PermanentBalance   int64      `json:"permanent_balance"`
	PermanentFrozen    int64      `json:"permanent_frozen"`
	PermanentAvailable int64      `json:"permanent_available"`
	LimitedAvailable   int64      `json:"limited_available"`
	LimitedFrozen      int64      `json:"limited_frozen"`
	NextExpiryAt       *time.Time `json:"next_expiry_at"`
	NextExpiryAmount   int64      `json:"next_expiry_amount"`
}

// CreditLedgerService is the WP-M2 ledger engine. All balance mutations funnel
// through repository transactions; this layer owns validation, idempotency-key
// construction, config lookups, and cross-repo composition (each composed step
// is independently idempotent so a crash mid-refund is safe to retry).
type CreditLedgerService struct {
	credits     repository.CreditRepository
	memberships repository.MembershipRepository
	billing     repository.BillingRepository
	clock       func() time.Time
}

func NewCreditLedgerService(credits repository.CreditRepository, memberships repository.MembershipRepository, billing repository.BillingRepository) *CreditLedgerService {
	return &CreditLedgerService{
		credits:     credits,
		memberships: memberships,
		billing:     billing,
		clock:       func() time.Time { return time.Now().UTC() },
	}
}

// SetClock overrides the time source (tests). All engine timestamps — grants,
// expiry sweeps, ledger entries — come from this clock.
func (s *CreditLedgerService) SetClock(clock func() time.Time) {
	if clock != nil {
		s.clock = clock
	}
}

func (s *CreditLedgerService) now() time.Time { return s.clock() }

// ---------------------------------------------------------------------------
// 任务生命周期（WP-M3 接线点）
// ---------------------------------------------------------------------------

// Reserve freezes credits for one job, FEFO across grant batches then the
// permanent pool. Duplicate job submissions replay the existing reservation.
func (s *CreditLedgerService) Reserve(userID string, quote CreditQuote) (repository.ReserveOutcome, error) {
	if quote.Credits <= 0 {
		return repository.ReserveOutcome{}, ErrInvalidCreditAmount
	}
	params, err := json.Marshal(quote.Params)
	if err != nil {
		return repository.ReserveOutcome{}, err
	}
	if params == nil {
		params = []byte("{}")
	}
	return s.credits.Reserve(repository.ReserveInput{
		JobID:    quote.JobID,
		UserID:   userID,
		TaskType: quote.TaskType,
		Model:    quote.Model,
		Params:   model.JSONB(params),
		Credits:  quote.Credits,
		Now:      s.now(),
	})
}

// Settle charges a succeeded job from its freeze-time snapshot. Idempotent.
func (s *CreditLedgerService) Settle(jobID string) (repository.SettleOutcome, error) {
	return s.credits.Settle(jobID, s.now())
}

// Release unfreezes a failed/canceled job without charging. Idempotent.
func (s *CreditLedgerService) Release(jobID string) (repository.ReleaseOutcome, error) {
	return s.credits.Release(jobID, s.now())
}

// ---------------------------------------------------------------------------
// 发放与过期（WP-M4 调度器调用引擎入口）
// ---------------------------------------------------------------------------

// Grant issues one time-limited batch. PeriodKey collisions replay the
// existing grant — monthly grants, register bonuses, and purchase grants all
// derive their keys from stable identities (见设计 §4.3 幂等矩阵).
func (s *CreditLedgerService) Grant(input GrantInput) (repository.GrantOutcome, error) {
	if input.Amount <= 0 {
		return repository.GrantOutcome{}, ErrInvalidCreditAmount
	}
	now := s.now()
	if input.TTL <= 0 {
		input.TTL = s.defaultTTLFor(input.SourceType)
	}
	operator := input.OperatorID
	if operator == "" {
		operator = creditLedgerOperatorSystem
	}
	grant := model.CreditGrant{
		UserID:          input.UserID,
		SourceType:      input.SourceType,
		AmountTotal:     input.Amount,
		AmountRemaining: input.Amount,
		GrantedAt:       now,
		ExpiresAt:       now.Add(input.TTL),
		Status:          model.GrantStatusActive,
		PeriodKey:       input.PeriodKey,
		RelatedID:       input.RelatedID,
	}
	return s.credits.CreateGrantWithLedger(grant, ledgerTypeForGrantSource(input.SourceType), operator, input.OrderID, now)
}

// GrantMonthlyMembershipCredits implements 会员每月发放 on the membership's own
// 30-day anniversary cycle (见 model.CreditMembershipPeriodDays 注释，防月末
// 双发窗口)。period key pins one grant per membership per period，31 天有效期。
func (s *CreditLedgerService) GrantMonthlyMembershipCredits(membership model.UserMembership, plan model.MembershipPlan) (repository.GrantOutcome, error) {
	if membership.Status != model.MembershipStatusActive || s.now().Before(membership.StartedAt) || !s.now().Before(membership.ExpiresAt) {
		return repository.GrantOutcome{}, nil
	}
	if plan.Code == model.PlanCodeInternal && membership.MonthlyCreditsOverride != nil {
		plan.MonthlyCredits = *membership.MonthlyCreditsOverride
	}
	if plan.MonthlyCredits <= 0 {
		return repository.GrantOutcome{}, nil
	}
	periodIndex := MembershipPeriodIndex(membership.StartedAt, s.now())
	if periodIndex < 0 {
		periodIndex = 0
	}
	return s.Grant(GrantInput{
		UserID:     membership.UserID,
		SourceType: model.GrantSourceMemberMonthly,
		Amount:     plan.MonthlyCredits,
		TTL:        time.Duration(model.CreditGrantMemberMonthlyTTLDays) * 24 * time.Hour,
		PeriodKey:  fmt.Sprintf("member_monthly:%s:p%03d", membership.ID, periodIndex),
		RelatedID:  membership.ID,
	})
}

// MembershipPeriodIndex returns which 30-day period of the membership `now`
// falls into (0-based); negative when now is before StartedAt.
func MembershipPeriodIndex(startedAt time.Time, now time.Time) int {
	if now.Before(startedAt) {
		return -1
	}
	return int(now.Sub(startedAt) / (time.Duration(model.CreditMembershipPeriodDays) * 24 * time.Hour))
}

// GrantRegisterBonus implements 新用户注册赠 1000 体验积分（可配置）.
func (s *CreditLedgerService) GrantRegisterBonus(userID string) (repository.GrantOutcome, error) {
	amount := s.configInt(model.BillingConfigKeyRegisterBonus, defaultRegisterBonusCredits)
	if amount == 0 {
		return repository.GrantOutcome{}, nil
	}
	ttlDays := s.configInt(model.BillingConfigKeyRegisterBonusTTL, defaultRegisterBonusTTLDays)
	return s.Grant(GrantInput{
		UserID:     userID,
		SourceType: model.GrantSourceRegisterBonus,
		Amount:     amount,
		TTL:        time.Duration(ttlDays) * 24 * time.Hour,
		PeriodKey:  "register:" + userID,
	})
}

// ExpireGrantsBefore sweeps expired grant batches. Every batch is expired via
// its own idempotency key, so concurrent schedulers are harmless (不丢数据、
// 不重复扣). Returns the number of batches swept.
func (s *CreditLedgerService) ExpireGrantsBefore(limit int) (int, error) {
	grants, err := s.credits.ListExpirableGrants(s.now(), limit)
	if err != nil {
		return 0, err
	}
	swept := 0
	for _, grant := range grants {
		outcome, err := s.credits.ExpireGrant(grant.ID, s.now())
		if err != nil {
			return swept, err
		}
		if !outcome.AlreadyExpired {
			swept++
		}
	}
	return swept, nil
}

// ExpireMembershipGrants force-expires every member-monthly grant attached to
// a membership — 会员到期：特权立刻失效 + 当月剩余赠送积分同步清零。
// Frozen portions stay reserved for in-flight tasks.
func (s *CreditLedgerService) ExpireMembershipGrants(membershipID string) error {
	grants, err := s.activeGrantsForRelated(membershipID, model.GrantSourceMemberMonthly)
	if err != nil {
		return err
	}
	for _, grant := range grants {
		if _, err := s.credits.ExpireGrant(grant.ID, s.now()); err != nil {
			return err
		}
	}
	return nil
}

// SweepExpiredMemberships transitions due memberships to expired and sweeps
// their current-period grants. Each step is idempotent.
func (s *CreditLedgerService) SweepExpiredMemberships(limit int) (int, error) {
	memberships, err := s.memberships.ListActiveMembershipsExpiringBefore(s.now(), limit)
	if err != nil {
		return 0, err
	}
	swept := 0
	for _, membership := range memberships {
		// Keep the active row discoverable until every grant has been swept.
		// Replaying a partially completed sweep is safe through grant idempotency.
		if err := s.ExpireMembershipGrants(membership.ID); err != nil {
			return swept, err
		}
		changed, err := s.memberships.UpdateMembershipStatus(membership.ID, model.MembershipStatusActive, model.MembershipStatusExpired)
		if err != nil {
			return swept, err
		}
		if !changed {
			continue
		}
		swept++
	}
	return swept, nil
}

// ---------------------------------------------------------------------------
// 管理与对账
// ---------------------------------------------------------------------------

// RechargePermanent credits a paid credit-pack order into the permanent pool.
// 幂等键 = 订单号，渠道回调重复触发不重复入账。
func (s *CreditLedgerService) RechargePermanent(userID string, credits int64, orderID string) (repository.AdjustOutcome, error) {
	if credits <= 0 {
		return repository.AdjustOutcome{}, ErrInvalidCreditAmount
	}
	return s.credits.AdjustPermanent(userID, credits, model.LedgerTypeRecharge, creditLedgerOperatorSystem, "order:"+orderID, s.now())
}

// Adjust applies an admin manual adjustment to the permanent pool. The nonce
// is the idempotency key; entry type follows the delta sign (调增/调减).
func (s *CreditLedgerService) Adjust(userID string, delta int64, operatorID string, nonce string) (repository.AdjustOutcome, error) {
	if delta == 0 {
		return repository.AdjustOutcome{}, ErrInvalidCreditAmount
	}
	entryType := model.LedgerTypeAdminAdd
	if delta < 0 {
		entryType = model.LedgerTypeAdminSubtract
	}
	return s.credits.AdjustPermanent(userID, delta, entryType, creditLedgerOperatorAdminTag+operatorID, nonce, s.now())
}

// RefundOrder rolls a paid order back. Composition across repositories is
// intentionally step-wise: each step carries its own idempotency key, so a
// crash anywhere leaves a re-runnable partial state (不丢数据).
func (s *CreditLedgerService) RefundOrder(orderID string, operatorID string) (model.Order, error) {
	order, err := s.billing.GetOrderByID(orderID)
	if err != nil {
		return model.Order{}, err
	}

	switch order.OrderType {
	case model.OrderTypeCreditPack:
		pkg, err := s.billing.GetPackageByID(order.PackageID)
		if err != nil {
			return model.Order{}, err
		}
		// 允许余额转负：已消耗的积分记为负余额，后续充值冲抵。
		if _, err := s.credits.DeductPermanentForRefund(order.UserID, pkg.Credits, order.ID, s.now()); err != nil {
			return model.Order{}, err
		}
	case model.OrderTypeMemberMonthly, model.OrderTypeMemberYearly:
		membership, err := s.memberships.GetMembershipByOrderID(order.ID)
		if err != nil && !errors.Is(err, repository.ErrMembershipNotFound) {
			return model.Order{}, err
		}
		if err == nil {
			if _, err := s.memberships.UpdateMembershipStatus(membership.ID, model.MembershipStatusActive, model.MembershipStatusRevoked); err != nil {
				return model.Order{}, err
			}
			if err := s.ExpireMembershipGrants(membership.ID); err != nil {
				return model.Order{}, err
			}
		}
	default:
		return model.Order{}, fmt.Errorf("unsupported order type %q", order.OrderType)
	}

	updated, changed, err := s.billing.UpdateOrderStatus(orderID, model.OrderStatusPaid, model.OrderStatusRefunded, s.now())
	if err != nil {
		return model.Order{}, err
	}
	if !changed {
		// 已退款或状态被并发修改；返回当前状态，保证幂等。
		return s.billing.GetOrderByID(orderID)
	}
	return updated, nil
}

// Overview computes the dual-balance snapshot for the member center.
func (s *CreditLedgerService) Overview(userID string) (CreditOverview, error) {
	now := s.now()
	account, err := s.credits.EnsureAccount(userID, now)
	if err != nil {
		return CreditOverview{}, err
	}
	grants, err := s.credits.ListActiveGrants(userID, now)
	if err != nil {
		return CreditOverview{}, err
	}

	overview := CreditOverview{
		PermanentBalance: account.PermanentBalance,
		PermanentFrozen:  account.PermanentFrozen,
	}
	overview.PermanentAvailable = account.PermanentBalance - account.PermanentFrozen
	if overview.PermanentAvailable < 0 {
		overview.PermanentAvailable = 0
	}
	for _, grant := range grants {
		overview.LimitedAvailable += grant.AmountRemaining - grant.AmountFrozen
		overview.LimitedFrozen += grant.AmountFrozen
		if spendable := grant.AmountRemaining - grant.AmountFrozen; spendable > 0 && overview.NextExpiryAt == nil {
			expiry := grant.ExpiresAt // ListActiveGrants 已是 FEFO 序
			overview.NextExpiryAt = &expiry
			overview.NextExpiryAmount = spendable
		}
	}
	return overview, nil
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// ledgerTypeForGrantSource maps grant sources onto the document's seven ledger
// categories: 注册/邀请/活动赠送都归入 activity_bonus（活动赠送）。
func ledgerTypeForGrantSource(sourceType string) string {
	switch sourceType {
	case model.GrantSourceMemberMonthly:
		return model.LedgerTypeMemberMonthly
	case model.GrantSourceAdminAdjust:
		return model.LedgerTypeAdminAdd
	default:
		return model.LedgerTypeActivityBonus
	}
}

func (s *CreditLedgerService) defaultTTLFor(sourceType string) time.Duration {
	days := model.CreditGrantMemberMonthlyTTLDays
	if sourceType == model.GrantSourceInviteReward {
		days = model.CreditGrantInviteRewardTTLDays
	}
	return time.Duration(days) * 24 * time.Hour
}

func (s *CreditLedgerService) configInt(key string, fallback int64) int64 {
	config, err := s.billing.GetConfig(key)
	if err != nil {
		return fallback
	}
	var value int64
	if err := json.Unmarshal(config.Value, &value); err != nil || value < 0 {
		return fallback
	}
	return value
}

func (s *CreditLedgerService) activeGrantsForRelated(relatedID string, sourceType string) ([]model.CreditGrant, error) {
	// 仓储未提供按 RelatedID 的查询，经由账户维度过滤；批次量级小（每用户每月
	// 一批），内存过滤代价可忽略。若未来量级增长，应在 CreditRepository 增加
	// ListGrantsByRelated(relatedID, sourceType)。
	var result []model.CreditGrant
	grants, err := s.credits.ListGrantsByRelatedID(relatedID, sourceType)
	if err != nil {
		return nil, err
	}
	for _, grant := range grants {
		if grant.Status == model.GrantStatusActive {
			result = append(result, grant)
		}
	}
	return result, nil
}
