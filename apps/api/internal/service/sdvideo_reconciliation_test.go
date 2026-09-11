package service

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/sdvideo"
	"github.com/ai-manju/api/internal/storage"
)

func reconciliationBridge(t *testing.T) (*repository.MemoryJobRepository, *JobService, *SDVideoBridge, string, *atomic.Value, *atomic.Int32) {
	t.Helper()
	state, creates := &atomic.Value{}, &atomic.Int32{}
	state.Store(map[string]any{"task_id": "remote", "status": "failed", "attempt": 1, "error": map[string]any{"code": "submission_uncertain"}})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && !strings.HasSuffix(r.URL.Path, "/cancel") {
			creates.Add(1)
			http.Error(w, "unexpected create", 500)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/result") {
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("test-video"))
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": state.Load(), "error": nil, "request_id": "review-test"})
	}))
	t.Cleanup(server.Close)
	_, private, _ := ed25519.GenerateKey(rand.Reader)
	client := sdvideo.NewClient(config.Config{SDVideoBaseURL: server.URL, SDVideoMode: "active",
		SDVideoJWTPrivateKey: base64.RawStdEncoding.EncodeToString(private), SDVideoRequestTimeoutMilli: 1000})
	repo := repository.NewMemoryJobRepository()
	jobs := NewJobService(repo, nil, "celery", 3)
	users := repository.NewMemoryUserRepository()
	_, err := users.CreateUser(model.User{ID: "owner", Username: "owner", Role: model.UserRoleMember, Status: model.UserStatusActive})
	if err != nil {
		t.Fatal(err)
	}
	created, err := jobs.CreateExternal(ExternalJobInput{UserID: "owner", Scope: "personal", Type: model.JobTypeVideoGenerate,
		ExternalProvider: "sd-video", ExternalTaskID: "remote", Payload: model.JSONB(`{"model":"sdvideo/mock"}`)})
	if err != nil {
		t.Fatal(err)
	}
	assets := NewAssetService(repository.NewMemoryAssetRepository(), storage.NewLocalFSStorage(t.TempDir()))
	return repo, jobs, NewSDVideoBridge(jobs, users, client, assets, 0, 10), created.Job.ID, state, creates
}

func TestReconciliationBridgeWaitsWithoutRepeatedFailureOrCreate(t *testing.T) {
	repo, jobs, bridge, id, state, creates := reconciliationBridge(t)
	ctx := context.Background()
	_, _ = bridge.RunOnce(ctx)
	job, _ := jobs.GetForUser(id, "owner")
	if !repository.IsUncertainSubmission(job) || job.BridgeState != "reconciliation_required" || job.Attempts != 1 {
		t.Fatalf("uncertain state: %+v", job)
	}
	_ = repo.DelayBridge(id, time.Now().Add(-time.Second))
	_, _ = bridge.RunOnce(ctx)
	job, _ = jobs.GetForUser(id, "owner")
	if job.Attempts != 1 {
		t.Fatalf("polling inflated failures: %d", job.Attempts)
	}
	state.Store(map[string]any{"task_id": "remote", "status": "running", "attempt": 1,
		"reconciliation": map[string]any{"decision": "bind_existing", "attempt": 1}})
	_ = repo.DelayBridge(id, time.Now().Add(-time.Second))
	_, _ = bridge.RunOnce(ctx)
	job, _ = jobs.GetForUser(id, "owner")
	if job.Status != model.JobStatusRunning || string(job.Error) != "{}" || job.FinishedAt != nil {
		t.Fatalf("not resumed: %+v", job)
	}
	state.Store(map[string]any{"task_id": "remote", "status": "succeeded", "attempt": 1,
		"reconciliation": map[string]any{"decision": "bind_existing", "attempt": 1}})
	_, _ = bridge.RunOnce(ctx)
	job, _ = jobs.GetForUser(id, "owner")
	if job.Status != model.JobStatusSucceeded {
		t.Fatalf("not imported: %+v", job)
	}
	if creates.Load() != 0 {
		t.Fatal("reconciliation created another remote task")
	}
}

func TestLegacyDoneUncertainJobCanRecoverButCanceledNeverDoes(t *testing.T) {
	for _, cancel := range []bool{false, true} {
		repo, jobs, bridge, id, state, creates := reconciliationBridge(t)
		_, _ = jobs.SetError(id, model.JSONB(`{"code":"submission_uncertain"}`))
		_ = repo.SetBridgeState(id, "done")
		pending, _ := repo.ListByExternal("sd-video", nil, 10)
		if len(pending) != 1 {
			t.Fatal("historical failed job lost")
		}
		if cancel {
			job, err := jobs.CancelForUser(id, "owner")
			if err != nil || job.Status != model.JobStatusCanceled {
				t.Fatalf("cancel: %+v %v", job, err)
			}
		}
		state.Store(map[string]any{"task_id": "remote", "status": "succeeded", "attempt": 1,
			"reconciliation": map[string]any{"decision": "bind_existing", "attempt": 1}})
		_, _ = bridge.RunOnce(context.Background())
		job, _ := jobs.GetForUser(id, "owner")
		if cancel && (job.Status != model.JobStatusCanceled || string(job.Result) != "{}") {
			t.Fatalf("canceled job revived: %+v", job)
		}
		if !cancel && job.Status != model.JobStatusSucceeded {
			t.Fatalf("legacy job not recovered: %+v", job)
		}
		if creates.Load() != 0 {
			t.Fatal("unexpected remote create")
		}
	}
}

func TestUncertainJobRequiresRecoveryEvidence(t *testing.T) {
	repo, jobs, bridge, id, state, _ := reconciliationBridge(t)
	_, _ = jobs.SetError(id, model.JSONB(`{"code":"submission_uncertain"}`))
	_ = repo.SetBridgeState(id, "done")
	state.Store(map[string]any{"task_id": "remote", "status": "succeeded", "attempt": 1})
	_, _ = bridge.RunOnce(context.Background())
	job, _ := jobs.GetForUser(id, "owner")
	if !repository.IsUncertainSubmission(job) || string(job.Result) != "{}" {
		t.Fatalf("unreviewed recovery accepted: %+v", job)
	}
}

func TestConfirmedAbsentUpdatesFailureWithoutCreatingRetry(t *testing.T) {
	_, jobs, bridge, id, state, creates := reconciliationBridge(t)
	_, _ = jobs.SetError(id, model.JSONB(`{"code":"submission_uncertain"}`))
	state.Store(map[string]any{"task_id": "remote", "status": "failed", "attempt": 1,
		"error":          map[string]any{"code": "submission_not_created_verified"},
		"reconciliation": map[string]any{"decision": "confirm_not_submitted", "attempt": 1}})
	_, _ = bridge.RunOnce(context.Background())
	job, _ := jobs.GetForUser(id, "owner")
	if job.Status != model.JobStatusFailed || repository.IsUncertainSubmission(job) || job.BridgeState != "done" {
		t.Fatalf("incorrect state: %+v", job)
	}
	if creates.Load() != 0 {
		t.Fatal("unexpected automatic retry")
	}
}

func TestUncertainFailureCannotBeReclassifiedWithoutAudit(t *testing.T) {
	_, jobs, bridge, id, state, _ := reconciliationBridge(t)
	_, _ = jobs.SetError(id, model.JSONB(`{"code":"submission_uncertain"}`))
	state.Store(map[string]any{"task_id": "remote", "status": "failed", "attempt": 1,
		"error": map[string]any{"code": "submission_not_created_verified"}})
	_, _ = bridge.RunOnce(context.Background())
	job, _ := jobs.GetForUser(id, "owner")
	if !repository.IsUncertainSubmission(job) {
		t.Fatalf("unreviewed failure unlocked retry: %+v", job)
	}
}
