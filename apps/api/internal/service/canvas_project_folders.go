package service

import (
	"strings"

	"github.com/ai-manju/api/internal/model"
)

// canvasLibraryCategories defines the only automatic destinations under a canvas.
// Canvas uses "角色" while the independent comic library uses "人物".
var canvasLibraryCategories = []struct{ key, name string }{
	{model.AssetCategoryCharacter, "角色"},
	{model.AssetCategoryEnvironment, "场景"},
	{model.AssetCategoryProp, "道具"},
	{model.AssetCategoryOther, "其他"},
}

// ensureCanvasProjectFolders runs inside the project's workspace transaction.
// Archive registration resolves the same project identity, so a later job with
// an old title cannot rename the folder back or split its existing assets.
func (s *AssetFolderService) ensureCanvasProjectFolders(project model.Project) error {
	defaults, err := s.ensureDefaultsForWorkspace(project.OwnerID, project.WorkspaceID)
	if err != nil {
		return err
	}
	identity := strings.Join([]string{project.WorkspaceID, model.AssetFolderSystemKeyCanvasProject, project.ID}, "|")
	// Canvas titles already allow duplicate/custom labels. Use the project ID as
	// the protected folder's uniqueness key so its visible name can match exactly,
	// including long titles and punctuation, without changing user-folder rules.
	nameKey := model.AssetFolderSystemKeyCanvasProject + ":" + project.ID
	folder, err := s.folders.EnsureSystem(model.AssetFolder{
		ID: "asset_folder_" + randomHex(12), WorkspaceID: project.WorkspaceID, CreatedBy: project.OwnerID,
		ParentID: defaults.Canvas.ID, Name: project.Title, NormalizedName: nameKey,
		Kind: model.AssetFolderKindSystem, SystemKey: model.AssetFolderSystemKeyCanvasProject,
		SourceRefType: model.AssetFolderSystemKeyCanvasProject, SourceRefID: project.ID, SystemIdentity: &identity,
	})
	if err != nil {
		return err
	}
	if folder.Name != project.Title || folder.NormalizedName != nameKey {
		folder.Name, folder.NormalizedName = project.Title, nameKey
		folder, err = s.folders.Update(folder, project.WorkspaceID)
		if err != nil {
			return err
		}
	}
	return s.ensureCanvasCategoryFolders(folder)
}

// Both opening a canvas and listing its assets repair categories added after
// the canvas was created. Reuse the actual linked folder, never its display name.
func (s *AssetFolderService) ensureCanvasCategoryFolders(folder model.AssetFolder) error {
	for _, category := range canvasLibraryCategories {
		if _, err := s.ensureSystemFolder(folder.CreatedBy, folder.WorkspaceID, folder.ID,
			category.name, model.AssetFolderSystemKeyCanvasCategory, model.AssetFolderSystemKeyCanvasCategory,
			folder.SourceRefID+":"+category.key, assetCategorySort(category.key)); err != nil {
			return err
		}
	}
	return nil
}

// reconcileDefaultAssets adopts only assets directly in the legacy
// automatic locations. Category folders and user-created subfolders are left
// intact; MoveByFolders checks the current folder atomically in both repositories.
func (s *AssetFolderService) reconcileDefaultAssets(workspaceID string, folders []model.AssetFolder, counts map[string]int64, dateTargets map[string]string) (bool, error) {
	others := make(map[string]string)
	legacy := make(map[string][]string)
	for _, folder := range folders {
		if folder.SystemKey == model.AssetFolderSystemKeyCanvasCategory && strings.HasSuffix(folder.SourceRefID, ":"+model.AssetCategoryOther) {
			others[folder.ParentID] = folder.ID
		}
		if counts[folder.ID] == 0 {
			continue
		}
		switch folder.SystemKey {
		case model.AssetFolderSystemKeyCanvasProject:
			legacy[folder.ID] = append(legacy[folder.ID], folder.ID)
		}
	}
	targets := make(map[string][]string)
	for projectFolderID, sourceIDs := range legacy {
		if otherID := others[projectFolderID]; otherID != "" {
			targets[otherID] = append(targets[otherID], sourceIDs...)
		}
	}
	for sourceID, targetID := range dateTargets {
		if counts[sourceID] > 0 {
			targets[targetID] = append(targets[targetID], sourceID)
		}
	}
	changed := false
	for targetID, sourceIDs := range targets {
		moved, err := s.assets.MoveByFolders(sourceIDs, targetID, workspaceID)
		if err != nil {
			return changed, err
		}
		changed = changed || moved > 0
	}
	return changed, nil
}
