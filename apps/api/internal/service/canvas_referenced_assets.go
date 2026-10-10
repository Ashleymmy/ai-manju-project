package service

import (
	"strings"

	"github.com/ai-manju/api/internal/model"
)

// canvasReferencedAssetSet holds assets a canvas uses but that are stored
// outside its own folders, e.g. a copied canvas reusing the original's results.
// They are listed in the canvas's category folders without being moved or copied.
type canvasReferencedAssetSet struct {
	// byFolder maps a canvas category (or canvas) folder to the assets shown in it.
	byFolder map[string][]string
	// storedIn is each asset's actual (visible) folder.
	storedIn map[string]string
}

// shownIn returns the referenced assets listed somewhere in folderIDs that are
// not already stored in one of them, so nothing is counted or listed twice.
func (r canvasReferencedAssetSet) shownIn(folderIDs []string) []string {
	if len(r.byFolder) == 0 {
		return nil
	}
	within := make(map[string]bool, len(folderIDs))
	for _, id := range folderIDs {
		within[id] = true
	}
	seen := make(map[string]bool)
	result := make([]string, 0)
	for _, folderID := range folderIDs {
		for _, assetID := range r.byFolder[folderID] {
			if seen[assetID] || within[r.storedIn[assetID]] {
				continue
			}
			seen[assetID] = true
			result = append(result, assetID)
		}
	}
	return result
}

// canvasReferencedAssets expects visible folders; dateTargets maps retired
// folders to the visible folder that now lists their assets.
func (s *AssetFolderService) canvasReferencedAssets(workspaceID string, folders []model.AssetFolder, dateTargets map[string]string) (canvasReferencedAssetSet, error) {
	result := canvasReferencedAssetSet{byFolder: map[string][]string{}, storedIn: map[string]string{}}
	if s.references == nil {
		return result, nil
	}
	projectFolders := make(map[string]string)
	categoryFolders := make(map[string]string)
	for _, folder := range folders {
		switch folder.SystemKey {
		case model.AssetFolderSystemKeyCanvasProject:
			if folder.SourceRefID != "" {
				projectFolders[folder.SourceRefID] = folder.ID
			}
		case model.AssetFolderSystemKeyCanvasCategory:
			categoryFolders[folder.SourceRefID] = folder.ID
		}
	}
	if len(projectFolders) == 0 {
		return result, nil
	}
	references, err := s.references.ListByType(workspaceID, model.AssetReferenceTypeCanvasProject)
	if err != nil {
		return result, err
	}
	byProject := make(map[string][]string)
	ids := make([]string, 0, len(references))
	for _, reference := range references {
		if projectFolders[reference.ReferenceID] != "" {
			byProject[reference.ReferenceID] = append(byProject[reference.ReferenceID], reference.AssetID)
			ids = append(ids, reference.AssetID)
		}
	}
	if len(ids) == 0 {
		return result, nil
	}
	assets, err := s.assets.ListByWorkspaceIDs(uniqueAssetStrings(ids), workspaceID)
	if err != nil {
		return result, err
	}
	byID := make(map[string]model.Asset, len(assets))
	for _, asset := range assets {
		byID[asset.ID] = asset
	}
	children := folderChildren(folders)
	for projectID, assetIDs := range byProject {
		projectFolderID := projectFolders[projectID]
		own := map[string]bool{projectFolderID: true}
		for _, id := range descendantFolderIDs(projectFolderID, children) {
			own[id] = true
		}
		for _, assetID := range assetIDs {
			asset, ok := byID[assetID]
			if !ok || asset.TrashedAt != nil || asset.SupersededAt != nil {
				continue
			}
			storedIn := asset.FolderID
			if target := dateTargets[storedIn]; target != "" {
				storedIn = target
			}
			if own[storedIn] {
				continue
			}
			target := categoryFolders[projectID+":"+canvasLibraryCategory(asset.Category)]
			if target == "" {
				target = projectFolderID
			}
			result.byFolder[target] = append(result.byFolder[target], assetID)
			result.storedIn[assetID] = storedIn
		}
	}
	return result, nil
}

// CanvasReferencedAssetIDs lists assets that canvases inside the queried folders
// use but store elsewhere; the library shows them alongside the folder's own assets.
func (s *AssetFolderService) CanvasReferencedAssetIDs(folderIDs []string, userID string, scope string) ([]string, error) {
	if s.references == nil || len(folderIDs) == 0 {
		return nil, nil
	}
	workspaceID := WorkspaceIDForScope(scope, userID)
	folders, err := s.folders.ListByWorkspace(workspaceID)
	if err != nil {
		return nil, err
	}
	referenced, err := s.canvasReferencedAssets(workspaceID, withoutDateFolders(folders), legacyDateFolderTargets(folders))
	if err != nil {
		return nil, err
	}
	return referenced.shownIn(folderIDs), nil
}

// canvasLibraryCategory maps an asset category onto the four canvas folders;
// legacy categories such as costume/reference fall back to "other".
func canvasLibraryCategory(category string) string {
	category = strings.TrimSpace(category)
	switch category {
	case model.AssetCategoryCharacter, model.AssetCategoryEnvironment, model.AssetCategoryProp:
		return category
	default:
		return model.AssetCategoryOther
	}
}
