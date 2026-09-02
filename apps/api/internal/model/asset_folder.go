package model

import "time"

const (
	AssetFolderKindSystem = "system"
	AssetFolderKindUser   = "user"

	AssetFolderSystemKeyRoot                = "system_root"
	AssetFolderSystemKeyUnsorted            = "unsorted"
	AssetFolderSystemKeyUpload              = "manual_upload"
	AssetFolderSystemKeyImageWorkbench      = "image_workbench"
	AssetFolderSystemKeyImageWorkbenchMonth = "image_workbench_month"
	AssetFolderSystemKeyCanvas              = "canvas"
	AssetFolderSystemKeyCanvasProject       = "canvas_project"
	AssetFolderSystemKeyCanvasUnassigned    = "canvas_unassigned"
	AssetFolderSystemKeyCanvasProjectDate   = "canvas_project_date"
	AssetFolderSystemKeyComic               = "comic"
	AssetFolderSystemKeyComicProject        = "comic_project"
	AssetFolderSystemKeyComicCategory       = "comic_category"

	AssetCategoryCharacter   = "character"
	AssetCategoryEnvironment = "environment"
	AssetCategoryCostume     = "costume"
	AssetCategoryProp        = "prop"
	AssetCategoryUI          = "ui"
	AssetCategoryReference   = "reference"
	AssetCategoryOther       = "other"

	AssetSourceManualUpload   = "manual_upload"
	AssetSourceImageWorkbench = "image_workbench"
	AssetSourceCanvas         = "canvas"
	AssetSourceComicBatch     = "comic_batch"
	AssetSourceLegacy         = "legacy"
	AssetSourceUnknown        = "unknown"

	AssetDestinationModeAuto   = "auto"
	AssetDestinationModeCustom = "custom"
)

// AssetFolder is a workspace-scoped logical directory. It never changes the
// physical storage key of an Asset, so moving folders cannot break old URLs.
type AssetFolder struct {
	ID             string    `json:"id" gorm:"primaryKey"`
	WorkspaceID    string    `json:"workspace_id" gorm:"not null;index;uniqueIndex:idx_asset_folder_sibling"`
	Scope          string    `json:"scope" gorm:"-"`
	CreatedBy      string    `json:"created_by" gorm:"not null;index"`
	ParentID       string    `json:"parent_id" gorm:"not null;default:'';index;uniqueIndex:idx_asset_folder_sibling"`
	Name           string    `json:"name" gorm:"not null"`
	NormalizedName string    `json:"-" gorm:"not null;uniqueIndex:idx_asset_folder_sibling"`
	Kind           string    `json:"kind" gorm:"not null;index"`
	SystemKey      string    `json:"system_key" gorm:"index"`
	SourceRefType  string    `json:"source_ref_type" gorm:"index"`
	SourceRefID    string    `json:"source_ref_id" gorm:"index"`
	SystemIdentity *string   `json:"-" gorm:"uniqueIndex"`
	SortOrder      int       `json:"sort_order" gorm:"not null;default:0"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}
