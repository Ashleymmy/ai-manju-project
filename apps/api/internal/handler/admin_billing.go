package handler

import (
	"encoding/json"
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

// AdminBillingHandler 模块2–8：积分流水/订单退款/任务消耗/套餐与配置/看板/邀请/审计。
type AdminBillingHandler struct {
	engine       *service.CreditLedgerService
	credits      repository.CreditRepository
	billing      repository.BillingRepository
	memberships  repository.MembershipRepository
	invites      repository.InviteRepository
	audit        repository.AuditRepository
	adminMembers *service.AdminMemberService
}

func NewAdminBillingHandler(engine *service.CreditLedgerService, credits repository.CreditRepository, billing repository.BillingRepository, memberships repository.MembershipRepository, invites repository.InviteRepository, audit repository.AuditRepository, adminMembers *service.AdminMemberService) *AdminBillingHandler {
	return &AdminBillingHandler{
		engine:       engine,
		credits:      credits,
		billing:      billing,
		memberships:  memberships,
		invites:      invites,
		audit:        audit,
		adminMembers: adminMembers,
	}
}

// ListLedger GET /api/admin/billing/ledger?user_id=&entry_type=&start=&end=&page=&page_size=
func (h *AdminBillingHandler) ListLedger(c *gin.Context) {
	page, pageSize := parseAdminPagination(c)
	start, ok := parseAdminTimeQuery(c, "start")
	if !ok {
		return
	}
	end, ok := parseAdminTimeQuery(c, "end")
	if !ok {
		return
	}
	items, total, err := h.credits.ListLedgerGlobal(c.Query("user_id"), c.Query("entry_type"), start, end, page, pageSize)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize})
}

// ListOrders GET /api/admin/billing/orders?user_id=&status=&order_type=&page=&page_size=
func (h *AdminBillingHandler) ListOrders(c *gin.Context) {
	page, pageSize := parseAdminPagination(c)
	items, total, err := h.billing.ListOrders(c.Query("user_id"), c.Query("status"), c.Query("order_type"), page, pageSize)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize})
}

// RefundOrder POST /api/admin/billing/orders/:id/refund
// 引擎内部幂等；非 paid 状态由引擎报 ErrOrderNotRefundable → 409。
func (h *AdminBillingHandler) RefundOrder(c *gin.Context) {
	operator := auth.MustCurrentUser(c)
	order, err := h.engine.RefundOrder(c.Param("id"), operator.ID)
	if err != nil {
		if errors.Is(err, repository.ErrOrderNotFound) {
			response.Error(c, http.StatusNotFound, "order not found")
			return
		}
		if errors.Is(err, service.ErrOrderNotRefundable) {
			response.Error(c, http.StatusConflict, "order is not in a refundable state")
			return
		}
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, order)
}

// ListConsumptions GET /api/admin/billing/consumptions?user_id=&task_type=&status=&start=&end=&page=&page_size=
// 响应附带 stats（ConsumptionStats；user_id 空 = 全平台口径）。
func (h *AdminBillingHandler) ListConsumptions(c *gin.Context) {
	page, pageSize := parseAdminPagination(c)
	userID := c.Query("user_id")
	start, ok := parseAdminTimeQuery(c, "start")
	if !ok {
		return
	}
	end, ok := parseAdminTimeQuery(c, "end")
	if !ok {
		return
	}
	items, total, err := h.credits.ListConsumptionsGlobal(userID, c.Query("task_type"), c.Query("status"), start, end, page, pageSize)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	stats, err := h.credits.ConsumptionStats(userID)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize, "stats": stats})
}

// ListPlans GET /api/admin/billing/plans（含下架档位，管理端全量）
func (h *AdminBillingHandler) ListPlans(c *gin.Context) {
	plans, err := h.memberships.ListPlans(false)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, plans)
}

// adminPlanUpdateRequest UpsertPlan 的部分字段；指针区分「未传」与「零值」。
// Code/ID 不在可编辑集合内（套餐编码是稳定身份，禁止后台改）。
type adminPlanUpdateRequest struct {
	Name              *string          `json:"name"`
	PriceMonthCents   *int64           `json:"price_month_cents"`
	PriceYearCents    *int64           `json:"price_year_cents"`
	MonthlyCredits    *int64           `json:"monthly_credits"`
	ImageConcurrency  *int             `json:"image_concurrency"`
	VideoConcurrency  *int             `json:"video_concurrency"`
	CreditDiscountBps *int             `json:"credit_discount_bps"`
	PriorityRank      *int             `json:"priority_rank"`
	Features          *json.RawMessage `json:"features"`
	Enabled           *bool            `json:"enabled"`
}

// UpsertPlan PUT /api/admin/billing/plans/:id
func (h *AdminBillingHandler) UpsertPlan(c *gin.Context) {
	plan, err := h.memberships.GetPlanByID(c.Param("id"))
	if err != nil {
		if errors.Is(err, repository.ErrMembershipPlanNotFound) {
			response.Error(c, http.StatusNotFound, "plan not found")
			return
		}
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	var req adminPlanUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	// 只覆盖 body 里出现过的字段
	if req.Name != nil {
		plan.Name = *req.Name
	}
	if req.PriceMonthCents != nil {
		plan.PriceMonthCents = *req.PriceMonthCents
	}
	if req.PriceYearCents != nil {
		plan.PriceYearCents = *req.PriceYearCents
	}
	if req.MonthlyCredits != nil {
		plan.MonthlyCredits = *req.MonthlyCredits
	}
	if req.ImageConcurrency != nil {
		plan.ImageConcurrency = *req.ImageConcurrency
	}
	if req.VideoConcurrency != nil {
		plan.VideoConcurrency = *req.VideoConcurrency
	}
	if req.CreditDiscountBps != nil {
		plan.CreditDiscountBps = *req.CreditDiscountBps
	}
	if req.PriorityRank != nil {
		plan.PriorityRank = *req.PriorityRank
	}
	if req.Features != nil {
		plan.Features = model.JSONB(*req.Features)
	}
	if req.Enabled != nil {
		plan.Enabled = *req.Enabled
	}
	if err := validateAdminPlan(plan); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	updated, err := h.memberships.UpsertPlan(plan)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, updated)
}

// ListPackages GET /api/admin/billing/packages?enabled_only=
func (h *AdminBillingHandler) ListPackages(c *gin.Context) {
	enabledOnly := c.Query("enabled_only") == "true"
	packages, err := h.billing.ListPackages(enabledOnly)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, packages)
}

// adminPackageUpdateRequest UpsertPackage 的部分字段，指针语义同上。
type adminPackageUpdateRequest struct {
	Name       *string `json:"name"`
	Credits    *int64  `json:"credits"`
	PriceCents *int64  `json:"price_cents"`
	Enabled    *bool   `json:"enabled"`
	SortOrder  *int    `json:"sort_order"`
}

// UpsertPackage PUT /api/admin/billing/packages/:id
func (h *AdminBillingHandler) UpsertPackage(c *gin.Context) {
	pkg, err := h.billing.GetPackageByID(c.Param("id"))
	if err != nil {
		if errors.Is(err, repository.ErrPackageNotFound) {
			response.Error(c, http.StatusNotFound, "package not found")
			return
		}
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	var req adminPackageUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if req.Name != nil {
		pkg.Name = *req.Name
	}
	if req.Credits != nil {
		pkg.Credits = *req.Credits
	}
	if req.PriceCents != nil {
		pkg.PriceCents = *req.PriceCents
	}
	if req.Enabled != nil {
		pkg.Enabled = *req.Enabled
	}
	if req.SortOrder != nil {
		pkg.SortOrder = *req.SortOrder
	}
	if strings.TrimSpace(pkg.Name) == "" || pkg.Credits <= 0 || pkg.Credits > maxAdminTestCredits || pkg.PriceCents < 0 || pkg.PriceCents > maxAdminTestCredits || pkg.SortOrder < 0 {
		response.Error(c, http.StatusBadRequest, "invalid package name, credits, price or sort order")
		return
	}
	updated, err := h.billing.UpsertPackage(pkg)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, updated)
}

// ListConfigs GET /api/admin/billing/configs
func (h *AdminBillingHandler) ListConfigs(c *gin.Context) {
	configs, err := h.billing.ListConfigs()
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, configs)
}

// adminEditableConfigKeys UpsertConfig 白名单（model.BillingConfigKey* 常量）；
// 白名单外的 key 一律 400，防止管理端写入业务代码不识别的配置。
var adminEditableConfigKeys = map[string]bool{
	model.BillingConfigKeyModelPrices:      true,
	model.BillingConfigKeyRegisterBonus:    true,
	model.BillingConfigKeyRegisterBonusTTL: true,
	model.BillingConfigKeyInviteRewards:    true,
	model.BillingConfigKeyInviteRewardTTL:  true,
	model.BillingConfigKeyActivity:         true,
	model.BillingConfigKeyPricingRules:     true,
	model.BillingConfigKeyGiftPacks:        true,
}

// ModelPrices returns the effective catalog, including defaults before the first save.
func (h *AdminBillingHandler) ModelPrices(c *gin.Context) {
	response.OK(c, service.LoadModelCreditPrices(h.billing))
}

type adminConfigUpdateRequest struct {
	Value json.RawMessage `json:"value"`
}

// UpsertConfig PUT /api/admin/billing/configs/:key，body {"value": <any json>}
func (h *AdminBillingHandler) UpsertConfig(c *gin.Context) {
	key := c.Param("key")
	if !adminEditableConfigKeys[key] {
		response.Error(c, http.StatusBadRequest, "config key is not editable")
		return
	}
	var req adminConfigUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if len(req.Value) == 0 {
		response.Error(c, http.StatusBadRequest, "value is required")
		return
	}
	if err := validateBillingConfig(key, req.Value); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	operator := auth.MustCurrentUser(c)
	if err := h.billing.UpsertConfig(key, model.JSONB(req.Value), operator.ID, time.Now().UTC()); err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, gin.H{"key": key, "value": req.Value})
}

// Dashboard GET /api/admin/billing/dashboard
func (h *AdminBillingHandler) Dashboard(c *gin.Context) {
	dashboard, err := h.adminMembers.Dashboard()
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, dashboard)
}

// ListInvites GET /api/admin/invites?page=&page_size=
func (h *AdminBillingHandler) ListInvites(c *gin.Context) {
	page, pageSize := parseAdminPagination(c)
	items, total, err := h.invites.ListAllRecords(page, pageSize)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize})
}

// ListAuditLogs GET /api/admin/audit-logs?admin_id=&action=&page=&page_size=
func (h *AdminBillingHandler) ListAuditLogs(c *gin.Context) {
	page, pageSize := parseAdminPagination(c)
	items, total, err := h.audit.List(c.Query("admin_id"), c.Query("action"), page, pageSize)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize})
}
