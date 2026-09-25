package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/storage"
)

func newReceiptAnalysisSession(t *testing.T, repo repository.ComicAssetRepository, id string) model.ComicAssetAnalysisSession {
	t.Helper()
	session, err := repo.CreatePendingAnalysisSession(model.ComicAssetAnalysisSession{
		ID: id, OwnerID: "user", WorkspaceID: "default:user", Status: model.ComicAnalysisStatusProcessing,
		ExpiresAt: time.Now().Add(time.Hour), AnalysisReceiptVersion: model.ComicAnalysisReceiptVersion, AnalysisReceiptKey: "comic-receipt:" + id,
	})
	if err != nil {
		t.Fatal(err)
	}
	return session
}

func TestComicAnalysisReceiptIsBoundBeforeAsyncStartAndHiddenFromResponse(t *testing.T) {
	fx := newComicServiceFixture()
	fx.service.SetSourceStorage(storage.NewLocalFSStorage(t.TempDir()))
	fx.service.SetAnalysisReceiptService(receiptService(repository.NewMemoryGenerationReceiptRepository(), newReceiptMemoryStorage()))
	fx.service.SetTextGenerator(func(context.Context, string, string, provider.TextGenerationRequest) (provider.TextResponse, error) {
		return provider.TextResponse{Text: `{"assets":[{"class":"character","name":"Actor"}]}`}, nil
	})
	detail, err := fx.service.CreateAnalysisSession(context.Background(), fx.userID, WorkspaceScopePersonal, pendingAnalysisInput())
	if err != nil {
		t.Fatal(err)
	}
	if !comicAnalysisHasReceipt(detail.Session) {
		t.Fatal("missing persisted receipt protocol marker")
	}
	body, err := json.Marshal(detail)
	if err != nil || strings.Contains(string(body), detail.Session.AnalysisReceiptKey) || strings.Contains(string(body), "analysis_receipt") {
		t.Fatal("internal receipt identity leaked")
	}
	finished := waitPendingAnalysis(t, fx, detail.Session.ID)
	if finished.Session.Status != model.ComicAnalysisStatusActive {
		t.Fatalf("status=%s", finished.Session.Status)
	}
}

func TestComicAnalysisReceiptStorageOutageDoesNotBecomeNotSubmitted(t *testing.T) {
	repo := repository.NewMemoryComicAssetRepository()
	store := newReceiptMemoryStorage()
	receipts := receiptService(repository.NewMemoryGenerationReceiptRepository(), store)
	session := newReceiptAnalysisSession(t, repo, "storage-outage")
	if _, _, err := receipts.Begin(context.Background(), comicAnalysisReceiptScope(session), receiptHash(t)); err != nil {
		t.Fatal(err)
	}
	store.getErr = errors.New("temporary storage outage")
	svc := NewComicAssetService(staleAnalysisRepository{repo}, nil)
	svc.SetAnalysisReceiptService(receipts)
	if _, err := svc.GetAnalysisSession(session.ID, session.OwnerID, WorkspaceScopePersonal); !errors.Is(err, ErrGenerationReceiptUnavailable) {
		t.Fatalf("lookup=%v", err)
	}
	saved, _, err := repo.GetAnalysisSession(session.ID, session.WorkspaceID)
	if err != nil || saved.Status != model.ComicAnalysisStatusProcessing || saved.AnalysisError != "" {
		t.Fatalf("outage misclassified: %+v %v", saved, err)
	}
}

type analysisRecoveryOutage struct {
	repository.ComicAssetRepository
}

func (r analysisRecoveryOutage) RecoverAnalysisSessionFromReceipt(string, string, string, string, model.ComicAssetAnalysisRevision, time.Time) error {
	return errors.New("temporary database outage")
}

func TestComicAnalysisReceiptSurvivesSessionSaveFailureAndRestart(t *testing.T) {
	repo := repository.NewMemoryComicAssetRepository()
	receipts := repository.NewMemoryGenerationReceiptRepository()
	store := newReceiptMemoryStorage()
	session := newReceiptAnalysisSession(t, repo, "save-failure")
	svc := NewComicAssetService(analysisRecoveryOutage{repo}, nil)
	svc.SetAnalysisReceiptService(receiptService(receipts, store))
	var calls atomic.Int32
	svc.SetTextGenerator(func(context.Context, string, string, provider.TextGenerationRequest) (provider.TextResponse, error) {
		calls.Add(1)
		return provider.TextResponse{Text: `{"assets":[{"class":"character","name":"Private actor"}]}`}, nil
	})
	svc.runPendingAnalysis(context.Background(), session, "model", "instruction", provider.TextGenerationRequest{})
	saved, revisions, err := repo.GetAnalysisSession(session.ID, session.WorkspaceID)
	if err != nil || saved.Status != model.ComicAnalysisStatusProcessing || len(revisions) != 0 {
		t.Fatalf("session must await repair: %+v %v", saved, err)
	}
	// A fresh service uses durable state only. No generator is installed.
	restarted := NewComicAssetService(repo, nil)
	restarted.SetAnalysisReceiptService(receiptService(receipts, store))
	detail, err := restarted.GetAnalysisSession(session.ID, session.OwnerID, WorkspaceScopePersonal)
	if err != nil || detail.Session.Status != model.ComicAnalysisStatusActive || len(detail.Revisions) != 1 {
		t.Fatalf("repair=%+v err=%v", detail, err)
	}
	// Re-entering the old execution must find its previous claim, never submit.
	svc.runPendingAnalysis(context.Background(), session, "model", "instruction", provider.TextGenerationRequest{})
	if calls.Load() != 1 {
		t.Fatalf("provider calls=%d", calls.Load())
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	for _, body := range store.objects {
		if json.Valid(body) {
			t.Fatal("candidate was not encrypted")
		}
	}
}

func TestComicAnalysisReceiptPreservesSuccessAfterDeadline(t *testing.T) {
	repo := repository.NewMemoryComicAssetRepository()
	session := newReceiptAnalysisSession(t, repo, "late-success")
	svc := NewComicAssetService(repo, nil)
	svc.SetAnalysisReceiptService(receiptService(repository.NewMemoryGenerationReceiptRepository(), newReceiptMemoryStorage()))
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	svc.SetTextGenerator(func(ctx context.Context, _ string, _ string, _ provider.TextGenerationRequest) (provider.TextResponse, error) {
		<-ctx.Done()
		return provider.TextResponse{Text: `{"assets":[{"class":"character","name":"Actor"}]}`}, nil
	})
	svc.runPendingAnalysis(ctx, session, "model", "", provider.TextGenerationRequest{})
	detail, err := svc.GetAnalysisSession(session.ID, session.OwnerID, WorkspaceScopePersonal)
	if err != nil || detail.Session.Status != model.ComicAnalysisStatusActive || len(detail.Revisions) != 1 {
		t.Fatalf("late result=%+v %v", detail, err)
	}
}

func TestComicAnalysisReceiptRepairsTimeoutRaceWithoutDuplicateExecution(t *testing.T) {
	repo := repository.NewMemoryComicAssetRepository()
	session := newReceiptAnalysisSession(t, repo, "timeout-race")
	svc := NewComicAssetService(staleAnalysisRepository{repo}, nil)
	svc.SetAnalysisReceiptService(receiptService(repository.NewMemoryGenerationReceiptRepository(), newReceiptMemoryStorage()))
	started, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	svc.SetTextGenerator(func(context.Context, string, string, provider.TextGenerationRequest) (provider.TextResponse, error) {
		calls.Add(1)
		close(started)
		<-release
		return provider.TextResponse{Text: `{"assets":[{"class":"character","name":"Actor"}]}`}, nil
	})
	go func() {
		defer close(done)
		svc.runPendingAnalysis(context.Background(), session, "model", "", provider.TextGenerationRequest{})
	}()
	<-started
	// Duplicate execution attempts while the first call is running do not call
	// the Provider. GET concurrently times out the empty session.
	svc.runPendingAnalysis(context.Background(), session, "model", "", provider.TextGenerationRequest{})
	detail, err := svc.GetAnalysisSession(session.ID, session.OwnerID, WorkspaceScopePersonal)
	if err != nil || detail.Session.Status != model.ComicAnalysisStatusFailed || detail.Session.AnalysisError != comicAnalysisTimeoutMessage || !detail.Session.AnalysisRecoveryPending {
		t.Fatalf("timeout=%+v %v", detail, err)
	}
	close(release)
	<-done
	detail, err = svc.GetAnalysisSession(session.ID, session.OwnerID, WorkspaceScopePersonal)
	if err != nil || detail.Session.Status != model.ComicAnalysisStatusActive || len(detail.Revisions) != 1 || calls.Load() != 1 || detail.Session.AnalysisRecoveryPending {
		t.Fatalf("recovered=%+v calls=%d err=%v", detail, calls.Load(), err)
	}
}

func TestComicAnalysisReceiptMissingClaimIsClosedOnlyForNewSessions(t *testing.T) {
	repo := repository.NewMemoryComicAssetRepository()
	receipts := receiptService(repository.NewMemoryGenerationReceiptRepository(), newReceiptMemoryStorage())
	session := newReceiptAnalysisSession(t, repo, "never-claimed")
	svc := NewComicAssetService(staleAnalysisRepository{repo}, nil)
	svc.SetAnalysisReceiptService(receipts)
	svc.SetTextGenerator(func(context.Context, string, string, provider.TextGenerationRequest) (provider.TextResponse, error) {
		t.Error("must not generate after not-submitted tombstone")
		return provider.TextResponse{}, nil
	})
	detail, err := svc.GetAnalysisSession(session.ID, session.OwnerID, WorkspaceScopePersonal)
	if err != nil || detail.Session.AnalysisError != comicAnalysisNotSubmittedMessage || detail.Session.AnalysisRecoveryPending {
		t.Fatalf("not submitted=%+v %v", detail, err)
	}
	svc.runPendingAnalysis(context.Background(), session, "model", "", provider.TextGenerationRequest{})
	receipt, output, err := receipts.Lookup(context.Background(), comicAnalysisReceiptScope(session))
	if err != nil || output != nil || receipt.State != model.GenerationReceiptStateNotSubmitted {
		t.Fatalf("tombstone=%+v %v", receipt, err)
	}
	legacy := session
	legacy.ID, legacy.AnalysisReceiptVersion, legacy.AnalysisReceiptKey = "legacy", 0, ""
	if _, err := repo.CreatePendingAnalysisSession(legacy); err != nil {
		t.Fatal(err)
	}
	detail, err = svc.GetAnalysisSession(legacy.ID, legacy.OwnerID, WorkspaceScopePersonal)
	if err != nil || detail.Session.AnalysisError != comicAnalysisTimeoutMessage {
		t.Fatalf("legacy=%+v %v", detail, err)
	}
}

func TestComicAnalysisReceiptRejectsForeignEnvelopeAndScope(t *testing.T) {
	for _, mismatch := range []string{"owner", "workspace", "session", "revision", "candidate"} {
		t.Run(mismatch, func(t *testing.T) {
			repo := repository.NewMemoryComicAssetRepository()
			session := newReceiptAnalysisSession(t, repo, "binding-"+mismatch)
			receipts := receiptService(repository.NewMemoryGenerationReceiptRepository(), newReceiptMemoryStorage())
			binding, _, err := receipts.Begin(context.Background(), comicAnalysisReceiptScope(session), receiptHash(t))
			if err != nil {
				t.Fatal(err)
			}
			result := comicAnalysisReceiptResult{Version: model.ComicAnalysisReceiptVersion, SessionID: session.ID, OwnerID: session.OwnerID, WorkspaceID: session.WorkspaceID,
				Revision: model.ComicAssetAnalysisRevision{ID: "revision", SessionID: session.ID, Source: model.ComicAnalysisRevisionSourceInitial, Candidate: model.JSONB(`{"assets":[{"class":"character","name":"Actor"}]}`)}}
			switch mismatch {
			case "owner":
				result.OwnerID = "other"
			case "workspace":
				result.WorkspaceID = "other"
			case "session":
				result.SessionID = "other"
			case "revision":
				result.Revision.SessionID = "other"
			case "candidate":
				result.Revision.Candidate = model.JSONB(`{"assets":[{"name":"Actor"}]}`)
			}
			body, _ := json.Marshal(result)
			if err := receipts.Complete(context.Background(), binding, GenerationReceiptResult{ContentType: "application/json", Body: body}); err != nil {
				t.Fatal(err)
			}
			svc := NewComicAssetService(repo, nil)
			svc.SetAnalysisReceiptService(receipts)
			if _, err := svc.GetAnalysisSession(session.ID, "other", WorkspaceScopePersonal); !errors.Is(err, repository.ErrComicAnalysisSessionNotFound) {
				t.Fatalf("foreign scope=%v", err)
			}
			if _, err := svc.GetAnalysisSession(session.ID, session.OwnerID, WorkspaceScopePersonal); !errors.Is(err, ErrGenerationReceiptConflict) {
				t.Fatalf("mismatch=%v", err)
			}
			saved, revisions, _ := repo.GetAnalysisSession(session.ID, session.WorkspaceID)
			if saved.Status != model.ComicAnalysisStatusProcessing || len(revisions) != 0 {
				t.Fatal("mismatched receipt changed session")
			}
		})
	}
}
