package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/response"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

const nativeRecoveryRequestLimit = 1024 // This action accepts a checkpoint revision only.

func RegisterGenerationRecovery(admin *gin.RouterGroup, jobs *service.JobService) {
	admin.GET("/generation-recovery", func(c *gin.Context) {
		if !model.IsAdminRole(auth.MustCurrentUser(c).Role) {
			response.Error(c, http.StatusForbidden, "admin required")
			return
		}
		limit, _ := strconv.Atoi(c.Query("limit"))
		offset, _ := strconv.Atoi(c.Query("offset"))
		page, err := jobs.ListNativeRecovery(limit, offset)
		if err != nil {
			response.Error(c, http.StatusServiceUnavailable, "生成恢复记录暂时无法读取")
			return
		}
		response.OK(c, page)
	})
	admin.POST("/generation-recovery/:id/resume", func(c *gin.Context) {
		actor := auth.MustCurrentUser(c)
		if !model.IsAdminRole(actor.Role) || model.IsReadOnlyAdminRole(actor.Role) {
			response.Error(c, http.StatusForbidden, "auditor account is read-only")
			return
		}
		var input struct {
			ExpectedRevision int `json:"expected_revision"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(c.Writer, c.Request.Body, nativeRecoveryRequestLimit))
		decoder.DisallowUnknownFields()
		var trailing any
		if decoder.Decode(&input) != nil || input.ExpectedRevision < 1 || decoder.Decode(&trailing) != io.EOF {
			response.Error(c, http.StatusBadRequest, "invalid recovery request")
			return
		}
		row, err := jobs.ResumeNativeRecovery(c.Request.Context(), actor, c.Param("id"), input.ExpectedRevision)
		if err != nil {
			switch {
			case errors.Is(err, repository.ErrJobNotFound):
				response.Error(c, http.StatusNotFound, "job not found")
			case errors.Is(err, repository.ErrJobRecoveryBusy):
				response.Error(c, http.StatusConflict, "原任务仍在处理中，请稍后刷新状态")
			case errors.Is(err, repository.ErrJobRecoveryConflict):
				response.Error(c, http.StatusConflict, "任务状态已变化，请刷新后再操作")
			case errors.Is(err, service.ErrNativeRecoveryUnavailable):
				response.Error(c, http.StatusConflict, err.Error())
			case errors.Is(err, service.ErrNativeRecoveryForbidden):
				response.Error(c, http.StatusForbidden, err.Error())
			default:
				response.Error(c, http.StatusServiceUnavailable, "恢复请求暂时无法处理，请刷新状态后重试")
			}
			return
		}
		response.Accepted(c, row)
	})
}
