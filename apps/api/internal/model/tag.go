package model

import "time"

const (
	TagScopeSystem    = "system"
	TagScopePublic    = "public"
	TagScopeWorkspace = "workspace"
	TagScopeUser      = "user"

	TagGlobalScopeKey = "global"

	TagInheritAuto   = "auto"
	TagInheritManual = "manual"
	TagInheritNever  = "never"

	TagStatusActive   = "active"
	TagStatusArchived = "archived"

	AssetTagBindingActive     = "active"
	AssetTagBindingSuppressed = "suppressed"

	AssetTagOriginDirect      = "direct"
	AssetTagOriginInherited   = "inherited"
	AssetTagOriginAISuggested = "ai_suggested"
	AssetTagOriginSystem      = "system"
	AssetTagOriginMigrated    = "migrated"
)

// Tag is a reusable semantic label. Asset and prompt usage are deliberately
// independent so a shared label never mixes their binding data.
type Tag struct {
	ID             string    `json:"id" gorm:"primaryKey"`
	ScopeType      string    `json:"scope_type" gorm:"not null;index"`
	ScopeKey       string    `json:"scope_key" gorm:"not null;index;uniqueIndex:idx_tag_scope_parent_name"`
	CreatedBy      string    `json:"created_by" gorm:"not null;index"`
	ParentID       string    `json:"parent_id" gorm:"not null;default:'';index;uniqueIndex:idx_tag_scope_parent_name"`
	Name           string    `json:"name" gorm:"not null"`
	NormalizedName string    `json:"-" gorm:"not null;uniqueIndex:idx_tag_scope_parent_name"`
	Description    string    `json:"description" gorm:"type:text"`
	AssetEnabled   bool      `json:"asset_enabled" gorm:"not null;default:false;index"`
	PromptEnabled  bool      `json:"prompt_enabled" gorm:"not null;default:false;index"`
	InheritMode    string    `json:"inherit_mode" gorm:"not null;default:'auto';index"`
	Status         string    `json:"status" gorm:"not null;default:'active';index"`
	SortOrder      int       `json:"sort_order" gorm:"not null;default:0"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type TagClosure struct {
	AncestorID   string    `json:"ancestor_id" gorm:"primaryKey;index"`
	DescendantID string    `json:"descendant_id" gorm:"primaryKey;index"`
	Depth        int       `json:"depth" gorm:"not null;index"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type TagAlias struct {
	ID              string    `json:"id" gorm:"primaryKey"`
	TagID           string    `json:"tag_id" gorm:"not null;index;uniqueIndex:idx_tag_alias_name"`
	Alias           string    `json:"alias" gorm:"not null"`
	NormalizedAlias string    `json:"-" gorm:"not null;uniqueIndex:idx_tag_alias_name"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type AssetTagBinding struct {
	ID          string    `json:"id" gorm:"primaryKey"`
	WorkspaceID string    `json:"workspace_id" gorm:"not null;index"`
	AssetID     string    `json:"asset_id" gorm:"not null;index;uniqueIndex:idx_asset_tag_binding"`
	TagID       string    `json:"tag_id" gorm:"not null;index;uniqueIndex:idx_asset_tag_binding"`
	State       string    `json:"state" gorm:"not null;default:'active';index"`
	CreatedBy   string    `json:"created_by" gorm:"not null;index"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type AssetTagOrigin struct {
	ID            string    `json:"id" gorm:"primaryKey"`
	BindingID     string    `json:"binding_id" gorm:"not null;index"`
	OriginType    string    `json:"origin_type" gorm:"not null;index"`
	SourceAssetID string    `json:"source_asset_id" gorm:"index"`
	SourceJobID   string    `json:"source_job_id" gorm:"index"`
	SourceNodeID  string    `json:"source_node_id" gorm:"index"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type PromptTagBinding struct {
	ID        string    `json:"id" gorm:"primaryKey"`
	PromptID  string    `json:"prompt_id" gorm:"not null;index;uniqueIndex:idx_prompt_tag_binding"`
	TagID     string    `json:"tag_id" gorm:"not null;index;uniqueIndex:idx_prompt_tag_binding"`
	CreatedBy string    `json:"created_by" gorm:"not null;index"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
