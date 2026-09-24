package repository

import (
	"context"
	"os"
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
			for _, user := range []string{"qa_a", "qa_b"} {
				e := model.RuntimeError{ID: "runtime_qa_" + user, UserID: user, Source: "api", Message: "api_key=SECRET", CreatedAt: now}
				if err := repo.Record(ctx, e); err != nil {
					t.Fatal(err)
				}
				if err := repo.Record(ctx, e); err != nil {
					t.Fatal(err)
				}
				if err := calls.CreateAIRequestLog(model.AIRequestLog{ID: "runtime_qa_call_" + user, UserID: user, CreatedAt: now}); err != nil {
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
