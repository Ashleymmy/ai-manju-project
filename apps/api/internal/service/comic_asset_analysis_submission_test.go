package service

import (
	"context"
	"errors"
	"io"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/storage"
)

func TestComicSubmissionHashRestoresSourceAndBindsFile(t *testing.T) {
	input := pendingAnalysisInput()
	reader := strings.NewReader("skipactor enters")
	_, _ = reader.Seek(4, io.SeekStart)
	input.Source = reader
	hash, err := comicSubmissionHash(&input)
	if err != nil {
		t.Fatal(err)
	}
	remaining, _ := io.ReadAll(input.Source)
	if string(remaining) != "actor enters" {
		t.Fatal("hash consumed the multipart source")
	}
	other := pendingAnalysisInput()
	got, err := comicSubmissionHash(&other)
	if err != nil || got != hash {
		t.Fatal("equal file content should bind equally")
	}
	other.Source = strings.NewReader("changed source")
	got, err = comicSubmissionHash(&other)
	if err != nil || got == hash {
		t.Fatal("different source was not bound")
	}
}

func TestComicSubmissionClaimIsolationAndChangedInput(t *testing.T) {
	fx := newComicServiceFixture()
	fx.service.SetSourceStorage(storage.NewLocalFSStorage(t.TempDir()))
	receipts := receiptService(repository.NewMemoryGenerationReceiptRepository(), newReceiptMemoryStorage())
	fx.service.SetAnalysisReceiptService(receipts)
	var calls atomic.Int32
	fx.service.SetTextGenerator(func(context.Context, string, string, provider.TextGenerationRequest) (provider.TextResponse, error) {
		calls.Add(1)
		return provider.TextResponse{Text: `{"assets":[{"class":"character","name":"Actor"}]}`}, nil
	})
	input := pendingAnalysisInput()
	input.IdempotencyKey = "submission-isolation"
	first, err := fx.service.CreateAnalysisSession(context.Background(), fx.userID, WorkspaceScopePersonal, input)
	if err != nil {
		t.Fatal(err)
	}
	_ = waitPendingAnalysis(t, fx, first.Session.ID)
	for _, scope := range []struct{ user, workspace string }{{"other", WorkspaceScopePersonal}, {fx.userID, WorkspaceScopeTeam}} {
		_, err := fx.service.GetAnalysisSubmission(context.Background(), scope.user, scope.workspace, input.IdempotencyKey)
		if !errors.Is(err, ErrGenerationReceiptNotFound) {
			t.Fatalf("foreign lookup: %v", err)
		}
	}
	changed := pendingAnalysisInput()
	changed.IdempotencyKey = input.IdempotencyKey
	changed.Source = strings.NewReader("changed source")
	_, err = fx.service.CreateAnalysisSession(context.Background(), fx.userID, WorkspaceScopePersonal, changed)
	if !errors.Is(err, ErrGenerationReceiptConflict) || calls.Load() != 1 {
		t.Fatal("changed source replayed")
	}
}

func TestComicSubmissionReconcilePreventsDelayedMultipartExecution(t *testing.T) {
	fx := newComicServiceFixture()
	receipts := receiptService(repository.NewMemoryGenerationReceiptRepository(), newReceiptMemoryStorage())
	fx.service.SetAnalysisReceiptService(receipts)
	input := pendingAnalysisInput()
	input.IdempotencyKey = "missing-upload"
	if _, err := fx.service.GetAnalysisSubmission(context.Background(), fx.userID, WorkspaceScopePersonal, input.IdempotencyKey); !errors.Is(err, ErrGenerationReceiptNotFound) {
		t.Fatal(err)
	}
	if _, err := receipts.Reconcile(context.Background(), comicSubmissionScope(fx.userID, WorkspaceScopePersonal, input.IdempotencyKey)); err != nil {
		t.Fatal(err)
	}
	status, err := fx.service.GetAnalysisSubmission(context.Background(), fx.userID, WorkspaceScopePersonal, input.IdempotencyKey)
	if err != nil || status.Status != model.GenerationReceiptStateNotSubmitted {
		t.Fatalf("status=%+v err=%v", status, err)
	}
	// No source storage/generator installed: reaching either would fail differently.
	if _, err := fx.service.CreateAnalysisSession(context.Background(), fx.userID, WorkspaceScopePersonal, input); !errors.Is(err, ErrComicAnalysisSubmissionPending) {
		t.Fatal(err)
	}
}

func TestComicSubmissionReadyDespiteAcceptanceStorageOutage(t *testing.T) {
	repo := repository.NewMemoryComicAssetRepository()
	store := newReceiptMemoryStorage()
	receipts := receiptService(repository.NewMemoryGenerationReceiptRepository(), store)
	svc := NewComicAssetService(repo, nil)
	svc.SetAnalysisReceiptService(receipts)
	claim, _, err := receipts.Begin(context.Background(), comicSubmissionScope("user", WorkspaceScopePersonal, "lost-acceptance"), receiptHash(t))
	if err != nil {
		t.Fatal(err)
	}
	sessionID, executionKey := comicSubmissionIdentities(claim)
	_, err = repo.CreatePendingAnalysisSession(model.ComicAssetAnalysisSession{ID: sessionID, OwnerID: "user", WorkspaceID: claim.WorkspaceID, Status: model.ComicAnalysisStatusProcessing, ExpiresAt: time.Now().Add(time.Hour), AnalysisReceiptVersion: model.ComicAnalysisReceiptVersion, AnalysisReceiptKey: executionKey})
	if err != nil {
		t.Fatal(err)
	}
	store.getErr = errors.New("storage temporarily unavailable")
	status, err := svc.GetAnalysisSubmission(context.Background(), "user", WorkspaceScopePersonal, "lost-acceptance")
	if err != nil || status.Status != "ready" || status.SessionID != sessionID {
		t.Fatalf("status=%+v err=%v", status, err)
	}
}

type staleSubmissionReceiptRepository struct {
	repository.GenerationReceiptRepository
}

func (r staleSubmissionReceiptRepository) Find(ctx context.Context, user, workspace, kind, key string) (model.GenerationReceipt, error) {
	row, err := r.GenerationReceiptRepository.Find(ctx, user, workspace, kind, key)
	row.CreatedAt = time.Now().Add(-ComicAnalysisTaskTimeout - time.Minute)
	return row, err
}

func TestComicSubmissionStaleSetupSealsModelExecution(t *testing.T) {
	repo := repository.NewMemoryComicAssetRepository()
	receipts := receiptService(staleSubmissionReceiptRepository{repository.NewMemoryGenerationReceiptRepository()}, newReceiptMemoryStorage())
	svc := NewComicAssetService(repo, nil)
	svc.SetAnalysisReceiptService(receipts)
	claim, _, err := receipts.Begin(context.Background(), comicSubmissionScope("user", WorkspaceScopePersonal, "stale-setup"), receiptHash(t))
	if err != nil {
		t.Fatal(err)
	}
	status, err := svc.GetAnalysisSubmission(context.Background(), "user", WorkspaceScopePersonal, "stale-setup")
	if err != nil || status.Status != model.GenerationReceiptStateNotSubmitted {
		t.Fatalf("status=%+v err=%v", status, err)
	}
	_, executionKey := comicSubmissionIdentities(claim)
	late, claimed, err := receipts.Begin(context.Background(), GenerationReceiptScope{UserID: "user", WorkspaceID: claim.WorkspaceID, Kind: model.GenerationReceiptKindText, Key: executionKey}, receiptHash(t))
	if err != nil || claimed || late.State != model.GenerationReceiptStateNotSubmitted {
		t.Fatal("late model call was not sealed")
	}
}
