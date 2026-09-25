package service

import (
	"context"
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/queue"
	"github.com/ai-manju/api/internal/repository"
)

func TestNativeOrphanMissingEvidenceVisibleWithoutGenerationOrResume(t *testing.T) {
	forDispatchRepositories(t, func(t *testing.T, repo repository.JobRepository) {
		for index, kind := range []string{model.JobTypeVideoGenerate, model.JobTypeImageGenerate, model.JobTypeImageEdit} {
			producer, billing := &queue.MemoryProducer{}, &jobSafetyBilling{}
			svc := dispatchService(repo, producer)
			svc.SetBillingHooks(billing)
			job := automaticRecoveryFixture(t, repo, svc, fmt.Sprintf("missing_evidence_%d", index), kind, "", model.JobDispatchObserved, map[string]any{}, func(job *model.Job) {
				job.Status = model.JobStatusRunning
				if index == 2 {
					job.DispatchCiphertext = ""
				}
			})
			runningRecoveryClock(svc, job)
			if err := svc.DispatchPending(context.Background()); err != nil {
				t.Fatal(err)
			}
			stored, _ := repo.GetByID(job.ID)
			if stored.Status != model.JobStatusQueued || len(producer.Messages) != 0 || stored.Attempts != job.Attempts || stored.DispatchAttempts != job.DispatchAttempts || stored.DispatchCiphertext != job.DispatchCiphertext || !reflect.DeepEqual(stored.BridgeMetadata, job.BridgeMetadata) || billing.released != 0 {
				t.Fatal("orphan visibility changed execution/credits or sent a generation")
			}
			page, err := svc.ListNativeRecovery(100, 0)
			found := false
			for _, row := range page.Items {
				if row.ID == job.ID {
					found = true
					if row.CanResume {
						t.Fatal("missing evidence enabled administrator Resume")
					}
				}
			}
			if err != nil || !found {
				t.Fatal("missing evidence not listed for administrator reconciliation")
			}
			if _, err := svc.ResumeNativeRecovery(context.Background(), model.User{Role: model.UserRoleSuperAdmin}, job.ID, 1); err == nil || len(producer.Messages) != 0 {
				t.Fatal("administrator action could generate without original evidence")
			}
		}
	})
}

func TestNativeOrphanProvenRejectedTaskReturnsToExistingRetryOnly(t *testing.T) {
	forDispatchRepositories(t, func(t *testing.T, repo repository.JobRepository) {
		producer := &queue.MemoryProducer{}
		svc := dispatchService(repo, producer)
		metadata := map[string]any{"_worker_video_checkpoint": map[string]any{"version": 1, "revision": 2, "phase": "rejected", "provider_identity": "original-provider"}}
		job := automaticRecoveryFixture(t, repo, svc, "orphan_rejected", model.JobTypeVideoGenerate, "", model.JobDispatchObserved, metadata, func(job *model.Job) { job.Status = model.JobStatusRunning })
		runningRecoveryClock(svc, job)
		if err := svc.DispatchPending(context.Background()); err != nil {
			t.Fatal(err)
		}
		stored, _ := repo.GetByID(job.ID)
		if stored.QueuePhase != "provider_retry_backoff" || stored.Status != model.JobStatusQueued || stored.Attempts != job.Attempts || len(producer.Messages) != 0 {
			t.Fatal("orphan routing did not preserve safe rejected retry")
		}
		if err := svc.DispatchPending(context.Background()); err != nil {
			t.Fatal(err)
		}
		if len(producer.Messages) != 1 || producer.Messages[0].JobID != job.ID || producer.Messages[0].Kwargs["_recovery_only"] == true {
			t.Fatal("existing proven rejection dispatch path changed")
		}
	})
}

func TestNativeOrphanMalformedOrIncompleteEvidenceNeverEnablesResume(t *testing.T) {
	for _, job := range []model.Job{
		{Type: model.JobTypeVideoGenerate, BridgeMetadata: model.JSONB(`{"_worker_video_checkpoint":{"version":1,"revision":2,"phase":"accepted","provider_identity":"original","provider_task_id":"task"},"_worker_image_checkpoint":null}`)},
		{Type: model.JobTypeImageGenerate, BridgeMetadata: model.JSONB(`{"_worker_image_checkpoint":{"version":1,"revision":2,"phase":"received","provider_identity":"original"}}`)},
		{Type: model.JobTypeImageEdit, BridgeMetadata: model.JSONB(`{"_worker_image_checkpoint":{"version":1,"revision":2,"phase":"downloaded","provider_identity":"original","receipt_id":123}}`)},
	} {
		job.Status, job.QueuePhase, job.DispatchCiphertext = model.JobStatusQueued, "image_recovery_attention", "retained"
		if nativeRecoveryRow(job).CanResume {
			t.Fatal("ambiguous or incomplete checkpoints enabled administrator Resume")
		}
	}
}

type orphanRoutingRaceRepository struct {
	repository.JobRepository
	repository.NativeJobRecoveryRepository
	repository.NativeOrphanRepository
	beforeRead func() error
	beforeCAS  func() error
}

func (r orphanRoutingRaceRepository) WithNativeJobLock(ctx context.Context, id string, fn func() error) error {
	return r.NativeJobRecoveryRepository.WithNativeJobLock(ctx, id, func() error {
		if r.beforeRead != nil {
			if err := r.beforeRead(); err != nil {
				return err
			}
		}
		return fn()
	})
}
func (r orphanRoutingRaceRepository) RouteNativeOrphan(job model.Job, now time.Time) (bool, error) {
	if r.beforeCAS != nil {
		if err := r.beforeCAS(); err != nil {
			return false, err
		}
	}
	return r.NativeOrphanRepository.RouteNativeOrphan(job, now)
}

func TestNativeOrphanLiveWorkerAndConcurrentCancellationAreFenced(t *testing.T) {
	forDispatchRepositories(t, func(t *testing.T, repo repository.JobRepository) {
		producer := &queue.MemoryProducer{}
		svc := dispatchService(repo, producer)
		job := automaticRecoveryFixture(t, repo, svc, "orphan_live_lock", model.JobTypeVideoGenerate, "", model.JobDispatchObserved, map[string]any{}, func(job *model.Job) { job.Status = model.JobStatusRunning })
		now := runningRecoveryClock(svc, job)
		native := repo.(repository.NativeJobRecoveryRepository)
		if err := native.WithNativeJobLock(context.Background(), job.ID, func() error { return svc.DispatchPending(context.Background()) }); err != nil {
			t.Fatal(err)
		}
		stored, _ := repo.GetByID(job.ID)
		if stored.Status != model.JobStatusRunning || stored.DispatchAttempts != job.DispatchAttempts || stored.DispatchNextAttemptAt == nil || !stored.DispatchNextAttemptAt.After(now) || len(producer.Messages) != 0 {
			t.Fatal("live orphan Worker was interrupted or not fairly deferred")
		}
		for index, stage := range []string{"fresh_read", "atomic_cas"} {
			candidate := automaticRecoveryFixture(t, repo, svc, fmt.Sprintf("orphan_cancel_%d", index), model.JobTypeVideoGenerate, "", model.JobDispatchObserved, map[string]any{}, func(job *model.Job) { job.Status = model.JobStatusRunning })
			runningRecoveryClock(svc, candidate)
			cancel := func() error { _, err := repo.UpdateStatus(candidate.ID, model.JobStatusCanceled); return err }
			wrapper := orphanRoutingRaceRepository{JobRepository: repo, NativeJobRecoveryRepository: native, NativeOrphanRepository: repo.(repository.NativeOrphanRepository)}
			if stage == "fresh_read" {
				wrapper.beforeRead = cancel
			} else {
				wrapper.beforeCAS = cancel
			}
			svc.repo = wrapper
			if err := svc.dispatchJob(context.Background(), candidate.ID); err != nil {
				t.Fatal(err)
			}
			stored, _ = repo.GetByID(candidate.ID)
			if stored.Status != model.JobStatusCanceled || stored.QueuePhase != "" || len(producer.Messages) != 0 {
				t.Fatal("orphan routing overwrote concurrent cancellation")
			}
			svc.repo = repo
		}
	})
}

func TestNativeOrphanBusyBatchCannotStarveMissingEvidence(t *testing.T) {
	forDispatchRepositories(t, func(t *testing.T, repo repository.JobRepository) {
		busy := map[string]bool{}
		wrapped := busyRunningRecoveryRepository{repo, repo.(repository.NativeJobRecoveryRepository), busy}
		producer := &queue.MemoryProducer{}
		svc := dispatchService(wrapped, producer)
		var last model.Job
		for index := range jobDispatchBatchSize {
			last = automaticRecoveryFixture(t, repo, svc, fmt.Sprintf("live_orphan_%02d", index), model.JobTypeVideoGenerate, "", model.JobDispatchObserved, map[string]any{}, func(job *model.Job) { job.Status = model.JobStatusRunning })
			busy[last.ID] = true
		}
		lost := automaticRecoveryFixture(t, repo, svc, "orphan_behind_live_workers", model.JobTypeImageGenerate, "", model.JobDispatchObserved, map[string]any{}, func(job *model.Job) { job.Status = model.JobStatusRunning; job.DispatchCiphertext = "" })
		runningRecoveryClock(svc, lost)
		if err := svc.DispatchPending(context.Background()); err != nil {
			t.Fatal(err)
		}
		if err := svc.DispatchPending(context.Background()); err != nil {
			t.Fatal(err)
		}
		stored, _ := repo.GetByID(lost.ID)
		if stored.Status != model.JobStatusQueued || stored.QueuePhase != "image_recovery_attention" || len(producer.Messages) != 0 {
			t.Fatal("live Worker batch starved missing-evidence reconciliation")
		}
	})
}
