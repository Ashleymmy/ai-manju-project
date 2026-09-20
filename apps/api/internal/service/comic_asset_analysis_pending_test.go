package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/storage"
)

func pendingAnalysisInput() CreateComicAnalysisSessionInput {
	return CreateComicAnalysisSessionInput{
		Async: true, CreateComicProjectInput: CreateComicProjectInput{Title: "Async test"},
		SourceType: "script", SourceFileName: "script.txt", Source: strings.NewReader("actor enters"),
		SourceText: "actor enters", RequestedModel: "test-model", InitialInstruction: "keep all actors",
	}
}

func waitPendingAnalysis(t *testing.T, fx comicServiceFixture, id string) ComicAnalysisDetail {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		detail, err := fx.service.GetAnalysisSession(id, fx.userID, WorkspaceScopePersonal)
		if err != nil {
			t.Fatal(err)
		}
		if detail.Session.Status != model.ComicAnalysisStatusProcessing {
			return detail
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("analysis did not settle")
	return ComicAnalysisDetail{}
}

func TestPendingAnalysisSurvivesUploadRequestCancellation(t *testing.T) {
	fx := newComicServiceFixture()
	store := storage.NewLocalFSStorage(t.TempDir())
	fx.service.SetSourceStorage(store)
	release := make(chan struct{})
	started := make(chan context.Context, 1)
	fx.service.SetTextGenerator(func(ctx context.Context, requested string, req provider.TextGenerationRequest) (provider.TextResponse, error) {
		started <- ctx
		<-release
		return provider.TextResponse{Model: requested, Text: `{"assets":[{"class":"character","name":"Actor"}]}`}, ctx.Err()
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	initial, err := fx.service.CreateAnalysisSession(ctx, fx.userID, WorkspaceScopePersonal, pendingAnalysisInput())
	if err != nil {
		close(release)
		t.Fatal(err)
	}
	if initial.Session.Status != model.ComicAnalysisStatusProcessing || len(initial.Revisions) != 0 {
		t.Fatalf("initial=%+v", initial)
	}
	background := <-started
	cancel()
	if background.Err() != nil {
		t.Fatal("upload cancellation canceled analysis")
	}
	if _, ok := background.Deadline(); !ok {
		t.Fatal("background task must be bounded")
	}
	if _, err := store.Stat(context.Background(), initial.Session.SourceStorageKey); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.service.GetAnalysisSession(initial.Session.ID, "other-user", WorkspaceScopePersonal); !errors.Is(err, repository.ErrComicAnalysisSessionNotFound) {
		t.Fatalf("scope error=%v", err)
	}
	close(release)
	finished := waitPendingAnalysis(t, fx, initial.Session.ID)
	if finished.Session.Status != model.ComicAnalysisStatusActive || len(finished.Revisions) != 1 || finished.Revisions[0].Version != 1 {
		t.Fatalf("finished=%+v", finished)
	}
	if _, err := fx.service.ConfirmAnalysisSession(finished.Session.ID, finished.Session.ActiveRevisionID, fx.userID, WorkspaceScopePersonal); err != nil {
		t.Fatal(err)
	}
}

func TestPendingAnalysisFailureRetainsSourceAndSanitizesErrors(t *testing.T) {
	for _, mode := range []string{"provider", "invalid-json", "panic", "timeout"} {
		t.Run(mode, func(t *testing.T) {
			fx := newComicServiceFixture()
			store := storage.NewLocalFSStorage(t.TempDir())
			fx.service.SetSourceStorage(store)
			fx.service.SetTextGenerator(func(context.Context, string, provider.TextGenerationRequest) (provider.TextResponse, error) {
				switch mode {
				case "provider":
					return provider.TextResponse{}, errors.New("private-provider-address")
				case "panic":
					panic("private-secret")
				case "timeout":
					return provider.TextResponse{}, context.DeadlineExceeded
				default:
					return provider.TextResponse{Text: "truncated"}, nil
				}
			})
			initial, err := fx.service.CreateAnalysisSession(context.Background(), fx.userID, WorkspaceScopePersonal, pendingAnalysisInput())
			if err != nil {
				t.Fatal(err)
			}
			finished := waitPendingAnalysis(t, fx, initial.Session.ID)
			if finished.Session.Status != model.ComicAnalysisStatusFailed || finished.Session.AnalysisError == "" || strings.Contains(finished.Session.AnalysisError, "private") || len(finished.Revisions) != 0 {
				t.Fatalf("failure=%+v", finished)
			}
			if _, err := store.Stat(context.Background(), finished.Session.SourceStorageKey); err != nil {
				t.Fatal(err)
			}
		})
	}
}

type staleAnalysisRepository struct {
	repository.ComicAssetRepository
}

func (r staleAnalysisRepository) GetAnalysisSession(id, workspace string) (model.ComicAssetAnalysisSession, []model.ComicAssetAnalysisRevision, error) {
	s, revisions, err := r.ComicAssetRepository.GetAnalysisSession(id, workspace)
	s.CreatedAt = time.Now().Add(-ComicAnalysisTaskTimeout - time.Minute)
	return s, revisions, err
}

func TestPendingAnalysisAfterProcessInterruptionStopsLookingBusy(t *testing.T) {
	repo := repository.NewMemoryComicAssetRepository()
	svc := NewComicAssetService(staleAnalysisRepository{repo}, nil)
	workspace := WorkspaceIDForScope(WorkspaceScopePersonal, "user")
	_, err := repo.CreatePendingAnalysisSession(model.ComicAssetAnalysisSession{ID: "abandoned", WorkspaceID: workspace, Status: model.ComicAnalysisStatusProcessing})
	if err != nil {
		t.Fatal(err)
	}
	detail, err := svc.GetAnalysisSession("abandoned", "user", WorkspaceScopePersonal)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Session.Status != model.ComicAnalysisStatusFailed || detail.Session.AnalysisError != comicAnalysisTimeoutMessage {
		t.Fatalf("detail=%+v", detail)
	}
}
