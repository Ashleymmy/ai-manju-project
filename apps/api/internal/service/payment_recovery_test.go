package service

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/database"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var errPaymentRecoveryInjected = errors.New("injected payment persistence failure")

type recoveryCreditFaults struct {
	repository.CreditRepository
	failRecharge bool
	entered      chan struct{}
	release      chan struct{}
	failGrant    bool
	grantEntered chan struct{}
	grantRelease chan struct{}
}

func (r *recoveryCreditFaults) CreateGrantWithLedger(grant model.CreditGrant, kind, actor, order string, now time.Time) (repository.GrantOutcome, error) {
	if r.failGrant {
		r.failGrant = false
		return repository.GrantOutcome{}, errPaymentRecoveryInjected
	}
	if r.grantEntered != nil {
		close(r.grantEntered)
		r.grantEntered = nil
		<-r.grantRelease
	}
	return r.CreditRepository.CreateGrantWithLedger(grant, kind, actor, order, now)
}

type recoveryInviteFaults struct {
	repository.InviteRepository
	failStatus bool
}

func (r *recoveryInviteFaults) UpdateRewardStatus(id, from, to string, now time.Time) (bool, error) {
	if r.failStatus {
		r.failStatus = false
		return false, errPaymentRecoveryInjected
	}
	return r.InviteRepository.UpdateRewardStatus(id, from, to, now)
}

func (r *recoveryCreditFaults) AdjustPermanent(user string, delta int64, kind, actor, key string, now time.Time) (repository.AdjustOutcome, error) {
	if r.failRecharge {
		r.failRecharge = false
		return repository.AdjustOutcome{}, errPaymentRecoveryInjected
	}
	if r.entered != nil {
		close(r.entered)
		r.entered = nil
		<-r.release
	}
	return r.CreditRepository.AdjustPermanent(user, delta, kind, actor, key, now)
}

type recoveryBillingFaults struct {
	repository.BillingRepository
	failFulfilled bool
	failRefunded  bool
}

func (r *recoveryBillingFaults) MarkOrderFulfilled(id string, now time.Time) error {
	if r.failFulfilled {
		r.failFulfilled = false
		return errPaymentRecoveryInjected
	}
	return r.BillingRepository.MarkOrderFulfilled(id, now)
}

func (r *recoveryBillingFaults) UpdateOrderStatus(id, from, to string, now time.Time) (model.Order, bool, error) {
	if to == model.OrderStatusRefunded && r.failRefunded {
		r.failRefunded = false
		return model.Order{}, false, errPaymentRecoveryInjected
	}
	return r.BillingRepository.UpdateOrderStatus(id, from, to, now)
}

func TestPaymentRecoveryMemory(t *testing.T) { runPaymentRecoverySuite(t, nil) }

func TestPaymentRecoveryPostgres(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to run PostgreSQL payment recovery tests")
	}
	rootDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := fmt.Sprintf("payment_recovery_%d", time.Now().UnixNano())
	if err := rootDB.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		rootDB.Exec("DROP SCHEMA " + schema + " CASCADE")
		connection, _ := rootDB.DB()
		_ = connection.Close()
	})
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := database.OpenPostgres(u.String())
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	// Also catches order-lock pool starvation: locks must not consume the only
	// application connection while the callback needs it for credit mutations.
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	runPaymentRecoverySuite(t, db)
}

func runPaymentRecoverySuite(t *testing.T, db *gorm.DB) {
	t.Run("PaidCallbackRecoversFailedRecharge", func(t *testing.T) {
		f := newLifecycleFixture(t, db)
		order := f.order(t, false)
		f.engine.credits = &recoveryCreditFaults{CreditRepository: f.credits, failRecharge: true}
		if _, err := f.pay.MarkPaid(order.ID); !errors.Is(err, errPaymentRecoveryInjected) {
			t.Fatalf("first payment error=%v", err)
		}
		partial, err := f.billing.GetOrderByID(order.ID)
		if err != nil || partial.Status != model.OrderStatusPaid || partial.FulfilledAt != nil {
			t.Fatalf("partial state=%+v err=%v", partial, err)
		}
		paid, err := f.pay.MarkPaid(order.ID)
		if err != nil || paid.FulfilledAt == nil {
			t.Fatalf("recovered state=%+v err=%v", paid, err)
		}
		if _, err := f.pay.MarkPaid(order.ID); err != nil {
			t.Fatal(err)
		}
		assertRecoveryBalance(t, f, 9800)
		assertRecoveryLedgerCount(t, f, model.LedgerTypeRecharge, 1)
	})
	t.Run("FulfillmentMarkerFailureDoesNotDoubleGrant", func(t *testing.T) {
		f := newLifecycleFixture(t, db)
		order := f.order(t, false)
		wrapped := &recoveryBillingFaults{BillingRepository: f.billing, failFulfilled: true}
		f.pay.billing, f.engine.billing = wrapped, wrapped
		if _, err := f.pay.MarkPaid(order.ID); !errors.Is(err, errPaymentRecoveryInjected) {
			t.Fatalf("first payment error=%v", err)
		}
		if _, err := f.pay.MarkPaid(order.ID); err != nil {
			t.Fatal(err)
		}
		assertRecoveryBalance(t, f, 9800)
		assertRecoveryLedgerCount(t, f, model.LedgerTypeRecharge, 1)
	})
	t.Run("PackageEditsDoNotChangePurchaseOrRefund", func(t *testing.T) {
		f := newLifecycleFixture(t, db)
		order := f.order(t, false)
		pkg, err := f.billing.GetPackageByID(f.pack)
		if err != nil {
			t.Fatal(err)
		}
		pkg.Credits = 777
		if _, err := f.billing.UpsertPackage(pkg); err != nil {
			t.Fatal(err)
		}
		paid, err := f.pay.MarkPaid(order.ID)
		if err != nil || paid.PurchasedCredits == nil || *paid.PurchasedCredits != 9800 {
			t.Fatalf("purchase snapshot=%+v err=%v", paid, err)
		}
		assertRecoveryBalance(t, f, 9800)
		if _, err := f.engine.RefundOrder(order.ID, "test"); err != nil {
			t.Fatal(err)
		}
		assertRecoveryBalance(t, f, 0)
	})
	t.Run("LegacyRechargeUsesLedgerInsteadOfCurrentPackage", func(t *testing.T) {
		f := newLifecycleFixture(t, db)
		order, err := f.billing.CreateOrder(model.Order{UserID: f.user, PackageID: f.pack, OrderType: model.OrderTypeCreditPack, Status: model.OrderStatusPaid, AmountCents: 123})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.engine.RechargePermanent(f.user, 123, order.ID); err != nil {
			t.Fatal(err)
		}
		// Any attempt to resolve the new package value fails; historical ledger
		// evidence must be sufficient for callback recovery and refund.
		f.pay.billing = &lifecycleFailPackageRead{BillingRepository: f.billing, fail: true}
		paid, err := f.pay.MarkPaid(order.ID)
		if err != nil || paid.PurchasedCredits == nil || *paid.PurchasedCredits != 123 {
			t.Fatalf("legacy snapshot=%+v err=%v", paid, err)
		}
		assertRecoveryBalance(t, f, 123)
		if _, err := f.engine.RefundOrder(order.ID, "test"); err != nil {
			t.Fatal(err)
		}
		assertRecoveryBalance(t, f, 0)
	})
	t.Run("UnpaidOrdersCannotDeductCredits", func(t *testing.T) {
		f := newLifecycleFixture(t, db)
		for _, status := range []string{model.OrderStatusPending, model.OrderStatusClosed} {
			order, err := f.billing.CreateOrder(model.Order{UserID: f.user, PackageID: f.pack, OrderType: model.OrderTypeCreditPack, Status: status})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := f.engine.RefundOrder(order.ID, "test"); !errors.Is(err, ErrOrderNotRefundable) {
				t.Fatalf("refund %s error=%v", status, err)
			}
			stored, err := f.billing.GetOrderByID(order.ID)
			if err != nil || stored.Status != status || stored.RefundStartedAt != nil {
				t.Fatalf("rejected refund mutated order=%+v err=%v", stored, err)
			}
		}
		assertRecoveryBalance(t, f, 0)
		assertRecoveryLedgerCount(t, f, model.LedgerTypeRefundRollback, 0)
	})
	t.Run("PaidButUndeliveredRefundDoesNotCreateDebt", func(t *testing.T) {
		f := newLifecycleFixture(t, db)
		order := f.order(t, false)
		f.engine.credits = &recoveryCreditFaults{CreditRepository: f.credits, failRecharge: true}
		if _, err := f.pay.MarkPaid(order.ID); !errors.Is(err, errPaymentRecoveryInjected) {
			t.Fatal("fault was not injected", err)
		}
		if _, err := f.engine.RefundOrder(order.ID, "test"); err != nil {
			t.Fatal(err)
		}
		if _, err := f.pay.MarkPaid(order.ID); !errors.Is(err, ErrOrderNotPending) {
			t.Fatalf("refunded order could fulfill: %v", err)
		}
		assertRecoveryBalance(t, f, 0)
		assertRecoveryLedgerCount(t, f, model.LedgerTypeRefundRollback, 0)
	})
	t.Run("PartialRefundFencesCallbacksAndResumesOnce", func(t *testing.T) {
		f := newLifecycleFixture(t, db)
		order := f.order(t, false)
		if _, err := f.pay.MarkPaid(order.ID); err != nil {
			t.Fatal(err)
		}
		wrapped := &recoveryBillingFaults{BillingRepository: f.billing, failRefunded: true}
		f.pay.billing, f.engine.billing = wrapped, wrapped
		if _, err := f.engine.RefundOrder(order.ID, "test"); !errors.Is(err, errPaymentRecoveryInjected) {
			t.Fatalf("first refund error=%v", err)
		}
		if _, err := f.pay.MarkPaid(order.ID); !errors.Is(err, ErrOrderNotPending) {
			t.Fatalf("partial refund did not fence callback: %v", err)
		}
		for i := 0; i < 2; i++ {
			refunded, err := f.engine.RefundOrder(order.ID, "test")
			if err != nil || refunded.Status != model.OrderStatusRefunded {
				t.Fatalf("refund result=%+v err=%v", refunded, err)
			}
		}
		assertRecoveryBalance(t, f, 0)
		assertRecoveryLedgerCount(t, f, model.LedgerTypeRefundRollback, 1)
	})
	t.Run("ConcurrentPaymentAndRefundAreSerialized", func(t *testing.T) {
		f := newLifecycleFixture(t, db)
		order := f.order(t, false)
		entered, release := make(chan struct{}), make(chan struct{})
		f.engine.credits = &recoveryCreditFaults{CreditRepository: f.credits, entered: entered, release: release}
		results := make(chan error, 3)
		var wg sync.WaitGroup
		wg.Add(3)
		go func() { defer wg.Done(); _, err := f.pay.MarkPaid(order.ID); results <- err }()
		select {
		case <-entered:
		case <-time.After(5 * time.Second):
			t.Fatal("payment did not reach recharge")
		}
		go func() { defer wg.Done(); _, err := f.engine.RefundOrder(order.ID, "test"); results <- err }()
		go func() { defer wg.Done(); _, err := f.pay.MarkPaid(order.ID); results <- err }()
		close(release)
		wg.Wait()
		close(results)
		for err := range results {
			if err != nil && !errors.Is(err, ErrOrderNotPending) {
				t.Fatal(err)
			}
		}
		final, err := f.billing.GetOrderByID(order.ID)
		if err != nil || final.Status != model.OrderStatusRefunded {
			t.Fatalf("final order=%+v err=%v", final, err)
		}
		assertRecoveryBalance(t, f, 0)
		assertRecoveryLedgerCount(t, f, model.LedgerTypeRecharge, 1)
		assertRecoveryLedgerCount(t, f, model.LedgerTypeRefundRollback, 1)
	})
	t.Run("MembershipUsesPurchasedMonthlyCredits", func(t *testing.T) {
		f := newLifecycleFixture(t, db)
		order := f.order(t, true)
		plan, err := f.members.GetPlanByID(f.plan)
		if err != nil {
			t.Fatal(err)
		}
		plan.MonthlyCredits = 20
		if _, err := f.members.UpsertPlan(plan); err != nil {
			t.Fatal(err)
		}
		if _, err := f.pay.MarkPaid(order.ID); err != nil {
			t.Fatal(err)
		}
		overview, err := f.engine.Overview(f.user)
		if err != nil || overview.LimitedAvailable != 19800 {
			t.Fatalf("monthly credit snapshot=%+v err=%v", overview, err)
		}
	})
	t.Run("RefundRevokesScheduledRenewal", func(t *testing.T) {
		f := newLifecycleFixture(t, db)
		first, second := f.order(t, true), f.order(t, true)
		for _, order := range []model.Order{first, second} {
			if _, err := f.pay.MarkPaid(order.ID); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := f.engine.RefundOrder(second.ID, "test"); err != nil {
			t.Fatal(err)
		}
		membership, err := f.members.GetMembershipByOrderID(second.ID)
		if err != nil || membership.Status != model.MembershipStatusRevoked {
			t.Fatalf("refunded renewal remains active: %+v err=%v", membership, err)
		}
	})
	for _, failure := range []string{"grant", "status", "legacy-granted"} {
		t.Run("InviteRewardRecovers/"+failure, func(t *testing.T) {
			f := newLifecycleFixture(t, db)
			var invites repository.InviteRepository = repository.NewMemoryInviteRepository()
			if db != nil {
				invites = repository.NewGormInviteRepository(db)
			}
			status := model.InviteRewardPendingFirstRecharge
			if failure == "legacy-granted" {
				status = model.InviteRewardGranted
			}
			record, err := invites.CreateRecord(model.InviteRecord{InviteeID: f.user, InviterID: f.user + "_inviter", RewardStatus: status, InviterReward: 2000, FirstChargeBonus: 1000, CreatedAt: f.now})
			if err != nil {
				t.Fatal(err)
			}
			wrapped := &recoveryInviteFaults{InviteRepository: invites, failStatus: failure == "status"}
			f.pay.invites = NewInviteService(wrapped, f.engine, f.billing)
			f.pay.invites.SetClock(func() time.Time { return f.now })
			if failure == "grant" {
				f.engine.credits = &recoveryCreditFaults{CreditRepository: f.credits, failGrant: true}
			}
			order := f.order(t, false)
			if failure != "legacy-granted" {
				if _, err := f.pay.MarkPaid(order.ID); !errors.Is(err, errPaymentRecoveryInjected) {
					t.Fatalf("invite fault not injected: %v", err)
				}
			}
			for i := 0; i < 2; i++ {
				if _, err := f.pay.MarkPaid(order.ID); err != nil {
					t.Fatal(err)
				}
			}
			record, err = invites.GetRecordByInvitee(f.user)
			if err != nil || record.RewardStatus != model.InviteRewardGranted {
				t.Fatalf("invite status=%+v err=%v", record, err)
			}
			grants, err := f.credits.ListGrantsByRelatedID(record.ID, model.GrantSourceInviteReward)
			if err != nil || len(grants) != 1 || grants[0].AmountTotal != 3000 {
				t.Fatalf("invite grant=%+v err=%v", grants, err)
			}
			assertRecoveryBalance(t, f, 9800)
		})
	}
	t.Run("MonthlyGrantAndRefundAreSerialized", func(t *testing.T) {
		f := newLifecycleFixture(t, db)
		plan, err := f.members.GetPlanByID(f.plan)
		if err != nil {
			t.Fatal(err)
		}
		plan.PriceYearCents = 198000
		if _, err := f.members.UpsertPlan(plan); err != nil {
			t.Fatal(err)
		}
		order, _, err := f.pay.CreateOrder(CreateOrderInput{UserID: f.user, PlanID: f.plan, Period: "year", PayChannel: "mock"})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.pay.MarkPaid(order.ID); err != nil {
			t.Fatal(err)
		}
		membership, err := f.members.GetMembershipByOrderID(order.ID)
		if err != nil {
			t.Fatal(err)
		}
		f.now = f.now.Add(31 * 24 * time.Hour)
		entered, release := make(chan struct{}), make(chan struct{})
		f.engine.credits = &recoveryCreditFaults{CreditRepository: f.credits, grantEntered: entered, grantRelease: release}
		results := make(chan error, 2)
		go func() { _, err := f.engine.GrantMonthlyMembershipCredits(membership, plan); results <- err }()
		select {
		case <-entered:
		case <-time.After(5 * time.Second):
			t.Fatal("monthly grant did not start")
		}
		go func() { _, err := f.engine.RefundOrder(order.ID, "test"); results <- err }()
		close(release)
		for i := 0; i < 2; i++ {
			if err := <-results; err != nil {
				t.Fatal(err)
			}
		}
		// The scheduler may still hold a pre-refund membership snapshot.
		outcome, err := f.engine.GrantMonthlyMembershipCredits(membership, plan)
		if err != nil || outcome.Created {
			t.Fatalf("stale scheduler grant after refund=%+v err=%v", outcome, err)
		}
		v, err := f.engine.Overview(f.user)
		if err != nil || v.LimitedAvailable != 0 {
			t.Fatalf("refund left spendable monthly credits: %+v err=%v", v, err)
		}
	})
}

func assertRecoveryBalance(t *testing.T, f *lifecycleFixture, want int64) {
	t.Helper()
	overview, err := f.engine.Overview(f.user)
	if err != nil || overview.PermanentBalance != want {
		t.Fatalf("permanent balance=%d want=%d err=%v", overview.PermanentBalance, want, err)
	}
}

func assertRecoveryLedgerCount(t *testing.T, f *lifecycleFixture, kind string, want int64) {
	t.Helper()
	_, count, err := f.credits.ListLedger(f.user, kind, 1, 100)
	if err != nil || count != want {
		t.Fatalf("ledger %s count=%d want=%d err=%v", kind, count, want, err)
	}
}
