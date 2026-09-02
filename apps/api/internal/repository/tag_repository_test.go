package repository

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/database"
	"github.com/ai-manju/api/internal/model"
)

func TestGormTagRepositoryTreeBindingAndMirrorIntegration(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to run PostgreSQL repository integration test")
	}
	db, err := database.OpenPostgres(dsn)
	if err != nil {
		t.Fatal(err)
	}
	prefix := fmt.Sprintf("tag_it_%d", time.Now().UTC().UnixNano())
	workspaceID, userID := "default:"+prefix, prefix
	asset := model.Asset{ID: prefix + "_asset", UserID: userID, WorkspaceID: workspaceID, Type: "image", URL: "test.png", Tags: model.JSONB("[]")}
	if err := db.Create(&asset).Error; err != nil {
		t.Fatal(err)
	}
	childAsset := model.Asset{ID: prefix + "_child_asset", UserID: userID, WorkspaceID: workspaceID, Type: "image", URL: "child.png", Tags: model.JSONB("[]")}
	if err := db.Create(&childAsset).Error; err != nil {
		t.Fatal(err)
	}
	repo := NewGormTagRepository(db)
	root, err := repo.Create(model.Tag{ID: prefix + "_root", ScopeType: model.TagScopeWorkspace, ScopeKey: workspaceID, CreatedBy: userID, Name: "人物", NormalizedName: "人物", AssetEnabled: true, InheritMode: model.TagInheritAuto, Status: model.TagStatusActive}, 8)
	if err != nil {
		t.Fatal(err)
	}
	child, err := repo.Create(model.Tag{ID: prefix + "_child", ScopeType: model.TagScopeWorkspace, ScopeKey: workspaceID, CreatedBy: userID, ParentID: root.ID, Name: "女性", NormalizedName: "女性", AssetEnabled: true, InheritMode: model.TagInheritAuto, Status: model.TagStatusActive}, 8)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		bindingQuery := db.Model(&model.AssetTagBinding{}).Select("id").Where("asset_id IN ?", []string{asset.ID, childAsset.ID})
		_ = db.Where("binding_id IN (?)", bindingQuery).Delete(&model.AssetTagOrigin{}).Error
		_ = db.Where("asset_id IN ?", []string{asset.ID, childAsset.ID}).Delete(&model.AssetTagBinding{}).Error
		_ = db.Where("ancestor_id IN ? OR descendant_id IN ?", []string{root.ID, child.ID}, []string{root.ID, child.ID}).Delete(&model.TagClosure{}).Error
		_ = db.Where("id IN ?", []string{root.ID, child.ID}).Delete(&model.Tag{}).Error
		_ = db.Where("id IN ?", []string{asset.ID, childAsset.ID}).Delete(&model.Asset{}).Error
	})
	descendants, err := repo.DescendantIDs(root.ID, []string{workspaceID}, true)
	if err != nil || len(descendants) != 2 {
		t.Fatalf("descendants=%v err=%v", descendants, err)
	}
	bindings, err := repo.BindAssets(workspaceID, userID, []string{asset.ID}, []string{child.ID}, model.AssetTagOriginDirect)
	if err != nil || len(bindings) != 1 {
		t.Fatalf("bindings=%v err=%v", bindings, err)
	}
	var updated model.Asset
	if err := db.First(&updated, "id = ?", asset.ID).Error; err != nil {
		t.Fatal(err)
	}
	if string(updated.Tags) != `["女性"]` {
		t.Fatalf("mirror = %s", updated.Tags)
	}
	if err := repo.ResyncInheritedAssetTags(workspaceID, userID, childAsset.ID, []string{asset.ID}); err != nil {
		t.Fatal(err)
	}
	updated = model.Asset{}
	if err := db.First(&updated, "id = ?", childAsset.ID).Error; err != nil {
		t.Fatal(err)
	}
	if string(updated.Tags) != `["女性"]` {
		t.Fatalf("inherited mirror = %s", updated.Tags)
	}
	if _, err := repo.Move(root.ID, child.ID, 0, workspaceID, 8); !errors.Is(err, ErrTagCycle) {
		t.Fatalf("cycle error = %v", err)
	}
}

func TestMemoryTagRepositoryMaintainsClosureAndRejectsCycles(t *testing.T) {
	assets := NewMemoryAssetRepository()
	repo := NewMemoryTagRepository(assets)
	root := createMemoryTag(t, repo, "tag_root", "workspace_a", "", "人物")
	child := createMemoryTag(t, repo, "tag_child", "workspace_a", root.ID, "女性")
	leaf := createMemoryTag(t, repo, "tag_leaf", "workspace_a", child.ID, "古装")

	descendants, err := repo.DescendantIDs(root.ID, []string{"workspace_a"}, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(descendants) != 3 {
		t.Fatalf("descendants = %v", descendants)
	}
	if _, err := repo.Move(root.ID, leaf.ID, 0, "workspace_a", 8); !errors.Is(err, ErrTagCycle) {
		t.Fatalf("cycle error = %v", err)
	}
	if _, err := repo.Move(child.ID, "", 5, "workspace_a", 8); err != nil {
		t.Fatal(err)
	}
	descendants, err = repo.DescendantIDs(root.ID, []string{"workspace_a"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(descendants) != 0 {
		t.Fatalf("root descendants after move = %v", descendants)
	}
	if _, err := repo.Create(model.Tag{ID: "tag_duplicate", ScopeType: model.TagScopeWorkspace, ScopeKey: "workspace_a", CreatedBy: "user_a", Name: "人物", NormalizedName: "人物", AssetEnabled: true, InheritMode: model.TagInheritAuto, Status: model.TagStatusActive}, 8); !errors.Is(err, ErrTagConflict) {
		t.Fatalf("duplicate sibling error = %v", err)
	}

	depthRepo := NewMemoryTagRepository(NewMemoryAssetRepository())
	depthRoot := createMemoryTagWithDepth(t, depthRepo, "depth_root", "", 2)
	depthChild := createMemoryTagWithDepth(t, depthRepo, "depth_child", depthRoot.ID, 2)
	depthGrandchild := createMemoryTagWithDepth(t, depthRepo, "depth_grandchild", depthChild.ID, 2)
	if _, err := depthRepo.Create(model.Tag{ID: "depth_too_far", ScopeType: model.TagScopeWorkspace, ScopeKey: "workspace_depth", CreatedBy: "user_a", ParentID: depthGrandchild.ID, Name: "depth_too_far", NormalizedName: "depth_too_far", AssetEnabled: true, InheritMode: model.TagInheritAuto, Status: model.TagStatusActive}, 2); !errors.Is(err, ErrTagDepth) {
		t.Fatalf("depth error = %v", err)
	}
}

func TestMemoryTagRepositoryBulkMoveIsAtomicAndArchiveIncludesDescendants(t *testing.T) {
	repo := NewMemoryTagRepository(NewMemoryAssetRepository())
	rootA := createMemoryTag(t, repo, "tag_root_a", "workspace_a", "", "人物")
	rootB := createMemoryTag(t, repo, "tag_root_b", "workspace_a", "", "场景")
	rootTarget := createMemoryTag(t, repo, "tag_root_target", "workspace_a", "", "分类")
	childA := createMemoryTag(t, repo, "tag_child_a", "workspace_a", rootA.ID, "通用")
	childB := createMemoryTag(t, repo, "tag_child_b", "workspace_a", rootB.ID, "通用")
	leaf := createMemoryTag(t, repo, "tag_leaf", "workspace_a", childA.ID, "青年")

	if _, err := repo.BulkMove([]string{childA.ID, childB.ID}, rootTarget.ID, 0, "workspace_a", 8); !errors.Is(err, ErrTagConflict) {
		t.Fatalf("bulk move conflict = %v", err)
	}
	currentA, _ := repo.Get(childA.ID, []string{"workspace_a"})
	currentB, _ := repo.Get(childB.ID, []string{"workspace_a"})
	if currentA.ParentID != rootA.ID || currentB.ParentID != rootB.ID {
		t.Fatalf("failed bulk move wrote partial parents: %s %s", currentA.ParentID, currentB.ParentID)
	}
	archived, err := repo.ArchiveSubtrees([]string{rootA.ID}, "workspace_a")
	if err != nil {
		t.Fatal(err)
	}
	if len(archived) != 3 {
		t.Fatalf("archived subtree = %+v", archived)
	}
	for _, id := range []string{rootA.ID, childA.ID, leaf.ID} {
		tag, _ := repo.Get(id, []string{"workspace_a"})
		if tag.Status != model.TagStatusArchived {
			t.Fatalf("tag %s status = %s", id, tag.Status)
		}
	}
	active, _ := repo.Get(rootB.ID, []string{"workspace_a"})
	if active.Status != model.TagStatusActive {
		t.Fatalf("unselected root status = %s", active.Status)
	}
}

func TestMemoryTagRepositoryBulkBindIsAtomicAndMirrorsLegacyTags(t *testing.T) {
	assets := NewMemoryAssetRepository()
	repo := NewMemoryTagRepository(assets)
	workspaceID := "default:user_a"
	for _, asset := range []model.Asset{
		{ID: "asset_a", UserID: "user_a", WorkspaceID: workspaceID, Type: "image", URL: "a.png", Tags: model.JSONB("[]")},
		{ID: "asset_b", UserID: "user_a", WorkspaceID: workspaceID, Type: "image", URL: "b.png", Tags: model.JSONB("[]")},
		{ID: "asset_foreign", UserID: "user_b", WorkspaceID: "default:user_b", Type: "image", URL: "c.png", Tags: model.JSONB("[]")},
	} {
		if _, err := assets.Create(asset); err != nil {
			t.Fatal(err)
		}
	}
	tag := createMemoryTag(t, repo, "tag_scene", workspaceID, "", "场景")
	if _, err := repo.BindAssets(workspaceID, "user_a", []string{"asset_a", "asset_foreign"}, []string{tag.ID}, model.AssetTagOriginDirect); !errors.Is(err, ErrAssetNotFound) {
		t.Fatalf("cross-workspace bulk bind error = %v", err)
	}
	counts, err := repo.Counts([]string{tag.ID})
	if err != nil {
		t.Fatal(err)
	}
	if counts[tag.ID].AssetCount != 0 {
		t.Fatalf("partial binding was written: %+v", counts[tag.ID])
	}
	bindings, err := repo.BindAssets(workspaceID, "user_a", []string{"asset_a", "asset_b"}, []string{tag.ID}, model.AssetTagOriginDirect)
	if err != nil {
		t.Fatal(err)
	}
	if len(bindings) != 2 {
		t.Fatalf("bindings = %d", len(bindings))
	}
	asset, err := assets.GetByWorkspace("asset_a", workspaceID)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	if err := json.Unmarshal(asset.Tags, &names); err != nil {
		t.Fatal(err)
	}
	if len(names) != 1 || names[0] != "场景" {
		t.Fatalf("legacy mirror = %v", names)
	}
	if err := repo.RemoveAssetTags(workspaceID, []string{"asset_a"}, []string{tag.ID}); err != nil {
		t.Fatal(err)
	}
	asset, _ = assets.GetByWorkspace("asset_a", workspaceID)
	if string(asset.Tags) != "[]" {
		t.Fatalf("legacy mirror after remove = %s", asset.Tags)
	}
}

func TestMemoryTagRepositoryKeepsAssetAndPromptCountsSeparate(t *testing.T) {
	repo := NewMemoryTagRepository(NewMemoryAssetRepository())
	tag := createMemoryTag(t, repo, "tag_shared", "workspace_a", "", "国风")
	tag.PromptEnabled = true
	if _, err := repo.Update(tag, tag.ScopeKey); err != nil {
		t.Fatal(err)
	}
	repo.promptBindings["prompt_binding"] = model.PromptTagBinding{ID: "prompt_binding", PromptID: "prompt_a", TagID: tag.ID}
	counts, err := repo.Counts([]string{tag.ID})
	if err != nil {
		t.Fatal(err)
	}
	if counts[tag.ID].AssetCount != 0 || counts[tag.ID].PromptCount != 1 {
		t.Fatalf("counts = %+v", counts[tag.ID])
	}
}

func TestMemoryTagRepositorySnapshotsMultiParentInheritanceAndHonorsSuppression(t *testing.T) {
	assets := NewMemoryAssetRepository()
	repo := NewMemoryTagRepository(assets)
	workspaceID := "default:user_a"
	for _, id := range []string{"parent_a", "parent_b", "child"} {
		if _, err := assets.Create(model.Asset{ID: id, UserID: "user_a", WorkspaceID: workspaceID, Type: "image", URL: id + ".png", Tags: model.JSONB("[]")}); err != nil {
			t.Fatal(err)
		}
	}
	tagA := createMemoryTag(t, repo, "tag_a", workspaceID, "", "人物")
	tagB := createMemoryTag(t, repo, "tag_b", workspaceID, "", "夜景")
	tagC := createMemoryTag(t, repo, "tag_c", workspaceID, "", "宫殿")
	if _, err := repo.BindAssets(workspaceID, "user_a", []string{"parent_a"}, []string{tagA.ID, tagB.ID}, model.AssetTagOriginDirect); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.BindAssets(workspaceID, "user_a", []string{"parent_b"}, []string{tagB.ID, tagC.ID}, model.AssetTagOriginDirect); err != nil {
		t.Fatal(err)
	}
	if err := repo.ResyncInheritedAssetTags(workspaceID, "user_a", "child", []string{"parent_a", "parent_b"}); err != nil {
		t.Fatal(err)
	}
	child, _ := assets.GetByWorkspace("child", workspaceID)
	var names []string
	if err := json.Unmarshal(child.Tags, &names); err != nil {
		t.Fatal(err)
	}
	if len(names) != 3 {
		t.Fatalf("inherited names = %v", names)
	}
	var sharedBinding model.AssetTagBinding
	for _, binding := range repo.assetBindings {
		if binding.AssetID == "child" && binding.TagID == tagB.ID {
			sharedBinding = binding
		}
	}
	origins := 0
	for _, origin := range repo.assetOrigins {
		if origin.BindingID == sharedBinding.ID && origin.OriginType == model.AssetTagOriginInherited {
			origins++
		}
	}
	if origins != 2 {
		t.Fatalf("shared tag origins = %d", origins)
	}
	if err := repo.RemoveAssetTags(workspaceID, []string{"child"}, []string{tagB.ID}); err != nil {
		t.Fatal(err)
	}
	if err := repo.ResyncInheritedAssetTags(workspaceID, "user_a", "child", []string{"parent_a", "parent_b"}); err != nil {
		t.Fatal(err)
	}
	child, _ = assets.GetByWorkspace("child", workspaceID)
	if err := json.Unmarshal(child.Tags, &names); err != nil {
		t.Fatal(err)
	}
	for _, name := range names {
		if name == "夜景" {
			t.Fatalf("suppressed tag was silently restored: %v", names)
		}
	}
}

func createMemoryTag(t *testing.T, repo *MemoryTagRepository, id string, scopeKey string, parentID string, name string) model.Tag {
	t.Helper()
	tag, err := repo.Create(model.Tag{
		ID: id, ScopeType: model.TagScopeWorkspace, ScopeKey: scopeKey, CreatedBy: "user_a", ParentID: parentID,
		Name: name, NormalizedName: name, AssetEnabled: true, InheritMode: model.TagInheritAuto, Status: model.TagStatusActive,
	}, 8)
	if err != nil {
		t.Fatal(err)
	}
	return tag
}

func createMemoryTagWithDepth(t *testing.T, repo *MemoryTagRepository, id string, parentID string, maxDepth int) model.Tag {
	t.Helper()
	tag, err := repo.Create(model.Tag{ID: id, ScopeType: model.TagScopeWorkspace, ScopeKey: "workspace_depth", CreatedBy: "user_a", ParentID: parentID, Name: id, NormalizedName: id, AssetEnabled: true, InheritMode: model.TagInheritAuto, Status: model.TagStatusActive}, maxDepth)
	if err != nil {
		t.Fatal(err)
	}
	return tag
}
