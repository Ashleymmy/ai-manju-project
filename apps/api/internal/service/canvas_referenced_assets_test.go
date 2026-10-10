package service

import (
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

func TestCopiedCanvasFolderListsReusedAssets(t *testing.T) {
	projects, folders, assets := repository.NewMemoryProjectRepository(), repository.NewMemoryAssetFolderRepository(), repository.NewMemoryAssetRepository()
	references := repository.NewMemoryAssetReferenceRepository()
	user := "reused_" + randomHex(6)
	workspace := WorkspaceIDForScope(WorkspaceScopePersonal, user)
	folderService := NewAssetFolderService(folders, assets)
	folderService.SetProjectRepository(projects)
	folderService.SetAssetReferenceRepository(references)
	projectService := NewProjectService(projects)
	projectService.SetAssetFolderService(folderService)
	assetService := NewAssetService(assets, nil)
	assetService.SetFolderService(folderService)

	original, err := projectService.Create(user, WorkspaceScopePersonal, CreateProjectInput{Title: "模板1"})
	if err != nil {
		t.Fatal(err)
	}
	copied, err := projectService.Create(user, WorkspaceScopePersonal, CreateProjectInput{Title: "模板1（副本）"})
	if err != nil {
		t.Fatal(err)
	}
	category := func(projectID string, key string) string {
		folder, err := folders.FindSystem(workspace, model.AssetFolderSystemKeyCanvasCategory, projectID+":"+key)
		if err != nil {
			t.Fatal(err)
		}
		return folder.ID
	}
	create := func(id string, folderID string, assetCategory string) {
		if _, err := assets.Create(model.Asset{ID: id, UserID: user, WorkspaceID: workspace, Type: "image", URL: "/" + id + ".png", FolderID: folderID, Category: assetCategory, Tags: model.JSONB("[]")}); err != nil {
			t.Fatal(err)
		}
	}
	create("hero", category(original.ID, model.AssetCategoryCharacter), model.AssetCategoryCharacter)
	create("ref", category(original.ID, model.AssetCategoryOther), model.AssetCategoryReference)
	create("own", category(copied.ID, model.AssetCategoryCharacter), model.AssetCategoryCharacter)
	create("dropped", category(original.ID, model.AssetCategoryProp), model.AssetCategoryProp)
	now := time.Now().UTC()
	if _, err := assets.TrashByWorkspace([]string{"dropped"}, workspace, user, now, now.Add(model.AssetTrashRetention)); err != nil {
		t.Fatal(err)
	}
	if err := references.ReplaceForSource(workspace, model.AssetReferenceTypeCanvasProject, original.ID, []string{"hero", "ref", "dropped"}); err != nil {
		t.Fatal(err)
	}
	if err := references.ReplaceForSource(workspace, model.AssetReferenceTypeCanvasProject, copied.ID, []string{"hero", "ref", "own", "dropped"}); err != nil {
		t.Fatal(err)
	}

	views, err := folderService.List(user, WorkspaceScopePersonal)
	if err != nil {
		t.Fatal(err)
	}
	counts := map[string][2]int64{}
	for _, view := range views {
		counts[view.ID] = [2]int64{view.AssetCount, view.DescendantAssetCount}
	}
	copiedFolder, err := folders.FindSystem(workspace, model.AssetFolderSystemKeyCanvasProject, copied.ID)
	if err != nil {
		t.Fatal(err)
	}
	originalFolder, err := folders.FindSystem(workspace, model.AssetFolderSystemKeyCanvasProject, original.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got := counts[category(copied.ID, model.AssetCategoryCharacter)]; got != [2]int64{2, 2} {
		t.Fatalf("copied 角色 counts = %v, want own + reused hero", got)
	}
	if got := counts[category(copied.ID, model.AssetCategoryOther)]; got != [2]int64{1, 1} {
		t.Fatalf("copied 其他 counts = %v, want the reused reference", got)
	}
	if got := counts[copiedFolder.ID][1]; got != 3 {
		t.Fatalf("copied canvas total = %d, want 3 (trashed reuse excluded)", got)
	}
	if got := counts[originalFolder.ID][1]; got != 2 {
		t.Fatalf("original canvas total = %d, want only its stored assets", got)
	}
	if got := counts[copiedFolder.ParentID][1]; got != 3 {
		t.Fatalf("canvas workshop total = %d, want each asset once", got)
	}

	list := func(folderID string, descendants bool) string {
		result, err := assetService.ListLibrary(user, WorkspaceScopePersonal, AssetLibraryInput{FolderID: folderID, IncludeDescendants: descendants, Page: 1, PageSize: 50})
		if err != nil {
			t.Fatal(err)
		}
		ids := make([]string, 0, len(result.Items))
		for _, item := range result.Items {
			ids = append(ids, item.ID)
		}
		sort.Strings(ids)
		if int(result.Total) != len(ids) {
			t.Fatalf("total %d does not match %d items", result.Total, len(ids))
		}
		return strings.Join(ids, ",")
	}
	if got := list(copiedFolder.ID, true); got != "hero,own,ref" {
		t.Fatalf("copied canvas listing = %s", got)
	}
	if got := list(category(copied.ID, model.AssetCategoryCharacter), false); got != "hero,own" {
		t.Fatalf("copied 角色 listing = %s", got)
	}
	if got := list(originalFolder.ID, true); got != "hero,ref" {
		t.Fatalf("original canvas listing = %s", got)
	}
	stored, err := assets.GetByWorkspace("hero", workspace)
	if err != nil || stored.FolderID != category(original.ID, model.AssetCategoryCharacter) {
		t.Fatalf("reused asset moved: %+v err=%v", stored, err)
	}
}
