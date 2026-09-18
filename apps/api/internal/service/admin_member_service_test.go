package service

import (
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

func newAdminMemberService(t *testing.T) (*AdminMemberService, *repository.MemoryUserRepository, *repository.MemoryMembershipRepository, *repository.MemoryCreditRepository, *repository.MemoryBillingRepository) {
	t.Helper()
	users := repository.NewMemoryUserRepository()
	memberships := repository.NewMemoryMembershipRepository()
	credits := repository.NewMemoryCreditRepository()
	billing := repository.NewMemoryBillingRepository()
	svc := NewAdminMemberService(users, memberships, credits, billing)
	return svc, users, memberships, credits, billing
}

func seedAdminUser(t *testing.T, users *repository.MemoryUserRepository, id string, username string) {
	t.Helper()
	if _, err := users.CreateUser(model.User{
		ID: id, Username: username, DisplayName: username, PasswordHash: "x",
		Role: model.UserRoleMember, Status: model.UserStatusActive,
	}); err != nil {
		t.Fatal(err)
	}
}

func TestListMemberUsersComposesAllColumns(t *testing.T) {
	svc, users, memberships, credits, billing := newAdminMemberService(t)
	now := time.Now().UTC()

	seedAdminUser(t, users, "user_m1", "paying_user")
	seedAdminUser(t, users, "user_m2", "free_user")

	plan := model.MembershipPlan{ID: "plan_198", Code: model.PlanCodeMember198, Name: "198 会员", PriceMonthCents: 19800, MonthlyCredits: 19800}
	if err := memberships.SeedPlans([]model.MembershipPlan{plan}); err != nil {
		t.Fatal(err)
	}
	if _, err := memberships.CreateMembership(model.UserMembership{
		UserID: "user_m1", PlanID: plan.ID, Status: model.MembershipStatusActive,
		Source: model.MembershipSourcePurchase, StartedAt: now.Add(-time.Hour), ExpiresAt: now.Add(29 * 24 * time.Hour),
	}); err != nil {
		t.Fatal(err)
	}
	// 永久 500 + 限时 200。
	if _, err := credits.AdjustPermanent("user_m1", 500, model.LedgerTypeRecharge, "system", "nonce_m1", now); err != nil {
		t.Fatal(err)
	}
	if _, err := credits.CreateGrantWithLedger(model.CreditGrant{
		UserID: "user_m1", SourceType: model.GrantSourceMemberMonthly, AmountTotal: 200, AmountRemaining: 200,
		GrantedAt: now, ExpiresAt: now.Add(31 * 24 * time.Hour), Status: model.GrantStatusActive, PeriodKey: "member_monthly:user_m1:p000",
	}, model.LedgerTypeMemberMonthly, "system", "", now); err != nil {
		t.Fatal(err)
	}
	if _, err := billing.CreateOrder(model.Order{
		ID: "ord_m1", UserID: "user_m1", OrderType: model.OrderTypeMemberMonthly,
		PlanID: plan.ID, AmountCents: 19800, Status: model.OrderStatusPaid,
	}); err != nil {
		t.Fatal(err)
	}

	rows, total, err := svc.ListMemberUsers(1, 50)
	if err != nil || total != 2 || len(rows) != 2 {
		t.Fatalf("rows=%d total=%d err=%v", len(rows), total, err)
	}
	var paying, free *AdminMemberUserRow
	for i := range rows {
		switch rows[i].UserID {
		case "user_m1":
			paying = &rows[i]
		case "user_m2":
			free = &rows[i]
		}
	}
	if paying == nil || free == nil {
		t.Fatalf("rows = %+v", rows)
	}
	if paying.MemberLevel != "198 会员" || paying.MemberExpiresAt == nil {
		t.Fatalf("paying row = %+v", paying)
	}
	if paying.PermanentBalance != 500 || paying.LimitedBalance != 200 {
		t.Fatalf("paying balances = %d/%d, want 500/200", paying.PermanentBalance, paying.LimitedBalance)
	}
	if paying.TotalRechargeCents != 19800 {
		t.Fatalf("paying recharge = %d, want 19800", paying.TotalRechargeCents)
	}
	if free.MemberLevel != "" || free.MemberExpiresAt != nil || free.TotalRechargeCents != 0 {
		t.Fatalf("free row = %+v, want non-member zeros", free)
	}
}

func TestAdminDashboardAggregates(t *testing.T) {
	svc, users, _, credits, billing := newAdminMemberService(t)
	fixed := time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC)
	svc.SetClock(func() time.Time { return fixed })

	seedAdminUser(t, users, "user_d1", "a")
	seedAdminUser(t, users, "user_d2", "b")

	paidAt := fixed.Add(-time.Hour)
	if _, err := billing.CreateOrder(model.Order{ID: "ord_d1", UserID: "user_d1", OrderType: model.OrderTypeCreditPack, PackageID: "pkg", AmountCents: 600, Status: model.OrderStatusPaid, PaidAt: &paidAt}); err != nil {
		t.Fatal(err)
	}
	if _, err := billing.CreateOrder(model.Order{ID: "ord_d2", UserID: "user_d1", OrderType: model.OrderTypeCreditPack, PackageID: "pkg", AmountCents: 3000, Status: model.OrderStatusPaid, PaidAt: &paidAt}); err != nil {
		t.Fatal(err)
	}

	// 今日消耗：一条 settled 图片（2 张）+ 一条 settled 视频（10 秒）。
	if _, err := credits.AdjustPermanent("user_d1", 1000, model.LedgerTypeRecharge, "system", "nonce_d1", fixed); err != nil {
		t.Fatal(err)
	}
	if _, err := credits.Reserve(repository.ReserveInput{JobID: "job_d1", UserID: "user_d1", TaskType: model.TaskTypeImage, Model: "m", Params: model.JSONB(`{"count":2}`), Credits: 40, Now: fixed}); err != nil {
		t.Fatal(err)
	}
	if _, err := credits.Reserve(repository.ReserveInput{JobID: "job_d2", UserID: "user_d1", TaskType: model.TaskTypeVideoStandard, Model: "m", Params: model.JSONB(`{"duration_sec":10}`), Credits: 120, Now: fixed}); err != nil {
		t.Fatal(err)
	}
	if _, err := credits.Settle("job_d1", fixed); err != nil {
		t.Fatal(err)
	}
	if _, err := credits.Settle("job_d2", fixed); err != nil {
		t.Fatal(err)
	}

	dashboard, err := svc.Dashboard()
	if err != nil {
		t.Fatal(err)
	}
	if dashboard.TotalUsers != 2 || dashboard.PaidUsers != 1 {
		t.Fatalf("users = %d/%d, want 2/1", dashboard.TotalUsers, dashboard.PaidUsers)
	}
	if dashboard.GmvTodayCents != 3600 || dashboard.GmvMonthCents != 3600 {
		t.Fatalf("gmv = %d/%d, want 3600/3600", dashboard.GmvTodayCents, dashboard.GmvMonthCents)
	}
	if dashboard.CreditsConsumedToday != 160 {
		t.Fatalf("consumed today = %d, want 160", dashboard.CreditsConsumedToday)
	}
	if dashboard.ImageGenerationTotal != 1 || dashboard.VideoSecondsTotal != 10 {
		t.Fatalf("image/video = %d/%d, want 1/10", dashboard.ImageGenerationTotal, dashboard.VideoSecondsTotal)
	}
}
