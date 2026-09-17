package service

import (
	"errors"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

// Seed the historical schema directly; current registration must never create it.
func createLegacyDateFolder(t *testing.T, svc *AssetFolderService, parent model.AssetFolder, key, name string) model.AssetFolder {
	t.Helper()
	folder, err := svc.ensureSystemFolder(parent.CreatedBy, parent.WorkspaceID, parent.ID, name, key, key, parent.SourceRefID+":"+name, 0)
	if err != nil {
		t.Fatal(err)
	}
	return folder
}

func TestRetiredDateFoldersPreserveAssetsParity(t *testing.T) {
	for _, driver := range []string{"memory", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			_, folders, assets := canvasLibraryRepositories(t, driver)
			user := "retired_dates_" + randomHex(6)
			workspace := WorkspaceIDForScope(WorkspaceScopePersonal, user)
			svc := NewAssetFolderService(folders, assets)
			library := NewAssetService(assets, nil)
			library.SetFolderService(svc)
			defaults, err := svc.EnsureDefaults(user, WorkspaceScopePersonal)
			if err != nil {
				t.Fatal(err)
			}
			other, err := svc.EnsureCanvasArchiveFolderAt(user, WorkspaceScopePersonal, "canvas_dates", "画布", time.Now())
			if err != nil {
				t.Fatal(err)
			}
			project, err := folders.GetByWorkspace(other.ParentID, workspace)
			if err != nil {
				t.Fatal(err)
			}
			unassigned, err := svc.EnsureCanvasArchiveFolderAt(user, WorkspaceScopePersonal, "", "", time.Now())
			if err != nil {
				t.Fatal(err)
			}
			manual, err := svc.Create(user, WorkspaceScopePersonal, AssetFolderCreateInput{Name: "2026-09-16"})
			if err != nil {
				t.Fatal(err)
			}
			cases := []struct {
				parent, target model.AssetFolder
				key, date      string
			}{
				{defaults.ImageWorkbench, defaults.ImageWorkbench, model.AssetFolderSystemKeyImageWorkbenchMonth, "2026-09"},
				{project, other, model.AssetFolderSystemKeyCanvasProjectDate, "2026-09-15"},
				{unassigned, unassigned, model.AssetFolderSystemKeyCanvasProjectDate, "2026-09-16"},
			}
			for _, tc := range cases {
				t.Run(tc.key+tc.parent.ID, func(t *testing.T) {
					date := createLegacyDateFolder(t, svc, tc.parent, tc.key, tc.date)
					nested, err := svc.ensureUserChild(user, workspace, date, "保留子目录", 0)
					if err != nil {
						t.Fatal(err)
					}
					createAsset := func(suffix, folderID string) model.Asset {
						t.Helper()
						asset, err := assets.Create(model.Asset{ID: "asset_" + date.ID + suffix, UserID: user, WorkspaceID: workspace,
							Type: "image", FolderID: folderID, URL: "/preserved-" + suffix + ".png", Category: model.AssetCategoryOther})
						if err != nil {
							t.Fatal(err)
						}
						return asset
					}
					original := createAsset("original", date.ID)
					trashed := createAsset("trashed", date.ID)
					childAsset := createAsset("nested", nested.ID)
					if _, err := library.BulkTrash([]string{trashed.ID}, user, WorkspaceScopePersonal); err != nil {
						t.Fatal(err)
					}
					for i := 0; i < 2; i++ {
						views, err := svc.List(user, WorkspaceScopePersonal)
						if err != nil {
							t.Fatal(err)
						}
						foundManual, foundNested, foundTarget := false, false, false
						for _, view := range views {
							if isLegacyDateFolder(view.AssetFolder) {
								t.Fatalf("retired folder remains visible: %+v", view)
							}
							if view.ID == manual.ID {
								foundManual = true
							}
							if view.ID == nested.ID {
								foundNested = view.ParentID == tc.parent.ID
							}
							if view.ID == tc.target.ID {
								foundTarget = view.AssetCount == 1
							}
						}
						if !foundManual || !foundNested || !foundTarget {
							t.Fatalf("lost folder or count: manual=%v nested=%v target=%v", foundManual, foundNested, foundTarget)
						}
					}
					loaded, err := assets.GetByWorkspace(original.ID, workspace)
					if err != nil || loaded.FolderID != tc.target.ID || loaded.URL != original.URL {
						t.Fatalf("lost/mutated original asset: %+v err=%v", loaded, err)
					}
					child, err := assets.GetByWorkspace(childAsset.ID, workspace)
					if err != nil || child.FolderID != nested.ID {
						t.Fatalf("nested asset moved: %+v err=%v", child, err)
					}
					// A queued worker may finish after the directories have been retired.
					late := createAsset("late", date.ID)
					for _, queryID := range []string{tc.target.ID, date.ID} {
						page, err := library.ListLibrary(user, WorkspaceScopePersonal, AssetLibraryInput{FolderID: queryID})
						if err != nil || page.Total != 2 {
							t.Fatalf("late result hidden: total=%d err=%v", page.Total, err)
						}
					}
					page, err := library.ListLibrary(user, WorkspaceScopePersonal, AssetLibraryInput{FolderID: tc.parent.ID, IncludeDescendants: true})
					if err != nil || page.Total != 3 {
						t.Fatalf("parent lost promoted child: total=%d err=%v", page.Total, err)
					}
					resolved, err := svc.ResolveRegistration(user, WorkspaceScopePersonal, AssetRegistrationContext{FolderID: date.ID})
					if err != nil || resolved.FolderID != tc.target.ID {
						t.Fatalf("stale registration not redirected: %+v err=%v", resolved, err)
					}
					restored, err := library.BulkRestore([]string{trashed.ID}, user, WorkspaceScopePersonal)
					if err != nil || len(restored) != 1 || restored[0].FolderID != tc.target.ID || restored[0].URL != trashed.URL {
						t.Fatalf("restore failed: %+v err=%v", restored, err)
					}
					if _, err := svc.List(user, WorkspaceScopePersonal); err != nil {
						t.Fatal(err)
					}
					loaded, err = assets.GetByWorkspace(late.ID, workspace)
					if err != nil || loaded.FolderID != tc.target.ID {
						t.Fatalf("late result not reconciled: %+v err=%v", loaded, err)
					}
					if _, err := svc.ResolveRegistration(user+"_other", WorkspaceScopePersonal, AssetRegistrationContext{FolderID: date.ID}); !errors.Is(err, repository.ErrAssetFolderNotFound) {
						t.Fatalf("cross-workspace alias allowed: %v", err)
					}
				})
			}
		})
	}
}
