package repository

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
)

func TestGenerationReceiptRepositoryReconcileRacesExecution(t *testing.T) {
	forGenerationReceiptRepositories(t, func(t *testing.T, repo GenerationReceiptRepository) {
		for round := range 8 {
			var inserted, executions atomic.Int32
			var wg sync.WaitGroup
			start := make(chan struct{})
			for worker := range 32 {
				wg.Add(1)
				go func() {
					defer wg.Done()
					candidate := generationReceiptRepositoryFixture()
					candidate.Key = fmt.Sprintf("race-%d", round)
					candidate.ID = fmt.Sprintf("race-%d-worker-%d", round, worker)
					if worker%2 == 0 {
						candidate.State, candidate.RequestHash, candidate.ExecutionToken = model.GenerationReceiptStateNotSubmitted, "", ""
					}
					<-start
					row, claimed, err := repo.Begin(context.Background(), candidate)
					if err != nil || row.Key != candidate.Key {
						t.Error("concurrent Begin failed")
						return
					}
					if claimed {
						inserted.Add(1)
						if row.State == model.GenerationReceiptStateRunning {
							executions.Add(1)
						}
					}
				}()
			}
			close(start)
			wg.Wait()
			row, err := repo.Find(context.Background(), "user", "default:user", model.GenerationReceiptKindText, fmt.Sprintf("race-%d", round))
			if err != nil || inserted.Load() != 1 || (row.State == model.GenerationReceiptStateNotSubmitted && executions.Load() != 0) || (row.State == model.GenerationReceiptStateRunning && executions.Load() != 1) {
				t.Fatalf("inconsistent unique claim: state=%s inserted=%d executions=%d", row.State, inserted.Load(), executions.Load())
			}
		}
	})
}

func TestGenerationReceiptRepositoryReconcileTombstoneCannotTransition(t *testing.T) {
	forGenerationReceiptRepositories(t, func(t *testing.T, repo GenerationReceiptRepository) {
		ctx := context.Background()
		candidate := generationReceiptRepositoryFixture()
		candidate.State, candidate.RequestHash, candidate.ExecutionToken = model.GenerationReceiptStateNotSubmitted, "", ""
		original, claimed, err := repo.Begin(ctx, candidate)
		if err != nil || !claimed {
			t.Fatal("tombstone insertion failed")
		}
		// Compare persisted timestamps at the database's native precision.
		original, err = repo.Find(ctx, original.UserID, original.WorkspaceID, original.Kind, original.Key)
		if err != nil {
			t.Fatal(err)
		}
		for _, state := range []string{model.GenerationReceiptStateRunning, model.GenerationReceiptStateSucceeded, model.GenerationReceiptStateFailed, model.GenerationReceiptStateUncertain, model.GenerationReceiptStateExpired, model.GenerationReceiptStateNotSubmitted} {
			expires := time.Now().Add(time.Hour)
			got, changed, err := repo.Transition(ctx, original, []string{model.GenerationReceiptStateNotSubmitted}, state, "must not overwrite", &expires)
			if err != nil || changed || got.State != original.State || got.Error != original.Error || !got.UpdatedAt.Equal(original.UpdatedAt) || !got.ExpiresAt.Equal(original.ExpiresAt) {
				t.Fatal("permanent tombstone was changed")
			}
		}
		late := generationReceiptRepositoryFixture()
		late.ID = "late-request"
		got, claimed, err := repo.Begin(ctx, late)
		if err != nil || claimed || got.State != model.GenerationReceiptStateNotSubmitted || got.ID != original.ID {
			t.Fatal("late POST reclaimed tombstone")
		}
		late.Key = "already-running"
		running, _, err := repo.Begin(ctx, late)
		if err != nil {
			t.Fatal(err)
		}
		got, changed, err := repo.Transition(ctx, running, []string{model.GenerationReceiptStateRunning}, model.GenerationReceiptStateNotSubmitted, "must not replace", nil)
		if err != nil || changed || got.State != model.GenerationReceiptStateRunning {
			t.Fatal("existing execution converted into tombstone")
		}
	})
}
