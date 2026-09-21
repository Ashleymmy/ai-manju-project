package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/response"
	"github.com/gin-gonic/gin"
)

// Administrative bounds keep input precise across JavaScript and Go.
const maxAdminTestCredits int64 = 1_000_000_000
const maxAdminMembershipDays = 3660

// ChangeMembership preserves previously granted credits until their original
// expiry; only the new term's quota is granted. Retries reuse the same term ID.
func (h *AdminMemberHandler) ChangeMembership(repo repository.MembershipRepository) gin.HandlerFunc {
	return func(c *gin.Context) {
		operator := auth.MustCurrentUser(c)
		if operator.Role != model.UserRoleSuperAdmin {
			response.Error(c, http.StatusForbidden, "only super administrators may change memberships")
			return
		}
		if _, err := h.members.GetUser(c.Param("id")); err != nil {
			if errors.Is(err, repository.ErrUserNotFound) {
				response.Error(c, http.StatusNotFound, "user not found")
			} else {
				response.Error(c, http.StatusInternalServerError, err.Error())
			}
			return
		}
		var req struct {
			PlanID      string    `json:"plan_id"`
			ExpectedID  string    `json:"expected_membership_id"`
			ExpiresAt   time.Time `json:"expires_at"`
			TestCredits *int64    `json:"test_credits"`
			Reason      string    `json:"reason"`
			Nonce       string    `json:"nonce"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			response.Error(c, http.StatusBadRequest, "invalid membership request")
			return
		}
		if strings.TrimSpace(req.Reason) == "" || len(req.Reason) > 500 || strings.TrimSpace(req.Nonce) == "" || len(req.Nonce) > 100 {
			response.Error(c, http.StatusBadRequest, "reason and nonce are required")
			return
		}
		now := time.Now().UTC()
		var plan model.MembershipPlan
		if req.PlanID != "" {
			var err error
			plan, err = repo.GetPlanByID(req.PlanID)
			if err != nil {
				response.Error(c, http.StatusBadRequest, "membership plan not found")
				return
			}
			if !plan.Enabled && plan.Code != model.PlanCodeInternal {
				response.Error(c, http.StatusBadRequest, "membership plan is disabled")
				return
			}
			if !req.ExpiresAt.After(now) || req.ExpiresAt.After(now.AddDate(0, 0, maxAdminMembershipDays)) {
				response.Error(c, http.StatusBadRequest, "invalid expiry date")
				return
			}
			if plan.Code == model.PlanCodeInternal {
				if req.TestCredits == nil || *req.TestCredits < 0 || *req.TestCredits > maxAdminTestCredits {
					response.Error(c, http.StatusBadRequest, "test credits must be between 0 and 1000000000")
					return
				}
			} else if req.TestCredits != nil {
				response.Error(c, http.StatusBadRequest, "test quota is only available for internal members")
				return
			}
		} else if req.TestCredits != nil {
			response.Error(c, http.StatusBadRequest, "free members cannot have a test quota")
			return
		}
		hash := sha256.Sum256([]byte(c.Param("id") + ":" + req.Nonce))
		next := model.UserMembership{ID: "admin_mem_" + hex.EncodeToString(hash[:]), UserID: c.Param("id"), PlanID: req.PlanID,
			Status: model.MembershipStatusActive, Source: model.MembershipSourceAdmin, StartedAt: now, ExpiresAt: req.ExpiresAt,
			MonthlyCreditsOverride: req.TestCredits, CreatedAt: now, UpdatedAt: now}
		if req.PlanID == "" {
			next.Status = model.MembershipStatusRevoked
			next.ExpiresAt = now
		}
		saved, err := repo.ReplaceAdminMembership(next, req.ExpectedID)
		if err != nil {
			if errors.Is(err, repository.ErrMembershipChanged) {
				response.Error(c, http.StatusConflict, err.Error())
			} else {
				response.Error(c, http.StatusInternalServerError, err.Error())
			}
			return
		}
		if saved.PlanID != req.PlanID || (req.PlanID != "" && !saved.ExpiresAt.Equal(req.ExpiresAt)) || !sameQuota(saved.MonthlyCreditsOverride, req.TestCredits) {
			response.Error(c, http.StatusConflict, "nonce already used for another membership change")
			return
		}
		if saved.Status == model.MembershipStatusActive {
			current, err := repo.GetActiveMembership(saved.UserID, now)
			if err != nil || current.ID != saved.ID {
				response.Error(c, http.StatusConflict, "membership has since changed; refresh the list")
				return
			}
			if _, err := h.engine.GrantMonthlyMembershipCredits(saved, plan); err != nil {
				response.Error(c, http.StatusInternalServerError, "membership saved; quota grant failed, retry with the same nonce")
				return
			}
		}
		response.OK(c, saved)
	}
}

func sameQuota(a, b *int64) bool { return (a == nil && b == nil) || (a != nil && b != nil && *a == *b) }
