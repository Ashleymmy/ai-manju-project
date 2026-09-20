package service

import (
	"errors"
	"reflect"
	"testing"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

func TestDeleteCanvasAssetFolderParity(t *testing.T) {
	for _, driver := range []string{"memory", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			for _, withAssets := range []bool{false, true} {
				name := "empty"
				if withAssets {
					name = "with_assets"
				}
				t.Run(name, func(t *testing.T) {
					projects, folders, assets := canvasLibraryRepositories(t, driver)
					user := "delete_canvas_" + randomHex(6)
					workspace := WorkspaceIDForScope(WorkspaceScopePersonal, user)
					svc := NewAssetFolderService(folders, assets)
					svc.SetProjectRepository(projects)
					projectService := NewProjectService(projects)
					projectService.SetAssetFolderService(svc)
					data := model.JSONB(`{"nodes":[{"id":"preserved"}]}`)
					project, err := projectService.Create(user, WorkspaceScopePersonal, CreateProjectInput{Title: DefaultCanvasTitle, Data: &data})
					if err != nil {
						t.Fatal(err)
					}
					linked := assertCanvasFolderTree(t, folders, project)
					defaults, err := svc.EnsureDefaults(user, WorkspaceScopePersonal)
					if err != nil {
						t.Fatal(err)
					}
					category, err := folders.FindSystem(workspace, model.AssetFolderSystemKeyCanvasCategory, project.ID+":"+model.AssetCategoryCharacter)
					if err != nil {
						t.Fatal(err)
					}
					legacy := createLegacyDateFolder(t, svc, linked, model.AssetFolderSystemKeyCanvasProjectDate, "2026-09-01")
					nested, err := svc.ensureUserChild(user, workspace, category, "候选", 0)
					if err != nil {
						t.Fatal(err)
					}
					var originals []model.Asset
					if withAssets {
						for _, folder := range []model.AssetFolder{linked, category, legacy, nested} {
							asset, err := assets.Create(model.Asset{
								ID: "asset_" + folder.ID, UserID: user, WorkspaceID: workspace,
								Name: "保留资产", Type: "image", URL: "/unchanged.png", FolderID: folder.ID,
								Category: model.AssetCategoryCharacter, SourceType: model.AssetSourceCanvas,
								SourceProjectID: project.ID, SourceJobID: "original_job",
							})
							if err != nil {
								t.Fatal(err)
							}
							// Compare persisted values, including PostgreSQL timestamp precision.
							asset, err = assets.GetByWorkspace(asset.ID, workspace)
							if err != nil {
								t.Fatal(err)
							}
							originals = append(originals, asset)
						}
					}
					// Fixed system folders, categories, and other workspaces remain protected.
					for _, protected := range []model.AssetFolder{defaults.Root, defaults.Unsorted, defaults.Upload, defaults.ImageWorkbench, defaults.Canvas, defaults.Comic, category} {
						if _, err := svc.Delete(protected.ID, user, WorkspaceScopePersonal); !errors.Is(err, repository.ErrAssetFolderProtected) {
							t.Fatalf("delete protected %s: %v", protected.SystemKey, err)
						}
					}
					if _, err := svc.Delete(linked.ID, "other_user", WorkspaceScopePersonal); !errors.Is(err, repository.ErrAssetFolderNotFound) {
						t.Fatalf("cross-workspace delete: %v", err)
					}
					if _, err := svc.Delete(linked.ID, user, WorkspaceScopePersonal); !errors.Is(err, ErrAssetFolderCanvasExists) {
						t.Fatalf("live canvas archive delete: %v", err)
					}
					preserved, err := projects.GetByWorkspace(project.ID, workspace)
					if err != nil || preserved.Title != project.Title || !canvasJSONEqual(preserved.Data, data) {
						t.Fatalf("rejected deletion changed canvas: %+v, err=%v", preserved, err)
					}
					snapshot, err := projectService.GetSnapshot(project.ID, user, WorkspaceScopePersonal)
					if err != nil || !canvasJSONEqual(snapshot.Data, data) {
						t.Fatalf("rejected deletion changed snapshot: %+v, err=%v", snapshot, err)
					}
					if err := projectService.Delete(project.ID, user, WorkspaceScopePersonal); err != nil {
						t.Fatal(err)
					}
					// A different canvas with the same title must not protect this orphan.
					if _, err := projects.Create(model.Project{ID: "unrelated_" + user, OwnerID: user, WorkspaceID: workspace, Title: project.Title}); err != nil {
						t.Fatal(err)
					}
					svc.SetActiveReferenceChecker(fixedAssetFolderReferenceChecker{active: true})
					if _, err := svc.Delete(linked.ID, user, WorkspaceScopePersonal); !errors.Is(err, repository.ErrAssetFolderInUse) {
						t.Fatalf("active output delete: %v", err)
					}
					for _, original := range originals {
						asset, err := assets.GetByWorkspace(original.ID, workspace)
						if err != nil || !reflect.DeepEqual(asset, original) {
							t.Fatalf("rejected deletion changed asset: %+v, err=%v", asset, err)
						}
					}
					svc.SetActiveReferenceChecker(nil)
					moved, err := svc.Delete(linked.ID, user, WorkspaceScopePersonal)
					if err != nil || moved != int64(len(originals)) {
						t.Fatalf("delete canvas archive: moved=%d, err=%v", moved, err)
					}
					for _, original := range originals {
						asset, err := assets.GetByWorkspace(original.ID, workspace)
						if err != nil {
							t.Fatal(err)
						}
						original.FolderID, original.UpdatedAt = defaults.Canvas.ID, asset.UpdatedAt
						if !reflect.DeepEqual(asset, original) {
							t.Fatalf("asset identity or metadata changed: got=%+v want=%+v", asset, original)
						}
					}
					// Refreshing the library must not recreate the deleted archive tree.
					listed, err := svc.List(user, WorkspaceScopePersonal)
					if err != nil || len(listed) != 6 {
						t.Fatalf("folders after refresh: %+v, err=%v", listed, err)
					}
					for _, id := range []string{linked.ID, category.ID, nested.ID, legacy.ID} {
						if _, err := svc.Get(id, user, WorkspaceScopePersonal); !errors.Is(err, repository.ErrAssetFolderNotFound) {
							t.Fatalf("deleted folder still exists: %s, err=%v", id, err)
						}
					}
					if _, err := projectService.Get(project.ID, user, WorkspaceScopePersonal); !errors.Is(err, repository.ErrNotFound) {
						t.Fatalf("deleted canvas reopened: %v", err)
					}
				})
			}
		})
	}
}

type failingFolderProjectRepository struct {
	repository.ProjectRepository
	err error
}

func (r failingFolderProjectRepository) GetByWorkspace(string, string) (model.Project, error) {
	return model.Project{}, r.err
}

func TestDeleteCanvasFolderDoesNotTreatLookupFailureAsDeletedProject(t *testing.T) {
	fx := newAssetFolderFixture()
	folder, err := fx.service.ensureCanvasProjectFolder("user", WorkspaceIDForScope(WorkspaceScopePersonal, "user"), "project", "画布")
	if err != nil {
		t.Fatal(err)
	}
	lookupErr := errors.New("database unavailable")
	fx.service.SetProjectRepository(failingFolderProjectRepository{err: lookupErr})
	if _, err := fx.service.Delete(folder.ID, "user", WorkspaceScopePersonal); !errors.Is(err, lookupErr) {
		t.Fatalf("lookup failure was ignored: %v", err)
	}
	if _, err := fx.service.Get(folder.ID, "user", WorkspaceScopePersonal); err != nil {
		t.Fatalf("lookup failure removed folder: %v", err)
	}
}
