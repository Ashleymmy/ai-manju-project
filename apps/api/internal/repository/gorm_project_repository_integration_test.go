package repository

import (
	"errors"
	"os"
	"testing"

	"github.com/ai-manju/api/internal/database"
	"github.com/ai-manju/api/internal/model"
)

func TestGormProjectRepositoryIntegration(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to run PostgreSQL repository integration test")
	}

	db, err := database.OpenPostgres(dsn)
	if err != nil {
		t.Fatalf("OpenPostgres() error = %v", err)
	}

	repo := NewGormProjectRepository(db)
	projectID := "proj_integration_test"
	_ = repo.Delete(projectID)

	project, err := repo.Create(model.Project{
		ID:      projectID,
		Title:   "Integration Project",
		OwnerID: "tester",
		Data:    model.JSONB(`{"id":"local-integration"}`),
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if _, err := repo.GetByOwner(project.ID, "tester"); err != nil {
		t.Fatalf("GetByOwner(owner) error = %v", err)
	}
	if _, err := repo.GetByOwner(project.ID, "other"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("GetByOwner(other) error = %v, want ErrNotFound", err)
	}
	t.Cleanup(func() {
		_ = repo.Delete(projectID)
	})

	empty, err := repo.GetSnapshot(project.ID)
	if err != nil {
		t.Fatalf("GetSnapshot(empty) error = %v", err)
	}
	if empty.Version != 0 {
		t.Fatalf("empty snapshot version = %d, want 0", empty.Version)
	}

	first, err := repo.UpsertSnapshot(model.CanvasSnapshot{
		ProjectID: project.ID,
		Data:      model.JSONB(`{"nodes":[],"connections":[]}`),
	})
	if err != nil {
		t.Fatalf("UpsertSnapshot(first) error = %v", err)
	}
	if first.Version != 1 {
		t.Fatalf("first snapshot version = %d, want 1", first.Version)
	}
	if _, err := repo.GetSnapshotByOwner(project.ID, "other"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("GetSnapshotByOwner(other) error = %v, want ErrNotFound", err)
	}

	second, err := repo.UpsertSnapshot(model.CanvasSnapshot{
		ProjectID: project.ID,
		Data:      model.JSONB(`{"nodes":[{"id":"node-1"}],"connections":[]}`),
	})
	if err != nil {
		t.Fatalf("UpsertSnapshot(second) error = %v", err)
	}
	if second.Version != 2 {
		t.Fatalf("second snapshot version = %d, want 2", second.Version)
	}

	loaded, err := repo.GetSnapshot(project.ID)
	if err != nil {
		t.Fatalf("GetSnapshot() error = %v", err)
	}
	if loaded.Version != 2 {
		t.Fatalf("loaded snapshot version = %d, want 2", loaded.Version)
	}

	if err := repo.Delete(project.ID); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}
	if _, err := repo.GetSnapshot(project.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("GetSnapshot() after delete error = %v, want ErrNotFound", err)
	}
}
