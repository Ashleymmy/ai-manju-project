package service

import (
	"archive/zip"
	"encoding/json"
	"sort"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

const (
	// AssetPackageManifestName is shared with Studio's portable package reader.
	AssetPackageManifestName = "assets.json"
	// AssetPackageVersion adds original folder names and workspace-independent tags.
	AssetPackageVersion = 2
	// AssetPackageApp identifies packages accepted by Studio's import validator.
	AssetPackageApp = "ai-manju-studio"
)

type assetPackageFolder struct {
	ID        string `json:"id"`
	ParentID  string `json:"parent_id"`
	Name      string `json:"name"`
	SortOrder int    `json:"sort_order"`
}

type assetPackageTag struct {
	ID          string `json:"id"`
	ParentID    string `json:"parent_id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	InheritMode string `json:"inherit_mode"`
}

type assetPackageAsset struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Type        string   `json:"type"`
	ContentType string   `json:"content_type"`
	FolderID    string   `json:"folder_id,omitempty"`
	Category    string   `json:"category"`
	Tags        []string `json:"tags"`
	TagIDs      []string `json:"tag_ids"`
	Note        string   `json:"note,omitempty"`
}

type assetPackageFile struct {
	AssetID  string `json:"assetId"`
	Path     string `json:"path"`
	MimeType string `json:"mimeType"`
	Bytes    int64  `json:"bytes"`
}

type assetPackageManifest struct {
	App        string               `json:"app"`
	Version    int                  `json:"version"`
	ExportedAt time.Time            `json:"exportedAt"`
	Folders    []assetPackageFolder `json:"folders"`
	Tags       []assetPackageTag    `json:"tags"`
	Assets     []assetPackageAsset  `json:"assets"`
	Files      []assetPackageFile   `json:"files"`
	Failed     []string             `json:"failed"`
}

// Freeze the entire requested subtree, including empty folders. Selected/filter
// exports include only the ancestor paths needed to place their selected media.
func (s *AssetExportService) packageFolders(userID, scope, mode, rootID string, assets []model.Asset) ([]assetPackageFolder, error) {
	result := []assetPackageFolder{}
	if s.folders == nil {
		return result, nil
	}
	views, err := s.folders.List(userID, scope)
	if err != nil {
		return nil, err
	}
	byID := map[string]model.AssetFolder{}
	for _, view := range views {
		byID[view.ID] = view.AssetFolder
	}
	selected := map[string]bool{}
	rootID = strings.TrimSpace(rootID)
	if mode == AssetExportSelectionFolder {
		if _, ok := byID[rootID]; !ok {
			return nil, repository.ErrAssetFolderNotFound
		}
		for _, view := range views {
			seen := map[string]bool{}
			for id := view.ID; id != "" && !seen[id]; id = byID[id].ParentID {
				seen[id] = true
				if id == rootID {
					selected[view.ID] = true
					break
				}
			}
		}
	} else {
		for _, asset := range assets {
			for id := asset.FolderID; id != "" && !selected[id]; id = byID[id].ParentID {
				folder, ok := byID[id]
				if !ok || folder.SystemKey == model.AssetFolderSystemKeyRoot {
					break
				}
				selected[id] = true
			}
		}
	}
	for _, view := range views {
		if !selected[view.ID] {
			continue
		}
		parentID := view.ParentID
		if !selected[parentID] {
			parentID = ""
		}
		result = append(result, assetPackageFolder{view.ID, parentID, view.Name, view.SortOrder})
	}
	return result, nil
}

func (s *AssetExportService) writeAssetPackage(archive *zip.Writer, batch model.AssetExportBatch, rows []assetExportManifestRow, assets map[string]model.Asset) error {
	var selection struct {
		FolderID string               `json:"folder_id"`
		Folders  []assetPackageFolder `json:"package_folders"`
	}
	if err := json.Unmarshal(batch.Selection, &selection); err != nil {
		return err
	}
	// Older queued batches do not yet carry the folder snapshot.
	if selection.Folders == nil {
		values := make([]model.Asset, 0, len(assets))
		for _, asset := range assets {
			values = append(values, asset)
		}
		var err error
		selection.Folders, err = s.packageFolders(batch.UserID, WorkspaceScopeFromID(batch.WorkspaceID), batch.SelectionMode, selection.FolderID, values)
		if err != nil {
			return err
		}
	}
	manifest := assetPackageManifest{App: AssetPackageApp, Version: AssetPackageVersion, ExportedAt: time.Now().UTC(), Folders: selection.Folders,
		Tags: []assetPackageTag{}, Assets: []assetPackageAsset{}, Files: []assetPackageFile{}, Failed: []string{}}
	folderIDs := map[string]bool{}
	for _, folder := range manifest.Folders {
		folderIDs[folder.ID] = true
	}
	ids := []string{}
	for _, row := range rows {
		if row.Status == model.AssetExportItemStatusSucceeded {
			ids = append(ids, row.AssetID)
		}
	}
	tagIDs := map[string][]string{}
	if s.tags != nil && len(ids) > 0 {
		scope := WorkspaceScopeFromID(batch.WorkspaceID)
		keys := tagVisibleScopeKeys(batch.UserID, scope)
		details := []repository.AssetTagBindingDetail{}
		for start := 0; start < len(ids); start += AssetExportLookupChunkSize {
			chunk, err := s.tags.repo.ListAssetTagDetails(batch.WorkspaceID, ids[start:min(start+AssetExportLookupChunkSize, len(ids))], keys)
			if err != nil {
				return err
			}
			details = append(details, chunk...)
		}
		definitions, err := s.tags.repo.List(keys)
		if err != nil {
			return err
		}
		byID := map[string]model.Tag{}
		for _, tag := range definitions {
			byID[tag.ID] = tag
		}
		included := map[string]bool{}
		for _, detail := range details {
			if detail.Binding.State != model.AssetTagBindingActive || detail.Tag.Status != model.TagStatusActive {
				continue
			}
			tagIDs[detail.Binding.AssetID] = append(tagIDs[detail.Binding.AssetID], detail.Tag.ID)
			for id := detail.Tag.ID; id != "" && !included[id]; id = byID[id].ParentID {
				if _, ok := byID[id]; !ok {
					break
				}
				included[id] = true
			}
		}
		for _, tag := range definitions {
			if !included[tag.ID] {
				continue
			}
			parent := tag.ParentID
			if !included[parent] {
				parent = ""
			}
			manifest.Tags = append(manifest.Tags, assetPackageTag{tag.ID, parent, tag.Name, tag.Description, tag.InheritMode})
		}
	}
	for _, row := range rows {
		if row.Status != model.AssetExportItemStatusSucceeded {
			manifest.Failed = append(manifest.Failed, row.Name)
			continue
		}
		asset := assets[row.AssetID]
		folder := asset.FolderID
		if !folderIDs[folder] {
			folder = ""
		}
		bindings := tagIDs[asset.ID]
		if bindings == nil {
			bindings = []string{}
		}
		sort.Strings(bindings)
		manifest.Assets = append(manifest.Assets, assetPackageAsset{asset.ID, asset.Name, asset.Type, asset.ContentType, folder, asset.Category, row.Tags, bindings, asset.Note})
		manifest.Files = append(manifest.Files, assetPackageFile{asset.ID, row.ArchivePath, asset.ContentType, row.Size})
	}
	payload, err := json.Marshal(manifest)
	if err != nil {
		return err
	}
	return writeZipBytes(archive, AssetPackageManifestName, payload)
}
