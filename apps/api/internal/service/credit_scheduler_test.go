package service

import (
	"context"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

// schedulerFixture assembles the WP-M4 scheduler over Memory repositories.
type schedulerFixture struct {
	scheduler   *CreditScheduler
	engine      *CreditLedgerService
	credits     *repository.MemoryCreditRepository
	memberships *repository.MemoryMembershipRepository
	billing     *repository.MemoryBillingRepository
	current     time.Time
}

func newSchedulerFixture(t *testing.T) *schedulerFixture {
	t.Helper()
	fx := &schedulerFixture{
		credits:     repository.NewMemoryCreditRepository(),
		memberships: repository.NewMemoryMembershipRepository(),
		billing:     repository.NewMemoryBillingRepository(),
		current:     time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC),
	}
	fx.engine = NewCreditLedgerService(fx.credits, fx.memberships, fx.billing)
	fx.engine.SetClock(func() time.Time { return fx.current })
	fx.scheduler = NewCreditScheduler(fx.engine, fx.credits, fx.memberships, time.Minute)
	return fx
}

func (fx *schedulerFixture) seedPlan(t *testing.T) model.MembershipPlan {
	t.Helper()
	plan := model.MembershipPlan{
		ID: "plan_198", Code: model.PlanCodeMember198, Name: "198 会员",
		PriceMonthCents: 19800, MonthlyCredits: 19800,
	}
	if err := fx.memberships.SeedPlans([]model.MembershipPlan{plan}); err != nil {
		t.Fatal(err)
	}
	seeded, err := fx.memberships.GetPlanByCode(model.PlanCodeMember198)
	if err != nil {
		t.Fatal(err)
	}
	return seeded
}

func (fx *schedulerFixture) activeMember(t *testing.T, userID string, startedAt time.Time, expiresAt time.Time) model.UserMembership {
	t.Helper()
	membership, err := fx.memberships.CreateMembership(model.UserMembership{
		UserID: userID, PlanID: fx.seedPlan(t).ID, Status: model.MembershipStatusActive,
		Source: model.MembershipSourcePurchase, StartedAt: startedAt, ExpiresAt: expiresAt,
	})
	if err != nil {
		t.Fatal(err)
	}
	return membership
}

func TestSchedulerGrantsMonthlyAndIsIdempotent(t *testing.T) {
	fx := newSchedulerFixture(t)
	// 会员有效期 90 天，覆盖两个发放周期仍活跃。
	fx.activeMember(t, "user_s1", fx.current.Add(-time.Hour), fx.current.Add(90*24*time.Hour))

	result, err := fx.scheduler.RunOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !result.Locked || result.MonthlyGranted != 1 {
		t.Fatalf("result = %+v, want locked with 1 grant", result)
	}

	// 同周期重跑不再发放。
	result, err = fx.scheduler.RunOnce(context.Background())
	if err != nil || result.MonthlyGranted != 0 {
		t.Fatalf("repeat result = %+v, want 0 grants", result)
	}

	overview, _ := fx.engine.Overview("user_s1")
	if overview.LimitedAvailable != 19800 {
		t.Fatalf("limited = %d, want 19800", overview.LimitedAvailable)
	}

	// 推进一个周年周期（30 天）→ 发放第二批。
	fx.current = fx.current.Add(31 * 24 * time.Hour)
	// 第一批已过 31 天有效期 → 同轮应先过期清零再发第二批。
	result, err = fx.scheduler.RunOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.MonthlyGranted != 1 || result.GrantsExpired != 1 {
		t.Fatalf("result = %+v, want 1 grant + 1 expiry", result)
	}
	overview, _ = fx.engine.Overview("user_s1")
	if overview.LimitedAvailable != 19800 {
		t.Fatalf("limited after rollover = %d, want 19800（第一批已清零）", overview.LimitedAvailable)
	}
}

func TestSchedulerDoesNotGrantExpiredMembership(t *testing.T) {
	fx := newSchedulerFixture(t)
	// 已到期但尚未被清扫的会员：本轮应先标记过期，不发月发。
	fx.activeMember(t, "user_s2", fx.current.Add(-40*24*time.Hour), fx.current.Add(-time.Hour))

	result, err := fx.scheduler.RunOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.MembershipsExpired != 1 || result.MonthlyGranted != 0 {
		t.Fatalf("result = %+v, want 1 expired membership, 0 grants", result)
	}
}

func TestSchedulerSweepsExpiredGrants(t *testing.T) {
	fx := newSchedulerFixture(t)
	// 直接发放一个已过期的批次。
	if _, err := fx.credits.CreateGrantWithLedger(model.CreditGrant{
		UserID: "user_s3", SourceType: model.GrantSourceActivity,
		AmountTotal: 500, AmountRemaining: 500,
		GrantedAt: fx.current.Add(-40 * 24 * time.Hour), ExpiresAt: fx.current.Add(-9 * 24 * time.Hour),
		Status: model.GrantStatusActive, PeriodKey: "activity:s3:old",
	}, model.LedgerTypeActivityBonus, "system", "", fx.current.Add(-40*24*time.Hour)); err != nil {
		t.Fatal(err)
	}

	result, err := fx.scheduler.RunOnce(context.Background())
	if err != nil || result.GrantsExpired != 1 {
		t.Fatalf("result = %+v, want 1 expired grant", result)
	}
	overview, _ := fx.engine.Overview("user_s3")
	if overview.LimitedAvailable != 0 {
		t.Fatalf("limited = %d, want 0（过期清零）", overview.LimitedAvailable)
	}

	// 重跑幂等。
	result, err = fx.scheduler.RunOnce(context.Background())
	if err != nil || result.GrantsExpired != 0 {
		t.Fatalf("repeat result = %+v, want 0", result)
	}
}

func TestSchedulerPagesAllMemberships(t *testing.T) {
	// 分页循环：用极小批量验证 offset 翻页逻辑。通过直接构造小批量的
	// scheduler 无法注入批量（常量），改为验证多会员一轮全部覆盖。
	fx := newSchedulerFixture(t)
	for _, userID := range []string{"user_p1", "user_p2", "user_p3"} {
		fx.activeMember(t, userID, fx.current.Add(-time.Hour), fx.current.Add(29*24*time.Hour))
	}
	result, err := fx.scheduler.RunOnce(context.Background())
	if err != nil || result.MonthlyGranted != 3 {
		t.Fatalf("result = %+v, want 3 grants", result)
	}
}

func TestMembershipPeriodIndexBoundaries(t *testing.T) {
	started := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	cases := []struct {
		now  time.Time
		want int
	}{
		{started.Add(-time.Second), -1},
		{started, 0},
		{started.Add(29 * 24 * time.Hour), 0},
		{started.Add(30 * 24 * time.Hour), 1},
		{started.Add(61 * 24 * time.Hour), 2},
	}
	for _, tc := range cases {
		if got := MembershipPeriodIndex(started, tc.now); got != tc.want {
			t.Fatalf("period index at %v = %d, want %d", tc.now, got, tc.want)
		}
	}
}
