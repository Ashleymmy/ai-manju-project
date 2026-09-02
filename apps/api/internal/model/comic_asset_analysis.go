package model

import "time"

const (
	// ComicAnalysisStatusActive means the candidate history can still be edited.
	ComicAnalysisStatusActive = "active"
	// ComicAnalysisStatusConfirmed means one immutable revision created a project.
	ComicAnalysisStatusConfirmed = "confirmed"

	ComicAnalysisRevisionSourceInitial = "initial"
	ComicAnalysisRevisionSourceAI      = "ai"
	ComicAnalysisRevisionSourceManual  = "manual"
)

// ComicAssetAnalysisSession persists an unconfirmed script analysis independently
// from the browser. SourceText and SourceStorageKey are server-only because the
// public response only needs source metadata and immutable candidate revisions.
type ComicAssetAnalysisSession struct {
	ID                  string     `json:"id" gorm:"primaryKey"`
	OwnerID             string     `json:"owner_id" gorm:"not null;index"`
	WorkspaceID         string     `json:"workspace_id" gorm:"not null;index"`
	Scope               string     `json:"scope" gorm:"-"`
	Title               string     `json:"title" gorm:"not null"`
	StylePreset         string     `json:"style_preset"`
	DefaultTemplates    JSONB      `json:"default_templates" gorm:"type:jsonb"`
	SourceType          string     `json:"source_type" gorm:"not null"`
	SourceFileName      string     `json:"source_file_name"`
	SourceStorageKey    string     `json:"-"`
	SourceContentType   string     `json:"source_content_type"`
	SourceSize          int64      `json:"source_size"`
	SourceText          string     `json:"-" gorm:"type:text"`
	Status              string     `json:"status" gorm:"not null;index"`
	ActiveRevisionID    string     `json:"active_revision_id" gorm:"index"`
	ConfirmedRevisionID string     `json:"confirmed_revision_id" gorm:"index"`
	ProjectID           string     `json:"project_id" gorm:"index"`
	ExpiresAt           time.Time  `json:"expires_at" gorm:"not null;index"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
	ConfirmedAt         *time.Time `json:"confirmed_at,omitempty"`
}

// ComicAssetAnalysisRevision is immutable. Candidate stores a complete
// {"assets": [...]} snapshot so rollback and branching never depend on a delta.
type ComicAssetAnalysisRevision struct {
	ID               string    `json:"id" gorm:"primaryKey"`
	SessionID        string    `json:"session_id" gorm:"not null;index;uniqueIndex:idx_comic_analysis_session_version"`
	ParentRevisionID string    `json:"parent_revision_id" gorm:"index"`
	Version          int       `json:"version" gorm:"not null;uniqueIndex:idx_comic_analysis_session_version"`
	Source           string    `json:"source" gorm:"not null"`
	Instruction      string    `json:"instruction" gorm:"type:text"`
	RequestedModel   string    `json:"requested_model"`
	ResponseModel    string    `json:"response_model"`
	Candidate        JSONB     `json:"candidate" gorm:"type:jsonb;not null"`
	CreatedAt        time.Time `json:"created_at"`
}
