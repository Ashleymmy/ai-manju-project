package service

import (
	"fmt"
	"os"
	"sync"
	"testing"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestAssetFolderGormPostgresParity(t *testing.T) {
	dsn := os.Getenv("ASSET_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("ASSET_TEST_DATABASE_URL is not configured")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.AssetFolder{}, &model.Asset{}); err != nil {
		t.Fatal(err)
	}
	userID := "gorm_asset_" + randomHex(6)
	workspaceID := WorkspaceIDForScope(WorkspaceScopePersonal, userID)
	cleanup := func() {
		_ = db.Where("workspace_id = ?", workspaceID).Delete(&model.Asset{}).Error
		_ = db.Where("workspace_id = ?", workspaceID).Delete(&model.AssetFolder{}).Error
	}
	cleanup()
	t.Cleanup(cleanup)

	assetRepo := repository.NewGormAssetRepository(db)
	folderRepo := repository.NewGormAssetFolderRepository(db)
	folders := NewAssetFolderService(folderRepo, assetRepo)

	var wait sync.WaitGroup
	errorsByWorker := make(chan error, 12)
	for index := 0; index < 12; index++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			_, ensureErr := folders.EnsureDefaults(userID, WorkspaceScopePersonal)
			errorsByWorker <- ensureErr
		}()
	}
	wait.Wait()
	close(errorsByWorker)
	for ensureErr := range errorsByWorker {
		if ensureErr != nil {
			t.Fatalf("concurrent ensure defaults: %v", ensureErr)
		}
	}
	views, err := folders.List(userID, WorkspaceScopePersonal)
	if err != nil {
		t.Fatal(err)
	}
	if len(views) != 6 {
		t.Fatalf("default folders = %d, want 6", len(views))
	}

	parent, err := folders.Create(userID, WorkspaceScopePersonal, AssetFolderCreateInput{Name: "PostgreSQL 验证"})
	if err != nil {
		t.Fatal(err)
	}
	child, err := folders.EnsureCategoryChild(userID, WorkspaceScopePersonal, parent.ID, model.AssetCategoryCharacter)
	if err != nil {
		t.Fatal(err)
	}
	for index := 0; index < 150; index++ {
		_, err := assetRepo.Create(model.Asset{
			ID: fmt.Sprintf("asset_gorm_%s_%03d", userID, index), UserID: userID, WorkspaceID: workspaceID,
			Type: "image", Name: fmt.Sprintf("角色候选 %03d", index), URL: "/api/assets/gorm/content",
			FolderID: child.ID, Category: model.AssetCategoryCharacter, SourceType: model.AssetSourceComicBatch,
			SourceProjectID: "comic_gorm",
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	assetService := NewAssetService(assetRepo, nil)
	assetService.SetFolderService(folders)
	page, err := assetService.ListLibrary(userID, WorkspaceScopePersonal, AssetLibraryInput{
		FolderID: parent.ID, IncludeDescendants: true, Category: model.AssetCategoryCharacter,
		SourceType: model.AssetSourceComicBatch, SourceProjectID: "comic_gorm", Keyword: "角色候选", Page: 2, PageSize: 40,
	})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 150 || len(page.Items) != 40 {
		t.Fatalf("gorm library page total=%d items=%d", page.Total, len(page.Items))
	}
	if _, err := folders.Get(parent.ID, "different_user", WorkspaceScopePersonal); err != repository.ErrAssetFolderNotFound {
		t.Fatalf("gorm cross-workspace folder error = %v", err)
	}
	moved, err := folders.Delete(parent.ID, userID, WorkspaceScopePersonal)
	if err != nil || moved != 150 {
		t.Fatalf("gorm safe delete moved=%d err=%v", moved, err)
	}
}
