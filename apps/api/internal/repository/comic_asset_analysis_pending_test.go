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
	testAnalysisReceiptRecovery(t, repo)
}

func testAnalysisReceiptRecovery(t *testing.T, repo ComicAssetRepository) {
	t.Helper()
	now := time.Now().UTC()
	for _, mode := range []string{"processing", "failed", "owner", "workspace", "key", "legacy", "expired", "confirmed", "project", "confirmed-at", "active", "orphan-revision", "invalid-candidate", "wrong-source"} {
		t.Run("receipt-"+mode, func(t *testing.T) {
			session := model.ComicAssetAnalysisSession{ID: "receipt-" + mode, OwnerID: "owner", WorkspaceID: "receipt-workspace", Status: model.ComicAnalysisStatusProcessing,
				ExpiresAt: now.Add(time.Hour), AnalysisReceiptVersion: model.ComicAnalysisReceiptVersion, AnalysisReceiptKey: "key"}
			switch mode {
			case "legacy":
				session.AnalysisReceiptVersion = 0
			case "expired":
				session.ExpiresAt = now
			case "confirmed":
				session.ConfirmedRevisionID = "confirmed"
			case "project":
				session.ProjectID = "project"
			case "confirmed-at":
				session.ConfirmedAt = &now
			}
			if _, err := repo.CreatePendingAnalysisSession(session); err != nil {
				t.Fatal(err)
			}
			revision := model.ComicAssetAnalysisRevision{ID: "receipt-revision-" + mode, SessionID: session.ID, Source: model.ComicAnalysisRevisionSourceInitial, Candidate: model.JSONB(`{"assets":[{"class":"character","name":"Actor"}]}`)}
			if mode == "failed" {
				if err := repo.FinishPendingAnalysisSession(session.ID, session.WorkspaceID, nil, "timeout"); err != nil {
					t.Fatal(err)
				}
			}
			if mode == "active" {
				existing := revision
				existing.ID = "already-active"
				if err := repo.FinishPendingAnalysisSession(session.ID, session.WorkspaceID, &existing, ""); err != nil {
					t.Fatal(err)
				}
			}
			if mode == "orphan-revision" {
				orphan := revision
				orphan.ID, orphan.Version, orphan.CreatedAt = "orphan", 1, now
				switch target := repo.(type) {
				case *MemoryComicAssetRepository:
					target.mu.Lock()
					target.analysisRevisions[orphan.ID] = orphan
					target.mu.Unlock()
				case *GormComicAssetRepository:
					if err := target.db.Create(&orphan).Error; err != nil {
						t.Fatal(err)
					}
				}
			}
			workspace, owner, key := session.WorkspaceID, session.OwnerID, session.AnalysisReceiptKey
			switch mode {
			case "owner":
				owner = "other"
			case "workspace":
				workspace = "other"
			case "key":
				key = "other"
			case "invalid-candidate":
				revision.Candidate = model.JSONB(`{"assets":[]}`)
			case "wrong-source":
				revision.Source = model.ComicAnalysisRevisionSourceManual
			}
			err := repo.RecoverAnalysisSessionFromReceipt(session.ID, workspace, owner, key, revision, now)
			if mode != "processing" && mode != "failed" {
				if err == nil {
					t.Fatal("unsafe recovery accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			saved, revisions, err := repo.GetAnalysisSession(session.ID, session.WorkspaceID)
			if err != nil || saved.Status != model.ComicAnalysisStatusActive || saved.AnalysisError != "" || len(revisions) != 1 || revisions[0].Version != 1 {
				t.Fatalf("recovery=%+v revisions=%+v err=%v", saved, revisions, err)
			}
			if err := repo.RecoverAnalysisSessionFromReceipt(session.ID, workspace, owner, key, revision, now); !errors.Is(err, ErrComicAssetInvalidState) {
				t.Fatalf("cannot overwrite=%v", err)
			}
		})
	}
}
