package service

import (
	"errors"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

func newInviteFixture(t *testing.T) (*InviteService, *repository.MemoryInviteRepository, *CreditLedgerService) {
	t.Helper()
	invites := repository.NewMemoryInviteRepository()
	credits := repository.NewMemoryCreditRepository()
	memberships := repository.NewMemoryMembershipRepository()
	billing := repository.NewMemoryBillingRepository()
	engine := NewCreditLedgerService(credits, memberships, billing)
	svc := NewInviteService(invites, engine, billing)
	return svc, invites, engine
}

func TestBindInviteCodeGrantsInviteeImmediately(t *testing.T) {
	svc, _, engine := newInviteFixture(t)
	profile, err := svc.invites.GetOrCreateProfile("inviter_1", time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}

	if err := svc.BindInviteCode("invitee_1", profile.InviteCode); err != nil {
		t.Fatal(err)
	}

	// 被邀请人立即得 500。
	overview, err := engine.Overview("invitee_1")
	if err != nil {
		t.Fatal(err)
	}
	if overview.LimitedAvailable != 500 {
		t.Fatalf("invitee limited = %d, want 500", overview.LimitedAvailable)
	}
	// 邀请人未得（等首充）。
	inviterOverview, _ := engine.Overview("inviter_1")
	if inviterOverview.LimitedAvailable != 0 {
		t.Fatalf("inviter limited = %d, want 0（首充前待发放）", inviterOverview.LimitedAvailable)
	}
	record, err := svc.invites.GetRecordByInvitee("invitee_1")
	if err != nil || record.RewardStatus != model.InviteRewardPendingFirstRecharge {
		t.Fatalf("record = %+v err=%v", record, err)
	}
}

func TestBindInviteCodeRejectsInvalidSelfAndRepeat(t *testing.T) {
	svc, _, _ := newInviteFixture(t)
	profile, _ := svc.invites.GetOrCreateProfile("inviter_2", time.Now().UTC())

	if err := svc.BindInviteCode("invitee_x", "NOTEXIST"); !errors.Is(err, ErrInvalidInviteCode) {
		t.Fatalf("invalid code err = %v", err)
	}
	if err := svc.BindInviteCode("inviter_2", profile.InviteCode); !errors.Is(err, ErrCannotInviteSelf) {
		t.Fatalf("self bind err = %v", err)
	}
	if err := svc.BindInviteCode("invitee_y", profile.InviteCode); err != nil {
		t.Fatal(err)
	}
	// 被邀请人终身只能绑定一次。
	if err := svc.BindInviteCode("invitee_y", profile.InviteCode); !errors.Is(err, repository.ErrInviteeAlreadyBound) {
		t.Fatalf("repeat bind err = %v, want ErrInviteeAlreadyBound", err)
	}
}

func TestOnFirstPaidOrderReleasesInviterRewardOnce(t *testing.T) {
	svc, _, engine := newInviteFixture(t)
	profile, _ := svc.invites.GetOrCreateProfile("inviter_3", time.Now().UTC())
	if err := svc.BindInviteCode("invitee_3", profile.InviteCode); err != nil {
		t.Fatal(err)
	}

	granted, err := svc.OnFirstPaidOrder("invitee_3")
	if err != nil || !granted {
		t.Fatalf("first paid granted=%v err=%v", granted, err)
	}
	overview, _ := engine.Overview("inviter_3")
	if overview.LimitedAvailable != 3000 {
		t.Fatalf("inviter limited = %d, want 3000（2000 邀请 + 1000 首充）", overview.LimitedAvailable)
	}

	// 第二次支付不再发放。
	granted, err = svc.OnFirstPaidOrder("invitee_3")
	if err != nil || granted {
		t.Fatalf("repeat paid granted=%v, want false", granted)
	}
	overview, _ = engine.Overview("inviter_3")
	if overview.LimitedAvailable != 3000 {
		t.Fatalf("inviter limited after repeat = %d, want 3000", overview.LimitedAvailable)
	}

	// 未绑定用户的首充不触发。
	granted, err = svc.OnFirstPaidOrder("stranger")
	if err != nil || granted {
		t.Fatalf("stranger granted=%v err=%v, want false", granted, err)
	}
}

func TestInviteRewardsConfigOverride(t *testing.T) {
	svc, _, engine := newInviteFixture(t)
	if err := svc.billing.UpsertConfig(model.BillingConfigKeyInviteRewards, model.JSONB(`{"inviter":3000,"invitee":800,"first_charge_bonus":2000}`), "admin:test", time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	profile, _ := svc.invites.GetOrCreateProfile("inviter_4", time.Now().UTC())
	if err := svc.BindInviteCode("invitee_4", profile.InviteCode); err != nil {
		t.Fatal(err)
	}
	overview, _ := engine.Overview("invitee_4")
	if overview.LimitedAvailable != 800 {
		t.Fatalf("invitee limited = %d, want 800（配置覆盖）", overview.LimitedAvailable)
	}
	if _, err := svc.OnFirstPaidOrder("invitee_4"); err != nil {
		t.Fatal(err)
	}
	inviterOverview, _ := engine.Overview("inviter_4")
	if inviterOverview.LimitedAvailable != 5000 {
		t.Fatalf("inviter limited = %d, want 5000（3000+2000）", inviterOverview.LimitedAvailable)
	}
}

func TestInviteOverviewComposesPage(t *testing.T) {
	svc, _, _ := newInviteFixture(t)
	profile, _ := svc.invites.GetOrCreateProfile("inviter_5", time.Now().UTC())
	if err := svc.BindInviteCode("invitee_5a", profile.InviteCode); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.OnFirstPaidOrder("invitee_5a"); err != nil {
		t.Fatal(err)
	}
	if err := svc.BindInviteCode("invitee_5b", profile.InviteCode); err != nil {
		t.Fatal(err)
	}

	overview, err := svc.Overview("inviter_5", "https://example.com/invite/")
	if err != nil {
		t.Fatal(err)
	}
	if overview.InviteCode != profile.InviteCode || overview.InvitedCount != 2 {
		t.Fatalf("overview = %+v", overview)
	}
	if overview.TotalRewardEarned != 3000 {
		t.Fatalf("earned = %d, want 3000（仅已首充的一位）", overview.TotalRewardEarned)
	}
	if overview.InviteUrl != "https://example.com/invite/"+profile.InviteCode {
		t.Fatalf("url = %s", overview.InviteUrl)
	}
}
