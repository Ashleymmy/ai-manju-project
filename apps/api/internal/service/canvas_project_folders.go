package service

import (
	"strings"

	"github.com/ai-manju/api/internal/model"
)

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
	// These are the three canvas-library categories requested by the creation flow.
	// Keep the canvas label "角色" separate from the existing comic label "人物".
	categories := []struct{ key, name string }{
		{model.AssetCategoryCharacter, "角色"},
		{model.AssetCategoryEnvironment, "场景"},
		{model.AssetCategoryProp, "道具"},
	}
	for _, category := range categories {
		if _, err := s.ensureSystemFolder(project.OwnerID, project.WorkspaceID, folder.ID,
			category.name, model.AssetFolderSystemKeyCanvasCategory, model.AssetFolderSystemKeyCanvasCategory,
			project.ID+":"+category.key, assetCategorySort(category.key)); err != nil {
			return err
		}
	}
	return nil
}
