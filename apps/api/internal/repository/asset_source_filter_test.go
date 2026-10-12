package repository

import (
	"os"
	"reflect"
	"sort"
	"testing"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestAssetLibraryCanvasSourceIncludesCanvasSDVideos(t *testing.T) {
	check := func(t *testing.T, repo AssetRepository) {
		for _, asset := range []model.Asset{
			{ID: "canvas-image", SourceType: model.AssetSourceCanvas, SourceProjectID: "canvas_1"},
			{ID: "canvas-sd-video", SourceType: model.AssetSourceSDVideo, SourceProjectID: "canvas_1"},
			{ID: "loose-sd-video", SourceType: model.AssetSourceSDVideo},
			{ID: "workbench-video", SourceType: model.AssetSourceVideoWorkbench},
			{ID: "upload", SourceType: model.AssetSourceManualUpload},
		} {
			asset.WorkspaceID, asset.UserID, asset.Type, asset.Name = "source-qa", "qa", "video", asset.ID
			if _, err := repo.Create(asset); err != nil {
				t.Fatal(err)
			}
		}
		for sourceType, want := range map[string][]string{
			model.AssetSourceCanvas:         {"canvas-image", "canvas-sd-video"},
			model.AssetSourceSDVideo:        {"canvas-sd-video", "loose-sd-video"},
			model.AssetSourceVideoWorkbench: {"workbench-video"},
			model.AssetSourceManualUpload:   {"upload"},
		} {
			assets, total, err := repo.ListLibrary(AssetLibraryFilter{WorkspaceID: "source-qa", SourceType: sourceType, Unpaged: true})
			if err != nil {
				t.Fatal(err)
			}
			ids := make([]string, 0, len(assets))
			for _, asset := range assets {
				ids = append(ids, asset.ID)
			}
			sort.Strings(ids)
			if !reflect.DeepEqual(ids, want) || total != int64(len(want)) {
				t.Fatalf("source=%s ids=%v total=%d want=%v", sourceType, ids, total, want)
			}
		}
	}
	t.Run("memory", func(t *testing.T) { check(t, NewMemoryAssetRepository()) })
	t.Run("postgres", func(t *testing.T) {
		dsn := os.Getenv("ASSET_TEST_DATABASE_URL")
		if dsn == "" {
			t.Skip("ASSET_TEST_DATABASE_URL is not configured")
		}
		db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
		if err != nil {
			t.Fatal(err)
		}
		sqlDB, err := db.DB()
		if err != nil {
			t.Fatal(err)
		}
		defer sqlDB.Close()
		if err := db.AutoMigrate(&model.Asset{}); err != nil {
			t.Fatal(err)
		}
		tx := db.Begin()
		if tx.Error != nil {
			t.Fatal(tx.Error)
		}
		defer tx.Rollback()
		if err := tx.Exec("CREATE TEMP TABLE assets (LIKE assets INCLUDING ALL)").Error; err != nil {
			t.Fatal(err)
		}
		check(t, NewGormAssetRepository(tx))
	})
}
