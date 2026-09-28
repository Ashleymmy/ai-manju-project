package service

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/queue"
	"github.com/ai-manju/api/internal/repository"
)

func runningRecoveryClock(svc *JobService, job model.Job) time.Time {
	now := job.UpdatedAt.Add(repository.NativeRunningRecoveryGrace + time.Second)
	svc.dispatchNow = func() time.Time { return now }
	return now
}

func TestAutomaticRecoveryStaleRunningAcceptedResultsRetainOriginalExecution(t *testing.T) {
	forDispatchRepositories(t, func(t *testing.T, repo repository.JobRepository) {
		for _, kind := range []string{model.JobTypeVideoGenerate, model.JobTypeImageGenerate, model.JobTypeImageEdit} {
			phases, recoveryPhase := []string{"accepted", "downloaded"}, "video_recovery_pending"
			if kind != model.JobTypeVideoGenerate {
				phases, recoveryPhase = []string{"received", "downloaded"}, "image_recovery_pending"
			}
			for _, phase := range phases {
				for _, queuePhase := range []string{"", recoveryPhase, "waiting_provider_slot"} {
					for _, state := range []string{model.JobDispatchObserved, model.JobDispatchPending, model.JobDispatchPublished} {
						name := "running/" + kind + "/" + phase + "/" + queuePhase + "/" + state
						t.Run(name, func(t *testing.T) {
							producer, billing := &queue.MemoryProducer{}, &jobSafetyBilling{}
							svc := dispatchService(repo, producer)
							svc.SetBillingHooks(billing)
							job := automaticRecoveryFixture(t, repo, svc, name, kind, queuePhase, state, automaticRecoveryMetadata(kind, phase), func(job *model.Job) { job.Status = model.JobStatusRunning })
							now := runningRecoveryClock(svc, job)
							ids, err := repo.ListDispatchPendingIDs(now, 0)
							if err != nil || !slices.Contains(ids, job.ID) {
								t.Fatalf("stale running job excluded from relay scan: %v", err)
							}
							if err := svc.DispatchPending(context.Background()); err != nil {
								t.Fatal(err)
							}
							if len(producer.Messages) != 1 {
								t.Fatalf("deliveries=%d want=1", len(producer.Messages))
							}
							message := producer.Messages[0]
							if message.JobID != job.ID || message.TaskName != taskNameForJobType(kind) || !reflect.DeepEqual(message.Payload, job.Payload) || message.Kwargs["_recovery_only"] != true || message.Kwargs["_recovery_automatic"] != true {
								t.Fatal("orphan recovery changed original execution or recovery-only mode")
							}
							if _, exists := message.Kwargs["_recovery_dispatch_token"]; exists {
								t.Fatal("automatic recovery could reset administrator recovery budgets")
							}
							stored, _ := repo.GetByID(job.ID)
							if stored.Status != model.JobStatusRunning || stored.Attempts != job.Attempts || stored.DispatchCiphertext != job.DispatchCiphertext || stored.QueuePhase != queuePhase || !reflect.DeepEqual(stored.BridgeMetadata, job.BridgeMetadata) || billing.released != 0 {
								t.Fatal("orphan recovery changed execution state, accepted evidence or credits")
							}
							if err := svc.DispatchPending(context.Background()); err != nil || len(producer.Messages) != 1 {
								t.Fatal("consecutive running recovery ignored publication grace")
							}
						})
					}
				}
			}
		}
	})
}

func TestAutomaticRecoveryRunningGraceAndRetryDeadlines(t *testing.T) {
	forDispatchRepositories(t, func(t *testing.T, repo repository.JobRepository) {
		for index, tc := range []struct {
			name            string
			age             time.Duration
			retry, dispatch *time.Duration
			want            bool
		}{
			{name: "fresh", age: time.Minute},
			{name: "age_boundary", age: repository.NativeRunningRecoveryGrace, want: true},
			{name: "orphan_without_retry", age: 3 * time.Minute, want: true},
			{name: "worker_future", age: 3 * time.Minute, retry: durationPointer(10 * time.Minute)},
			{name: "worker_receipt_grace", age: 3 * time.Minute, retry: durationPointer(2 * time.Minute)},
			{name: "worker_boundary", age: 3 * time.Minute, retry: durationPointer(time.Minute), want: true},
			{name: "relay_future", age: 3 * time.Minute, dispatch: durationPointer(10 * time.Minute)},
		} {
			t.Run(tc.name, func(t *testing.T) {
				producer := &queue.MemoryProducer{}
				svc := dispatchService(repo, producer)
				// Derive timers from the persisted timestamp to test exact equality
				// across PostgreSQL's microsecond precision and Memory.
				job := automaticRecoveryFixture(t, repo, svc, fmt.Sprintf("running_deadline_%d", index), model.JobTypeVideoGenerate, "", model.JobDispatchObserved, automaticRecoveryMetadata(model.JobTypeVideoGenerate, "accepted"), func(job *model.Job) { job.Status, job.WorkerRetryAt = model.JobStatusRunning, nil })
				now := job.UpdatedAt.Add(tc.age)
				svc.dispatchNow = func() time.Time { return now }
				if tc.retry != nil {
					// A test-only read adapter models a persisted Worker timer; the
					// separate repository predicate tests cover actual SQL selection.
					retry := job.UpdatedAt.Add(*tc.retry)
					wrapped := &runningRecoveryReadRepository{JobRepository: repo, NativeJobRecoveryRepository: repo.(repository.NativeJobRecoveryRepository), change: func(row *model.Job, _ int) { row.WorkerRetryAt = &retry }}
					svc.repo = wrapped
					job.WorkerRetryAt = &retry
				}
				if tc.dispatch != nil {
					dispatch := job.UpdatedAt.Add(*tc.dispatch)
					if err := repo.UpdateDispatch(job.ID, model.JobDispatchObserved, &dispatch, false); err != nil {
						t.Fatal(err)
					}
				}
				if tc.retry == nil {
					ids, err := repo.ListDispatchPendingIDs(now, 0)
					if err != nil || slices.Contains(ids, job.ID) != tc.want {
						t.Fatal("running grace scan differs from locked decision")
					}
				}
				if err := svc.dispatchJob(context.Background(), job.ID); err != nil {
					t.Fatal(err)
				}
				if (len(producer.Messages) == 1) != tc.want {
					t.Fatalf("deliveries=%d want allowed=%v", len(producer.Messages), tc.want)
				}
			})
		}
	})
}

func durationPointer(value time.Duration) *time.Duration { return &value }

type runningRecoveryReadRepository struct {
	repository.JobRepository
	repository.NativeJobRecoveryRepository
	reads  int
	change func(*model.Job, int)
}

func (r *runningRecoveryReadRepository) GetByID(id string) (model.Job, error) {
	job, err := r.JobRepository.GetByID(id)
	r.reads++
	if err == nil {
		r.change(&job, r.reads)
	}
	return job, err
}

func TestAutomaticRecoveryRunningFreshRereadWinsOverStaleScan(t *testing.T) {
	forDispatchRepositories(t, func(t *testing.T, repo repository.JobRepository) {
		for index, tc := range []string{"fresh_update", "missing_update", "renewed_retry", "attention", "uncertain", "missing_task", "manual_request", "terminal"} {
			t.Run(tc, func(t *testing.T) {
				producer := &queue.MemoryProducer{}
				svc := dispatchService(repo, producer)
				job := automaticRecoveryFixture(t, repo, svc, fmt.Sprintf("running_reread_%d", index), model.JobTypeVideoGenerate, "", model.JobDispatchObserved, automaticRecoveryMetadata(model.JobTypeVideoGenerate, "accepted"), func(job *model.Job) { job.Status = model.JobStatusRunning })
				now := runningRecoveryClock(svc, job)
				wrapped := &runningRecoveryReadRepository{JobRepository: repo, NativeJobRecoveryRepository: repo.(repository.NativeJobRecoveryRepository), change: func(row *model.Job, reads int) {
					if reads < 2 {
						return
					}
					metadata := automaticRecoveryMetadata(model.JobTypeVideoGenerate, "accepted")
					cp := metadata["_worker_video_checkpoint"].(map[string]any)
					switch tc {
					case "fresh_update":
						row.UpdatedAt = now
					case "missing_update":
						row.UpdatedAt = time.Time{}
					case "renewed_retry":
						future := now.Add(time.Hour)
						row.WorkerRetryAt = &future
					case "attention":
						cp["recovery"] = map[string]any{"requires_attention": true}
					case "uncertain":
						cp["phase"] = "submission_intent"
					case "missing_task":
						delete(cp, "provider_task_id")
					case "manual_request":
						metadata[repository.JobRecoveryControlKey] = map[string]any{"acknowledged": false}
					case "terminal":
						row.Status = model.JobStatusSucceeded
					}
					row.BridgeMetadata, _ = json.Marshal(metadata)
				}}
				svc.repo = wrapped
				if err := svc.DispatchPending(context.Background()); err != nil {
					t.Fatal(err)
				}
				stored, _ := repo.GetByID(job.ID)
				if wrapped.reads < 2 || len(producer.Messages) != 0 || stored.DispatchAttempts != job.DispatchAttempts {
					t.Fatal("stale running recovery overrode the locked reread")
				}
				// Keep this intentionally stale fixture out of subsequent table scans.
				future := now.Add(time.Hour)
				_ = repo.UpdateDispatch(job.ID, model.JobDispatchObserved, &future, false)
			})
		}
	})
}

func TestAutomaticRecoveryRunningLiveWorkerLockAndConcurrentRelays(t *testing.T) {
	forDispatchRepositories(t, func(t *testing.T, repo repository.JobRepository) {
		native := repo.(repository.NativeJobRecoveryRepository)
		var calls atomic.Int32
		producer := jobSafetyProducer(func(ctx context.Context, message queue.TaskMessage) error {
			calls.Add(1)
			// Publication must happen after the API releases the Worker lock.
			return native.WithNativeJobLock(ctx, message.JobID, func() error {
				if _, err := repo.SetResult(message.JobID, model.JSONB(`{"outputs":[]}`)); err != nil {
					return err
				}
				return repo.UpdateDispatch(message.JobID, model.JobDispatchObserved, nil, true)
			})
		})
		svc := dispatchService(repo, producer)
		job := automaticRecoveryFixture(t, repo, svc, "running_real_lock", model.JobTypeVideoGenerate, "", model.JobDispatchObserved, automaticRecoveryMetadata(model.JobTypeVideoGenerate, "accepted"), func(job *model.Job) { job.Status = model.JobStatusRunning })
		now := runningRecoveryClock(svc, job)
		acquired, release, finished := make(chan struct{}), make(chan struct{}), make(chan error, 1)
		var releaseOnce sync.Once
		releaseWorker := func() { releaseOnce.Do(func() { close(release) }) }
		t.Cleanup(releaseWorker)
		go func() {
			finished <- native.WithNativeJobLock(context.Background(), job.ID, func() error { close(acquired); <-release; return nil })
		}()
		select {
		case <-acquired:
		case err := <-finished:
			t.Fatalf("test Worker could not acquire task lock: %v", err)
		}
		if err := svc.DispatchPending(context.Background()); err != nil {
			t.Fatal(err)
		}
		stored, _ := repo.GetByID(job.ID)
		if calls.Load() != 0 || stored.Attempts != job.Attempts || stored.Status != job.Status || stored.DispatchNextAttemptAt == nil || !stored.DispatchNextAttemptAt.After(now) {
			t.Fatal("live running Worker was recovered concurrently")
		}
		releaseWorker()
		if err := <-finished; err != nil {
			t.Fatal(err)
		}
		now = now.Add(jobDispatchReceiptGrace + time.Second)
		svc.dispatchNow = func() time.Time { return now }
		var relays sync.WaitGroup
		start := make(chan struct{})
		for range 2 {
			relays.Add(1)
			go func() {
				defer relays.Done()
				<-start
				if err := svc.DispatchPending(context.Background()); err != nil {
					t.Error(err)
				}
			}()
		}
		close(start)
		relays.Wait()
		stored, _ = repo.GetByID(job.ID)
		if calls.Load() != 1 || stored.Status != model.JobStatusSucceeded || stored.DispatchCiphertext != "" || stored.DispatchNextAttemptAt != nil {
			t.Fatal("concurrent relays duplicated recovery or overwrote immediate Worker completion")
		}
	})
}

type busyRunningRecoveryRepository struct {
	repository.JobRepository
	repository.NativeJobRecoveryRepository
	busy map[string]bool
}

func (r busyRunningRecoveryRepository) DeferBusyNativeRecovery(job model.Job, next time.Time) (bool, error) {
	return r.JobRepository.(repository.NativeOrphanRepository).DeferBusyNativeRecovery(job, next)
}
func (r busyRunningRecoveryRepository) RouteNativeOrphan(job model.Job, now time.Time) (bool, error) {
	return r.JobRepository.(repository.NativeOrphanRepository).RouteNativeOrphan(job, now)
}

func (r busyRunningRecoveryRepository) WithNativeJobLock(ctx context.Context, id string, fn func() error) error {
	if r.busy[id] {
		return repository.ErrJobRecoveryBusy
	}
	return r.NativeJobRecoveryRepository.WithNativeJobLock(ctx, id, fn)
}

func TestAutomaticRecoveryLiveRunningBatchCannotStarveLostDelivery(t *testing.T) {
	forDispatchRepositories(t, func(t *testing.T, repo repository.JobRepository) {
		busy := map[string]bool{}
		wrapped := busyRunningRecoveryRepository{repo, repo.(repository.NativeJobRecoveryRepository), busy}
		producer := &queue.MemoryProducer{}
		svc := dispatchService(wrapped, producer)
		now := time.Now().UTC().Add(5 * time.Minute)
		svc.dispatchNow = func() time.Time { return now }
		for i := 0; i < jobDispatchBatchSize; i++ {
			job := automaticRecoveryFixture(t, repo, svc, fmt.Sprintf("busy_batch_%d", i), model.JobTypeVideoGenerate, "", model.JobDispatchObserved, automaticRecoveryMetadata(model.JobTypeVideoGenerate, "accepted"), func(job *model.Job) { job.Status = model.JobStatusRunning })
			busy[job.ID] = true
			due := now.Add(-time.Minute + time.Duration(i)*time.Second)
			if err := repo.UpdateDispatch(job.ID, model.JobDispatchObserved, &due, false); err != nil {
				t.Fatal(err)
			}
		}
		lost := automaticRecoveryFixture(t, repo, svc, "lost_behind_busy", model.JobTypeVideoGenerate, "video_recovery_pending", model.JobDispatchObserved, automaticRecoveryMetadata(model.JobTypeVideoGenerate, "accepted"))
		due := now.Add(-time.Second)
		if err := repo.UpdateDispatch(lost.ID, model.JobDispatchObserved, &due, false); err != nil {
			t.Fatal(err)
		}
		if err := svc.DispatchPending(context.Background()); err != nil {
			t.Fatal(err)
		}
		if len(producer.Messages) != 0 {
			t.Fatal("busy Worker must not be republished")
		}
		if err := svc.DispatchPending(context.Background()); err != nil {
			t.Fatal(err)
		}
		if len(producer.Messages) != 1 || producer.Messages[0].JobID != lost.ID {
			t.Fatal("a full batch of busy Workers starved the following lost delivery")
		}
	})
}
