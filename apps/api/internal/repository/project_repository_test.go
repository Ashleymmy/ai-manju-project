package repository

import (
	"errors"
	"testing"

	"github.com/ai-manju/api/internal/model"
)

func TestMemoryProjectRepositoryCreateAndSnapshotVersion(t *testing.T) {
	repo := NewMemoryProjectRepository()

	project, err := repo.Create(model.Project{
		ID:      "proj_test",
		Title:   "Test Project",
		OwnerID: "tester",
		Data:    model.JSONB("{}"),
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if project.CreatedAt.IsZero() || project.UpdatedAt.IsZero() {
		t.Fatalf("Create() did not set timestamps: %#v", project)
	}

	initial, err := repo.GetSnapshot(project.ID)
	if err != nil {
		t.Fatalf("GetSnapshot() error = %v", err)
	}
	if initial.Version != 0 {
		t.Fatalf("initial snapshot version = %d, want 0", initial.Version)
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
}

func TestMemoryProjectRepositoryDeleteRemovesSnapshot(t *testing.T) {
	repo := NewMemoryProjectRepository()

	project, err := repo.Create(model.Project{
		ID:      "proj_delete",
		Title:   "Delete Me",
		OwnerID: "tester",
		Data:    model.JSONB("{}"),
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	if _, err := repo.UpsertSnapshot(model.CanvasSnapshot{
		ProjectID: project.ID,
		Data:      model.JSONB(`{"nodes":[]}`),
	}); err != nil {
		t.Fatalf("UpsertSnapshot() error = %v", err)
	}

	if err := repo.Delete(project.ID); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}

	if _, err := repo.Get(project.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Get() error = %v, want ErrNotFound", err)
	}
	if _, err := repo.GetSnapshot(project.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("GetSnapshot() error = %v, want ErrNotFound", err)
	}
}

func TestMemoryProjectRepositoryMissingProject(t *testing.T) {
	repo := NewMemoryProjectRepository()

	if _, err := repo.Get("missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Get() error = %v, want ErrNotFound", err)
	}
	if _, err := repo.UpsertSnapshot(model.CanvasSnapshot{
		ProjectID: "missing",
		Data:      model.JSONB("{}"),
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("UpsertSnapshot() error = %v, want ErrNotFound", err)
	}
}

func TestMemoryProjectRepositoryOwnerIsolation(t *testing.T) {
	repo := NewMemoryProjectRepository()
	project, err := repo.Create(model.Project{
		ID:      "proj_owned",
		Title:   "Owned",
		OwnerID: "user_a",
		Data:    model.JSONB("{}"),
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	if _, err := repo.GetByOwner(project.ID, "user_a"); err != nil {
		t.Fatalf("GetByOwner(owner) error = %v", err)
	}
	if _, err := repo.GetByOwner(project.ID, "user_b"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("GetByOwner(other) error = %v, want ErrNotFound", err)
	}

	projects, err := repo.ListByOwner("user_b")
	if err != nil {
		t.Fatalf("ListByOwner(other) error = %v", err)
	}
	if len(projects) != 0 {
		t.Fatalf("ListByOwner(other) len = %d, want 0", len(projects))
	}

	if _, err := repo.UpsertSnapshotByOwner(model.CanvasSnapshot{ProjectID: project.ID, Data: model.JSONB("{}")}, "user_b"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("UpsertSnapshotByOwner(other) error = %v, want ErrNotFound", err)
	}
}
