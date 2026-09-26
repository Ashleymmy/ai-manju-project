package repository

import (
	"errors"
	"os"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestComicOperationCompareAndSwapParity(t *testing.T) {
	t.Run("memory", func(t *testing.T) { testComicOperationCompareAndSwap(t, NewMemoryComicAssetRepository()) })
	t.Run("postgres", func(t *testing.T) {
		dsn := os.Getenv("COMIC_ANALYSIS_TEST_DATABASE_URL")
		if dsn == "" {
			t.Skip("COMIC_ANALYSIS_TEST_DATABASE_URL is not configured")
		}
		db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
		if err != nil {
			t.Fatal(err)
		}
		if err := db.AutoMigrate(&model.ComicAssetProject{}, &model.ComicAsset{}, &model.ComicAssetAnalysisSession{}, &model.ComicAssetAnalysisRevision{}); err != nil {
			t.Fatal(err)
		}
		testComicOperationCompareAndSwap(t, NewGormComicAssetRepository(db))
	})
}

func testComicOperationCompareAndSwap(t *testing.T, repo ComicAssetRepository) {
	t.Helper()
	prefix := "comic_cas_" + randomRepositoryHex(8)
	workspace := "default:" + prefix
	_, err := repo.CreateProject(model.ComicAssetProject{ID: prefix, WorkspaceID: workspace, OwnerID: prefix, Title: "CAS"})
	if err != nil {
		t.Fatal(err)
	}
	asset, err := repo.CreateAsset(model.ComicAsset{ID: prefix + "_asset", ProjectID: prefix, Code: "C1", Class: model.ComicAssetClassCharacter, Name: "Original", PromptStatus: model.ComicPromptStatusDraft, PromptWarnings: model.JSONB("[]"), PromptRevisions: model.JSONB("[]"), Outputs: model.JSONB(`[{ "asset_id": "existing", "version": 1 }]`)}, workspace)
	if err != nil {
		t.Fatal(err)
	}
	// Reload for the exact precision/normalization of the backing store.
	asset, err = repo.GetAsset(prefix, asset.ID, workspace)
	if err != nil {
		t.Fatal(err)
	}
	proposal := asset
	proposal.DraftPrompt, proposal.PromptStatus, proposal.PromptVersion = "Generated", model.ComicPromptStatusNeedsReview, asset.PromptVersion+1
	proposal.Outputs = model.JSONB(`[{"version":1,"asset_id":"existing"}]`)
	updated, err := repo.UpdateAssetPromptCandidate(proposal, workspace, asset.PromptVersion)
	if err != nil {
		t.Fatalf("JSON normalization changed CAS: %v", err)
	}
	if !updated.UpdatedAt.After(asset.UpdatedAt) {
		t.Fatal("timestamp did not advance")
	}
	asset, err = repo.GetAsset(prefix, asset.ID, workspace)
	if err != nil {
		t.Fatal(err)
	}
	proposal = asset
	proposal.DraftPrompt, proposal.PromptVersion = "Would overwrite", asset.PromptVersion+1
	asset.Name = "Manual retained"
	if _, err := repo.UpdateAsset(asset, workspace); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpdateAssetPromptCandidate(proposal, workspace, asset.PromptVersion); !errors.Is(err, ErrComicAssetConflict) {
		t.Fatalf("metadata overwrite accepted: %v", err)
	}
	if _, err := repo.UpdateAsset(proposal, workspace); !errors.Is(err, ErrComicAssetConflict) {
		t.Fatalf("stale manual update overwrote a newer saved result: %v", err)
	}
	if _, err := repo.UpdateAssetPromptCandidate(proposal, "default:other", asset.PromptVersion); !errors.Is(err, ErrComicAssetProjectNotFound) {
		t.Fatalf("workspace mismatch accepted: %v", err)
	}

	sessionID, initialID := prefix+"_session", prefix+"_initial"
	session, _, err := repo.CreateAnalysisSession(model.ComicAssetAnalysisSession{ID: sessionID, OwnerID: prefix, WorkspaceID: workspace, Title: "CAS", Status: model.ComicAnalysisStatusActive, ExpiresAt: time.Now().Add(time.Hour)}, model.ComicAssetAnalysisRevision{ID: initialID, SessionID: sessionID, Source: model.ComicAnalysisRevisionSourceInitial, Candidate: model.JSONB(`{"assets":[{"class":"character","name":"Actor"}]}`)})
	if err != nil {
		t.Fatal(err)
	}
	session, _, err = repo.GetAnalysisSession(sessionID, workspace)
	if err != nil {
		t.Fatal(err)
	}
	branchID := prefix + "_branch"
	if _, _, err := repo.CreateAnalysisRevisionIfUnchanged(sessionID, workspace, initialID, session.UpdatedAt, model.ComicAssetAnalysisRevision{ID: branchID, SessionID: sessionID, ParentRevisionID: initialID, Source: model.ComicAnalysisRevisionSourceManual, Candidate: model.JSONB(`{"assets":[{"class":"character","name":"Manual"}]}`)}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.SetActiveAnalysisRevision(sessionID, initialID, workspace); err != nil {
		t.Fatal(err)
	}
	_, _, err = repo.CreateAnalysisRevisionIfUnchanged(sessionID, workspace, initialID, session.UpdatedAt, model.ComicAssetAnalysisRevision{ID: prefix + "_stale", SessionID: sessionID, ParentRevisionID: initialID, Source: model.ComicAnalysisRevisionSourceAI, Candidate: model.JSONB(`{"assets":[{"class":"character","name":"Generated"}]}`)})
	if !errors.Is(err, ErrComicAssetConflict) {
		t.Fatalf("ABA revision switch allowed stale candidate: %v", err)
	}
}

func TestComicPromptCandidateDetectsChangesWithinSameTimestamp(t *testing.T) {
	current := model.ComicAsset{Name: "Original", Outputs: model.JSONB(`[]`)}
	proposed := current
	proposed.DraftPrompt = "Generated"
	if !comicPromptSnapshotMatches(current, proposed) {
		t.Fatal("valid draft replacement rejected")
	}
	current.SourcePrompt = "Concurrent manual source"
	if comicPromptSnapshotMatches(current, proposed) {
		t.Fatal("same-clock metadata edit was overwritten")
	}
	current.SourcePrompt = proposed.SourcePrompt
	current.Outputs = model.JSONB(`[{"asset_id":"new"}]`)
	if comicPromptSnapshotMatches(current, proposed) {
		t.Fatal("same-clock generation output was overwritten")
	}
}
