package repository

import (
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/database"
	"github.com/ai-manju/api/internal/model"
)

func TestMemoryAssetSupersededHidesFromLibraryOnly(t *testing.T) {
	runAssetSupersededSuite(t, NewMemoryAssetRepository(), "memory")
}

func TestGormAssetSupersededHidesFromLibraryOnly(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to run PostgreSQL repository integration test")
	}
	db, err := database.OpenPostgres(dsn)
	if err != nil {
		t.Fatal(err)
	}
	prefix := fmt.Sprintf("superseded_it_%d", time.Now().UTC().UnixNano())
	t.Cleanup(func() { _ = db.Where("workspace_id = ?", "default:"+prefix).Delete(&model.Asset{}).Error })
	runAssetSupersededSuite(t, NewGormAssetRepository(db), prefix)
}

func runAssetSupersededSuite(t *testing.T, repo AssetRepository, prefix string) {
	t.Helper()
	workspaceID := "default:" + prefix
	shown, hidden := prefix+"_shown", prefix+"_hidden"
	for _, id := range []string{shown, hidden} {
		if _, err := repo.Create(model.Asset{ID: id, UserID: prefix, WorkspaceID: workspaceID, Type: "image", URL: id + ".png", FolderID: "folder_canvas", SourceProjectID: "project_1", Tags: model.JSONB("[]")}); err != nil {
			t.Fatal(err)
		}
	}
	at := time.Now().UTC()
	if err := repo.SetSuperseded([]string{hidden, "missing"}, workspaceID, &at); err != nil {
		t.Fatal(err)
	}
	if err := repo.SetSuperseded([]string{hidden}, "default:other", nil); err != nil {
		t.Fatal(err)
	}
	library, total, err := repo.ListLibrary(AssetLibraryFilter{WorkspaceID: workspaceID, Page: 1, PageSize: 20})
	if err != nil || total != 1 || len(library) != 1 || library[0].ID != shown {
		t.Fatalf("library = %+v total=%d err=%v", library, total, err)
	}
	history, total, err := repo.ListLibrary(AssetLibraryFilter{WorkspaceID: workspaceID, SourceProjectID: "project_1", IncludeSuperseded: true, Page: 1, PageSize: 20})
	if err != nil || total != 2 || len(history) != 2 {
		t.Fatalf("history listing = %+v total=%d err=%v", history, total, err)
	}
	counts, err := repo.CountByFolder(workspaceID)
	if err != nil || counts["folder_canvas"] != 1 {
		t.Fatalf("folder counts = %v err=%v", counts, err)
	}
	reused, total, err := repo.ListLibrary(AssetLibraryFilter{WorkspaceID: workspaceID, FilterFolder: true, FolderIDs: []string{"folder_copy"}, FolderAssetIDs: []string{shown, hidden}, Page: 1, PageSize: 20})
	if err != nil || total != 1 || len(reused) != 1 || reused[0].ID != shown {
		t.Fatalf("folder listing with reused assets = %+v total=%d err=%v", reused, total, err)
	}
	stored, err := repo.GetByWorkspace(hidden, workspaceID)
	if err != nil || stored.SupersededAt == nil {
		t.Fatalf("hidden asset = %+v err=%v", stored, err)
	}
	if err := repo.SetSuperseded([]string{hidden}, workspaceID, nil); err != nil {
		t.Fatal(err)
	}
	if _, total, err = repo.ListLibrary(AssetLibraryFilter{WorkspaceID: workspaceID, Page: 1, PageSize: 20}); err != nil || total != 2 {
		t.Fatalf("restored library total=%d err=%v", total, err)
	}

	if err := repo.SetSuperseded([]string{hidden}, workspaceID, &at); err != nil {
		t.Fatal(err)
	}
	trashed, err := repo.TrashByWorkspace([]string{hidden}, workspaceID, model.AssetTrashedByCanvasCleanup, at, at.Add(model.AssetTrashRetention))
	if err != nil || len(trashed) != 1 || trashed[0].SupersededAt != nil || trashed[0].TrashedBy != model.AssetTrashedByCanvasCleanup {
		t.Fatalf("trashed = %+v err=%v", trashed, err)
	}
	if _, err := repo.RestoreByWorkspace([]AssetRestoreTarget{{ID: hidden, FolderID: "folder_canvas"}}, workspaceID); err != nil {
		t.Fatal(err)
	}
	if _, total, err = repo.ListLibrary(AssetLibraryFilter{WorkspaceID: workspaceID, Page: 1, PageSize: 20}); err != nil || total != 2 {
		t.Fatalf("library after restoring a trashed hidden asset total=%d err=%v", total, err)
	}
}

func TestAssetReferencesListAssetIDsForSource(t *testing.T) {
	repos := map[string]AssetReferenceRepository{"memory": NewMemoryAssetReferenceRepository()}
	if dsn := os.Getenv("TEST_DATABASE_URL"); dsn != "" {
		db, err := database.OpenPostgres(dsn)
		if err != nil {
			t.Fatal(err)
		}
		repos["gorm"] = NewGormAssetReferenceRepository(db)
	}
	for name, repo := range repos {
		t.Run(name, func(t *testing.T) {
			workspaceID := fmt.Sprintf("default:refs_it_%d", time.Now().UTC().UnixNano())
			t.Cleanup(func() { _ = repo.DeleteForSource(workspaceID, model.AssetReferenceTypeCanvasProject, "project_1") })
			if err := repo.ReplaceForSource(workspaceID, model.AssetReferenceTypeCanvasProject, "project_1", []string{"asset_b", "asset_a"}); err != nil {
				t.Fatal(err)
			}
			if err := repo.ReplaceForSource(workspaceID, model.AssetReferenceTypeCanvasProject, "project_2", []string{"asset_c"}); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = repo.DeleteForSource(workspaceID, model.AssetReferenceTypeCanvasProject, "project_2") })
			ids, err := repo.ListAssetIDsForSource(workspaceID, model.AssetReferenceTypeCanvasProject, "project_1")
			if err != nil || len(ids) != 2 || ids[0] != "asset_a" || ids[1] != "asset_b" {
				t.Fatalf("ids = %v err=%v", ids, err)
			}
			byType, err := repo.ListByType(workspaceID, model.AssetReferenceTypeCanvasProject)
			if err != nil || len(byType) != 3 || byType[0].AssetID != "asset_a" || byType[2].ReferenceID != "project_2" {
				t.Fatalf("references by type = %+v err=%v", byType, err)
			}
			if other, err := repo.ListByType(workspaceID, model.AssetReferenceTypeComicInput); err != nil || len(other) != 0 {
				t.Fatalf("other type = %+v err=%v", other, err)
			}
		})
	}
}
