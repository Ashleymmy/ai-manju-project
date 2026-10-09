package service

import (
	"errors"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

func TestAssetUsageIsIdempotentAndUserStateIsPrivate(t *testing.T) {
	assets := repository.NewMemoryAssetRepository()
	references := repository.NewMemoryAssetReferenceRepository()
	lineage := repository.NewMemoryAssetLineageRepository()
	usage := repository.NewMemoryAssetUsageRepository()
	service := NewAssetUsageService(usage, assets, references, lineage)
	workspaceID := WorkspaceIDForScope(WorkspaceScopePersonal, "user_a")
	for _, assetID := range []string{"asset_parent", "asset_child"} {
		if _, err := assets.Create(model.Asset{ID: assetID, UserID: "user_a", WorkspaceID: workspaceID, Type: "image", Name: assetID}); err != nil {
			t.Fatal(err)
		}
	}
	if err := references.ReplaceForSource(workspaceID, model.AssetReferenceTypeCanvasProject, "project_1", []string{"asset_parent"}); err != nil {
		t.Fatal(err)
	}
	if _, err := lineage.CreateMany([]model.AssetLineage{{ID: "lineage_1", WorkspaceID: workspaceID, ParentAssetID: "asset_parent", ChildAssetID: "asset_child", RelationType: model.AssetLineageGeneration}}); err != nil {
		t.Fatal(err)
	}
	if err := service.RecordGenerationUse(workspaceID, "user_a", "job_1", []string{"asset_parent"}); err != nil {
		t.Fatal(err)
	}
	if err := service.RecordGenerationUse(workspaceID, "user_a", "job_1", []string{"asset_parent"}); err != nil {
		t.Fatal(err)
	}
	note := "仅自己可见"
	if _, err := service.PutUserState("asset_parent", "user_a", WorkspaceScopePersonal, AssetUserStateInput{Reaction: model.AssetReactionFavorite, PrivateNote: &note}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.PutUserState("asset_parent", "user_a", WorkspaceScopePersonal, AssetUserStateInput{Reaction: model.AssetReactionDislike}); err != nil {
		t.Fatal(err)
	}
	stats, err := service.Stats("asset_parent", "user_a", WorkspaceScopePersonal)
	if err != nil {
		t.Fatal(err)
	}
	if stats.GenerationUseCount != 1 || stats.ActiveReferenceCount != 1 || stats.DerivedAssetCount != 1 || stats.FavoriteCount != 0 || stats.DislikeCount != 1 {
		t.Fatalf("stats = %+v", stats)
	}
	if stats.UserState.PrivateNote != note || stats.UserState.Reaction != model.AssetReactionDislike {
		t.Fatalf("user state = %+v", stats.UserState)
	}
	other, err := service.UserState("asset_parent", "user_b", WorkspaceScopeTeam)
	if err == nil || other.PrivateNote != "" {
		t.Fatalf("cross-workspace private state = %+v err=%v", other, err)
	}
}

func TestAssetUsageReferenceSkipsDeletedAssetsButExportStaysStrict(t *testing.T) {
	assets := repository.NewMemoryAssetRepository()
	usage := NewAssetUsageService(repository.NewMemoryAssetUsageRepository(), assets, repository.NewMemoryAssetReferenceRepository(), repository.NewMemoryAssetLineageRepository())
	workspaceID := WorkspaceIDForScope(WorkspaceScopePersonal, "user_a")
	if _, err := assets.Create(model.Asset{ID: "asset_live", UserID: "user_a", WorkspaceID: workspaceID, Type: "image", Name: "live"}); err != nil {
		t.Fatal(err)
	}
	ids := []string{"asset_live", "asset_deleted"}
	if err := usage.RecordReference(workspaceID, "user_a", model.AssetReferenceTypeCanvasProject, "project_1", ids); err != nil {
		t.Fatalf("canvas reference with a deleted asset = %v", err)
	}
	if err := usage.RecordReference(workspaceID, "user_a", model.AssetReferenceTypeCanvasProject, "project_1", []string{"asset_deleted"}); err != nil {
		t.Fatalf("canvas reference with only deleted assets = %v", err)
	}
	if err := usage.RecordExport(workspaceID, "user_a", "export_1", ids); !errors.Is(err, repository.ErrAssetNotFound) {
		t.Fatalf("export with a deleted asset = %v", err)
	}
}

// deletingAssetRepository removes an asset right after the first lookup returns it,
// reproducing a delete that races a canvas save.
type deletingAssetRepository struct {
	repository.AssetRepository
	deleteID    string
	workspaceID string
}

func (r *deletingAssetRepository) ListByWorkspaceIDs(ids []string, workspaceID string) ([]model.Asset, error) {
	assets, err := r.AssetRepository.ListByWorkspaceIDs(ids, workspaceID)
	if err == nil && r.deleteID != "" {
		_ = r.AssetRepository.DeleteByWorkspace(r.deleteID, r.workspaceID)
		r.deleteID = ""
	}
	return assets, err
}

func TestAssetUsageReferenceToleratesAssetDeletedDuringRecording(t *testing.T) {
	memory := repository.NewMemoryAssetRepository()
	workspaceID := WorkspaceIDForScope(WorkspaceScopePersonal, "user_a")
	for _, id := range []string{"asset_kept", "asset_racing"} {
		if _, err := memory.Create(model.Asset{ID: id, UserID: "user_a", WorkspaceID: workspaceID, Type: "image", Name: id}); err != nil {
			t.Fatal(err)
		}
	}
	assets := &deletingAssetRepository{AssetRepository: memory, deleteID: "asset_racing", workspaceID: workspaceID}
	usage := NewAssetUsageService(repository.NewMemoryAssetUsageRepository(), assets, repository.NewMemoryAssetReferenceRepository(), repository.NewMemoryAssetLineageRepository())
	if err := usage.RecordReference(workspaceID, "user_a", model.AssetReferenceTypeCanvasProject, "project_1", []string{"asset_kept", "asset_racing"}); err != nil {
		t.Fatalf("canvas reference racing a delete = %v", err)
	}
}

func TestAssetUsageRejectsInvalidReactionAndLongNote(t *testing.T) {
	assets := repository.NewMemoryAssetRepository()
	usage := NewAssetUsageService(repository.NewMemoryAssetUsageRepository(), assets, repository.NewMemoryAssetReferenceRepository(), repository.NewMemoryAssetLineageRepository())
	workspaceID := WorkspaceIDForScope(WorkspaceScopePersonal, "user_a")
	if _, err := assets.Create(model.Asset{ID: "asset_1", UserID: "user_a", WorkspaceID: workspaceID, Type: "image", Name: "asset"}); err != nil {
		t.Fatal(err)
	}
	if _, err := usage.PutUserState("asset_1", "user_a", WorkspaceScopePersonal, AssetUserStateInput{Reaction: "like"}); err != ErrAssetReaction {
		t.Fatalf("reaction error = %v", err)
	}
	longNote := strings.Repeat("字", AssetPrivateNoteMaxLength+1)
	if _, err := usage.PutUserState("asset_1", "user_a", WorkspaceScopePersonal, AssetUserStateInput{PrivateNote: &longNote}); err != ErrAssetPrivateNote {
		t.Fatalf("note error = %v", err)
	}
}

func TestAssetUsageBatchStatsAndLibraryViews(t *testing.T) {
	assets := repository.NewMemoryAssetRepository()
	references := repository.NewMemoryAssetReferenceRepository()
	lineage := repository.NewMemoryAssetLineageRepository()
	usageRepo := repository.NewMemoryAssetUsageRepository()
	usage := NewAssetUsageService(usageRepo, assets, references, lineage)
	workspaceID := WorkspaceIDForScope(WorkspaceScopePersonal, "user_batch")
	for _, assetID := range []string{"asset_used", "asset_unused", "asset_child"} {
		if _, err := assets.Create(model.Asset{ID: assetID, UserID: "user_batch", WorkspaceID: workspaceID, Type: "image", Name: assetID}); err != nil {
			t.Fatal(err)
		}
	}
	if err := references.ReplaceForSource(workspaceID, model.AssetReferenceTypeCanvasProject, "canvas_1", []string{"asset_used"}); err != nil {
		t.Fatal(err)
	}
	if _, err := lineage.CreateMany([]model.AssetLineage{{ID: "lineage_batch", WorkspaceID: workspaceID, ParentAssetID: "asset_used", ChildAssetID: "asset_child", RelationType: model.AssetLineageGeneration}}); err != nil {
		t.Fatal(err)
	}
	for index := 0; index < int(AssetHighFrequencyThreshold); index++ {
		if err := usage.RecordGenerationUse(workspaceID, "user_batch", "job_"+string(rune('a'+index)), []string{"asset_used"}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := usage.PutUserState("asset_used", "user_batch", WorkspaceScopePersonal, AssetUserStateInput{Reaction: model.AssetReactionFavorite}); err != nil {
		t.Fatal(err)
	}
	batch, err := usage.BatchStats([]string{"asset_used", "asset_unused"}, "user_batch", WorkspaceScopePersonal)
	if err != nil {
		t.Fatal(err)
	}
	if batch["asset_used"].GenerationUseCount != AssetHighFrequencyThreshold || batch["asset_used"].ActiveReferenceCount != 1 || batch["asset_used"].DerivedAssetCount != 1 || batch["asset_unused"].UserState.Reaction != model.AssetReactionNone {
		t.Fatalf("batch stats = %+v", batch)
	}
	favorites, err := usage.LibraryAssetIDs("user_batch", WorkspaceScopePersonal, "favorite")
	if err != nil || len(favorites.IDs) != 1 || favorites.IDs[0] != "asset_used" || favorites.Exclude {
		t.Fatalf("favorites = %+v err=%v", favorites, err)
	}
	frequent, err := usage.LibraryAssetIDs("user_batch", WorkspaceScopePersonal, "frequent")
	if err != nil || len(frequent.IDs) != 1 || frequent.IDs[0] != "asset_used" {
		t.Fatalf("frequent = %+v err=%v", frequent, err)
	}
	unused, err := usage.LibraryAssetIDs("user_batch", WorkspaceScopePersonal, "unused")
	if err != nil || !unused.Exclude || len(unused.IDs) != 1 || unused.IDs[0] != "asset_used" {
		t.Fatalf("unused exclusion = %+v err=%v", unused, err)
	}
}
