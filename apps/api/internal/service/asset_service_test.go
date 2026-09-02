package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/storage"
)

func TestAssetServiceIdempotentIngestionHashesContentAndRecordsLineage(t *testing.T) {
	assetRepo := repository.NewMemoryAssetRepository()
	tagRepo := repository.NewMemoryTagRepository(assetRepo)
	lineageRepo := repository.NewMemoryAssetLineageRepository()
	lineageService := NewAssetLineageService(lineageRepo, assetRepo, tagRepo)
	svc := NewAssetService(assetRepo, storage.NewLocalFSStorage(t.TempDir()))
	svc.SetTagSyncer(NewTagService(tagRepo, assetRepo))
	svc.SetLineageService(lineageService)
	ctx := context.Background()
	parent, err := svc.Upload(ctx, AssetUploadInput{ID: "parent", UserID: "user_a", Scope: WorkspaceScopePersonal, Type: "image", Name: "parent.png", Extension: ".png", SizeLimit: 1024, ContentType: "image/png", Reader: bytes.NewReader([]byte("parent")), Tags: []string{"人物"}})
	if err != nil {
		t.Fatal(err)
	}
	input := AssetUploadInput{ID: "ignored", UserID: "user_a", Scope: WorkspaceScopePersonal, Type: "image", Name: "child.png", Extension: ".png", SizeLimit: 1024, ContentType: "image/png", Reader: bytes.NewReader([]byte("child-v1")), ParentAssetIDs: []string{parent.ID}, RelationType: model.AssetLineageCrop, IngestionMode: model.AssetIngestionAutomatic, IdempotencyKey: "canvas:project:node:version-1"}
	child, err := svc.Upload(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	wantHash := sha256.Sum256([]byte("child-v1"))
	if child.ContentSHA256 != hex.EncodeToString(wantHash[:]) || child.IngestionMode != model.AssetIngestionAutomatic {
		t.Fatalf("child metadata = %+v", child)
	}
	input.Reader = bytes.NewReader([]byte("child-v2-must-not-overwrite"))
	repeated, err := svc.Upload(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	if repeated.ID != child.ID || repeated.ContentSHA256 != child.ContentSHA256 {
		t.Fatalf("idempotent result = %+v", repeated)
	}
	lineage, err := lineageService.Get(child.ID, "user_a", WorkspaceScopePersonal)
	if err != nil || len(lineage.Parents) != 1 || lineage.Parents[0].RelationType != model.AssetLineageCrop {
		t.Fatalf("lineage=%+v err=%v", lineage, err)
	}
	var inherited []string
	if err := json.Unmarshal(repeated.Tags, &inherited); err != nil {
		t.Fatal(err)
	}
	if len(inherited) != 1 || inherited[0] != "人物" {
		t.Fatalf("inherited tags = %v", inherited)
	}
}

func TestAssetServiceUploadOpenAndDelete(t *testing.T) {
	svc := NewAssetService(repository.NewMemoryAssetRepository(), storage.NewLocalFSStorage(t.TempDir()))

	ctx := context.Background()
	asset, err := svc.Upload(ctx, AssetUploadInput{
		ID:          "asset_test",
		UserID:      "user_a",
		Scope:       WorkspaceScopePersonal,
		Type:        "image",
		Name:        "sample.png",
		Extension:   ".png",
		SizeLimit:   1024,
		ContentType: "image/png",
		Reader:      bytes.NewReader([]byte("asset-bytes")),
	})
	if err != nil {
		t.Fatal(err)
	}
	if asset.URL != "/api/assets/asset_test/content" {
		t.Fatalf("url = %q", asset.URL)
	}

	content, err := svc.OpenContent(ctx, asset.ID, "user_a", WorkspaceScopePersonal)
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(content.Reader)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "asset-bytes" {
		t.Fatalf("content = %q", data)
	}
	if err := content.Reader.Close(); err != nil {
		t.Fatal(err)
	}

	if err := svc.Delete(ctx, asset.ID, "user_a", WorkspaceScopePersonal); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Get(asset.ID, "user_a", WorkspaceScopePersonal); err == nil {
		t.Fatal("expected trashed asset to be hidden from active reads")
	}
	trashedContent, err := svc.OpenContent(ctx, asset.ID, "user_a", WorkspaceScopePersonal)
	if err != nil {
		t.Fatalf("existing references must retain trashed content: %v", err)
	}
	_ = trashedContent.Reader.Close()
	if _, err := svc.BulkRestore([]string{asset.ID}, "user_a", WorkspaceScopePersonal); err != nil {
		t.Fatal(err)
	}
	if err := svc.Delete(ctx, asset.ID, "user_a", WorkspaceScopePersonal); err != nil {
		t.Fatal(err)
	}
	if err := svc.PermanentDelete(ctx, asset.ID, "user_a", WorkspaceScopePersonal); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.OpenContent(ctx, asset.ID, "user_a", WorkspaceScopePersonal); err == nil {
		t.Fatal("expected permanently deleted asset to be unavailable")
	}
}

func TestAssetServiceBulkTrashIsWorkspaceAtomicAndReportsReferences(t *testing.T) {
	repo := repository.NewMemoryAssetRepository()
	references := repository.NewMemoryAssetReferenceRepository()
	svc := NewAssetService(repo, storage.NewLocalFSStorage(t.TempDir()))
	svc.SetReferenceRepository(references)
	ctx := context.Background()
	upload := func(id string, userID string) {
		t.Helper()
		if _, err := svc.Upload(ctx, AssetUploadInput{
			ID: id, UserID: userID, Scope: WorkspaceScopePersonal, Type: "image", Name: id + ".png",
			Extension: ".png", SizeLimit: 1024, ContentType: "image/png", Reader: bytes.NewReader([]byte(id)),
		}); err != nil {
			t.Fatal(err)
		}
	}
	upload("asset_workspace_a", "user_a")
	upload("asset_workspace_b", "user_b")
	workspaceA := WorkspaceIDForScope(WorkspaceScopePersonal, "user_a")
	if err := references.ReplaceForSource(workspaceA, model.AssetReferenceTypeCanvasProject, "canvas_a", []string{"asset_workspace_a"}); err != nil {
		t.Fatal(err)
	}
	preflight, err := svc.TrashPreflight([]string{"asset_workspace_a"}, "user_a", WorkspaceScopePersonal)
	if err != nil {
		t.Fatal(err)
	}
	if preflight.Count != 1 || preflight.TotalBytes == 0 || len(preflight.References) != 1 || preflight.References[0].ReferenceID != "canvas_a" {
		t.Fatalf("preflight = %+v", preflight)
	}
	if _, err := svc.BulkTrash([]string{"asset_workspace_a", "asset_workspace_b"}, "user_a", WorkspaceScopePersonal); !errors.Is(err, repository.ErrAssetNotFound) {
		t.Fatalf("cross-workspace bulk trash error = %v", err)
	}
	if _, err := svc.Get("asset_workspace_a", "user_a", WorkspaceScopePersonal); err != nil {
		t.Fatalf("valid asset was partially trashed: %v", err)
	}
}

type deleteFailStorage struct{ storage.Storage }

func (s deleteFailStorage) Delete(context.Context, string) error {
	return errors.New("storage unavailable")
}

func TestAssetServicePermanentDeleteKeepsDatabaseRecordOnStorageFailure(t *testing.T) {
	baseStore := storage.NewLocalFSStorage(t.TempDir())
	repo := repository.NewMemoryAssetRepository()
	svc := NewAssetService(repo, deleteFailStorage{Storage: baseStore})
	ctx := context.Background()
	asset, err := svc.Upload(ctx, AssetUploadInput{
		ID: "asset_delete_failure", UserID: "user_a", Scope: WorkspaceScopePersonal, Type: "image", Name: "failure.png",
		Extension: ".png", SizeLimit: 1024, ContentType: "image/png", Reader: bytes.NewReader([]byte("keep-me")),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.Delete(ctx, asset.ID, "user_a", WorkspaceScopePersonal); err != nil {
		t.Fatal(err)
	}
	if err := svc.PermanentDelete(ctx, asset.ID, "user_a", WorkspaceScopePersonal); err == nil {
		t.Fatal("expected storage deletion failure")
	}
	trashed, err := svc.ListTrash("user_a", WorkspaceScopePersonal)
	if err != nil {
		t.Fatal(err)
	}
	if len(trashed) != 1 || trashed[0].ID != asset.ID {
		t.Fatalf("database record was lost after storage failure: %+v", trashed)
	}
}

func TestAssetServiceActiveAndTrashLibrariesAreIndependentlyPaginated(t *testing.T) {
	repo := repository.NewMemoryAssetRepository()
	svc := NewAssetService(repo, storage.NewLocalFSStorage(t.TempDir()))
	ctx := context.Background()
	ids := make([]string, 0, 5)
	for index := 0; index < 5; index++ {
		id := fmt.Sprintf("asset_page_%d", index)
		asset, err := svc.Upload(ctx, AssetUploadInput{
			ID: id, UserID: "user_page", Scope: WorkspaceScopePersonal, Type: "image", Name: id + ".png",
			Extension: ".png", SizeLimit: 1024, ContentType: "image/png", Reader: bytes.NewReader([]byte(id)),
		})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, asset.ID)
	}
	if _, err := svc.BulkTrash(ids[:3], "user_page", WorkspaceScopePersonal); err != nil {
		t.Fatal(err)
	}

	active, err := svc.ListLibrary("user_page", WorkspaceScopePersonal, AssetLibraryInput{Page: 1, PageSize: 1})
	if err != nil {
		t.Fatal(err)
	}
	if active.Total != 2 || len(active.Items) != 1 || active.Items[0].TrashedAt != nil {
		t.Fatalf("active page = %+v", active)
	}
	trash, err := svc.ListTrashLibrary("user_page", WorkspaceScopePersonal, AssetLibraryInput{Page: 2, PageSize: 2})
	if err != nil {
		t.Fatal(err)
	}
	if trash.Total != 3 || len(trash.Items) != 1 || trash.Items[0].TrashedAt == nil {
		t.Fatalf("trash page = %+v", trash)
	}
	legacyTrash, err := svc.ListTrash("user_page", WorkspaceScopePersonal)
	if err != nil {
		t.Fatal(err)
	}
	if len(legacyTrash) != 3 {
		t.Fatalf("legacy trash result = %+v", legacyTrash)
	}
}

func TestAssetLibraryTenThousandMemorySample(t *testing.T) {
	repo := repository.NewMemoryAssetRepository()
	workspaceID := WorkspaceIDForScope(WorkspaceScopePersonal, "user_scale")
	for index := 0; index < 10_000; index++ {
		if _, err := repo.Create(model.Asset{
			ID: fmt.Sprintf("asset_scale_%05d", index), UserID: "user_scale", WorkspaceID: workspaceID,
			Type: "image", Name: fmt.Sprintf("sample-%05d.png", index), Category: model.AssetCategoryOther,
		}); err != nil {
			t.Fatal(err)
		}
	}
	svc := NewAssetService(repo, storage.NewLocalFSStorage(t.TempDir()))
	started := time.Now()
	result, err := svc.ListLibrary("user_scale", WorkspaceScopePersonal, AssetLibraryInput{Page: 50, PageSize: 100, Sort: "name_asc"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Total != 10_000 || len(result.Items) != 100 || result.Items[0].Name != "sample-04900.png" {
		t.Fatalf("10k page = total:%d count:%d first:%q", result.Total, len(result.Items), result.Items[0].Name)
	}
	t.Logf("10,000 asset memory page resolved in %s", time.Since(started))
}

func TestAssetLibraryCombinesSemanticTagsAndUsageViews(t *testing.T) {
	assets := repository.NewMemoryAssetRepository()
	tagRepo := repository.NewMemoryTagRepository(assets)
	usageRepo := repository.NewMemoryAssetUsageRepository()
	tagService := NewTagService(tagRepo, assets)
	usageService := NewAssetUsageService(usageRepo, assets, repository.NewMemoryAssetReferenceRepository(), repository.NewMemoryAssetLineageRepository())
	assetService := NewAssetService(assets, storage.NewLocalFSStorage(t.TempDir()))
	assetService.SetTagFilterer(tagService)
	assetService.SetUsageFilterer(usageService)
	workspaceID := WorkspaceIDForScope(WorkspaceScopePersonal, "user_library")
	for _, assetID := range []string{"asset_match", "asset_character", "asset_unused"} {
		if _, err := assets.Create(model.Asset{ID: assetID, UserID: "user_library", WorkspaceID: workspaceID, Type: "image", Name: assetID, Category: model.AssetCategoryOther}); err != nil {
			t.Fatal(err)
		}
	}
	character, err := tagService.Create("user_library", WorkspaceScopePersonal, TagCreateInput{Name: "人物", AssetEnabled: true})
	if err != nil {
		t.Fatal(err)
	}
	scene, err := tagService.Create("user_library", WorkspaceScopePersonal, TagCreateInput{Name: "场景", AssetEnabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tagService.BindAssets([]string{"asset_match", "asset_character"}, []string{character.ID}, "user_library", WorkspaceScopePersonal); err != nil {
		t.Fatal(err)
	}
	if _, err := tagService.BindAssets([]string{"asset_match"}, []string{scene.ID}, "user_library", WorkspaceScopePersonal); err != nil {
		t.Fatal(err)
	}
	if err := usageService.RecordGenerationUse(workspaceID, "user_library", "job_library", []string{"asset_match"}); err != nil {
		t.Fatal(err)
	}
	if _, err := usageService.PutUserState("asset_match", "user_library", WorkspaceScopePersonal, AssetUserStateInput{Reaction: model.AssetReactionFavorite}); err != nil {
		t.Fatal(err)
	}
	andResult, err := assetService.ListLibrary("user_library", WorkspaceScopePersonal, AssetLibraryInput{TagIDs: []string{character.ID, scene.ID}, TagMatch: "and", IncludeTagDescendants: true, Page: 1, PageSize: 20})
	if err != nil || andResult.Total != 1 || andResult.Items[0].ID != "asset_match" {
		t.Fatalf("tag AND result = %+v err=%v", andResult, err)
	}
	favorites, err := assetService.ListLibrary("user_library", WorkspaceScopePersonal, AssetLibraryInput{SmartView: "favorite", Page: 1, PageSize: 20})
	if err != nil || favorites.Total != 1 || favorites.Items[0].ID != "asset_match" {
		t.Fatalf("favorite result = %+v err=%v", favorites, err)
	}
	unused, err := assetService.ListLibrary("user_library", WorkspaceScopePersonal, AssetLibraryInput{SmartView: "unused", Page: 1, PageSize: 20})
	if err != nil || unused.Total != 2 {
		t.Fatalf("unused result = %+v err=%v", unused, err)
	}
}
