package handler

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/monitoring"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/response"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

// Reporting windows and ingestion bounds protect database and browser memory.
const monitoringMaxHours = 24 * 30
const monitoringDefaultPageSize = 30
const monitoringMaxPageSize = 100
const monitoringClientBodyBytes = 16 * 1024
const monitoringClientPerMinute = 30
const monitoringMaxActiveClients = 10000

var monitoringClientID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,80}$`)

type clientErrorWindow struct {
	until time.Time
	count int
}

type RuntimeMonitoringHandler struct {
	repo    repository.RuntimeMonitoringRepository
	reports *service.RuntimeMonitoringService
	users   repository.UserRepository
	mu      sync.Mutex
	clients map[string]clientErrorWindow
}

func NewRuntimeMonitoringHandler(repo repository.RuntimeMonitoringRepository, users repository.UserRepository) *RuntimeMonitoringHandler {
	return &RuntimeMonitoringHandler{repo: repo, reports: service.NewRuntimeMonitoringService(repo, users), users: users, clients: map[string]clientErrorWindow{}}
}
func (h *RuntimeMonitoringHandler) Get(c *gin.Context) {
	actor, ok := auth.CurrentUser(c)
	if !ok {
		response.Error(c, http.StatusUnauthorized, "authentication required")
		return
	}
	admin := actor.Role == model.UserRoleSuperAdmin
	userID := strings.TrimSpace(c.Query("user_id"))
	if !admin {
		if userID != "" && userID != actor.ID {
			response.Error(c, http.StatusForbidden, "只能查看自己的运行记录")
			return
		}
		userID = actor.ID
	}
	start, ok := parseAdminTimeQuery(c, "start")
	if !ok {
		return
	}
	end, ok := parseAdminTimeQuery(c, "end")
	if !ok {
		return
	}
	hours := queryInt(c, "hours", 24)
	if hours <= 0 || hours > monitoringMaxHours {
		response.Error(c, 400, "时间范围须在 1 小时至 30 天之间")
		return
	}
	if end.IsZero() {
		end = time.Now().UTC()
	}
	if start.IsZero() {
		start = end.Add(-time.Duration(hours) * time.Hour)
	}
	if !end.After(start) || end.Sub(start) > monitoringMaxHours*time.Hour {
		response.Error(c, 400, "时间范围须为正数且不超过 30 天")
		return
	}
	page, size := queryInt(c, "page", 1), queryInt(c, "page_size", monitoringDefaultPageSize)
	if page < 1 || page > repository.MaxMonitoringFacts || size < 1 || size > monitoringMaxPageSize {
		response.Error(c, 400, "无效分页参数")
		return
	}
	status, source := c.Query("status"), c.Query("source")
	if !monitoringOption(status, "", "error", "success", "queued", "running", "canceled") || !monitoringOption(source, "", "api", "ai", "job", "worker", "client") {
		response.Error(c, 400, "无效筛选参数")
		return
	}
	if len(c.Query("q")) > 512 || len(c.Query("model")) > 256 || len(c.Query("code")) > 256 {
		response.Error(c, 400, "筛选内容过长")
		return
	}
	if c.Query("export") == "csv" {
		page, size = 1, repository.MaxMonitoringFacts
	}
	report, err := h.reports.Report(c.Request.Context(), service.MonitoringFilter{Start: start, End: end, UserID: userID, Source: source, Status: status, Code: c.Query("code"), Model: c.Query("model"), Query: c.Query("q"), Page: page, PageSize: size, Admin: admin})
	if err != nil {
		if err == repository.ErrMonitoringTooLarge {
			response.Error(c, 400, err.Error())
		} else {
			response.Error(c, 500, "监控数据读取失败，请稍后重试")
		}
		return
	}
	if c.Query("export") == "csv" {
		response.OK(c, gin.H{"csv": monitoringCSV(report.Items), "total": report.Total})
		return
	}
	response.OK(c, report)
}
func (h *RuntimeMonitoringHandler) Users(c *gin.Context) {
	actor, ok := auth.CurrentUser(c)
	if !ok || actor.Role != model.UserRoleSuperAdmin {
		response.Error(c, 403, "仅超级管理员可以查看用户筛选列表")
		return
	}
	users, err := h.users.ListUsers()
	if err != nil {
		response.Error(c, 500, "用户列表读取失败")
		return
	}
	items := make([]gin.H, 0, len(users))
	for _, u := range users {
		items = append(items, gin.H{"id": u.ID, "username": u.Username, "display_name": u.DisplayName})
	}
	response.OK(c, items)
}
func (h *RuntimeMonitoringHandler) ClientError(c *gin.Context) {
	actor, ok := auth.CurrentUser(c)
	if !ok {
		response.Error(c, 401, "authentication required")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, monitoringClientBodyBytes)
	var input struct {
		ID       string `json:"id"`
		Message  string `json:"message"`
		Detail   string `json:"detail"`
		Endpoint string `json:"endpoint"`
		Code     string `json:"code"`
	}
	if c.ShouldBindJSON(&input) != nil || !monitoringClientID.MatchString(input.ID) || strings.TrimSpace(input.Message) == "" {
		response.Error(c, 400, "无效的客户端错误记录")
		return
	}
	now := time.Now().UTC()
	h.mu.Lock()
	for id, window := range h.clients {
		if now.After(window.until) {
			delete(h.clients, id)
		}
	}
	window := h.clients[actor.ID]
	limited := window.count >= monitoringClientPerMinute || (window.count == 0 && len(h.clients) >= monitoringMaxActiveClients)
	if !limited {
		if window.count == 0 {
			window.until = now.Add(time.Minute)
		}
		window.count++
		h.clients[actor.ID] = window
	}
	h.mu.Unlock()
	if limited {
		response.Error(c, 429, "客户端错误上报过于频繁")
		return
	}
	endpoint := strings.SplitN(strings.SplitN(input.Endpoint, "?", 2)[0], "#", 2)[0]
	if !strings.HasPrefix(endpoint, "/") || strings.HasPrefix(endpoint, "//") {
		endpoint = "/"
	}
	event := model.RuntimeError{ID: "client_" + actor.ID + "_" + input.ID, UserID: actor.ID, Source: "client", Operation: "browser", Endpoint: endpoint, RequestID: response.RequestID(c), Message: monitoring.SafeText(input.Message), Detail: monitoring.SafeText(input.Detail), ErrorCode: "client_error", CreatedAt: now}
	if input.Code == "unhandled_rejection" || input.Code == "render_error" || input.Code == "network_error" {
		event.ErrorCode = input.Code
	}
	if err := h.repo.Record(c.Request.Context(), event); err != nil {
		response.Error(c, 503, "错误记录暂时无法保存")
		return
	}
	response.Created(c, gin.H{"id": event.ID})
}
func monitoringOption(value string, options ...string) bool {
	for _, o := range options {
		if o == value {
			return true
		}
	}
	return false
}
func monitoringCSV(rows []service.MonitoringRow) string {
	var b bytes.Buffer
	b.WriteString("\ufeff")
	w := csv.NewWriter(&b)
	_ = w.Write([]string{"时间", "用户ID", "账号", "来源", "状态", "操作", "模型", "HTTP状态", "上游状态", "错误码", "错误信息", "诊断详情", "处理建议", "请求ID", "任务ID", "项目ID", "节点ID", "尝试次数", "耗时毫秒"})
	for _, r := range rows {
		cells := []string{r.CreatedAt.Format(time.RFC3339), r.UserID, r.Username, r.Source, r.Status, r.Operation, r.Model, fmt.Sprint(r.HTTPStatus), fmt.Sprint(r.ProviderStatus), r.ErrorCode, r.Message, r.Detail, r.Suggestion, r.RequestID, r.JobID, r.ProjectID, r.NodeID, fmt.Sprint(r.Attempt), fmt.Sprint(r.DurationMS)}
		for i, cell := range cells {
			trimmed := strings.TrimLeft(cell, " \t\r\n")
			if trimmed != "" && strings.ContainsAny(trimmed[:1], "=+-@") {
				cells[i] = "'" + cell
			}
		}
		_ = w.Write(cells)
	}
	w.Flush()
	return b.String()
}
