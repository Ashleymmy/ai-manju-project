package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/response"
	"github.com/ai-manju/api/internal/sdvideo"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

const (
	jobEventProgress  = "job.progress"
	jobEventSucceeded = "job.succeeded"
	jobEventFailed    = "job.failed"
	jobEventHeartbeat = "heartbeat"
)

type JobHandler struct {
	jobs    *service.JobService
	sdVideo *sdvideo.Client
}

func NewJobHandler(jobs *service.JobService) *JobHandler {
	return &JobHandler{jobs: jobs}
}

func (h *JobHandler) SetSDVideoClient(client *sdvideo.Client) { h.sdVideo = client }

func (h *JobHandler) Retry(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	previous, err := h.jobs.GetForUser(c.Param("id"), user.ID)
	if err != nil || previous.WorkspaceID != service.WorkspaceIDForScope(requestWorkspaceScope(c), user.ID) {
		response.Error(c, 404, "job not found")
		return
	}
	if previous.ExternalProvider != "sd-video" || (previous.Status != model.JobStatusFailed && previous.Status != model.JobStatusCanceled) {
		response.Error(c, 409, "only failed or canceled SD-video jobs can be retried")
		return
	}
	if h.sdVideo == nil || !h.sdVideo.Enabled() || h.sdVideo.Mode() != "active" {
		response.Error(c, 503, "new video submissions are disabled")
		return
	}
	var failure map[string]any
	_ = json.Unmarshal(previous.Error, &failure)
	if failure["code"] == "submission_uncertain" {
		response.Error(c, 409, "provider submission must be reconciled before retry")
		return
	}
	var payload map[string]any
	if json.Unmarshal(previous.Payload, &payload) != nil {
		response.Error(c, 409, "job request unavailable")
		return
	}
	if err := h.sdVideo.CreationError(previous.WorkspaceID, stringFromAny(payload["model"])); err != nil {
		response.Error(c, 403, err.Error())
		return
	}
	if err := validateSDVideoCapabilities(c, h.sdVideo, stringFromAny(payload["model"]), payload); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	payload["idempotency_key"], payload["retry_of"] = "retry:"+previous.ID, previous.ID
	if previous.ExternalTaskID != "" {
		payload["retry_task_id"] = previous.ExternalTaskID
	}
	raw, _ := json.Marshal(payload)
	created, err := h.jobs.CreateExternal(service.ExternalJobInput{UserID: user.ID, Scope: requestWorkspaceScope(c), Type: previous.Type, ExternalProvider: "sd-video", Payload: model.JSONB(raw), IdempotencyKey: "retry:" + previous.ID})
	if err != nil {
		response.Error(c, 500, "could not persist retry")
		return
	}
	response.Accepted(c, requestedJobResponse(c, created.Job))
}

func (h *JobHandler) Create(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	var req struct {
		Type    string          `json:"type" binding:"required"`
		Payload json.RawMessage `json:"payload"`
		Scope   string          `json:"scope"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	jobType := normalizeJobType(req.Type)
	if jobType == "" {
		response.Error(c, http.StatusBadRequest, "unsupported job type")
		return
	}
	payload := model.JSONB(req.Payload)
	if len(payload) == 0 {
		payload = model.JSONB("{}")
	}
	if !json.Valid(payload) {
		response.Error(c, http.StatusBadRequest, "payload must be valid JSON")
		return
	}
	result, err := h.jobs.Enqueue(c.Request.Context(), service.EnqueueJobInput{
		UserID:         user.ID,
		Scope:          firstNonEmpty(req.Scope, requestWorkspaceScope(c)),
		Type:           jobType,
		Payload:        payload,
		IdempotencyKey: c.GetHeader("Idempotency-Key"),
	})
	if err != nil {
		if errors.Is(err, repository.ErrInsufficientCredits) {
			response.Error(c, http.StatusPaymentRequired, "积分余额不足，请充值后重试")
			return
		}
		if errors.Is(err, service.ErrConcurrencyLimitExceeded) {
			response.Error(c, http.StatusTooManyRequests, "当前任务并发已达上限，请稍后重试或升级会员")
			return
		}
		response.ErrorWithData(c, http.StatusBadGateway, "failed to enqueue job", gin.H{
			"job":   requestedJobResponse(c, result.Job),
			"error": err.Error(),
		})
		return
	}
	response.Accepted(c, requestedJobResponse(c, result.Job))
}

func (h *JobHandler) List(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	workspaceID := service.WorkspaceIDForScope(requestWorkspaceScope(c), user.ID)
	statuses := commaSeparatedSet(c.Query("status"))
	types := commaSeparatedSet(c.Query("type"))
	limit := 50
	if parsed, parseErr := strconv.Atoi(strings.TrimSpace(c.Query("limit"))); parseErr == nil && parsed > 0 {
		limit = parsed
	}
	if limit > 100 {
		limit = 100
	}
	var jobs []model.Job
	var err error
	if c.Query("view") == "status" {
		keys := func(set map[string]bool) []string {
			values := make([]string, 0, len(set))
			for key := range set {
				values = append(values, key)
			}
			return values
		}
		jobs, err = h.jobs.ListStatusesForUser(c.Request.Context(), user.ID, repository.JobStatusFilter{
			WorkspaceID: workspaceID, Statuses: keys(statuses), Types: keys(types), Limit: limit,
		})
	} else {
		jobs, err = h.jobs.ListForUser(user.ID)
	}
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	result := make([]gin.H, 0, min(limit, len(jobs)))
	for _, job := range jobs {
		if job.WorkspaceID != workspaceID || (len(statuses) > 0 && !statuses[job.Status]) || (len(types) > 0 && !types[job.Type]) {
			continue
		}
		result = append(result, requestedJobResponse(c, job))
		if len(result) >= limit {
			break
		}
	}
	response.OK(c, result)
}

func commaSeparatedSet(value string) map[string]bool {
	result := make(map[string]bool)
	for _, item := range strings.Split(value, ",") {
		if normalized := strings.TrimSpace(item); normalized != "" {
			result[normalized] = true
		}
	}
	return result
}

func (h *JobHandler) Get(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	job, err := h.getRequestedJob(c, c.Param("id"), user.ID)
	if err != nil {
		if errors.Is(err, repository.ErrJobNotFound) && h.sdVideo != nil && h.sdVideo.Enabled() && strings.HasPrefix(c.Param("id"), "sdv_") {
			workspaceID := service.WorkspaceIDForScope(requestWorkspaceScope(c), user.ID)
			remote, remoteErr := h.sdVideo.GetTask(c.Request.Context(), user, workspaceID, c.Param("id"))
			if remoteErr == nil {
				var payload map[string]any
				_ = json.Unmarshal(remote.Data, &payload)
				response.OK(c, gin.H{"id": c.Param("id"), "job_id": c.Param("id"), "external_provider": "sd-video", "external_task_id": c.Param("id"), "status": payload["status"], "progress": payload["progress"], "result": payload["result"], "error": payload["error"]})
				return
			}
		}
		if errors.Is(err, repository.ErrJobNotFound) {
			response.Error(c, http.StatusNotFound, "job not found")
			return
		}
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, requestedJobResponse(c, job))
}

func (h *JobHandler) Cancel(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	// Bridge jobs use a local `job_*` id while the standalone service owns the
	// `sdv_*` task. Forward cancellation for both forms so closing the browser
	// or canceling from the queue cannot leave provider work running.
	current, lookupErr := h.jobs.GetForUser(c.Param("id"), user.ID)
	if strings.HasPrefix(c.Param("id"), "sdv_") {
		current, lookupErr = h.jobs.GetExternalForUser("sd-video", c.Param("id"), user.ID)
	}
	if lookupErr == nil && current.ExternalProvider == "sd-video" {
		if current.WorkspaceID != service.WorkspaceIDForScope(requestWorkspaceScope(c), user.ID) {
			response.Error(c, http.StatusNotFound, "job not found")
			return
		}
		// 先在导入锁内持久化取消；远端故障由 Bridge 补偿，不放行迟到结果。
		canceled, cancelErr := h.jobs.CancelForUser(current.ID, user.ID)
		if cancelErr != nil {
			response.Error(c, http.StatusInternalServerError, "could not cancel job")
			return
		}
		response.OK(c, requestedJobResponse(c, canceled))
		return
	}
	if h.sdVideo != nil && h.sdVideo.Enabled() && strings.HasPrefix(c.Param("id"), "sdv_") {
		workspaceID := service.WorkspaceIDForScope(requestWorkspaceScope(c), user.ID)
		remote, remoteErr := h.sdVideo.CancelTask(c.Request.Context(), user, workspaceID, c.Param("id"))
		if remoteErr == nil {
			var payload map[string]any
			_ = json.Unmarshal(remote.Data, &payload)
			response.OK(c, gin.H{"id": c.Param("id"), "job_id": c.Param("id"), "external_provider": "sd-video", "external_task_id": c.Param("id"), "status": payload["status"], "progress": payload["progress"]})
			return
		}
		if !sdvideo.IsNotFound(remoteErr) {
			response.Error(c, http.StatusBadGateway, remoteErr.Error())
			return
		}
	}
	if strings.TrimSpace(c.Query("scope")) != "" {
		current, err := h.jobs.GetForUser(c.Param("id"), user.ID)
		if err != nil || current.WorkspaceID != service.WorkspaceIDForScope(requestWorkspaceScope(c), user.ID) {
			response.Error(c, http.StatusNotFound, "job not found")
			return
		}
	}
	job, err := h.jobs.CancelForUser(c.Param("id"), user.ID)
	if err != nil {
		if errors.Is(err, repository.ErrJobNotFound) {
			response.Error(c, http.StatusNotFound, "job not found")
			return
		}
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, requestedJobResponse(c, job))
}

func (h *JobHandler) Stream(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	jobID := c.Param("id")

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)
	flushSSE(c)

	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	var lastUpdated time.Time

	for {
		select {
		case <-c.Request.Context().Done():
			return
		case <-heartbeat.C:
			writeJobSSE(c, jobEventHeartbeat, gin.H{"type": jobEventHeartbeat})
			flushSSE(c)
		case <-ticker.C:
			job, err := h.getRequestedJob(c, jobID, user.ID)
			if err != nil {
				writeJobSSE(c, jobEventFailed, gin.H{"type": jobEventFailed, "error": "job not found"})
				flushSSE(c)
				return
			}
			if job.UpdatedAt.Equal(lastUpdated) {
				continue
			}
			lastUpdated = job.UpdatedAt
			eventName := jobEventProgress
			if job.Status == model.JobStatusSucceeded {
				eventName = jobEventSucceeded
			} else if job.Status == model.JobStatusFailed || job.Status == model.JobStatusCanceled {
				eventName = jobEventFailed
			}
			writeJobSSE(c, eventName, gin.H{"type": eventName, "job": requestedJobResponse(c, job)})
			flushSSE(c)
			if isTerminalJobStatus(job.Status) {
				return
			}
		}
	}
}

func normalizeJobType(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case model.JobTypeImageGenerate:
		return model.JobTypeImageGenerate
	case model.JobTypeImageEdit:
		return model.JobTypeImageEdit
	case model.JobTypeVideoGenerate:
		return model.JobTypeVideoGenerate
	case model.JobTypeVideoTranscode:
		return model.JobTypeVideoTranscode
	default:
		return ""
	}
}

func jobResponse(job model.Job) gin.H {
	if !isTerminalJobStatus(job.Status) && (job.QueuePhase == "provider_retry_backoff" || job.QueuePhase == "waiting_provider_slot") {
		// Supplier scheduling is private; users continue to see a pending generation.
		job.Error = model.JSONB("{}")
		job.QueuePhase = ""
		if job.StartedAt != nil {
			job.Status = model.JobStatusRunning
		}
	}
	return gin.H{
		"id":                job.ID,
		"job_id":            job.ID,
		"idempotency_key":   job.IdempotencyKey,
		"user_id":           job.UserID,
		"workspace_id":      job.WorkspaceID,
		"scope":             workspaceScopeFromID(job.WorkspaceID),
		"type":              job.Type,
		"status":            job.Status,
		"payload":           job.Payload,
		"result":            job.Result,
		"error":             job.Error,
		"attempts":          job.Attempts,
		"max_attempts":      job.MaxAttempts,
		"progress":          job.Progress,
		"queue_phase":       job.QueuePhase,
		"created_at":        job.CreatedAt,
		"updated_at":        job.UpdatedAt,
		"started_at":        job.StartedAt,
		"finished_at":       job.FinishedAt,
		"external_provider": job.ExternalProvider,
		"external_task_id":  job.ExternalTaskID,
		"external_status":   job.ExternalStatus,
		"bridge_metadata":   job.BridgeMetadata,
	}
}

func writeJobSSE(c *gin.Context, name string, payload any) {
	if name == "" {
		name = jobEventHeartbeat
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	_, _ = fmt.Fprintf(c.Writer, "event: %s\n", name)
	_, _ = fmt.Fprintf(c.Writer, "data: %s\n\n", data)
}

func isTerminalJobStatus(status string) bool {
	return status == model.JobStatusSucceeded || status == model.JobStatusFailed || status == model.JobStatusCanceled
}

// Status views are opt-in: old integrations retain the full payload contract.
func (h *JobHandler) getRequestedJob(c *gin.Context, id, userID string) (model.Job, error) {
	if c.Query("view") == "status" {
		return h.jobs.GetStatusForUser(c.Request.Context(), id, userID)
	}
	return h.jobs.GetForUser(id, userID)
}

func requestedJobResponse(c *gin.Context, job model.Job) gin.H {
	if c.Query("view") == "status" {
		job = repository.CompactJobStatus(job)
	}
	return jobResponse(job)
}
