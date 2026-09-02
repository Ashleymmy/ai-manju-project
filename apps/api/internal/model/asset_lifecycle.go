package model

import "time"

const (
	AssetReferenceTypeCanvasProject = "canvas_project"
	AssetReferenceTypeComicOutput   = "comic_output"
	AssetReferenceTypeComicInput    = "comic_input"

	AssetExportKindAssets         = "assets"
	AssetExportKindCanvasFragment = "canvas_fragment"

	AssetExportStatusQueued        = "queued"
	AssetExportStatusRunning       = "running"
	AssetExportStatusSucceeded     = "succeeded"
	AssetExportStatusPartialFailed = "partial_failed"
	AssetExportStatusFailed        = "failed"
	AssetExportStatusCanceled      = "canceled"
	AssetExportStatusExpired       = "expired"

	AssetExportItemStatusPending   = "pending"
	AssetExportItemStatusSucceeded = "succeeded"
	AssetExportItemStatusFailed    = "failed"
	AssetExportItemStatusCanceled  = "canceled"
)

// AssetReference is an eventually-consistent index used for delete preflight.
// It never owns the referenced asset and therefore intentionally has no
// cascading foreign key.
type AssetReference struct {
	ID            string    `json:"id" gorm:"primaryKey"`
	WorkspaceID   string    `json:"workspace_id" gorm:"not null;index;uniqueIndex:idx_asset_reference_identity"`
	AssetID       string    `json:"asset_id" gorm:"not null;index;uniqueIndex:idx_asset_reference_identity"`
	ReferenceType string    `json:"reference_type" gorm:"not null;index;uniqueIndex:idx_asset_reference_identity"`
	ReferenceID   string    `json:"reference_id" gorm:"not null;index;uniqueIndex:idx_asset_reference_identity"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type AssetExportBatch struct {
	ID             string            `json:"id" gorm:"primaryKey"`
	UserID         string            `json:"user_id" gorm:"not null;index"`
	WorkspaceID    string            `json:"workspace_id" gorm:"not null;index"`
	Scope          string            `json:"scope" gorm:"-"`
	Kind           string            `json:"kind" gorm:"not null;index"`
	Status         string            `json:"status" gorm:"not null;index"`
	SelectionMode  string            `json:"selection_mode"`
	Selection      JSONB             `json:"selection" gorm:"type:jsonb"`
	CanvasFragment JSONB             `json:"canvas_fragment,omitempty" gorm:"type:jsonb"`
	Total          int               `json:"total" gorm:"not null"`
	Succeeded      int               `json:"succeeded" gorm:"not null"`
	Failed         int               `json:"failed" gorm:"not null"`
	Canceled       int               `json:"canceled" gorm:"not null"`
	StorageKey     string            `json:"-"`
	FileName       string            `json:"file_name"`
	Size           int64             `json:"size"`
	Error          JSONB             `json:"error" gorm:"type:jsonb"`
	ExpiresAt      *time.Time        `json:"expires_at,omitempty" gorm:"index"`
	CreatedAt      time.Time         `json:"created_at"`
	UpdatedAt      time.Time         `json:"updated_at"`
	StartedAt      *time.Time        `json:"started_at,omitempty"`
	FinishedAt     *time.Time        `json:"finished_at,omitempty"`
	Items          []AssetExportItem `json:"items,omitempty" gorm:"foreignKey:ExportID"`
}

type AssetExportItem struct {
	ID          string    `json:"id" gorm:"primaryKey"`
	ExportID    string    `json:"export_id" gorm:"not null;index;uniqueIndex:idx_asset_export_item_asset"`
	AssetID     string    `json:"asset_id" gorm:"not null;index;uniqueIndex:idx_asset_export_item_asset"`
	Position    int       `json:"position" gorm:"not null"`
	Status      string    `json:"status" gorm:"not null;index"`
	ArchivePath string    `json:"archive_path"`
	Error       JSONB     `json:"error" gorm:"type:jsonb"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}
