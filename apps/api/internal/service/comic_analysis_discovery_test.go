package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/repository"
)

func TestComicAnalysisDiscoveryPaginationOwnerIsolationAndNoGeneration(t *testing.T) {
	repo := repository.NewMemoryComicAssetRepository()
	svc := NewComicAssetService(repo, nil)
	svc.SetTextGenerator(func(context.Context, string, string, provider.TextGenerationRequest) (provider.TextResponse, error) {
		t.Fatal("listing submitted a model call")
		return provider.TextResponse{}, nil
	})
	workspace := WorkspaceIDForScope(WorkspaceScopeTeam, "owner")
	for i := 0; i < 26; i++ {
		owner, expires := "owner", time.Now().Add(time.Hour)
		if i == 24 {
			owner = "other"
		}
		if i == 25 {
			expires = time.Now().Add(-time.Hour)
		}
		_, err := repo.CreatePendingAnalysisSession(model.ComicAssetAnalysisSession{ID: fmt.Sprintf("analysis-%02d", i), OwnerID: owner, WorkspaceID: workspace,
			Title: "Saved analysis", SourceText: "private source", SourceStorageKey: "private-path", AnalysisReceiptKey: "internal-execution",
			Status: model.ComicAnalysisStatusProcessing, ExpiresAt: expires})
		if err != nil {
			t.Fatal(err)
		}
	}
	first, err := svc.ListAnalysisSessions("owner", WorkspaceScopeTeam, "")
	if err != nil || len(first.Items) != ComicAnalysisDiscoveryPageSize || first.NextCursor == "" {
		t.Fatalf("first page=%+v error=%v", first, err)
	}
	second, err := svc.ListAnalysisSessions("owner", WorkspaceScopeTeam, first.NextCursor)
	if err != nil || len(second.Items) != 4 || second.NextCursor != "" {
		t.Fatalf("second page=%+v error=%v", second, err)
	}
	seen := map[string]bool{}
	for _, item := range append(first.Items, second.Items...) {
		if seen[item.ID] || item.ID == "analysis-24" || item.ID == "analysis-25" {
			t.Fatalf("duplicate or foreign item %s", item.ID)
		}
		seen[item.ID] = true
	}
	raw, _ := json.Marshal(first)
	for _, hidden := range []string{"private source", "private-path", "internal-execution", "source_text", "analysis_receipt"} {
		if strings.Contains(string(raw), hidden) {
			t.Fatalf("discovery disclosed %s", hidden)
		}
	}
	otherScope, err := svc.ListAnalysisSessions("owner", WorkspaceScopePersonal, "")
	if err != nil || len(otherScope.Items) != 0 {
		t.Fatal("workspace isolation failed")
	}
	otherOwner, err := svc.ListAnalysisSessions("other", WorkspaceScopeTeam, "")
	if err != nil || len(otherOwner.Items) != 1 || otherOwner.Items[0].ID != "analysis-24" {
		t.Fatal("shared workspace actor isolation failed")
	}
	for _, cursor := range []string{"bad", strings.Repeat("x", comicAnalysisCursorMaxBytes+1), "e30"} {
		if _, err := svc.ListAnalysisSessions("owner", WorkspaceScopeTeam, cursor); !errors.Is(err, ErrGenerationReceiptInvalid) {
			t.Fatalf("invalid cursor accepted: %v", err)
		}
	}
}
