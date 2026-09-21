package middleware

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/gin-gonic/gin"
)

// AdminAuditBodyCaptureLimit caps the request-body snapshot stored in the
// audit detail (防止大请求撑爆日志).
const AdminAuditBodyCaptureLimit = 8 * 1024

// adminAuditRedactedKeys are stripped from recorded request bodies.
var adminAuditRedactedKeys = []string{"password", "password_hash", "api_key", "apikey", "secret", "token", "authorization"}

// AdminAudit records every mutating admin API call into admin_audit_logs
// (append-only; 文档模块8：所有管理员操作全部留痕，不可删除). Read-only calls
// are not logged. Audit write failures never fail the request — the mutation
// has already run — but are logged loudly for ops follow-up.
func AdminAudit(auditRepo repository.AuditRepository) gin.HandlerFunc {
	return func(c *gin.Context) {
		if isReadOnlyMethod(c.Request.Method) {
			c.Next()
			return
		}

		body := captureRequestBody(c)
		c.Next()

		user, ok := auth.CurrentUser(c)
		if !ok {
			return
		}
		entry := model.AdminAuditLog{
			AdminID:    user.ID,
			Action:     AuditActionFor(c.Request.Method, c.FullPath()),
			TargetType: auditTargetType(c.FullPath()),
			TargetID:   auditTargetID(c),
			Detail:     buildAuditDetail(c, body),
			IP:         c.ClientIP(),
			CreatedAt:  time.Now().UTC(),
		}
		if _, err := auditRepo.Append(entry); err != nil {
			log.Printf("event=admin_audit_write_failed admin_id=%s action=%q reason=%q", user.ID, entry.Action, err.Error())
		}
	}
}

// AuditActionFor maps a mutating admin route onto the document's audit action
// vocabulary. Unknown routes fall back to "method path-template" so every call
// stays traceable; WP-M7 handlers extend the known list by naming routes to
// match (refund / adjust-credits / invite/reset / plans / activity).
func AuditActionFor(method string, fullPath string) string {
	path := strings.ToLower(fullPath)
	switch {
	case strings.Contains(path, "/refund"):
		return model.AuditActionRefund
	case strings.Contains(path, "/credits/adjust"), strings.Contains(path, "/adjust-credits"):
		return model.AuditActionAdjustCredits
	case strings.Contains(path, "/invite/reset"), strings.Contains(path, "/reset-invite"):
		return model.AuditActionResetInviteCode
	case strings.Contains(path, "/plans") && method != "GET":
		return model.AuditActionUpdatePlan
	case strings.Contains(path, "/activity") && method != "GET":
		return model.AuditActionUpdateActivity
	case strings.Contains(path, "/users/") && (method == "PUT" || method == "PATCH" || method == "DELETE"):
		return model.AuditActionDisableUser
	default:
		return strings.ToLower(method) + " " + fullPath
	}
}

// auditTargetType derives a coarse target category from the route template.
func auditTargetType(fullPath string) string {
	path := strings.ToLower(fullPath)
	switch {
	case strings.Contains(path, "/users"):
		return "user"
	case strings.Contains(path, "/orders"):
		return "order"
	case strings.Contains(path, "/plans"), strings.Contains(path, "/packages"):
		return "plan"
	case strings.Contains(path, "/activity"), strings.Contains(path, "/configs"):
		return "config"
	case strings.Contains(path, "/invite"):
		return "invite"
	default:
		return "admin"
	}
}

// auditTargetID takes the first route param that looks like an identifier.
func auditTargetID(c *gin.Context) string {
	for _, param := range c.Params {
		if param.Key == "id" || param.Key == "key" || strings.HasSuffix(param.Key, "_id") || strings.HasSuffix(param.Key, "Id") {
			return param.Value
		}
	}
	return ""
}

// buildAuditDetail stores method/path/status plus a redacted body snapshot.
func buildAuditDetail(c *gin.Context, body []byte) model.JSONB {
	detail := map[string]any{
		"method":        c.Request.Method,
		"path":          c.FullPath(),
		"status":        c.Writer.Status(),
		"request_id":    c.GetString("request_id"),
		"body_snapshot": redactBodySnapshot(body),
	}
	raw, err := json.Marshal(detail)
	if err != nil {
		return model.JSONB(`{"error":"audit detail marshal failed"}`)
	}
	return model.JSONB(raw)
}

func captureRequestBody(c *gin.Context) []byte {
	if c.Request.Body == nil {
		return nil
	}
	body, err := io.ReadAll(io.LimitReader(c.Request.Body, AdminAuditBodyCaptureLimit))
	if err != nil {
		body = nil
	}
	c.Request.Body = io.NopCloser(bytes.NewReader(body))
	return body
}

// redactBodySnapshot parses the body and masks sensitive keys; non-JSON bodies
// are dropped entirely (no free-form secrets in the audit log).
func redactBodySnapshot(body []byte) any {
	if len(body) == 0 {
		return nil
	}
	var parsed map[string]any
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "(non-json body omitted)"
	}
	for key := range parsed {
		lowered := strings.ToLower(key)
		for _, sensitive := range adminAuditRedactedKeys {
			if strings.Contains(lowered, sensitive) {
				parsed[key] = "***"
				break
			}
		}
	}
	return parsed
}
