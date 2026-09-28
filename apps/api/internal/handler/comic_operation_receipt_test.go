package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/service"
)

// These requests use the real handlers and services, not just the receipt
// wrapper: state/version changes after a successful request must not cause a
// repeated model invocation when its client retries a lost response.
func TestComicOperationReceiptReplaysSavedRevisionAndPromptAfterStateChanges(t *testing.T) {
	repo := repository.NewMemoryComicAssetRepository()
	comicService := service.NewComicAssetService(repo, nil)
	calls := 0
	comicService.SetTextGenerator(func(_ context.Context, _, _ string, _ provider.TextGenerationRequest) (provider.TextResponse, error) {
		calls++
		if calls == 1 {
			return provider.TextResponse{Text: `{"assets":[{"class":"character","name":"Actor","source_prompt":"blue coat"}]}`, Model: "mock"}, nil
		}
		if calls == 2 {
			return provider.TextResponse{Text: "Actor in a blue coat, soft light", Model: "mock"}, nil
		}
		return provider.TextResponse{Text: `{"prompt":"Actor in a blue coat, soft light and rain","retained_from_source":["blue coat"]}`, Model: "mock"}, nil
	})
	workspace := service.WorkspaceIDForScope("personal", "owner")
	_, _, err := repo.CreateAnalysisSession(model.ComicAssetAnalysisSession{
		ID: "analysis-a", OwnerID: "owner", WorkspaceID: workspace, Title: "Test", Status: model.ComicAnalysisStatusActive, ExpiresAt: time.Now().Add(time.Hour),
	}, model.ComicAssetAnalysisRevision{ID: "initial-a", SessionID: "analysis-a", Source: model.ComicAnalysisRevisionSourceInitial, Candidate: model.JSONB(`{"assets":[{"class":"character","name":"Actor"}]}`)})
	if err != nil {
		t.Fatal(err)
	}
	project, err := comicService.CreateProject("owner", "personal", service.CreateComicProjectInput{Title: "Test"})
	if err != nil {
		t.Fatal(err)
	}
	class, name, source := "character", "Actor", "Actor in a blue coat"
	asset, err := comicService.CreateAsset(project.Project.ID, "owner", "personal", service.ComicAssetInput{Class: &class, Name: &name, SourcePrompt: &source})
	if err != nil {
		t.Fatal(err)
	}

	router, ai := receiptTestRouter(t, nil)
	comicService.SetAnalysisReceiptService(ai.receipts)
	ai.SetComicOperationRecoveryService(comicService)
	comic := NewComicAssetHandler(comicService)
	router.POST("/revisions/:sessionId", ai.WithGenerationReceiptResource(model.GenerationReceiptKindComicRevision, comic.CreateAnalysisRevision))
	router.POST("/prompts/:projectId/:assetId", ai.WithGenerationReceiptResource(model.GenerationReceiptKindComicPrompt, comic.OptimizePrompt))
	assertReplay := func(path, key, body string, initialStatus int, expectedCalls int) []byte {
		t.Helper()
		first := receiptRequest(router, http.MethodPost, path, key, body, "owner")
		if first.Code != initialStatus {
			t.Fatalf("initial request: status=%d body=%s", first.Code, first.Body.String())
		}
		for range 2 {
			repeat := receiptRequest(router, http.MethodPost, path, key, body, "owner")
			if repeat.Code != http.StatusOK || repeat.Body.String() != first.Body.String() || calls != expectedCalls {
				t.Fatalf("operation was repeated or output lost: status=%d calls=%d", repeat.Code, calls)
			}
		}
		return first.Body.Bytes()
	}
	assertReplay("/revisions/analysis-a", "revision-key", `{"source":"ai","model":"mock","instruction":"coat","parent_revision_id":"initial-a","expected_active_revision_id":"initial-a"}`, http.StatusCreated, 1)
	_, revisions, err := repo.GetAnalysisSession("analysis-a", workspace)
	if err != nil || len(revisions) != 2 {
		t.Fatalf("lost-response retry duplicated revisions: count=%d err=%v", len(revisions), err)
	}
	promptPath := "/prompts/" + project.Project.ID + "/" + asset.ID
	optimized := assertReplay(promptPath, "optimize-key", `{"model":"mock","direction":"soft light","operation":"optimize"}`, http.StatusOK, 2)
	var optimizedBody struct {
		Data service.OptimizeComicPromptResult `json:"data"`
	}
	if err := json.Unmarshal(optimized, &optimizedBody); err != nil {
		t.Fatal(err)
	}
	mergeInput, _ := json.Marshal(map[string]any{"model": "mock", "direction": "rain", "operation": "merge", "base_content": optimizedBody.Data.Asset.DraftPrompt, "expected_prompt_version": optimizedBody.Data.Asset.PromptVersion})
	merged := assertReplay(promptPath, "merge-key", string(mergeInput), http.StatusOK, 3)
	if !strings.Contains(string(merged), "rain") {
		t.Fatal("merge result lost")
	}
	saved, err := repo.GetAsset(project.Project.ID, asset.ID, workspace)
	if err != nil || saved.PromptVersion != optimizedBody.Data.Asset.PromptVersion+1 {
		t.Fatalf("lost-response retry duplicated prompt versions: version=%d err=%v", saved.PromptVersion, err)
	}
}

type comicOperationWriteFailureRepository struct {
	repository.ComicAssetRepository
	failPrompt bool
}

func (r *comicOperationWriteFailureRepository) UpdateAssetPromptCandidate(asset model.ComicAsset, workspaceID string, expected int) (model.ComicAsset, error) {
	if r.failPrompt {
		return model.ComicAsset{}, errors.New("simulated database outage")
	}
	return r.ComicAssetRepository.UpdateAssetPromptCandidate(asset, workspaceID, expected)
}

func TestComicOperationReceiptRepairsPersistenceAndPreservesConflictingCandidate(t *testing.T) {
	for _, conflict := range []bool{false, true} {
		name := "database_recovery"
		if conflict {
			name = "concurrent_edit"
		}
		t.Run(name, func(t *testing.T) {
			repo := &comicOperationWriteFailureRepository{ComicAssetRepository: repository.NewMemoryComicAssetRepository()}
			comicService := service.NewComicAssetService(repo, nil)
			router, ai := receiptTestRouter(t, nil)
			comicService.SetAnalysisReceiptService(ai.receipts)
			ai.SetComicOperationRecoveryService(comicService)
			comic := NewComicAssetHandler(comicService)
			router.POST("/prompts/:projectId/:assetId", ai.WithGenerationReceiptResource(model.GenerationReceiptKindComicPrompt, comic.OptimizePrompt))
			project, err := comicService.CreateProject("owner", "personal", service.CreateComicProjectInput{Title: "Recovery"})
			if err != nil {
				t.Fatal(err)
			}
			class, assetName, source := "character", "Actor", "blue coat"
			asset, err := comicService.CreateAsset(project.Project.ID, "owner", "personal", service.ComicAssetInput{Class: &class, Name: &assetName, SourcePrompt: &source})
			if err != nil {
				t.Fatal(err)
			}
			calls := 0
			comicService.SetTextGenerator(func(_ context.Context, _, _ string, _ provider.TextGenerationRequest) (provider.TextResponse, error) {
				calls++
				if conflict {
					edited := "user renamed the actor"
					if _, err := comicService.UpdateAsset(project.Project.ID, asset.ID, "owner", "personal", service.ComicAssetInput{Name: &edited}); err != nil {
						t.Fatal(err)
					}
				}
				return provider.TextResponse{Text: "original paid blue coat output", Model: "mock"}, nil
			})
			repo.failPrompt = !conflict
			path := "/prompts/" + project.Project.ID + "/" + asset.ID
			body := `{"model":"mock","direction":"soft light","operation":"optimize"}`
			first := receiptRequest(router, http.MethodPost, path, "save-key", body, "owner")
			if conflict && first.Code != http.StatusConflict || !conflict && first.Code != http.StatusServiceUnavailable {
				t.Fatalf("unexpected save failure response %d %s", first.Code, first.Body.String())
			}
			repo.failPrompt = false
			resultPath := "/receipts/comic_prompt/save-key/result"
			if other := receiptRequest(router, http.MethodGet, resultPath, "", "", "another-owner"); other.Code != http.StatusNotFound {
				t.Fatalf("another user accessed output: %d", other.Code)
			}
			for range 2 {
				recovered := receiptRequest(router, http.MethodGet, resultPath, "", "", "owner")
				want := http.StatusOK
				if conflict {
					want = http.StatusConflict
				}
				if recovered.Code != want || !strings.Contains(recovered.Body.String(), "original paid blue coat output") || calls != 1 {
					t.Fatalf("recovery lost/repeated model output: status=%d calls=%d body=%s", recovered.Code, calls, recovered.Body.String())
				}
				if conflict && (!strings.Contains(recovered.Body.String(), `"status":"uncertain"`) || !strings.Contains(recovered.Body.String(), `"candidate"`)) {
					t.Fatal("conflicting generated output was not retained separately")
				}
			}
			replayed := receiptRequest(router, http.MethodPost, path, "save-key", body, "owner")
			if calls != 1 || conflict && replayed.Code != http.StatusConflict || !conflict && replayed.Code != http.StatusOK {
				t.Fatalf("repeated model execution or lost final state: calls=%d status=%d", calls, replayed.Code)
			}
			saved, err := repo.GetAsset(project.Project.ID, asset.ID, service.WorkspaceIDForScope("personal", "owner"))
			if err != nil {
				t.Fatal(err)
			}
			if conflict && (saved.Name != "user renamed the actor" || saved.DraftPrompt != asset.DraftPrompt) {
				t.Fatalf("recovery overwrote user edit: %+v", saved)
			}
			if !conflict && (saved.DraftPrompt != "original paid blue coat output" || saved.PromptVersion != asset.PromptVersion+1) {
				t.Fatalf("candidate not applied exactly once: %+v", saved)
			}
		})
	}
}
