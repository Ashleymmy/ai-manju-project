package router

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
)

func TestAdminMembershipChangesAndCostAccess(t *testing.T) {
	for _, driver := range []string{"memory", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			dsn := os.Getenv("TEST_DATABASE_URL")
			if driver == "postgres" && dsn == "" {
				t.Skip("TEST_DATABASE_URL not set")
			}
			f := newMemberManagementFixture(t, driver, dsn)
			_, raw := f.call(t, "GET", "/api/admin/billing/plans", f.root, nil)
			var plans []model.MembershipPlan
			if err := json.Unmarshal(raw, &plans); err != nil {
				t.Fatal(err)
			}
			internalID := ""
			for _, p := range plans {
				if p.Code == model.PlanCodeInternal {
					internalID = p.ID
					if p.Enabled {
						t.Fatal("internal membership must remain disabled for public sale")
					}
				}
			}
			if internalID == "" {
				t.Fatal("internal membership plan missing")
			}
			_, raw = f.call(t, "GET", "/api/billing/plans", f.member, nil)
			var publicPlans struct {
				Items []model.MembershipPlan `json:"items"`
			}
			if err := json.Unmarshal(raw, &publicPlans); err != nil {
				t.Fatal(err)
			}
			for _, p := range publicPlans.Items {
				if p.Code == model.PlanCodeInternal {
					t.Fatal("internal membership exposed in public catalog")
				}
			}
			path := "/api/admin/member-users/" + f.memberID + "/membership"
			body := map[string]any{"plan_id": internalID, "expected_membership_id": "", "expires_at": time.Now().Add(60 * 24 * time.Hour).UTC().Format(time.RFC3339), "test_credits": 700, "reason": "internal QA allocation", "nonce": "first-test-allocation"}
			for _, token := range []string{f.member, f.auditor, f.ops} {
				status, _ := f.call(t, "PUT", path, token, body)
				if status != 403 {
					t.Fatalf("non-super membership change HTTP %d", status)
				}
			}
			var membership model.UserMembership
			for i := 0; i < 2; i++ {
				status, raw := f.call(t, "PUT", path, f.root, body)
				if status != 200 {
					t.Fatalf("membership change HTTP %d", status)
				}
				if err := json.Unmarshal(raw, &membership); err != nil {
					t.Fatal(err)
				}
			}
			_, raw = f.call(t, "GET", "/api/member/overview", f.member, nil)
			var overview struct {
				Limited int64 `json:"limited_available"`
			}
			if err := json.Unmarshal(raw, &overview); err != nil {
				t.Fatal(err)
			}
			if overview.Limited != 700 {
				t.Fatalf("retry duplicated quota or grant missing: %+v", overview)
			}
			_, raw = f.call(t, "GET", "/api/admin/member-users?level=internal_test&search="+f.memberID, f.root, nil)
			var list struct {
				Total int `json:"total"`
				Items []struct {
					Role     string `json:"role"`
					PlanCode string `json:"plan_code"`
					Quota    int64  `json:"test_credits"`
				} `json:"items"`
			}
			if err := json.Unmarshal(raw, &list); err != nil {
				t.Fatal(err)
			}
			if list.Total != 1 || len(list.Items) != 1 || list.Items[0].PlanCode != model.PlanCodeInternal || list.Items[0].Role != model.UserRoleMember || list.Items[0].Quota != 700 {
				t.Fatalf("merged list lost member data: %+v", list)
			}
			body["nonce"] = "stale-version"
			status, _ := f.call(t, "PUT", path, f.root, body)
			if status != 409 {
				t.Fatalf("stale update HTTP %d, want409", status)
			}
			status, _ = f.call(t, "PUT", path, f.root, map[string]any{"plan_id": "", "expected_membership_id": membership.ID, "reason": "test complete", "nonce": "revoke-internal"})
			if status != 200 {
				t.Fatalf("revoke HTTP %d", status)
			}
			_, raw = f.call(t, "GET", "/api/admin/member-users?level=internal_test&search="+f.memberID, f.root, nil)
			if err := json.Unmarshal(raw, &list); err != nil {
				t.Fatal(err)
			}
			if list.Total != 0 {
				t.Fatal("revoked tester remains in active internal filter")
			}
			for _, token := range []string{f.auditor, f.ops, f.root} {
				status, _ := f.call(t, "GET", "/api/admin/billing/usage", token, nil)
				if status != 200 {
					t.Fatalf("usage read HTTP %d", status)
				}
			}
			status, _ = f.call(t, "GET", "/api/admin/billing/usage", f.member, nil)
			if status != 403 {
				t.Fatal("member accessed platform costs")
			}
			rate := map[string]any{"model": "test-model", "unit": "task", "unit_cost_micros": 12345}
			for _, token := range []string{f.auditor, f.ops} {
				status, _ = f.call(t, "POST", "/api/admin/billing/cost-rates", token, rate)
				if status != 403 {
					t.Fatal("cost rate privilege boundary failed")
				}
			}
			status, _ = f.call(t, "POST", "/api/admin/billing/cost-rates", f.root, rate)
			if status != 201 {
				t.Fatalf("cost rate create HTTP %d", status)
			}
			status, _ = f.call(t, "PUT", "/api/admin/billing/task-costs/missing", f.root, map[string]any{"amount_micros": 0, "reference": "bill"})
			if status != 404 {
				t.Fatal("orphan actual cost allowed")
			}
			status, raw = f.call(t, "GET", "/api/admin/billing/usage?export=csv", f.auditor, nil)
			var export struct {
				CSV string `json:"csv"`
			}
			if err := json.Unmarshal(raw, &export); err != nil {
				t.Fatal(err)
			}
			if status != 200 || export.CSV == "" {
				t.Fatal("export not wired")
			}
		})
	}
}
