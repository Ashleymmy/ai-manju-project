package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestAssetPackageMemory(t *testing.T) {
	assets := repository.NewMemoryAssetRepository()
	verifyPortableAssetPackage(t, assets, repository.NewMemoryAssetFolderRepository(), repository.NewMemoryAssetExportRepository(), repository.NewMemoryTagRepository(assets))
}

func TestAssetPackageGormPostgres(t *testing.T) {
	dsn := os.Getenv("ASSET_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("ASSET_TEST_DATABASE_URL is not configured")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Asset{}, &model.AssetFolder{}, &model.AssetExportBatch{}, &model.AssetExportItem{}, &model.Tag{}, &model.TagClosure{}, &model.TagAlias{}, &model.AssetTagBinding{}, &model.AssetTagOrigin{}); err != nil {
		t.Fatal(err)
	}
	tx := db.Begin()
	if tx.Error != nil {
		t.Fatal(tx.Error)
	}
	defer tx.Rollback()
	verifyPortableAssetPackage(t, repository.NewGormAssetRepository(tx), repository.NewGormAssetFolderRepository(tx), repository.NewGormAssetExportRepository(tx), repository.NewGormTagRepository(tx))
}

func verifyPortableAssetPackage(t *testing.T, assetRepo repository.AssetRepository, folderRepo repository.AssetFolderRepository, exportRepo repository.AssetExportRepository, tagRepo repository.TagRepository) {
	t.Helper()
	user, scope := "package_"+randomHex(6), WorkspaceScopePersonal
	store := storage.NewLocalFSStorage(t.TempDir())
	folders := NewAssetFolderService(folderRepo, assetRepo)
	assets := NewAssetService(assetRepo, store)
	tags := NewTagService(tagRepo, assetRepo)
	assets.SetFolderService(folders)
	assets.SetTagSyncer(tags)
	exports := NewAssetExportService(exportRepo, assets, folders, store)
	exports.SetTagService(tags)
	createFolder := func(name, parent string) model.AssetFolder {
		folder, err := folders.Create(user, scope, AssetFolderCreateInput{Name: name, ParentID: parent})
		if err != nil {
			t.Fatal(err)
		}
		return folder
	}
	parent := createFolder("外层", "")
	root := createFolder("1", parent.ID)
	child := createFolder("2:原名", root.ID)
	empty := createFolder("空目录", root.ID)
	tagRoot, err := tags.Create(user, scope, TagCreateInput{Name: "风格", AssetEnabled: true, ScopeType: model.TagScopeWorkspace})
	if err != nil {
		t.Fatal(err)
	}
	tag, err := tags.Create(user, scope, TagCreateInput{Name: "古风", ParentID: tagRoot.ID, AssetEnabled: true, ScopeType: model.TagScopeWorkspace})
	if err != nil {
		t.Fatal(err)
	}
	// Exceed the UI's page size: a directory export must include every page.
	for index := 0; index < 35; index++ {
		_, err := assets.Upload(context.Background(), AssetUploadInput{
			ID: fmt.Sprintf("%s_%d", user, index), UserID: user, Scope: scope, Type: "image", Name: "同名.png", Extension: ".png", ContentType: "image/png", SizeLimit: 1024,
			Reader: strings.NewReader(fmt.Sprintf("binary-%d", index)), Note: "角色备注", TagIDs: []string{tag.ID},
			Registration: AssetRegistrationContext{FolderID: child.ID, Category: model.AssetCategoryCharacter},
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	batch, err := exports.Create(user, scope, AssetExportCreateInput{SelectionMode: AssetExportSelectionFolder, FolderID: root.ID})
	if err != nil {
		t.Fatal(err)
	}
	if batch.Total != 35 {
		t.Fatalf("directory export count=%d", batch.Total)
	}
	if _, err := exports.Create("another-user", scope, AssetExportCreateInput{SelectionMode: AssetExportSelectionFolder, FolderID: root.ID}); err == nil {
		t.Fatal("foreign folder exported")
	}
	if err := exports.DispatchOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	entries := readAssetExportZip(t, exports, batch.ID, user, scope)
	var manifest assetPackageManifest
	if err := json.Unmarshal(entries[AssetPackageManifestName], &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.Version != AssetPackageVersion || len(manifest.Assets) != 35 || len(manifest.Files) != 35 || len(manifest.Folders) != 3 || len(manifest.Tags) != 2 {
		t.Fatalf("unexpected package: %+v", manifest)
	}
	for _, folder := range manifest.Folders {
		if folder.ID == root.ID && folder.ParentID != "" {
			t.Fatal("export root retained external parent")
		}
		if folder.ID == child.ID && (folder.Name != child.Name || folder.ParentID != root.ID) {
			t.Fatal("original child name/hierarchy was lost")
		}
	}
	for _, asset := range manifest.Assets {
		if asset.FolderID != child.ID || asset.Note != "角色备注" || asset.Category != model.AssetCategoryCharacter || len(asset.TagIDs) != 1 || asset.TagIDs[0] != tag.ID {
			t.Fatalf("metadata lost: %+v", asset)
		}
	}
	paths := map[string]bool{}
	for _, file := range manifest.Files {
		if paths[file.Path] || int64(len(entries[file.Path])) != file.Bytes {
			t.Fatalf("invalid/duplicate file: %+v", file)
		}
		paths[file.Path] = true
	}
	if strings.Contains(string(entries[AssetPackageManifestName]), "workspace_id") || strings.Contains(string(entries[AssetPackageManifestName]), "storage_key") {
		t.Fatal("internal ownership/storage metadata leaked into portable manifest")
	}
	emptyBatch, err := exports.Create(user, scope, AssetExportCreateInput{SelectionMode: AssetExportSelectionFolder, FolderID: empty.ID})
	if err != nil {
		t.Fatal(err)
	}
	if err := exports.DispatchOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	emptyEntries := readAssetExportZip(t, exports, emptyBatch.ID, user, scope)
	var emptyManifest assetPackageManifest
	if err := json.Unmarshal(emptyEntries[AssetPackageManifestName], &emptyManifest); err != nil {
		t.Fatal(err)
	}
	if len(emptyManifest.Folders) != 1 || len(emptyManifest.Assets) != 0 || emptyManifest.Folders[0].Name != empty.Name {
		t.Fatalf("empty folder not preserved: %+v", emptyManifest)
	}
}
