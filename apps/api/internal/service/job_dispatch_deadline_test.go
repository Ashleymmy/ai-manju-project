package service

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/queue"
	"github.com/ai-manju/api/internal/repository"
)

func createRetryFixture(t *testing.T, repo repository.JobRepository, service *JobService, job model.Job) model.Job {
	t.Helper()
	if err := service.prepareDispatch(&job, dispatchInput("fixture").TaskKwargs); err != nil {
		t.Fatal(err)
	}
	job.Status, job.QueuePhase, job.DispatchState = model.JobStatusQueued, "waiting_provider_slot", model.JobDispatchObserved
	job.IdempotencyKey = job.ID
	created, err := repo.Create(job)
	if err != nil {
		t.Fatal(err)
	}
	return created
}

func TestJobDispatchHonorsWorkerRetryDeadlineAfterLatePublishAcknowledgement(t *testing.T) {
	forDispatchRepositories(t, func(t *testing.T, repo repository.JobRepository) {
		for _, tc := range []struct {
			name  string
			delay time.Duration
			want  int
		}{
			{"long_retry_after", 15 * time.Minute, 0},
			{"receipt_grace", -time.Minute, 0},
			{"retry_message_lost", -3 * time.Minute, 1},
		} {
			t.Run(tc.name, func(t *testing.T) {
				producer := &queue.MemoryProducer{}
				svc := dispatchService(repo, producer)
				deadline := time.Now().UTC().Add(tc.delay)
				job := createRetryFixture(t, repo, svc, model.Job{ID: "deadline_" + tc.name, Type: model.JobTypeVideoGenerate, UserID: "u", Payload: model.JSONB(`{}`), WorkerRetryAt: &deadline})
				// An API acknowledgement can arrive after Worker writes its timer.
				// Even an expired relay deadline must not override the Worker timer.
				past := time.Now().UTC().Add(-time.Minute)
				if err := repo.UpdateDispatch(job.ID, model.JobDispatchPublished, &past, false); err != nil {
					t.Fatal(err)
				}
				if err := svc.DispatchPending(context.Background()); err != nil {
					t.Fatal(err)
				}
				if err := svc.dispatchJob(context.Background(), job.ID); err != nil {
					t.Fatal(err)
				}
				if len(producer.Messages) != tc.want {
					t.Fatalf("deliveries=%d want=%d", len(producer.Messages), tc.want)
				}
				stored, _ := repo.GetByID(job.ID)
				if stored.WorkerRetryAt == nil || stored.WorkerRetryAt.Sub(deadline).Abs() > time.Microsecond {
					t.Fatal("relay changed worker retry deadline")
				}
				if tc.want == 1 && producer.Messages[0].JobID != job.ID {
					t.Fatal("recovery created a different job")
				}
			})
		}
	})
}

func TestJobDispatchRecoversOnlyProvenRejectedNativeRetries(t *testing.T) {
	forDispatchRepositories(t, func(t *testing.T, repo repository.JobRepository) {
		for i, tc := range []struct {
			name, kind, phase string
			alter             func(map[string]any, map[string]any)
			want              bool
		}{
			{"video_429", model.JobTypeVideoGenerate, "waiting_provider_slot", nil, true},
			{"image_rejection", model.JobTypeImageGenerate, "provider_retry_backoff", nil, true},
			{"edit_rejection", model.JobTypeImageEdit, "provider_retry_backoff", nil, true},
			{"accepted", model.JobTypeVideoGenerate, "waiting_provider_slot", func(cp, m map[string]any) { cp["phase"] = "accepted" }, false},
			{"uncertain", model.JobTypeVideoGenerate, "waiting_provider_slot", func(cp, m map[string]any) { cp["phase"] = "submission_intent" }, false},
			{"task_id_exists", model.JobTypeVideoGenerate, "waiting_provider_slot", func(cp, m map[string]any) { cp["provider_task_id"] = "paid-task" }, false},
			{"task_id_null", model.JobTypeVideoGenerate, "waiting_provider_slot", func(cp, m map[string]any) { cp["provider_task_id"] = nil }, false},
			{"result_exists", model.JobTypeImageGenerate, "provider_retry_backoff", func(cp, m map[string]any) { cp["result"] = map[string]any{"outputs": []any{}} }, false},
			{"attention", model.JobTypeVideoGenerate, "waiting_provider_slot", func(cp, m map[string]any) { cp["recovery"] = map[string]any{"requires_attention": true} }, false},
			{"recovery_control", model.JobTypeVideoGenerate, "waiting_provider_slot", func(cp, m map[string]any) { m[repository.JobRecoveryControlKey] = map[string]any{} }, false},
			{"wrong_version", model.JobTypeVideoGenerate, "waiting_provider_slot", func(cp, m map[string]any) { cp["version"] = 2 }, false},
			{"missing_revision", model.JobTypeVideoGenerate, "waiting_provider_slot", func(cp, m map[string]any) { delete(cp, "revision") }, false},
			{"string_revision", model.JobTypeVideoGenerate, "waiting_provider_slot", func(cp, m map[string]any) { cp["revision"] = "2" }, false},
			{"missing_identity", model.JobTypeVideoGenerate, "waiting_provider_slot", func(cp, m map[string]any) { delete(cp, "provider_identity") }, false},
			{"other_checkpoint", model.JobTypeVideoGenerate, "waiting_provider_slot", func(cp, m map[string]any) { m["_worker_image_checkpoint"] = map[string]any{"phase": "received"} }, false},
			{"terminal_failure", model.JobTypeVideoGenerate, "waiting_provider_slot", func(cp, m map[string]any) { cp["phase"] = "terminal_failure" }, false},
		} {
			t.Run(tc.name, func(t *testing.T) {
				producer := &queue.MemoryProducer{}
				svc := dispatchService(repo, producer)
				cp := map[string]any{"version": 1, "revision": 2, "phase": "rejected", "provider_identity": "original-account", "provider_task_id": "", "result": nil, "recovery": nil}
				key := "_worker_video_checkpoint"
				if tc.kind != model.JobTypeVideoGenerate {
					key = "_worker_image_checkpoint"
					cp["receipt_id"] = "original-private-receipt"
				}
				metadata := map[string]any{key: cp}
				if tc.alter != nil {
					tc.alter(cp, metadata)
				}
				raw, _ := json.Marshal(metadata)
				started := time.Now().UTC().Add(-time.Hour)
				due := time.Now().UTC().Add(-3 * time.Minute)
				job := createRetryFixture(t, repo, svc, model.Job{ID: fmt.Sprintf("rejected_%d", i), Type: tc.kind, UserID: "u", Payload: model.JSONB(`{}`), StartedAt: &started, WorkerRetryAt: &due, BridgeMetadata: model.JSONB(raw), Attempts: 2, MaxAttempts: 3})
				if _, err := repo.UpdateQueuePhase(job.ID, tc.phase); err != nil {
					t.Fatal(err)
				}
				if err := svc.DispatchPending(context.Background()); err != nil {
					t.Fatal(err)
				}
				if (len(producer.Messages) == 1) != tc.want {
					t.Fatalf("deliveries=%d want eligible=%v", len(producer.Messages), tc.want)
				}
				stored, _ := repo.GetByID(job.ID)
				if stored.Attempts != 2 || stored.DispatchCiphertext == "" || stored.Status != model.JobStatusQueued {
					t.Fatal("retry changed execution count or durable state")
				}
			})
		}
	})
}
