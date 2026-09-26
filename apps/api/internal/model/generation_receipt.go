package model

import "time"

const (
	GenerationReceiptKindText  = "text"
	GenerationReceiptKindAudio = "audio"
	// Submission receipt is distinct from the background text execution receipt.
	GenerationReceiptKindComicAnalysis = "comic_analysis"
	// Comic revision and prompt receipts protect synchronous, billable text
	// provider calls when the browser loses the HTTP response. They are kept
	// separate from the generic text route so a client key cannot cross a
	// resource operation.
	GenerationReceiptKindComicRevision = "comic_revision"
	GenerationReceiptKindComicPrompt   = "comic_prompt"
	// Batch submission and explicit retry receipts protect asynchronous jobs
	// from a second paid dispatch when the first acceptance response is lost.
	GenerationReceiptKindComicBatch = "comic_batch"

	GenerationReceiptStateRunning   = "running"
	GenerationReceiptStateSucceeded = "succeeded"
	GenerationReceiptStateFailed    = "failed"
	GenerationReceiptStateUncertain = "uncertain"
	GenerationReceiptStateExpired   = "expired"
	// A reconciliation won the initial claim before submission. This key must
	// never start an execution, even after the normal receipt retention period.
	GenerationReceiptStateNotSubmitted = "not_submitted"
)

// GenerationReceipt records submission ownership, never prompts, credentials,
// object URLs or generated media. Keys remain reserved after logical expiry.
type GenerationReceipt struct {
	ID             string    `json:"id" gorm:"primaryKey;size:64"`
	UserID         string    `json:"-" gorm:"size:256;not null;uniqueIndex:idx_generation_receipt_scope,priority:1"`
	WorkspaceID    string    `json:"-" gorm:"size:256;not null;uniqueIndex:idx_generation_receipt_scope,priority:2"`
	Kind           string    `json:"kind" gorm:"size:16;not null;uniqueIndex:idx_generation_receipt_scope,priority:3"`
	Key            string    `json:"-" gorm:"size:256;not null;uniqueIndex:idx_generation_receipt_scope,priority:4"`
	RequestHash    string    `json:"-" gorm:"size:64;not null"`
	ExecutionToken string    `json:"-" gorm:"size:64;not null"`
	State          string    `json:"state" gorm:"size:16;not null;index"`
	Error          string    `json:"error,omitempty" gorm:"size:512"`
	Deadline       time.Time `json:"deadline" gorm:"not null"`
	ExpiresAt      time.Time `json:"expires_at" gorm:"not null;index"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}
