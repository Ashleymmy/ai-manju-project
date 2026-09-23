package service

import (
	"errors"
	"os"
	"testing"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestImportDefinitionsReplayAndIsolateKeys(t *testing.T) {
	fx := newAssetFolderFixture()
	tags := NewTagService(repository.NewMemoryTagRepository(fx.assets), fx.assets)
	t.Run("memory", func(t *testing.T) { checkImportDefinitions(t, fx.service, tags) })
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
		tx := db.Begin()
		if tx.Error != nil {
			t.Fatal(tx.Error)
		}
		defer tx.Rollback()
		// A transactional schema keeps this parity test isolated from other tests.
		schema := "import_test_" + randomHex(6)
		if err := tx.Exec("CREATE SCHEMA " + schema).Error; err != nil {
			t.Fatal(err)
		}
		if err := tx.Exec("SET LOCAL search_path TO " + schema).Error; err != nil {
			t.Fatal(err)
		}
		if err := tx.AutoMigrate(&model.AssetFolder{}, &model.Tag{}, &model.TagClosure{}); err != nil {
			t.Fatal(err)
		}
		checkImportDefinitions(t, NewAssetFolderService(repository.NewGormAssetFolderRepository(tx), fx.assets), NewTagService(repository.NewGormTagRepository(tx), fx.assets))
	})
}

func checkImportDefinitions(t *testing.T, folders *AssetFolderService, tags *TagService) {
	t.Helper()
	folderInput := AssetFolderCreateInput{Name: "import folder", IdempotencyKey: "session:folder"}
	tagInput := TagCreateInput{Name: "import tag", AssetEnabled: true, IdempotencyKey: "session:tag"}
	firstFolder, err := folders.Create("a", "personal", folderInput)
	if err != nil {
		t.Fatal(err)
	}
	firstTag, err := tags.Create("a", "personal", tagInput)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		folder, err := folders.Create("a", "personal", folderInput)
		if err != nil || folder.ID != firstFolder.ID {
			t.Fatalf("folder replay: %+v %v", folder, err)
		}
		tag, err := tags.Create("a", "personal", tagInput)
		if err != nil || tag.ID != firstTag.ID {
			t.Fatalf("tag replay: %+v %v", tag, err)
		}
	}
	for _, scope := range []string{"personal", "team"} {
		folder, err := folders.Create("b", scope, folderInput)
		if err != nil || folder.ID == firstFolder.ID {
			t.Fatalf("folder scope: %+v %v", folder, err)
		}
		tag, err := tags.Create("b", scope, tagInput)
		if err != nil || tag.ID == firstTag.ID {
			t.Fatalf("tag scope: %+v %v", tag, err)
		}
	}
	// A new import still respects sibling-name conflicts rather than merging.
	tagInput.IdempotencyKey = "other-session"
	if _, err := tags.Create("a", "personal", tagInput); !errors.Is(err, repository.ErrTagConflict) {
		t.Fatalf("expected tag name conflict, got %v", err)
	}
	folderInput.IdempotencyKey = "other-session"
	if _, err := folders.Create("a", "personal", folderInput); !errors.Is(err, repository.ErrAssetFolderConflict) {
		t.Fatalf("expected folder name conflict, got %v", err)
	}
}
