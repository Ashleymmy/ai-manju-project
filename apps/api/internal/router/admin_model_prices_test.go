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
			prices.Images["gemini-3-pro-image"]["2k"][0] = 63
			prices.Videos["wan-3.0"]["1080p"] = []float64{12, 12, 3}
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
				for _, tc := range []struct {
					kind    string
					payload map[string]any
					want    int64
				}{
					{"image.edit", map[string]any{"model": "supplier::gemini-3-pro-image", "size": "2048x2048", "quality": "auto", "references": []map[string]string{{"field_name": "image"}}}, 83},
					{"video.generate", map[string]any{"model": "sdvideo/yike-wan3.0-video", "resolution": "1080p", "duration": 10, "content": []map[string]string{{"type": "video_url"}}}, 150},
				} {
					status, raw = f.call(t, "POST", "/api/member/quote", f.member, map[string]any{"job_type": tc.kind, "payload": tc.payload})
					if err := json.Unmarshal(raw, &quote); err != nil {
						t.Fatal(err)
					}
					if status != 200 || quote.Credits != tc.want {
						t.Fatalf("new model quote HTTP%d %+v want%d", status, quote, tc.want)
					}
				}
			}
			verify()
			aliasWrite := "/api/admin/billing/configs/" + model.BillingConfigKeyModelAliases
			aliasBody := map[string]any{"value": map[string]string{"ep-price-test": "seedance-2.5"}}
			for _, tc := range []struct {
				token  string
				status int
			}{{"", 401}, {f.member, 403}, {f.auditor, 403}, {f.ops, 200}, {f.root, 200}} {
				if status, _ := f.call(t, "PUT", aliasWrite, tc.token, aliasBody); status != tc.status {
					t.Fatalf("alias write HTTP %d want %d", status, tc.status)
				}
			}
			if status, _ := f.call(t, "PUT", aliasWrite, f.root, map[string]any{"value": map[string]string{"ep-price-test": "unknown"}}); status != 400 {
				t.Fatalf("invalid alias HTTP %d", status)
			}
			verifyAlias := func() {
				status, raw := f.call(t, "POST", "/api/member/quote", f.member, map[string]any{"job_type": "video.generate", "payload": map[string]any{"model": "provider::ep-price-test", "resolution": "720p", "duration": 10, "content": []map[string]string{{"type": "video_url"}}}})
				var quote struct {
					Credits int64          `json:"credits"`
					Params  map[string]any `json:"params"`
				}
				if err := json.Unmarshal(raw, &quote); err != nil {
					t.Fatal(err)
				}
				if status != 200 || quote.Credits != 4800 || quote.Params["pricing_model"] != "seedance-2.5" {
					t.Fatalf("mapped quote HTTP %d %+v", status, quote)
				}
			}
			verifyAlias()
			_, raw := f.call(t, "GET", "/api/admin/audit-logs", f.root, nil)
			var logs struct {
				Items []model.AdminAuditLog `json:"items"`
			}
			if err := json.Unmarshal(raw, &logs); err != nil {
				t.Fatal(err)
			}
			found, aliasFound := false, false
			for _, item := range logs.Items {
				if item.TargetID == model.BillingConfigKeyModelPrices {
					found = true
				}
				if item.TargetID == model.BillingConfigKeyModelAliases {
					aliasFound = true
				}
			}
			if !found || !aliasFound {
				t.Fatal("model price change missing from audit log")
			}
			if driver == "postgres" {
				f.r = NewWithConfig(f.cfg)
				verify()
				verifyAlias()
			}
		})
	}
}
