package model

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"time"
)

type JSONB json.RawMessage

func (j JSONB) MarshalJSON() ([]byte, error) {
	if len(j) == 0 {
		return []byte("{}"), nil
	}

	return j, nil
}

func (j *JSONB) UnmarshalJSON(data []byte) error {
	if !json.Valid(data) {
		return errors.New("invalid JSONB")
	}

	*j = append((*j)[0:0], data...)
	return nil
}

func (j JSONB) Value() (driver.Value, error) {
	if len(j) == 0 {
		return []byte("{}"), nil
	}

	return []byte(j), nil
}

func (j *JSONB) Scan(value any) error {
	if value == nil {
		*j = JSONB("{}")
		return nil
	}

	var bytes []byte
	switch v := value.(type) {
	case []byte:
		bytes = v
	case string:
		bytes = []byte(v)
	default:
		return errors.New("unsupported JSONB scan type")
	}

	if !json.Valid(bytes) {
		return errors.New("invalid JSONB value")
	}

	*j = append((*j)[0:0], bytes...)
	return nil
}

// User 用户模型
type User struct {
	ID           string    `json:"id" gorm:"primaryKey"`
	Username     string    `json:"username" gorm:"uniqueIndex;not null"`
	PasswordHash string    `json:"-" gorm:"not null"`
	DisplayName  string    `json:"display_name"`
	Role         string    `json:"role" gorm:"not null;index"`
	Status       string    `json:"status" gorm:"not null;index"`
	Email        string    `json:"email"`
	Name         string    `json:"name"`
	Avatar       string    `json:"avatar"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

const (
	UserRoleSuperAdmin = "super_admin"
	UserRoleMember     = "member"

	UserStatusActive   = "active"
	UserStatusDisabled = "disabled"
)

// Session stores a hashed opaque session token. The raw token only lives in the
// HttpOnly browser cookie.
type Session struct {
	ID        string     `json:"id" gorm:"primaryKey"`
	UserID    string     `json:"user_id" gorm:"not null;index"`
	ExpiresAt time.Time  `json:"expires_at" gorm:"not null;index"`
	RevokedAt *time.Time `json:"revoked_at"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

// UserPreference stores non-sensitive, per-user production preferences.
// Secrets such as provider API keys and WebDAV passwords stay out of this row.
type UserPreference struct {
	ID         string    `json:"id" gorm:"primaryKey"`
	UserID     string    `json:"user_id" gorm:"not null;uniqueIndex"`
	Generation JSONB     `json:"generation" gorm:"type:jsonb"`
	Shortcuts  JSONB     `json:"shortcuts" gorm:"type:jsonb"`
	Canvas     JSONB     `json:"canvas" gorm:"type:jsonb"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// Project 项目模型
type Project struct {
	ID          string    `json:"id" gorm:"primaryKey"`
	Title       string    `json:"title" gorm:"not null"`
	OwnerID     string    `json:"owner_id" gorm:"not null;index"`
	WorkspaceID string    `json:"workspace_id" gorm:"index"`
	Scope       string    `json:"scope" gorm:"-"`
	Data        JSONB     `json:"data" gorm:"-"`
	// CoverAssetID 用户自定义的项目封面资产 ID；为空时前端回退到默认抽象封面。
	// 独立于 Data（画布快照）持久化，避免被画布保存覆盖。
	CoverAssetID string    `json:"cover_asset_id" gorm:"type:text;default:''"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// CanvasSnapshot stores the latest canvas document for an MVP project.
type CanvasSnapshot struct {
	ProjectID string    `json:"project_id" gorm:"primaryKey"`
	Version   int       `json:"version"`
	Data      JSONB     `json:"data" gorm:"type:jsonb"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (CanvasSnapshot) TableName() string {
	return "project_snapshots"
}

// Asset 素材模型
type Asset struct {
	ID              string     `json:"id" gorm:"primaryKey"`
	UserID          string     `json:"user_id" gorm:"not null"`
	WorkspaceID     string     `json:"workspace_id" gorm:"index;index:idx_assets_workspace_folder_created,priority:1;index:idx_assets_workspace_category_created,priority:1;index:idx_assets_workspace_source_project,priority:1;index:idx_assets_workspace_source_job,priority:1;index:idx_assets_workspace_trash,priority:1;index:idx_assets_workspace_lifecycle_created,priority:1"`
	Scope           string     `json:"scope" gorm:"-"`
	Type            string     `json:"type" gorm:"not null"` // image, video, audio
	Name            string     `json:"name"`
	URL             string     `json:"url" gorm:"not null"`
	Size            int64      `json:"size"`
	ContentType     string     `json:"content_type"`
	FolderID        string     `json:"folder_id" gorm:"index;index:idx_assets_workspace_folder_created,priority:2"`
	Category        string     `json:"category" gorm:"index;index:idx_assets_workspace_category_created,priority:2"`
	Tags            JSONB      `json:"tags" gorm:"type:jsonb"`
	Note            string     `json:"note" gorm:"type:text"`
	SourceType      string     `json:"source_type" gorm:"index;index:idx_assets_workspace_source_project,priority:2"`
	SourceProjectID string     `json:"source_project_id" gorm:"index;index:idx_assets_workspace_source_project,priority:3"`
	SourceBatchID   string     `json:"source_batch_id" gorm:"index"`
	SourceItemID    string     `json:"source_item_id" gorm:"index"`
	SourceJobID     string     `json:"source_job_id" gorm:"index;index:idx_assets_workspace_source_job,priority:2"`
	SourceMetadata  JSONB      `json:"source_metadata" gorm:"type:jsonb"`
	ContentSHA256   string     `json:"content_sha256,omitempty" gorm:"size:64;index"`
	IngestionMode   string     `json:"ingestion_mode,omitempty" gorm:"index"`
	TrashedAt       *time.Time `json:"trashed_at,omitempty" gorm:"index;index:idx_assets_workspace_trash,priority:2;index:idx_assets_workspace_lifecycle_created,priority:2"`
	TrashExpiresAt  *time.Time `json:"trash_expires_at,omitempty" gorm:"index"`
	TrashedBy       string     `json:"trashed_by,omitempty" gorm:"index"`
	CreatedAt       time.Time  `json:"created_at" gorm:"index:idx_assets_workspace_folder_created,priority:3;index:idx_assets_workspace_category_created,priority:3;index:idx_assets_workspace_lifecycle_created,priority:3"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

// SeedanceAssetGroup mirrors the Volcengine AIGC asset group used by the
// pseudo-human material library.
type SeedanceAssetGroup struct {
	ID             string    `json:"id" gorm:"primaryKey"`
	ProviderID     string    `json:"provider_id" gorm:"not null;index"`
	VolcanoGroupID string    `json:"volcano_group_id" gorm:"not null;uniqueIndex"`
	Name           string    `json:"name" gorm:"not null;index"`
	GroupType      string    `json:"group_type" gorm:"not null;index"`
	ProjectName    string    `json:"project_name" gorm:"not null;index"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// SeedanceAsset stores a local, searchable mirror of Volcengine asset://
// materials used by Seedance video generation.
type SeedanceAsset struct {
	ID             string             `json:"id" gorm:"primaryKey"`
	ProviderID     string             `json:"provider_id" gorm:"not null;index"`
	VolcanoAssetID string             `json:"volcano_asset_id" gorm:"not null;uniqueIndex"`
	VolcanoGroupID string             `json:"volcano_group_id" gorm:"index"`
	Name           string             `json:"name" gorm:"not null;index"`
	Description    string             `json:"description"`
	AssetType      string             `json:"asset_type" gorm:"not null;index"`
	StorageKey     string             `json:"storage_key"`
	SourceURL      string             `json:"source_url"`
	ContentType    string             `json:"content_type"`
	Size           int64              `json:"size"`
	Status         string             `json:"status" gorm:"not null;index"`
	CreatedBy      string             `json:"created_by" gorm:"index"`
	LastSyncAt     *time.Time         `json:"last_sync_at"`
	ErrorMessage   string             `json:"error_message"`
	Metadata       JSONB              `json:"metadata" gorm:"type:jsonb"`
	Tags           []SeedanceAssetTag `json:"tags" gorm:"many2many:seedance_asset_tag_bindings;foreignKey:ID;joinForeignKey:AssetID;References:ID;joinReferences:TagID"`
	CreatedAt      time.Time          `json:"created_at"`
	UpdatedAt      time.Time          `json:"updated_at"`
}

type SeedanceAssetTag struct {
	ID        string    `json:"id" gorm:"primaryKey"`
	Name      string    `json:"name" gorm:"not null;uniqueIndex:idx_seedance_asset_tag_scope_name"`
	Color     string    `json:"color"`
	Scope     string    `json:"scope" gorm:"not null;uniqueIndex:idx_seedance_asset_tag_scope_name"`
	CreatedBy string    `json:"created_by" gorm:"index"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type SeedanceAssetTagBinding struct {
	ID        string    `json:"id" gorm:"primaryKey"`
	AssetID   string    `json:"asset_id" gorm:"not null;uniqueIndex:idx_seedance_asset_tag_binding"`
	TagID     string    `json:"tag_id" gorm:"not null;uniqueIndex:idx_seedance_asset_tag_binding"`
	CreatedAt time.Time `json:"created_at"`
}

const (
	SeedanceAssetGroupDefaultName = "volcengine_asset"
	SeedanceAssetGroupTypeAIGC    = "AIGC"
	SeedanceAssetProjectDefault   = "default"

	SeedanceAssetTypeImage = "Image"
	SeedanceAssetTypeVideo = "Video"

	SeedanceAssetStatusQueued     = "queued"
	SeedanceAssetStatusCreating   = "Creating"
	SeedanceAssetStatusProcessing = "Processing"
	SeedanceAssetStatusActive     = "Active"
	SeedanceAssetStatusFailed     = "Failed"

	SeedanceAssetTagScope = "seedance_asset"
)

const (
	SystemAnnouncementKindUpdate      = "update"
	SystemAnnouncementKindMaintenance = "maintenance"
	SystemAnnouncementKindNotice      = "notice"

	SystemAnnouncementStatusActive  = "active"
	SystemAnnouncementStatusRevoked = "revoked"
)

// SystemAnnouncement stores a global admin broadcast. v1 keeps at most one
// active announcement, but retained rows provide an admin history.
type SystemAnnouncement struct {
	ID          string     `json:"id" gorm:"primaryKey"`
	Title       string     `json:"title" gorm:"not null"`
	Content     string     `json:"content" gorm:"not null"`
	Kind        string     `json:"kind" gorm:"not null;index"`
	Status      string     `json:"status" gorm:"not null;index"`
	CreatedBy   string     `json:"created_by" gorm:"not null;index"`
	PublishedAt time.Time  `json:"published_at" gorm:"not null;index"`
	RevokedAt   *time.Time `json:"revoked_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

// SystemAnnouncementRead records a user's durable acknowledgement.
type SystemAnnouncementRead struct {
	ID             string    `json:"id" gorm:"primaryKey"`
	AnnouncementID string    `json:"announcement_id" gorm:"not null;uniqueIndex:idx_announcement_user_read"`
	UserID         string    `json:"user_id" gorm:"not null;uniqueIndex:idx_announcement_user_read"`
	ReadAt         time.Time `json:"read_at" gorm:"not null;index"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

const (
	ModelProviderIDDefault = "default"

	ModelProviderModeLocalOpenAI       = "local_openai"
	ModelProviderModeOpenAICompatible  = "openai_compatible"
	ModelProviderTypeOpenAICompatible  = "openai_compatible"
	ModelProviderTypeVolcengineArk     = "volcengine_ark"
	ModelProviderTypeGeminiMedia       = "gemini_media"
	ModelProviderTypeKlingVideo        = "kling_video"
	ModelProviderTypeMinimaxHailuo     = "minimax_hailuo"
	ModelProviderTypeFalHappyHorse     = "fal_happyhorse"
	ModelProviderTypeXAIImagine        = "xai_imagine"
	ModelProviderTypeAliyunYike        = "aliyun_yike"
	ModelProviderAuthTypeNone          = "none"
	ModelProviderAuthTypeBearer        = "bearer"
	ModelProviderAuthTypeXAPIKey       = "x_api_key"
	ModelProviderAuthTypeXGoogAPIKey   = "x_goog_api_key"
	ModelProviderAuthTypeAutoAPIKey    = "auto_api_key"
	ModelProviderAuthTypeCustomHeader  = "custom_header"
	ModelProviderAuthTypeQueryParam    = "query_param"
	ModelProviderDefaultTimeoutMilli   = 300000
	ModelProviderMinTimeoutMilli       = 30000
	ModelProviderMaxTimeoutMilli       = 600000
	ModelProviderDefaultMaxConcurrency = 3
	ModelProviderMinConcurrency        = 1
	ModelProviderMaxConcurrency        = 8

	ImageProtocolAuto                  = "auto"
	ImageProtocolOpenAIImages          = "openai_images"
	ImageProtocolOpenAIResponses       = "openai_responses"
	ImageProtocolOpenAIChatCompletions = "openai_chat_completions"
	ImageProtocolGeminiGenerateContent = "gemini_generate_content"
	ImageProtocolDashScopeMultimodal   = "dashscope_multimodal"
	ImageProtocolStabilityImage        = "stability_image"

	ModelCapabilityText  = "text"
	ModelCapabilityImage = "image"
	ModelCapabilityVideo = "video"
	ModelCapabilityAudio = "audio"
)

// ModelProviderConfig stores the single Beta default OpenAI-compatible model
// service. API keys are encrypted at rest and never returned by normal JSON
// responses.
type ModelProviderConfig struct {
	ID                 string `json:"id" gorm:"primaryKey"`
	Name               string `json:"name"`
	PresetID           string `json:"preset_id" gorm:"index"`
	ProviderType       string `json:"provider_type" gorm:"index"`
	Mode               string `json:"mode" gorm:"not null"`
	BaseURL            string `json:"base_url" gorm:"not null"`
	AuthType           string `json:"auth_type" gorm:"not null"`
	CustomAuthHeader   string `json:"custom_auth_header"`
	AuthQueryParam     string `json:"auth_query_param"`
	APIKeyEncrypted    string `json:"-" gorm:"column:api_key_encrypted"`
	TextModel          string `json:"text_model"`
	ImageModel         string `json:"image_model"`
	VideoModel         string `json:"video_model"`
	AudioModel         string `json:"audio_model"`
	Capabilities       JSONB  `json:"capabilities" gorm:"type:jsonb"`
	ModelsByCapability JSONB  `json:"models_by_capability" gorm:"type:jsonb"`
	// ModelAliases maps the real upstream model ID to an administrator-defined display name.
	ModelAliases JSONB `json:"model_aliases" gorm:"type:jsonb"`
	// ModelProtocols maps an image model ID to its upstream request protocol.
	ModelProtocols    JSONB `json:"model_protocols" gorm:"type:jsonb"`
	DefaultFor        JSONB `json:"default_for" gorm:"type:jsonb"`
	SecretsEncrypted  JSONB `json:"-" gorm:"type:jsonb"`
	EndpointOverrides JSONB `json:"endpoint_overrides" gorm:"type:jsonb"`
	ExtraHeaders      JSONB `json:"extra_headers" gorm:"type:jsonb"`
	TimeoutMS         int   `json:"timeout_ms" gorm:"not null"`
	// MaxConcurrency caps remote calls across every worker replica sharing the
	// same upstream credential fingerprint.
	MaxConcurrency int       `json:"max_concurrency" gorm:"not null;default:3"`
	Enabled        bool      `json:"enabled" gorm:"not null"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

const (
	AIRequestStatusSuccess = "success"
	AIRequestStatusError   = "error"
)

// AIRequestLog records real AI proxy calls for admin monitoring and debugging.
// It intentionally stores operational metadata, not prompts or generated media.
type AIRequestLog struct {
	ID              string    `json:"id" gorm:"primaryKey"`
	RequestID       string    `json:"request_id" gorm:"index"`
	UserID          string    `json:"user_id" gorm:"index"`
	Username        string    `json:"username"`
	UserDisplayName string    `json:"user_display_name"`
	Operation       string    `json:"operation" gorm:"index"`
	Endpoint        string    `json:"endpoint"`
	Model           string    `json:"model" gorm:"index"`
	ProviderMode    string    `json:"provider_mode"`
	ProviderHost    string    `json:"provider_host"`
	Status          string    `json:"status" gorm:"index"`
	HTTPStatus      int       `json:"http_status"`
	ProviderStatus  int       `json:"provider_status"`
	DurationMS      int64     `json:"duration_ms"`
	InputCount      int       `json:"input_count"`
	OutputCount     int       `json:"output_count"`
	EstimatedUnits  int       `json:"estimated_units"`
	ErrorMessage    string    `json:"error_message"`
	ErrorReason     string    `json:"error_reason"`
	ErrorSuggestion string    `json:"error_suggestion"`
	CreatedAt       time.Time `json:"created_at" gorm:"index"`
	UpdatedAt       time.Time `json:"updated_at"`
}

const (
	JobTypeImageGenerate  = "image.generate"
	JobTypeImageEdit      = "image.edit"
	JobTypeVideoGenerate  = "video.generate"
	JobTypeVideoTranscode = "video.transcode"

	JobStatusQueued    = "queued"
	JobStatusRunning   = "running"
	JobStatusSucceeded = "succeeded"
	JobStatusFailed    = "failed"
	JobStatusCanceled  = "canceled"
)

// Job records long-running work submitted by the Go API and executed by the
// worker layer. IdempotencyKey is unique so client retries can return the same
// job without duplicating expensive upstream work.
type Job struct {
	ID             string `json:"id" gorm:"primaryKey"`
	IdempotencyKey string `json:"idempotency_key" gorm:"not null;uniqueIndex"`
	UserID         string `json:"user_id" gorm:"not null;index:idx_jobs_user_status"`
	WorkspaceID    string `json:"workspace_id" gorm:"index"`
	Type           string `json:"type" gorm:"not null;index"`
	Status         string `json:"status" gorm:"not null;index:idx_jobs_user_status"`
	Payload        JSONB  `json:"payload" gorm:"type:jsonb"`
	Result         JSONB  `json:"result" gorm:"type:jsonb"`
	Error          JSONB  `json:"error" gorm:"type:jsonb"`
	Attempts       int    `json:"attempts"`
	MaxAttempts    int    `json:"max_attempts"`
	Progress       int    `json:"progress"`
	// QueuePhase explains why a queued job has not started without changing the
	// stable public status enum.
	QueuePhase string     `json:"queue_phase,omitempty" gorm:"index"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
	StartedAt  *time.Time `json:"started_at,omitempty"`
	FinishedAt *time.Time `json:"finished_at,omitempty"`
}
