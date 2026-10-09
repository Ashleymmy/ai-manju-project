package service

import (
	"errors"
	"testing"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

func TestCopiedProjectIndependenceParity(t *testing.T) {
	for _, driver := range []string{"memory", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			repo, _, _ := canvasLibraryRepositories(t, driver)
			svc := NewProjectService(repo)
			user := "copy_" + randomHex(6)
			data := model.JSONB(`{"nodes":[{"id":"image","metadata":{"assetId":"asset_shared"}}],"groups":[{"id":"g","nodeIds":["image"]}]}`)
			source, err := svc.Create(user, "personal", CreateProjectInput{Title: "Original", Data: &data, CoverAssetID: "asset_cover"})
			if err != nil {
				t.Fatal(err)
			}
			copy, err := svc.Create(user, "personal", CreateProjectInput{Title: "Copy", Data: &data, CoverAssetID: source.CoverAssetID})
			if err != nil {
				t.Fatal(err)
			}
			if source.ID == copy.ID || copy.CoverAssetID != "asset_cover" {
				t.Fatal("copy identity/cover incorrect")
			}
			changed := model.JSONB(`{"nodes":[]}`)
			if _, err := svc.UpdateSnapshot(copy.ID, user, "personal", &changed); err != nil {
				t.Fatal(err)
			}
			original, err := svc.GetSnapshot(source.ID, user, "personal")
			if err != nil || !canvasJSONEqual(original.Data, data) {
				t.Fatal("copy overwrote original")
			}
			if _, err := svc.Get(copy.ID, "other-user", "personal"); !errors.Is(err, repository.ErrNotFound) {
				t.Fatal("copy leaked across users")
			}
			if err := svc.Delete(source.ID, user, "personal"); err != nil {
				t.Fatal(err)
			}
			if _, err := svc.GetSnapshot(copy.ID, user, "personal"); err != nil {
				t.Fatal("deleting original deleted copy")
			}
		})
	}
}

func TestProjectServiceCreateUsesCurrentUserAndWorkspace(t *testing.T) {
	svc := NewProjectService(repository.NewMemoryProjectRepository())

	project, err := svc.Create("user_a", WorkspaceScopePersonal, CreateProjectInput{Title: "  Storyboard  "})
	if err != nil {
		t.Fatal(err)
	}
	if project.OwnerID != "user_a" {
		t.Fatalf("owner = %q, want user_a", project.OwnerID)
	}
	if project.WorkspaceID != "default:user_a" {
		t.Fatalf("workspace = %q, want default:user_a", project.WorkspaceID)
	}
	if project.Title != "Storyboard" {
		t.Fatalf("title = %q, want Storyboard", project.Title)
	}
}

func TestProjectServiceCreatePersistsInitialCanvasData(t *testing.T) {
	svc := NewProjectService(repository.NewMemoryProjectRepository())
	data := model.JSONB(`{"nodes":[{"id":"chat-text"}],"edges":[]}`)

	project, err := svc.Create("user_a", WorkspaceScopePersonal, CreateProjectInput{
		Title:        "Chat Bootstrap",
		Data:         &data,
		CoverAssetID: "asset_cover",
	})
	if err != nil {
		t.Fatal(err)
	}

	snapshot, err := svc.GetSnapshot(project.ID, "user_a", WorkspaceScopePersonal)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Version != 1 {
		t.Fatalf("initial snapshot version = %d, want 1", snapshot.Version)
	}
	if project.CoverAssetID != "asset_cover" {
		t.Fatalf("initial cover = %s", project.CoverAssetID)
	}
	if string(snapshot.Data) != string(data) {
		t.Fatalf("initial snapshot data = %s, want %s", snapshot.Data, data)
	}
}

func TestProjectServiceSnapshotVersionIncrements(t *testing.T) {
	svc := NewProjectService(repository.NewMemoryProjectRepository())
	project, err := svc.Create("user_a", WorkspaceScopePersonal, CreateProjectInput{Title: "Versioned"})
	if err != nil {
		t.Fatal(err)
	}
	data := model.JSONB(`{"nodes":[]}`)

	first, err := svc.UpdateSnapshot(project.ID, "user_a", WorkspaceScopePersonal, &data)
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.UpdateSnapshot(project.ID, "user_a", WorkspaceScopePersonal, &data)
	if err != nil {
		t.Fatal(err)
	}
	if first.Version != 1 || second.Version != 2 {
		t.Fatalf("versions = %d,%d; want 1,2", first.Version, second.Version)
	}
}

type failingAssetUsageRecorder struct{ calls int }

func (r *failingAssetUsageRecorder) RecordReference(string, string, string, string, []string) error {
	r.calls++
	return repository.ErrAssetNotFound
}

func TestProjectServiceSnapshotSaveSurvivesAssetBookkeepingFailure(t *testing.T) {
	references := repository.NewMemoryAssetReferenceRepository()
	recorder := &failingAssetUsageRecorder{}
	svc := NewProjectService(repository.NewMemoryProjectRepository())
	svc.SetAssetReferenceRepository(references)
	svc.SetAssetUsageRecorder(recorder)
	project, err := svc.Create("user_a", WorkspaceScopePersonal, CreateProjectInput{Title: "Imported"})
	if err != nil {
		t.Fatal(err)
	}
	data := model.JSONB(`{"nodes":[{"id":"pasted","metadata":{"storageKey":"server:personal:image:asset_imported","assetId":"asset_imported"}}]}`)
	recorder.calls = 0
	snapshot, err := svc.UpdateSnapshot(project.ID, "user_a", WorkspaceScopePersonal, &data)
	if err != nil {
		t.Fatalf("snapshot save with failing usage bookkeeping = %v", err)
	}
	if recorder.calls != 1 || snapshot.Version != 1 {
		t.Fatalf("recorder calls = %d, version = %d", recorder.calls, snapshot.Version)
	}
	if _, err := svc.Update(project.ID, "user_a", WorkspaceScopePersonal, UpdateProjectInput{Data: &data}); err != nil {
		t.Fatalf("project update with failing usage bookkeeping = %v", err)
	}
	if _, err := svc.Create("user_a", WorkspaceScopePersonal, CreateProjectInput{Title: "Copy", Data: &data}); err != nil {
		t.Fatalf("project copy with failing usage bookkeeping = %v", err)
	}
	refs, err := references.ListByAssetIDs(project.WorkspaceID, []string{"asset_imported"})
	if err != nil || len(refs) != 2 {
		t.Fatalf("references = %#v err=%v", refs, err)
	}
}

func TestProjectServiceSnapshotSaveIgnoresMissingImportedAssets(t *testing.T) {
	assets := repository.NewMemoryAssetRepository()
	references := repository.NewMemoryAssetReferenceRepository()
	svc := NewProjectService(repository.NewMemoryProjectRepository())
	svc.SetAssetReferenceRepository(references)
	svc.SetAssetUsageRecorder(NewAssetUsageService(repository.NewMemoryAssetUsageRepository(), assets, references, repository.NewMemoryAssetLineageRepository()))
	project, err := svc.Create("user_a", WorkspaceScopePersonal, CreateProjectInput{Title: "Imported"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := assets.Create(model.Asset{ID: "asset_team", UserID: "user_a", WorkspaceID: WorkspaceIDForScope(WorkspaceScopeTeam, "user_a"), Type: "image", Name: "team"}); err != nil {
		t.Fatal(err)
	}
	data := model.JSONB(`{"nodes":[{"metadata":{"storageKey":"server:personal:image:asset_never_created"}},{"metadata":{"content":"/api/assets/asset_team/content"}}]}`)
	if _, err := svc.UpdateSnapshot(project.ID, "user_a", WorkspaceScopePersonal, &data); err != nil {
		t.Fatalf("snapshot save referencing missing or foreign assets = %v", err)
	}
}

func TestProjectServiceIndexesCanvasAssetReferences(t *testing.T) {
	references := repository.NewMemoryAssetReferenceRepository()
	svc := NewProjectService(repository.NewMemoryProjectRepository())
	svc.SetAssetReferenceRepository(references)
	project, err := svc.Create("user_a", WorkspaceScopePersonal, CreateProjectInput{Title: "References"})
	if err != nil {
		t.Fatal(err)
	}
	data := model.JSONB(`{"nodes":[{"metadata":{"storageKey":"server:personal:image:asset_storage","content":"/api/assets/asset_url/content","asset_id":"asset_field"}}]}`)
	if _, err := svc.UpdateSnapshot(project.ID, "user_a", WorkspaceScopePersonal, &data); err != nil {
		t.Fatal(err)
	}
	refs, err := references.ListByAssetIDs(project.WorkspaceID, []string{"asset_storage", "asset_url", "asset_field"})
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 3 {
		t.Fatalf("references = %#v", refs)
	}
	for _, reference := range refs {
		if reference.ReferenceType != model.AssetReferenceTypeCanvasProject || reference.ReferenceID != project.ID {
			t.Fatalf("reference = %#v", reference)
		}
	}

	next := model.JSONB(`{"nodes":[]}`)
	if _, err := svc.UpdateSnapshot(project.ID, "user_a", WorkspaceScopePersonal, &next); err != nil {
		t.Fatal(err)
	}
	refs, err = references.ListByAssetIDs(project.WorkspaceID, []string{"asset_storage", "asset_url", "asset_field"})
	if err != nil || len(refs) != 0 {
		t.Fatalf("stale references = %#v err=%v", refs, err)
	}
}
