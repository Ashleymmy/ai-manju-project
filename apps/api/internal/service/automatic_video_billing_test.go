package service

import (
	"context"
	"encoding/json"
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

func TestAutomaticVideoQuoteUsesCapabilityMaximumAndFrozenRates(t *testing.T) {
	billing := repository.NewMemoryBillingRepository()
	pricer := NewCreditPricer(billing)
	payload := model.JSONB(`{"model":"seedance-2.5","duration":-1,"resolution":"720p","content":[{"type":"video_url"}]}`)
	policy := &VideoBillingPolicy{MaxDurationSeconds: 30, Resolutions: []string{"480p", "720p", "1080p"}}
	credits, _, params, _, err := pricer.QuoteForJobWithVideoPolicy(model.JobTypeVideoGenerate, payload, policy)
	if err != nil || credits != 14400 || params["billing_mode"] != AutomaticVideoBillingMode || params["reserve_duration_sec"] != int64(30) || params["reference_per_second"] != float64(260) {
		t.Fatalf("quote=%d params=%+v err=%v", credits, params, err)
	}
	policy.MaxDurationSeconds = 15
	credits, _, _, _, err = pricer.QuoteForJobWithVideoPolicy(model.JobTypeVideoGenerate, payload, policy)
	if err != nil || credits != 7200 {
		t.Fatalf("provider-specific max ignored: credits=%d err=%v", credits, err)
	}
	if err := billing.UpsertConfig(model.BillingConfigKeyActivity, model.JSONB(`{"enabled":true,"discount_bps":5000}`), "test", time.Now()); err != nil {
		t.Fatal(err)
	}
	credits, _, params, _, err = pricer.QuoteForJobWithVideoPolicy(model.JobTypeVideoGenerate, payload, policy)
	if err != nil || credits != 3600 || params["activity_discount_bps"] != 5000 {
		t.Fatalf("discount lost: credits=%d params=%+v err=%v", credits, params, err)
	}
}

func TestAutomaticVideoQuoteRejectsUntrustedOrUnknownMaximum(t *testing.T) {
	pricer := NewCreditPricer(repository.NewMemoryBillingRepository())
	payload := model.JSONB(`{"model":"opaque-model","duration":-1,"resolution":"720p","max_duration":1,"billing_mode":"free","auto_video_pricing":{"version":1}}`)
	for _, policy := range []*VideoBillingPolicy{nil, {Resolutions: []string{"720p"}}, {MaxDurationSeconds: 30}, {MaxDurationSeconds: 30, Resolutions: []string{"480p"}}} {
		_, _, _, _, err := pricer.QuoteForJobWithVideoPolicy(model.JobTypeVideoGenerate, payload, policy)
		if !errors.Is(err, ErrAutomaticVideoPolicyUnavailable) {
			t.Fatalf("unknown capability accepted: %v", err)
		}
	}
}

func TestAutomaticVideoQuotePreservesExplicitAndImagePricing(t *testing.T) {
	pricer := NewCreditPricer(repository.NewMemoryBillingRepository())
	for _, tc := range []struct{ kind, payload string }{
		{model.JobTypeVideoGenerate, `{"model":"seedance-2.5","duration":5,"resolution":"720p"}`},
		{model.JobTypeImageEdit, `{"model":"gpt-image-2","size":"auto","quality":"auto","references":[{}]}`},
	} {
		want, wantType, wantParams, wantChargeable := pricer.QuoteForJob(tc.kind, model.JSONB(tc.payload))
		got, gotType, gotParams, gotChargeable, err := pricer.QuoteForJobWithVideoPolicy(tc.kind, model.JSONB(tc.payload), nil)
		wantJSON, _ := json.Marshal(wantParams)
		gotJSON, _ := json.Marshal(gotParams)
		if err != nil || want != got || wantType != gotType || wantChargeable != gotChargeable || string(wantJSON) != string(gotJSON) {
			t.Fatalf("existing pricing changed: kind=%s got=%d want=%d err=%v", tc.kind, got, want, err)
		}
	}
}

func TestAutomaticVideoBillingMemory(t *testing.T) { runAutomaticVideoBillingSuite(t, nil) }

func TestAutomaticVideoBillingPostgres(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL for isolated PostgreSQL tests")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := fmt.Sprintf("auto_video_billing_%d", time.Now().UnixNano())
	if err := root.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		root.Exec("DROP SCHEMA " + schema + " CASCADE")
		connection, _ := root.DB()
		_ = connection.Close()
	})
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := u.Query()
	query.Set("search_path", schema)
	u.RawQuery = query.Encode()
	db, err := database.OpenPostgres(u.String())
	if err != nil {
		t.Fatal(err)
	}
	connection, _ := db.DB()
	t.Cleanup(func() { _ = connection.Close() })
	runAutomaticVideoBillingSuite(t, db)
}

func reserveAutomaticVideo(t *testing.T, f *lifecycleFixture, payload string, policy *VideoBillingPolicy) (model.Job, model.TaskConsumption) {
	t.Helper()
	if _, err := f.engine.Adjust(f.user, 1000000, "test", f.user+"_seed"); err != nil {
		t.Fatal(err)
	}
	pricer := NewCreditPricer(f.billing)
	pricer.SetClock(func() time.Time { return f.now })
	hooks := NewBillingHooks(pricer, f.engine, nil)
	jobID := f.user + "_auto"
	if err := hooks.ReserveForJobWithVideoPolicy(f.user, model.JobTypeVideoGenerate, jobID, model.JSONB(payload), policy); err != nil {
		t.Fatal(err)
	}
	job, err := f.jobs.Create(model.Job{ID: jobID, UserID: f.user, WorkspaceID: "default:" + f.user, Type: model.JobTypeVideoGenerate, Status: model.JobStatusSucceeded, IdempotencyKey: jobID, Payload: model.JSONB(payload), Result: model.JSONB(`{}`)})
	if err != nil {
		t.Fatal(err)
	}
	consumption, err := f.credits.GetConsumptionByJobID(job.ID)
	if err != nil {
		t.Fatal(err)
	}
	return job, consumption
}

func measuredVideoResult(seconds float64, width, height int) model.JSONB {
	data, _ := json.Marshal(map[string]any{"video_metrics": map[string]any{"version": 1, "source": "ffprobe", "duration_seconds": seconds, "width": width, "height": height}})
	return model.JSONB(data)
}

func runAutomaticVideoBillingSuite(t *testing.T, db *gorm.DB) {
	t.Run("ActualDurationUsesFrozenDiscountAndReferenceRate", func(t *testing.T) {
		f := newLifecycleFixture(t, db)
		if err := f.billing.UpsertConfig(model.BillingConfigKeyActivity, model.JSONB(`{"enabled":true,"discount_bps":5000}`), "test", f.now); err != nil {
			t.Fatal(err)
		}
		job, c := reserveAutomaticVideo(t, f, `{"model":"seedance-2.5","duration":-1,"resolution":"720p","content":[{"type":"video_url"}]}`, &VideoBillingPolicy{MaxDurationSeconds: 30, Resolutions: []string{"720p"}})
		if c.CreditsQuoted != 7200 {
			t.Fatalf("reserved=%d", c.CreditsQuoted)
		}
		if err := f.billing.UpsertConfig(model.BillingConfigKeyActivity, model.JSONB(`{"enabled":false}`), "test", f.now); err != nil {
			t.Fatal(err)
		}
		prices := DefaultModelCreditPrices()
		originalPrices, _ := json.Marshal(prices)
		t.Cleanup(func() {
			_ = f.billing.UpsertConfig(model.BillingConfigKeyModelPrices, model.JSONB(originalPrices), "test", f.now)
		})
		prices.Videos["seedance-2.5"]["720p"] = []float64{1, 1, 1}
		raw, _ := json.Marshal(prices)
		if err := f.billing.UpsertConfig(model.BillingConfigKeyModelPrices, model.JSONB(raw), "test", f.now); err != nil {
			t.Fatal(err)
		}
		job.Result = measuredVideoResult(12.5, 1280, 720)
		outcome, err := f.engine.SettleCompletedJob(job)
		if err != nil || !outcome.Changed || outcome.Consumption.CreditsSettled != 3000 {
			t.Fatalf("settled=%+v err=%v", outcome, err)
		}
		assertRecoveryBalance(t, f, 997000)
		account, err := f.credits.GetAccount(f.user)
		if err != nil || account.PermanentFrozen != 0 {
			t.Fatalf("freeze remains: %+v err=%v", account, err)
		}
		duplicate, err := f.engine.SettleCompletedJob(job)
		if err != nil || duplicate.Changed {
			t.Fatalf("duplicate=%+v err=%v", duplicate, err)
		}
	})
	t.Run("MissingMetricsHoldAndRepairWithoutRegeneration", func(t *testing.T) {
		f := newLifecycleFixture(t, db)
		job, c := reserveAutomaticVideo(t, f, `{"model":"seedance-2.0","duration":-1,"resolution":"720p"}`, &VideoBillingPolicy{MaxDurationSeconds: 15, Resolutions: []string{"720p"}})
		if _, err := f.engine.Settle(job.ID); !errors.Is(err, repository.ErrActualSettlementRequired) {
			t.Fatalf("unmeasured max settlement accepted: %v", err)
		}
		r := NewCreditReconciler(f.credits, f.jobs, f.engine, time.Second)
		settled, released, err := r.ReconcileOnce(context.Background())
		if err != nil || settled != 0 || released != 0 {
			t.Fatalf("missing metric reconcile=%d,%d,%v", settled, released, err)
		}
		after, _ := f.credits.GetConsumptionByJobID(job.ID)
		if after.Status != model.TaskConsumptionStatusReserved || after.CreditsQuoted != c.CreditsQuoted {
			t.Fatalf("hold lost: %+v", after)
		}
		if _, err := f.jobs.SetResult(job.ID, measuredVideoResult(6, 1280, 720)); err != nil {
			t.Fatal(err)
		}
		settled, released, err = r.ReconcileOnce(context.Background())
		if err != nil || settled != 1 || released != 0 {
			t.Fatalf("repaired reconcile=%d,%d,%v", settled, released, err)
		}
		assertRecoveryBalance(t, f, 999400)
	})
	t.Run("UnknownOrExcessiveMetricsRemainReserved", func(t *testing.T) {
		for _, result := range []model.JSONB{model.JSONB(`{"video_metrics":{"version":1,"source":"request","duration_seconds":1,"width":1280,"height":720}}`), measuredVideoResult(16, 1280, 720), measuredVideoResult(5, 0, 720)} {
			f := newLifecycleFixture(t, db)
			job, _ := reserveAutomaticVideo(t, f, `{"model":"seedance-2.0","duration":-1,"resolution":"720p"}`, &VideoBillingPolicy{MaxDurationSeconds: 15, Resolutions: []string{"720p"}})
			job.Result = result
			if _, err := f.engine.SettleCompletedJob(job); !errors.Is(err, ErrVideoBillingMetricsPending) {
				t.Fatalf("bad metrics accepted: %v", err)
			}
			c, _ := f.credits.GetConsumptionByJobID(job.ID)
			if c.Status != model.TaskConsumptionStatusReserved {
				t.Fatal("bad metrics lost hold")
			}
		}
	})
	t.Run("ContainerRoundingNeverChargesBeyondReserve", func(t *testing.T) {
		f := newLifecycleFixture(t, db)
		job, c := reserveAutomaticVideo(t, f, `{"model":"seedance-2.5","duration":-1,"resolution":"720p"}`, &VideoBillingPolicy{MaxDurationSeconds: 30, Resolutions: []string{"720p"}})
		job.Result = measuredVideoResult(30.03, 1280, 720)
		outcome, err := f.engine.SettleCompletedJob(job)
		if err != nil || outcome.Consumption.CreditsSettled != c.CreditsQuoted {
			t.Fatalf("max boundary=%+v err=%v", outcome, err)
		}
	})
	t.Run("AutomaticResolutionUsesMeasuredFrozenRate", func(t *testing.T) {
		f := newLifecycleFixture(t, db)
		job, c := reserveAutomaticVideo(t, f, `{"model":"seedance-2.5","duration":-1,"resolution":"auto"}`, &VideoBillingPolicy{MaxDurationSeconds: 30, Resolutions: []string{"720p", "1080p"}})
		if c.CreditsQuoted != 16800 {
			t.Fatalf("automatic resolution reserved=%d", c.CreditsQuoted)
		}
		job.Result = measuredVideoResult(10, 1280, 720)
		outcome, err := f.engine.SettleCompletedJob(job)
		if err != nil || outcome.Consumption.CreditsSettled != 2200 {
			t.Fatalf("actual resolution=%+v err=%v", outcome, err)
		}
	})
	t.Run("PartialSettlementReleasesFEFOAndDoesNotReviveExpiredGrant", func(t *testing.T) {
		for _, expired := range []bool{false, true} {
			f := newLifecycleFixture(t, db)
			grant, err := f.engine.Grant(GrantInput{UserID: f.user, SourceType: model.GrantSourceMemberMonthly, Amount: 100, TTL: time.Hour, PeriodKey: f.user + "_grant"})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := f.engine.Adjust(f.user, 100, "test", f.user+"_seed"); err != nil {
				t.Fatal(err)
			}
			job := f.user + "_partial"
			if _, err := f.engine.Reserve(f.user, CreditQuote{JobID: job, TaskType: model.TaskTypeVideoStandard, Credits: 120, Params: map[string]any{"billing_mode": AutomaticVideoBillingMode}}); err != nil {
				t.Fatal(err)
			}
			if expired {
				f.now = f.now.Add(2 * time.Hour)
				if _, err := f.credits.ExpireGrant(grant.Grant.ID, f.now); err != nil {
					t.Fatal(err)
				}
			}
			outcome, err := f.credits.SettleAmount(job, 90, model.JSONB(`{"billing_mode":"actual_video_duration","actual_duration_sec":9}`), f.now)
			if err != nil || outcome.Consumption.CreditsSettled != 90 {
				t.Fatalf("partial=%+v err=%v", outcome, err)
			}
			g, err := f.credits.GetGrantByID(grant.Grant.ID)
			want := int64(10)
			if expired {
				want = 0
			}
			if err != nil || g.AmountRemaining != want || g.AmountFrozen != 0 {
				t.Fatalf("grant=%+v want=%d err=%v", g, want, err)
			}
			a, err := f.credits.GetAccount(f.user)
			if err != nil || a.PermanentBalance != 100 || a.PermanentFrozen != 0 {
				t.Fatalf("account=%+v err=%v", a, err)
			}
		}
	})
	t.Run("ConcurrentSettlementOnlyChargesOnce", func(t *testing.T) {
		f := newLifecycleFixture(t, db)
		job, _ := reserveAutomaticVideo(t, f, `{"model":"seedance-2.0","duration":-1,"resolution":"720p"}`, &VideoBillingPolicy{MaxDurationSeconds: 15, Resolutions: []string{"720p"}})
		job.Result = measuredVideoResult(5, 1280, 720)
		var wg sync.WaitGroup
		errs := make(chan error, 8)
		for i := 0; i < 8; i++ {
			wg.Add(1)
			go func() { defer wg.Done(); _, err := f.engine.SettleCompletedJob(job); errs <- err }()
		}
		wg.Wait()
		close(errs)
		for err := range errs {
			if err != nil {
				t.Fatal(err)
			}
		}
		assertRecoveryBalance(t, f, 999500)
		assertRecoveryLedgerCount(t, f, model.LedgerTypeConsume, 1)
	})
}
