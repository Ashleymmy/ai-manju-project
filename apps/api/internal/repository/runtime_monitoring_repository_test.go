package repository

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/database"
	"github.com/ai-manju/api/internal/model"
)

func TestRuntimeMonitoringRepositoryParity(t *testing.T) {
	for _, driver := range []string{"memory", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			var repo RuntimeMonitoringRepository
			var jobs JobRepository
			var calls MonitoringRepository
			if driver == "postgres" {
				dsn := os.Getenv("TEST_DATABASE_URL")
				if dsn == "" {
					t.Skip("TEST_DATABASE_URL required")
				}
				db, err := database.OpenPostgres(dsn)
				if err != nil {
					t.Fatal(err)
				}
				if err = db.AutoMigrate(&model.RuntimeError{}, &model.AIRequestLog{}, &model.Job{}); err != nil {
					t.Fatal(err)
				}
				jobs = NewGormJobRepository(db)
				calls = NewGormMonitoringRepository(db)
				t.Cleanup(func() {
					db.Where("id LIKE ?", "runtime_qa_%").Delete(&model.RuntimeError{})
					db.Where("id LIKE ?", "runtime_qa_%").Delete(&model.AIRequestLog{})
					db.Where("id LIKE ?", "runtime_qa_%").Delete(&model.Job{})
				})
			} else {
				jobs = NewMemoryJobRepository()
				calls = NewMemoryMonitoringRepository()
			}
			repo = NewRuntimeMonitoringRepository(jobs, calls)
			now := time.Now().UTC()
			ctx := context.Background()
			diagnostic := model.JSONB(`{"stage":"provider_response","provider_body":"{\"error\":{\"message\":\"actual failure\"},\"prompt\":\"PRIVATE\"}","provider_request_id":"upstream-id","provider_url":"https://host?token=SECRET"}`)
			for _, user := range []string{"qa_a", "qa_b"} {
				e := model.RuntimeError{ID: "runtime_qa_" + user, UserID: user, Source: "api", Message: "api_key=SECRET", Diagnostics: diagnostic, ProviderStatus: 422, CreatedAt: now,
					Operation: "generate", Model: "selected-model", ErrorCode: "provider_rejected", Detail: "actual service detail", Suggestion: "review response", Method: "POST", Endpoint: "/api/generate", HTTPStatus: 502,
					RequestID: "original-request", JobID: "job-trace", ProjectID: "project-trace", NodeID: "node-trace", Attempt: 2, DurationMS: 1250, Retryable: true}
				if err := repo.Record(ctx, e); err != nil {
					t.Fatal(err)
				}
				if err := repo.Record(ctx, e); err != nil {
					t.Fatal(err)
				}
				if err := calls.CreateAIRequestLog(model.AIRequestLog{ID: "runtime_qa_call_" + user, UserID: user, Diagnostics: diagnostic, CreatedAt: now}); err != nil {
					t.Fatal(err)
				}
				if _, err := jobs.Create(model.Job{ID: "runtime_qa_job_" + user, UserID: user, IdempotencyKey: "runtime_qa_" + user, Status: model.JobStatusFailed, Payload: model.JSONB(`{"asset_registration":{"source_node_id":"n","source_project_id":"p"}}`), Error: model.JSONB(`{"message":"failed"}`)}); err != nil {
					t.Fatal(err)
				}
			}
			_ = repo.Record(ctx, model.RuntimeError{ID: "runtime_qa_old", UserID: "qa_a", CreatedAt: now.Add(-48 * time.Hour)})
			facts, err := repo.Facts(ctx, now.Add(-time.Hour), now.Add(time.Hour), "qa_a")
			if err != nil {
				t.Fatal(err)
			}
			if len(facts.Errors) != 1 || len(facts.Calls) != 1 || len(facts.Jobs) != 1 {
				t.Fatalf("bad isolation or dedup %+v", facts)
			}
			if facts.Errors[0].Message != "api_key=[redacted]" {
				t.Fatal(facts.Errors[0].Message)
			}
			for _, raw := range []model.JSONB{facts.Errors[0].Diagnostics, facts.Calls[0].Diagnostics} {
				if !strings.Contains(string(raw), "actual failure") || !strings.Contains(string(raw), "upstream-id") || strings.Contains(string(raw), "SECRET") || strings.Contains(string(raw), "PRIVATE") {
					t.Fatal(string(raw))
				}
			}
			if facts.Errors[0].ProviderStatus != 422 {
				t.Fatal("lost upstream status")
			}
			stored := facts.Errors[0]
			for _, field := range []struct{ actual, expected string }{
				{stored.Operation, "generate"}, {stored.Model, "selected-model"}, {stored.ErrorCode, "provider_rejected"}, {stored.Detail, "actual service detail"}, {stored.Suggestion, "review response"},
				{stored.Method, "POST"}, {stored.Endpoint, "/api/generate"}, {stored.RequestID, "original-request"}, {stored.JobID, "job-trace"}, {stored.ProjectID, "project-trace"}, {stored.NodeID, "node-trace"},
			} {
				if field.actual != field.expected {
					t.Fatalf("original detail lost: got %q, want %q", field.actual, field.expected)
				}
			}
			if stored.HTTPStatus != 502 || stored.Attempt != 2 || stored.DurationMS != 1250 || !stored.Retryable {
				t.Fatal("original numeric details lost", stored)
			}
			empty, err := repo.Facts(ctx, now.Add(-24*time.Hour), now.Add(-23*time.Hour), "qa_a")
			if err != nil || len(empty.Errors)+len(empty.Calls)+len(empty.Jobs) != 0 {
				t.Fatal("time filter")
			}
			canceled, cancel := context.WithCancel(ctx)
			cancel()
			if _, err := repo.Facts(canceled, now.Add(-time.Hour), now.Add(time.Hour), "qa_a"); err == nil {
				t.Fatal("ignored cancellation")
			}
		})
	}
}
