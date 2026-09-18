package handler

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/middleware"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

// billingE2EFixture 注：handler 层用手工 gin 路由测试；整套路由装配由 router 包测试覆盖。

func TestBillingEndToEndPurchaseFlow(t *testing.T) {
	gin.SetMode(gin.TestMode)

	// 仓储与服务装配（内存模式）。
	billing := repository.NewMemoryBillingRepository()
	memberships := repository.NewMemoryMembershipRepository()
	credits := repository.NewMemoryCreditRepository()
	engine := service.NewCreditLedgerService(credits, memberships, billing)
	invites := service.NewInviteService(repository.NewMemoryInviteRepository(), engine, billing)
	payments := service.NewPaymentService(billing, memberships, engine, invites, true)
	billingHandler := NewBillingHandler(payments, billing, memberships, true)

	if err := memberships.SeedPlans([]model.MembershipPlan{
		{ID: "plan_198", Code: model.PlanCodeMember198, Name: "198 会员", PriceMonthCents: 19800, MonthlyCredits: 19800, Enabled: true},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := billing.UpsertPackage(model.CreditPackage{ID: "pkg_600", Name: "小额体验包", Credits: 600, PriceCents: 600, Enabled: true}); err != nil {
		t.Fatal(err)
	}

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("current_user", model.User{ID: "user_e2e", Username: "buyer", Role: model.UserRoleMember, Status: model.UserStatusActive})
		c.Next()
	})
	router.GET("/api/billing/plans", billingHandler.ListPlans)
	router.GET("/api/billing/packages", billingHandler.ListPackages)
	router.POST("/api/billing/orders", billingHandler.CreateOrder)
	router.GET("/api/billing/orders", billingHandler.ListMyOrders)
	router.POST("/api/billing/orders/:id/cancel", billingHandler.CancelMyOrder)
	router.POST("/api/billing/orders/:id/mock-pay", billingHandler.MockPay)

	// 1. 浏览套餐与积分包。
	if rec := performJSON(router, http.MethodGet, "/api/billing/plans", "", nil); rec.Code != 200 || !strings.Contains(rec.Body.String(), "198 会员") {
		t.Fatalf("plans = %d %s", rec.Code, rec.Body.String())
	}
	if rec := performJSON(router, http.MethodGet, "/api/billing/packages", "", nil); rec.Code != 200 || !strings.Contains(rec.Body.String(), "小额体验包") {
		t.Fatalf("packages = %d %s", rec.Code, rec.Body.String())
	}

	// 2. 下单直购包（mock 渠道）。
	rec := performJSON(router, http.MethodPost, "/api/billing/orders", `{"package_id":"pkg_600","pay_channel":"mock"}`, nil)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create order = %d %s", rec.Code, rec.Body.String())
	}
	var created struct {
		Data struct {
			Order model.Order `json:"order"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	orderID := created.Data.Order.ID

	// 3. mock 支付 → 到账 600 永久积分。
	if rec := performJSON(router, http.MethodPost, "/api/billing/orders/"+orderID+"/mock-pay", "", nil); rec.Code != 200 {
		t.Fatalf("mock pay = %d %s", rec.Code, rec.Body.String())
	}
	overview, err := engine.Overview("user_e2e")
	if err != nil || overview.PermanentBalance != 600 {
		t.Fatalf("overview = %+v err=%v, want 600", overview, err)
	}

	// 4. 再买会员 → 开通 + 首期 19800 限时积分。
	rec = performJSON(router, http.MethodPost, "/api/billing/orders", `{"plan_id":"plan_198","period":"month","pay_channel":"mock"}`, nil)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create member order = %d %s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if rec := performJSON(router, http.MethodPost, "/api/billing/orders/"+created.Data.Order.ID+"/mock-pay", "", nil); rec.Code != 200 {
		t.Fatalf("mock pay member = %d %s", rec.Code, rec.Body.String())
	}
	overview, _ = engine.Overview("user_e2e")
	if overview.LimitedAvailable != 19800 || overview.PermanentBalance != 600 {
		t.Fatalf("overview = %+v, want limited 19800 + permanent 600", overview)
	}

	// 5. 下单后取消。
	rec = performJSON(router, http.MethodPost, "/api/billing/orders", `{"package_id":"pkg_600","pay_channel":"mock"}`, nil)
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if rec := performJSON(router, http.MethodPost, "/api/billing/orders/"+created.Data.Order.ID+"/cancel", "", nil); rec.Code != 200 {
		t.Fatalf("cancel = %d %s", rec.Code, rec.Body.String())
	}
	if rec := performJSON(router, http.MethodPost, "/api/billing/orders/"+created.Data.Order.ID+"/mock-pay", "", nil); rec.Code != http.StatusConflict {
		t.Fatalf("pay canceled order = %d, want 409", rec.Code)
	}

	// 6. 我的订单列表。
	rec = performJSON(router, http.MethodGet, "/api/billing/orders", "", nil)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"total":3`) {
		t.Fatalf("my orders = %d %s", rec.Code, rec.Body.String())
	}
}

func TestBillingRequiresAuth(t *testing.T) {
	gin.SetMode(gin.TestMode)
	billing := repository.NewMemoryBillingRepository()
	memberships := repository.NewMemoryMembershipRepository()
	engine := service.NewCreditLedgerService(repository.NewMemoryCreditRepository(), memberships, billing)
	payments := service.NewPaymentService(billing, memberships, engine, nil, true)
	billingHandler := NewBillingHandler(payments, billing, memberships, true)

	userRepo := repository.NewMemoryUserRepository()
	authService := auth.NewService(userRepo, config.Config{AppSecret: "test-secret-test-secret"})

	router := gin.New()
	router.POST("/api/billing/orders", middleware.RequireAuth(authService), billingHandler.CreateOrder)
	rec := performJSON(router, http.MethodPost, "/api/billing/orders", `{"package_id":"pkg_600","pay_channel":"mock"}`, nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated order creation = %d, want 401", rec.Code)
	}
}
