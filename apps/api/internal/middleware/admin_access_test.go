package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/gin-gonic/gin"
)

// adminAccessFixture builds a minimal engine with RequireAdmin + AdminAudit
// and one user per role.
type adminAccessFixture struct {
	router      *gin.Engine
	authService *auth.Service
	auditRepo   *repository.MemoryAuditRepository
	cookies     map[string]*http.Cookie
}

func newAdminAccessFixture(t *testing.T) *adminAccessFixture {
	t.Helper()
	gin.SetMode(gin.TestMode)

	userRepo := repository.NewMemoryUserRepository()
	cfg := config.Config{AppSecret: "test-secret-test-secret"}
	authService := auth.NewService(userRepo, cfg)
	auditRepo := repository.NewMemoryAuditRepository()

	fixture := &adminAccessFixture{authService: authService, auditRepo: auditRepo, cookies: map[string]*http.Cookie{}}

	roles := map[string]string{
		"boss":    model.UserRoleSuperAdmin,
		"ops":     model.UserRoleOpsAdmin,
		"auditor": model.UserRoleAuditor,
		"member":  model.UserRoleMember,
	}
	for username, role := range roles {
		hash, err := auth.HashPassword("secret-password")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := userRepo.CreateUser(model.User{
			ID: "user_" + username, Username: username, PasswordHash: hash,
			DisplayName: username, Role: role, Status: model.UserStatusActive,
		}); err != nil {
			t.Fatal(err)
		}
		_, token, err := authService.Login(username, "secret-password", false)
		if err != nil {
			t.Fatal(err)
		}
		fixture.cookies[username] = &http.Cookie{Name: auth.CookieName, Value: token}
	}

	router := gin.New()
	admin := router.Group("/api/admin", RequireAdmin(authService), AdminAudit(auditRepo))
	admin.GET("/users", func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })
	admin.POST("/users/:id/disable", func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })
	admin.POST("/credits/adjust", func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })
	fixture.router = router
	return fixture
}

func (fx *adminAccessFixture) perform(method string, path string, body string, asUser string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if cookie := fx.cookies[asUser]; cookie != nil {
		request.AddCookie(cookie)
	}
	fx.router.ServeHTTP(recorder, request)
	return recorder
}

func TestRequireAdminRoleMatrix(t *testing.T) {
	fx := newAdminAccessFixture(t)

	cases := []struct {
		name   string
		method string
		path   string
		asUser string
		want   int
	}{
		{"member 读后台被拒", "GET", "/api/admin/users", "member", 403},
		{"member 写后台被拒", "POST", "/api/admin/users/u1/disable", "member", 403},
		{"未登录 401", "GET", "/api/admin/users", "", 401},
		{"auditor 只读放行", "GET", "/api/admin/users", "auditor", 200},
		{"auditor 写操作被拒", "POST", "/api/admin/users/u1/disable", "auditor", 403},
		{"ops 读放行", "GET", "/api/admin/users", "ops", 200},
		{"ops 写放行", "POST", "/api/admin/users/u1/disable", "ops", 200},
		{"super 读放行", "GET", "/api/admin/users", "boss", 200},
		{"super 写放行", "POST", "/api/admin/users/u1/disable", "boss", 200},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := fx.perform(tc.method, tc.path, "", tc.asUser)
			if recorder.Code != tc.want {
				t.Fatalf("%s %s as %s = %d, want %d", tc.method, tc.path, tc.asUser, recorder.Code, tc.want)
			}
		})
	}
}

func TestAdminAuditLogsMutationsOnly(t *testing.T) {
	fx := newAdminAccessFixture(t)

	// GET 不留痕。
	fx.perform("GET", "/api/admin/users", "", "ops")
	if _, total, _ := fx.auditRepo.List("", "", 1, 50); total != 0 {
		t.Fatalf("GET should not be audited, got %d entries", total)
	}

	// POST 留痕，敏感字段脱敏。
	fx.perform("POST", "/api/admin/credits/adjust", `{"user_id":"u1","delta":5000,"password":"p@ss","api_key":"sk-xxx"}`, "ops")
	logs, total, err := fx.auditRepo.List("", "", 1, 50)
	if err != nil || total != 1 {
		t.Fatalf("audit entries = %d err=%v, want 1", total, err)
	}
	entry := logs[0]
	if entry.Action != model.AuditActionAdjustCredits {
		t.Fatalf("action = %q, want %q", entry.Action, model.AuditActionAdjustCredits)
	}
	var detail map[string]any
	if err := json.Unmarshal(entry.Detail, &detail); err != nil {
		t.Fatal(err)
	}
	if detail["status"].(float64) != 200 {
		t.Fatalf("detail.status = %v, want 200", detail["status"])
	}
	body, _ := detail["body_snapshot"].(map[string]any)
	if body["password"] != "***" || body["api_key"] != "***" || body["delta"].(float64) != 5000 {
		t.Fatalf("body snapshot not redacted correctly: %+v", body)
	}

	// 操作人记录为 ops 用户 ID。
	opsUser, _ := fx.authService.Authenticate(fx.cookies["ops"].Value)
	if entry.AdminID != opsUser.ID {
		t.Fatalf("admin_id = %q, want %q", entry.AdminID, opsUser.ID)
	}
}

func TestAdminAuditDeniedAttemptsNotLogged(t *testing.T) {
	fx := newAdminAccessFixture(t)
	// auditor 的写操作在 RequireAdmin 阶段被 403 拦截，未执行的操作不留痕。
	fx.perform("POST", "/api/admin/users/u1/disable", ``, "auditor")
	if _, total, _ := fx.auditRepo.List("", "", 1, 50); total != 0 {
		t.Fatalf("denied attempt should not be logged, got %d", total)
	}
}

func TestAuditActionForMapping(t *testing.T) {
	cases := map[string]string{
		"POST /api/admin/billing/orders/:id/refund": model.AuditActionRefund,
		"POST /api/admin/credits/adjust":            model.AuditActionAdjustCredits,
		"POST /api/admin/invite/reset":              model.AuditActionResetInviteCode,
		"PUT /api/admin/billing/plans/:id":          model.AuditActionUpdatePlan,
		"PUT /api/admin/billing/activity":           model.AuditActionUpdateActivity,
		"PUT /api/admin/users/:id":                  model.AuditActionDisableUser,
		"POST /api/admin/announcements":             "post /api/admin/announcements",
	}
	for route, want := range cases {
		parts := strings.SplitN(route, " ", 2)
		if got := AuditActionFor(parts[0], parts[1]); got != want {
			t.Fatalf("AuditActionFor(%q) = %q, want %q", route, got, want)
		}
	}
}
