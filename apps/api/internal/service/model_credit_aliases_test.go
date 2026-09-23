package service

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

func TestModelCreditAliasValidation(t *testing.T) {
	for _, raw := range []string{`null`, `[]`, `{"ep-test":null}`, `{"ep-test":1}`, `{"": "seedance-2.5"}`, `{"provider::ep-test":"seedance-2.5"}`, `{"EP-test":"seedance-2.5"}`, `{"ep-test":"seedance-unknown"}`, `{"ep-test":"ep-other","ep-other":"seedance-2.5"}`, `{"seedance-2.5":"seedance-2.0-mini"}`, `{"seedance-fast":"seedance-2.5"}`} {
		if _, err := ParseModelCreditAliases([]byte(raw)); err == nil {
			t.Fatalf("invalid mapping accepted: %s", raw)
		}
	}
	for _, raw := range []string{`{}`, `{"ep-test":"seedance-2.5"}`} {
		if _, err := ParseModelCreditAliases([]byte(raw)); err != nil {
			t.Fatal(err)
		}
	}
}

func TestSupplierModelAliasesShareOfficialPrices(t *testing.T) {
	billing := repository.NewMemoryBillingRepository()
	aliases := model.JSONB(`{"ep-mt25":"seedance-2.5","ep-mt20":"seedance-2.0","ep-mini":"seedance-2.0-mini","ep-fast":"seedance-2.0-fast"}`)
	if err := billing.UpsertConfig(model.BillingConfigKeyModelAliases, aliases, "admin", time.Now()); err != nil {
		t.Fatal(err)
	}
	p := NewCreditPricer(billing)
	for _, tc := range []struct{ requested, official string }{
		{"sdvideo/seedance-fast", "seedance-2.0-fast"},
		{"seedance-fast", "seedance-2.0-fast"},
		{"sdvideo/yike-wan3.0-video", "wan-3.0"},
		{"yike-wan3.0-video", "wan-3.0"},
		{"sdvideo/yike-wan3.0-video-prime", "wan-3.0-prime"},
		{"mt::ep-mt25", "seedance-2.5"},
		{"ep-mt25", "seedance-2.5"},
		{"mt::ep-mt20", "seedance-2.0"},
		{"ep-mini", "seedance-2.0-mini"},
		{"mt::ep-fast", "seedance-2.0-fast"},
	} {
		for _, videoRef := range []bool{false, true} {
			payload := map[string]any{"model": tc.requested, "resolution": "720p", "duration": 10}
			if videoRef {
				payload["content"] = []map[string]string{{"type": "video_url"}}
			}
			raw, _ := json.Marshal(payload)
			got, tier, params, _ := p.QuoteForJob(model.JobTypeVideoGenerate, raw)
			payload["model"] = tc.official
			raw, _ = json.Marshal(payload)
			want, officialTier, _, _ := p.QuoteForJob(model.JobTypeVideoGenerate, raw)
			if got != want || tier != officialTier || params["pricing_source"] != "membership_price_sheet" || params["pricing_model"] != tc.official {
				t.Fatalf("%s video=%v got %d %s %+v want %d %s", tc.requested, videoRef, got, tier, params, want, officialTier)
			}
		}
	}
	// Neither renamed labels nor caller-supplied billing fields can set prices.
	got, _, params, _ := p.QuoteForJob(model.JobTypeVideoGenerate, model.JSONB(`{"model":"ep-mt25","studio_model":"seedance-2.0-mini","pricing_model":"seedance-2.0-mini","model_alias":"free","resolution":"720p","duration":10}`))
	if got != 1950 || params["pricing_model"] != "seedance-2.5" {
		t.Fatal(got, params)
	}
	_, _, params, _ = p.QuoteForJob(model.JobTypeVideoGenerate, model.JSONB(`{"model":"ep-unmapped","studio_model":"seedance-2.5","model_alias":"seedance-2.5","resolution":"720p","duration":10}`))
	if params["pricing_source"] != "legacy" {
		t.Fatal("unmapped endpoint inherited display-name pricing", params)
	}
	// Missing resolution prices are not invented during family matching.
	_, _, params, _ = p.QuoteForJob(model.JobTypeVideoGenerate, model.JSONB(`{"model":"sdvideo/yike-wan3.0-video","resolution":"1080p","duration":10}`))
	if params["pricing_model"] != "wan-3.0" || params["pricing_source"] != "legacy" {
		t.Fatal(params)
	}
}

func TestModelAliasPricingKeepsReservationsAndFastDiscount(t *testing.T) {
	fx := newBillingFixture(t)
	const user = "alias-pricing-test"
	if _, err := fx.engine.Adjust(user, 10000, "admin", "test"); err != nil {
		t.Fatal(err)
	}
	payload := `{"model":"ep-mt25","resolution":"720p","duration":10,"content":[{"type":"video_url"}]}`
	old := fx.enqueue(t, user, model.JobTypeVideoGenerate, strings.Replace(payload, `{"model"`, `{"prompt":"before-mapping","model"`, 1))
	if err := fx.billing.UpsertConfig(model.BillingConfigKeyModelAliases, model.JSONB(`{"ep-mt25":"seedance-2.5","ep-fast":"seedance-2.0-fast"}`), "admin", time.Now()); err != nil {
		t.Fatal(err)
	}
	job := fx.enqueue(t, user, model.JobTypeVideoGenerate, payload)
	overview, _ := fx.engine.Overview(user)
	if overview.PermanentFrozen != 120+3300 {
		t.Fatal(overview)
	}
	prices := DefaultModelCreditPrices()
	prices.Videos["seedance-2.5"]["720p"] = []float64{100, 100, 50}
	raw, _ := json.Marshal(prices)
	if err := fx.billing.UpsertConfig(model.BillingConfigKeyModelPrices, raw, "admin", time.Now()); err != nil {
		t.Fatal(err)
	}
	if got, _, _, _ := fx.pricer.QuoteForJob(model.JobTypeVideoGenerate, model.JSONB(payload)); got != 1500 {
		t.Fatal(got)
	}
	for _, id := range []string{old.Job.ID, job.Job.ID} {
		if _, err := fx.jobRepo.SetResult(id, model.JSONB(`{}`)); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err := fx.reconciler.ReconcileOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	overview, _ = fx.engine.Overview(user)
	if overview.PermanentBalance != 6580 || overview.PermanentFrozen != 0 {
		t.Fatalf("old reservations repriced: %+v", overview)
	}
	if err := fx.billing.UpsertConfig(model.BillingConfigKeyActivity, model.JSONB(`{"enabled":true,"discount_bps":5000,"applies_to":["video_fast"]}`), "admin", time.Now()); err != nil {
		t.Fatal(err)
	}
	credits, tier, _, _ := fx.pricer.QuoteForJob(model.JobTypeVideoGenerate, model.JSONB(`{"model":"ep-fast","resolution":"720p","duration":10}`))
	if credits != 225 || tier != model.TaskTypeVideoFast {
		t.Fatal(credits, tier)
	}
}
