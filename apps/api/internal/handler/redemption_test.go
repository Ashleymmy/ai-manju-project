package handler

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

// 兑换码 handler：用户核销（大小写不敏感、错误映射）+ 后台建码。
func TestRedemptionHandlerFlow(t *testing.T) {
	gin.SetMode(gin.TestMode)
	redemptions := repository.NewMemoryRedemptionRepository()
	memberships := repository.NewMemoryMembershipRepository()
	credits := repository.NewMemoryCreditRepository()
	engine := service.NewCreditLedgerService(credits, memberships, repository.NewMemoryBillingRepository())
	redemptionService := service.NewRedemptionService(redemptions, memberships, engine)
	h := NewRedemptionHandler(redemptions, redemptionService)

	if err := memberships.SeedPlans([]model.MembershipPlan{
		{ID: "plan_198", Code: model.PlanCodeMember198, Name: "198 会员", PriceMonthCents: 19800, MonthlyCredits: 19800, Enabled: true},
	}); err != nil {
		t.Fatal(err)
	}

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("current_user", model.User{ID: "user_rd", Username: "rd", Role: model.UserRoleMember, Status: model.UserStatusActive})
		c.Next()
	})
	router.POST("/api/member/redeem", h.Redeem)
	router.POST("/api/admin/billing/redemption-codes", h.CreateCode)
	router.GET("/api/admin/billing/redemption-codes", h.ListCodes)

	// 后台建码（积分码）。
	rec := performJSON(router, http.MethodPost, "/api/admin/billing/redemption-codes", `{"kind":"credits","credits_amount":888,"max_uses":10}`, nil)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create code = %d %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, `"code"`) || !strings.Contains(body, `"credits_amount":888`) {
		t.Fatalf("created code body = %s", body)
	}
	var created struct {
		Data model.RedemptionCode `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	code := created.Data.Code

	// 用户核销（小写输入也应成功——核销前统一大写）。
	rec = performJSON(router, http.MethodPost, "/api/member/redeem", `{"code":"`+strings.ToLower(code)+`"}`, nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"credits_granted":888`) {
		t.Fatalf("redeem = %d %s", rec.Code, rec.Body.String())
	}
	overview, _ := engine.Overview("user_rd")
	if overview.LimitedAvailable != 888 {
		t.Fatalf("limited = %d, want 888", overview.LimitedAvailable)
	}

	// 重复核销 → 409。
	rec = performJSON(router, http.MethodPost, "/api/member/redeem", `{"code":"`+code+`"}`, nil)
	if rec.Code != http.StatusConflict {
		t.Fatalf("repeat redeem = %d, want 409", rec.Code)
	}

	// 不存在的码 → 404。
	rec = performJSON(router, http.MethodPost, "/api/member/redeem", `{"code":"NOPE-NOPE-NOPE"}`, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown code = %d, want 404", rec.Code)
	}

	// 会员天数码（学费赠会员）。
	rec = performJSON(router, http.MethodPost, "/api/admin/billing/redemption-codes", `{"kind":"membership_days","membership_days":30,"plan_id":"plan_198","max_uses":100}`, nil)
	if rec.Code != http.StatusCreated || !strings.Contains(rec.Body.String(), `"membership_days":30`) {
		t.Fatalf("create membership code = %d %s", rec.Code, rec.Body.String())
	}

	// 码列表。
	rec = performJSON(router, http.MethodGet, "/api/admin/billing/redemption-codes", "", nil)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"total":2`) {
		t.Fatalf("list codes = %d %s", rec.Code, rec.Body.String())
	}

	// 非法 kind → 400。
	rec = performJSON(router, http.MethodPost, "/api/admin/billing/redemption-codes", `{"kind":"cash","credits_amount":1}`, nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("bad kind = %d, want 400", rec.Code)
	}
}
