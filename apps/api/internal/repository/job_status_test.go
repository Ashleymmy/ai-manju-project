package repository

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestMemoryJobStatusLeavesGenerationInputsIntact(t *testing.T) {
	repo := NewMemoryJobRepository()
	payload := model.JSONB(`{"model":"video","content":[{"image_url":"data:image/png;base64,` + strings.Repeat("a", 1024*1024) + `"}],"asset_registration":{"source_node_id":"node","source_project_id":"canvas","references":["private media"]}}`)
	_, err := repo.Create(model.Job{ID: "one", UserID: "alice", WorkspaceID: "personal", Payload: payload, Result: model.JSONB(`{"outputs":[{"asset_id":"asset"}]}`)})
	if err != nil {
		t.Fatal(err)
	}
	status, err := repo.GetStatusForUser(context.Background(), "one", "alice")
	if err != nil {
		t.Fatal(err)
	}
	if len(status.Payload) > 200 || strings.Contains(string(status.Payload), "content") {
		t.Fatal("status contains media")
	}
	var decoded map[string]any
	if err := json.Unmarshal(status.Payload, &decoded); err != nil {
		t.Fatal(err)
	}
	registration := decoded["asset_registration"].(map[string]any)
	if registration["source_node_id"] != "node" || registration["source_project_id"] != "canvas" {
		t.Fatal("lost recovery identity")
	}
	full, _ := repo.GetByID("one")
	if string(full.Payload) != string(payload) || string(full.Result) != string(status.Result) {
		t.Fatal("status read changed generation or result")
	}
	if _, err := repo.GetStatusForUser(context.Background(), "one", "bob"); !errors.Is(err, ErrJobNotFound) {
		t.Fatal("status leaked across users")
	}
}

func TestMemoryJobStatusFiltersBeforeLimit(t *testing.T) {
	repo := NewMemoryJobRepository()
	for i, job := range []model.Job{
		{ID: "matching", UserID: "alice", WorkspaceID: "personal", Type: "video.generate", Status: "running"},
		{ID: "other-status", UserID: "alice", WorkspaceID: "personal", Type: "video.generate", Status: "succeeded"},
		{ID: "other-type", UserID: "alice", WorkspaceID: "personal", Type: "image.generate", Status: "running"},
		{ID: "other-space", UserID: "alice", WorkspaceID: "team", Type: "video.generate", Status: "running"},
		{ID: "other-user", UserID: "bob", WorkspaceID: "personal", Type: "video.generate", Status: "running"},
	} {
		job.IdempotencyKey = job.ID
		repo.clockFn = func() time.Time { return time.Unix(int64(i), 0) }
		if _, err := repo.Create(job); err != nil {
			t.Fatal(err)
		}
	}
	filter := JobStatusFilter{WorkspaceID: "personal", Statuses: []string{"running"}, Types: []string{"video.generate"}, Limit: 1}
	jobs, err := repo.ListStatusesForUser(context.Background(), "alice", filter)
	if err != nil || len(jobs) != 1 || jobs[0].ID != "matching" {
		t.Fatalf("filter result: %#v %v", jobs, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := repo.ListStatusesForUser(ctx, "alice", filter); !errors.Is(err, context.Canceled) {
		t.Fatal("ignored cancellation")
	}
}

func TestPostgresJobStatusQueryProjectsAndBoundsBeforeTransfer(t *testing.T) {
	db, err := gorm.Open(postgres.New(postgres.Config{DSN: "host=localhost user=test dbname=test sslmode=disable"}), &gorm.Config{DryRun: true, DisableAutomaticPing: true})
	if err != nil {
		t.Fatal(err)
	}
	var observed string
	db.Callback().Query().After("gorm:query").Register("capture_status_query", func(tx *gorm.DB) { observed = tx.Statement.SQL.String() })
	repo := NewGormJobRepository(db)
	_, err = repo.ListStatusesForUser(context.Background(), "alice", JobStatusFilter{WorkspaceID: "personal", Statuses: []string{"running"}, Types: []string{"video.generate"}, Limit: 25})
	if err != nil {
		t.Fatal(err)
	}
	for _, fragment := range []string{"jsonb_build_object", "AS payload", "user_id =", "workspace_id =", "status IN", "type IN", "ORDER BY updated_at DESC", "LIMIT"} {
		if !strings.Contains(observed, fragment) {
			t.Fatalf("query missing %q: %s", fragment, observed)
		}
	}
	if strings.Contains(observed, "SELECT *") {
		t.Fatal("status query loads media payload")
	}
	_, err = repo.GetStatusForUser(context.Background(), "one", "alice")
	if err != nil || !strings.Contains(observed, "id =") || !strings.Contains(observed, "user_id =") {
		t.Fatalf("unscoped detail query: %s %v", observed, err)
	}
}
