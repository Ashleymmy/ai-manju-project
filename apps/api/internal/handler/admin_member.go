package handler

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/response"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

// 后台列表分页默认值与上限（doc：导出走 ?page_size=10000 大页拉全量，
// 但常规列表仍限 200 防滥用；导出期由前端面板另行约定）。
const (
	adminDefaultPageSize = 20
	adminMaxPageSize     = 200
)

// parseAdminPagination 解析 page/page_size：page 从 1 开始；page_size
// 默认 20、上限 200。供 admin_member.go / admin_billing.go 共用。
func parseAdminPagination(c *gin.Context) (int, int) {
	page := queryInt(c, "page", 1)
	if page < 1 {
		page = 1
	}
	pageSize := queryInt(c, "page_size", adminDefaultPageSize)
	if pageSize < 1 {
		pageSize = adminDefaultPageSize
	}
	if pageSize > adminMaxPageSize {
		pageSize = adminMaxPageSize
	}
	return page, pageSize
}

// parseAdminTimeQuery 解析 RFC3339 query 参数：空串返回零值（不筛），
// 非法值直接写 400 并返回 ok=false。
func parseAdminTimeQuery(c *gin.Context, key string) (time.Time, bool) {
	raw := strings.TrimSpace(c.Query(key))
	if raw == "" {
		return time.Time{}, true
	}
	parsed, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		response.Error(c, http.StatusBadRequest, key+" must be an RFC3339 timestamp")
		return time.Time{}, false
	}
	return parsed, true
}

// AdminMemberHandler 模块1 用户会员管理（列表/调积分/重置邀请码）。
type AdminMemberHandler struct {
	members *service.AdminMemberService
	engine  *service.CreditLedgerService
	invites repository.InviteRepository
}

func NewAdminMemberHandler(members *service.AdminMemberService, engine *service.CreditLedgerService, invites repository.InviteRepository) *AdminMemberHandler {
	return &AdminMemberHandler{members: members, engine: engine, invites: invites}
}

// ListMemberUsers GET /api/admin/member-users?page=&page_size=
func (h *AdminMemberHandler) ListMemberUsers(c *gin.Context) {
	page, pageSize := parseAdminPagination(c)
	rows, total, err := h.members.ListMemberUsers(page, pageSize)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, gin.H{"items": rows, "total": total, "page": page, "page_size": pageSize})
}

type adminAdjustCreditsRequest struct {
	Delta  int64  `json:"delta"`
	Reason string `json:"reason"`
	Nonce  string `json:"nonce"`
}

// AdjustCredits POST /api/admin/member-users/:id/credits/adjust
// body {delta, reason, nonce}；nonce 必填做幂等键；delta==0 拒绝。
func (h *AdminMemberHandler) AdjustCredits(c *gin.Context) {
	var req adminAdjustCreditsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if req.Delta == 0 {
		response.Error(c, http.StatusBadRequest, "delta must not be zero")
		return
	}
	if strings.TrimSpace(req.Nonce) == "" {
		response.Error(c, http.StatusBadRequest, "nonce is required")
		return
	}
	operator := auth.MustCurrentUser(c)
	outcome, err := h.engine.Adjust(c.Param("id"), req.Delta, operator.ID, req.Nonce)
	if err != nil {
		// Adjust 走永久余额允许为负，不会产生 ErrInsufficientCredits；防御性映射。
		if errors.Is(err, repository.ErrInsufficientCredits) {
			response.Error(c, http.StatusPaymentRequired, "insufficient credits")
			return
		}
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, outcome)
}

// ResetInviteCode POST /api/admin/member-users/:id/invite/reset
func (h *AdminMemberHandler) ResetInviteCode(c *gin.Context) {
	profile, err := h.invites.RegenerateInviteCode(c.Param("id"), time.Now().UTC())
	if err != nil {
		if errors.Is(err, repository.ErrInviteProfileNotFound) {
			response.Error(c, http.StatusNotFound, "user not found")
			return
		}
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, gin.H{"invite_code": profile.InviteCode})
}
