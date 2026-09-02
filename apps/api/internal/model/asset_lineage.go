package model

import "time"

const (
	AssetIngestionAutomatic = "automatic"
	AssetIngestionManual    = "manual"
	AssetIngestionMigrated  = "migrated"

	AssetLineageGeneration = "generation"
	AssetLineageEdit       = "edit"
	AssetLineageCrop       = "crop"
	AssetLineageAnnotation = "annotation"
	AssetLineageCompress   = "compress"
	AssetLineageImport     = "import"
)

type AssetLineage struct {
	ID              string    `json:"id" gorm:"primaryKey"`
	WorkspaceID     string    `json:"workspace_id" gorm:"not null;index;uniqueIndex:idx_asset_lineage_identity"`
	ParentAssetID   string    `json:"parent_asset_id" gorm:"not null;index;uniqueIndex:idx_asset_lineage_identity"`
	ChildAssetID    string    `json:"child_asset_id" gorm:"not null;index;uniqueIndex:idx_asset_lineage_identity"`
	RelationType    string    `json:"relation_type" gorm:"not null;index;uniqueIndex:idx_asset_lineage_identity"`
	SourceProjectID string    `json:"source_project_id" gorm:"index"`
	SourceNodeID    string    `json:"source_node_id" gorm:"index"`
	SourceJobID     string    `json:"source_job_id" gorm:"index"`
	InputOrdinal    int       `json:"input_ordinal" gorm:"not null;uniqueIndex:idx_asset_lineage_identity"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}
