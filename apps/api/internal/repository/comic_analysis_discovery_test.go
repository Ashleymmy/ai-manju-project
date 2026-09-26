package repository

import (
	"os"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestComicAnalysisDiscoveryParity(t *testing.T) {
	t.Run("memory", func(t *testing.T) { testComicAnalysisDiscovery(t, NewMemoryComicAssetRepository()) })
	t.Run("postgres", func(t *testing.T) {
		dsn := os.Getenv("COMIC_ANALYSIS_TEST_DATABASE_URL")
		if dsn == "" {
			t.Skip("isolated database not configured")
		}
		db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
		if err != nil {
			t.Fatal(err)
		}
		if err := db.AutoMigrate(&model.ComicAssetAnalysisSession{}, &model.ComicAssetAnalysisRevision{}); err != nil {
			t.Fatal(err)
		}
		testComicAnalysisDiscovery(t, NewGormComicAssetRepository(db))
	})
}

func testComicAnalysisDiscovery(t *testing.T, repo ComicAssetRepository) {
	t.Helper()
	owner := "discovery_" + randomRepositoryHex(6)
	now := time.Now().UTC()
	workspace := "team:discovery"
	for _, name := range []string{"first", "second", "other", "expired"} {
		actor, expires := owner, now.Add(time.Hour)
		if name == "other" {
			actor += "_other"
		}
		if name == "expired" {
			expires = now.Add(-time.Hour)
		}
		_, err := repo.CreatePendingAnalysisSession(model.ComicAssetAnalysisSession{ID: owner + "_" + name, OwnerID: actor, WorkspaceID: workspace, Title: name,
			Status: model.ComicAnalysisStatusProcessing, ExpiresAt: expires, SourceText: "private source", SourceStorageKey: "private key", AnalysisReceiptKey: "private receipt"})
		if err != nil {
			t.Fatal(err)
		}
	}
	filter := ComicAnalysisListFilter{OwnerID: owner, WorkspaceID: workspace, Now: now, Limit: 1}
	first, err := repo.ListAnalysisSessions(filter)
	if err != nil || len(first) != 1 || first[0].Title != "second" {
		t.Fatalf("first=%+v err=%v", first, err)
	}
	if first[0].SourceText != "" || first[0].SourceStorageKey != "" || first[0].AnalysisReceiptKey != "" {
		t.Fatal("private fields read for list")
	}
	filter.BeforeCreatedAt, filter.BeforeID = first[0].CreatedAt, first[0].ID
	second, err := repo.ListAnalysisSessions(filter)
	if err != nil || len(second) != 1 || second[0].Title != "first" {
		t.Fatalf("second=%+v err=%v", second, err)
	}
	filter.BeforeCreatedAt, filter.BeforeID = second[0].CreatedAt, second[0].ID
	last, err := repo.ListAnalysisSessions(filter)
	if err != nil || len(last) != 0 {
		t.Fatalf("pagination included foreign/expired: %+v err=%v", last, err)
	}
}
