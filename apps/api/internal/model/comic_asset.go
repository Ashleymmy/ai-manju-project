package model

import "time"

const (
	ComicAssetClassCharacter   = "character"
	ComicAssetClassEnvironment = "environment"
	ComicAssetClassProp        = "prop"
	ComicAssetClassUI          = "ui"

	ComicPromptStatusDraft       = "draft"
	ComicPromptStatusNeedsReview = "needs_review"
	ComicPromptStatusApproved    = "approved"

	ComicAssetArchivePending  = "待生图"
	ComicAssetArchiveFailed   = "生成失败"
	ComicAssetArchiveArchived = "已归档待审核"

	ComicBatchStatusQueued        = "queued"
	ComicBatchStatusRunning       = "running"
	ComicBatchStatusPaused        = "paused"
	ComicBatchStatusStopping      = "stopping"
	ComicBatchStatusSucceeded     = "succeeded"
	ComicBatchStatusPartialFailed = "partial_failed"
	ComicBatchStatusCanceled      = "canceled"

	ComicBatchItemStatusPending   = "pending"
	ComicBatchItemStatusQueued    = "queued"
	ComicBatchItemStatusRunning   = "running"
	ComicBatchItemStatusSucceeded = "succeeded"
	ComicBatchItemStatusFailed    = "failed"
	ComicBatchItemStatusCanceled  = "canceled"
)

// ComicAssetProject is an authenticated, workspace-scoped production project
// for the comic asset assistant. It is intentionally separate from canvas
// projects so storyboard snapshots and asset-table records cannot overwrite
// each other.
type ComicAssetProject struct {
	ID                string    `json:"id" gorm:"primaryKey"`
	OwnerID           string    `json:"owner_id" gorm:"not null;index"`
	WorkspaceID       string    `json:"workspace_id" gorm:"not null;index"`
	Scope             string    `json:"scope" gorm:"-"`
	Title             string    `json:"title" gorm:"not null"`
	StylePreset       string    `json:"style_preset"`
	DefaultTemplates  JSONB     `json:"default_templates" gorm:"type:jsonb"`
	SourceType        string    `json:"source_type" gorm:"index"`
	SourceFileName    string    `json:"source_file_name"`
	SourceStorageKey  string    `json:"-"`
	SourceContentType string    `json:"source_content_type"`
	SourceSize        int64     `json:"source_size"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

// ComicAsset stores one character, environment, prop, or UI production
// record. Source, draft, and approved prompts remain separate so automated
// processing never destroys the imported C-column text.
type ComicAsset struct {
	ID                string    `json:"id" gorm:"primaryKey"`
	ProjectID         string    `json:"project_id" gorm:"not null;index;uniqueIndex:idx_comic_asset_project_code"`
	Code              string    `json:"code" gorm:"not null;uniqueIndex:idx_comic_asset_project_code"`
	Class             string    `json:"class" gorm:"not null;index"`
	Name              string    `json:"name" gorm:"not null"`
	State             string    `json:"state"`
	Description       string    `json:"description" gorm:"type:text"`
	VisualDescription string    `json:"visual_description" gorm:"type:text"`
	ChangeRequest     string    `json:"change_request" gorm:"type:text"`
	SourcePrompt      string    `json:"source_prompt" gorm:"type:text"`
	DraftPrompt       string    `json:"draft_prompt" gorm:"type:text"`
	ApprovedPrompt    string    `json:"approved_prompt" gorm:"type:text"`
	PromptTemplate    string    `json:"prompt_template" gorm:"type:text"`
	PromptStatus      string    `json:"prompt_status" gorm:"not null;index"`
	PromptVersion     int       `json:"prompt_version" gorm:"not null"`
	PromptWarnings    JSONB     `json:"prompt_warnings" gorm:"type:jsonb"`
	PromptRevisions   JSONB     `json:"prompt_revisions" gorm:"type:jsonb"`
	ArchiveStatus     string    `json:"archive_status" gorm:"not null;index"`
	OutputVersion     int       `json:"output_version" gorm:"not null"`
	Outputs           JSONB     `json:"outputs" gorm:"type:jsonb"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

// ComicAssetGenerationBatch persists batch control independently from the
// browser. ModelSelector is the provider-aware selection while Model stores
// the resolved upstream model snapshot.
type ComicAssetGenerationBatch struct {
	ID                       string     `json:"id" gorm:"primaryKey"`
	ProjectID                string     `json:"project_id" gorm:"not null;index"`
	UserID                   string     `json:"user_id" gorm:"not null;index"`
	WorkspaceID              string     `json:"workspace_id" gorm:"not null;index"`
	Scope                    string     `json:"scope" gorm:"-"`
	IdempotencyKey           string     `json:"-" gorm:"uniqueIndex"`
	RequestFingerprint       string     `json:"-"`
	Status                   string     `json:"status" gorm:"not null;index"`
	ModelSelector            string     `json:"model_selector"`
	Model                    string     `json:"model" gorm:"not null"`
	Size                     string     `json:"size"`
	Quality                  string     `json:"quality"`
	DestinationMode          string     `json:"destination_mode" gorm:"not null;default:auto"`
	DestinationFolderID      string     `json:"destination_folder_id" gorm:"index"`
	CreateCategorySubfolders bool       `json:"create_category_subfolders" gorm:"not null;default:true"`
	Concurrency              int        `json:"concurrency" gorm:"not null"`
	Total                    int        `json:"total" gorm:"not null"`
	Pending                  int        `json:"pending" gorm:"not null"`
	Active                   int        `json:"active" gorm:"not null"`
	Succeeded                int        `json:"succeeded" gorm:"not null"`
	Failed                   int        `json:"failed" gorm:"not null"`
	Canceled                 int        `json:"canceled" gorm:"not null"`
	CreatedAt                time.Time  `json:"created_at"`
	UpdatedAt                time.Time  `json:"updated_at"`
	StartedAt                *time.Time `json:"started_at,omitempty"`
	FinishedAt               *time.Time `json:"finished_at,omitempty"`
}

// ComicAssetGenerationItem is the immutable prompt/config snapshot for one
// asset in one generation batch. Retries increment Attempt and intentionally
// keep PromptSnapshot unchanged.
type ComicAssetGenerationItem struct {
	ID             string    `json:"id" gorm:"primaryKey"`
	BatchID        string    `json:"batch_id" gorm:"not null;index"`
	ComicAssetID   string    `json:"comic_asset_id" gorm:"not null;index"`
	AssetCode      string    `json:"asset_code"`
	AssetName      string    `json:"asset_name"`
	Position       int       `json:"position" gorm:"not null"`
	VariantIndex   int       `json:"variant_index" gorm:"not null;default:1"`
	Status         string    `json:"status" gorm:"not null;index"`
	PromptSnapshot string    `json:"prompt_snapshot" gorm:"type:text;not null"`
	ConfigSnapshot JSONB     `json:"config_snapshot" gorm:"type:jsonb"`
	Attempt        int       `json:"attempt" gorm:"not null"`
	JobID          string    `json:"job_id" gorm:"index"`
	OutputAssetID  string    `json:"output_asset_id" gorm:"index"`
	OutputFolderID string    `json:"output_folder_id" gorm:"index"`
	OutputVersion  int       `json:"output_version"`
	Error          JSONB     `json:"error" gorm:"type:jsonb"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type ComicPromptRevision struct {
	Version        int                     `json:"version"`
	Source         string                  `json:"source"`
	Content        string                  `json:"content"`
	Approved       bool                    `json:"approved"`
	Operation      string                  `json:"operation,omitempty"`
	BasedOn        []string                `json:"based_on,omitempty"`
	Direction      string                  `json:"direction,omitempty"`
	RequestedModel string                  `json:"requested_model,omitempty"`
	ResponseModel  string                  `json:"response_model,omitempty"`
	MergeReport    *ComicPromptMergeReport `json:"merge_report,omitempty"`
	CreatedAt      time.Time               `json:"created_at"`
}

// ComicPromptMergeReport keeps the model's coverage account beside the
// immutable merged candidate so reviewers can inspect omissions and conflicts.
type ComicPromptMergeReport struct {
	RetainedFromSource []string `json:"retained_from_source"`
	RetainedFromLatest []string `json:"retained_from_latest"`
	Conflicts          []string `json:"conflicts"`
	MissingDetails     []string `json:"missing_details"`
	Warnings           []string `json:"warnings"`
}

type ComicAssetOutput struct {
	Version     int       `json:"version"`
	AssetID     string    `json:"asset_id"`
	BatchID     string    `json:"batch_id"`
	BatchItemID string    `json:"batch_item_id"`
	CreatedAt   time.Time `json:"created_at"`
}
