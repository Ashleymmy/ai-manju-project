package service

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

func TestTagServiceAliasSearchAndWorkspaceIsolation(t *testing.T) {
	assetRepo := repository.NewMemoryAssetRepository()
	tagRepo := repository.NewMemoryTagRepository(assetRepo)
	service := NewTagService(tagRepo, assetRepo)
	tag, err := service.Create("user_a", WorkspaceScopePersonal, TagCreateInput{Name: "人物", AssetEnabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.CreateAlias(tag.ID, "角色", "user_a", WorkspaceScopePersonal); err != nil {
		t.Fatal(err)
	}
	result, err := service.List("user_a", WorkspaceScopePersonal, TagListInput{Keyword: "角色"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Total != 1 || result.Items[0].ID != tag.ID {
		t.Fatalf("alias search = %+v", result)
	}
	if _, err := service.Get(tag.ID, "user_b", WorkspaceScopePersonal); !errors.Is(err, repository.ErrTagNotFound) {
		t.Fatalf("workspace isolation error = %v", err)
	}
	if _, err := service.Create("user_a", WorkspaceScopePersonal, TagCreateInput{ScopeType: model.TagScopeUser, Name: "私有", AssetEnabled: true}); !errors.Is(err, ErrTagScope) {
		t.Fatalf("user asset tag error = %v", err)
	}
}

func TestTagServiceReturnsEmptyAliasArrays(t *testing.T) {
	assetRepo := repository.NewMemoryAssetRepository()
	tagRepo := repository.NewMemoryTagRepository(assetRepo)
	tags := NewTagService(tagRepo, assetRepo)
	tag, err := tags.Create("user_empty_aliases", WorkspaceScopePersonal, TagCreateInput{Name: "人物", AssetEnabled: true})
	if err != nil {
		t.Fatal(err)
	}

	result, err := tags.List("user_empty_aliases", WorkspaceScopePersonal, TagListInput{PageSize: 100})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 1 || result.Items[0].Aliases == nil {
		t.Fatalf("list aliases must be an empty array: %+v", result.Items)
	}

	view, err := tags.Get(tag.ID, "user_empty_aliases", WorkspaceScopePersonal)
	if err != nil {
		t.Fatal(err)
	}
	if view.Aliases == nil {
		t.Fatalf("get aliases must be an empty array: %+v", view)
	}
	payload, err := json.Marshal(view)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(payload), `"aliases":null`) {
		t.Fatalf("aliases serialized as null: %s", payload)
	}
}

func TestTagServiceLegacySyncIsIdempotentAndRenameRefreshesMirror(t *testing.T) {
	assetRepo := repository.NewMemoryAssetRepository()
	tagRepo := repository.NewMemoryTagRepository(assetRepo)
	service := NewTagService(tagRepo, assetRepo)
	workspaceID := WorkspaceIDForScope(WorkspaceScopePersonal, "user_a")
	if _, err := assetRepo.Create(model.Asset{ID: "asset_a", UserID: "user_a", WorkspaceID: workspaceID, Type: "image", URL: "a.png", Tags: model.JSONB("[]")}); err != nil {
		t.Fatal(err)
	}
	for index := 0; index < 2; index++ {
		if err := service.SyncLegacyAssetTags("user_a", WorkspaceScopePersonal, "asset_a", []string{"古装", "古装", "夜景"}); err != nil {
			t.Fatal(err)
		}
	}
	result, err := service.List("user_a", WorkspaceScopePersonal, TagListInput{Usage: "asset", PageSize: 100})
	if err != nil {
		t.Fatal(err)
	}
	if result.Total != 3 {
		t.Fatalf("expected root plus two tags, got %+v", result.Items)
	}
	var target TagView
	for _, item := range result.Items {
		if item.Name == "古装" {
			target = item
		}
	}
	if target.ID == "" || target.AssetCount != 1 {
		t.Fatalf("migrated tag = %+v", target)
	}
	if _, err := service.Update(target.ID, "user_a", WorkspaceScopePersonal, TagUpdateInput{Name: "汉服", AssetEnabled: true, InheritMode: model.TagInheritAuto, Status: model.TagStatusActive}); err != nil {
		t.Fatal(err)
	}
	asset, err := assetRepo.GetByWorkspace("asset_a", workspaceID)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	if err := json.Unmarshal(asset.Tags, &names); err != nil {
		t.Fatal(err)
	}
	if len(names) != 2 || names[0] != "夜景" || names[1] != "汉服" {
		t.Fatalf("renamed mirror = %v", names)
	}
}

func TestTagServiceAssetFilterSupportsDescendantGroupsAndOrModes(t *testing.T) {
	assetRepo := repository.NewMemoryAssetRepository()
	tagRepo := repository.NewMemoryTagRepository(assetRepo)
	tags := NewTagService(tagRepo, assetRepo)
	workspaceID := WorkspaceIDForScope(WorkspaceScopePersonal, "user_filter")
	for _, assetID := range []string{"asset_both", "asset_character", "asset_scene"} {
		if _, err := assetRepo.Create(model.Asset{ID: assetID, UserID: "user_filter", WorkspaceID: workspaceID, Type: "image", Name: assetID}); err != nil {
			t.Fatal(err)
		}
	}
	character, err := tags.Create("user_filter", WorkspaceScopePersonal, TagCreateInput{Name: "人物", AssetEnabled: true})
	if err != nil {
		t.Fatal(err)
	}
	female, err := tags.Create("user_filter", WorkspaceScopePersonal, TagCreateInput{Name: "女性", ParentID: character.ID, AssetEnabled: true})
	if err != nil {
		t.Fatal(err)
	}
	scene, err := tags.Create("user_filter", WorkspaceScopePersonal, TagCreateInput{Name: "场景", AssetEnabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tags.BindAssets([]string{"asset_both", "asset_character"}, []string{female.ID}, "user_filter", WorkspaceScopePersonal); err != nil {
		t.Fatal(err)
	}
	if _, err := tags.BindAssets([]string{"asset_both", "asset_scene"}, []string{scene.ID}, "user_filter", WorkspaceScopePersonal); err != nil {
		t.Fatal(err)
	}
	andIDs, err := tags.FilterAssetIDs("user_filter", WorkspaceScopePersonal, []string{character.ID, scene.ID}, true, true)
	if err != nil || len(andIDs) != 1 || andIDs[0] != "asset_both" {
		t.Fatalf("AND ids = %v err=%v", andIDs, err)
	}
	orIDs, err := tags.FilterAssetIDs("user_filter", WorkspaceScopePersonal, []string{character.ID, scene.ID}, true, false)
	if err != nil || len(orIDs) != 3 {
		t.Fatalf("OR ids = %v err=%v", orIDs, err)
	}
	details, err := tags.AssetTagDetails("asset_both", "user_filter", WorkspaceScopePersonal)
	if err != nil || len(details) != 2 {
		t.Fatalf("asset tag details = %+v err=%v", details, err)
	}
	for _, detail := range details {
		if detail.Binding.State != model.AssetTagBindingActive || len(detail.Origins) != 1 || detail.Origins[0].OriginType != model.AssetTagOriginDirect {
			t.Fatalf("unexpected tag origin detail = %+v", detail)
		}
	}
}

func TestTagServiceArchiveSubtreeRefreshesAssetMirror(t *testing.T) {
	assetRepo := repository.NewMemoryAssetRepository()
	tagRepo := repository.NewMemoryTagRepository(assetRepo)
	tags := NewTagService(tagRepo, assetRepo)
	workspaceID := WorkspaceIDForScope(WorkspaceScopePersonal, "user_archive")
	if _, err := assetRepo.Create(model.Asset{ID: "asset_archive", UserID: "user_archive", WorkspaceID: workspaceID, Type: "image", Name: "asset"}); err != nil {
		t.Fatal(err)
	}
	root, err := tags.Create("user_archive", WorkspaceScopePersonal, TagCreateInput{Name: "人物", AssetEnabled: true})
	if err != nil {
		t.Fatal(err)
	}
	child, err := tags.Create("user_archive", WorkspaceScopePersonal, TagCreateInput{Name: "女性", ParentID: root.ID, AssetEnabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tags.BindAssets([]string{"asset_archive"}, []string{child.ID}, "user_archive", WorkspaceScopePersonal); err != nil {
		t.Fatal(err)
	}
	archived, err := tags.Archive(root.ID, "user_archive", WorkspaceScopePersonal)
	if err != nil || len(archived) != 2 {
		t.Fatalf("archive = %+v err=%v", archived, err)
	}
	asset, err := assetRepo.GetByWorkspace("asset_archive", workspaceID)
	if err != nil {
		t.Fatal(err)
	}
	if string(asset.Tags) != "[]" {
		t.Fatalf("archived tag remained in mirror: %s", asset.Tags)
	}
}

func TestAssetMetadataUsesStableTagIDsForParentAndChildCombinations(t *testing.T) {
	assetRepo := repository.NewMemoryAssetRepository()
	tagRepo := repository.NewMemoryTagRepository(assetRepo)
	tags := NewTagService(tagRepo, assetRepo)
	assets := NewAssetService(assetRepo, nil)
	assets.SetTagSyncer(tags)
	workspaceID := WorkspaceIDForScope(WorkspaceScopePersonal, "user_tag_ids")
	if _, err := assetRepo.Create(model.Asset{ID: "asset_tag_ids", UserID: "user_tag_ids", WorkspaceID: workspaceID, Type: "image", Name: "asset"}); err != nil {
		t.Fatal(err)
	}
	root, err := tags.Create("user_tag_ids", WorkspaceScopePersonal, TagCreateInput{Name: "人物", AssetEnabled: true})
	if err != nil {
		t.Fatal(err)
	}
	child, err := tags.Create("user_tag_ids", WorkspaceScopePersonal, TagCreateInput{Name: "青年", ParentID: root.ID, AssetEnabled: true})
	if err != nil {
		t.Fatal(err)
	}
	tagIDs := []string{root.ID, child.ID}
	asset, err := assets.UpdateMetadata("asset_tag_ids", "user_tag_ids", WorkspaceScopePersonal, AssetMetadataInput{TagIDs: &tagIDs})
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	if err := json.Unmarshal(asset.Tags, &names); err != nil {
		t.Fatal(err)
	}
	if len(names) != 2 || names[0] != "人物" || names[1] != "青年" {
		t.Fatalf("stable tag id mirror = %v", names)
	}
}
