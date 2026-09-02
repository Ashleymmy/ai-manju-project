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
	jobs *service.JobService
}

func NewJobHandler(jobs *service.JobService) *JobHandler {
	return &JobHandler{jobs: jobs}
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
		response.ErrorWithData(c, http.StatusBadGateway, "failed to enqueue job", gin.H{
			"job":   jobResponse(result.Job),
			"error": err.Error(),
		})
		return
	}
	response.Accepted(c, jobResponse(result.Job))
}

func (h *JobHandler) List(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	jobs, err := h.jobs.ListForUser(user.ID)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
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
	result := make([]gin.H, 0, min(limit, len(jobs)))
	for _, job := range jobs {
		if job.WorkspaceID != workspaceID || (len(statuses) > 0 && !statuses[job.Status]) || (len(types) > 0 && !types[job.Type]) {
			continue
		}
		result = append(result, jobResponse(job))
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
	job, err := h.jobs.GetForUser(c.Param("id"), user.ID)
	if err != nil {
		if errors.Is(err, repository.ErrJobNotFound) {
			response.Error(c, http.StatusNotFound, "job not found")
			return
		}
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, jobResponse(job))
}

func (h *JobHandler) Cancel(c *gin.Context) {
	user := auth.MustCurrentUser(c)
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
	response.OK(c, jobResponse(job))
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
			job, err := h.jobs.GetForUser(jobID, user.ID)
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
			writeJobSSE(c, eventName, gin.H{"type": eventName, "job": jobResponse(job)})
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
	return gin.H{
		"id":              job.ID,
		"job_id":          job.ID,
		"idempotency_key": job.IdempotencyKey,
		"user_id":         job.UserID,
		"workspace_id":    job.WorkspaceID,
		"scope":           workspaceScopeFromID(job.WorkspaceID),
		"type":            job.Type,
		"status":          job.Status,
		"payload":         job.Payload,
		"result":          job.Result,
		"error":           job.Error,
		"attempts":        job.Attempts,
		"max_attempts":    job.MaxAttempts,
		"progress":        job.Progress,
		"queue_phase":     job.QueuePhase,
		"created_at":      job.CreatedAt,
		"updated_at":      job.UpdatedAt,
		"started_at":      job.StartedAt,
		"finished_at":     job.FinishedAt,
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
