package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/storage"
)

// Reconciliation must remain usable without any result storage operation.
type forbiddenReceiptStorage struct{ storage.Storage }

func (forbiddenReceiptStorage) Get(context.Context, string) (io.ReadCloser, storage.StorageObject, error) {
	panic("reconciliation read result storage")
}
func (forbiddenReceiptStorage) Put(context.Context, string, io.Reader, storage.PutMeta) (storage.StorageObject, error) {
	panic("reconciliation wrote result storage")
}

func TestGenerationReceiptReconcilePermanentTombstoneBlocksLateSubmission(t *testing.T) {
	for _, kind := range []string{model.GenerationReceiptKindText, model.GenerationReceiptKindAudio} {
		t.Run(kind, func(t *testing.T) {
			ctx := context.Background()
			repo := repository.NewMemoryGenerationReceiptRepository()
			svc := receiptService(repo, forbiddenReceiptStorage{})
			scope := receiptScope(kind)
			now := time.Now().UTC()
			svc.clock = func() time.Time { return now }
			row, err := svc.Reconcile(ctx, scope)
			if err != nil || row.State != model.GenerationReceiptStateNotSubmitted || row.RequestHash != "" || row.ExecutionToken != "" {
				t.Fatalf("unexpected reconciliation: state=%s err=%v", row.State, err)
			}
			now = now.Add(10 * GenerationReceiptRetention)
			for range 3 {
				again, err := svc.Reconcile(ctx, scope)
				if err != nil || again != row {
					t.Fatal("repeat reconciliation changed the tombstone")
				}
			}
			got, result, err := svc.Lookup(ctx, scope)
			if err != nil || result != nil || got != row {
				t.Fatal("tombstone expired or read result storage")
			}
			for _, hash := range []string{receiptHash(t), fmt.Sprintf("%064x", 42)} {
				got, claimed, err := svc.Begin(ctx, scope, hash)
				if err != nil || claimed || got != row {
					t.Fatal("late submission did not return definitive not_submitted")
				}
			}
			body, contentType := []byte(`{"text":"late"}`), "application/json"
			if kind == model.GenerationReceiptKindAudio {
				body, contentType = []byte("ID3audio"), "audio/mpeg"
			}
			if err := svc.Complete(ctx, row, GenerationReceiptResult{ContentType: contentType, Body: body}); !errors.Is(err, ErrGenerationReceiptConflict) {
				t.Fatal("tombstone accepted an execution result")
			}
			if err := svc.Fail(ctx, row, "unused", true); err != nil {
				t.Fatal(err)
			}
			got, _, err = svc.Lookup(ctx, scope)
			if err != nil || got != row {
				t.Fatal("failure changed the tombstone")
			}
			// A restarted instance without storage or encryption can still prove
			// absence without decrypting any result or granting execution.
			restarted := NewGenerationReceiptService(repo, nil, provider.SecretBox{})
			got, err = restarted.Reconcile(ctx, scope)
			if err != nil || got != row {
				t.Fatal("reconciliation depended on result storage readiness")
			}
			got, _, err = restarted.Lookup(ctx, scope)
			if err != nil || got != row {
				t.Fatal("tombstone lookup depended on result storage readiness")
			}
			got, claimed, err := restarted.Begin(ctx, scope, receiptHash(t))
			if err != nil || claimed || got != row {
				t.Fatal("late POST lost the tombstone while result storage was unavailable")
			}
		})
	}
}

func TestGenerationReceiptReconcilePreservesEveryExistingState(t *testing.T) {
	for _, state := range []string{model.GenerationReceiptStateRunning, model.GenerationReceiptStateSucceeded, model.GenerationReceiptStateFailed, model.GenerationReceiptStateUncertain, model.GenerationReceiptStateExpired} {
		t.Run(state, func(t *testing.T) {
			repo := repository.NewMemoryGenerationReceiptRepository()
			svc := receiptService(repo, forbiddenReceiptStorage{})
			scope, hash := receiptScope(model.GenerationReceiptKindText), receiptHash(t)
			row, claimed, err := svc.Begin(context.Background(), scope, hash)
			if err != nil || !claimed {
				t.Fatal("initial claim failed")
			}
			row, _, err = repo.Transition(context.Background(), row, []string{row.State}, state, "public status", nil)
			if err != nil {
				t.Fatal(err)
			}
			// Even long-expired deadlines must not cause reconciliation to
			// mutate the state or inspect an encrypted result.
			svc.clock = func() time.Time { return row.ExpiresAt.Add(GenerationReceiptRetention) }
			for range 3 {
				got, err := svc.Reconcile(context.Background(), scope)
				if err != nil || got != row {
					t.Fatal("reconciliation changed an existing execution")
				}
			}
		})
	}
}

func TestGenerationReceiptReconcileOwnershipAndValidation(t *testing.T) {
	repo := repository.NewMemoryGenerationReceiptRepository()
	svc := receiptService(repo, forbiddenReceiptStorage{})
	scope := receiptScope(model.GenerationReceiptKindText)
	original, _, err := svc.Begin(context.Background(), scope, receiptHash(t))
	if err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*GenerationReceiptScope){
		func(s *GenerationReceiptScope) { s.UserID = "other" },
		func(s *GenerationReceiptScope) { s.WorkspaceID = "team:other" },
		func(s *GenerationReceiptScope) { s.Kind = model.GenerationReceiptKindAudio },
		func(s *GenerationReceiptScope) { s.Key = "other" },
	} {
		other := scope
		change(&other)
		got, err := svc.Reconcile(context.Background(), other)
		if err != nil || got.State != model.GenerationReceiptStateNotSubmitted || got.ID == original.ID {
			t.Fatal("reconciliation crossed scope")
		}
	}
	got, err := svc.Reconcile(context.Background(), scope)
	if err != nil || got != original {
		t.Fatal("another scope changed the original")
	}
	for _, bad := range []GenerationReceiptScope{{}, {"user", "../unsafe", "text", "key"}, {"user", "default:user", "video", "key"}, {"user", "default:user", "text", "\rkey"}} {
		if _, err := svc.Reconcile(context.Background(), bad); !errors.Is(err, ErrGenerationReceiptInvalid) {
			t.Fatal("invalid scope accepted")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := svc.Reconcile(ctx, scope); !errors.Is(err, ErrGenerationReceiptUnavailable) {
		t.Fatal("canceled repository operation accepted")
	}
}

func TestGenerationReceiptReconcileRacesOriginalSubmission(t *testing.T) {
	svc := receiptService(repository.NewMemoryGenerationReceiptRepository(), forbiddenReceiptStorage{})
	hash := receiptHash(t)
	for iteration := range 40 {
		scope := receiptScope(model.GenerationReceiptKindText)
		scope.Key = fmt.Sprintf("race-%d", iteration)
		start := make(chan struct{})
		var claims atomic.Int32
		var wg sync.WaitGroup
		for worker := range 24 {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				if worker%2 == 0 {
					_, err := svc.Reconcile(context.Background(), scope)
					if err != nil {
						t.Error(err)
					}
				} else {
					_, claimed, err := svc.Begin(context.Background(), scope, hash)
					if err != nil {
						t.Error(err)
					}
					if claimed {
						claims.Add(1)
					}
				}
			}()
		}
		close(start)
		wg.Wait()
		got, err := svc.Reconcile(context.Background(), scope)
		if err != nil || (got.State == model.GenerationReceiptStateNotSubmitted && claims.Load() != 0) || (got.State == model.GenerationReceiptStateRunning && claims.Load() != 1) {
			t.Fatalf("race granted inconsistent ownership: status=%s claims=%d err=%v", got.State, claims.Load(), err)
		}
	}
}
