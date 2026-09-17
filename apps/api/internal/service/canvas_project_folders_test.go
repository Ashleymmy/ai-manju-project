package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestCanvasProjectLibraryParity(t *testing.T) {
	for _, driver := range []string{"memory", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			projects, folders, assets := canvasLibraryRepositories(t, driver)
			user := "canvas_link_" + randomHex(6)
			workspace := WorkspaceIDForScope(WorkspaceScopePersonal, user)
			folderService := NewAssetFolderService(folders, assets)
			newService := func() *ProjectService {
				svc := NewProjectService(projects)
				svc.SetAssetFolderService(folderService)
				return svc
			}
			svc := newService()
			create := func(title string) model.Project {
				t.Helper()
				data := model.JSONB(`{"nodes":[{"id":"keep-this-node"}]}`)
				project, err := svc.Create(user, WorkspaceScopePersonal, CreateProjectInput{Title: title, Data: &data})
				if err != nil {
					t.Fatal(err)
				}
				snapshot, err := svc.GetSnapshot(project.ID, user, WorkspaceScopePersonal)
				if err != nil || snapshot.Version != 1 || !canvasJSONEqual(snapshot.Data, data) {
					t.Fatalf("initial snapshot = %+v, err=%v", snapshot, err)
				}
				assertCanvasFolderTree(t, folders, project)
				return project
			}

			// Legacy personal canvases without a workspace must reserve their title.
			if _, err := projects.Create(model.Project{ID: "legacy_" + user, OwnerID: user, Title: DefaultCanvasTitle + "1"}); err != nil {
				t.Fatal(err)
			}
			legacyArchive, err := folderService.EnsureCanvasArchiveFolderAt(user, WorkspaceScopePersonal, "legacy_"+user, DefaultCanvasTitle+"1", time.Now())
			if err != nil {
				t.Fatal(err)
			}
			first := create("  " + DefaultCanvasTitle + "  ")
			second := create(DefaultCanvasTitle)
			if first.Title != DefaultCanvasTitle+"2" || second.Title != DefaultCanvasTitle+"3" {
				t.Fatalf("default titles = %q / %q", first.Title, second.Title)
			}
			firstFolder := assertCanvasFolderTree(t, folders, first)
			child, err := folders.FindSystem(workspace, model.AssetFolderSystemKeyCanvasCategory, first.ID+":"+model.AssetCategoryCharacter)
			if err != nil {
				t.Fatal(err)
			}
			asset, err := assets.Create(model.Asset{ID: "asset_" + user, UserID: user, WorkspaceID: workspace, Type: "image", URL: "/unchanged.png", FolderID: child.ID})
			if err != nil {
				t.Fatal(err)
			}
			// Duplicate, long and punctuation-containing custom titles retain the public API behavior.
			customTitle := "镜头 / 角色\\ " + strings.Repeat("长标题", 40)
			create(customTitle)
			create(customTitle)
			for _, title := range []string{customTitle, "重命名画布", "重命名画布"} {
				updated, err := svc.Update(first.ID, user, WorkspaceScopePersonal, UpdateProjectInput{Title: &title})
				if err != nil {
					t.Fatal(err)
				}
				if got := assertCanvasFolderTree(t, folders, updated); got.ID != firstFolder.ID || got.Name != title {
					t.Fatalf("rename changed folder identity: %+v", got)
				}
			}
			// In-flight generation may still carry the old title. Reuse the linked folder.
			archive, err := folderService.EnsureCanvasArchiveFolderAt(user, WorkspaceScopePersonal, first.ID, first.Title, time.Now())
			if err != nil || archive.ParentID != firstFolder.ID {
				t.Fatalf("late archive = %+v, err=%v", archive, err)
			}
			loadedFolder, _ := folders.GetByWorkspace(firstFolder.ID, workspace)
			if loadedFolder.Name != "重命名画布" {
				t.Fatalf("late job reverted name: %q", loadedFolder.Name)
			}
			loadedAsset, err := assets.GetByWorkspace(asset.ID, workspace)
			if err != nil || loadedAsset.FolderID != child.ID || loadedAsset.URL != asset.URL {
				t.Fatalf("rename disturbed asset: %+v, err=%v", loadedAsset, err)
			}
			// The same API used by the canvas archive action can reclassify an
			// already-uploaded asset without creating a duplicate or changing its URL.
			other, err := folders.FindSystem(workspace, model.AssetFolderSystemKeyCanvasCategory, first.ID+":"+model.AssetCategoryOther)
			if err != nil {
				t.Fatal(err)
			}
			assetService := NewAssetService(assets, nil)
			assetService.SetFolderService(folderService)
			category := model.AssetCategoryOther
			reclassified, err := assetService.UpdateMetadata(asset.ID, user, WorkspaceScopePersonal, AssetMetadataInput{FolderID: &other.ID, Category: &category})
			if err != nil || reclassified.ID != asset.ID || reclassified.FolderID != other.ID || reclassified.Category != category || reclassified.URL != asset.URL {
				t.Fatalf("reclassified asset = %+v, err=%v", reclassified, err)
			}
			if _, err := svc.Update(first.ID, user+"_other", WorkspaceScopePersonal, UpdateProjectInput{Title: &customTitle}); !errors.Is(err, repository.ErrNotFound) {
				t.Fatalf("cross-workspace rename = %v", err)
			}
			if err := svc.Delete(second.ID, user, WorkspaceScopePersonal); err != nil {
				t.Fatal(err)
			}
			// Free names can be reused, but retained archive folders still reserve theirs.
			reused := create(DefaultCanvasTitle)
			if reused.Title != DefaultCanvasTitle+"2" {
				t.Fatalf("free name = %q", reused.Title)
			}
			next := create(DefaultCanvasTitle)
			if next.Title != DefaultCanvasTitle+"4" {
				t.Fatalf("archived name was reused: %q", next.Title)
			}

			// Separate service instances represent concurrent requests/API replicas.
			const workers = 12
			var wait sync.WaitGroup
			results := make(chan model.Project, workers)
			errorsByWorker := make(chan error, workers)
			for i := 0; i < workers; i++ {
				wait.Add(1)
				go func() {
					defer wait.Done()
					project, err := newService().Create(user, WorkspaceScopePersonal, CreateProjectInput{Title: DefaultCanvasTitle})
					results <- project
					errorsByWorker <- err
				}()
			}
			wait.Wait()
			close(results)
			close(errorsByWorker)
			for err := range errorsByWorker {
				if err != nil {
					t.Fatal(err)
				}
			}
			seen := map[string]bool{}
			for project := range results {
				if seen[project.Title] {
					t.Fatalf("concurrent duplicate title: %q", project.Title)
				}
				seen[project.Title] = true
				assertCanvasFolderTree(t, folders, project)
			}
			for i := 5; i < 5+workers; i++ {
				if !seen[fmt.Sprintf("%s%d", DefaultCanvasTitle, i)] {
					t.Fatalf("missing allocated number %d: %+v", i, seen)
				}
			}
			// Numbering and folders are independent across personal/team spaces.
			for _, scope := range []string{WorkspaceScopePersonal, WorkspaceScopeTeam} {
				isolated, err := svc.Create(user+"_other", scope, CreateProjectInput{Title: DefaultCanvasTitle})
				if err != nil || isolated.Title != DefaultCanvasTitle+"1" {
					t.Fatalf("scope %s title = %q, err=%v", scope, isolated.Title, err)
				}
				assertCanvasFolderTree(t, folders, isolated)
			}
			teamSecond, err := svc.Create(user, WorkspaceScopeTeam, CreateProjectInput{Title: DefaultCanvasTitle})
			if err != nil || teamSecond.Title != DefaultCanvasTitle+"2" {
				t.Fatalf("shared team sequence = %q, err=%v", teamSecond.Title, err)
			}
			assertCanvasFolderTree(t, folders, teamSecond)
			// Renaming an older canvas adopts its original archive, preserving date folders.
			legacyTitle := "历史画布改名"
			legacy, err := svc.Update("legacy_"+user, user, WorkspaceScopePersonal, UpdateProjectInput{Title: &legacyTitle})
			if err != nil {
				t.Fatal(err)
			}
			if folder := assertCanvasFolderTree(t, folders, legacy); folder.ID != legacyArchive.ParentID {
				t.Fatalf("legacy rename replaced original archive: %+v", folder)
			}
			if _, err := folders.GetByWorkspace(legacyArchive.ID, workspace); err != nil {
				t.Fatalf("legacy date folder lost: %v", err)
			}
		})
	}
}

func assertCanvasFolderTree(t *testing.T, repo repository.AssetFolderRepository, project model.Project) model.AssetFolder {
	t.Helper()
	folder, err := repo.FindSystem(project.WorkspaceID, model.AssetFolderSystemKeyCanvasProject, project.ID)
	if err != nil || folder.Name != project.Title {
		t.Fatalf("linked folder = %+v for %q, err=%v", folder, project.Title, err)
	}
	parent, err := repo.GetByWorkspace(folder.ParentID, project.WorkspaceID)
	if err != nil || parent.SystemKey != model.AssetFolderSystemKeyCanvas {
		t.Fatalf("canvas parent = %+v, err=%v", parent, err)
	}
	all, err := repo.ListByWorkspace(project.WorkspaceID)
	if err != nil {
		t.Fatal(err)
	}
	children := map[string]int{}
	for _, item := range all {
		if item.ParentID == folder.ID && item.SystemKey == model.AssetFolderSystemKeyCanvasCategory {
			children[item.Name]++
		}
	}
	if len(children) != 4 || children["角色"] != 1 || children["场景"] != 1 || children["道具"] != 1 || children["其他"] != 1 {
		t.Fatalf("category children = %+v", children)
	}
	return folder
}

func TestCanvasProjectLibraryRollbackParity(t *testing.T) {
	for _, driver := range []string{"memory", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			projects, folders, assets := canvasLibraryRepositories(t, driver)
			user := "canvas_rollback_" + randomHex(6)
			workspace := WorkspaceIDForScope(WorkspaceScopePersonal, user)
			folderService := NewAssetFolderService(folders, assets)
			svc := NewProjectService(projects)
			svc.SetAssetFolderService(folderService)
			failing := NewProjectService(failingCanvasProjectRepository{ProjectRepository: projects})
			failing.SetAssetFolderService(folderService)
			data := model.JSONB(`{"nodes":[{"id":"preserved"}]}`)
			if _, err := failing.Create(user, WorkspaceScopePersonal, CreateProjectInput{Title: DefaultCanvasTitle, Data: &data}); !errors.Is(err, errCanvasFolderInjectedFailure) {
				t.Fatalf("create error = %v", err)
			}
			list, err := projects.ListByWorkspace(workspace)
			if err != nil || len(list) != 0 {
				t.Fatalf("failed create left projects: %+v, err=%v", list, err)
			}
			folderList, err := folders.ListByWorkspace(workspace)
			if err != nil || len(folderList) != 0 {
				t.Fatalf("failed create left folders: %+v, err=%v", folderList, err)
			}
			project, err := svc.Create(user, WorkspaceScopePersonal, CreateProjectInput{Title: DefaultCanvasTitle, Data: &data})
			if err != nil || project.Title != DefaultCanvasTitle+"1" {
				t.Fatalf("retry = %+v, err=%v", project, err)
			}
			originalFolder := assertCanvasFolderTree(t, folders, project)
			title := "不得部分保存"
			if _, err := failing.Update(project.ID, user, WorkspaceScopePersonal, UpdateProjectInput{Title: &title}); !errors.Is(err, errCanvasFolderInjectedFailure) {
				t.Fatalf("rename error = %v", err)
			}
			loaded, err := projects.GetByWorkspace(project.ID, workspace)
			if err != nil || loaded.Title != project.Title || !canvasJSONEqual(loaded.Data, data) {
				t.Fatalf("failed rename changed project: %+v, err=%v", loaded, err)
			}
			if folder := assertCanvasFolderTree(t, folders, loaded); folder.ID != originalFolder.ID {
				t.Fatalf("failed rename replaced folder: %+v", folder)
			}
			// Concurrent successful renames must leave the same final name on both records.
			var wait sync.WaitGroup
			errorsByWorker := make(chan error, 8)
			for index := 0; index < cap(errorsByWorker); index++ {
				wait.Add(1)
				go func(index int) {
					defer wait.Done()
					title := fmt.Sprintf("并发改名%d", index)
					_, err := svc.Update(project.ID, user, WorkspaceScopePersonal, UpdateProjectInput{Title: &title})
					errorsByWorker <- err
				}(index)
			}
			wait.Wait()
			close(errorsByWorker)
			for err := range errorsByWorker {
				if err != nil {
					t.Fatal(err)
				}
			}
			loaded, err = projects.GetByWorkspace(project.ID, workspace)
			if err != nil || !canvasJSONEqual(loaded.Data, data) {
				t.Fatalf("concurrent rename lost canvas: %+v, err=%v", loaded, err)
			}
			assertCanvasFolderTree(t, folders, loaded)
		})
	}
}

func TestOpeningLegacyCanvasEnsuresLibraryParity(t *testing.T) {
	for _, driver := range []string{"memory", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			projects, folders, assets := canvasLibraryRepositories(t, driver)
			user := "legacy_open_" + randomHex(6)
			workspace := WorkspaceIDForScope(WorkspaceScopePersonal, user)
			original, err := projects.Create(model.Project{ID: "legacy_" + user, OwnerID: user, Title: "未命名画布"})
			if err != nil {
				t.Fatal(err)
			}
			data := model.JSONB(`{"nodes":[{"id":"existing-content"}]}`)
			if _, err := projects.UpsertSnapshot(model.CanvasSnapshot{ProjectID: original.ID, Data: data}); err != nil {
				t.Fatal(err)
			}
			before, err := projects.Get(original.ID)
			if err != nil {
				t.Fatal(err)
			}
			svc := NewProjectService(projects)
			svc.SetAssetFolderService(NewAssetFolderService(folders, assets))
			if _, err := svc.Get(original.ID, user+"_other", WorkspaceScopePersonal); !errors.Is(err, repository.ErrNotFound) {
				t.Fatalf("unauthorized legacy open = %v", err)
			}
			for index := 0; index < 2; index++ {
				loaded, err := svc.Get(original.ID, user, WorkspaceScopePersonal)
				if err != nil || loaded.Title != original.Title || !canvasJSONEqual(loaded.Data, data) || !loaded.UpdatedAt.Equal(before.UpdatedAt) {
					t.Fatalf("open altered legacy canvas: %+v, err=%v", loaded, err)
				}
				loaded.WorkspaceID = workspace
				assertCanvasFolderTree(t, folders, loaded)
			}
			items, err := folders.ListByWorkspace(workspace)
			if err != nil || len(items) != 11 {
				t.Fatalf("idempotent legacy folders = %d, err=%v", len(items), err)
			}
			// A canvas created before the fallback category existed is upgraded
			// in place when reopened. Existing category IDs stay stable.
			other, err := folders.FindSystem(workspace, model.AssetFolderSystemKeyCanvasCategory, original.ID+":"+model.AssetCategoryOther)
			if err != nil {
				t.Fatal(err)
			}
			if err := folders.DeleteByIDs([]string{other.ID}, workspace); err != nil {
				t.Fatal(err)
			}
			if _, err := svc.Get(original.ID, user, WorkspaceScopePersonal); err != nil {
				t.Fatal(err)
			}
			for _, previous := range items {
				if previous.ID == other.ID {
					continue
				}
				if _, err := folders.GetByWorkspace(previous.ID, workspace); err != nil {
					t.Fatalf("category upgrade lost existing folder %s: %v", previous.ID, err)
				}
			}
			upgraded := original
			upgraded.WorkspaceID = workspace
			assertCanvasFolderTree(t, folders, upgraded)
		})
	}
}

var errCanvasFolderInjectedFailure = errors.New("injected category write failure")

func TestListingCanvasFoldersRepairsMissingCategoriesParity(t *testing.T) {
	for _, driver := range []string{"memory", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			projects, folders, assets := canvasLibraryRepositories(t, driver)
			user := "list_categories_" + randomHex(6)
			workspace := WorkspaceIDForScope(WorkspaceScopePersonal, user)
			folderService := NewAssetFolderService(folders, assets)
			svc := NewProjectService(projects)
			svc.SetAssetFolderService(folderService)
			project, err := svc.Create(user, WorkspaceScopePersonal, CreateProjectInput{Title: "历史画布"})
			if err != nil {
				t.Fatal(err)
			}
			linked := assertCanvasFolderTree(t, folders, project)
			other, err := folders.FindSystem(workspace, model.AssetFolderSystemKeyCanvasCategory, project.ID+":"+model.AssetCategoryOther)
			if err != nil {
				t.Fatal(err)
			}
			// Simulate the old three-category tree, with a real asset still present.
			if err := folders.DeleteByIDs([]string{other.ID}, workspace); err != nil {
				t.Fatal(err)
			}
			asset, err := assets.Create(model.Asset{ID: "asset_" + user, UserID: user, WorkspaceID: workspace, Type: "image", FolderID: linked.ID, URL: "/preserved.png"})
			if err != nil {
				t.Fatal(err)
			}
			var repairedID string
			for index := 0; index < 2; index++ {
				items, err := folderService.List(user, WorkspaceScopePersonal)
				if err != nil {
					t.Fatal(err)
				}
				found := false
				for _, item := range items {
					if item.ParentID == linked.ID && item.SystemKey == model.AssetFolderSystemKeyCanvasCategory && item.Name == "其他" {
						if repairedID != "" && repairedID != item.ID {
							t.Fatal("listing duplicated the fallback category")
						}
						repairedID, found = item.ID, true
					}
				}
				if !found {
					t.Fatal("listing omitted the repaired fallback category")
				}
				assertCanvasFolderTree(t, folders, project)
			}
			loaded, err := assets.GetByWorkspace(asset.ID, workspace)
			if err != nil || loaded.FolderID != repairedID || loaded.URL != asset.URL {
				t.Fatalf("repair did not adopt the unclassified asset: %+v, err=%v", loaded, err)
			}
		})
	}
}

func canvasJSONEqual(first, second model.JSONB) bool {
	var a, b any
	return json.Unmarshal(first, &a) == nil && json.Unmarshal(second, &b) == nil && reflect.DeepEqual(a, b)
}

func TestCanvasDefaultAssetDestinationParity(t *testing.T) {
	for _, driver := range []string{"memory", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			projects, folders, assets := canvasLibraryRepositories(t, driver)
			user := "default_assets_" + randomHex(6)
			workspace := WorkspaceIDForScope(WorkspaceScopePersonal, user)
			folderService := NewAssetFolderService(folders, assets)
			svc := NewProjectService(projects)
			svc.SetAssetFolderService(folderService)
			project, err := svc.Create(user, WorkspaceScopePersonal, CreateProjectInput{Title: "相同画布 / " + strings.Repeat("长", 100)})
			if err != nil {
				t.Fatal(err)
			}
			linked := assertCanvasFolderTree(t, folders, project)
			other, err := folders.FindSystem(workspace, model.AssetFolderSystemKeyCanvasCategory, project.ID+":"+model.AssetCategoryOther)
			if err != nil {
				t.Fatal(err)
			}
			for _, category := range []string{"", model.AssetCategoryOther, model.AssetCategoryReference, model.AssetCategoryCharacter, model.AssetCategoryEnvironment, model.AssetCategoryProp} {
				resolved, err := folderService.ResolveRegistration(user, WorkspaceScopePersonal, AssetRegistrationContext{
					SourceType: model.AssetSourceCanvas, SourceProjectID: project.ID, SourceProjectName: project.Title, Category: category,
				})
				if err != nil {
					t.Fatal(err)
				}
				want := category
				if want == "" || want == model.AssetCategoryReference {
					want = model.AssetCategoryOther
				}
				folder, err := folders.GetByWorkspace(resolved.FolderID, workspace)
				if err != nil || folder.ParentID != linked.ID || folder.SourceRefID != project.ID+":"+want || resolved.Category != want {
					t.Fatalf("canvas category %q = %+v, folder=%+v, err=%v", category, resolved, folder, err)
				}
			}
			all, err := folders.ListByWorkspace(workspace)
			if err != nil {
				t.Fatal(err)
			}
			for _, folder := range all {
				if folder.SystemKey == model.AssetFolderSystemKeyCanvasProjectDate {
					t.Fatal("new registration created a date folder")
				}
			}
			role, _ := folders.FindSystem(workspace, model.AssetFolderSystemKeyCanvasCategory, project.ID+":"+model.AssetCategoryCharacter)
			explicit, err := folderService.ResolveRegistration(user, WorkspaceScopePersonal, AssetRegistrationContext{
				SourceType: model.AssetSourceCanvas, SourceProjectID: project.ID, FolderID: role.ID, Category: model.AssetCategoryCharacter,
			})
			if err != nil || explicit.FolderID != role.ID {
				t.Fatalf("explicit destination reset: %+v, err=%v", explicit, err)
			}
			date := createLegacyDateFolder(t, folderService, linked, model.AssetFolderSystemKeyCanvasProjectDate, "2026-09-10")
			for _, folder := range []model.AssetFolder{linked, date, role} {
				_, err := assets.Create(model.Asset{ID: "asset_" + folder.ID, UserID: user, WorkspaceID: workspace, Type: "image", FolderID: folder.ID, URL: "/" + folder.ID + ".png"})
				if err != nil {
					t.Fatal(err)
				}
			}
			for i := 0; i < 2; i++ {
				views, err := folderService.List(user, WorkspaceScopePersonal)
				if err != nil {
					t.Fatal(err)
				}
				for _, folder := range []model.AssetFolder{linked, date, role} {
					asset, err := assets.GetByWorkspace("asset_"+folder.ID, workspace)
					want := other.ID
					if folder.ID == role.ID {
						want = role.ID
					}
					if err != nil || asset.FolderID != want || asset.URL != "/"+folder.ID+".png" {
						t.Fatalf("legacy asset = %+v, err=%v", asset, err)
					}
				}
				for _, view := range views {
					if view.ID == other.ID && view.AssetCount != 2 {
						t.Fatalf("other count=%d", view.AssetCount)
					}
				}
			}
		})
	}
}

type failingCanvasProjectRepository struct{ repository.ProjectRepository }

func (r failingCanvasProjectRepository) WithWorkspaceTransaction(workspace string, folders repository.AssetFolderRepository, fn func(repository.ProjectRepository, repository.AssetFolderRepository) error) error {
	return r.ProjectRepository.WithWorkspaceTransaction(workspace, folders, func(projects repository.ProjectRepository, folders repository.AssetFolderRepository) error {
		return fn(projects, failingCanvasFolderRepository{folders})
	})
}

type failingCanvasFolderRepository struct {
	repository.AssetFolderRepository
}

func (r failingCanvasFolderRepository) EnsureSystem(folder model.AssetFolder) (model.AssetFolder, error) {
	// Fail after the project, snapshot, parent and first two categories have been written.
	if folder.SystemKey == model.AssetFolderSystemKeyCanvasCategory && strings.HasSuffix(folder.SourceRefID, ":"+model.AssetCategoryProp) {
		return model.AssetFolder{}, errCanvasFolderInjectedFailure
	}
	return r.AssetFolderRepository.EnsureSystem(folder)
}

// Use an isolated PostgreSQL schema per scenario, including shared-team tests.
func canvasLibraryRepositories(t *testing.T, driver string) (repository.ProjectRepository, repository.AssetFolderRepository, repository.AssetRepository) {
	t.Helper()
	if driver == "memory" {
		return repository.NewMemoryProjectRepository(), repository.NewMemoryAssetFolderRepository(), repository.NewMemoryAssetRepository()
	}
	dsn := os.Getenv("ASSET_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("ASSET_TEST_DATABASE_URL is not configured")
	}
	admin, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	schema := "canvas_link_" + randomHex(8)
	if err := admin.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := admin.Exec("DROP SCHEMA " + schema + " CASCADE").Error; err != nil {
			t.Error(err)
		}
		if sqlDB, err := admin.DB(); err == nil {
			_ = sqlDB.Close()
		}
	})
	// Both keyword and URL DSNs are accepted by the existing integration harness.
	if strings.Contains(dsn, "://") {
		separator := "?"
		if strings.Contains(dsn, "?") {
			separator = "&"
		}
		dsn += separator + "search_path=" + schema
	} else {
		dsn += " search_path=" + schema
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if sqlDB, err := db.DB(); err == nil {
			_ = sqlDB.Close()
		}
	})
	if err := db.AutoMigrate(&model.Project{}, &model.CanvasSnapshot{}, &model.AssetFolder{}, &model.Asset{}); err != nil {
		t.Fatal(err)
	}
	return repository.NewGormProjectRepository(db), repository.NewGormAssetFolderRepository(db), repository.NewGormAssetRepository(db)
}
