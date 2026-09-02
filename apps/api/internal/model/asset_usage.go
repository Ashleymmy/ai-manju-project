package model

import "time"

const (
	AssetUsageGeneration = "generation"
	AssetUsageReference  = "reference"
	AssetUsageDownload   = "download"
	AssetUsageExport     = "export"

	AssetReactionNone     = "none"
	AssetReactionFavorite = "favorite"
	AssetReactionDislike  = "dislike"
)

// AssetUsageEvent is an immutable, idempotent usage fact. Thumbnail and list
// reads never create events.
type AssetUsageEvent struct {
	ID             string    `json:"id" gorm:"primaryKey"`
	WorkspaceID    string    `json:"workspace_id" gorm:"not null;index"`
	AssetID        string    `json:"asset_id" gorm:"not null;index"`
	UserID         string    `json:"user_id" gorm:"not null;index"`
	EventType      string    `json:"event_type" gorm:"not null;index"`
	ContextType    string    `json:"context_type" gorm:"not null;index"`
	ContextID      string    `json:"context_id" gorm:"not null;index"`
	IdempotencyKey string    `json:"-" gorm:"not null;uniqueIndex"`
	OccurredAt     time.Time `json:"occurred_at" gorm:"not null;index"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// AssetUsageAggregate is the list-card read model. Reference and lineage
// counts are reconciled from their source tables and exposed through service.
type AssetUsageAggregate struct {
	AssetID              string     `json:"asset_id" gorm:"primaryKey"`
	WorkspaceID          string     `json:"workspace_id" gorm:"not null;index"`
	GenerationUseCount   int64      `json:"generation_use_count" gorm:"not null;default:0"`
	ActiveReferenceCount int64      `json:"active_reference_count" gorm:"not null;default:0"`
	DerivedAssetCount    int64      `json:"derived_asset_count" gorm:"not null;default:0"`
	DownloadCount        int64      `json:"download_count" gorm:"not null;default:0"`
	ExportCount          int64      `json:"export_count" gorm:"not null;default:0"`
	FavoriteCount        int64      `json:"favorite_count" gorm:"not null;default:0"`
	DislikeCount         int64      `json:"dislike_count" gorm:"not null;default:0"`
	LastUsedAt           *time.Time `json:"last_used_at,omitempty" gorm:"index"`
	CreatedAt            time.Time  `json:"created_at"`
	UpdatedAt            time.Time  `json:"updated_at"`
}

// AssetUserState contains only the current user's private interaction data.
type AssetUserState struct {
	ID          string    `json:"id" gorm:"primaryKey"`
	AssetID     string    `json:"asset_id" gorm:"not null;index;uniqueIndex:idx_asset_user_state"`
	UserID      string    `json:"user_id" gorm:"not null;index;uniqueIndex:idx_asset_user_state"`
	WorkspaceID string    `json:"workspace_id" gorm:"not null;index"`
	Reaction    string    `json:"reaction" gorm:"not null;default:'none';index"`
	PrivateNote string    `json:"private_note" gorm:"not null;default:''"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}
