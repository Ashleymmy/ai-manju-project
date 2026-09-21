package handler

import (
	"net/http"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/response"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

// Report bounds avoid accidental unbounded production database scans.
const usageDefaultDays = 30
const usageMaxDays = 366
const maxCostMicros int64 = 1_000_000_000_000

type AdminUsageHandler struct {
	repo    repository.UsageRepository
	reports *service.AdminUsageService
}

func NewAdminUsageHandler(repo repository.UsageRepository, reports *service.AdminUsageService) *AdminUsageHandler {
	return &AdminUsageHandler{repo: repo, reports: reports}
}
func (h *AdminUsageHandler) Report(c *gin.Context) {
	start, ok := parseAdminTimeQuery(c, "start")
	if !ok {
		return
	}
	end, ok := parseAdminTimeQuery(c, "end")
	if !ok {
		return
	}
	if end.IsZero() {
		end = time.Now().UTC()
	}
	if start.IsZero() {
		start = end.AddDate(0, 0, -usageDefaultDays)
	}
	if !end.After(start) || end.Sub(start) > usageMaxDays*24*time.Hour {
		response.Error(c, http.StatusBadRequest, "time range must be positive and no longer than 366 days")
		return
	}
	page, size := parseAdminPagination(c)
	if c.Query("export") == "csv" {
		page, size = 1, repository.MaxUsageFacts
	}
	if page > repository.MaxUsageFacts {
		response.Error(c, http.StatusBadRequest, "page is out of range")
		return
	}
	group := c.DefaultQuery("group_by", "day")
	switch group {
	case "member", "project", "model", "task", "hour", "day", "month":
	default:
		response.Error(c, http.StatusBadRequest, "invalid group_by")
		return
	}
	offset := queryInt(c, "timezone_offset", 0)
	if offset < -14*60 || offset > 14*60 {
		response.Error(c, http.StatusBadRequest, "invalid timezone offset")
		return
	}
	kind := c.Query("member_kind")
	if kind != "" && kind != "internal" && kind != "external" {
		response.Error(c, http.StatusBadRequest, "invalid member kind")
		return
	}
	out, err := h.reports.Report(service.UsageFilter{Start: start, End: end, UserID: c.Query("user_id"), ProjectID: c.Query("project_id"), JobID: c.Query("job_id"), Model: c.Query("model"), Provider: c.Query("provider"), Status: c.Query("status"), TaskType: c.Query("task_type"), MemberKind: kind, GroupBy: group, Page: page, PageSize: size, TimezoneOffset: offset})
	if err != nil {
		status := http.StatusInternalServerError
		if err == repository.ErrUsageTooLarge {
			status = http.StatusBadRequest
		}
		response.Error(c, status, err.Error())
		return
	}
	if c.Query("export") == "csv" {
		content, err := usageCSV(out.Items)
		if err != nil {
			response.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		response.OK(c, gin.H{"csv": content, "total": out.Total})
		return
	}
	response.OK(c, out)
}
func (h *AdminUsageHandler) Rates(c *gin.Context) {
	v, err := h.repo.ListRates()
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, v)
}
func (h *AdminUsageHandler) AddRate(c *gin.Context) {
	actor := auth.MustCurrentUser(c)
	if actor.Role != model.UserRoleSuperAdmin {
		response.Error(c, http.StatusForbidden, "only super administrators may configure cost rates")
		return
	}
	var req struct {
		Model          string    `json:"model"`
		Provider       string    `json:"provider"`
		Unit           string    `json:"unit"`
		UnitCostMicros *int64    `json:"unit_cost_micros"`
		EffectiveAt    time.Time `json:"effective_at"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, "invalid rate")
		return
	}
	if strings.TrimSpace(req.Model) == "" || len(req.Model) > 200 || len(req.Provider) > 200 || req.UnitCostMicros == nil || *req.UnitCostMicros < 0 || *req.UnitCostMicros > maxCostMicros {
		response.Error(c, http.StatusBadRequest, "model and a nonnegative cost are required")
		return
	}
	switch req.Unit {
	case model.CostUnitTask, model.CostUnitImage, model.CostUnitSecond:
	default:
		response.Error(c, http.StatusBadRequest, "invalid cost unit")
		return
	}
	if req.EffectiveAt.IsZero() {
		req.EffectiveAt = time.Now().UTC()
	}
	rate := model.ModelCostRate{ID: "cost_rate_" + randomHex(12), Model: strings.TrimSpace(req.Model), Provider: strings.TrimSpace(req.Provider), Unit: req.Unit, UnitCostMicros: *req.UnitCostMicros, EffectiveAt: req.EffectiveAt, CreatedAt: time.Now().UTC(), OperatorID: actor.ID}
	if err := h.repo.AddRate(rate); err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.Created(c, rate)
}
func (h *AdminUsageHandler) PutActualCost(c *gin.Context) {
	var req struct {
		AmountMicros *int64 `json:"amount_micros"`
		Reference    string `json:"reference"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, "invalid actual cost")
		return
	}
	if req.AmountMicros == nil || *req.AmountMicros < 0 || *req.AmountMicros > maxCostMicros || strings.TrimSpace(req.Reference) == "" || len(req.Reference) > 500 {
		response.Error(c, http.StatusBadRequest, "nonnegative amount and bill reference are required")
		return
	}
	exists, err := h.repo.TaskExists(c.Param("id"))
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if !exists {
		response.Error(c, http.StatusNotFound, "task not found")
		return
	}
	v := model.TaskActualCost{JobID: c.Param("id"), AmountMicros: *req.AmountMicros, Reference: strings.TrimSpace(req.Reference), OperatorID: auth.MustCurrentUser(c).ID, UpdatedAt: time.Now().UTC()}
	if err := h.repo.PutActualCost(v); err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, v)
}
