package handler

import (
	"errors"
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

// RedemptionHandler 兑换码（WP-M14）：用户核销 + 后台建码/列表。
type RedemptionHandler struct {
	redemptions repository.RedemptionRepository
	service     *service.RedemptionService
}

func NewRedemptionHandler(redemptions repository.RedemptionRepository, service *service.RedemptionService) *RedemptionHandler {
	return &RedemptionHandler{redemptions: redemptions, service: service}
}

// Redeem 用户核销：POST /api/member/redeem {code}
func (h *RedemptionHandler) Redeem(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	var req struct {
		Code string `json:"code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.service.Redeem(user.ID, strings.ToUpper(strings.TrimSpace(req.Code)))
	if err != nil {
		switch {
		case errors.Is(err, repository.ErrRedemptionCodeNotFound):
			response.Error(c, http.StatusNotFound, "兑换码不存在")
		case errors.Is(err, repository.ErrRedemptionUnavailable):
			response.Error(c, http.StatusConflict, "兑换码已失效或已用完")
		case errors.Is(err, repository.ErrRedemptionAlreadyUsed):
			response.Error(c, http.StatusConflict, "你已使用过该兑换码")
		default:
			response.Error(c, http.StatusInternalServerError, err.Error())
		}
		return
	}
	response.OK(c, result)
}

// CreateCode 后台建码：POST /api/admin/billing/redemption-codes
func (h *RedemptionHandler) CreateCode(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	var req struct {
		Kind           string `json:"kind" binding:"required"`
		CreditsAmount  int64  `json:"credits_amount"`
		MembershipDays int    `json:"membership_days"`
		PlanID         string `json:"plan_id"`
		ValidDays      int    `json:"valid_days"`
		MaxUses        int    `json:"max_uses"`
		ExpiresAt      string `json:"expires_at"` // RFC3339，可空
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if req.Kind != model.RedemptionKindCredits && req.Kind != model.RedemptionKindMembershipDays {
		response.Error(c, http.StatusBadRequest, "kind must be credits or membership_days")
		return
	}
	if req.Kind == model.RedemptionKindCredits && req.CreditsAmount <= 0 {
		response.Error(c, http.StatusBadRequest, "credits_amount must be positive")
		return
	}
	if req.Kind == model.RedemptionKindMembershipDays && (req.MembershipDays <= 0 || req.PlanID == "") {
		response.Error(c, http.StatusBadRequest, "membership_days and plan_id are required")
		return
	}
	var expiresAt *time.Time
	if strings.TrimSpace(req.ExpiresAt) != "" {
		parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(req.ExpiresAt))
		if err != nil {
			response.Error(c, http.StatusBadRequest, "expires_at must be RFC3339")
			return
		}
		expiresAt = &parsed
	}
	code := model.RedemptionCode{
		Code:           generateRedemptionCode(),
		Kind:           req.Kind,
		CreditsAmount:  req.CreditsAmount,
		MembershipDays: req.MembershipDays,
		PlanID:         req.PlanID,
		ValidDays:      req.ValidDays,
		MaxUses:        req.MaxUses,
		ExpiresAt:      expiresAt,
		Enabled:        true,
		CreatedBy:      user.ID,
	}
	created, err := h.redemptions.CreateCode(code)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.Created(c, created)
}

// ListCodes 后台码列表：GET /api/admin/billing/redemption-codes
func (h *RedemptionHandler) ListCodes(c *gin.Context) {
	page, pageSize := parseAdminPagination(c)
	codes, total, err := h.redemptions.ListCodes(page, pageSize)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, gin.H{"items": codes, "total": total, "page": page, "page_size": pageSize})
}

// generateRedemptionCode 生成大写字母数字码（XXXX-XXXX-XXXX 分组）。
func generateRedemptionCode() string {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // 去掉易混淆的 0/O、1/I
	digits := randomHex(model.RedemptionCodeLength)     // 24 个 hex 字符
	chars := make([]byte, model.RedemptionCodeLength)
	for i := 0; i < model.RedemptionCodeLength; i++ {
		value := hexNibble(digits[i*2])*16 + hexNibble(digits[i*2+1])
		chars[i] = alphabet[value%len(alphabet)]
	}
	return string(chars[0:4]) + "-" + string(chars[4:8]) + "-" + string(chars[8:12])
}

func hexNibble(c byte) int {
	switch {
	case c >= '0' && c <= '9':
		return int(c - '0')
	case c >= 'a' && c <= 'f':
		return int(c-'a') + 10
	default:
		return 0
	}
}
