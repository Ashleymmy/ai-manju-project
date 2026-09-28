package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/queue"
	"github.com/ai-manju/api/internal/repository"
)

func recoveryFixture(t *testing.T, repo repository.JobRepository, producer queue.Producer, key string) (*JobService, model.Job) {
	t.Helper()
	svc := dispatchService(repo, producer)
	result, err := svc.Enqueue(context.Background(), dispatchInput(key))
	if err != nil {
		t.Fatal(err)
	}
	metadata := model.JSONB(`{"_worker_video_checkpoint":{"version":1,"revision":2,"phase":"accepted","provider_id":"provider","provider_identity":"synthetic-hash","provider_task_id":"original-task","model":"video","secret_url":"must-not-escape"}}`)
	if _, err = repo.SetExternalState(result.Job.ID, "", "", "", metadata); err != nil {
		t.Fatal(err)
	}
	if _, err = repo.UpdateStatus(result.Job.ID, model.JobStatusRunning); err != nil {
		t.Fatal(err)
	}
	if _, err = repo.UpdateQueuePhase(result.Job.ID, "video_recovery_attention"); err != nil {
		t.Fatal(err)
	}
	makeDispatchDue(t, repo, result.Job.ID)
	if err = svc.DispatchPending(context.Background()); err != nil {
		t.Fatal(err)
	}
	job, _ := repo.GetByID(result.Job.ID)
	return svc, job
}

func TestNativeRecoveryRetainsOriginalConfigAndNeverSchedulesGeneration(t *testing.T) {
	forDispatchRepositories(t, func(t *testing.T, repo repository.JobRepository) {
		producer := &queue.MemoryProducer{}
		svc, job := recoveryFixture(t, repo, producer, "recover-original")
		if job.DispatchCiphertext == "" || job.DispatchState != model.JobDispatchObserved {
			t.Fatal("lost original execution snapshot")
		}
		past := time.Now().Add(-time.Minute)
		_ = repo.UpdateDispatch(job.ID, model.JobDispatchObserved, &past, false)
		ids, err := repo.ListDispatchPendingIDs(time.Now(), 20)
		if err != nil || len(ids) != 0 {
			t.Fatal("active observed jobs should retain snapshots without scanning media")
		}
		before := len(producer.Messages)
		row, err := svc.ResumeNativeRecovery(context.Background(), model.User{ID: "admin", Role: model.UserRoleOpsAdmin}, job.ID, 2)
		if err != nil || !row.RecoveryRequested || len(producer.Messages) != before+1 {
			t.Fatalf("recover request failed: %v", err)
		}
		message := producer.Messages[len(producer.Messages)-1]
		if message.JobID != job.ID || message.Kwargs["_recovery_only"] != true || message.Kwargs["_recovery_dispatch_token"] == "" {
			t.Fatal("unsafe recovery envelope")
		}
		if message.Kwargs["provider"].(map[string]any)["api_key"] != "never-expose-this-key" {
			t.Fatal("changed execution credentials")
		}
		if _, err = svc.ResumeNativeRecovery(context.Background(), model.User{Role: model.UserRoleSuperAdmin}, job.ID, 2); err != nil || len(producer.Messages) != before+1 {
			t.Fatal("duplicate action published twice")
		}
		page, err := svc.ListNativeRecovery(30, 0)
		if err != nil || len(page.Items) != 1 {
			t.Fatalf("list failed: %v", err)
		}
		public, _ := json.Marshal(page)
		for _, private := range []string{"never-expose-this-key", "must-not-escape", "dispatch_ciphertext", "provider_identity", "_worker_"} {
			if strings.Contains(string(public), private) {
				t.Fatal("private recovery data escaped")
			}
		}
		if _, err = repo.SetResult(job.ID, model.JSONB(`{"outputs":[]}`)); err != nil {
			t.Fatal(err)
		}
		_ = repo.UpdateDispatch(job.ID, model.JobDispatchObserved, &past, false)
		if err = svc.DispatchPending(context.Background()); err != nil {
			t.Fatal(err)
		}
		stored, _ := repo.GetByID(job.ID)
		if stored.DispatchCiphertext != "" || stored.Status != model.JobStatusSucceeded {
			t.Fatal("terminal snapshot not cleared")
		}
	})
}

func TestNativeRecoveryPermissionsRevisionAndWorkerLock(t *testing.T) {
	forDispatchRepositories(t, func(t *testing.T, repo repository.JobRepository) {
		svc, job := recoveryFixture(t, repo, &queue.MemoryProducer{}, "recover-fences")
		for _, role := range []string{model.UserRoleMember, model.UserRoleAuditor, ""} {
			if _, err := svc.ResumeNativeRecovery(context.Background(), model.User{Role: role}, job.ID, 2); !errors.Is(err, ErrNativeRecoveryForbidden) {
				t.Fatal("unprivileged recovery")
			}
		}
		actor := model.User{Role: model.UserRoleSuperAdmin}
		if _, err := svc.ResumeNativeRecovery(context.Background(), actor, job.ID, 1); !errors.Is(err, repository.ErrJobRecoveryConflict) {
			t.Fatal("stale checkpoint accepted")
		}
		native := repo.(repository.NativeJobRecoveryRepository)
		if err := native.WithNativeJobLock(context.Background(), job.ID, func() error {
			_, err := svc.ResumeNativeRecovery(context.Background(), actor, job.ID, 2)
			if !errors.Is(err, repository.ErrJobRecoveryBusy) {
				t.Fatalf("executing job was not fenced: %v", err)
			}
			return nil
		}); err != nil {
			t.Fatal(err)
		}
	})
}

func TestNativeRecoveryRejectsUncertainVideoAndMissingSnapshots(t *testing.T) {
	for _, mode := range []string{"uncertain", "missing"} {
		repo := repository.NewMemoryJobRepository()
		producer := &queue.MemoryProducer{}
		svc, job := recoveryFixture(t, repo, producer, mode)
		if mode == "missing" {
			_ = repo.UpdateDispatch(job.ID, model.JobDispatchObserved, nil, true)
		} else {
			_, _ = repo.SetExternalState(job.ID, "", "", "", model.JSONB(`{"_worker_video_checkpoint":{"version":1,"revision":2,"phase":"submission_intent","provider_identity":"synthetic-hash"}}`))
		}
		if _, err := svc.ResumeNativeRecovery(context.Background(), model.User{Role: model.UserRoleSuperAdmin}, job.ID, 2); !errors.Is(err, ErrNativeRecoveryUnavailable) {
			t.Fatal("unsafe recovery accepted")
		}
		if len(producer.Messages) != 1 {
			t.Fatal("new generation was published")
		}
	}
}

func TestNativeRecoveryBrokerLossSurvivesRestartAndImmediateAcknowledgement(t *testing.T) {
	forDispatchRepositories(t, func(t *testing.T, repo repository.JobRepository) {
		svc, job := recoveryFixture(t, repo, failingJobProducer{}, "recover-broker")
		if _, err := svc.ResumeNativeRecovery(context.Background(), model.User{Role: model.UserRoleSuperAdmin}, job.ID, 2); err != nil {
			t.Fatal(err)
		}
		stored, _ := repo.GetByID(job.ID)
		if stored.DispatchState != repository.JobDispatchRecoveryPending {
			t.Fatal("lost durable recovery request")
		}
		past := time.Now().Add(-time.Minute)
		_ = repo.UpdateDispatch(job.ID, repository.JobDispatchRecoveryPending, &past, false)
		calls := 0
		restarted := dispatchService(repo, jobSafetyProducer(func(_ context.Context, message queue.TaskMessage) error {
			calls++
			if message.Kwargs["_recovery_only"] != true {
				t.Fatal("lost recovery guard")
			}
			next := time.Now().Add(time.Minute)
			return repo.UpdateDispatch(job.ID, model.JobDispatchObserved, &next, false)
		}))
		if err := restarted.DispatchPending(context.Background()); err != nil {
			t.Fatal(err)
		}
		stored, _ = repo.GetByID(job.ID)
		if calls != 1 || stored.DispatchState != model.JobDispatchObserved || stored.DispatchCiphertext == "" {
			t.Fatal("late publish acknowledgement overwrote worker receipt")
		}
		var metadata map[string]map[string]any
		_ = json.Unmarshal(stored.BridgeMetadata, &metadata)
		token := metadata[repository.JobRecoveryControlKey]["token"].(string)
		native := repo.(repository.NativeJobRecoveryRepository)
		if ready, err := native.PrepareNativeRecoveryPublish(job.ID, token, time.Now()); err != nil || ready {
			t.Fatal("stale dispatcher erased worker acknowledgement")
		}
		// Even an old published marker cannot reopen an acknowledged token.
		metadata[repository.JobRecoveryControlKey]["acknowledged"] = true
		raw, _ := json.Marshal(metadata)
		_, _ = repo.SetExternalState(job.ID, "", "", "", model.JSONB(raw))
		_ = repo.UpdateDispatch(job.ID, repository.JobDispatchRecoveryPublished, &past, false)
		if ready, err := native.PrepareNativeRecoveryPublish(job.ID, token, time.Now()); err != nil || ready {
			t.Fatal("acknowledged recovery token was republished")
		}
	})
}
