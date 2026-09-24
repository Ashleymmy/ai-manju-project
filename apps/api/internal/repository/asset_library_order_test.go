package repository

import (
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestAssetLibraryTypeOrderBeforePaging(t *testing.T) {
	check := func(t *testing.T, repo AssetRepository) {
		created := time.Date(2026, 9, 24, 0, 0, 0, 0, time.UTC)
		for _, asset := range []model.Asset{
			{ID: "audio", Type: "audio"}, {ID: "video", Type: "video"},
			{ID: "image-a", Type: "image"}, {ID: "image-b", Type: "image"}, {ID: "text", Type: "text"},
		} {
			asset.WorkspaceID, asset.UserID, asset.Name, asset.FolderID = "order-qa", "qa", "素材（1）", "folder"
			asset.CreatedAt = created
			if _, err := repo.Create(asset); err != nil {
				t.Fatal(err)
			}
			// Equal timestamps exercise deterministic ties across page boundaries.
			if memory, ok := repo.(*MemoryAssetRepository); ok {
				stored := memory.assets[asset.ID]
				stored.CreatedAt = created
				memory.assets[asset.ID] = stored
			}
		}
		filter := AssetLibraryFilter{WorkspaceID: "order-qa", Sort: AssetLibrarySortTypeCreatedAtDesc, PageSize: 2}
		for _, filtered := range []bool{false, true} {
			filter.FilterFolder, filter.FolderIDs, filter.Keyword = filtered, []string{"folder"}, "素材"
			var ids []string
			for page := 1; page <= 3; page++ {
				filter.Page = page
				assets, total, err := repo.ListLibrary(filter)
				if err != nil || total != 5 {
					t.Fatalf("page=%d total=%d err=%v", page, total, err)
				}
				for _, asset := range assets {
					ids = append(ids, asset.ID)
				}
			}
			if want := []string{"text", "image-b", "image-a", "video", "audio"}; !reflect.DeepEqual(ids, want) {
				t.Fatalf("paged order=%v want=%v", ids, want)
			}
		}
		filter.FilterAssetIDs, filter.AssetIDs, filter.Page = true, []string{"audio", "image-a", "video"}, 1
		assets, total, err := repo.ListLibrary(filter)
		if err != nil || total != 3 || len(assets) != 2 || assets[0].ID != "image-a" || assets[1].ID != "video" {
			t.Fatalf("favorites order=%+v total=%d err=%v", assets, total, err)
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
