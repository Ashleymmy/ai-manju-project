package handler

import (
	"fmt"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
)

func TestAdminLedgerSummaryMatchesWholeFilterAcrossPages(t *testing.T) {
	f := newAdminBillingFixture(t)
	now := time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC)
	for i, amount := range []int64{100, -25, 50} {
		kind := model.LedgerTypeAdminAdd
		if amount < 0 {
			kind = model.LedgerTypeAdminSubtract
		}
		if _, err := f.creditRepo.AdjustPermanent("user_member", amount, kind, "test", fmt.Sprintf("summary-%d", i), now.Add(time.Duration(i)*time.Hour)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := f.creditRepo.AdjustPermanent("user_ops", 900, model.LedgerTypeAdminAdd, "test", "other", now); err != nil {
		t.Fatal(err)
	}
	cookie := loginCookie(t, f.router, "ops", "secret")
	for _, tc := range []struct {
		query                     string
		total, increase, decrease float64
	}{
		{"page=1&page_size=1", 4, 1050, 25},
		{"page=2&page_size=1", 4, 1050, 25},
		{"page=5&page_size=1", 4, 1050, 25},
		{"user_id=user_member&page_size=1", 3, 150, 25},
		{"entry_type=admin_subtract&page_size=1", 1, 0, 25},
		{"user_id=user_member&start=" + url.QueryEscape(now.Add(time.Hour).Format(time.RFC3339)) + "&end=" + url.QueryEscape(now.Add(time.Hour).Format(time.RFC3339)), 1, 0, 25},
		{"user_id=missing", 0, 0, 0},
	} {
		t.Run(tc.query, func(t *testing.T) {
			response := performJSON(f.router, http.MethodGet, "/api/admin/billing/ledger?"+tc.query, "", cookie)
			if response.Code != http.StatusOK {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			data := decodeAdminDataMap(t, response.Body.String())
			summary, ok := data["summary"].(map[string]any)
			if !ok || data["total"] != tc.total || summary["increase"] != tc.increase || summary["decrease"] != tc.decrease {
				t.Fatalf("unexpected totals: %s", response.Body.String())
			}
		})
	}
}
