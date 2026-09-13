package service

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/sdvideo"
	"github.com/ai-manju/api/internal/storage"
)

func TestSDVideoBridgeImportsResultWithoutContentRequest(t *testing.T) {
	_, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/tasks/sdv_bridge" {
			_, _ = w.Write([]byte(`{"success":true,"data":{"task_id":"sdv_bridge","status":"succeeded","progress":100,"result":{"file_name":"bridge.mp4"}},"error":null,"request_id":"bridge-1"}`))
			return
		}
		if r.URL.Path == "/v1/tasks/sdv_bridge/result" {
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video-result"))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	client := sdvideo.NewClient(config.Config{
		SDVideoBaseURL: server.URL, SDVideoMode: "active",
		SDVideoJWTPrivateKey: base64.RawStdEncoding.EncodeToString(private),
		SDVideoJWTIssuer:     "ai-manju-studio", SDVideoJWTAudience: "sd-video",
		SDVideoJWTKeyID: "test", SDVideoRequestTimeoutMilli: 1000,
	})
	users := repository.NewMemoryUserRepository()
	user := model.User{ID: "bridge-user", Username: "bridge-user", Role: model.UserRoleMember, Status: model.UserStatusActive}
	if _, err := users.CreateUser(user); err != nil {
		t.Fatal(err)
	}
	jobs := NewJobService(repository.NewMemoryJobRepository(), nil, "celery", 3)
	created, err := jobs.CreateExternal(ExternalJobInput{
		UserID: user.ID, Scope: WorkspaceScopePersonal, Type: model.JobTypeVideoGenerate,
		ExternalProvider: "sd-video", ExternalTaskID: "sdv_bridge", Payload: model.JSONB(`{"project_id":"project-1","node_id":"node-1"}`),
		IdempotencyKey: "bridge-idempotency",
	})
	if err != nil {
		t.Fatal(err)
	}
	assets := NewAssetService(repository.NewMemoryAssetRepository(), storage.NewLocalFSStorage(t.TempDir()))
	bridge := NewSDVideoBridge(jobs, users, client, assets, 0, 10)
	processed, err := bridge.RunOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if processed != 1 {
		t.Fatalf("processed = %d", processed)
	}
	job, err := jobs.GetForUser(created.Job.ID, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if job.Status != model.JobStatusSucceeded {
		t.Fatalf("job status = %s", job.Status)
	}
	if len(job.Result) == 0 || string(job.BridgeMetadata) == "{}" {
		t.Fatalf("bridge result metadata missing: result=%s metadata=%s", job.Result, job.BridgeMetadata)
	}
	items, err := assets.List(user.ID, WorkspaceScopePersonal)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].SourceType != model.AssetSourceSDVideo || items[0].SourceJobID != created.Job.ID {
		t.Fatalf("imported assets = %+v", items)
	}
}
