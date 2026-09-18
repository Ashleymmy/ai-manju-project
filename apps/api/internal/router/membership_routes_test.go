package router

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/config"
)

// TestMembershipRoutesAreRegistered 冒烟测试：WP-M5/M7/M8/M9/M10/M14 的路由组
// 在内存模式整机上真实注册（未登录 401 而非 404 即证明接线存在）。
func TestMembershipRoutesAreRegistered(t *testing.T) {
	router := NewWithConfig(config.Config{
		StorageDriver: "memory", AllowPublicSignup: true,
		AppSecret: "membership-routes-smoke-secret", AssetStorageDir: t.TempDir(),
		FrontendURLs: []string{"http://localhost:3100"},
	})

	paths := []struct {
		method string
		path   string
	}{
		// 用户端
		{"GET", "/api/member/overview"},
		{"GET", "/api/member/ledger"},
		{"GET", "/api/member/consumptions"},
		{"GET", "/api/member/invite"},
		{"GET", "/api/member/pricing"},
		{"GET", "/api/member/gifts"},
		{"POST", "/api/member/redeem"},
		{"GET", "/api/billing/plans"},
		{"GET", "/api/billing/packages"},
		{"GET", "/api/billing/orders"},
		{"POST", "/api/billing/orders"},
		// 后台（auditor 也可读，但未登录一律 401）
		{"GET", "/api/admin/member-users"},
		{"GET", "/api/admin/billing/ledger"},
		{"GET", "/api/admin/billing/orders"},
		{"GET", "/api/admin/billing/consumptions"},
		{"GET", "/api/admin/billing/plans"},
		{"GET", "/api/admin/billing/packages"},
		{"GET", "/api/admin/billing/configs"},
		{"GET", "/api/admin/billing/dashboard"},
		{"GET", "/api/admin/invites"},
		{"GET", "/api/admin/audit-logs"},
		{"GET", "/api/admin/billing/redemption-codes"},
	}

	for _, route := range paths {
		req := httptest.NewRequest(route.method, route.path, strings.NewReader(""))
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, req)
		if recorder.Code == http.StatusNotFound {
			t.Fatalf("%s %s 未注册（404）", route.method, route.path)
		}
		// 未登录应 401；Response 信封必须是统一格式。
		if recorder.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s 未登录 status=%d, want 401", route.method, route.path, recorder.Code)
		}
		var envelope struct {
			Success bool `json:"success"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
			t.Fatalf("%s %s 响应不是 JSON 信封: %s", route.method, route.path, recorder.Body.String())
		}
	}

	// 公开浏览类接口（套餐/积分包）也应要求登录。
	req := httptest.NewRequest("GET", "/api/billing/plans", nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("GET /api/billing/plans unauthenticated = %d, want 401", recorder.Code)
	}
}
