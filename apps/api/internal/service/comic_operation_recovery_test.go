package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/repository"
)

type comicOperationFailingRepository struct {
	repository.ComicAssetRepository
	fail, loseCommitReply bool
}

type comicOperationReceiptDatabaseOutage struct {
	repository.GenerationReceiptRepository
	unavailable bool
}

func (r *comicOperationReceiptDatabaseOutage) Find(ctx context.Context, userID, workspaceID, kind, key string) (model.GenerationReceipt, error) {
	if r.unavailable {
		return model.GenerationReceipt{}, errComicTestDatabaseOutage
	}
	return r.GenerationReceiptRepository.Find(ctx, userID, workspaceID, kind, key)
}

var errComicTestDatabaseOutage = errors.New("isolated database outage")

func (r *comicOperationFailingRepository) UpdateAssetPromptCandidate(asset model.ComicAsset, workspaceID string, expectedVersion int) (model.ComicAsset, error) {
	if r.fail {
		return model.ComicAsset{}, errComicTestDatabaseOutage
	}
	value, err := r.ComicAssetRepository.UpdateAssetPromptCandidate(asset, workspaceID, expectedVersion)
	if err == nil && r.loseCommitReply {
		return model.ComicAsset{}, errComicTestDatabaseOutage
	}
	return value, err
}

func (r *comicOperationFailingRepository) CreateAnalysisRevisionIfUnchanged(sessionID, workspaceID, activeID string, updatedAt time.Time, revision model.ComicAssetAnalysisRevision) (model.ComicAssetAnalysisSession, []model.ComicAssetAnalysisRevision, error) {
	if r.fail {
		return model.ComicAssetAnalysisSession{}, nil, errComicTestDatabaseOutage
	}
	session, revisions, err := r.ComicAssetRepository.CreateAnalysisRevisionIfUnchanged(sessionID, workspaceID, activeID, updatedAt, revision)
	if err == nil && r.loseCommitReply {
		return model.ComicAssetAnalysisSession{}, nil, errComicTestDatabaseOutage
	}
	return session, revisions, err
}

func comicOperationTestReceipt(t *testing.T, fx comicServiceFixture, kind string) (model.GenerationReceipt, *GenerationReceiptService, *receiptMemoryStorage) {
	t.Helper()
	store := newReceiptMemoryStorage()
	receipts := receiptService(repository.NewMemoryGenerationReceiptRepository(), store)
	fx.service.SetAnalysisReceiptService(receipts)
	receipt, fresh, err := receipts.Begin(context.Background(), GenerationReceiptScope{UserID: fx.userID, WorkspaceID: WorkspaceIDForScope(WorkspaceScopePersonal, fx.userID), Kind: kind, Key: "operation-key"}, receiptHash(t))
	if err != nil || !fresh {
		t.Fatalf("claim fresh=%v error=%v", fresh, err)
	}
	return receipt, receipts, store
}

func seedComicOperationSession(t *testing.T, fx comicServiceFixture) model.ComicAssetAnalysisSession {
	t.Helper()
	session, _, err := fx.comic.CreateAnalysisSession(model.ComicAssetAnalysisSession{
		ID: "operation-session", OwnerID: fx.userID, WorkspaceID: WorkspaceIDForScope(WorkspaceScopePersonal, fx.userID), Title: "Recovery", Status: model.ComicAnalysisStatusActive, ExpiresAt: time.Now().Add(time.Hour),
	}, model.ComicAssetAnalysisRevision{ID: "operation-initial", SessionID: "operation-session", Source: model.ComicAnalysisRevisionSourceInitial, Candidate: model.JSONB(`{"assets":[{"class":"character","name":"Actor"}]}`)})
	if err != nil {
		t.Fatal(err)
	}
	return session
}

func TestComicPromptCheckpointRecoversDatabaseFailureWithoutCallingModel(t *testing.T) {
	for _, operation := range []string{ComicPromptOperationOptimize, ComicPromptOperationMerge} {
		t.Run(operation, func(t *testing.T) {
			fx := newComicServiceFixture()
			project, asset := createComicProjectAsset(t, fx, "Recovery", "Actor")
			asset, err := fx.service.SavePrompt(project.ID, asset.ID, fx.userID, WorkspaceScopePersonal, SaveComicPromptInput{Content: "original base", Source: "manual"})
			if err != nil {
				t.Fatal(err)
			}
			binding, receipts, store := comicOperationTestReceipt(t, fx, model.GenerationReceiptKindComicPrompt)
			broken := &comicOperationFailingRepository{ComicAssetRepository: fx.comic, fail: true}
			fx.service.repo = broken
			calls := 0
			fx.service.SetTextGenerator(func(context.Context, string, string, provider.TextGenerationRequest) (provider.TextResponse, error) {
				calls++
				if operation == ComicPromptOperationMerge {
					return provider.TextResponse{Text: `{"prompt":"private recovered merged candidate","retained_from_source":["Actor"]}`, Model: "mock"}, nil
				}
				return provider.TextResponse{Text: "private recovered optimized candidate", Model: "mock"}, nil
			})
			_, err = fx.service.OptimizePrompt(WithComicOperationReceipt(context.Background(), binding), project.ID, asset.ID, fx.userID, WorkspaceScopePersonal, OptimizeComicPromptInput{Direction: "details", RequestedModel: "mock", Operation: operation, BaseContent: asset.DraftPrompt})
			if !errors.Is(err, errComicTestDatabaseOutage) || calls != 1 {
				t.Fatalf("error=%v calls=%d", err, calls)
			}
			for _, value := range store.objects {
				if strings.Contains(string(value), "private recovered") {
					t.Fatal("plaintext checkpoint stored")
				}
			}
			restarted := NewComicAssetService(fx.comic, nil)
			restarted.SetAnalysisReceiptService(receipts)
			for range 2 {
				recovery, err := restarted.RecoverComicOperation(context.Background(), binding)
				if err != nil || recovery == nil || recovery.Status != ComicOperationRecoveryApplied {
					t.Fatalf("recovery=%+v error=%v", recovery, err)
				}
				result := recovery.Result.(OptimizeComicPromptResult)
				if result.Asset.PromptVersion != asset.PromptVersion+1 || !strings.HasPrefix(result.Asset.DraftPrompt, "private recovered") {
					t.Fatalf("unexpected saved result: %+v", result)
				}
			}
			if calls != 1 {
				t.Fatalf("recovery called model: %d", calls)
			}
		})
	}
}

func TestComicPromptCheckpointPreservesConcurrentManualChanges(t *testing.T) {
	for _, mutation := range []string{"prompt", "source", "approved", "deleted"} {
		t.Run(mutation, func(t *testing.T) {
			fx := newComicServiceFixture()
			project, asset := createComicProjectAsset(t, fx, "Conflict", "Actor")
			binding, _, _ := comicOperationTestReceipt(t, fx, model.GenerationReceiptKindComicPrompt)
			fx.service.SetTextGenerator(func(context.Context, string, string, provider.TextGenerationRequest) (provider.TextResponse, error) {
				var err error
				switch mutation {
				case "prompt":
					_, err = fx.service.SavePrompt(project.ID, asset.ID, fx.userID, WorkspaceScopePersonal, SaveComicPromptInput{Content: "manual retained"})
				case "approved":
					_, err = fx.service.SavePrompt(project.ID, asset.ID, fx.userID, WorkspaceScopePersonal, SaveComicPromptInput{Content: "manual retained", Action: "approve"})
				case "source":
					_, err = fx.service.UpdateAsset(project.ID, asset.ID, fx.userID, WorkspaceScopePersonal, ComicAssetInput{SourcePrompt: strPointer("manual source retained")})
				case "deleted":
					err = fx.service.DeleteAsset(project.ID, asset.ID, fx.userID, WorkspaceScopePersonal)
				}
				if err != nil {
					t.Fatal(err)
				}
				return provider.TextResponse{Text: "retained candidate", Model: "mock"}, nil
			})
			_, err := fx.service.OptimizePrompt(WithComicOperationReceipt(context.Background(), binding), project.ID, asset.ID, fx.userID, WorkspaceScopePersonal, OptimizeComicPromptInput{Direction: "details", RequestedModel: "mock"})
			if !comicOperationMutationConflict(err) {
				t.Fatalf("expected conflict, got %v", err)
			}
			for range 2 {
				recovery, err := fx.service.RecoverComicOperation(context.Background(), binding)
				if err != nil || recovery == nil || recovery.Status != ComicOperationRecoveryConflict || recovery.Result != nil || recovery.Candidate.Prompt.Asset.DraftPrompt != "retained candidate" {
					t.Fatalf("recovery=%+v error=%v", recovery, err)
				}
			}
			current, err := fx.comic.GetAsset(project.ID, asset.ID, binding.WorkspaceID)
			if mutation == "deleted" {
				if !errors.Is(err, repository.ErrComicAssetNotFound) {
					t.Fatalf("deleted asset recreated: %v", err)
				}
				return
			}
			if err != nil || current.DraftPrompt == "retained candidate" {
				t.Fatalf("manual state overwritten: %+v error=%v", current, err)
			}
		})
	}
}

func TestComicOperationCheckpointLostCommitReplyRecognizesAlreadyAppliedOutput(t *testing.T) {
	for _, kind := range []string{model.GenerationReceiptKindComicPrompt, model.GenerationReceiptKindComicRevision} {
		t.Run(kind, func(t *testing.T) {
			fx := newComicServiceFixture()
			binding, _, _ := comicOperationTestReceipt(t, fx, kind)
			fx.service.repo = &comicOperationFailingRepository{ComicAssetRepository: fx.comic, loseCommitReply: true}
			fx.service.SetTextGenerator(func(context.Context, string, string, provider.TextGenerationRequest) (provider.TextResponse, error) {
				if kind == model.GenerationReceiptKindComicRevision {
					return provider.TextResponse{Text: `{"assets":[{"class":"character","name":"Generated Actor"}]}`}, nil
				}
				return provider.TextResponse{Text: "generated candidate"}, nil
			})
			if kind == model.GenerationReceiptKindComicRevision {
				session := seedComicOperationSession(t, fx)
				_, err := fx.service.CreateAnalysisRevision(WithComicOperationReceipt(context.Background(), binding), session.ID, fx.userID, WorkspaceScopePersonal, CreateComicAnalysisRevisionInput{Instruction: "details", RequestedModel: "mock"})
				if !errors.Is(err, errComicTestDatabaseOutage) {
					t.Fatal(err)
				}
				if _, _, err := fx.comic.SetActiveAnalysisRevision(session.ID, session.ActiveRevisionID, binding.WorkspaceID); err != nil {
					t.Fatal(err)
				}
			} else {
				project, asset := createComicProjectAsset(t, fx, "Recovery", "Actor")
				_, err := fx.service.OptimizePrompt(WithComicOperationReceipt(context.Background(), binding), project.ID, asset.ID, fx.userID, WorkspaceScopePersonal, OptimizeComicPromptInput{Direction: "details", RequestedModel: "mock"})
				if !errors.Is(err, errComicTestDatabaseOutage) {
					t.Fatal(err)
				}
				if _, err := fx.service.SavePrompt(project.ID, asset.ID, fx.userID, WorkspaceScopePersonal, SaveComicPromptInput{Content: "newer manual prompt"}); err != nil {
					t.Fatal(err)
				}
			}
			fx.service.repo = fx.comic
			recovery, err := fx.service.RecoverComicOperation(context.Background(), binding)
			if err != nil || recovery == nil || recovery.Status != ComicOperationRecoveryApplied {
				t.Fatalf("recovery=%+v error=%v", recovery, err)
			}
			if kind == model.GenerationReceiptKindComicRevision {
				result := recovery.Result.(ComicAnalysisDetail)
				if result.Session.ActiveRevisionID != "operation-initial" || len(result.Revisions) != 2 {
					t.Fatalf("reactivated old revision: %+v", result)
				}
			} else if recovery.Result.(OptimizeComicPromptResult).Asset.DraftPrompt != "newer manual prompt" {
				t.Fatal("overwrote newer manual prompt")
			}
		})
	}
}

func TestComicRevisionCheckpointRestoresAfterRestartAndRetainsConflictCandidate(t *testing.T) {
	for _, mutation := range []string{"none", "branch", "confirmed", "switch-back"} {
		t.Run(mutation, func(t *testing.T) {
			fx := newComicServiceFixture()
			session := seedComicOperationSession(t, fx)
			binding, receipts, _ := comicOperationTestReceipt(t, fx, model.GenerationReceiptKindComicRevision)
			broken := &comicOperationFailingRepository{ComicAssetRepository: fx.comic, fail: true}
			fx.service.repo = broken
			calls := 0
			fx.service.SetTextGenerator(func(context.Context, string, string, provider.TextGenerationRequest) (provider.TextResponse, error) {
				calls++
				return provider.TextResponse{Text: `{"assets":[{"class":"character","name":"Preserved candidate"}]}`}, nil
			})
			_, err := fx.service.CreateAnalysisRevision(WithComicOperationReceipt(context.Background(), binding), session.ID, fx.userID, WorkspaceScopePersonal, CreateComicAnalysisRevisionInput{Instruction: "details", RequestedModel: "mock"})
			if !errors.Is(err, errComicTestDatabaseOutage) {
				t.Fatal(err)
			}
			fx.service.repo = fx.comic
			if mutation == "branch" || mutation == "switch-back" {
				_, err := fx.service.CreateAnalysisRevision(context.Background(), session.ID, fx.userID, WorkspaceScopePersonal, CreateComicAnalysisRevisionInput{Source: model.ComicAnalysisRevisionSourceManual, Candidate: &ComicAnalysisCandidateSnapshot{Assets: []ComicAnalysisCandidate{{Class: "character", Name: "Manual candidate"}}}})
				if err != nil {
					t.Fatal(err)
				}
				if mutation == "switch-back" {
					if _, _, err := fx.comic.SetActiveAnalysisRevision(session.ID, session.ActiveRevisionID, binding.WorkspaceID); err != nil {
						t.Fatal(err)
					}
				}
			} else if mutation == "confirmed" {
				if _, err := fx.service.ConfirmAnalysisSession(session.ID, session.ActiveRevisionID, fx.userID, WorkspaceScopePersonal); err != nil {
					t.Fatal(err)
				}
			}
			restarted := NewComicAssetService(fx.comic, nil)
			restarted.SetAnalysisReceiptService(receipts)
			for range 2 {
				recovery, err := restarted.RecoverComicOperation(context.Background(), binding)
				if err != nil || recovery == nil {
					t.Fatalf("recovery=%+v error=%v", recovery, err)
				}
				if mutation == "none" {
					if recovery.Status != ComicOperationRecoveryApplied || len(recovery.Result.(ComicAnalysisDetail).Revisions) != 2 {
						t.Fatalf("not restored: %+v", recovery)
					}
				} else if recovery.Status != ComicOperationRecoveryConflict || recovery.Result != nil || !strings.Contains(string(recovery.Candidate.Revision.Candidate), "Preserved candidate") {
					t.Fatalf("conflict lost candidate: %+v", recovery)
				}
			}
			if calls != 1 {
				t.Fatalf("model repeated %d times", calls)
			}
		})
	}
}

func TestComicOperationCheckpointRejectsCrossAccountAndMalformedBinding(t *testing.T) {
	fx := newComicServiceFixture()
	project, asset := createComicProjectAsset(t, fx, "Recovery", "Actor")
	binding, _, _ := comicOperationTestReceipt(t, fx, model.GenerationReceiptKindComicPrompt)
	fx.service.SetTextGenerator(func(context.Context, string, string, provider.TextGenerationRequest) (provider.TextResponse, error) {
		return provider.TextResponse{Text: "private candidate"}, nil
	})
	fx.service.repo = &comicOperationFailingRepository{ComicAssetRepository: fx.comic, fail: true}
	_, _ = fx.service.OptimizePrompt(WithComicOperationReceipt(context.Background(), binding), project.ID, asset.ID, fx.userID, WorkspaceScopePersonal, OptimizeComicPromptInput{Direction: "details", RequestedModel: "mock"})
	for _, field := range []string{"user", "workspace", "id", "kind"} {
		forged := binding
		switch field {
		case "user":
			forged.UserID = "other"
		case "workspace":
			forged.WorkspaceID = "default:other"
		case "id":
			forged.ID = "other"
		case "kind":
			forged.Kind = model.GenerationReceiptKindComicRevision
		}
		recovery, err := fx.service.RecoverComicOperation(context.Background(), forged)
		if recovery != nil || (err != nil && !errors.Is(err, ErrGenerationReceiptConflict)) {
			t.Fatalf("forged %s binding recovery=%+v error=%v", field, recovery, err)
		}
	}
	_, output, err := fx.service.analysisReceipts.Lookup(context.Background(), comicOperationCheckpointScope(binding))
	if err != nil || output == nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if json.Unmarshal(output.Body, &decoded) != nil || decoded["execution_token"] != nil {
		t.Fatal("checkpoint exposed execution token")
	}
}

func TestComicRevisionRejectsStalePreconditionBeforePaidCall(t *testing.T) {
	fx := newComicServiceFixture()
	session := seedComicOperationSession(t, fx)
	fx.service.SetTextGenerator(func(context.Context, string, string, provider.TextGenerationRequest) (provider.TextResponse, error) {
		t.Fatal("model called for stale precondition")
		return provider.TextResponse{}, nil
	})
	_, err := fx.service.CreateAnalysisRevision(context.Background(), session.ID, fx.userID, WorkspaceScopePersonal, CreateComicAnalysisRevisionInput{Instruction: "details", RequestedModel: "mock", ExpectedActiveRevisionID: "stale"})
	if !errors.Is(err, repository.ErrComicAssetConflict) {
		t.Fatal(err)
	}
}

func TestComicOperationConcurrentRecoveryAppliesCandidateExactlyOnce(t *testing.T) {
	for _, kind := range []string{model.GenerationReceiptKindComicPrompt, model.GenerationReceiptKindComicRevision} {
		t.Run(kind, func(t *testing.T) {
			fx := newComicServiceFixture()
			binding, receipts, _ := comicOperationTestReceipt(t, fx, kind)
			fx.service.repo = &comicOperationFailingRepository{ComicAssetRepository: fx.comic, fail: true}
			fx.service.SetTextGenerator(func(context.Context, string, string, provider.TextGenerationRequest) (provider.TextResponse, error) {
				if kind == model.GenerationReceiptKindComicRevision {
					return provider.TextResponse{Text: `{"assets":[{"class":"character","name":"Generated"}]}`}, nil
				}
				return provider.TextResponse{Text: "generated candidate"}, nil
			})
			if kind == model.GenerationReceiptKindComicRevision {
				session := seedComicOperationSession(t, fx)
				_, _ = fx.service.CreateAnalysisRevision(WithComicOperationReceipt(context.Background(), binding), session.ID, fx.userID, WorkspaceScopePersonal, CreateComicAnalysisRevisionInput{Instruction: "details", RequestedModel: "mock"})
			} else {
				project, asset := createComicProjectAsset(t, fx, "Concurrent", "Actor")
				_, _ = fx.service.OptimizePrompt(WithComicOperationReceipt(context.Background(), binding), project.ID, asset.ID, fx.userID, WorkspaceScopePersonal, OptimizeComicPromptInput{Direction: "details", RequestedModel: "mock"})
			}
			restarted := NewComicAssetService(fx.comic, nil)
			restarted.SetAnalysisReceiptService(receipts)
			var wait sync.WaitGroup
			for range 16 {
				wait.Add(1)
				go func() {
					defer wait.Done()
					recovery, err := restarted.RecoverComicOperation(context.Background(), binding)
					if err != nil || recovery == nil || recovery.Status != ComicOperationRecoveryApplied {
						t.Errorf("parallel recovery=%+v error=%v", recovery, err)
						return
					}
					if kind == model.GenerationReceiptKindComicRevision {
						if len(recovery.Result.(ComicAnalysisDetail).Revisions) != 2 {
							t.Error("duplicate revision")
						}
					} else if recovery.Result.(OptimizeComicPromptResult).Asset.PromptVersion != 1 {
						t.Error("duplicate prompt revision")
					}
				}()
			}
			wait.Wait()
		})
	}
}

func TestComicOperationRetainsCheckpointDuringReceiptDatabaseOutage(t *testing.T) {
	fx := newComicServiceFixture()
	project, asset := createComicProjectAsset(t, fx, "Outage", "Actor")
	repo := &comicOperationReceiptDatabaseOutage{GenerationReceiptRepository: repository.NewMemoryGenerationReceiptRepository()}
	store := newReceiptMemoryStorage()
	receipts := receiptService(repo, store)
	fx.service.SetAnalysisReceiptService(receipts)
	binding, _, err := receipts.Begin(context.Background(), GenerationReceiptScope{UserID: fx.userID, WorkspaceID: WorkspaceIDForScope(WorkspaceScopePersonal, fx.userID), Kind: model.GenerationReceiptKindComicPrompt, Key: "full-db-outage"}, receiptHash(t))
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	fx.service.SetTextGenerator(func(context.Context, string, string, provider.TextGenerationRequest) (provider.TextResponse, error) {
		calls++
		repo.unavailable = true
		return provider.TextResponse{Text: "output survived database outage"}, nil
	})
	_, err = fx.service.OptimizePrompt(WithComicOperationReceipt(context.Background(), binding), project.ID, asset.ID, fx.userID, WorkspaceScopePersonal, OptimizeComicPromptInput{Direction: "details", RequestedModel: "mock"})
	if !errors.Is(err, ErrGenerationReceiptUnavailable) {
		t.Fatalf("expected pending persistence, got %v", err)
	}
	current, _ := fx.comic.GetAsset(project.ID, asset.ID, binding.WorkspaceID)
	if current.PromptVersion != asset.PromptVersion {
		t.Fatal("applied without acknowledged checkpoint")
	}
	if len(store.objects) != 1 {
		t.Fatal("database outage discarded encrypted result")
	}
	repo.unavailable = false
	restarted := NewComicAssetService(fx.comic, nil)
	restarted.SetAnalysisReceiptService(receipts)
	recovery, err := restarted.RecoverComicOperation(context.Background(), binding)
	if err != nil || recovery == nil || recovery.Status != ComicOperationRecoveryApplied {
		t.Fatalf("recovery=%+v error=%v", recovery, err)
	}
	if calls != 1 || recovery.Result.(OptimizeComicPromptResult).Asset.DraftPrompt != "output survived database outage" {
		t.Fatal("lost or regenerated saved output")
	}
}
