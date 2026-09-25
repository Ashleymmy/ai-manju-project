package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/queue"
	"github.com/ai-manju/api/internal/repository"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func dispatchService(repo repository.JobRepository, producer queue.Producer) *JobService {
	svc := NewJobService(repo, producer, "celery", 3)
	svc.EnableDurableDispatch(provider.NewSecretBox("outbox-test-secret"))
	return svc
}

func dispatchInput(key string) EnqueueJobInput {
	return EnqueueJobInput{UserID: "user", Scope: "personal", Type: model.JobTypeVideoGenerate,
		Payload: model.JSONB(`{"model":"video","prompt":"sample","duration":5}`), IdempotencyKey: key,
		TaskKwargs: map[string]any{"generation_soft_timeout_seconds": 900, "provider": map[string]any{"model": "video", "api_key": "never-expose-this-key"}}}
}

func makeDispatchDue(t *testing.T, repo repository.JobRepository, id string) {
	t.Helper()
	past := time.Now().UTC().Add(-time.Minute)
	if err := repo.UpdateDispatch(id, model.JobDispatchPending, &past, false); err != nil {
		t.Fatal(err)
	}
}

func TestJobDispatchRecoversAfterAPIProcessRestartWithoutReleasingCredits(t *testing.T) {
	forDispatchRepositories(t, func(t *testing.T, repo repository.JobRepository) {
		billing := &jobSafetyBilling{}
		firstService := dispatchService(repo, failingJobProducer{})
		firstService.SetBillingHooks(billing)
		input := dispatchInput("restart")
		first, err := firstService.Enqueue(context.Background(), input)
		if err != nil {
			t.Fatal(err)
		}
		stored, err := repo.GetByID(first.Job.ID)
		if err != nil {
			t.Fatal(err)
		}
		if stored.Status != model.JobStatusQueued || stored.QueuePhase != model.JobQueueWaitingDispatch || billing.released != 0 || stored.DispatchCiphertext == "" || strings.Contains(stored.DispatchCiphertext, "never-expose") {
			t.Fatal("ambiguous publication failed/refunded/exposed task")
		}
		public, _ := json.Marshal(stored)
		if strings.Contains(string(public), stored.DispatchCiphertext) || strings.Contains(string(public), "never-expose") || strings.Contains(string(public), "dispatch_ciphertext") {
			t.Fatal("private dispatch escaped Job serialization")
		}
		makeDispatchDue(t, repo, first.Job.ID)
		producer := &queue.MemoryProducer{}
		restarted := dispatchService(repo, producer)
		if err := restarted.DispatchPending(context.Background()); err != nil {
			t.Fatal(err)
		}
		if len(producer.Messages) != 1 || producer.Messages[0].JobID != first.Job.ID {
			t.Fatal("restart did not dispatch original durable job")
		}
		message := producer.Messages[0]
		if message.Kwargs["provider"].(map[string]any)["api_key"] != "never-expose-this-key" || message.Kwargs["generation_soft_timeout_seconds"] != 900 {
			t.Fatal("execution configuration changed during restoration")
		}
		if _, err := repo.UpdateStatus(first.Job.ID, model.JobStatusRunning); err != nil {
			t.Fatal(err)
		}
		makeDispatchDue(t, repo, first.Job.ID)
		if err := restarted.DispatchPending(context.Background()); err != nil {
			t.Fatal(err)
		}
		stored, _ = repo.GetByID(first.Job.ID)
		if stored.DispatchCiphertext == "" || len(producer.Messages) != 1 || stored.Status != model.JobStatusRunning || stored.DispatchState != model.JobDispatchObserved {
			t.Fatal("observed work was resent or recoverable execution snapshot was lost")
		}
	})
}

func TestJobDispatchLostReplyCannotOverwriteCompletedWork(t *testing.T) {
	forDispatchRepositories(t, func(t *testing.T, repo repository.JobRepository) {
		producer := jobSafetyProducer(func(_ context.Context, message queue.TaskMessage) error {
			_, err := repo.SetResult(message.JobID, model.JSONB(`{"outputs":[]}`))
			if err != nil {
				t.Fatal(err)
			}
			return errors.New("network reply lost after worker acceptance")
		})
		billing := &jobSafetyBilling{}
		svc := dispatchService(repo, producer)
		svc.SetBillingHooks(billing)
		result, err := svc.Enqueue(context.Background(), dispatchInput("lost-reply"))
		if err != nil || result.Job.Status != model.JobStatusSucceeded || billing.released != 0 {
			t.Fatal("completed task was failed or refunded after lost reply")
		}
		makeDispatchDue(t, repo, result.Job.ID)
		if err := svc.DispatchPending(context.Background()); err != nil {
			t.Fatal(err)
		}
		stored, _ := repo.GetByID(result.Job.ID)
		if stored.DispatchCiphertext != "" || stored.Status != model.JobStatusSucceeded {
			t.Fatal("terminal task was modified during outbox cleanup")
		}
	})
}

func TestJobDispatchAcknowledgedButUnobservedDeliveryCanRecover(t *testing.T) {
	repo := repository.NewMemoryJobRepository()
	producer := &queue.MemoryProducer{}
	svc := dispatchService(repo, producer)
	result, err := svc.Enqueue(context.Background(), dispatchInput("redis-loss"))
	if err != nil {
		t.Fatal(err)
	}
	makeDispatchDue(t, repo, result.Job.ID)
	if err := svc.DispatchPending(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(producer.Messages) != 2 || producer.Messages[0].JobID != producer.Messages[1].JobID {
		t.Fatal("broker restart could lose an acknowledged job")
	}
	if _, err := repo.UpdateStatus(result.Job.ID, model.JobStatusCanceled); err != nil {
		t.Fatal(err)
	}
	makeDispatchDue(t, repo, result.Job.ID)
	if err := svc.DispatchPending(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(producer.Messages) != 2 {
		t.Fatal("canceled job was dispatched")
	}
}

func TestJobDispatchConcurrentRelaysPublishOnce(t *testing.T) {
	forDispatchRepositories(t, func(t *testing.T, repo repository.JobRepository) {
		result, err := dispatchService(repo, failingJobProducer{}).Enqueue(context.Background(), dispatchInput("concurrent"))
		if err != nil {
			t.Fatal(err)
		}
		makeDispatchDue(t, repo, result.Job.ID)
		var mu sync.Mutex
		calls := 0
		producer := jobSafetyProducer(func(context.Context, queue.TaskMessage) error {
			mu.Lock()
			defer mu.Unlock()
			calls++
			time.Sleep(10 * time.Millisecond)
			return nil
		})
		var wait sync.WaitGroup
		for range 2 {
			wait.Add(1)
			go func() {
				defer wait.Done()
				if err := dispatchService(repo, producer).DispatchPending(context.Background()); err != nil {
					t.Error(err)
				}
			}()
		}
		wait.Wait()
		if calls != 1 {
			t.Fatalf("concurrent relay calls=%d", calls)
		}
	})
}

func TestJobDispatchRequiresOriginalEncryptionIdentity(t *testing.T) {
	repo := repository.NewMemoryJobRepository()
	result, err := dispatchService(repo, failingJobProducer{}).Enqueue(context.Background(), dispatchInput("identity"))
	if err != nil {
		t.Fatal(err)
	}
	makeDispatchDue(t, repo, result.Job.ID)
	producer := &queue.MemoryProducer{}
	svc := NewJobService(repo, producer, "celery", 3)
	svc.EnableDurableDispatch(provider.NewSecretBox("different-identity"))
	if err := svc.DispatchPending(context.Background()); err != nil {
		t.Fatal(err)
	}
	stored, _ := repo.GetByID(result.Job.ID)
	if len(producer.Messages) != 0 || stored.Status != model.JobStatusQueued || stored.DispatchCiphertext == "" {
		t.Fatal("unreadable dispatch must remain pending without a provider call")
	}
}

type completedDuringCancelRepository struct{ repository.JobRepository }

func (r completedDuringCancelRepository) UpdateStatus(id, status string) (model.Job, error) {
	if _, err := r.JobRepository.SetResult(id, model.JSONB(`{"outputs":[]}`)); err != nil {
		return model.Job{}, err
	}
	return r.JobRepository.UpdateStatus(id, status)
}

func TestJobDispatchCompletionWinsLateCancellationWithoutRefund(t *testing.T) {
	forDispatchRepositories(t, func(t *testing.T, repo repository.JobRepository) {
		created, err := dispatchService(repo, &queue.MemoryProducer{}).Enqueue(context.Background(), dispatchInput("cancel-race"))
		if err != nil {
			t.Fatal(err)
		}
		billing := &jobSafetyBilling{}
		svc := dispatchService(completedDuringCancelRepository{repo}, &queue.MemoryProducer{})
		svc.SetBillingHooks(billing)
		got, err := svc.CancelForUser(created.Job.ID, created.Job.UserID)
		if err != nil || got.Status != model.JobStatusSucceeded || billing.released != 0 {
			t.Fatal("late cancellation overwrote completion or refunded a completed generation")
		}
	})
}

// PostgreSQL uses a random isolated schema. It never reads/modifies business rows.
func forDispatchRepositories(t *testing.T, check func(*testing.T, repository.JobRepository)) {
	t.Helper()
	t.Run("Memory", func(t *testing.T) { check(t, repository.NewMemoryJobRepository()) })
	dsn := os.Getenv("JOB_DISPATCH_TEST_DATABASE_URL")
	if dsn == "" {
		return
	}
	t.Run("Postgres", func(t *testing.T) {
		root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
		if err != nil {
			t.Fatal("test database unavailable")
		}
		schema := fmt.Sprintf("dispatch_test_%d", time.Now().UnixNano())
		if err := root.Exec("CREATE SCHEMA " + schema).Error; err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { root.Exec("DROP SCHEMA " + schema + " CASCADE"); db, _ := root.DB(); _ = db.Close() })
		parsed, err := url.Parse(dsn)
		if err != nil {
			t.Fatal("test URL invalid")
		}
		q := parsed.Query()
		q.Set("search_path", schema)
		parsed.RawQuery = q.Encode()
		db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
		if err != nil {
			t.Fatal("schema database unavailable")
		}
		t.Cleanup(func() { sqlDB, _ := db.DB(); _ = sqlDB.Close() })
		if err := db.AutoMigrate(&model.Job{}); err != nil {
			t.Fatal(err)
		}
		check(t, repository.NewGormJobRepository(db))
	})
}
