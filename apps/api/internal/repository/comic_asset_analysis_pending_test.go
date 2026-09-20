package repository

import (
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestPendingAnalysisRepositoryParity(t *testing.T) {
	t.Run("memory", func(t *testing.T) { testPendingAnalysisRepository(t, NewMemoryComicAssetRepository()) })
	t.Run("postgres", func(t *testing.T) {
		dsn := os.Getenv("COMIC_ANALYSIS_TEST_DATABASE_URL")
		if dsn == "" {
			t.Skip("COMIC_ANALYSIS_TEST_DATABASE_URL is not configured")
		}
		db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
		if err != nil {
			t.Fatal(err)
		}
		if err := db.AutoMigrate(&model.ComicAssetAnalysisSession{}, &model.ComicAssetAnalysisRevision{}); err != nil {
			t.Fatal(err)
		}
		testPendingAnalysisRepository(t, NewGormComicAssetRepository(db))
	})
}

func testPendingAnalysisRepository(t *testing.T, repo ComicAssetRepository) {
	t.Helper()
	const workspace = "pending-parity"
	newPending := func(id string) model.ComicAssetAnalysisSession {
		s, err := repo.CreatePendingAnalysisSession(model.ComicAssetAnalysisSession{ID: id, WorkspaceID: workspace, Status: model.ComicAnalysisStatusProcessing, ExpiresAt: time.Now().Add(-time.Hour)})
		if err != nil {
			t.Fatal(err)
		}
		return s
	}
	s := newPending("pending-success")
	if _, err := repo.CreatePendingAnalysisSession(s); !errors.Is(err, ErrComicAssetConflict) {
		t.Fatalf("duplicate=%v", err)
	}
	if err := repo.FinishPendingAnalysisSession(s.ID, "other", nil, "failed"); !errors.Is(err, ErrComicAnalysisSessionNotFound) {
		t.Fatalf("scope=%v", err)
	}
	if err := repo.FinishPendingAnalysisSession(s.ID, workspace, &model.ComicAssetAnalysisRevision{ID: "wrong-session", SessionID: "other"}, ""); !errors.Is(err, ErrComicAssetConflict) {
		t.Fatalf("mismatch=%v", err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, id := range []string{"revision-a", "revision-b"} {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			results <- repo.FinishPendingAnalysisSession(s.ID, workspace, &model.ComicAssetAnalysisRevision{ID: id, SessionID: s.ID, Source: model.ComicAnalysisRevisionSourceInitial, Candidate: model.JSONB(`{"assets":[]}`)}, "")
		}(id)
	}
	wg.Wait()
	close(results)
	winners := 0
	for err := range results {
		if err == nil {
			winners++
		} else if !errors.Is(err, ErrComicAssetInvalidState) {
			t.Fatal(err)
		}
	}
	completed, revisions, err := repo.GetAnalysisSession(s.ID, workspace)
	if err != nil || winners != 1 || completed.Status != model.ComicAnalysisStatusActive || len(revisions) != 1 || revisions[0].Version != 1 {
		t.Fatalf("completion=%+v revisions=%+v winners=%d err=%v", completed, revisions, winners, err)
	}
	s = newPending("pending-failed")
	if err := repo.FinishPendingAnalysisSession(s.ID, workspace, nil, "safe message"); err != nil {
		t.Fatal(err)
	}
	failed, revisions, err := repo.GetAnalysisSession(s.ID, workspace)
	if err != nil || failed.Status != model.ComicAnalysisStatusFailed || failed.AnalysisError != "safe message" || len(revisions) != 0 {
		t.Fatalf("failed=%+v err=%v", failed, err)
	}
	newPending("pending-abandoned")
	expired, err := repo.ListExpiredAnalysisSessions(time.Now())
	if err != nil || len(expired) != 3 {
		t.Fatalf("expired=%v err=%v", expired, err)
	}
	for _, session := range expired {
		if err := repo.DeleteExpiredAnalysisSession(session.ID, time.Now()); err != nil {
			t.Fatal(err)
		}
		if _, _, err := repo.GetAnalysisSession(session.ID, workspace); !errors.Is(err, ErrComicAnalysisSessionNotFound) {
			t.Fatalf("cleanup=%v", err)
		}
	}
}
