// Permanent regressions for the release audit: both storage implementations
// must preserve configuration, credits, concurrency and settlement liveness.
package service

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/database"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/queue"
	"github.com/ai-manju/api/internal/repository"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type lifecycleFixture struct {
	credits          repository.CreditRepository
	billing          repository.BillingRepository
	members          repository.MembershipRepository
	jobs             repository.JobRepository
	engine           *CreditLedgerService
	pay              *PaymentService
	user, plan, pack string
	now              time.Time
}

func newLifecycleFixture(t *testing.T, db *gorm.DB) *lifecycleFixture {
	t.Helper()
	f := &lifecycleFixture{now: time.Date(2026, 9, 20, 0, 0, 0, 0, time.UTC)}
	f.user = fmt.Sprintf("audit_%d", time.Now().UnixNano())
	f.plan, f.pack = f.user+"_plan", f.user+"_pack"
	if db == nil {
		f.credits = repository.NewMemoryCreditRepository()
		f.billing = repository.NewMemoryBillingRepository()
		f.members = repository.NewMemoryMembershipRepository()
		f.jobs = repository.NewMemoryJobRepository()
	} else {
		f.credits = repository.NewGormCreditRepository(db)
		f.billing = repository.NewGormBillingRepository(db)
		f.members = repository.NewGormMembershipRepository(db)
		f.jobs = repository.NewGormJobRepository(db)
	}
	f.engine = NewCreditLedgerService(f.credits, f.members, f.billing)
	f.engine.SetClock(func() time.Time { return f.now })
	f.pay = NewPaymentService(f.billing, f.members, f.engine, nil, true)
	f.pay.SetClock(func() time.Time { return f.now })
	_, err := f.members.UpsertPlan(model.MembershipPlan{ID: f.plan, Code: f.plan, Name: "Audit", PriceMonthCents: 19800, MonthlyCredits: 19800, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.billing.UpsertPackage(model.CreditPackage{ID: f.pack, Name: "Audit", Credits: 9800, PriceCents: 9800, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func (f *lifecycleFixture) order(t *testing.T, membership bool) model.Order {
	t.Helper()
	input := CreateOrderInput{UserID: f.user, PayChannel: "mock", Period: "month"}
	if membership {
		input.PlanID = f.plan
	} else {
		input.PackageID = f.pack
	}
	order, _, err := f.pay.CreateOrder(input)
	if err != nil {
		t.Fatal(err)
	}
	return order
}

type lifecycleFailPackageRead struct {
	repository.BillingRepository
	fail bool
}

func (r *lifecycleFailPackageRead) GetPackageByID(id string) (model.CreditPackage, error) {
	if r.fail {
		r.fail = false
		return model.CreditPackage{}, errors.New("injected transient DB failure")
	}
	return r.BillingRepository.GetPackageByID(id)
}

type lifecycleFailGrantRead struct {
	repository.CreditRepository
	fail bool
}

func (r *lifecycleFailGrantRead) ListGrantsByRelatedID(id, source string) ([]model.CreditGrant, error) {
	if r.fail {
		r.fail = false
		return nil, errors.New("injected transient DB failure")
	}
	return r.CreditRepository.ListGrantsByRelatedID(id, source)
}

// Both admission calls observe the same count before either creates a job.
type lifecycleAdmissionBarrier struct {
	repository.JobRepository
	arrivals atomic.Int32
	ready    chan struct{}
}

func (r *lifecycleAdmissionBarrier) CountActiveByUserAndTypes(user string, types []string) (int64, error) {
	n, err := r.JobRepository.CountActiveByUserAndTypes(user, types)
	if r.arrivals.Add(1) == 2 {
		close(r.ready)
	}
	select {
	case <-r.ready:
		return n, err
	case <-time.After(5 * time.Second):
		return 0, errors.New("audit barrier timeout")
	}
}

func TestMembershipLifecycleRegression(t *testing.T) {
	backends := []struct {
		name string
		db   *gorm.DB
	}{{name: "Memory"}}
	if dsn := os.Getenv("TEST_DATABASE_URL"); dsn != "" {
		rootDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
		if err != nil {
			t.Fatal(err)
		}
		schema := fmt.Sprintf("lifecycle_%d", time.Now().UnixNano())
		if err := rootDB.Exec("CREATE SCHEMA " + schema).Error; err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { rootDB.Exec("DROP SCHEMA " + schema + " CASCADE"); sqlDB, _ := rootDB.DB(); _ = sqlDB.Close() })
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
		t.Cleanup(func() { _ = sqlDB.Close() })
		backends = append(backends, struct {
			name string
			db   *gorm.DB
		}{"Postgres", db})
	}
	for _, backend := range backends {
		t.Run(backend.name, func(t *testing.T) {
			t.Run("RestartPreservesOperatorConfiguration", func(t *testing.T) {
				f := newLifecycleFixture(t, backend.db)
				if err := SeedMembershipDefaults(f.members, f.billing); err != nil {
					t.Fatal(err)
				}
				plan, err := f.members.GetPlanByCode(model.PlanCodeMember198)
				if err != nil {
					t.Fatal(err)
				}
				plan.PriceMonthCents, plan.Enabled = 12345, false
				if _, err := f.members.UpsertPlan(plan); err != nil {
					t.Fatal(err)
				}
				pkg, err := f.billing.GetPackageByID("pkg_600")
				if err != nil {
					t.Fatal(err)
				}
				pkg.Credits, pkg.Enabled = 777, false
				if _, err := f.billing.UpsertPackage(pkg); err != nil {
					t.Fatal(err)
				}
				if err := SeedMembershipDefaults(f.members, f.billing); err != nil {
					t.Fatal(err)
				}
				plan, err = f.members.GetPlanByID(plan.ID)
				if err != nil {
					t.Fatal(err)
				}
				pkg, err = f.billing.GetPackageByID(pkg.ID)
				if err != nil {
					t.Fatal(err)
				}
				if plan.PriceMonthCents != 12345 || plan.Enabled || pkg.Credits != 777 || pkg.Enabled {
					t.Fatalf("restart: plan price=%d enabled=%v; pack credits=%d enabled=%v; want 12345/false/777/false", plan.PriceMonthCents, plan.Enabled, pkg.Credits, pkg.Enabled)
				}
			})
			t.Run("RenewedPeriodHasMonthlyCredits", func(t *testing.T) {
				f := newLifecycleFixture(t, backend.db)
				for i := 0; i < 2; i++ {
					o := f.order(t, true)
					if _, err := f.pay.MarkPaid(o.ID); err != nil {
						t.Fatal(err)
					}
				}
				f.now = f.now.Add(32 * 24 * time.Hour)
				if _, err := f.members.GetActiveMembership(f.user, f.now); err != nil {
					t.Fatal(err)
				}
				scheduler := NewCreditScheduler(f.engine, f.credits, f.members, time.Minute)
				if _, err := scheduler.RunOnce(context.Background()); err != nil {
					t.Fatal(err)
				}
				v, err := f.engine.Overview(f.user)
				if err != nil {
					t.Fatal(err)
				}
				if v.LimitedAvailable != 19800 {
					t.Fatalf("day 32: active renewed membership has %d credits; want 19800", v.LimitedAvailable)
				}
			})
			t.Run("ExpiredMembershipCannotRegainCreditsOnCancel", func(t *testing.T) {
				f := newLifecycleFixture(t, backend.db)
				o := f.order(t, true)
				if _, err := f.pay.MarkPaid(o.ID); err != nil {
					t.Fatal(err)
				}
				job := f.user + "_frozen"
				if _, err := f.engine.Reserve(f.user, CreditQuote{JobID: job, TaskType: model.TaskTypeImage, Credits: 30}); err != nil {
					t.Fatal(err)
				}
				f.now = f.now.Add(30*24*time.Hour + time.Minute)
				if _, err := f.engine.SweepExpiredMemberships(500); err != nil {
					t.Fatal(err)
				}
				if _, err := f.engine.Release(job); err != nil {
					t.Fatal(err)
				}
				v, err := f.engine.Overview(f.user)
				if err != nil {
					t.Fatal(err)
				}
				if v.LimitedAvailable != 0 {
					t.Fatalf("expired member regained %d spendable credits after cancellation; want 0", v.LimitedAvailable)
				}
			})
			t.Run("ExpiryRetriesAfterTransientFailure", func(t *testing.T) {
				f := newLifecycleFixture(t, backend.db)
				o := f.order(t, true)
				if _, err := f.pay.MarkPaid(o.ID); err != nil {
					t.Fatal(err)
				}
				f.now = f.now.Add(30*24*time.Hour + time.Minute)
				f.engine.credits = &lifecycleFailGrantRead{CreditRepository: f.credits, fail: true}
				if _, err := f.engine.SweepExpiredMemberships(500); err == nil {
					t.Fatal("fault not injected")
				}
				if _, err := f.engine.SweepExpiredMemberships(500); err != nil {
					t.Fatal(err)
				}
				v, err := f.engine.Overview(f.user)
				if err != nil {
					t.Fatal(err)
				}
				if v.LimitedAvailable != 0 {
					t.Fatalf("expired membership retains %d credits after retry; want 0", v.LimitedAvailable)
				}
			})
			t.Run("ConcurrentVideoAdmissionHonorsLimit", func(t *testing.T) {
				f := newLifecycleFixture(t, backend.db)
				if _, err := f.engine.RechargePermanent(f.user, 1000, f.user+"_fund"); err != nil {
					t.Fatal(err)
				}
				barrier := &lifecycleAdmissionBarrier{JobRepository: f.jobs, ready: make(chan struct{})}
				gate := NewEntitlementGate(f.members, barrier)
				svc := NewJobService(barrier, &queue.MemoryProducer{}, "celery", 1)
				svc.SetBillingHooks(NewBillingHooks(NewCreditPricer(f.billing), f.engine, gate))
				var wg sync.WaitGroup
				var accepted atomic.Int32
				errs := make(chan error, 2)
				for i := 0; i < 2; i++ {
					wg.Add(1)
					go func(i int) {
						defer wg.Done()
						_, err := svc.Enqueue(context.Background(), EnqueueJobInput{UserID: f.user, Scope: WorkspaceScopePersonal, Type: model.JobTypeVideoGenerate, Payload: model.JSONB(`{"model":"test","duration":5}`), IdempotencyKey: fmt.Sprintf("%s_%d", f.user, i)})
						if err == nil {
							accepted.Add(1)
						} else if !errors.Is(err, ErrConcurrencyLimitExceeded) {
							errs <- err
						}
					}(i)
				}
				wg.Wait()
				close(errs)
				for err := range errs {
					t.Fatal(err)
				}
				if accepted.Load() > int32(model.FreeVideoConcurrency) {
					t.Fatalf("accepted %d simultaneous video jobs; free tier limit=%d", accepted.Load(), model.FreeVideoConcurrency)
				}
			})
			t.Run("ReconcilerReachesCompletedJobsPastRunningBatch", func(t *testing.T) {
				f := newLifecycleFixture(t, backend.db)
				if _, err := f.engine.RechargePermanent(f.user, 1000, f.user+"_fund"); err != nil {
					t.Fatal(err)
				}
				var last string
				for i := 0; i <= CreditReconcileBatchSize; i++ {
					last = fmt.Sprintf("%s_job_%03d", f.user, i)
					if _, err := f.jobs.Create(model.Job{ID: last, IdempotencyKey: last, UserID: f.user, Type: model.JobTypeImageGenerate, Status: model.JobStatusRunning, Payload: model.JSONB(`{}`), Result: model.JSONB(`{}`), Error: model.JSONB(`{}`)}); err != nil {
						t.Fatal(err)
					}
					if _, err := f.engine.Reserve(f.user, CreditQuote{JobID: last, TaskType: model.TaskTypeImage, Credits: 1}); err != nil {
						t.Fatal(err)
					}
					f.now = f.now.Add(time.Millisecond)
				}
				if _, err := f.jobs.SetResult(last, model.JSONB(`{}`)); err != nil {
					t.Fatal(err)
				}
				r := NewCreditReconciler(f.credits, f.jobs, f.engine, time.Second)
				for i := 0; i < 3; i++ {
					if _, _, err := r.ReconcileOnce(context.Background()); err != nil {
						t.Fatal(err)
					}
				}
				c, err := f.credits.GetConsumptionByJobID(last)
				if err != nil {
					t.Fatal(err)
				}
				if c.Status != model.TaskConsumptionStatusSettled {
					t.Fatalf("completed job after %d running reservations remains %s after 3 sweeps; want settled", CreditReconcileBatchSize, c.Status)
				}
			})
		})
	}
}
