package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"slices"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/queue"
	"github.com/ai-manju/api/internal/repository"
)

func automaticRecoveryMetadata(kind, phase string) map[string]any {
	cp := map[string]any{"version": 1, "revision": 4, "phase": phase, "provider_identity": "original-account", "recovery": map[string]any{"failures": 3, "first_failure_at": "2026-09-25T00:00:00Z", "requires_attention": false}}
	key := "_worker_video_checkpoint"
	if kind == model.JobTypeVideoGenerate {
		cp["provider_task_id"] = "original-paid-task"
	} else {
		key = "_worker_image_checkpoint"
		cp["receipt_id"] = "original-private-receipt"
	}
	return map[string]any{key: cp}
}

func automaticRecoveryFixture(t *testing.T, repo repository.JobRepository, svc *JobService, id, kind, phase, state string, metadata map[string]any, mutate ...func(*model.Job)) model.Job {
	t.Helper()
	raw, err := json.Marshal(metadata)
	if err != nil {
		t.Fatal(err)
	}
	started, deadline := time.Now().UTC().Add(-time.Hour), time.Now().UTC().Add(-3*time.Minute)
	job := model.Job{ID: id, IdempotencyKey: id, Type: kind, UserID: "user", Status: model.JobStatusQueued, StartedAt: &started, WorkerRetryAt: &deadline, BridgeMetadata: raw, Attempts: 2, MaxAttempts: 3, Payload: dispatchInput(id).Payload}
	kwargs := dispatchInput(id).TaskKwargs
	kwargs["_recovery_dispatch_token"] = "old-manual-token"
	if err := svc.prepareDispatch(&job, kwargs); err != nil {
		t.Fatal(err)
	}
	job.DispatchState, job.QueuePhase = state, phase
	for _, change := range mutate {
		change(&job)
	}
	created, err := repo.Create(job)
	if err != nil {
		t.Fatal(err)
	}
	// PostgreSQL canonicalizes JSONB on storage. Compare the stored snapshot,
	// not the pre-insert byte layout returned by Create.
	stored, err := repo.GetByID(created.ID)
	if err != nil {
		t.Fatal(err)
	}
	return stored
}

func TestAutomaticRecoveryRetainsOriginalExecutionAndRecoveryBudget(t *testing.T) {
	forDispatchRepositories(t, func(t *testing.T, repo repository.JobRepository) {
		for _, kind := range []string{model.JobTypeVideoGenerate, model.JobTypeImageGenerate, model.JobTypeImageEdit} {
			phases, queuePhase := []string{"accepted", "downloaded"}, "video_recovery_pending"
			if kind != model.JobTypeVideoGenerate {
				phases, queuePhase = []string{"received", "downloaded"}, "image_recovery_pending"
			}
			for _, phase := range phases {
				for _, state := range []string{model.JobDispatchPending, model.JobDispatchPublished, model.JobDispatchObserved} {
					name := kind + "/" + phase + "/" + state
					t.Run(name, func(t *testing.T) {
						producer, billing := &queue.MemoryProducer{}, &jobSafetyBilling{}
						svc := dispatchService(repo, producer)
						svc.SetBillingHooks(billing)
						job := automaticRecoveryFixture(t, repo, svc, name, kind, queuePhase, state, automaticRecoveryMetadata(kind, phase))
						if err := svc.DispatchPending(context.Background()); err != nil {
							t.Fatal(err)
						}
						if len(producer.Messages) != 1 {
							t.Fatalf("deliveries=%d", len(producer.Messages))
						}
						message := producer.Messages[0]
						if message.JobID != job.ID || !reflect.DeepEqual(message.Payload, job.Payload) || message.TaskName != taskNameForJobType(kind) || message.Queue != "celery" || message.Kwargs["_recovery_only"] != true || message.Kwargs["_recovery_automatic"] != true {
							t.Fatal("recovery did not retain original task and recovery-only mode")
						}
						if _, exists := message.Kwargs["_recovery_dispatch_token"]; exists {
							t.Fatal("automatic recovery could acknowledge manual control")
						}
						if message.Kwargs["provider"].(map[string]any)["api_key"] != "never-expose-this-key" || message.Kwargs["generation_soft_timeout_seconds"] != 900 {
							t.Fatal("original execution configuration changed")
						}
						stored, _ := repo.GetByID(job.ID)
						if !reflect.DeepEqual(stored.BridgeMetadata, job.BridgeMetadata) || stored.Attempts != job.Attempts || stored.DispatchCiphertext != job.DispatchCiphertext || stored.Status != job.Status || stored.QueuePhase != queuePhase || billing.released != 0 {
							t.Fatal("automatic dispatch reset recovery state or execution/credit reservation")
						}
						if err := svc.DispatchPending(context.Background()); err != nil {
							t.Fatal(err)
						}
						if len(producer.Messages) != 1 {
							t.Fatal("consecutive scan did not honor receipt grace")
						}
					})
				}
			}
		}
	})
}

func TestAutomaticRecoveryEligibility(t *testing.T) {
	forDispatchRepositories(t, func(t *testing.T, repo repository.JobRepository) {
		cases := []struct {
			name  string
			alter func(map[string]any, map[string]any)
			want  bool
		}{
			{"accepted", nil, true},
			{"manual_acknowledged", func(cp, m map[string]any) { m[repository.JobRecoveryControlKey] = map[string]any{"acknowledged": true} }, true},
			{"manual_unacknowledged", func(cp, m map[string]any) {
				m[repository.JobRecoveryControlKey] = map[string]any{"acknowledged": false}
			}, false},
			{"manual_null", func(cp, m map[string]any) { m[repository.JobRecoveryControlKey] = nil }, false},
			{"manual_malformed", func(cp, m map[string]any) { m[repository.JobRecoveryControlKey] = true }, false},
			{"manual_string_ack", func(cp, m map[string]any) {
				m[repository.JobRecoveryControlKey] = map[string]any{"acknowledged": "true"}
			}, false},
			{"uncertain", func(cp, m map[string]any) { cp["phase"] = "submission_intent" }, false},
			{"attention", func(cp, m map[string]any) { cp["recovery"] = map[string]any{"requires_attention": true} }, false},
			{"attention_string", func(cp, m map[string]any) { cp["recovery"] = map[string]any{"requires_attention": "false"} }, false},
			{"attention_number", func(cp, m map[string]any) { cp["recovery"] = map[string]any{"requires_attention": 0} }, false},
			{"recovery_array", func(cp, m map[string]any) { cp["recovery"] = []any{} }, false},
			{"recovery_null", func(cp, m map[string]any) { cp["recovery"] = nil }, true},
			{"recovery_absent", func(cp, m map[string]any) { delete(cp, "recovery") }, true},
			{"attention_null", func(cp, m map[string]any) { cp["recovery"] = map[string]any{"requires_attention": nil} }, true},
			{"missing_version", func(cp, m map[string]any) { delete(cp, "version") }, false},
			{"wrong_version", func(cp, m map[string]any) { cp["version"] = 2 }, false},
			{"string_version", func(cp, m map[string]any) { cp["version"] = "1" }, false},
			{"fraction_version", func(cp, m map[string]any) { cp["version"] = 1.1 }, false},
			{"missing_revision", func(cp, m map[string]any) { delete(cp, "revision") }, false},
			{"zero_revision", func(cp, m map[string]any) { cp["revision"] = 0 }, false},
			{"negative_revision", func(cp, m map[string]any) { cp["revision"] = -1 }, false},
			{"string_revision", func(cp, m map[string]any) { cp["revision"] = "4" }, false},
			{"fraction_revision", func(cp, m map[string]any) { cp["revision"] = 4.5 }, false},
			{"overflow_revision", func(cp, m map[string]any) { cp["revision"] = json.Number("9223372036854775808") }, false},
			{"max_revision", func(cp, m map[string]any) { cp["revision"] = json.Number("9223372036854775807") }, true},
			{"missing_identity", func(cp, m map[string]any) { delete(cp, "provider_identity") }, false},
			{"empty_identity", func(cp, m map[string]any) { cp["provider_identity"] = "" }, false},
			{"null_identity", func(cp, m map[string]any) { cp["provider_identity"] = nil }, false},
			{"missing_task", func(cp, m map[string]any) { delete(cp, "provider_task_id") }, false},
			{"empty_task", func(cp, m map[string]any) { cp["provider_task_id"] = "" }, false},
			{"numeric_task", func(cp, m map[string]any) { cp["provider_task_id"] = 123 }, false},
			{"null_task", func(cp, m map[string]any) { cp["provider_task_id"] = nil }, false},
			{"irrelevant_receipt_type", func(cp, m map[string]any) { cp["receipt_id"] = 123 }, true},
			{"dual_checkpoint", func(cp, m map[string]any) { m["_worker_image_checkpoint"] = map[string]any{} }, false},
			{"dual_checkpoint_null", func(cp, m map[string]any) { m["_worker_image_checkpoint"] = nil }, false},
			{"checkpoint_array", func(cp, m map[string]any) { m["_worker_video_checkpoint"] = []any{} }, false},
			{"checkpoint_missing", func(cp, m map[string]any) { delete(m, "_worker_video_checkpoint") }, false},
		}
		for i, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				producer := &queue.MemoryProducer{}
				svc := dispatchService(repo, producer)
				metadata := automaticRecoveryMetadata(model.JobTypeVideoGenerate, "accepted")
				if tc.alter != nil {
					tc.alter(metadata["_worker_video_checkpoint"].(map[string]any), metadata)
				}
				job := automaticRecoveryFixture(t, repo, svc, fmt.Sprintf("automatic_eligibility_%d", i), model.JobTypeVideoGenerate, "video_recovery_pending", model.JobDispatchObserved, metadata)
				if repository.CanAutomaticallyRecoverNative(job) != tc.want {
					t.Fatalf("memory eligibility did not match expected %v", tc.want)
				}
				ids, err := repo.ListDispatchPendingIDs(time.Now().UTC(), 0)
				if err != nil || slices.Contains(ids, job.ID) != tc.want {
					t.Fatalf("repository scan did not match expected %v: %v", tc.want, err)
				}
				if err := svc.DispatchPending(context.Background()); err != nil {
					t.Fatal(err)
				}
				if (len(producer.Messages) == 1) != tc.want {
					t.Fatalf("deliveries=%d expected eligibility=%v", len(producer.Messages), tc.want)
				}
			})
		}
	})
}

func TestAutomaticRecoveryQueuePhasesAndDeadlines(t *testing.T) {
	forDispatchRepositories(t, func(t *testing.T, repo repository.JobRepository) {
		for i, tc := range []struct {
			name, phase, kind, status, external string
			delay                               time.Duration
			legacy, want                        bool
		}{
			{name: "video_recovery", phase: "video_recovery_pending", want: true},
			{name: "image_recovery", kind: model.JobTypeImageGenerate, phase: "image_recovery_pending", want: true},
			{name: "accepted_gate_wait", phase: "waiting_provider_slot", want: true},
			{name: "image_gate_wait", kind: model.JobTypeImageGenerate, phase: "waiting_provider_slot", want: true},
			{name: "attention", phase: "video_recovery_attention"},
			{name: "wrong_recovery_kind", phase: "image_recovery_pending"},
			{name: "ordinary", phase: ""},
			{name: "external", phase: "video_recovery_pending", external: "sd-video"},
			{name: "running", phase: "video_recovery_pending", status: model.JobStatusRunning},
			{name: "terminal", phase: "video_recovery_pending", status: model.JobStatusFailed},
			{name: "future_timer", phase: "video_recovery_pending", delay: 10 * time.Minute},
			{name: "timer_grace", phase: "video_recovery_pending", delay: -time.Minute},
			{name: "legacy_grace", phase: "video_recovery_pending", legacy: true},
			{name: "legacy_gate_grace", phase: "waiting_provider_slot", legacy: true},
		} {
			t.Run(tc.name, func(t *testing.T) {
				producer := &queue.MemoryProducer{}
				svc := dispatchService(repo, producer)
				kind, checkpointPhase := tc.kind, "accepted"
				if kind == "" {
					kind = model.JobTypeVideoGenerate
				} else {
					checkpointPhase = "received"
				}
				job := automaticRecoveryFixture(t, repo, svc, fmt.Sprintf("automatic_deadlines_%d", i), kind, tc.phase, model.JobDispatchObserved, automaticRecoveryMetadata(kind, checkpointPhase), func(job *model.Job) {
					job.ExternalProvider = tc.external
					if tc.status != "" {
						job.Status = tc.status
					}
					if tc.delay != 0 {
						deadline := time.Now().UTC().Add(tc.delay)
						job.WorkerRetryAt = &deadline
					}
					if tc.legacy {
						job.WorkerRetryAt = nil
					}
				})
				if err := svc.DispatchPending(context.Background()); err != nil {
					t.Fatal(err)
				}
				if (len(producer.Messages) == 1) != tc.want {
					t.Fatalf("deliveries=%d want recovery=%v", len(producer.Messages), tc.want)
				}
				if tc.legacy {
					future := time.Now().UTC().Add(3 * time.Minute)
					ids, err := repo.ListDispatchPendingIDs(future, 0)
					if err != nil || !slices.Contains(ids, job.ID) || repository.ProviderRetryScheduled(job, future) {
						t.Fatal("lost legacy retry did not become eligible after grace")
					}
				}
			})
		}
	})
}

func TestAutomaticRecoveryReleasesNativeLockBeforePublishAndPreservesWorkerUpdate(t *testing.T) {
	forDispatchRepositories(t, func(t *testing.T, repo repository.JobRepository) {
		native := repo.(repository.NativeJobRecoveryRepository)
		calls := 0
		producer := jobSafetyProducer(func(ctx context.Context, message queue.TaskMessage) error {
			calls++
			return native.WithNativeJobLock(ctx, message.JobID, func() error {
				if _, err := repo.SetResult(message.JobID, model.JSONB(`{"outputs":[]}`)); err != nil {
					return err
				}
				return repo.UpdateDispatch(message.JobID, model.JobDispatchObserved, nil, true)
			})
		})
		svc := dispatchService(repo, producer)
		job := automaticRecoveryFixture(t, repo, svc, "automatic_immediate_worker", model.JobTypeVideoGenerate, "video_recovery_pending", model.JobDispatchObserved, automaticRecoveryMetadata(model.JobTypeVideoGenerate, "accepted"))
		if err := svc.dispatchJob(context.Background(), job.ID); err != nil {
			t.Fatal(err)
		}
		stored, _ := repo.GetByID(job.ID)
		if calls != 1 || stored.Status != model.JobStatusSucceeded || stored.DispatchCiphertext != "" || stored.DispatchNextAttemptAt != nil {
			t.Fatal("worker could not consume immediately or relay overwrote its state")
		}
	})
}

type automaticRecoveryRaceRepository struct {
	repository.JobRepository
	repository.NativeJobRecoveryRepository
	beforeNativeRead func() error
}

func (r automaticRecoveryRaceRepository) WithNativeJobLock(ctx context.Context, id string, fn func() error) error {
	return r.NativeJobRecoveryRepository.WithNativeJobLock(ctx, id, func() error {
		if err := r.beforeNativeRead(); err != nil {
			return err
		}
		return fn()
	})
}

func TestAutomaticRecoveryRechecksUnderNativeLockAndSkipsBusyWorker(t *testing.T) {
	forDispatchRepositories(t, func(t *testing.T, repo repository.JobRepository) {
		producer := &queue.MemoryProducer{}
		svc := dispatchService(repo, producer)
		job := automaticRecoveryFixture(t, repo, svc, "automatic_reread", model.JobTypeVideoGenerate, "video_recovery_pending", model.JobDispatchObserved, automaticRecoveryMetadata(model.JobTypeVideoGenerate, "accepted"))
		native := repo.(repository.NativeJobRecoveryRepository)
		if err := native.WithNativeJobLock(context.Background(), job.ID, func() error { return svc.dispatchJob(context.Background(), job.ID) }); err != nil {
			t.Fatal(err)
		}
		stored, _ := repo.GetByID(job.ID)
		if len(producer.Messages) != 0 || stored.DispatchAttempts != job.DispatchAttempts {
			t.Fatal("busy worker was redispatched or its deadline changed")
		}
		traced := automaticRecoveryRaceRepository{repo, native, func() error {
			_, err := repo.UpdateQueuePhase(job.ID, "video_recovery_attention")
			return err
		}}
		if err := dispatchService(traced, producer).dispatchJob(context.Background(), job.ID); err != nil {
			t.Fatal(err)
		}
		stored, _ = repo.GetByID(job.ID)
		if len(producer.Messages) != 0 || stored.QueuePhase != "video_recovery_attention" || stored.DispatchAttempts != job.DispatchAttempts {
			t.Fatal("stale scan overrode new attention state")
		}
	})
}

func TestAutomaticRecoveryRejectsNewManualControlUnderNativeLock(t *testing.T) {
	forDispatchRepositories(t, func(t *testing.T, repo repository.JobRepository) {
		producer := &queue.MemoryProducer{}
		svc := dispatchService(repo, producer)
		metadata := automaticRecoveryMetadata(model.JobTypeVideoGenerate, "accepted")
		job := automaticRecoveryFixture(t, repo, svc, "automatic_manual_race", model.JobTypeVideoGenerate, "video_recovery_pending", model.JobDispatchObserved, metadata)
		traced := automaticRecoveryRaceRepository{repo, repo.(repository.NativeJobRecoveryRepository), func() error {
			metadata[repository.JobRecoveryControlKey] = map[string]any{"acknowledged": false, "token": "new-manual-token"}
			raw, _ := json.Marshal(metadata)
			_, err := repo.SetExternalState(job.ID, "", "", "", raw)
			return err
		}}
		if err := dispatchService(traced, producer).dispatchJob(context.Background(), job.ID); err != nil {
			t.Fatal(err)
		}
		stored, _ := repo.GetByID(job.ID)
		if len(producer.Messages) != 0 || stored.DispatchAttempts != job.DispatchAttempts {
			t.Fatal("automatic recovery raced unacknowledged manual control")
		}
	})
}

type automaticRecoveryRenewedDeadlineRepository struct {
	repository.JobRepository
	repository.NativeJobRecoveryRepository
	reads int
}

func (r *automaticRecoveryRenewedDeadlineRepository) GetByID(id string) (model.Job, error) {
	job, err := r.JobRepository.GetByID(id)
	r.reads++
	if r.reads > 1 {
		// Simulate the Worker persisting a new timer between relay selection and
		// acquiring the native lock, without exposing a test-only mutation API.
		future := time.Now().UTC().Add(time.Hour)
		job.WorkerRetryAt = &future
	}
	return job, err
}

func TestAutomaticRecoveryHonorsRenewedDeadlineUnderNativeLock(t *testing.T) {
	forDispatchRepositories(t, func(t *testing.T, repo repository.JobRepository) {
		producer := &queue.MemoryProducer{}
		job := automaticRecoveryFixture(t, repo, dispatchService(repo, producer), "automatic_renewed_deadline", model.JobTypeVideoGenerate, "video_recovery_pending", model.JobDispatchObserved, automaticRecoveryMetadata(model.JobTypeVideoGenerate, "accepted"))
		traced := &automaticRecoveryRenewedDeadlineRepository{JobRepository: repo, NativeJobRecoveryRepository: repo.(repository.NativeJobRecoveryRepository)}
		if err := dispatchService(traced, producer).dispatchJob(context.Background(), job.ID); err != nil {
			t.Fatal(err)
		}
		stored, _ := repo.GetByID(job.ID)
		if traced.reads < 2 || len(producer.Messages) != 0 || stored.DispatchAttempts != job.DispatchAttempts {
			t.Fatal("automatic recovery ignored renewed Worker retry deadline")
		}
	})
}

func TestAutomaticRecoveryFailuresRetainSnapshotAndThrottle(t *testing.T) {
	for _, failure := range []string{"broker", "decode", "missing_broker"} {
		t.Run(failure, func(t *testing.T) {
			repo, calls := repository.NewMemoryJobRepository(), 0
			svc := dispatchService(repo, jobSafetyProducer(func(context.Context, queue.TaskMessage) error {
				calls++
				return errors.New("lost broker response")
			}))
			job := automaticRecoveryFixture(t, repo, svc, failure, model.JobTypeVideoGenerate, "video_recovery_pending", model.JobDispatchObserved, automaticRecoveryMetadata(model.JobTypeVideoGenerate, "accepted"))
			if failure == "decode" {
				svc.EnableDurableDispatch(provider.NewSecretBox("different-key"))
			} else if failure == "missing_broker" {
				svc.producer = nil
			}
			if err := svc.dispatchJob(context.Background(), job.ID); err == nil {
				t.Fatal("failure not reported")
			}
			stored, _ := repo.GetByID(job.ID)
			if stored.DispatchNextAttemptAt == nil || !stored.DispatchNextAttemptAt.After(time.Now().UTC()) || stored.DispatchCiphertext != job.DispatchCiphertext || !reflect.DeepEqual(stored.BridgeMetadata, job.BridgeMetadata) || stored.Status != model.JobStatusQueued {
				t.Fatal("failed automatic publication reset state or became a hot loop")
			}
			if err := svc.dispatchJob(context.Background(), job.ID); err != nil {
				t.Fatal(err)
			}
			if calls > 1 {
				t.Fatal("failed publish repeated before grace")
			}
		})
	}
}
