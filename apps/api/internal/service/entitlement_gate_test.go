package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/queue"
	"github.com/ai-manju/api/internal/repository"
)

// entitlementFixture 装配门禁：会员仓储 + 任务仓储（计数）。
type entitlementFixture struct {
	gate        *EntitlementGate
	memberships *repository.MemoryMembershipRepository
	jobs        *repository.MemoryJobRepository
	now         time.Time
	jobSeq      int
}

func newEntitlementFixture(t *testing.T) *entitlementFixture {
	t.Helper()
	fx := &entitlementFixture{
		memberships: repository.NewMemoryMembershipRepository(),
		jobs:        repository.NewMemoryJobRepository(),
		now:         time.Now().UTC(),
	}
	fx.gate = NewEntitlementGate(fx.memberships, fx.jobs)
	fx.gate.SetClock(func() time.Time { return fx.now })
	if err := fx.memberships.SeedPlans([]model.MembershipPlan{
		{ID: "plan_198", Code: model.PlanCodeMember198, Name: "198 会员", PriceMonthCents: 19800, MonthlyCredits: 19800,
			ImageConcurrency: 4, VideoConcurrency: 2, Features: model.JSONB(`{"remove_watermark":true,"commercial":true,"agent_free":true}`), Enabled: true},
	}); err != nil {
		t.Fatal(err)
	}
	return fx
}

func (fx *entitlementFixture) makeMember(t *testing.T, userID string) {
	t.Helper()
	if _, err := fx.memberships.CreateMembership(model.UserMembership{
		UserID: userID, PlanID: "plan_198", Status: model.MembershipStatusActive,
		Source: model.MembershipSourcePurchase, StartedAt: fx.now.Add(-time.Hour), ExpiresAt: fx.now.Add(29 * 24 * time.Hour),
	}); err != nil {
		t.Fatal(err)
	}
}

func (fx *entitlementFixture) enqueueJob(t *testing.T, userID string, jobType string, status string) {
	t.Helper()
	fx.jobSeq++
	if _, err := fx.jobs.Create(model.Job{
		ID:             fmt.Sprintf("job_%s_%d", userID, fx.jobSeq),
		IdempotencyKey: fmt.Sprintf("k_%s_%d", userID, fx.jobSeq),
		UserID:         userID, Type: jobType, Status: status,
	}); err != nil {
		t.Fatal(err)
	}
}

func TestEntitlementConcurrencyLimitsByTier(t *testing.T) {
	fx := newEntitlementFixture(t)

	// 免费用户：图片 2 路。
	fx.enqueueJob(t, "free_user", model.JobTypeImageGenerate, model.JobStatusQueued)
	fx.enqueueJob(t, "free_user", model.JobTypeImageGenerate, model.JobStatusRunning)
	if err := fx.gate.CheckAdmission("free_user", model.JobTypeImageGenerate); !errors.Is(err, ErrConcurrencyLimitExceeded) {
		t.Fatalf("free user at 2 image jobs err = %v, want limit exceeded", err)
	}
	// 已完成的不计数。
	fx.enqueueJob(t, "free_user", model.JobTypeImageGenerate, model.JobStatusSucceeded)
	if err := fx.gate.CheckAdmission("free_user", model.JobTypeImageGenerate); !errors.Is(err, ErrConcurrencyLimitExceeded) {
		t.Fatalf("succeeded job should not count, err = %v", err)
	}

	// 会员：图片 4 路。
	fx.makeMember(t, "member_user")
	for i := 0; i < 3; i++ {
		fx.enqueueJob(t, "member_user", model.JobTypeImageGenerate, model.JobStatusQueued)
	}
	if err := fx.gate.CheckAdmission("member_user", model.JobTypeImageGenerate); err != nil {
		t.Fatalf("member at 3/4 should pass, err = %v", err)
	}
	fx.enqueueJob(t, "member_user", model.JobTypeImageGenerate, model.JobStatusQueued)
	if err := fx.gate.CheckAdmission("member_user", model.JobTypeImageGenerate); !errors.Is(err, ErrConcurrencyLimitExceeded) {
		t.Fatalf("member at 4/4 err = %v, want limit exceeded", err)
	}

	// 视频提交进入持久队列，不因免费账户已有运行任务而拒绝。
	fx.enqueueJob(t, "free_user", model.JobTypeVideoGenerate, model.JobStatusQueued)
	if err := fx.gate.CheckAdmission("free_user", model.JobTypeVideoGenerate); err != nil {
		t.Fatalf("free user queued video err = %v, want nil", err)
	}
}

func TestEntitlementAgentAccess(t *testing.T) {
	fx := newEntitlementFixture(t)
	if err := fx.gate.AgentAccess("free_user"); !errors.Is(err, ErrAgentRequiresMember) {
		t.Fatalf("free agent access err = %v", err)
	}
	fx.makeMember(t, "member_user")
	if err := fx.gate.AgentAccess("member_user"); err != nil {
		t.Fatalf("member agent access err = %v", err)
	}
}

func TestEntitlementFeatureFlags(t *testing.T) {
	fx := newEntitlementFixture(t)
	enabled, err := fx.gate.FeatureEnabled("free_user", "remove_watermark")
	if err != nil || enabled {
		t.Fatalf("free remove_watermark = %v, want false", enabled)
	}
	fx.makeMember(t, "member_user")
	enabled, err = fx.gate.FeatureEnabled("member_user", "remove_watermark")
	if err != nil || !enabled {
		t.Fatalf("member remove_watermark = %v, want true", enabled)
	}
}

func TestBillingHooksEnforceAdmissionBeforeReserve(t *testing.T) {
	// 门禁 + 定价 + 引擎全链路：超并发时不得冻结积分。
	credits := repository.NewMemoryCreditRepository()
	memberships := repository.NewMemoryMembershipRepository()
	billing := repository.NewMemoryBillingRepository()
	jobs := repository.NewMemoryJobRepository()
	engine := NewCreditLedgerService(credits, memberships, billing)
	pricer := NewCreditPricer(billing)
	gate := NewEntitlementGate(memberships, jobs)
	hooks := NewBillingHooks(pricer, engine, gate)
	svc := NewJobService(jobs, &queue.MemoryProducer{}, "celery", 3)
	svc.SetBillingHooks(hooks)

	if _, err := engine.Adjust("user_gate", 10000, "ops", "nonce_gate"); err != nil {
		t.Fatal(err)
	}
	// 免费用户图片 2 路：前两单成功冻结，第三单 429。
	for _, key := range []string{"g1", "g2"} {
		if _, err := svc.Enqueue(context.Background(), EnqueueJobInput{
			UserID: "user_gate", Scope: WorkspaceScopePersonal, Type: model.JobTypeImageGenerate,
			Payload: model.JSONB(`{"size":"512x512","n":1}`), IdempotencyKey: key,
		}); err != nil {
			t.Fatal(err)
		}
	}
	_, err := svc.Enqueue(context.Background(), EnqueueJobInput{
		UserID: "user_gate", Scope: WorkspaceScopePersonal, Type: model.JobTypeImageGenerate,
		Payload: model.JSONB(`{"size":"512x512","n":1}`), IdempotencyKey: "g3",
	})
	if !errors.Is(err, ErrConcurrencyLimitExceeded) {
		t.Fatalf("third job err = %v, want ErrConcurrencyLimitExceeded", err)
	}
	// 超并发未冻结：余额未被第三单占用。
	overview, _ := engine.Overview("user_gate")
	if overview.PermanentFrozen != 40 { // 2 × 20
		t.Fatalf("frozen = %d, want 40（超并发单未冻结）", overview.PermanentFrozen)
	}
}

func TestBillingHooksForceWatermarkForNonMemberVideo(t *testing.T) {
	credits := repository.NewMemoryCreditRepository()
	memberships := repository.NewMemoryMembershipRepository()
	billing := repository.NewMemoryBillingRepository()
	jobs := repository.NewMemoryJobRepository()
	engine := NewCreditLedgerService(credits, memberships, billing)
	gate := NewEntitlementGate(memberships, jobs)
	hooks := NewBillingHooks(NewCreditPricer(billing), engine, gate)

	// 非会员视频：watermark 强制 true。
	rewritten, err := hooks.NormalizePayloadForJob("free_user", model.JobTypeVideoGenerate, model.JSONB(`{"model":"seedance-2.0","duration":5}`))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(rewritten), `"watermark":true`) {
		t.Fatalf("payload = %s, want watermark forced", rewritten)
	}

	// 会员（remove_watermark）：不改写。
	if err := memberships.SeedPlans([]model.MembershipPlan{
		{ID: "plan_198", Code: model.PlanCodeMember198, Name: "198 会员", PriceMonthCents: 19800, MonthlyCredits: 19800, Features: model.JSONB(`{"remove_watermark":true}`), Enabled: true},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := memberships.CreateMembership(model.UserMembership{
		UserID: "member_user", PlanID: "plan_198", Status: model.MembershipStatusActive,
		Source: model.MembershipSourcePurchase, StartedAt: time.Now().UTC(), ExpiresAt: time.Now().UTC().Add(29 * 24 * time.Hour),
	}); err != nil {
		t.Fatal(err)
	}
	original := model.JSONB(`{"model":"seedance-2.0","duration":5,"watermark":false}`)
	rewritten, err = hooks.NormalizePayloadForJob("member_user", model.JobTypeVideoGenerate, original)
	if err != nil {
		t.Fatal(err)
	}
	if string(rewritten) != string(original) {
		t.Fatalf("member payload rewritten: %s", rewritten)
	}
}
