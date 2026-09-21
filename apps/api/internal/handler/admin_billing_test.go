package handler

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/middleware"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

// adminBillingFixture 后台（WP-M7）测试基座：全内存仓储 + 手工路由，
// 中间件链与生产一致（RequireAdmin + AdminAudit）。
type adminBillingFixture struct {
	router         *gin.Engine
	userRepo       *repository.MemoryUserRepository
	creditRepo     *repository.MemoryCreditRepository
	billingRepo    *repository.MemoryBillingRepository
	membershipRepo *repository.MemoryMembershipRepository
	inviteRepo     *repository.MemoryInviteRepository
	auditRepo      *repository.MemoryAuditRepository
	engine         *service.CreditLedgerService
}

func newAdminBillingFixture(t *testing.T) *adminBillingFixture {
	t.Helper()
	gin.SetMode(gin.TestMode)

	userRepo := repository.NewMemoryUserRepository()
	creditRepo := repository.NewMemoryCreditRepository()
	billingRepo := repository.NewMemoryBillingRepository()
	membershipRepo := repository.NewMemoryMembershipRepository()
	inviteRepo := repository.NewMemoryInviteRepository()
	auditRepo := repository.NewMemoryAuditRepository()

	cfg := config.Config{AllowPublicSignup: true}
	authService := auth.NewService(userRepo, cfg)
	if err := authService.SeedSuperAdmin(config.Config{AdminUsername: "admin", AdminPassword: "secret", AdminDisplayName: "Admin"}); err != nil {
		t.Fatal(err)
	}

	hash, err := auth.HashPassword("secret")
	if err != nil {
		t.Fatal(err)
	}
	seededUsers := []model.User{
		{ID: "user_ops", Username: "ops", PasswordHash: hash, DisplayName: "Ops", Role: model.UserRoleOpsAdmin, Status: model.UserStatusActive},
		{ID: "user_auditor", Username: "auditor", PasswordHash: hash, DisplayName: "Auditor", Role: model.UserRoleAuditor, Status: model.UserStatusActive},
		{ID: "user_member", Username: "member", PasswordHash: hash, DisplayName: "Member", Role: model.UserRoleMember, Status: model.UserStatusActive},
	}
	for _, user := range seededUsers {
		if _, err := userRepo.CreateUser(user); err != nil {
			t.Fatal(err)
		}
	}

	engine := service.NewCreditLedgerService(creditRepo, membershipRepo, billingRepo)
	adminMembers := service.NewAdminMemberService(userRepo, membershipRepo, creditRepo, billingRepo)
	memberHandler := NewAdminMemberHandler(adminMembers, engine, inviteRepo)
	billingHandler := NewAdminBillingHandler(engine, creditRepo, billingRepo, membershipRepo, inviteRepo, auditRepo, adminMembers)
	authHandler := NewAuthHandler(authService, userRepo, cfg)

	router := gin.New()
	router.Use(middleware.RequestID())
	api := router.Group("/api")
	api.POST("/auth/login", authHandler.Login)
	admin := router.Group("/api/admin", middleware.RequireAdmin(authService), middleware.AdminAudit(auditRepo))
	admin.GET("/member-users", memberHandler.ListMemberUsers)
	admin.POST("/member-users/:id/credits/adjust", memberHandler.AdjustCredits)
	admin.POST("/member-users/:id/invite/reset", memberHandler.ResetInviteCode)
	admin.GET("/billing/ledger", billingHandler.ListLedger)
	admin.GET("/billing/orders", billingHandler.ListOrders)
	admin.POST("/billing/orders/:id/refund", billingHandler.RefundOrder)
	admin.GET("/billing/consumptions", billingHandler.ListConsumptions)
	admin.GET("/billing/plans", billingHandler.ListPlans)
	admin.PUT("/billing/plans/:id", billingHandler.UpsertPlan)
	admin.GET("/billing/packages", billingHandler.ListPackages)
	admin.PUT("/billing/packages/:id", billingHandler.UpsertPackage)
	admin.GET("/billing/configs", billingHandler.ListConfigs)
	admin.PUT("/billing/configs/:key", billingHandler.UpsertConfig)
	admin.GET("/billing/dashboard", billingHandler.Dashboard)
	admin.GET("/invites", billingHandler.ListInvites)
	admin.GET("/audit-logs", billingHandler.ListAuditLogs)

	return &adminBillingFixture{
		router:         router,
		userRepo:       userRepo,
		creditRepo:     creditRepo,
		billingRepo:    billingRepo,
		membershipRepo: membershipRepo,
		inviteRepo:     inviteRepo,
		auditRepo:      auditRepo,
		engine:         engine,
	}
}

// adminEnvelope 统一响应信封解码。
type adminEnvelope struct {
	Success bool            `json:"success"`
	Data    json.RawMessage `json:"data"`
	Error   string          `json:"error"`
}

func decodeAdminEnvelope(t *testing.T, body string) adminEnvelope {
	t.Helper()
	var envelope adminEnvelope
	if err := json.Unmarshal([]byte(body), &envelope); err != nil {
		t.Fatalf("decode envelope failed: %v; body = %s", err, body)
	}
	return envelope
}

func decodeAdminDataMap(t *testing.T, body string) map[string]any {
	t.Helper()
	envelope := decodeAdminEnvelope(t, body)
	if !envelope.Success {
		t.Fatalf("envelope success = false; body = %s", body)
	}
	var data map[string]any
	if err := json.Unmarshal(envelope.Data, &data); err != nil {
		t.Fatalf("decode data failed: %v; body = %s", err, body)
	}
	return data
}

// TestAdminBillingRoleMatrix 角色矩阵抽查：member 403；auditor 只读
// （GET 200 / POST 403）；ops_admin 可写。
func TestAdminBillingRoleMatrix(t *testing.T) {
	f := newAdminBillingFixture(t)
	memberCookie := loginCookie(t, f.router, "member", "secret")
	opsCookie := loginCookie(t, f.router, "ops", "secret")
	auditorCookie := loginCookie(t, f.router, "auditor", "secret")

	memberRead := performJSON(f.router, http.MethodGet, "/api/admin/billing/dashboard", "", memberCookie)
	if memberRead.Code != http.StatusForbidden {
		t.Fatalf("member dashboard status = %d, want 403", memberRead.Code)
	}
	memberWrite := performJSON(f.router, http.MethodPost, "/api/admin/member-users/user_member/credits/adjust", `{"delta":1,"nonce":"m1"}`, memberCookie)
	if memberWrite.Code != http.StatusForbidden {
		t.Fatalf("member adjust status = %d, want 403", memberWrite.Code)
	}

	auditorRead := performJSON(f.router, http.MethodGet, "/api/admin/billing/dashboard", "", auditorCookie)
	if auditorRead.Code != http.StatusOK {
		t.Fatalf("auditor dashboard status = %d, want 200; body = %s", auditorRead.Code, auditorRead.Body.String())
	}
	auditorRefund := performJSON(f.router, http.MethodPost, "/api/admin/billing/orders/ord_missing/refund", "", auditorCookie)
	if auditorRefund.Code != http.StatusForbidden {
		t.Fatalf("auditor refund status = %d, want 403", auditorRefund.Code)
	}

	opsAdjust := performJSON(f.router, http.MethodPost, "/api/admin/member-users/user_member/credits/adjust", `{"delta":10,"reason":"matrix","nonce":"matrix-n1"}`, opsCookie)
	if opsAdjust.Code != http.StatusOK {
		t.Fatalf("ops adjust status = %d, want 200; body = %s", opsAdjust.Code, opsAdjust.Body.String())
	}
}

// TestAdminListMemberUsers 模块1 列表：返回 items/total 信封。
func TestAdminListMemberUsers(t *testing.T) {
	f := newAdminBillingFixture(t)
	opsCookie := loginCookie(t, f.router, "ops", "secret")

	recorder := performJSON(f.router, http.MethodGet, "/api/admin/member-users?page=1&page_size=20", "", opsCookie)
	if recorder.Code != http.StatusOK {
		t.Fatalf("list member users status = %d; body = %s", recorder.Code, recorder.Body.String())
	}
	data := decodeAdminDataMap(t, recorder.Body.String())
	items, ok := data["items"].([]any)
	if !ok {
		t.Fatalf("items missing or wrong type; body = %s", recorder.Body.String())
	}
	// 种子用户：admin / ops / auditor / member
	total, ok := data["total"].(float64)
	if !ok || int(total) != 4 {
		t.Fatalf("total = %v, want 4; body = %s", data["total"], recorder.Body.String())
	}
	if len(items) != 4 {
		t.Fatalf("items len = %d, want 4", len(items))
	}
	first, ok := items[0].(map[string]any)
	if !ok || first["user_id"] == nil {
		t.Fatalf("row missing user_id; body = %s", recorder.Body.String())
	}
}

// TestAdminAdjustCredits 调账：参数校验、流水可见、nonce 幂等。
func TestAdminAdjustCredits(t *testing.T) {
	f := newAdminBillingFixture(t)
	opsCookie := loginCookie(t, f.router, "ops", "secret")

	zeroDelta := performJSON(f.router, http.MethodPost, "/api/admin/member-users/user_member/credits/adjust", `{"delta":0,"nonce":"n0"}`, opsCookie)
	if zeroDelta.Code != http.StatusBadRequest {
		t.Fatalf("delta=0 status = %d, want 400", zeroDelta.Code)
	}
	emptyNonce := performJSON(f.router, http.MethodPost, "/api/admin/member-users/user_member/credits/adjust", `{"delta":10}`, opsCookie)
	if emptyNonce.Code != http.StatusBadRequest {
		t.Fatalf("empty nonce status = %d, want 400", emptyNonce.Code)
	}

	adjust := performJSON(f.router, http.MethodPost, "/api/admin/member-users/user_member/credits/adjust", `{"delta":500,"reason":"补偿","nonce":"adj-1"}`, opsCookie)
	if adjust.Code != http.StatusOK {
		t.Fatalf("adjust status = %d; body = %s", adjust.Code, adjust.Body.String())
	}
	adjustData := decodeAdminDataMap(t, adjust.Body.String())
	if applied, ok := adjustData["Applied"].(bool); !ok || !applied {
		t.Fatalf("adjust applied = %v, want true; body = %s", adjustData["Applied"], adjust.Body.String())
	}

	ledger := performJSON(f.router, http.MethodGet, "/api/admin/billing/ledger?user_id=user_member&entry_type=admin_add", "", opsCookie)
	if ledger.Code != http.StatusOK {
		t.Fatalf("ledger status = %d; body = %s", ledger.Code, ledger.Body.String())
	}
	ledgerData := decodeAdminDataMap(t, ledger.Body.String())
	if total, ok := ledgerData["total"].(float64); !ok || int(total) != 1 {
		t.Fatalf("admin_add ledger total = %v, want 1; body = %s", ledgerData["total"], ledger.Body.String())
	}

	// 同 nonce 重复调账：幂等，不重复加
	repeat := performJSON(f.router, http.MethodPost, "/api/admin/member-users/user_member/credits/adjust", `{"delta":500,"reason":"补偿","nonce":"adj-1"}`, opsCookie)
	if repeat.Code != http.StatusOK {
		t.Fatalf("repeat adjust status = %d; body = %s", repeat.Code, repeat.Body.String())
	}
	repeatData := decodeAdminDataMap(t, repeat.Body.String())
	if applied, ok := repeatData["Applied"].(bool); !ok || applied {
		t.Fatalf("repeat adjust applied = %v, want false; body = %s", repeatData["Applied"], repeat.Body.String())
	}
	account, err := f.creditRepo.GetAccount("user_member")
	if err != nil {
		t.Fatal(err)
	}
	if account.PermanentBalance != 500 {
		t.Fatalf("permanent balance = %d, want 500 (idempotent)", account.PermanentBalance)
	}
	ledgerAgain := performJSON(f.router, http.MethodGet, "/api/admin/billing/ledger?user_id=user_member&entry_type=admin_add", "", opsCookie)
	ledgerAgainData := decodeAdminDataMap(t, ledgerAgain.Body.String())
	if total, ok := ledgerAgainData["total"].(float64); !ok || int(total) != 1 {
		t.Fatalf("admin_add ledger total after repeat = %v, want 1", ledgerAgainData["total"])
	}
}

// TestAdminRefundOrder 退款：paid 订单退款成功、余额回滚、重复退款幂等、未知订单 404。
func TestAdminRefundOrder(t *testing.T) {
	f := newAdminBillingFixture(t)
	opsCookie := loginCookie(t, f.router, "ops", "secret")

	pkg, err := f.billingRepo.UpsertPackage(model.CreditPackage{Name: "小包", Credits: 100, PriceCents: 600, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	// 引擎调账模拟充值到账（永久余额 +100）
	if _, err := f.engine.Adjust("user_member", 100, "user_ops", "refund-seed"); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	order, err := f.billingRepo.CreateOrder(model.Order{
		UserID:      "user_member",
		OrderType:   model.OrderTypeCreditPack,
		PackageID:   pkg.ID,
		AmountCents: 600,
		Currency:    "CNY",
		Status:      model.OrderStatusPaid,
		PaidAt:      &now,
	})
	if err != nil {
		t.Fatal(err)
	}

	refund := performJSON(f.router, http.MethodPost, "/api/admin/billing/orders/"+order.ID+"/refund", "", opsCookie)
	if refund.Code != http.StatusOK {
		t.Fatalf("refund status = %d; body = %s", refund.Code, refund.Body.String())
	}
	refundData := decodeAdminDataMap(t, refund.Body.String())
	if status, ok := refundData["status"].(string); !ok || status != model.OrderStatusRefunded {
		t.Fatalf("order status = %v, want refunded; body = %s", refundData["status"], refund.Body.String())
	}
	if refundData["refunded_at"] == nil {
		t.Fatalf("refunded_at missing; body = %s", refund.Body.String())
	}

	// 余额回滚：+100 -100 = 0
	account, err := f.creditRepo.GetAccount("user_member")
	if err != nil {
		t.Fatal(err)
	}
	if account.PermanentBalance != 0 {
		t.Fatalf("permanent balance after refund = %d, want 0", account.PermanentBalance)
	}

	// 重复退款幂等：仍 200，状态保持 refunded
	again := performJSON(f.router, http.MethodPost, "/api/admin/billing/orders/"+order.ID+"/refund", "", opsCookie)
	if again.Code != http.StatusOK {
		t.Fatalf("repeat refund status = %d; body = %s", again.Code, again.Body.String())
	}
	againData := decodeAdminDataMap(t, again.Body.String())
	if status, ok := againData["status"].(string); !ok || status != model.OrderStatusRefunded {
		t.Fatalf("repeat refund status = %v, want refunded", againData["status"])
	}

	missing := performJSON(f.router, http.MethodPost, "/api/admin/billing/orders/ord_missing/refund", "", opsCookie)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing order refund status = %d, want 404", missing.Code)
	}
}

// TestAdminUpsertConfigWhitelist 配置白名单：名单外 key 400，名单内可写。
func TestAdminUpsertConfigWhitelist(t *testing.T) {
	f := newAdminBillingFixture(t)
	opsCookie := loginCookie(t, f.router, "ops", "secret")

	rejected := performJSON(f.router, http.MethodPut, "/api/admin/billing/configs/not_a_real_key", `{"value":123}`, opsCookie)
	if rejected.Code != http.StatusBadRequest {
		t.Fatalf("unknown config key status = %d, want 400; body = %s", rejected.Code, rejected.Body.String())
	}

	accepted := performJSON(f.router, http.MethodPut, "/api/admin/billing/configs/"+model.BillingConfigKeyRegisterBonus, `{"value":2000}`, opsCookie)
	if accepted.Code != http.StatusOK {
		t.Fatalf("whitelisted config status = %d; body = %s", accepted.Code, accepted.Body.String())
	}
	config, err := f.billingRepo.GetConfig(model.BillingConfigKeyRegisterBonus)
	if err != nil {
		t.Fatal(err)
	}
	var value int64
	if err := json.Unmarshal(config.Value, &value); err != nil || value != 2000 {
		t.Fatalf("config value = %s, want 2000", string(config.Value))
	}

	list := performJSON(f.router, http.MethodGet, "/api/admin/billing/configs", "", opsCookie)
	if list.Code != http.StatusOK {
		t.Fatalf("list configs status = %d", list.Code)
	}
	envelope := decodeAdminEnvelope(t, list.Body.String())
	var configs []map[string]any
	if err := json.Unmarshal(envelope.Data, &configs); err != nil || len(configs) != 1 {
		t.Fatalf("configs = %s, want 1 entry", string(envelope.Data))
	}
	if configs[0]["key"] != model.BillingConfigKeyRegisterBonus {
		t.Fatalf("config key = %v, want %s", configs[0]["key"], model.BillingConfigKeyRegisterBonus)
	}
}

// TestAdminUpsertPlan 套餐编辑：部分字段覆盖，Code 不受影响，ListPlans 可见。
func TestAdminUpsertPlan(t *testing.T) {
	f := newAdminBillingFixture(t)
	opsCookie := loginCookie(t, f.router, "ops", "secret")

	plan, err := f.membershipRepo.UpsertPlan(model.MembershipPlan{
		Code: model.PlanCodeMember198, Name: "会员198", PriceMonthCents: 19800, MonthlyCredits: 1000, Enabled: true,
		ImageConcurrency: model.FreeImageConcurrency, VideoConcurrency: model.FreeVideoConcurrency, CreditDiscountBps: 10000, Features: model.JSONB(`{}`),
	})
	if err != nil {
		t.Fatal(err)
	}

	update := performJSON(f.router, http.MethodPut, "/api/admin/billing/plans/"+plan.ID, `{"price_month_cents":9900}`, opsCookie)
	if update.Code != http.StatusOK {
		t.Fatalf("upsert plan status = %d; body = %s", update.Code, update.Body.String())
	}
	updateData := decodeAdminDataMap(t, update.Body.String())
	if price, ok := updateData["price_month_cents"].(float64); !ok || int64(price) != 9900 {
		t.Fatalf("price_month_cents = %v, want 9900", updateData["price_month_cents"])
	}
	if code, ok := updateData["code"].(string); !ok || code != model.PlanCodeMember198 {
		t.Fatalf("code = %v, want %s (不可改)", updateData["code"], model.PlanCodeMember198)
	}
	if name, ok := updateData["name"].(string); !ok || name != "会员198" {
		t.Fatalf("name = %v, want 会员198 (未传字段保留)", updateData["name"])
	}

	list := performJSON(f.router, http.MethodGet, "/api/admin/billing/plans", "", opsCookie)
	if list.Code != http.StatusOK {
		t.Fatalf("list plans status = %d", list.Code)
	}
	envelope := decodeAdminEnvelope(t, list.Body.String())
	var plans []map[string]any
	if err := json.Unmarshal(envelope.Data, &plans); err != nil || len(plans) != 1 {
		t.Fatalf("plans = %s, want 1 entry", string(envelope.Data))
	}
	if price, ok := plans[0]["price_month_cents"].(float64); !ok || int64(price) != 9900 {
		t.Fatalf("listed price = %v, want 9900", plans[0]["price_month_cents"])
	}

	missing := performJSON(f.router, http.MethodPut, "/api/admin/billing/plans/plan_missing", `{"price_month_cents":1}`, opsCookie)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing plan status = %d, want 404", missing.Code)
	}
}

// TestAdminAuditLogs 审计留痕：调账后能在审计列表看到 adjust_credits 记录。
func TestAdminAuditLogs(t *testing.T) {
	f := newAdminBillingFixture(t)
	opsCookie := loginCookie(t, f.router, "ops", "secret")

	adjust := performJSON(f.router, http.MethodPost, "/api/admin/member-users/user_member/credits/adjust", `{"delta":50,"reason":"审计","nonce":"audit-n1"}`, opsCookie)
	if adjust.Code != http.StatusOK {
		t.Fatalf("adjust status = %d; body = %s", adjust.Code, adjust.Body.String())
	}

	logs := performJSON(f.router, http.MethodGet, "/api/admin/audit-logs?action="+model.AuditActionAdjustCredits, "", opsCookie)
	if logs.Code != http.StatusOK {
		t.Fatalf("audit logs status = %d; body = %s", logs.Code, logs.Body.String())
	}
	data := decodeAdminDataMap(t, logs.Body.String())
	if total, ok := data["total"].(float64); !ok || int(total) < 1 {
		t.Fatalf("adjust_credits audit total = %v, want >= 1; body = %s", data["total"], logs.Body.String())
	}
	items, ok := data["items"].([]any)
	if !ok || len(items) == 0 {
		t.Fatalf("audit items missing; body = %s", logs.Body.String())
	}
	first, ok := items[0].(map[string]any)
	if !ok || first["action"] != model.AuditActionAdjustCredits {
		t.Fatalf("first audit action = %v, want %s", first["action"], model.AuditActionAdjustCredits)
	}
	if first["admin_id"] != "user_ops" {
		t.Fatalf("audit admin_id = %v, want user_ops", first["admin_id"])
	}

	// 查询类请求不留痕
	before := data["total"].(float64)
	if read := performJSON(f.router, http.MethodGet, "/api/admin/billing/dashboard", "", opsCookie); read.Code != http.StatusOK {
		t.Fatalf("dashboard status = %d", read.Code)
	}
	after := performJSON(f.router, http.MethodGet, "/api/admin/audit-logs?action="+model.AuditActionAdjustCredits, "", opsCookie)
	afterData := decodeAdminDataMap(t, after.Body.String())
	if afterData["total"].(float64) != before {
		t.Fatalf("read-only request changed audit total: before=%v after=%v", before, afterData["total"])
	}
}

// TestAdminListConsumptions 任务消耗列表：返回 items + stats。
func TestAdminListConsumptions(t *testing.T) {
	f := newAdminBillingFixture(t)
	opsCookie := loginCookie(t, f.router, "ops", "secret")

	// 造一条 settled 消耗：先充值，再 reserve + settle
	if _, err := f.engine.Adjust("user_member", 100, "user_ops", "cons-seed"); err != nil {
		t.Fatal(err)
	}
	if _, err := f.engine.Reserve("user_member", service.CreditQuote{JobID: "job-img-1", TaskType: model.TaskTypeImage, Params: map[string]any{}, Credits: 30}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.engine.Settle("job-img-1"); err != nil {
		t.Fatal(err)
	}

	list := performJSON(f.router, http.MethodGet, "/api/admin/billing/consumptions", "", opsCookie)
	if list.Code != http.StatusOK {
		t.Fatalf("list consumptions status = %d; body = %s", list.Code, list.Body.String())
	}
	data := decodeAdminDataMap(t, list.Body.String())
	if total, ok := data["total"].(float64); !ok || int(total) != 1 {
		t.Fatalf("consumptions total = %v, want 1", data["total"])
	}
	stats, ok := data["stats"].(map[string]any)
	if !ok {
		t.Fatalf("stats missing; body = %s", list.Body.String())
	}
	if success, ok := stats["SuccessCount"].(float64); !ok || int(success) != 1 {
		t.Fatalf("stats.SuccessCount = %v, want 1", stats["SuccessCount"])
	}
	if settled, ok := stats["TotalCreditsSettled"].(float64); !ok || int64(settled) != 30 {
		t.Fatalf("stats.TotalCreditsSettled = %v, want 30", stats["TotalCreditsSettled"])
	}
	if images, ok := stats["ImageCount"].(float64); !ok || int(images) != 1 {
		t.Fatalf("stats.ImageCount = %v, want 1", stats["ImageCount"])
	}

	// user_id 过滤语义：空串全平台、指定用户只看到自己
	filtered := performJSON(f.router, http.MethodGet, "/api/admin/billing/consumptions?user_id=user_member", "", opsCookie)
	filteredData := decodeAdminDataMap(t, filtered.Body.String())
	if total, ok := filteredData["total"].(float64); !ok || int(total) != 1 {
		t.Fatalf("filtered consumptions total = %v, want 1", filteredData["total"])
	}
	other := performJSON(f.router, http.MethodGet, "/api/admin/billing/consumptions?user_id=user_ops", "", opsCookie)
	otherData := decodeAdminDataMap(t, other.Body.String())
	if total, ok := otherData["total"].(float64); !ok || int(total) != 0 {
		t.Fatalf("other-user consumptions total = %v, want 0", otherData["total"])
	}
}

// TestAdminResetInviteCode 重置邀请码：返回新码且与旧码不同；再注册邀请记录后列表可见。
func TestAdminResetInviteCode(t *testing.T) {
	f := newAdminBillingFixture(t)
	opsCookie := loginCookie(t, f.router, "ops", "secret")

	first, err := f.inviteRepo.GetOrCreateProfile("user_member", time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}

	reset := performJSON(f.router, http.MethodPost, "/api/admin/member-users/user_member/invite/reset", "", opsCookie)
	if reset.Code != http.StatusOK {
		t.Fatalf("reset invite code status = %d; body = %s", reset.Code, reset.Body.String())
	}
	data := decodeAdminDataMap(t, reset.Body.String())
	newCode, ok := data["invite_code"].(string)
	if !ok || newCode == "" {
		t.Fatalf("invite_code missing; body = %s", reset.Body.String())
	}
	if newCode == first.InviteCode {
		t.Fatalf("invite code not rotated: %s", newCode)
	}
	if len(newCode) != model.InviteCodeLength {
		t.Fatalf("invite code length = %d, want %d", len(newCode), model.InviteCodeLength)
	}
	profile, err := f.inviteRepo.GetOrCreateProfile("user_member", time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if profile.InviteCode != newCode {
		t.Fatalf("persisted invite code = %s, want %s", profile.InviteCode, newCode)
	}
}
