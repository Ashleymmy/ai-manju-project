package handler

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/response"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

// MemberHandler 用户端会员中心（WP-M10）：总览 / 流水 / 消耗明细 / 邀请 / 定价规则。
type MemberHandler struct {
	engine      *service.CreditLedgerService
	credits     repository.CreditRepository
	memberships repository.MembershipRepository
	billing     repository.BillingRepository
	invites     *service.InviteService
	cfg         config.Config
}

func NewMemberHandler(engine *service.CreditLedgerService, credits repository.CreditRepository, memberships repository.MembershipRepository, billing repository.BillingRepository, invites *service.InviteService, cfg config.Config) *MemberHandler {
	return &MemberHandler{engine: engine, credits: credits, memberships: memberships, billing: billing, invites: invites, cfg: cfg}
}

// Overview 会员首页：当前会员 + 双余额（永久/限时）+ 最近到期 + 本月消耗统计。
func (h *MemberHandler) Overview(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	overview, err := h.engine.Overview(user.ID)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	now := time.Now().UTC()
	payload := gin.H{
		"permanent_balance":   overview.PermanentBalance,
		"permanent_frozen":    overview.PermanentFrozen,
		"permanent_available": overview.PermanentAvailable,
		"limited_available":   overview.LimitedAvailable,
		"limited_frozen":      overview.LimitedFrozen,
		"next_expiry_at":      overview.NextExpiryAt,
		"next_expiry_amount":  overview.NextExpiryAmount,
	}

	// 当前会员（非会员为 null）。
	if membership, err := h.memberships.GetActiveMembership(user.ID, now); err == nil {
		if plan, err := h.memberships.GetPlanByID(membership.PlanID); err == nil {
			payload["membership"] = gin.H{
				"plan_code":  plan.Code,
				"plan_name":  plan.Name,
				"expires_at": membership.ExpiresAt,
				"started_at": membership.StartedAt,
			}
		}
	} else {
		payload["membership"] = nil
	}

	// 本月消耗统计（文档模块1：图片生成次数 / 视频生成总秒数 / Agent 调用次数）。
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	if stats, err := h.credits.ConsumptionStatsInRange(user.ID, monthStart, time.Time{}); err == nil {
		payload["monthly_usage"] = gin.H{
			"image_count":   stats.ImageCount,
			"video_seconds": stats.VideoSeconds,
			"agent_calls":   stats.AgentCalls,
			"total_credits": stats.TotalCreditsSettled,
		}
	}
	response.OK(c, payload)
}

// ListMyLedger 我的积分流水（7 类型筛选 + 分页）。
func (h *MemberHandler) ListMyLedger(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	page, pageSize := parseAdminPagination(c)
	entries, total, err := h.credits.ListLedger(user.ID, c.Query("entry_type"), page, pageSize)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, gin.H{"items": entries, "total": total, "page": page, "page_size": pageSize})
}

// memberConsumptionRow 消耗明细行：附带限时/永久拆分（文档模块2 积分类型列）。
type memberConsumptionRow struct {
	model.TaskConsumption
	LimitedCredits   int64  `json:"limited_credits"`
	PermanentCredits int64  `json:"permanent_credits"`
	ChargeState      string `json:"charge_state"` // charged / not_charged（失败/取消不扣费）
}

// ListMyConsumptions 我的消耗明细（任务类型/状态/时间范围服务端筛选）。
func (h *MemberHandler) ListMyConsumptions(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	page, pageSize := parseAdminPagination(c)
	start, ok := parseAdminTimeQuery(c, "start")
	if !ok {
		return
	}
	end, ok := parseAdminTimeQuery(c, "end")
	if !ok {
		return
	}
	items, total, err := h.credits.ListConsumptionsGlobal(user.ID, c.Query("task_type"), c.Query("status"), start, end, page, pageSize)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	rows := make([]memberConsumptionRow, 0, len(items))
	for _, item := range items {
		row := memberConsumptionRow{TaskConsumption: item}
		var allocation []model.CreditAllocationItem
		if err := json.Unmarshal(item.Allocation, &allocation); err == nil {
			for _, line := range allocation {
				if line.Bucket == model.CreditBucketGrant {
					row.LimitedCredits += line.Amount
				} else {
					row.PermanentCredits += line.Amount
				}
			}
		}
		if item.Status == model.TaskConsumptionStatusSettled {
			row.ChargeState = "charged"
		} else {
			row.ChargeState = "not_charged"
		}
		rows = append(rows, row)
	}
	response.OK(c, gin.H{"items": rows, "total": total, "page": page, "page_size": pageSize})
}

// InviteOverview 我的邀请码 + 邀请记录 + 累计奖励。
func (h *MemberHandler) InviteOverview(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	baseURL := strings.TrimRight(h.cfg.FrontendURL, "/") + "/register?invite_code="
	overview, err := h.invites.Overview(user.ID, baseURL)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, overview)
}

// PricingRules 平台定价规则页数据：套餐 + 积分包 + 定价规则 + 当前活动。
func (h *MemberHandler) PricingRules(c *gin.Context) {
	plans, err := h.memberships.ListPlans(true)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	packages, err := h.billing.ListPackages(true)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	payload := gin.H{"plans": plans, "packages": packages, "credits_per_yuan": model.CreditsPerYuan}
	if rules, err := h.billing.GetConfig(model.BillingConfigKeyPricingRules); err == nil {
		payload["pricing_rules"] = rules.Value
	}
	if activity, err := h.billing.GetConfig(model.BillingConfigKeyActivity); err == nil {
		payload["activity"] = activity.Value
	}
	response.OK(c, payload)
}

// GiftPacks 礼包超市货架（WP-M15）：配置驱动，默认空货架（前端渲染空态）。
// 货架内容由运营在后台 billing_configs["gift_packs"] 维护，内容后定。
func (h *MemberHandler) GiftPacks(c *gin.Context) {
	config, err := h.billing.GetConfig(model.BillingConfigKeyGiftPacks)
	if err != nil {
		// 未配置 = 空货架。
		response.OK(c, gin.H{"items": []any{}})
		return
	}
	response.OK(c, gin.H{"items": config.Value})
}
