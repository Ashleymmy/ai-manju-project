package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/response"
	"github.com/ai-manju/api/internal/sdvideo"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

// 核对入口只挂在 RequireSuperAdmin 组；目标 owner/workspace 从已持久化 Job 获取。
func RegisterSDVideoReconciliation(admin *gin.RouterGroup, jobs *service.JobService, client *sdvideo.Client) {
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		admin.Handle(method, "/sd-video/jobs/:id/reconciliation", func(c *gin.Context) {
			actor := auth.MustCurrentUser(c)
			job, err := jobs.GetSDVideoForAdmin(c.Param("id"), actor)
			if err != nil {
				response.Error(c, http.StatusNotFound, "video job not found")
				return
			}
			if client == nil || !client.Enabled() {
				response.Error(c, http.StatusServiceUnavailable, "sd-video service unavailable")
				return
			}
			var payload any
			if c.Request.Method == http.MethodPost {
				var input struct {
					Decision        string `json:"decision"`
					ExpectedAttempt int    `json:"expected_attempt"`
					EvidenceRef     string `json:"evidence_ref"`
					Confirmed       bool   `json:"confirmed"`
					ProviderTaskID  string `json:"provider_task_id,omitempty"`
				}
				const maxReconciliationBody = 4096 // 仅接受短小结构化核对数据，不接收媒体或凭证。
				decoder := json.NewDecoder(http.MaxBytesReader(c.Writer, c.Request.Body, maxReconciliationBody))
				decoder.DisallowUnknownFields()
				if decoder.Decode(&input) != nil || !input.Confirmed || input.ExpectedAttempt < 1 {
					response.Error(c, http.StatusBadRequest, "invalid reconciliation request")
					return
				}
				var trailing any
				if decoder.Decode(&trailing) != io.EOF {
					response.Error(c, http.StatusBadRequest, "invalid reconciliation request")
					return
				}
				payload = input
			}
			path := "/v1/admin/owners/" + url.PathEscape(job.UserID) + "/tasks/" + url.PathEscape(job.ExternalTaskID) + "/reconciliation"
			remote, err := client.BusinessRequest(c.Request.Context(), c.Request.Method, path, actor, job.WorkspaceID, payload)
			if err != nil {
				code := http.StatusBadGateway
				if failure, ok := err.(*sdvideo.Error); ok && failure.StatusCode >= 400 && failure.StatusCode < 500 {
					code = failure.StatusCode
				}
				response.Error(c, code, "reconciliation rejected or verification unavailable")
				return
			}
			if c.Request.Method == http.MethodPost {
				// 远端核对已经持久化；即使此提示失败，Bridge 定时轮询仍会恢复，不需重复决策。
				if err := jobs.WakeSDVideoReconciliation(job.ID, time.Now().UTC()); err != nil {
					response.Error(c, http.StatusServiceUnavailable, "decision saved; local synchronization pending, safe to repeat the same request")
					return
				}
			}
			response.OK(c, remote.Data)
		})
	}
}
