package handler

import (
	"errors"
	"net/http"
	"strings"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/response"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

// BillingHandler 用户侧收银台（WP-M8）：套餐/积分包浏览、下单、我的订单、
// 取消、mock 支付回调（仅非生产）。
type BillingHandler struct {
	payments    *service.PaymentService
	billing     repository.BillingRepository
	memberships repository.MembershipRepository
	allowMock   bool
}

func NewBillingHandler(payments *service.PaymentService, billing repository.BillingRepository, memberships repository.MembershipRepository, allowMock bool) *BillingHandler {
	return &BillingHandler{payments: payments, billing: billing, memberships: memberships, allowMock: allowMock}
}

// ListPlans 上架中的会员套餐（月付/年付价一并返回，前端切 tab）。
func (h *BillingHandler) ListPlans(c *gin.Context) {
	plans, err := h.memberships.ListPlans(true)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, gin.H{"items": plans})
}

// ListPackages 上架中的直购积分包。
func (h *BillingHandler) ListPackages(c *gin.Context) {
	packages, err := h.billing.ListPackages(true)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, gin.H{"items": packages})
}

// CreateOrder 下单。会员档与积分包二选一；pay_channel 必填。
func (h *BillingHandler) CreateOrder(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	var req struct {
		PlanID     string `json:"plan_id"`
		PackageID  string `json:"package_id"`
		Period     string `json:"period"` // month / year
		PayChannel string `json:"pay_channel" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(req.PlanID) == "" && strings.TrimSpace(req.PackageID) == "" {
		response.Error(c, http.StatusBadRequest, "plan_id or package_id is required")
		return
	}
	order, payParams, err := h.payments.CreateOrder(service.CreateOrderInput{
		UserID: user.ID, PlanID: strings.TrimSpace(req.PlanID),
		PackageID: strings.TrimSpace(req.PackageID), Period: strings.TrimSpace(req.Period),
		PayChannel: strings.TrimSpace(req.PayChannel),
	})
	if err != nil {
		switch {
		case errors.Is(err, service.ErrPayChannelUnavailable):
			response.Error(c, http.StatusBadRequest, "payment channel is not available")
		case errors.Is(err, service.ErrBillingItemNotFound):
			response.Error(c, http.StatusNotFound, "plan or package not found")
		default:
			response.Error(c, http.StatusInternalServerError, err.Error())
		}
		return
	}
	response.Created(c, gin.H{"order": order, "pay_params": payParams})
}

// ListMyOrders 我的订单（最新在前）。
func (h *BillingHandler) ListMyOrders(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	page, pageSize := parseAdminPagination(c)
	orders, total, err := h.billing.ListOrders(user.ID, "", "", page, pageSize)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, gin.H{"items": orders, "total": total, "page": page, "page_size": pageSize})
}

// GetMyOrder 订单详情（仅本人）。
func (h *BillingHandler) GetMyOrder(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	order, err := h.billing.GetOrderByID(c.Param("id"))
	if err != nil || order.UserID != user.ID {
		response.Error(c, http.StatusNotFound, "order not found")
		return
	}
	response.OK(c, order)
}

// CancelMyOrder 取消待支付订单。
func (h *BillingHandler) CancelMyOrder(c *gin.Context) {
	user := auth.MustCurrentUser(c)
	order, err := h.payments.CancelOrder(c.Param("id"), user.ID)
	if err != nil {
		switch {
		case errors.Is(err, repository.ErrOrderNotFound):
			response.Error(c, http.StatusNotFound, "order not found")
		case errors.Is(err, service.ErrOrderNotPending):
			response.Error(c, http.StatusConflict, "order is not pending")
		default:
			response.Error(c, http.StatusInternalServerError, err.Error())
		}
		return
	}
	response.OK(c, order)
}

// MockPay 开发/测试支付回调：直接把订单置为已支付并完成履约。
// 生产环境禁用（allowMock=false 时 404）。
func (h *BillingHandler) MockPay(c *gin.Context) {
	if !h.allowMock {
		response.Error(c, http.StatusNotFound, "not found")
		return
	}
	user := auth.MustCurrentUser(c)
	order, err := h.billing.GetOrderByID(c.Param("id"))
	if err != nil || order.UserID != user.ID {
		response.Error(c, http.StatusNotFound, "order not found")
		return
	}
	paid, err := h.payments.MarkPaid(order.ID)
	if err != nil {
		if errors.Is(err, service.ErrOrderNotPending) {
			response.Error(c, http.StatusConflict, "order is not pending")
			return
		}
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, paid)
}
