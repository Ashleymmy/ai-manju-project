package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/queue"
	"github.com/ai-manju/api/internal/repository"
)

// billingFixture assembles the WP-M3 wiring over Memory repositories:
// pricer + engine + hooks + job service + reconciler.
type billingFixture struct {
	jobs       *JobService
	jobRepo    *repository.MemoryJobRepository
	engine     *CreditLedgerService
	pricer     *CreditPricer
	reconciler *CreditReconciler
	credits    *repository.MemoryCreditRepository
	billing    *repository.MemoryBillingRepository
	producer   *queue.MemoryProducer
}

func newBillingFixture(t *testing.T) *billingFixture {
	t.Helper()
	fx := &billingFixture{
		jobRepo:  repository.NewMemoryJobRepository(),
		credits:  repository.NewMemoryCreditRepository(),
		billing:  repository.NewMemoryBillingRepository(),
		producer: &queue.MemoryProducer{},
	}
	memberships := repository.NewMemoryMembershipRepository()
	fx.engine = NewCreditLedgerService(fx.credits, memberships, fx.billing)
	fx.pricer = NewCreditPricer(fx.billing)
	fx.jobs = NewJobService(fx.jobRepo, fx.producer, "celery", 3)
	fx.jobs.SetBillingHooks(NewBillingHooks(fx.pricer, fx.engine, nil))
	fx.reconciler = NewCreditReconciler(fx.credits, fx.jobRepo, fx.engine, time.Second)
	return fx
}

func (fx *billingFixture) enqueue(t *testing.T, userID string, jobType string, payload string) EnqueueJobResult {
	t.Helper()
	result, err := fx.jobs.Enqueue(context.Background(), EnqueueJobInput{
		UserID: userID, Scope: WorkspaceScopePersonal, Type: jobType, Payload: model.JSONB(payload),
		IdempotencyKey: "test-" + jobType + "-" + payload,
	})
	if err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	return result
}

func TestPricerDefaultsMatchDocumentedPricingPage(t *testing.T) {
	pricer := NewCreditPricer(repository.NewMemoryBillingRepository())

	cases := []struct {
		name     string
		jobType  string
		payload  string
		want     int64
		taskType string
	}{
		{"普通漫剧图512", model.JobTypeImageGenerate, `{"model":"gpt-image-2","size":"512x512","n":1}`, 20, model.TaskTypeImage},
		{"高清漫剧图1024", model.JobTypeImageGenerate, `{"model":"gpt-image-2","size":"1024x1024","n":1}`, 50, model.TaskTypeImage},
		{"大图2K", model.JobTypeImageGenerate, `{"model":"gpt-image-2","size":"2048x2048","n":1}`, 80, model.TaskTypeImage},
		{"批量4张", model.JobTypeImageGenerate, `{"model":"gpt-image-2","size":"1024x1024","n":4}`, 200, model.TaskTypeImage},
		{"视频Fast10秒", model.JobTypeVideoGenerate, `{"model":"seedance-fast","duration":10}`, 80, model.TaskTypeVideoFast},
		{"视频Fast按service_tier", model.JobTypeVideoGenerate, `{"model":"seedance-2.0","service_tier":"fast","duration":10}`, 80, model.TaskTypeVideoFast},
		{"视频标准10秒", model.JobTypeVideoGenerate, `{"model":"seedance-2.0","duration":10}`, 120, model.TaskTypeVideoStandard},
		{"视频默认时长5秒", model.JobTypeVideoGenerate, `{"model":"seedance-2.0"}`, 60, model.TaskTypeVideoStandard},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			credits, taskType, _, chargeable := pricer.QuoteForJob(tc.jobType, model.JSONB(tc.payload))
			if !chargeable || credits != tc.want || taskType != tc.taskType {
				t.Fatalf("quote = %d %s chargeable=%v, want %d %s", credits, taskType, chargeable, tc.want, tc.taskType)
			}
		})
	}
}

func TestPricerFreeJobTypes(t *testing.T) {
	pricer := NewCreditPricer(repository.NewMemoryBillingRepository())
	for _, jobType := range []string{model.JobTypeVideoTranscode, "asset.export", "text.generate"} {
		if _, _, _, chargeable := pricer.QuoteForJob(jobType, model.JSONB(`{}`)); chargeable {
			t.Fatalf("%s should be free（文档：转码/文本不扣费）", jobType)
		}
	}
}

func TestPricerConfigOverride(t *testing.T) {
	billing := repository.NewMemoryBillingRepository()
	if err := billing.UpsertConfig(model.BillingConfigKeyPricingRules, model.JSONB(`{"image":{"standard_1024":66}}`), "admin:test", time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	pricer := NewCreditPricer(billing)
	credits, _, _, _ := pricer.QuoteForJob(model.JobTypeImageGenerate, model.JSONB(`{"size":"1024x1024","n":1}`))
	if credits != 66 {
		t.Fatalf("override price = %d, want 66", credits)
	}
	// 未覆盖的档仍用默认值。
	credits, _, _, _ = pricer.QuoteForJob(model.JobTypeImageGenerate, model.JSONB(`{"size":"512x512","n":1}`))
	if credits != 20 {
		t.Fatalf("default price = %d, want 20", credits)
	}
}

func TestPricerActivityDiscountWindow(t *testing.T) {
	billing := repository.NewMemoryBillingRepository()
	now := time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC)
	pricer := NewCreditPricer(billing)
	pricer.SetClock(func() time.Time { return now })
	payload := model.JSONB(`{"model":"seedance-fast","duration":10}`) // 80 原价

	enabled := `{"enabled":true,"starts_at":"2026-09-01T00:00:00Z","ends_at":"2026-10-01T00:00:00Z","discount_bps":5000,"applies_to":["video_fast"]}`
	if err := billing.UpsertConfig(model.BillingConfigKeyActivity, model.JSONB(enabled), "admin:test", now); err != nil {
		t.Fatal(err)
	}
	credits, _, params, _ := pricer.QuoteForJob(model.JobTypeVideoGenerate, payload)
	if credits != 40 {
		t.Fatalf("discounted = %d, want 40（五折）", credits)
	}
	if params["activity_discount_bps"] != 5000 {
		t.Fatalf("params = %+v, want discount snapshot", params)
	}

	// 图片不在活动范围内 → 原价。
	credits, _, _, _ = pricer.QuoteForJob(model.JobTypeImageGenerate, model.JSONB(`{"size":"1024x1024","n":1}`))
	if credits != 50 {
		t.Fatalf("image during video-only activity = %d, want 50", credits)
	}

	// 活动过期 → 原价。
	expired := `{"enabled":true,"starts_at":"2026-08-01T00:00:00Z","ends_at":"2026-09-01T00:00:00Z","discount_bps":5000,"applies_to":["video_fast"]}`
	if err := billing.UpsertConfig(model.BillingConfigKeyActivity, model.JSONB(expired), "admin:test", now); err != nil {
		t.Fatal(err)
	}
	credits, _, _, _ = pricer.QuoteForJob(model.JobTypeVideoGenerate, payload)
	if credits != 80 {
		t.Fatalf("expired activity price = %d, want 80", credits)
	}
}

func TestEnqueueReservesAndInsufficientBalanceRejects(t *testing.T) {
	fx := newBillingFixture(t)
	if _, err := fx.engine.Adjust("user_a", 100, "ops", "nonce_a"); err != nil {
		t.Fatal(err)
	}

	// 余额 100，高清图 50 → 成功并冻结。
	result := fx.enqueue(t, "user_a", model.JobTypeImageGenerate, `{"size":"1024x1024","n":1}`)
	consumption, err := fx.credits.GetConsumptionByJobID(result.Job.ID)
	if err != nil || consumption.Status != model.TaskConsumptionStatusReserved || consumption.CreditsQuoted != 50 {
		t.Fatalf("consumption = %+v err=%v", consumption, err)
	}

	// 再提交 3 张批量 = 150 → 余额不足，任务不得创建。
	_, err = fx.jobs.Enqueue(context.Background(), EnqueueJobInput{
		UserID: "user_a", Scope: WorkspaceScopePersonal, Type: model.JobTypeImageGenerate,
		Payload: model.JSONB(`{"size":"1024x1024","n":3}`), IdempotencyKey: "test-insufficient",
	})
	if !errors.Is(err, repository.ErrInsufficientCredits) {
		t.Fatalf("err = %v, want ErrInsufficientCredits", err)
	}
	if _, getErr := fx.jobRepo.GetByIdempotencyKey("test-insufficient"); getErr == nil {
		t.Fatal("job must not be created when reserve fails")
	}

	// 免费类型（转码）不冻结。
	free := fx.enqueue(t, "user_a", model.JobTypeVideoTranscode, `{"foo":1}`)
	if _, err := fx.credits.GetConsumptionByJobID(free.Job.ID); !errors.Is(err, repository.ErrConsumptionNotFound) {
		t.Fatalf("transcode should have no consumption, err=%v", err)
	}
}

func TestEnqueuePublishFailureReleasesReservation(t *testing.T) {
	fx := newBillingFixture(t)
	fx.jobs = NewJobService(fx.jobRepo, failingJobProducer{}, "celery", 3)
	fx.jobs.SetBillingHooks(NewBillingHooks(fx.pricer, fx.engine, nil))
	if _, err := fx.engine.Adjust("user_b", 100, "ops", "nonce_b"); err != nil {
		t.Fatal(err)
	}

	_, err := fx.jobs.Enqueue(context.Background(), EnqueueJobInput{
		UserID: "user_b", Scope: WorkspaceScopePersonal, Type: model.JobTypeImageGenerate,
		Payload: model.JSONB(`{"size":"512x512","n":1}`), IdempotencyKey: "test-pubfail",
	})
	if err == nil {
		t.Fatal("publish failure should surface")
	}
	overview, _ := fx.engine.Overview("user_b")
	if overview.PermanentFrozen != 0 || overview.PermanentAvailable != 100 {
		t.Fatalf("overview = %+v, want freeze fully released（入队失败不扣费）", overview)
	}
}

func TestCancelForUserReleasesReservation(t *testing.T) {
	fx := newBillingFixture(t)
	if _, err := fx.engine.Adjust("user_c", 100, "ops", "nonce_c"); err != nil {
		t.Fatal(err)
	}
	result := fx.enqueue(t, "user_c", model.JobTypeImageGenerate, `{"size":"1024x1024","n":1}`)

	if _, err := fx.jobs.CancelForUser(result.Job.ID, "user_c"); err != nil {
		t.Fatal(err)
	}
	overview, _ := fx.engine.Overview("user_c")
	if overview.PermanentFrozen != 0 || overview.PermanentBalance != 100 {
		t.Fatalf("overview = %+v, want cancel full refund（取消不扣费）", overview)
	}
}

func TestReconcilerSettlesSucceededAndReleasesFailed(t *testing.T) {
	fx := newBillingFixture(t)
	if _, err := fx.engine.Adjust("user_d", 1000, "ops", "nonce_d"); err != nil {
		t.Fatal(err)
	}
	okJob := fx.enqueue(t, "user_d", model.JobTypeImageGenerate, `{"size":"1024x1024","n":1}`)                // 50
	failJob := fx.enqueue(t, "user_d", model.JobTypeVideoGenerate, `{"model":"seedance-fast","duration":10}`) // 80
	running := fx.enqueue(t, "user_d", model.JobTypeImageGenerate, `{"size":"512x512","n":1}`)                // 20，保持 queued

	// 模拟 worker 直写 Postgres 的终态。
	if _, err := fx.jobRepo.SetResult(okJob.Job.ID, model.JSONB(`{"ok":true}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.jobRepo.SetError(failJob.Job.ID, model.JSONB(`{"code":"boom"}`)); err != nil {
		t.Fatal(err)
	}

	settled, released, err := fx.reconciler.ReconcileOnce(context.Background())
	if err != nil || settled != 1 || released != 1 {
		t.Fatalf("settled=%d released=%d err=%v, want 1/1", settled, released, err)
	}
	overview, _ := fx.engine.Overview("user_d")
	if overview.PermanentBalance != 950 || overview.PermanentFrozen != 20 {
		t.Fatalf("overview = %+v, want balance 950 frozen 20（成功扣50、失败退80、在途冻结20）", overview)
	}

	// 幂等：再次对账无变化。
	settled, released, err = fx.reconciler.ReconcileOnce(context.Background())
	if err != nil || settled != 0 || released != 0 {
		t.Fatalf("repeat reconcile settled=%d released=%d, want 0/0", settled, released)
	}
	if overview2, _ := fx.engine.Overview("user_d"); overview2.PermanentBalance != 950 {
		t.Fatalf("balance moved on repeat reconcile: %d", overview2.PermanentBalance)
	}
	_ = running
}

func TestReconcilerKeepsUncertainSDVideoReservation(t *testing.T) {
	fx := newBillingFixture(t)
	if _, err := fx.engine.Adjust("user_uncertain", 1000, "ops", "nonce_uncertain"); err != nil {
		t.Fatal(err)
	}
	created, err := fx.jobs.CreateExternal(ExternalJobInput{
		UserID: "user_uncertain", Scope: WorkspaceScopePersonal,
		Type: model.JobTypeVideoGenerate, ExternalProvider: "sd-video", ExternalTaskID: "remote-uncertain",
		Payload: model.JSONB(`{"model":"seedance-2.5","duration":5}`), IdempotencyKey: "uncertain-video",
	})
	if err != nil || !created.Created {
		t.Fatalf("create uncertain external job: %+v err=%v", created, err)
	}
	if _, err := fx.jobs.SetError(created.Job.ID, model.JSONB(`{"code":"submission_uncertain"}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.jobs.UpdateExternalState(created.Job.ID, "sd-video", "remote-uncertain", "failed", model.JSONB(`{"status":"failed"}`)); err != nil {
		t.Fatal(err)
	}
	settled, released, err := fx.reconciler.ReconcileOnce(context.Background())
	if err != nil || settled != 0 || released != 0 {
		t.Fatalf("uncertain reconcile=%d,%d,%v, want 0/0", settled, released, err)
	}
	consumption, err := fx.credits.GetConsumptionByJobID(created.Job.ID)
	if err != nil || consumption.Status != model.TaskConsumptionStatusReserved {
		t.Fatalf("uncertain reservation changed: %+v err=%v", consumption, err)
	}
}

func TestReconcilerReleasesOrphanReservationAfterGrace(t *testing.T) {
	fx := newBillingFixture(t)
	if _, err := fx.engine.Adjust("user_e", 100, "ops", "nonce_e"); err != nil {
		t.Fatal(err)
	}
	// 直接造一个无对应 Job 的冻结（模拟建单前崩溃）。
	if _, err := fx.engine.Reserve("user_e", CreditQuote{JobID: "job_orphan", TaskType: model.TaskTypeImage, Model: "m", Params: map[string]any{}, Credits: 50}); err != nil {
		t.Fatal(err)
	}

	// 宽限期内不释放。
	settled, released, err := fx.reconciler.ReconcileOnce(context.Background())
	if err != nil || settled != 0 || released != 0 {
		t.Fatalf("within grace settled=%d released=%d, want 0/0", settled, released)
	}

	// 超过宽限期 → 释放。
	past := time.Now().UTC().Add(-2 * time.Hour)
	consumption, _ := fx.credits.GetConsumptionByJobID("job_orphan")
	consumption.CreatedAt = past
	// Memory 仓储没有 Update 接口，经由再 Reserve 同一 job 覆盖不可行；改用
	// SetClock 让 reconciler 认为现在更晚。
	fx.reconciler.SetClock(func() time.Time { return time.Now().UTC().Add(2 * time.Hour) })
	settled, released, err = fx.reconciler.ReconcileOnce(context.Background())
	if err != nil || released != 1 {
		t.Fatalf("after grace settled=%d released=%d err=%v, want released=1", settled, released, err)
	}
	overview, _ := fx.engine.Overview("user_e")
	if overview.PermanentFrozen != 0 || overview.PermanentBalance != 100 {
		t.Fatalf("overview = %+v, want orphan freeze released", overview)
	}
	_ = consumption
}

func TestBillingDisabledLeavesNoTrace(t *testing.T) {
	// hooks 为 nil（BILLING_ENABLED 关闭）：任务创建不触碰账本。
	svc := NewJobService(repository.NewMemoryJobRepository(), &queue.MemoryProducer{}, "celery", 3)
	result, err := svc.Enqueue(context.Background(), EnqueueJobInput{
		UserID: "user_f", Scope: WorkspaceScopePersonal, Type: model.JobTypeImageGenerate,
		Payload: model.JSONB(`{"size":"1024x1024","n":1}`), IdempotencyKey: "test-off",
	})
	if err != nil || !result.Created {
		t.Fatalf("enqueue with billing disabled: %+v err=%v", result, err)
	}
}
