package service

import (
	"context"
	"log"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

const (
	// CreditSchedulerBatchSize caps one page of the membership scan. Pages are
	// drained in a loop until a short page arrives, so the value only bounds
	// per-query memory, never coverage.
	CreditSchedulerBatchSize = 500
	// creditSchedulerLockName is the advisory-lock identity shared by all API
	// replicas.
	creditSchedulerLockName = "membership-credit-scheduler"
)

// CreditScheduler is the WP-M4 periodic driver: monthly credit grants,
// membership expiry sweeps, and grant expiry sweeps. Every engine step is
// idempotent (period keys / status guards / ledger keys), so the advisory lock
// only reduces duplicate work across replicas — correctness never depends on it.
type CreditScheduler struct {
	engine      *CreditLedgerService
	credits     repository.CreditRepository
	memberships repository.MembershipRepository
	interval    time.Duration
}

func NewCreditScheduler(engine *CreditLedgerService, credits repository.CreditRepository, memberships repository.MembershipRepository, interval time.Duration) *CreditScheduler {
	if interval <= 0 {
		interval = time.Minute
	}
	return &CreditScheduler{engine: engine, credits: credits, memberships: memberships, interval: interval}
}

// Start runs the loop until ctx is canceled, following the existing
// Start*Maintenance goroutine pattern.
func (s *CreditScheduler) Start(ctx context.Context) {
	ticker := time.NewTicker(s.interval)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if _, err := s.RunOnce(ctx); err != nil {
					log.Printf("event=credit_scheduler_failed reason=%q", err.Error())
				}
			}
		}
	}()
}

// SchedulerRunResult summarizes one sweep for observability and tests.
type SchedulerRunResult struct {
	MonthlyGranted     int
	MembershipsExpired int
	GrantsExpired      int
	Locked             bool // false = 另一副本正在执行，本轮跳过
}

// RunOnce executes one full sweep: 到期会员清扫 → 月发 → 积分过期清零。
// 顺序保证到期会员不会在本轮再领到月发。
func (s *CreditScheduler) RunOnce(ctx context.Context) (SchedulerRunResult, error) {
	release, acquired, err := s.credits.TryAcquireSchedulerLock(creditSchedulerLockName)
	if err != nil {
		return SchedulerRunResult{}, err
	}
	if !acquired {
		return SchedulerRunResult{Locked: false}, nil
	}
	defer release()

	result := SchedulerRunResult{Locked: true}

	result.MembershipsExpired, err = s.engine.SweepExpiredMemberships(CreditSchedulerBatchSize)
	if err != nil {
		return result, err
	}
	if err = s.memberships.ActivateDueMemberships(s.engine.now(), CreditSchedulerBatchSize); err != nil {
		return result, err
	}
	if result.MonthlyGranted, err = s.grantMonthlyCredits(ctx); err != nil {
		return result, err
	}
	if result.GrantsExpired, err = s.engine.ExpireGrantsBefore(CreditSchedulerBatchSize); err != nil {
		return result, err
	}
	return result, nil
}

// grantMonthlyCredits pages all active memberships and issues the current
// period's grant. Period-key idempotency makes re-issuance a no-op.
func (s *CreditScheduler) grantMonthlyCredits(ctx context.Context) (int, error) {
	granted := 0
	for offset := 0; ; offset += CreditSchedulerBatchSize {
		if ctx.Err() != nil {
			return granted, ctx.Err()
		}
		memberships, err := s.memberships.ListActiveMemberships(CreditSchedulerBatchSize, offset)
		if err != nil {
			return granted, err
		}
		for _, membership := range memberships {
			plan, err := s.memberships.GetPlanByID(membership.PlanID)
			if err != nil {
				log.Printf("membership_id=%s event=monthly_grant_plan_missing plan_id=%s", membership.ID, membership.PlanID)
				continue
			}
			outcome, err := s.engine.GrantMonthlyMembershipCredits(membership, plan)
			if err != nil {
				log.Printf("membership_id=%s event=monthly_grant_failed reason=%q", membership.ID, err.Error())
				continue
			}
			if outcome.Created {
				granted++
			}
		}
		if len(memberships) < CreditSchedulerBatchSize {
			return granted, nil
		}
	}
}

// GrantForMembershipNow lets the purchase flow (WP-M8) issue the first period's
// credits immediately instead of waiting for the next scheduler tick.
func (s *CreditScheduler) GrantForMembershipNow(membership model.UserMembership, plan model.MembershipPlan) (repository.GrantOutcome, error) {
	return s.engine.GrantMonthlyMembershipCredits(membership, plan)
}
