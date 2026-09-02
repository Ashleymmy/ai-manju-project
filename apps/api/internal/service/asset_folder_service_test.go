package service

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

type assetFolderFixture struct {
	folders *repository.MemoryAssetFolderRepository
	assets  *repository.MemoryAssetRepository
	service *AssetFolderService
}

func newAssetFolderFixture() assetFolderFixture {
	folders := repository.NewMemoryAssetFolderRepository()
	assets := repository.NewMemoryAssetRepository()
	return assetFolderFixture{folders: folders, assets: assets, service: NewAssetFolderService(folders, assets)}
}

func TestAssetFolderDefaultsAreIdempotentAndWorkspaceIsolated(t *testing.T) {
	fx := newAssetFolderFixture()
	first, err := fx.service.EnsureDefaults("user_a", WorkspaceScopePersonal)
	if err != nil {
		t.Fatal(err)
	}
	second, err := fx.service.EnsureDefaults("user_a", WorkspaceScopePersonal)
	if err != nil {
		t.Fatal(err)
	}
	if first.Root.ID != second.Root.ID || first.Unsorted.ID != second.Unsorted.ID || first.Comic.ID != second.Comic.ID {
		t.Fatalf("default folders changed across ensure: first=%+v second=%+v", first, second)
	}
	personal, err := fx.service.List("user_a", WorkspaceScopePersonal)
	if err != nil {
		t.Fatal(err)
	}
	if len(personal) != 6 {
		t.Fatalf("personal defaults = %d, want 6", len(personal))
	}
	other, err := fx.service.List("user_b", WorkspaceScopePersonal)
	if err != nil {
		t.Fatal(err)
	}
	for _, folder := range other {
		if folder.WorkspaceID == first.Root.WorkspaceID || folder.ID == first.Root.ID {
			t.Fatalf("personal folder leaked across workspaces: %+v", folder)
		}
	}
	teamA, err := fx.service.EnsureDefaults("user_a", WorkspaceScopeTeam)
	if err != nil {
		t.Fatal(err)
	}
	teamB, err := fx.service.EnsureDefaults("user_b", WorkspaceScopeTeam)
	if err != nil {
		t.Fatal(err)
	}
	if teamA.Root.ID != teamB.Root.ID || teamA.Root.WorkspaceID != TeamWorkspaceID {
		t.Fatalf("team defaults were not shared: a=%+v b=%+v", teamA.Root, teamB.Root)
	}
}

func TestAssetFolderHierarchyProtectionAndCycleValidation(t *testing.T) {
	fx := newAssetFolderFixture()
	defaults, err := fx.service.EnsureDefaults("user_a", WorkspaceScopePersonal)
	if err != nil {
		t.Fatal(err)
	}
	root, err := fx.service.Create("user_a", WorkspaceScopePersonal, AssetFolderCreateInput{Name: "角色设定"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fx.service.Create("user_a", WorkspaceScopePersonal, AssetFolderCreateInput{Name: "角色设定"}); !errors.Is(err, repository.ErrAssetFolderConflict) {
		t.Fatalf("duplicate sibling error = %v", err)
	}
	current := root
	for depth := 2; depth <= AssetFolderMaxDepth; depth++ {
		current, err = fx.service.Create("user_a", WorkspaceScopePersonal, AssetFolderCreateInput{Name: fmt.Sprintf("第%d层", depth), ParentID: current.ID})
		if err != nil {
			t.Fatalf("create depth %d: %v", depth, err)
		}
	}
	if _, err := fx.service.Create("user_a", WorkspaceScopePersonal, AssetFolderCreateInput{Name: "超深", ParentID: current.ID}); !errors.Is(err, ErrAssetFolderDepth) {
		t.Fatalf("max-depth error = %v", err)
	}
	if _, err := fx.service.Update(root.ID, "user_a", WorkspaceScopePersonal, AssetFolderUpdateInput{Name: root.Name, ParentID: current.ID}); !errors.Is(err, ErrAssetFolderCycle) {
		t.Fatalf("cycle error = %v", err)
	}
	if _, err := fx.service.Update(defaults.Unsorted.ID, "user_a", WorkspaceScopePersonal, AssetFolderUpdateInput{Name: "改名"}); !errors.Is(err, repository.ErrAssetFolderProtected) {
		t.Fatalf("system rename error = %v", err)
	}
	if _, err := fx.service.Delete(defaults.Unsorted.ID, "user_a", WorkspaceScopePersonal); !errors.Is(err, repository.ErrAssetFolderProtected) {
		t.Fatalf("system delete error = %v", err)
	}
	if _, err := fx.service.Get(root.ID, "user_b", WorkspaceScopePersonal); !errors.Is(err, repository.ErrAssetFolderNotFound) {
		t.Fatalf("cross-workspace get error = %v", err)
	}
}

type fixedAssetFolderReferenceChecker struct {
	active bool
}

func (c fixedAssetFolderReferenceChecker) HasActiveOutputFolder(_ []string, _ string) (bool, error) {
	return c.active, nil
}

func TestAssetFolderDeleteMovesAssetsWithoutChangingIdentityOrLineage(t *testing.T) {
	fx := newAssetFolderFixture()
	defaults, err := fx.service.EnsureDefaults("user_a", WorkspaceScopePersonal)
	if err != nil {
		t.Fatal(err)
	}
	parent, err := fx.service.Create("user_a", WorkspaceScopePersonal, AssetFolderCreateInput{Name: "临时项目"})
	if err != nil {
		t.Fatal(err)
	}
	child, err := fx.service.Create("user_a", WorkspaceScopePersonal, AssetFolderCreateInput{Name: "人物", ParentID: parent.ID})
	if err != nil {
		t.Fatal(err)
	}
	for index, folderID := range []string{parent.ID, child.ID} {
		_, err = fx.assets.Create(model.Asset{
			ID: fmt.Sprintf("asset_%d", index), UserID: "user_a", WorkspaceID: WorkspaceIDForScope(WorkspaceScopePersonal, "user_a"),
			Type: "image", Name: "图片", URL: fmt.Sprintf("/api/assets/asset_%d/content", index), FolderID: folderID,
			Category: model.AssetCategoryCharacter, SourceType: model.AssetSourceComicBatch, SourceProjectID: "project_1", SourceBatchID: "batch_1",
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	fx.service.SetActiveReferenceChecker(fixedAssetFolderReferenceChecker{active: true})
	if _, err := fx.service.Delete(parent.ID, "user_a", WorkspaceScopePersonal); !errors.Is(err, repository.ErrAssetFolderInUse) {
		t.Fatalf("active batch delete error = %v", err)
	}
	fx.service.SetActiveReferenceChecker(fixedAssetFolderReferenceChecker{})
	moved, err := fx.service.Delete(parent.ID, "user_a", WorkspaceScopePersonal)
	if err != nil {
		t.Fatal(err)
	}
	if moved != 2 {
		t.Fatalf("moved = %d, want 2", moved)
	}
	for index := 0; index < 2; index++ {
		asset, err := fx.assets.GetByWorkspace(fmt.Sprintf("asset_%d", index), WorkspaceIDForScope(WorkspaceScopePersonal, "user_a"))
		if err != nil {
			t.Fatal(err)
		}
		if asset.FolderID != defaults.Unsorted.ID || asset.URL != fmt.Sprintf("/api/assets/asset_%d/content", index) || asset.SourceBatchID != "batch_1" {
			t.Fatalf("asset changed unexpectedly: %+v", asset)
		}
	}
	if _, err := fx.service.Get(parent.ID, "user_a", WorkspaceScopePersonal); !errors.Is(err, repository.ErrAssetFolderNotFound) {
		t.Fatalf("deleted parent error = %v", err)
	}
	if _, err := fx.service.Get(child.ID, "user_a", WorkspaceScopePersonal); !errors.Is(err, repository.ErrAssetFolderNotFound) {
		t.Fatalf("deleted child error = %v", err)
	}
}

func TestAssetLibraryPaginationDescendantsAndWorkspaceIsolation(t *testing.T) {
	fx := newAssetFolderFixture()
	assetService := NewAssetService(fx.assets, nil)
	assetService.SetFolderService(fx.service)
	parent, err := fx.service.Create("user_a", WorkspaceScopePersonal, AssetFolderCreateInput{Name: "批量结果"})
	if err != nil {
		t.Fatal(err)
	}
	child, err := fx.service.Create("user_a", WorkspaceScopePersonal, AssetFolderCreateInput{Name: "人物", ParentID: parent.ID})
	if err != nil {
		t.Fatal(err)
	}
	workspaceID := WorkspaceIDForScope(WorkspaceScopePersonal, "user_a")
	for index := 0; index < 125; index++ {
		folderID := parent.ID
		category := model.AssetCategoryEnvironment
		if index%2 == 0 {
			folderID = child.ID
			category = model.AssetCategoryCharacter
		}
		asset, createErr := fx.assets.Create(model.Asset{
			ID: fmt.Sprintf("asset_%03d", index), UserID: "user_a", WorkspaceID: workspaceID, Type: "image",
			Name: fmt.Sprintf("候选图 %03d", index), URL: fmt.Sprintf("/api/assets/asset_%03d/content", index), FolderID: folderID,
			Category: category, SourceType: model.AssetSourceComicBatch, SourceProjectID: "comic_project_1",
		})
		if createErr != nil {
			t.Fatal(createErr)
		}
		// Memory Create intentionally owns timestamps; keep ordering stable by
		// making each record observably distinct to the keyword filter instead.
		_ = asset
	}
	_, err = fx.assets.Create(model.Asset{ID: "asset_other", UserID: "user_b", WorkspaceID: WorkspaceIDForScope(WorkspaceScopePersonal, "user_b"), Type: "image", Name: "候选图 other", FolderID: child.ID})
	if err != nil {
		t.Fatal(err)
	}
	result, err := assetService.ListLibrary("user_a", WorkspaceScopePersonal, AssetLibraryInput{
		FolderID: parent.ID, IncludeDescendants: true, Type: "image", SourceType: model.AssetSourceComicBatch,
		SourceProjectID: "comic_project_1", Keyword: "候选图", Page: 1, PageSize: 1000,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Total != 125 || len(result.Items) != AssetLibraryMaxPageSize || result.PageSize != AssetLibraryMaxPageSize {
		t.Fatalf("page result = total:%d items:%d page_size:%d", result.Total, len(result.Items), result.PageSize)
	}
	characters, err := assetService.ListLibrary("user_a", WorkspaceScopePersonal, AssetLibraryInput{
		FolderID: child.ID, Category: model.AssetCategoryCharacter, Page: 2, PageSize: 20, Sort: "name_asc",
	})
	if err != nil {
		t.Fatal(err)
	}
	if characters.Total != 63 || len(characters.Items) != 20 || characters.Items[0].WorkspaceID != workspaceID {
		t.Fatalf("character result = %+v", characters)
	}
	if _, err := assetService.ListLibrary("user_b", WorkspaceScopePersonal, AssetLibraryInput{FolderID: parent.ID}); !errors.Is(err, repository.ErrAssetFolderNotFound) {
		t.Fatalf("cross-workspace folder filter error = %v", err)
	}
}

func TestAssetRegistrationUsesExpectedDefaultFolders(t *testing.T) {
	fx := newAssetFolderFixture()
	cases := []struct {
		name       string
		context    AssetRegistrationContext
		systemKey  string
		parentKey  string
		category   string
		sourceType string
	}{
		{name: "upload", context: AssetRegistrationContext{SourceType: model.AssetSourceManualUpload}, systemKey: model.AssetFolderSystemKeyUpload, category: model.AssetCategoryOther, sourceType: model.AssetSourceManualUpload},
		{name: "workbench", context: AssetRegistrationContext{SourceType: model.AssetSourceImageWorkbench}, systemKey: model.AssetFolderSystemKeyImageWorkbenchMonth, parentKey: model.AssetFolderSystemKeyImageWorkbench, category: model.AssetCategoryOther, sourceType: model.AssetSourceImageWorkbench},
		{name: "canvas", context: AssetRegistrationContext{SourceType: model.AssetSourceCanvas, SourceProjectID: "canvas_1", SourceProjectName: "第一画布"}, systemKey: model.AssetFolderSystemKeyCanvasProjectDate, parentKey: model.AssetFolderSystemKeyCanvasProject, category: model.AssetCategoryOther, sourceType: model.AssetSourceCanvas},
		{name: "comic", context: AssetRegistrationContext{SourceType: model.AssetSourceComicBatch, SourceProjectID: "comic_1", SourceProjectName: "第一漫剧", Category: model.AssetCategoryCharacter}, systemKey: model.AssetFolderSystemKeyComicCategory, parentKey: model.AssetFolderSystemKeyComicProject, category: model.AssetCategoryCharacter, sourceType: model.AssetSourceComicBatch},
		{name: "legacy", context: AssetRegistrationContext{SourceType: model.AssetSourceLegacy}, systemKey: model.AssetFolderSystemKeyUnsorted, category: model.AssetCategoryOther, sourceType: model.AssetSourceLegacy},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resolved, err := fx.service.ResolveRegistration("user_a", WorkspaceScopePersonal, tc.context)
			if err != nil {
				t.Fatal(err)
			}
			folder, err := fx.service.Get(resolved.FolderID, "user_a", WorkspaceScopePersonal)
			if err != nil {
				t.Fatal(err)
			}
			if folder.SystemKey != tc.systemKey || resolved.Category != tc.category || resolved.SourceType != tc.sourceType {
				t.Fatalf("resolved=%+v folder=%+v", resolved, folder)
			}
			if tc.parentKey != "" {
				parent, err := fx.service.Get(folder.ParentID, "user_a", WorkspaceScopePersonal)
				if err != nil || parent.SystemKey != tc.parentKey {
					t.Fatalf("parent=%+v err=%v", parent, err)
				}
			}
		})
	}
}

func TestEnsureCanvasArchiveFolderAtUsesBusinessTimezone(t *testing.T) {
	fx := newAssetFolderFixture()
	if err := fx.service.SetArchiveTimezone("Asia/Shanghai"); err != nil {
		t.Fatal(err)
	}
	folder, err := fx.service.EnsureCanvasArchiveFolderAt("user_a", WorkspaceScopePersonal, "canvas_1", "第一画布", time.Date(2026, 8, 10, 16, 30, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if folder.SystemKey != model.AssetFolderSystemKeyCanvasProjectDate || folder.Name != "2026-08-11" || folder.SourceRefID != "canvas_1:2026-08-11" {
		t.Fatalf("archive folder = %+v", folder)
	}
}

func TestAssetRegistrationSanitizesSourceMetadata(t *testing.T) {
	fx := newAssetFolderFixture()
	resolved, err := fx.service.ResolveRegistration("user_a", WorkspaceScopePersonal, AssetRegistrationContext{
		SourceType: model.AssetSourceCanvas,
		SourceMetadata: map[string]any{
			"node_id": "node_1", "candidate_index": 2, "api_key": "must-not-persist",
			"provider": map[string]any{"secret": "must-not-persist"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if resolved.SourceMetadata["node_id"] != "node_1" || resolved.SourceMetadata["candidate_index"] != 2 {
		t.Fatalf("safe metadata missing: %+v", resolved.SourceMetadata)
	}
	if _, exists := resolved.SourceMetadata["api_key"]; exists {
		t.Fatalf("secret metadata persisted: %+v", resolved.SourceMetadata)
	}
	if _, exists := resolved.SourceMetadata["provider"]; exists {
		t.Fatalf("nested provider metadata persisted: %+v", resolved.SourceMetadata)
	}
}

func TestAssetLibraryDateFilterUsesInclusiveBounds(t *testing.T) {
	// Keep the boundary behavior explicit even though Memory timestamps are
	// generated by the repository: this catches accidental strict comparisons.
	fx := newAssetFolderFixture()
	asset, err := fx.assets.Create(model.Asset{ID: "asset_date", UserID: "user_a", WorkspaceID: WorkspaceIDForScope(WorkspaceScopePersonal, "user_a"), Type: "image", Name: "日期图"})
	if err != nil {
		t.Fatal(err)
	}
	items, total, err := fx.assets.ListLibrary(repository.AssetLibraryFilter{
		WorkspaceID: asset.WorkspaceID, CreatedFrom: timePointer(asset.CreatedAt), CreatedTo: timePointer(asset.CreatedAt), Page: 1, PageSize: 10,
	})
	if err != nil || total != 1 || len(items) != 1 {
		t.Fatalf("inclusive date result total=%d items=%d err=%v", total, len(items), err)
	}
}

func timePointer(value time.Time) *time.Time { return &value }
