package service

import (
	"errors"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

// creditEngineFixture wires the engine over Memory repositories with a
// controllable clock so expiry and monthly-period behavior are deterministic.
type creditEngineFixture struct {
	service     *CreditLedgerService
	credits     *repository.MemoryCreditRepository
	memberships *repository.MemoryMembershipRepository
	billing     *repository.MemoryBillingRepository
	current     time.Time
}

func newCreditEngineFixture(t *testing.T) *creditEngineFixture {
	t.Helper()
	fx := &creditEngineFixture{
		credits:     repository.NewMemoryCreditRepository(),
		memberships: repository.NewMemoryMembershipRepository(),
		billing:     repository.NewMemoryBillingRepository(),
		current:     time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC),
	}
	fx.service = NewCreditLedgerService(fx.credits, fx.memberships, fx.billing)
	fx.service.SetClock(func() time.Time { return fx.current })
	return fx
}

func (fx *creditEngineFixture) plan() model.MembershipPlan {
	return model.MembershipPlan{
		ID: "plan_198", Code: model.PlanCodeMember198, Name: "198 会员",
		PriceMonthCents: 19800, MonthlyCredits: 19800,
	}
}

func (fx *creditEngineFixture) activeMembership(t *testing.T, userID string, orderID string, expiresAt time.Time) model.UserMembership {
	t.Helper()
	if orderID != "" {
		if _, err := fx.billing.GetOrderByID(orderID); errors.Is(err, repository.ErrOrderNotFound) {
			if _, err := fx.billing.CreateOrder(model.Order{ID: orderID, UserID: userID, PlanID: "plan_198", OrderType: model.OrderTypeMemberMonthly, Status: model.OrderStatusPaid}); err != nil {
				t.Fatal(err)
			}
		}
	}
	membership, err := fx.memberships.CreateMembership(model.UserMembership{
		UserID: userID, PlanID: "plan_198", Status: model.MembershipStatusActive,
		Source: model.MembershipSourcePurchase, OrderID: orderID,
		StartedAt: fx.current, ExpiresAt: expiresAt,
	})
	if err != nil {
		t.Fatalf("create membership: %v", err)
	}
	return membership
}

func (fx *creditEngineFixture) quote(jobID string, credits int64) CreditQuote {
	return CreditQuote{JobID: jobID, TaskType: model.TaskTypeImage, Model: "gpt-image-2", Params: map[string]any{"resolution": "1024x1024"}, Credits: credits}
}

func TestRegisterBonusDefaultsToThousandAndGrantsOnce(t *testing.T) {
	fx := newCreditEngineFixture(t)

	outcome, err := fx.service.GrantRegisterBonus("user_a")
	if err != nil || !outcome.Created {
		t.Fatalf("register bonus created=%v err=%v", outcome.Created, err)
	}
	if outcome.Grant.AmountTotal != 1000 {
		t.Fatalf("amount = %d, want 1000（已定稿）", outcome.Grant.AmountTotal)
	}
	wantExpiry := fx.current.Add(31 * 24 * time.Hour)
	if !outcome.Grant.ExpiresAt.Equal(wantExpiry) {
		t.Fatalf("expires_at = %v, want %v", outcome.Grant.ExpiresAt, wantExpiry)
	}

	again, err := fx.service.GrantRegisterBonus("user_a")
	if err != nil || again.Created {
		t.Fatalf("repeat register bonus created=%v err=%v, want idempotent", again.Created, err)
	}
}

func TestRegisterBonusConfigOverride(t *testing.T) {
	fx := newCreditEngineFixture(t)
	if err := fx.billing.UpsertConfig(model.BillingConfigKeyRegisterBonus, model.JSONB(`2500`), "admin:test", fx.current); err != nil {
		t.Fatal(err)
	}
	outcome, err := fx.service.GrantRegisterBonus("user_cfg")
	if err != nil || outcome.Grant.AmountTotal != 2500 {
		t.Fatalf("configured bonus = %d, want 2500", outcome.Grant.AmountTotal)
	}
}

func TestMonthlyGrantIsIdempotentPerPeriod(t *testing.T) {
	fx := newCreditEngineFixture(t)
	plan := fx.plan()
	// The second monthly grant requires a term still active in its second month.
	membership := fx.activeMembership(t, "user_m", "ord_m1", fx.current.Add(60*24*time.Hour))

	first, err := fx.service.GrantMonthlyMembershipCredits(membership, plan)
	if err != nil || !first.Created {
		t.Fatalf("first monthly grant created=%v err=%v", first.Created, err)
	}
	second, err := fx.service.GrantMonthlyMembershipCredits(membership, plan)
	if err != nil || second.Created {
		t.Fatalf("same-period grant created=%v, want idempotent", second.Created)
	}

	// 进入下一个 30 天周年周期后发放新批次。
	fx.current = fx.current.Add(31 * 24 * time.Hour)
	third, err := fx.service.GrantMonthlyMembershipCredits(membership, plan)
	if err != nil || !third.Created {
		t.Fatalf("next-period grant created=%v err=%v", third.Created, err)
	}
}

func TestOverviewReportsDualBalances(t *testing.T) {
	fx := newCreditEngineFixture(t)
	if _, err := fx.service.GrantRegisterBonus("user_o"); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.service.Adjust("user_o", 600, "ops", "nonce_o1"); err != nil {
		t.Fatal(err)
	}

	overview, err := fx.service.Overview("user_o")
	if err != nil {
		t.Fatal(err)
	}
	if overview.PermanentBalance != 600 || overview.LimitedAvailable != 1000 {
		t.Fatalf("overview = %+v, want permanent 600 limited 1000", overview)
	}
	if overview.NextExpiryAt == nil || overview.NextExpiryAmount != 1000 {
		t.Fatalf("next expiry = %+v amount %d", overview.NextExpiryAt, overview.NextExpiryAmount)
	}
}

func TestReserveSettleConsumesLimitedBeforePermanent(t *testing.T) {
	fx := newCreditEngineFixture(t)
	if _, err := fx.service.GrantRegisterBonus("user_s"); err != nil { // 1000 限时
		t.Fatal(err)
	}
	if _, err := fx.service.Adjust("user_s", 500, "ops", "nonce_s1"); err != nil { // 500 永久
		t.Fatal(err)
	}

	reserve, err := fx.service.Reserve("user_s", fx.quote("job_s1", 1200))
	if err != nil {
		t.Fatal(err)
	}
	if reserve.Duplicate {
		t.Fatal("first reserve should not be a duplicate")
	}
	overview, _ := fx.service.Overview("user_s")
	if overview.LimitedFrozen != 1000 || overview.PermanentFrozen != 200 {
		t.Fatalf("frozen = limited %d permanent %d, want 1000/200（限时优先）", overview.LimitedFrozen, overview.PermanentFrozen)
	}

	settled, err := fx.service.Settle("job_s1")
	if err != nil || !settled.Changed {
		t.Fatalf("settle changed=%v err=%v", settled.Changed, err)
	}
	overview, _ = fx.service.Overview("user_s")
	if overview.LimitedAvailable != 0 || overview.PermanentBalance != 300 {
		t.Fatalf("after settle = %+v, want limited 0 permanent 300", overview)
	}
}

func TestMembershipExpirySweepsGrantButKeepsPermanent(t *testing.T) {
	fx := newCreditEngineFixture(t)
	plan := fx.plan()
	membership := fx.activeMembership(t, "user_exp", "ord_exp1", fx.current.Add(24*time.Hour))
	if _, err := fx.service.GrantMonthlyMembershipCredits(membership, plan); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.service.Adjust("user_exp", 300, "ops", "nonce_exp1"); err != nil { // 永久直购
		t.Fatal(err)
	}

	fx.current = fx.current.Add(25 * time.Hour) // 会员到期
	swept, err := fx.service.SweepExpiredMemberships(10)
	if err != nil || swept != 1 {
		t.Fatalf("swept=%d err=%v", swept, err)
	}

	overview, _ := fx.service.Overview("user_exp")
	if overview.LimitedAvailable != 0 {
		t.Fatalf("limited = %d, want 0（会员到期当月赠送清零）", overview.LimitedAvailable)
	}
	if overview.PermanentBalance != 300 {
		t.Fatalf("permanent = %d, want 300（直购不受影响）", overview.PermanentBalance)
	}

	membershipAfter, _ := fx.memberships.GetMembershipByID(membership.ID)
	if membershipAfter.Status != model.MembershipStatusExpired {
		t.Fatalf("membership status = %s, want expired", membershipAfter.Status)
	}
}

func TestInFlightTaskSurvivesMembershipExpiry(t *testing.T) {
	fx := newCreditEngineFixture(t)
	plan := fx.plan()
	membership := fx.activeMembership(t, "user_fly", "ord_fly1", fx.current.Add(24*time.Hour))
	if _, err := fx.service.GrantMonthlyMembershipCredits(membership, plan); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.service.Reserve("user_fly", fx.quote("job_fly", 5000)); err != nil {
		t.Fatal(err)
	}

	fx.current = fx.current.Add(25 * time.Hour)
	if _, err := fx.service.SweepExpiredMemberships(10); err != nil {
		t.Fatal(err)
	}

	// 到期清零可用赠送，但冻结部分保留，任务成功仍正常结算。
	settled, err := fx.service.Settle("job_fly")
	if err != nil || !settled.Changed {
		t.Fatalf("settle in-flight changed=%v err=%v", settled.Changed, err)
	}
	overview, _ := fx.service.Overview("user_fly")
	if overview.LimitedAvailable != 0 && overview.LimitedFrozen != 0 {
		t.Fatalf("after settle = %+v", overview)
	}
}

func TestRefundCreditPackOrder(t *testing.T) {
	fx := newCreditEngineFixture(t)
	pkg, err := fx.billing.UpsertPackage(model.CreditPackage{ID: "pkg_600", Name: "小额体验包", Credits: 600, PriceCents: 600})
	if err != nil {
		t.Fatal(err)
	}
	order, err := fx.billing.CreateOrder(model.Order{
		UserID: "user_r", OrderType: model.OrderTypeCreditPack, PackageID: pkg.ID,
		AmountCents: 600, Status: model.OrderStatusPaid,
	})
	if err != nil {
		t.Fatal(err)
	}
	// 模拟已到账并被花掉一部分。
	if _, err := fx.service.RechargePermanent("user_r", 600, order.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.service.Reserve("user_r", fx.quote("job_r1", 400)); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.service.Settle("job_r1"); err != nil {
		t.Fatal(err)
	}

	refunded, err := fx.service.RefundOrder(order.ID, "admin_ops")
	if err != nil {
		t.Fatal(err)
	}
	if refunded.Status != model.OrderStatusRefunded {
		t.Fatalf("order status = %s, want refunded", refunded.Status)
	}
	overview, _ := fx.service.Overview("user_r")
	if overview.PermanentBalance != -400 {
		t.Fatalf("balance = %d, want -400（已消耗部分转负）", overview.PermanentBalance)
	}

	// 负余额期间禁止新任务。
	if _, err := fx.service.Reserve("user_r", fx.quote("job_r2", 1)); !errors.Is(err, repository.ErrInsufficientCredits) {
		t.Fatalf("reserve with negative balance err = %v, want ErrInsufficientCredits", err)
	}

	// 重复退款幂等。
	if _, err := fx.service.RefundOrder(order.ID, "admin_ops"); err != nil {
		t.Fatal(err)
	}
	overview, _ = fx.service.Overview("user_r")
	if overview.PermanentBalance != -400 {
		t.Fatalf("balance after repeat refund = %d, want -400", overview.PermanentBalance)
	}

	// 充值冲抵后恢复。
	if _, err := fx.service.Adjust("user_r", 1000, "ops", "nonce_r_recover"); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.service.Reserve("user_r", fx.quote("job_r3", 100)); err != nil {
		t.Fatalf("reserve after recovery: %v", err)
	}
}

func TestRefundMemberOrderRevokesAndClearsGrant(t *testing.T) {
	fx := newCreditEngineFixture(t)
	plan := fx.plan()
	order, err := fx.billing.CreateOrder(model.Order{
		UserID: "user_mr", OrderType: model.OrderTypeMemberMonthly, PlanID: plan.ID,
		AmountCents: 19800, Status: model.OrderStatusPaid,
	})
	if err != nil {
		t.Fatal(err)
	}
	membership := fx.activeMembership(t, "user_mr", order.ID, fx.current.Add(30*24*time.Hour))
	if _, err := fx.service.GrantMonthlyMembershipCredits(membership, plan); err != nil {
		t.Fatal(err)
	}

	refunded, err := fx.service.RefundOrder(order.ID, "admin_ops")
	if err != nil || refunded.Status != model.OrderStatusRefunded {
		t.Fatalf("refund status=%s err=%v", refunded.Status, err)
	}
	membershipAfter, _ := fx.memberships.GetMembershipByID(membership.ID)
	if membershipAfter.Status != model.MembershipStatusRevoked {
		t.Fatalf("membership status = %s, want revoked", membershipAfter.Status)
	}
	overview, _ := fx.service.Overview("user_mr")
	if overview.LimitedAvailable != 0 {
		t.Fatalf("limited = %d, want 0（退款后赠送积分回滚）", overview.LimitedAvailable)
	}
}

func TestAdjustRejectsZeroAndSignPicksEntryType(t *testing.T) {
	fx := newCreditEngineFixture(t)
	if _, err := fx.service.Adjust("user_z", 0, "ops", "nonce_z0"); !errors.Is(err, ErrInvalidCreditAmount) {
		t.Fatalf("zero adjust err = %v", err)
	}
	if _, err := fx.service.Adjust("user_z", -200, "ops", "nonce_z1"); err != nil {
		t.Fatal(err)
	}
	entries, total, err := fx.credits.ListLedger("user_z", model.LedgerTypeAdminSubtract, 1, 10)
	if err != nil || total != 1 || entries[0].Amount != -200 {
		t.Fatalf("subtract ledger = %+v total %d", entries, total)
	}
}

func TestExpireSweepIsRepeatSafe(t *testing.T) {
	fx := newCreditEngineFixture(t)
	if _, err := fx.service.GrantRegisterBonus("user_sw"); err != nil {
		t.Fatal(err)
	}
	fx.current = fx.current.Add(32 * 24 * time.Hour)

	swept, err := fx.service.ExpireGrantsBefore(10)
	if err != nil || swept != 1 {
		t.Fatalf("first sweep = %d err=%v", swept, err)
	}
	// 模拟多副本并发重复执行：第二次不得再扣。
	swept, err = fx.service.ExpireGrantsBefore(10)
	if err != nil || swept != 0 {
		t.Fatalf("repeat sweep = %d err=%v, want 0", swept, err)
	}
	entries, total, _ := fx.credits.ListLedger("user_sw", model.LedgerTypeExpire, 1, 10)
	if total != 1 || entries[0].Amount != -1000 {
		t.Fatalf("expire ledger entries = %d, want exactly 1 of -1000", total)
	}
}
