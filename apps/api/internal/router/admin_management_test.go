// Full-router probes; no stub handlers, mock API responses, or provider calls.
package router

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/database"
	"github.com/gin-gonic/gin"
)

type memberManagementFixture struct {
	r                                                   *gin.Engine
	cfg                                                 config.Config
	prefix, root, ops, auditor, member, opsID, memberID string
}

const memberManagementPassword = "Disposable-audit-only-password"

func (f *memberManagementFixture) call(t *testing.T, method, path, token string, body any) (int, json.RawMessage) {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	f.r.ServeHTTP(w, req)
	var envelope struct {
		Success bool            `json:"success"`
		Data    json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("%s %s returned non-JSON HTTP %d", method, path, w.Code)
	}
	return w.Code, envelope.Data
}

func (f *memberManagementFixture) login(t *testing.T, name string) string {
	t.Helper()
	status, raw := f.call(t, "POST", "/api/auth/login", "", map[string]any{"username": name, "password": memberManagementPassword})
	if status != 200 {
		t.Fatalf("audit login HTTP %d", status)
	}
	var data struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(raw, &data); err != nil {
		t.Fatal(err)
	}
	if data.Token == "" {
		t.Fatal("missing audit login token")
	}
	return data.Token
}

func newMemberManagementFixture(t *testing.T, driver, dsn string) *memberManagementFixture {
	t.Helper()
	f := &memberManagementFixture{prefix: fmt.Sprintf("admin_audit_%d", time.Now().UnixNano())}
	if driver == "postgres" {
		// Give every audit invocation its own schema, including bootstrap users.
		db, err := database.OpenPostgres(dsn)
		if err != nil {
			t.Fatal(err)
		}
		if err := db.Exec("CREATE SCHEMA " + f.prefix).Error; err != nil {
			t.Fatal(err)
		}
		sqlDB, err := db.DB()
		if err != nil {
			t.Fatal(err)
		}
		_ = sqlDB.Close()
		u, err := url.Parse(dsn)
		if err != nil {
			t.Fatal(err)
		}
		q := u.Query()
		q.Set("search_path", f.prefix)
		u.RawQuery = q.Encode()
		dsn = u.String()
	}
	f.cfg = config.Config{AppEnv: "production", StorageDriver: driver, DatabaseURL: dsn, RequirePersistentStorage: driver == "postgres", AppSecret: "disposable-audit-signing-secret", AdminUsername: f.prefix + "_root", AdminPassword: memberManagementPassword, AssetStorageDir: t.TempDir(), FrontendURLs: []string{"http://localhost:3100"}}
	f.r = NewWithConfig(f.cfg)
	f.root = f.login(t, f.cfg.AdminUsername)
	for _, role := range []string{"ops_admin", "auditor", "member"} {
		name := f.prefix + "_" + role
		status, raw := f.call(t, "POST", "/api/admin/users", f.root, map[string]any{"username": name, "password": memberManagementPassword, "role": role})
		if status != 201 {
			t.Fatalf("create audit %s HTTP %d", role, status)
		}
		var u struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(raw, &u); err != nil {
			t.Fatal(err)
		}
		token := f.login(t, name)
		switch role {
		case "ops_admin":
			f.ops, f.opsID = token, u.ID
		case "auditor":
			f.auditor = token
		case "member":
			f.member, f.memberID = token, u.ID
		}
	}
	return f
}

func TestMemberManagementAuthorization(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	backends := []struct{ name, driver, dsn string }{{"Memory", "memory", ""}}
	if dsn := os.Getenv("TEST_DATABASE_URL"); dsn != "" {
		backends = append(backends, struct{ name, driver, dsn string }{"Postgres", "postgres", dsn})
	}
	for _, b := range backends {
		t.Run(b.name, func(t *testing.T) {
			f := newMemberManagementFixture(t, b.driver, b.dsn)
			t.Run("RealAdminReadsAndBasicRoleGates", func(t *testing.T) {
				for _, path := range []string{"/api/admin/users", "/api/admin/member-users", "/api/admin/billing/ledger", "/api/admin/billing/consumptions", "/api/admin/billing/plans", "/api/admin/billing/packages", "/api/admin/billing/configs", "/api/admin/billing/dashboard", "/api/admin/invites", "/api/admin/audit-logs"} {
					for _, role := range []struct {
						token string
						want  int
					}{{"", 401}, {f.member, 403}, {f.auditor, 200}, {f.ops, 200}, {f.root, 200}} {
						status, _ := f.call(t, "GET", path, role.token, nil)
						if status != role.want {
							t.Errorf("GET %s got=%d want=%d", path, status, role.want)
						}
					}
				}
				status, _ := f.call(t, "POST", "/api/admin/member-users/"+f.memberID+"/credits/adjust", f.auditor, map[string]any{"delta": 100, "nonce": f.prefix + "_denied"})
				if status != 403 {
					t.Fatalf("auditor mutation HTTP %d; want 403", status)
				}
			})
			t.Run("CreditAdjustmentLedgerAndAuditUseRealData", func(t *testing.T) {
				for i := 0; i < 2; i++ {
					status, _ := f.call(t, "POST", "/api/admin/member-users/"+f.memberID+"/credits/adjust", f.ops, map[string]any{"delta": 321, "nonce": f.prefix + "_credit_once", "reason": "isolated release verification"})
					if status != 200 {
						t.Fatal("credit adjustment failed", status)
					}
				}
				status, raw := f.call(t, "GET", "/api/member/overview", f.member, nil)
				var overview struct {
					PermanentBalance int64 `json:"permanent_balance"`
				}
				if err := json.Unmarshal(raw, &overview); err != nil {
					t.Fatal(err)
				}
				if status != 200 || overview.PermanentBalance != 321 {
					t.Fatalf("member real balance=%d HTTP=%d; want 321/200", overview.PermanentBalance, status)
				}
				_, raw = f.call(t, "GET", "/api/admin/billing/ledger?user_id="+f.memberID, f.root, nil)
				var page struct {
					Total int `json:"total"`
				}
				if err := json.Unmarshal(raw, &page); err != nil {
					t.Fatal(err)
				}
				if page.Total != 1 {
					t.Fatalf("ledger entries=%d; want 1 for duplicate nonce", page.Total)
				}
				_, raw = f.call(t, "GET", "/api/admin/audit-logs?admin_id="+f.opsID, f.root, nil)
				var audit struct {
					Items []struct {
						Action string          `json:"action"`
						Detail json.RawMessage `json:"detail"`
					} `json:"items"`
				}
				if err := json.Unmarshal(raw, &audit); err != nil {
					t.Fatal(err)
				}
				found := false
				for _, row := range audit.Items {
					if bytes.Contains(row.Detail, []byte("isolated release verification")) {
						found = true
					}
				}
				if !found {
					t.Fatal("successful credit mutation missing audit reason")
				}
			})
			t.Run("OpsCannotCreateSuperAdmin", func(t *testing.T) {
				status, _ := f.call(t, "POST", "/api/admin/users", f.ops, map[string]any{"username": f.prefix + "_escalated", "password": memberManagementPassword, "role": "super_admin"})
				if status != 403 {
					t.Fatalf("ops created super_admin HTTP=%d; want 403", status)
				}
			})
			t.Run("OpsCannotPromoteOwnRole", func(t *testing.T) {
				status, _ := f.call(t, "PUT", "/api/admin/users/"+f.opsID, f.ops, map[string]any{"role": "super_admin"})
				if status != 403 {
					t.Errorf("ops self-promotion HTTP=%d; want 403", status)
				}
				// Restore only this disposable fixture so later probes retain ops semantics.
				if status == 200 {
					f.call(t, "PUT", "/api/admin/users/"+f.opsID, f.root, map[string]any{"role": "ops_admin"})
				}
			})
			t.Run("UnknownUserCannotReceiveAdminCredits", func(t *testing.T) {
				status, _ := f.call(t, "POST", "/api/admin/member-users/"+f.prefix+"_missing/credits/adjust", f.root, map[string]any{"delta": 7, "nonce": f.prefix + "_missing_adjust"})
				if status != 404 {
					t.Fatalf("nonexistent user credited HTTP=%d; want 404", status)
				}
			})
			t.Run("NegativePlanPriceRejected", func(t *testing.T) {
				_, raw := f.call(t, "GET", "/api/admin/billing/plans", f.root, nil)
				var plans []struct {
					ID    string `json:"id"`
					Price int64  `json:"price_month_cents"`
				}
				if err := json.Unmarshal(raw, &plans); err != nil || len(plans) == 0 {
					t.Fatal("plans unavailable", err)
				}
				status, _ := f.call(t, "PUT", "/api/admin/billing/plans/"+plans[0].ID, f.root, map[string]any{"price_month_cents": -1})
				if status != 400 {
					t.Errorf("negative plan price HTTP=%d; want 400", status)
				}
				f.call(t, "PUT", "/api/admin/billing/plans/"+plans[0].ID, f.root, map[string]any{"price_month_cents": plans[0].Price})
			})
			t.Run("PostgresCreditAndConfigSurviveRouterRestart", func(t *testing.T) {
				if b.driver != "postgres" {
					t.Skip("memory intentionally nonpersistent")
				}
				status, _ := f.call(t, "PUT", "/api/admin/billing/configs/register_bonus_credits", f.root, map[string]any{"value": 1731})
				if status != 200 {
					t.Fatal(status)
				}
				f.r = NewWithConfig(f.cfg)
				f.member = f.login(t, f.prefix+"_member")
				f.root = f.login(t, f.cfg.AdminUsername)
				_, raw := f.call(t, "GET", "/api/member/overview", f.member, nil)
				var v struct {
					Balance int64 `json:"permanent_balance"`
				}
				if err := json.Unmarshal(raw, &v); err != nil {
					t.Fatal(err)
				}
				if v.Balance != 321 {
					t.Fatalf("persisted balance=%d want321", v.Balance)
				}
				_, raw = f.call(t, "GET", "/api/admin/billing/configs", f.root, nil)
				var configs []struct {
					Key   string          `json:"key"`
					Value json.RawMessage `json:"value"`
				}
				if err := json.Unmarshal(raw, &configs); err != nil {
					t.Fatal(err)
				}
				found := false
				for _, c := range configs {
					if c.Key == "register_bonus_credits" && string(c.Value) == "1731" {
						found = true
					}
				}
				if !found {
					t.Fatal("edited billing config did not survive restart")
				}
			})
		})
	}
}
