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

func TestModelPriceConfigValidation(t *testing.T) {
	raw, _ := json.Marshal(DefaultModelCreditPrices())
	for _, tc := range []struct{ name, raw string }{
		{"missing", `{}`},
		{"null reference", strings.Replace(string(raw), `"image_reference":20`, `"image_reference":null`, 1)},
		{"negative", strings.Replace(string(raw), `"image_reference":20`, `"image_reference":-1`, 1)},
		{"precision", strings.Replace(string(raw), `"image_reference":20`, `"image_reference":1.001`, 1)},
		{"excess", strings.Replace(string(raw), `"image_reference":20`, `"image_reference":1000001`, 1)},
		{"null cell", strings.Replace(string(raw), `[5,10,35,60,130]`, `[null,10,35,60,130]`, 1)},
		{"unknown", strings.Replace(string(raw), `"images":`, `"unknown":`, 1)},
		{"quality order", strings.Replace(string(raw), `"low","medium"`, `"medium","low"`, 1)},
		{"row typo", strings.Replace(string(raw), `"gpt-image-1":`, `"gpt-image-typo":`, 1)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := ParseModelCreditPrices([]byte(tc.raw)); err == nil {
				t.Fatal("invalid config accepted")
			}
		})
	}
	prices := DefaultModelCreditPrices()
	prices.Images["gpt-image-2"]["1k"][0] = 0.29
	prices.ImageReference = 0
	raw, _ = json.Marshal(prices)
	if _, err := ParseModelCreditPrices(raw); err != nil {
		t.Fatal(err)
	}
	prices.Videos["seedance-1.5-pro"]["480p"][2] = 1
	raw, _ = json.Marshal(prices)
	if _, err := ParseModelCreditPrices(raw); err == nil {
		t.Fatal("unsupported surcharge accepted")
	}
}

func TestLegacyCatalogAddsH3480pWithoutReplacingSavedPrices(t *testing.T) {
	prices := DefaultModelCreditPrices()
	delete(prices.Videos["minimax-h3"], "480p")
	prices.Videos["minimax-h3"]["768p"] = []float64{41, 42, 43}
	prices.Videos["seedance-2.5"]["720p"] = []float64{100, 110, 12.5}
	prices.Images["gpt-image-2"]["1k"][0] = 99
	prices.ImageReference = 3.5
	raw, _ := json.Marshal(prices)
	billing := repository.NewMemoryBillingRepository()
	if err := billing.UpsertConfig(model.BillingConfigKeyModelPrices, raw, "admin", time.Now()); err != nil {
		t.Fatal(err)
	}
	loaded := LoadModelCreditPrices(billing)
	if loaded.Videos["minimax-h3"]["480p"][0] != 30 || loaded.Videos["minimax-h3"]["768p"][2] != 43 || loaded.Videos["seedance-2.5"]["720p"][2] != 12.5 || loaded.Images["gpt-image-2"]["1k"][0] != 99 || loaded.ImageReference != 3.5 {
		t.Fatalf("lost saved prices: %+v", loaded)
	}
	loaded.Videos["minimax-h3"]["480p"] = []float64{11, 12, 13}
	raw, _ = json.Marshal(loaded)
	parsed, err := ParseModelCreditPrices(raw)
	if err != nil || parsed.Videos["minimax-h3"]["480p"][2] != 13 {
		t.Fatal(parsed, err)
	}
	loaded.Videos["minimax-h3"]["480p"] = nil
	raw, _ = json.Marshal(loaded)
	if _, err := ParseModelCreditPrices(raw); err == nil {
		t.Fatal("null row must not be backfilled")
	}
	delete(loaded.Videos["minimax-h3"], "768p")
	delete(loaded.Videos["minimax-h3"], "480p")
	raw, _ = json.Marshal(loaded)
	if _, err := ParseModelCreditPrices(raw); err == nil {
		t.Fatal("other missing rows must still be rejected")
	}
}

func TestModelPriceEditsRequoteAndPreserveReservations(t *testing.T) {
	fx := newBillingFixture(t)
	if _, err := fx.engine.Adjust("price-test", 1000, "admin", "price-test"); err != nil {
		t.Fatal(err)
	}
	payload := `{"model":"gpt-image-2.5-flare","size":"1024x1024","quality":"low","n":1}`
	first := fx.enqueue(t, "price-test", model.JobTypeImageGenerate, payload)
	prices := DefaultModelCreditPrices()
	prices.Images["gpt-image-2.5-flare"]["1k"][0] = 7.5
	prices.ImageReference = 2.25
	prices.Videos["seedance-2.0-fast"]["720p"][0] = 12.5
	raw, _ := json.Marshal(prices)
	if err := fx.billing.UpsertConfig(model.BillingConfigKeyModelPrices, raw, "admin", time.Now()); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		kind, payload string
		want          int64
	}{
		{model.JobTypeImageGenerate, payload, 8},
		{model.JobTypeImageGenerate, `{"model":"gpt-image-2.5-flare","size":"1024x1024","quality":"low","n":2}`, 15},
		{model.JobTypeImageEdit, `{"model":"gpt-image-2.5-flare","size":"1024x1024","quality":"low","n":2,"references":[{"field_name":"image"}]}`, 20},
		{model.JobTypeVideoGenerate, `{"model":"seedance-2.0-fast","resolution":"720p","duration":6}`, 75},
	} {
		credits, _, _, _ := fx.pricer.QuoteForJob(tc.kind, model.JSONB(tc.payload))
		if credits != tc.want {
			t.Fatalf("quote got %d want %d", credits, tc.want)
		}
	}
	fx.enqueue(t, "price-test", model.JobTypeImageGenerate, strings.Replace(payload, `"n":1`, `"n":2`, 1))
	overview, _ := fx.engine.Overview("price-test")
	if overview.PermanentFrozen != 20 {
		t.Fatalf("old5 + new15 frozen = %+v", overview)
	}
	if _, err := fx.jobRepo.SetResult(first.Job.ID, model.JSONB(`{}`)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := fx.reconciler.ReconcileOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	overview, _ = fx.engine.Overview("price-test")
	if overview.PermanentBalance != 995 || overview.PermanentFrozen != 15 {
		t.Fatalf("old reservation repriced: %+v", overview)
	}
	// Zero remains free even during an activity discount.
	prices.Images["gpt-image-2.5-flare"]["1k"][0] = 0
	raw, _ = json.Marshal(prices)
	if err := fx.billing.UpsertConfig(model.BillingConfigKeyModelPrices, raw, "admin", time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := fx.billing.UpsertConfig(model.BillingConfigKeyActivity, model.JSONB(`{"enabled":true,"discount_bps":5000}`), "admin", time.Now()); err != nil {
		t.Fatal(err)
	}
	if credits, _, _, _ := fx.pricer.QuoteForJob(model.JobTypeImageGenerate, model.JSONB(payload)); credits != 0 {
		t.Fatalf("free became %d", credits)
	}
}
