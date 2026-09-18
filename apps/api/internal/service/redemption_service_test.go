package service

import (
	"errors"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

func newRedemptionFixture(t *testing.T) (*RedemptionService, *repository.MemoryRedemptionRepository, *repository.MemoryMembershipRepository, *CreditLedgerService) {
	t.Helper()
	redemptions := repository.NewMemoryRedemptionRepository()
	memberships := repository.NewMemoryMembershipRepository()
	credits := repository.NewMemoryCreditRepository()
	engine := NewCreditLedgerService(credits, memberships, repository.NewMemoryBillingRepository())
	svc := NewRedemptionService(redemptions, memberships, engine)
	if err := memberships.SeedPlans([]model.MembershipPlan{
		{ID: "plan_198", Code: model.PlanCodeMember198, Name: "198 会员", PriceMonthCents: 19800, MonthlyCredits: 19800, Enabled: true},
	}); err != nil {
		t.Fatal(err)
	}
	return svc, redemptions, memberships, engine
}

func TestRedeemCreditsCode(t *testing.T) {
	svc, redemptions, _, engine := newRedemptionFixture(t)
	if _, err := redemptions.CreateCode(model.RedemptionCode{Code: "TEST-AAAA-BBBB", Kind: model.RedemptionKindCredits, CreditsAmount: 2000, ValidDays: 30, Enabled: true}); err != nil {
		t.Fatal(err)
	}

	result, err := svc.Redeem("user_rc1", "TEST-AAAA-BBBB")
	if err != nil || result.CreditsGranted != 2000 {
		t.Fatalf("redeem = %+v err=%v", result, err)
	}
	overview, _ := engine.Overview("user_rc1")
	if overview.LimitedAvailable != 2000 {
		t.Fatalf("limited = %d, want 2000（活动批次）", overview.LimitedAvailable)
	}

	// 同一人同码不可重复核销。
	if _, err := svc.Redeem("user_rc1", "TEST-AAAA-BBBB"); !errors.Is(err, repository.ErrRedemptionAlreadyUsed) {
		t.Fatalf("repeat redeem err = %v, want ErrRedemptionAlreadyUsed", err)
	}
	// 另一用户可用。
	if _, err := svc.Redeem("user_rc2", "TEST-AAAA-BBBB"); err != nil {
		t.Fatalf("second user redeem: %v", err)
	}
}

func TestRedeemMembershipDaysCode(t *testing.T) {
	svc, redemptions, memberships, engine := newRedemptionFixture(t)
	if _, err := redemptions.CreateCode(model.RedemptionCode{
		Code: "VIP-2026-0001", Kind: model.RedemptionKindMembershipDays,
		MembershipDays: 30, PlanID: "plan_198", MaxUses: 100, Enabled: true,
	}); err != nil {
		t.Fatal(err)
	}

	result, err := svc.Redeem("user_rm1", "VIP-2026-0001")
	if err != nil || result.MembershipDays != 30 || result.PlanName != "198 会员" {
		t.Fatalf("redeem = %+v err=%v", result, err)
	}
	membership, err := memberships.GetActiveMembership("user_rm1", time.Now().UTC())
	if err != nil || membership.Source != model.MembershipSourceRedeem {
		t.Fatalf("membership = %+v err=%v", membership, err)
	}
	// 兑换即发放首期月积分（学费赠一个月会员的完整体验）。
	overview, _ := engine.Overview("user_rm1")
	if overview.LimitedAvailable != 19800 {
		t.Fatalf("limited = %d, want 19800", overview.LimitedAvailable)
	}
}

func TestRedeemGuards(t *testing.T) {
	svc, redemptions, _, _ := newRedemptionFixture(t)
	past := time.Now().UTC().Add(-time.Hour)
	codes := []model.RedemptionCode{
		{Code: "DISABLED-0000-0001", Kind: model.RedemptionKindCredits, CreditsAmount: 100, Enabled: false},
		{Code: "EXPIRED-0000-0001", Kind: model.RedemptionKindCredits, CreditsAmount: 100, Enabled: true, ExpiresAt: &past},
		{Code: "EXHAUST-0000-0001", Kind: model.RedemptionKindCredits, CreditsAmount: 100, Enabled: true, MaxUses: 1, UsedCount: 1},
	}
	for _, code := range codes {
		if _, err := redemptions.CreateCode(code); err != nil {
			t.Fatal(err)
		}
		if _, err := svc.Redeem("user_guard", code.Code); !errors.Is(err, repository.ErrRedemptionUnavailable) {
			t.Fatalf("redeem %s err = %v, want unavailable", code.Code, err)
		}
	}
	if _, err := svc.Redeem("user_guard", "NOTEXIST-0000-0001"); !errors.Is(err, repository.ErrRedemptionCodeNotFound) {
		t.Fatalf("unknown code err = %v", err)
	}
}
