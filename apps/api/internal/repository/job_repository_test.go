package repository

import (
	"testing"

	"github.com/ai-manju/api/internal/model"
)

func TestMemoryJobRepositoryCreateIsIdempotent(t *testing.T) {
	repo := NewMemoryJobRepository()
	first, err := repo.Create(model.Job{
		ID:             "job_first",
		IdempotencyKey: "idem-1",
		UserID:         "user_a",
		WorkspaceID:    "default:user_a",
		Type:           model.JobTypeImageGenerate,
		Status:         model.JobStatusQueued,
		Payload:        model.JSONB(`{"prompt":"a"}`),
		Result:         model.JSONB("{}"),
		Error:          model.JSONB("{}"),
		MaxAttempts:    3,
	})
	if err != nil {
		t.Fatal(err)
	}
	second, err := repo.Create(model.Job{
		ID:             "job_second",
		IdempotencyKey: "idem-1",
		UserID:         "user_a",
		WorkspaceID:    "default:user_a",
		Type:           model.JobTypeImageGenerate,
		Status:         model.JobStatusQueued,
		Payload:        model.JSONB(`{"prompt":"a"}`),
		Result:         model.JSONB("{}"),
		Error:          model.JSONB("{}"),
		MaxAttempts:    3,
	})
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID {
		t.Fatalf("second id = %q, want existing %q", second.ID, first.ID)
	}
}

func TestMemoryJobRepositorySetResultMarksTerminal(t *testing.T) {
	repo := NewMemoryJobRepository()
	job, err := repo.Create(model.Job{
		ID:             "job_done",
		IdempotencyKey: "idem-done",
		UserID:         "user_a",
		WorkspaceID:    "default:user_a",
		Type:           model.JobTypeImageGenerate,
		Status:         model.JobStatusQueued,
		Payload:        model.JSONB("{}"),
		Result:         model.JSONB("{}"),
		Error:          model.JSONB("{}"),
		MaxAttempts:    3,
	})
	if err != nil {
		t.Fatal(err)
	}
	job, err = repo.SetResult(job.ID, model.JSONB(`{"ok":true}`))
	if err != nil {
		t.Fatal(err)
	}
	if job.Status != model.JobStatusSucceeded || job.Progress != 100 || job.FinishedAt == nil {
		t.Fatalf("job = %+v", job)
	}
}
