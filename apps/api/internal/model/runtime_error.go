package model

import "time"

// RuntimeError stores diagnostic metadata, never request bodies or credentials.
// Worker attempt details are administrator-only; Message remains user-safe.
type RuntimeError struct {
	ID             string    `json:"id" gorm:"primaryKey"`
	UserID         string    `json:"user_id" gorm:"index:idx_runtime_user_time,priority:1"`
	Source         string    `json:"source" gorm:"index"`
	RequestID      string    `json:"request_id" gorm:"index"`
	JobID          string    `json:"job_id" gorm:"index"`
	ProjectID      string    `json:"project_id"`
	NodeID         string    `json:"node_id"`
	Operation      string    `json:"operation"`
	Model          string    `json:"model"`
	Endpoint       string    `json:"endpoint"`
	Method         string    `json:"method"`
	HTTPStatus     int       `json:"http_status"`
	ProviderStatus int       `json:"provider_status"`
	DurationMS     int64     `json:"duration_ms"`
	ErrorCode      string    `json:"error_code" gorm:"index"`
	Message        string    `json:"message"`
	Detail         string    `json:"detail"`
	Suggestion     string    `json:"suggestion"`
	Attempt        int       `json:"attempt"`
	Retryable      bool      `json:"retryable"`
	CreatedAt      time.Time `json:"created_at" gorm:"index;index:idx_runtime_user_time,priority:2"`
}
