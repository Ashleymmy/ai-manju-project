package model

import "time"

// Admin audit actions (后台模块8 口径). All admin operations are traced and the
// log is append-only: the application layer exposes no update/delete, and
// Postgres additionally REVOKEs UPDATE/DELETE in database.go.
const (
	AuditActionLogin           = "login"
	AuditActionRefund          = "refund"
	AuditActionAdjustCredits   = "adjust_credits"
	AuditActionDisableUser     = "disable_user"
	AuditActionResetInviteCode = "reset_invite_code"
	AuditActionUpdatePlan      = "update_plan"
	AuditActionUpdateActivity  = "update_activity"
)

// AdminAuditLog is one administrator action. Detail carries a JSON snapshot of
// the change (e.g. before/after for price edits) so the row alone tells the
// full story.
type AdminAuditLog struct {
	ID         string    `json:"id" gorm:"primaryKey"`
	AdminID    string    `json:"admin_id" gorm:"not null;index"`
	Action     string    `json:"action" gorm:"not null;index"`
	TargetType string    `json:"target_type" gorm:"index"` // user / order / plan / activity / ...
	TargetID   string    `json:"target_id" gorm:"index"`
	Detail     JSONB     `json:"detail" gorm:"type:jsonb"`
	IP         string    `json:"ip"`
	CreatedAt  time.Time `json:"created_at" gorm:"index"`
}
