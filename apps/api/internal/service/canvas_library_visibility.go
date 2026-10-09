package service

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

// CanvasLibraryVisibilityService keeps the asset library limited to what a
// canvas still uses. For assets the canvas created itself:
//   - a generation that survives only in a node's generation history is hidden,
//     and returns as soon as any node displays it again ("apply to canvas", undo);
//   - an asset the canvas stops using entirely moves to the trash, except a
//     generation that was still displayed when its node went away;
//   - a trashed asset returns when the canvas uses it again.
//
// Assets the user organised or that are used elsewhere are left alone.
type CanvasLibraryVisibilityService struct {
	assets     repository.AssetRepository
	folders    repository.AssetFolderRepository
	references repository.AssetReferenceRepository
	usage      repository.AssetUsageRepository
	tags       repository.TagRepository
}

func NewCanvasLibraryVisibilityService(assets repository.AssetRepository, folders repository.AssetFolderRepository, references repository.AssetReferenceRepository, usage repository.AssetUsageRepository, tags repository.TagRepository) *CanvasLibraryVisibilityService {
	return &CanvasLibraryVisibilityService{assets: assets, folders: folders, references: references, usage: usage, tags: tags}
}

// Sync runs after the snapshot and its asset references are stored. previous
// holds the assets the canvas referenced before this save; only assets that
// dropped out of it are trashed, so media still being uploaded or generated,
// which no node references yet, is never touched.
func (s *CanvasLibraryVisibilityService) Sync(workspaceID string, userID string, projectID string, previous []string, displayed []string, historyOnly []string) error {
	if err := s.restoreCleanedUp(workspaceID, append(append([]string{}, displayed...), historyOnly...)); err != nil {
		return err
	}
	if err := s.hideSuperseded(workspaceID, userID, projectID, displayed, historyOnly); err != nil {
		return err
	}
	return s.trashDropped(workspaceID, userID, projectID, previous, displayed, historyOnly)
}

// Retire runs when a canvas is deleted: everything it created goes to the trash
// unless the user organised it or something else still uses it.
func (s *CanvasLibraryVisibilityService) Retire(workspaceID string, userID string, projectID string) error {
	assets, _, err := s.assets.ListLibrary(repository.AssetLibraryFilter{
		WorkspaceID: workspaceID, SourceProjectID: projectID, IncludeSuperseded: true, Unpaged: true,
	})
	if err != nil {
		return err
	}
	owned := make([]model.Asset, 0, len(assets))
	for _, asset := range assets {
		if canvasOwnedAsset(asset, projectID) {
			owned = append(owned, asset)
		}
	}
	trash, keep, err := s.splitKept(workspaceID, userID, projectID, owned)
	if err != nil {
		return err
	}
	if err := s.assets.SetSuperseded(keep, workspaceID, nil); err != nil {
		return err
	}
	return s.trash(workspaceID, trash)
}

func (s *CanvasLibraryVisibilityService) restoreCleanedUp(workspaceID string, used []string) error {
	used = uniqueAssetStrings(used)
	if len(used) == 0 {
		return nil
	}
	assets, err := s.assets.ListByWorkspaceIDs(used, workspaceID)
	if err != nil {
		return err
	}
	targets := make([]repository.AssetRestoreTarget, 0)
	for _, asset := range assets {
		if asset.TrashedAt != nil && asset.TrashedBy == model.AssetTrashedByCanvasCleanup {
			targets = append(targets, repository.AssetRestoreTarget{ID: asset.ID, FolderID: asset.FolderID})
		}
	}
	if len(targets) == 0 {
		return nil
	}
	_, err = s.assets.RestoreByWorkspace(targets, workspaceID)
	return err
}

func (s *CanvasLibraryVisibilityService) trashDropped(workspaceID string, userID string, projectID string, previous []string, displayed []string, historyOnly []string) error {
	current := make(map[string]bool, len(displayed)+len(historyOnly))
	for _, id := range append(append([]string{}, displayed...), historyOnly...) {
		current[id] = true
	}
	dropped := make([]string, 0)
	for _, id := range uniqueAssetStrings(previous) {
		if !current[id] {
			dropped = append(dropped, id)
		}
	}
	if len(dropped) == 0 {
		return nil
	}
	assets, err := s.assets.ListByWorkspaceIDs(dropped, workspaceID)
	if err != nil {
		return err
	}
	candidates := make([]model.Asset, 0, len(assets))
	for _, asset := range assets {
		// A generation without the hidden flag was displayed until its node went
		// away; it stays in the library like any finished result.
		if canvasOwnedAsset(asset, projectID) && (!canvasGeneratedAsset(asset) || asset.SupersededAt != nil) {
			candidates = append(candidates, asset)
		}
	}
	trash, _, err := s.splitKept(workspaceID, userID, projectID, candidates)
	if err != nil {
		return err
	}
	return s.trash(workspaceID, trash)
}

func (s *CanvasLibraryVisibilityService) splitKept(workspaceID string, userID string, projectID string, assets []model.Asset) ([]string, []string, error) {
	if len(assets) == 0 {
		return nil, nil, nil
	}
	kept, err := s.keptVisible(workspaceID, userID, projectID, assets)
	if err != nil {
		return nil, nil, err
	}
	trash := make([]string, 0, len(assets))
	keep := make([]string, 0, len(kept))
	for _, asset := range assets {
		if kept[asset.ID] {
			keep = append(keep, asset.ID)
		} else {
			trash = append(trash, asset.ID)
		}
	}
	return trash, keep, nil
}

func (s *CanvasLibraryVisibilityService) trash(workspaceID string, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	now := time.Now().UTC()
	_, err := s.assets.TrashByWorkspace(ids, workspaceID, model.AssetTrashedByCanvasCleanup, now, now.Add(model.AssetTrashRetention))
	return err
}

func (s *CanvasLibraryVisibilityService) hideSuperseded(workspaceID string, userID string, projectID string, displayed []string, historyOnly []string) error {
	if err := s.assets.SetSuperseded(displayed, workspaceID, nil); err != nil {
		return err
	}
	historyOnly = uniqueAssetStrings(historyOnly)
	if len(historyOnly) == 0 {
		return nil
	}
	assets, err := s.assets.ListByWorkspaceIDs(historyOnly, workspaceID)
	if err != nil {
		return err
	}
	candidates := make([]model.Asset, 0, len(assets))
	for _, asset := range assets {
		if canvasOwnedAsset(asset, projectID) && canvasGeneratedAsset(asset) && (asset.Type == "image" || asset.Type == "video") {
			candidates = append(candidates, asset)
		}
	}
	hide, show, err := s.splitKept(workspaceID, userID, projectID, candidates)
	if err != nil {
		return err
	}
	if err := s.assets.SetSuperseded(show, workspaceID, nil); err != nil {
		return err
	}
	now := time.Now().UTC()
	return s.assets.SetSuperseded(hide, workspaceID, &now)
}

// canvasOwnedAsset reports whether the canvas itself created the asset, by
// generating or importing it. Assets brought in from the library never are.
func canvasOwnedAsset(asset model.Asset, projectID string) bool {
	return asset.TrashedAt == nil &&
		asset.SourceType == model.AssetSourceCanvas &&
		asset.SourceProjectID == projectID
}

// canvasGeneratedAsset tells generations from imports. Server jobs record their
// job; outputs the browser uploads carry the prompt in their source metadata.
func canvasGeneratedAsset(asset model.Asset) bool {
	if strings.TrimSpace(asset.SourceJobID) != "" {
		return true
	}
	var metadata map[string]any
	if len(asset.SourceMetadata) == 0 || json.Unmarshal(asset.SourceMetadata, &metadata) != nil {
		return false
	}
	_, ok := metadata["prompt"]
	return ok
}

// keptVisible returns assets that are used elsewhere or were organised by a user:
// referenced by another source, favorited, moved into a user folder, or tagged directly.
func (s *CanvasLibraryVisibilityService) keptVisible(workspaceID string, userID string, projectID string, assets []model.Asset) (map[string]bool, error) {
	ids := make([]string, 0, len(assets))
	for _, asset := range assets {
		ids = append(ids, asset.ID)
	}
	kept := make(map[string]bool, len(ids))
	if s.references != nil {
		references, err := s.references.ListByAssetIDs(workspaceID, ids)
		if err != nil {
			return nil, err
		}
		for _, reference := range references {
			if reference.ReferenceType != model.AssetReferenceTypeCanvasProject || reference.ReferenceID != projectID {
				kept[reference.AssetID] = true
			}
		}
	}
	if s.usage != nil {
		aggregates, err := s.usage.GetAggregates(workspaceID, ids)
		if err != nil {
			return nil, err
		}
		for id, aggregate := range aggregates {
			if aggregate.FavoriteCount > 0 {
				kept[id] = true
			}
		}
	}
	if s.folders != nil {
		folders, err := s.folders.ListByWorkspace(workspaceID)
		if err != nil {
			return nil, err
		}
		userFolders := make(map[string]bool, len(folders))
		for _, folder := range folders {
			if folder.Kind == model.AssetFolderKindUser {
				userFolders[folder.ID] = true
			}
		}
		for _, asset := range assets {
			if userFolders[asset.FolderID] {
				kept[asset.ID] = true
			}
		}
	}
	if s.tags != nil {
		details, err := s.tags.ListAssetTagDetails(workspaceID, ids, tagVisibleScopeKeys(userID, WorkspaceScopeFromID(workspaceID)))
		if err != nil {
			return nil, err
		}
		for _, detail := range details {
			if detail.Binding.State == model.AssetTagBindingActive && userAppliedTag(detail.Origins) {
				kept[detail.Binding.AssetID] = true
			}
		}
	}
	return kept, nil
}

// Inherited, AI-suggested and system tags are automatic; anything else came from a person.
func userAppliedTag(origins []model.AssetTagOrigin) bool {
	if len(origins) == 0 {
		return true
	}
	for _, origin := range origins {
		switch origin.OriginType {
		case model.AssetTagOriginInherited, model.AssetTagOriginAISuggested, model.AssetTagOriginSystem:
		default:
			return true
		}
	}
	return false
}
