package service

import (
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type usageTestFixture struct {
	jobs        repository.JobRepository
	credits     repository.CreditRepository
	users       repository.UserRepository
	projects    repository.ProjectRepository
	memberships repository.MembershipRepository
	monitoring  repository.MonitoringRepository
	usage       repository.UsageRepository
	report      *AdminUsageService
}

func usageTestBackends(t *testing.T, run func(*testing.T, usageTestFixture)) {
	t.Helper()
	t.Run("Memory", func(t *testing.T) {
		f := usageTestFixture{jobs: repository.NewMemoryJobRepository(), credits: repository.NewMemoryCreditRepository(), users: repository.NewMemoryUserRepository(), projects: repository.NewMemoryProjectRepository(), memberships: repository.NewMemoryMembershipRepository(), monitoring: repository.NewMemoryMonitoringRepository()}
		f.usage = repository.NewUsageRepository(f.jobs, f.credits, f.monitoring, f.memberships)
		f.report = NewAdminUsageService(f.usage, f.users, f.projects, f.memberships)
		run(t, f)
	})
	t.Run("Postgres", func(t *testing.T) {
		dsn := os.Getenv("TEST_DATABASE_URL")
		if dsn == "" {
			t.Skip("TEST_DATABASE_URL not set")
		}
		db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
		if err != nil {
			t.Fatal(err)
		}
		schema := fmt.Sprintf("usage_test_%d", time.Now().UnixNano())
		if err := db.Exec("CREATE SCHEMA " + schema).Error; err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { db.Exec("DROP SCHEMA " + schema + " CASCADE"); sqlDB, _ := db.DB(); _ = sqlDB.Close() })
		u, err := url.Parse(dsn)
		if err != nil {
			t.Fatal(err)
		}
		q := u.Query()
		q.Set("search_path", schema)
		u.RawQuery = q.Encode()
		isolated, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { sqlDB, _ := isolated.DB(); _ = sqlDB.Close() })
		if err := isolated.AutoMigrate(&model.User{}, &model.Project{}, &model.CanvasSnapshot{}, &model.Job{}, &model.CreditAccount{}, &model.CreditGrant{}, &model.CreditLedgerEntry{}, &model.TaskConsumption{}, &model.MembershipPlan{}, &model.UserMembership{}, &model.AIRequestLog{}, &model.ModelCostRate{}, &model.TaskActualCost{}); err != nil {
			t.Fatal(err)
		}
		f := usageTestFixture{jobs: repository.NewGormJobRepository(isolated), credits: repository.NewGormCreditRepository(isolated), users: repository.NewGormUserRepository(isolated), projects: repository.NewGormProjectRepository(isolated), memberships: repository.NewGormMembershipRepository(isolated), monitoring: repository.NewGormMonitoringRepository(isolated)}
		f.usage = repository.NewUsageRepository(f.jobs, f.credits, f.monitoring, f.memberships)
		f.report = NewAdminUsageService(f.usage, f.users, f.projects, f.memberships)
		run(t, f)
	})
}

func TestAdminUsageReportsRealFactsAndCosts(t *testing.T) {
	usageTestBackends(t, func(t *testing.T, f usageTestFixture) {
		now := time.Now().UTC()
		start := now.Add(-time.Hour)
		end := now.Add(time.Hour)
		for _, id := range []string{"a", "b"} {
			if _, err := f.users.CreateUser(model.User{ID: id, Username: "user_" + id, DisplayName: "Member " + id, Role: model.UserRoleMember, Status: model.UserStatusActive, PasswordHash: "test-only"}); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := f.projects.Create(model.Project{ID: "project_a", OwnerID: "a", WorkspaceID: "ws_a", Title: "真实项目"}); err != nil {
			t.Fatal(err)
		}
		plan, err := f.memberships.UpsertPlan(model.MembershipPlan{Code: model.PlanCodeInternal, Name: "Internal", Features: model.JSONB(`{}`)})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.memberships.CreateMembership(model.UserMembership{UserID: "a", PlanID: plan.ID, Status: model.MembershipStatusActive, Source: model.MembershipSourceAdmin, StartedAt: start, ExpiresAt: end}); err != nil {
			t.Fatal(err)
		}
		if err := f.usage.AddRate(model.ModelCostRate{ID: "older", Model: "image-model", Unit: model.CostUnitImage, UnitCostMicros: 2000, EffectiveAt: start}); err != nil {
			t.Fatal(err)
		}
		if err := f.usage.AddRate(model.ModelCostRate{ID: "future", Model: "image-model", Unit: model.CostUnitImage, UnitCostMicros: 999999, EffectiveAt: end}); err != nil {
			t.Fatal(err)
		}
		if _, err := f.credits.AdjustPermanent("a", 100, model.LedgerTypeAdminAdd, "test", "fund", now); err != nil {
			t.Fatal(err)
		}
		for i, id := range []string{"job_a", "job_b", "job_c"} {
			user, status := "a", model.JobStatusSucceeded
			if i == 1 {
				status = model.JobStatusFailed
			}
			if i == 2 {
				user = "b"
			}
			payload := model.JSONB(`{"model":"image-model","n":2,"asset_registration":{"source_project_id":"project_a"},"api_key":"must-never-appear"}`)
			if i == 2 {
				payload = model.JSONB(`{"model":"unpriced"}`)
			}
			if _, err := f.jobs.Create(model.Job{ID: id, IdempotencyKey: id, UserID: user, WorkspaceID: "ws_a", Type: model.JobTypeImageGenerate, Status: status, Payload: payload, Result: model.JSONB(`{}`), Error: model.JSONB(`{}`)}); err != nil {
				t.Fatal(err)
			}
			if i == 0 {
				if _, err := f.credits.Reserve(repository.ReserveInput{JobID: id, UserID: user, TaskType: model.TaskTypeImage, Model: "image-model", Credits: 10, Params: model.JSONB(`{}`), Now: now}); err != nil {
					t.Fatal(err)
				}
				if _, err := f.credits.Settle(id, now); err != nil {
					t.Fatal(err)
				}
			}
		}
		// A failed vendor call may still have a real bill, including zero charges.
		for i := 0; i < 2; i++ {
			if err := f.usage.PutActualCost(model.TaskActualCost{JobID: "job_b", AmountMicros: 5000, Reference: "invoice-1", OperatorID: "ops", UpdatedAt: now}); err != nil {
				t.Fatal(err)
			}
		}
		if err := f.monitoring.CreateAIRequestLog(model.AIRequestLog{ID: "submission_only", UserID: "a", Operation: "image_generation", Status: model.AIRequestStatusSuccess, CreatedAt: now}); err != nil {
			t.Fatal(err)
		}
		filter := UsageFilter{Start: start, End: end, Page: 1, PageSize: 1, GroupBy: "member"}
		out, err := f.report.Report(filter)
		if err != nil {
			t.Fatal(err)
		}
		if out.Total != 3 || len(out.Items) != 1 || out.Stats.Tasks != 3 || out.Stats.CreditsSettled != 10 || out.Stats.ActualCostMicros != 5000 || out.Stats.EstimatedCostMicros != 4000 || out.Stats.AccountedCostMicros != 9000 || out.Stats.UnknownCostCount != 1 {
			t.Fatalf("wrong full-filter totals: %+v", out)
		}
		filter.UserID = "a"
		filter.ProjectID = "project_a"
		filter.MemberKind = "internal"
		filter.PageSize = 20
		out, err = f.report.Report(filter)
		if err != nil {
			t.Fatal(err)
		}
		if out.Total != 2 || out.Stats.UnknownCostCount != 0 || len(out.Groups) != 1 {
			t.Fatalf("wrong filtered totals: %+v", out)
		}
		for _, r := range out.Items {
			if r.ProjectName != "真实项目" || r.Username != "user_a" || !r.Internal {
				t.Fatalf("missing dimensions: %+v", r)
			}
			if strings.Contains(fmt.Sprint(r), "must-never-appear") {
				t.Fatal("raw payload leaked")
			}
			if r.JobID == "job_a" && (r.EstimatedCostMicros == nil || *r.EstimatedCostMicros != 4000 || r.RateID != "older") {
				t.Fatalf("historical rate incorrect: %+v", r)
			}
		}
		filter.MemberKind = "external"
		out, err = f.report.Report(filter)
		if err != nil || out.Total != 0 {
			t.Fatalf("internal exclusion: %+v %v", out, err)
		}
		filter = UsageFilter{Start: end, End: end.Add(time.Hour), Page: 1, PageSize: 20, GroupBy: "day"}
		out, err = f.report.Report(filter)
		if err != nil || out.Total != 0 || out.Stats.Tasks != 0 {
			t.Fatalf("empty range: %+v %v", out, err)
		}
	})
}

func TestAdminUsageTextCallsAndZeroActualCost(t *testing.T) {
	usageTestBackends(t, func(t *testing.T, f usageTestFixture) {
		now := time.Now().UTC()
		if err := f.monitoring.CreateAIRequestLog(model.AIRequestLog{ID: "text_1", UserID: "unknown-user", Operation: "text", Model: "chat", ProviderHost: "vendor.test", Status: model.AIRequestStatusSuccess, DurationMS: 100, CreatedAt: now}); err != nil {
			t.Fatal(err)
		}
		if err := f.usage.PutActualCost(model.TaskActualCost{JobID: "text_1", AmountMicros: 0, Reference: "free-tier invoice", UpdatedAt: now}); err != nil {
			t.Fatal(err)
		}
		out, err := f.report.Report(UsageFilter{Start: now.Add(-time.Hour), End: now.Add(time.Hour), Page: 1, PageSize: 20, GroupBy: "hour", TimezoneOffset: 480})
		if err != nil {
			t.Fatal(err)
		}
		if out.Total != 1 || out.Stats.ActualCount != 1 || out.Stats.UnknownCostCount != 0 || out.Items[0].ActualCostMicros == nil || out.Items[0].EstimatedCostMicros != nil {
			t.Fatalf("zero must differ from missing: %+v", out)
		}
		if ok, err := f.usage.TaskExists("text_1"); err != nil || !ok {
			t.Fatalf("text task lookup: %v %v", ok, err)
		}
	})
}

func TestAdminUsageLatestCorrectionAtSameEffectiveTime(t *testing.T) {
	usageTestBackends(t, func(t *testing.T, f usageTestFixture) {
		now := time.Now().UTC()
		if err := f.monitoring.CreateAIRequestLog(model.AIRequestLog{ID: "rate_text", Operation: "text", Model: "chat", Status: model.AIRequestStatusSuccess, CreatedAt: now}); err != nil {
			t.Fatal(err)
		}
		for i, id := range []string{"z-old", "a-correction"} {
			if err := f.usage.AddRate(model.ModelCostRate{ID: id, Model: "chat", Unit: model.CostUnitTask, UnitCostMicros: int64(i+1) * 1000, EffectiveAt: now.Add(-time.Hour), CreatedAt: now.Add(time.Duration(i) * time.Second)}); err != nil {
				t.Fatal(err)
			}
		}
		out, err := f.report.Report(UsageFilter{Start: now.Add(-time.Hour), End: now.Add(time.Hour), Page: 1, PageSize: 20, GroupBy: "model"})
		if err != nil || out.Total != 1 || out.Items[0].RateID != "a-correction" || out.Stats.EstimatedCostMicros != 2000 {
			t.Fatalf("latest correction must win regardless of random ID: %+v %v", out, err)
		}
	})
}
