package handler

import (
	"context"
	"encoding/json"
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
