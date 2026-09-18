package service

import (
	"errors"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

func newPaymentFixture(t *testing.T) (*PaymentService, *repository.MemoryBillingRepository, *repository.MemoryMembershipRepository, *CreditLedgerService, *InviteService) {
	t.Helper()
	billing := repository.NewMemoryBillingRepository()
	memberships := repository.NewMemoryMembershipRepository()
	credits := repository.NewMemoryCreditRepository()
	engine := NewCreditLedgerService(credits, memberships, billing)
	invites := NewInviteService(repository.NewMemoryInviteRepository(), engine, billing)
	svc := NewPaymentService(billing, memberships, engine, invites, true) // mock 渠道开
	return svc, billing, memberships, engine, invites
}

func seedPaymentFixture(t *testing.T, billing *repository.MemoryBillingRepository, memberships *repository.MemoryMembershipRepository) {
	t.Helper()
	if err := memberships.SeedPlans([]model.MembershipPlan{
		{ID: "plan_198", Code: model.PlanCodeMember198, Name: "198 会员", PriceMonthCents: 19800, PriceYearCents: 198000, MonthlyCredits: 19800, CreditDiscountBps: 8000, Enabled: true},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := billing.UpsertPackage(model.CreditPackage{ID: "pkg_9800", Name: "标准包", Credits: 9800, PriceCents: 9800, Enabled: true}); err != nil {
		t.Fatal(err)
	}
}

func TestCreateCreditPackOrderAndMockPay(t *testing.T) {
	svc, billing, memberships, engine, _ := newPaymentFixture(t)
	seedPaymentFixture(t, billing, memberships)

	order, payParams, err := svc.CreateOrder(CreateOrderInput{UserID: "user_p1", PackageID: "pkg_9800", PayChannel: "mock"})
	if err != nil {
		t.Fatal(err)
	}
	if order.Status != model.OrderStatusPending || order.AmountCents != 9800 {
		t.Fatalf("order = %+v", order)
	}
	if len(payParams) == 0 {
		t.Fatal("pay params should not be empty")
	}

	paid, err := svc.MarkPaid(order.ID)
	if err != nil {
		t.Fatal(err)
	}
	if paid.Status != model.OrderStatusPaid || paid.PaidAt == nil {
		t.Fatalf("paid = %+v", paid)
	}
	overview, _ := engine.Overview("user_p1")
	if overview.PermanentBalance != 9800 {
		t.Fatalf("permanent = %d, want 9800（直购永久有效）", overview.PermanentBalance)
	}

	// 回调重放幂等。
	if _, err := svc.MarkPaid(order.ID); err != nil {
		t.Fatal(err)
	}
	overview, _ = engine.Overview("user_p1")
	if overview.PermanentBalance != 9800 {
		t.Fatalf("permanent after replay = %d, want 9800", overview.PermanentBalance)
	}
}

func TestMemberOrderGrantsMembershipAndFirstMonthCredits(t *testing.T) {
	svc, billing, memberships, engine, _ := newPaymentFixture(t)
	seedPaymentFixture(t, billing, memberships)

	order, _, err := svc.CreateOrder(CreateOrderInput{UserID: "user_p2", PlanID: "plan_198", Period: "month", PayChannel: "mock"})
	if err != nil {
		t.Fatal(err)
	}
	if order.AmountCents != 19800 || order.OrderType != model.OrderTypeMemberMonthly {
		t.Fatalf("order = %+v", order)
	}
	if _, err := svc.MarkPaid(order.ID); err != nil {
		t.Fatal(err)
	}

	membership, err := memberships.GetActiveMembership("user_p2", time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if membership.ExpiresAt.Sub(membership.StartedAt) != 30*24*time.Hour {
		t.Fatalf("period = %v, want 30d", membership.ExpiresAt.Sub(membership.StartedAt))
	}
	overview, _ := engine.Overview("user_p2")
	if overview.LimitedAvailable != 19800 {
		t.Fatalf("limited = %d, want 19800（首期月积分立即发放）", overview.LimitedAvailable)
	}
}

func TestMemberDiscountAppliesToCreditPack(t *testing.T) {
	svc, billing, memberships, engine, _ := newPaymentFixture(t)
	seedPaymentFixture(t, billing, memberships)

	// 先买会员（8 折）。
	memberOrder, _, err := svc.CreateOrder(CreateOrderInput{UserID: "user_p3", PlanID: "plan_198", Period: "month", PayChannel: "mock"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.MarkPaid(memberOrder.ID); err != nil {
		t.Fatal(err)
	}
	// 会员买直购包：9800 × 0.8 = 7840。
	packOrder, _, err := svc.CreateOrder(CreateOrderInput{UserID: "user_p3", PackageID: "pkg_9800", PayChannel: "mock"})
	if err != nil {
		t.Fatal(err)
	}
	if packOrder.AmountCents != 7840 {
		t.Fatalf("discounted price = %d, want 7840（8 折）", packOrder.AmountCents)
	}
	_ = engine
}

func TestPaymentRenewalExtendsMembership(t *testing.T) {
	svc, billing, memberships, _, _ := newPaymentFixture(t)
	seedPaymentFixture(t, billing, memberships)

	first, _, _ := svc.CreateOrder(CreateOrderInput{UserID: "user_p4", PlanID: "plan_198", Period: "month", PayChannel: "mock"})
	if _, err := svc.MarkPaid(first.ID); err != nil {
		t.Fatal(err)
	}
	firstMembership, _ := memberships.GetActiveMembership("user_p4", time.Now().UTC())

	second, _, err := svc.CreateOrder(CreateOrderInput{UserID: "user_p4", PlanID: "plan_198", Period: "month", PayChannel: "mock"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.MarkPaid(second.ID); err != nil {
		t.Fatal(err)
	}
	renewed, _ := memberships.GetActiveMembership("user_p4", time.Now().UTC())
	if !renewed.StartedAt.Equal(firstMembership.ExpiresAt) {
		t.Fatalf("renewal started_at = %v, want 续接旧到期日 %v", renewed.StartedAt, firstMembership.ExpiresAt)
	}
}

func TestFirstPaidOrderTriggersInviteReward(t *testing.T) {
	svc, billing, memberships, engine, invites := newPaymentFixture(t)
	seedPaymentFixture(t, billing, memberships)

	profile, err := invites.invites.GetOrCreateProfile("inviter_p5", time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if err := invites.BindInviteCode("user_p5", profile.InviteCode); err != nil {
		t.Fatal(err)
	}
	// 注册奖励已发（500），首充前邀请人 0。
	order, _, _ := svc.CreateOrder(CreateOrderInput{UserID: "user_p5", PackageID: "pkg_9800", PayChannel: "mock"})
	if _, err := svc.MarkPaid(order.ID); err != nil {
		t.Fatal(err)
	}
	inviterOverview, _ := engine.Overview("inviter_p5")
	if inviterOverview.LimitedAvailable != 3000 {
		t.Fatalf("inviter limited = %d, want 3000（首充触发）", inviterOverview.LimitedAvailable)
	}
}

func TestCancelOrderAndChannelGuard(t *testing.T) {
	svc, billing, memberships, _, _ := newPaymentFixture(t)
	seedPaymentFixture(t, billing, memberships)

	// 未配置渠道报错。
	if _, _, err := svc.CreateOrder(CreateOrderInput{UserID: "user_p6", PackageID: "pkg_9800", PayChannel: model.PayChannelAlipay}); !errors.Is(err, ErrPayChannelUnavailable) {
		t.Fatalf("alipay err = %v, want ErrPayChannelUnavailable", err)
	}

	order, _, _ := svc.CreateOrder(CreateOrderInput{UserID: "user_p6", PackageID: "pkg_9800", PayChannel: "mock"})
	canceled, err := svc.CancelOrder(order.ID, "user_p6")
	if err != nil || canceled.Status != model.OrderStatusClosed {
		t.Fatalf("cancel = %+v err=%v", canceled, err)
	}
	// 已关闭订单不能支付。
	if _, err := svc.MarkPaid(order.ID); !errors.Is(err, ErrOrderNotPending) {
		t.Fatalf("pay closed order err = %v", err)
	}
	// 他人不能取消我的订单。
	if _, err := svc.CancelOrder(order.ID, "someone_else"); !errors.Is(err, repository.ErrOrderNotFound) {
		t.Fatalf("cancel by stranger err = %v", err)
	}
}
