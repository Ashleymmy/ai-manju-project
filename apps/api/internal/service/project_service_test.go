package service

import (
	"testing"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

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
		Title: "Chat Bootstrap",
		Data:  &data,
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
