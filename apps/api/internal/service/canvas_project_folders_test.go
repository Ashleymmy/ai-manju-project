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
	if len(children) != 3 || children["角色"] != 1 || children["场景"] != 1 || children["道具"] != 1 {
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
			if err != nil || len(items) != 10 {
				t.Fatalf("idempotent legacy folders = %d, err=%v", len(items), err)
			}
		})
	}
}

var errCanvasFolderInjectedFailure = errors.New("injected category write failure")

func canvasJSONEqual(first, second model.JSONB) bool {
	var a, b any
	return json.Unmarshal(first, &a) == nil && json.Unmarshal(second, &b) == nil && reflect.DeepEqual(a, b)
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
