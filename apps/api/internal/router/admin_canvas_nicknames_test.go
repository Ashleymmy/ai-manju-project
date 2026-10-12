package router

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/ai-manju/api/internal/model"
)

// [画布别名]
func TestAdminCanvasModelNicknamesReachMemberCatalog(t *testing.T) {
	for _, driver := range []string{"memory", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			dsn := os.Getenv("TEST_DATABASE_URL")
			if driver == "postgres" && dsn == "" {
				t.Skip("TEST_DATABASE_URL not set")
			}
			f := newMemberManagementFixture(t, driver, dsn)
			write := "/api/admin/billing/configs/" + model.BillingConfigKeyCanvasNicknames
			body := map[string]any{"value": map[string]string{"gpt-image-2": "image2", "sdvideo/seedance-2.0": "sd2.0"}}
			for _, tc := range []struct {
				token  string
				status int
			}{{"", 401}, {f.member, 403}, {f.auditor, 403}, {f.ops, 200}, {f.root, 200}} {
				if status, _ := f.call(t, "PUT", write, tc.token, body); status != tc.status {
					t.Fatalf("nickname write HTTP %d want %d", status, tc.status)
				}
			}
			for _, invalid := range []map[string]string{
				{"provider::gpt-image-2": "image2"},
				{"gpt-image-2": " "},
				{"gpt-image-2": "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三"},
			} {
				if status, _ := f.call(t, "PUT", write, f.root, map[string]any{"value": invalid}); status != 400 {
					t.Fatalf("invalid nicknames %v HTTP %d", invalid, status)
				}
			}
			verify := func() {
				status, raw := f.call(t, "GET", "/api/ai/models", f.member, nil)
				var catalog struct {
					Nicknames map[string]string `json:"model_nicknames"`
					Labels    map[string]string `json:"model_labels"`
				}
				if err := json.Unmarshal(raw, &catalog); err != nil {
					t.Fatal(err)
				}
				if status != 200 || catalog.Nicknames["gpt-image-2"] != "image2" || catalog.Nicknames["sdvideo/seedance-2.0"] != "sd2.0" {
					t.Fatalf("member catalog HTTP %d nicknames %v", status, catalog.Nicknames)
				}
				for _, label := range catalog.Labels {
					if label == "image2" || label == "sd2.0" {
						t.Fatalf("nicknames must not replace administrator labels: %v", catalog.Labels)
					}
				}
			}
			verify()
			if driver == "postgres" {
				f.r = NewWithConfig(f.cfg)
				verify()
			}
		})
	}
}
