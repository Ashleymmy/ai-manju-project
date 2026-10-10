package service

import "github.com/ai-manju/api/internal/model"

// Only automatically created calendar buckets are retired. A user folder whose
// name happens to be a date is a normal directory and must remain untouched.
func isLegacyDateFolder(folder model.AssetFolder) bool {
	return folder.Kind == model.AssetFolderKindSystem &&
		(folder.SystemKey == model.AssetFolderSystemKeyCanvasProjectDate || folder.SystemKey == model.AssetFolderSystemKeyImageWorkbenchMonth)
}

// The former manual-upload folder was merged into the unsorted folder.
func isRetiredUploadFolder(folder model.AssetFolder) bool {
	return folder.Kind == model.AssetFolderKindSystem && folder.SystemKey == model.AssetFolderSystemKeyUpload
}

func isRetiredSystemFolder(folder model.AssetFolder) bool {
	return isLegacyDateFolder(folder) || isRetiredUploadFolder(folder)
}

// Keep old IDs as internal aliases: queued workers and trash entries can still
// refer to them. They are never advertised or created by registration/backfill.
func legacyDateFolderTargets(folders []model.AssetFolder) map[string]string {
	byID := make(map[string]model.AssetFolder, len(folders))
	others := make(map[string]string)
	unsortedID := ""
	for _, folder := range folders {
		byID[folder.ID] = folder
		if folder.Kind == model.AssetFolderKindSystem && folder.SystemKey == model.AssetFolderSystemKeyUnsorted {
			unsortedID = folder.ID
		}
	}
	for _, folder := range folders {
		if folder.SystemKey == model.AssetFolderSystemKeyCanvasCategory && folder.SourceRefID != "" {
			if parent, ok := byID[folder.ParentID]; ok && folder.SourceRefID == parent.SourceRefID+":"+model.AssetCategoryOther {
				others[folder.ParentID] = folder.ID
			}
		}
	}
	targets := make(map[string]string)
	for _, folder := range folders {
		if isRetiredUploadFolder(folder) {
			if unsortedID != "" {
				targets[folder.ID] = unsortedID
			}
			continue
		}
		if !isLegacyDateFolder(folder) {
			continue
		}
		parentID := visibleDateParent(folder, byID)
		if otherID := others[parentID]; otherID != "" {
			parentID = otherID
		}
		if parentID != "" && parentID != folder.ID {
			targets[folder.ID] = parentID
		}
	}
	return targets
}

// Promote any nested user/category directories instead of deleting their tree.
func withoutDateFolders(folders []model.AssetFolder) []model.AssetFolder {
	byID := make(map[string]model.AssetFolder, len(folders))
	for _, folder := range folders {
		byID[folder.ID] = folder
	}
	visible := make([]model.AssetFolder, 0, len(folders))
	for _, folder := range folders {
		if !isRetiredSystemFolder(folder) {
			folder.ParentID = visibleDateParent(folder, byID)
			visible = append(visible, folder)
		}
	}
	return visible
}

func visibleDateParent(folder model.AssetFolder, byID map[string]model.AssetFolder) string {
	parentID := folder.ParentID
	seen := map[string]bool{folder.ID: true}
	for parent, ok := byID[parentID]; ok && isRetiredSystemFolder(parent) && !seen[parentID]; parent, ok = byID[parentID] {
		seen[parentID] = true
		parentID = parent.ParentID
	}
	return parentID
}
