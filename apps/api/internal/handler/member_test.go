package handler

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

// 会员中心 API：总览（双余额 + 会员 + 本月消耗）/ 流水 / 消耗明细（限时/永久拆分 + 未扣费标记）。
func TestMemberOverviewAndDetails(t *testing.T) {
	gin.SetMode(gin.TestMode)
	billing := repository.NewMemoryBillingRepository()
	memberships := repository.NewMemoryMembershipRepository()
	credits := repository.NewMemoryCreditRepository()
	engine := service.NewCreditLedgerService(credits, memberships, billing)
	invites := service.NewInviteService(repository.NewMemoryInviteRepository(), engine, billing)
	memberHandler := NewMemberHandler(engine, credits, memberships, billing, invites, config.Config{FrontendURL: "http://localhost:3100"})

	if err := memberships.SeedPlans([]model.MembershipPlan{
		{ID: "plan_198", Code: model.PlanCodeMember198, Name: "198 会员", PriceMonthCents: 19800, MonthlyCredits: 19800, Enabled: true},
	}); err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	// 会员 + 限时 1000 + 永久 500。
	if _, err := memberships.CreateMembership(model.UserMembership{
		UserID: "user_mc", PlanID: "plan_198", Status: model.MembershipStatusActive,
		Source: model.MembershipSourcePurchase, StartedAt: now.Add(-time.Hour), ExpiresAt: now.Add(29 * 24 * time.Hour),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := engine.Grant(service.GrantInput{UserID: "user_mc", SourceType: model.GrantSourceMemberMonthly, Amount: 1000, PeriodKey: "member_monthly:user_mc:p000", RelatedID: "m1"}); err != nil {
		t.Fatal(err)
	}
	if _, err := engine.Adjust("user_mc", 500, "ops", "nonce_mc"); err != nil {
		t.Fatal(err)
	}
	// 先消耗 600 限时，让剩余限时只剩 400；再结算一笔 500 → 拆分 400 限时 + 100 永久。
	if _, err := engine.Reserve("user_mc", service.CreditQuote{JobID: "job_mc0", TaskType: model.TaskTypeImage, Model: "m", Params: map[string]any{}, Credits: 600}); err != nil {
		t.Fatal(err)
	}
	if _, err := engine.Settle("job_mc0"); err != nil {
		t.Fatal(err)
	}
	if _, err := engine.Reserve("user_mc", service.CreditQuote{JobID: "job_mc1", TaskType: model.TaskTypeImage, Model: "m", Params: map[string]any{"resolution": "1024x1024"}, Credits: 500}); err != nil {
		t.Fatal(err)
	}
	if _, err := engine.Settle("job_mc1"); err != nil {
		t.Fatal(err)
	}
	if _, err := engine.Reserve("user_mc", service.CreditQuote{JobID: "job_mc2", TaskType: model.TaskTypeVideoFast, Model: "m", Params: map[string]any{"duration_sec": 10}, Credits: 80}); err != nil {
		t.Fatal(err)
	}
	if _, err := engine.Release("job_mc2"); err != nil {
		t.Fatal(err)
	}

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("current_user", model.User{ID: "user_mc", Username: "mc", Role: model.UserRoleMember, Status: model.UserStatusActive})
		c.Next()
	})
	router.GET("/api/member/overview", memberHandler.Overview)
	router.GET("/api/member/ledger", memberHandler.ListMyLedger)
	router.GET("/api/member/consumptions", memberHandler.ListMyConsumptions)
	router.GET("/api/member/invite", memberHandler.InviteOverview)
	router.GET("/api/member/pricing", memberHandler.PricingRules)

	// Overview：双余额 + 会员 + 本月统计。
	rec := performJSON(router, http.MethodGet, "/api/member/overview", "", nil)
	if rec.Code != 200 {
		t.Fatalf("overview = %d %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	for _, want := range []string{`"permanent_balance":400`, `"limited_available":0`, `"198 会员"`, `"image_count":2`} {
		if !strings.Contains(body, want) {
			t.Fatalf("overview body missing %s: %s", want, body)
		}
	}

	// 流水：consume 类型筛选（600 全限时一条 + 500 拆分两条 = 3 条）。
	rec = performJSON(router, http.MethodGet, "/api/member/ledger?entry_type=consume", "", nil)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"total":3`) {
		t.Fatalf("ledger = %d %s", rec.Code, rec.Body.String())
	}

	// 消耗明细：charged / not_charged 标记 + 限时/永久拆分。
	rec = performJSON(router, http.MethodGet, "/api/member/consumptions", "", nil)
	body = rec.Body.String()
	if rec.Code != 200 || !strings.Contains(body, `"charge_state":"charged"`) || !strings.Contains(body, `"charge_state":"not_charged"`) {
		t.Fatalf("consumptions = %d %s", rec.Code, body)
	}
	if !strings.Contains(body, `"limited_credits":400`) || !strings.Contains(body, `"permanent_credits":100`) {
		t.Fatalf("consumptions bucket split missing: %s", body)
	}

	// 邀请页：自动生成邀请码。
	rec = performJSON(router, http.MethodGet, "/api/member/invite", "", nil)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "invite_code") {
		t.Fatalf("invite = %d %s", rec.Code, rec.Body.String())
	}

	// 定价规则页。
	rec = performJSON(router, http.MethodGet, "/api/member/pricing", "", nil)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"credits_per_yuan":100`) {
		t.Fatalf("pricing = %d %s", rec.Code, rec.Body.String())
	}
}
