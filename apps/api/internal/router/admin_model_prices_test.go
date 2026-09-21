package router

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/service"
)

func TestAdminModelPricesPersistQuoteAndAuthorization(t *testing.T) {
	for _, driver := range []string{"memory", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			dsn := os.Getenv("TEST_DATABASE_URL")
			if driver == "postgres" && dsn == "" {
				t.Skip("TEST_DATABASE_URL not set")
			}
			f := newMemberManagementFixture(t, driver, dsn)
			read := "/api/admin/billing/model-prices"
			write := "/api/admin/billing/configs/" + model.BillingConfigKeyModelPrices
			prices := service.DefaultModelCreditPrices()
			prices.Images["gpt-image-2.5-flare"]["1k"][0] = 7.5
			body := map[string]any{"value": prices}
			for _, tc := range []struct {
				token       string
				read, write int
			}{
				{"", 401, 401}, {f.member, 403, 403}, {f.auditor, 200, 403}, {f.ops, 200, 200}, {f.root, 200, 200},
			} {
				if status, _ := f.call(t, "GET", read, tc.token, nil); status != tc.read {
					t.Fatalf("read %d want%d", status, tc.read)
				}
				if status, _ := f.call(t, "PUT", write, tc.token, body); status != tc.write {
					t.Fatalf("write %d want%d", status, tc.write)
				}
			}
			if status, _ := f.call(t, "PUT", write, f.root, map[string]any{"value": map[string]any{"images": nil}}); status != 400 {
				t.Fatalf("invalid config HTTP%d", status)
			}
			verify := func() {
				_, raw := f.call(t, "GET", "/api/member/pricing", f.member, nil)
				var catalog struct {
					Prices service.ModelCreditPrices `json:"model_prices"`
				}
				if err := json.Unmarshal(raw, &catalog); err != nil {
					t.Fatal(err)
				}
				if catalog.Prices.Images["gpt-image-2.5-flare"]["1k"][0] != 7.5 {
					t.Fatal("saved prices not visible to member")
				}
				status, raw := f.call(t, "POST", "/api/member/quote", f.member, map[string]any{"job_type": "image.generate", "payload": map[string]any{"model": "gpt-image-2.5-flare", "size": "1024x1024", "quality": "low", "n": 2}})
				var quote struct {
					Credits int64 `json:"credits"`
				}
				if err := json.Unmarshal(raw, &quote); err != nil {
					t.Fatal(err)
				}
				if status != 200 || quote.Credits != 15 {
					t.Fatalf("quote HTTP%d %+v", status, quote)
				}
			}
			verify()
			_, raw := f.call(t, "GET", "/api/admin/audit-logs", f.root, nil)
			var logs struct {
				Items []model.AdminAuditLog `json:"items"`
			}
			if err := json.Unmarshal(raw, &logs); err != nil {
				t.Fatal(err)
			}
			found := false
			for _, item := range logs.Items {
				if item.TargetID == model.BillingConfigKeyModelPrices {
					found = true
				}
			}
			if !found {
				t.Fatal("model price change missing from audit log")
			}
			if driver == "postgres" {
				f.r = NewWithConfig(f.cfg)
				verify()
			}
		})
	}
}
