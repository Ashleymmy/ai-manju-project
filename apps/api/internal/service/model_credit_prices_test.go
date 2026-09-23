package service

import (
	"context"
	"encoding/json"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"testing"
	"time"
)

func TestConfirmedModelCreditPrices(t *testing.T) {
	p := NewCreditPricer(repository.NewMemoryBillingRepository())
	for _, tc := range []struct {
		name, kind, payload string
		want                int64
	}{
		{"half_single", model.JobTypeImageGenerate, `{"model":"gpt-image-1.5","quality":"low","size":"2048x2048","n":1}`, 23},
		{"half_sum_before_round", model.JobTypeImageGenerate, `{"model":"gpt-image-1.5","quality":"low","size":"2048x2048","n":2}`, 45},
		{"flare_confirmed_xhigh", model.JobTypeImageGenerate, `{"model":"gpt-image-2.5-flare","quality":"xhigh","size":"3840x2160"}`, 460},
		{"reference_mask_excluded", model.JobTypeImageEdit, `{"model":"gpt-image-2","quality":"low","size":"1024x1024","references":[{"field_name":"image"},{"field_name":"image"},{"field_name":"mask"}]}`, 50},
		{"fast_confirmed_reference", model.JobTypeVideoGenerate, `{"model":"doubao-seedance-2-0-fast-260128","resolution":"720p","duration":6,"content":[{"type":"video_url"}]}`, 390},
		{"fast_no_reference", model.JobTypeVideoGenerate, `{"model":"seedance-2.0-fast","resolution":"720p","duration":6}`, 270},
		{"audio", model.JobTypeVideoGenerate, `{"model":"seedance-1.5-pro","resolution":"1080p","duration":5,"generate_audio":true}`, 500},
		{"silent", model.JobTypeVideoGenerate, `{"model":"seedance-1.5-pro","resolution":"1080p","duration":5,"generate_audio":false}`, 250},
		{"canvas_aligned_2k", model.JobTypeImageGenerate, `{"model":"gpt-image-2","quality":"high","size":"2736x1536"}`, 600},
		{"client_cannot_override_model", model.JobTypeImageGenerate, `{"model":"gpt-image-2","studio_model":"gpt-image-1","quality":"low","size":"1024x1024"}`, 10},
	} {
		t.Run(tc.name, func(t *testing.T) {
			credits, _, params, _ := p.QuoteForJob(tc.kind, model.JSONB(tc.payload))
			if credits != tc.want || params["pricing_source"] != "membership_price_sheet" {
				t.Fatalf("got %d %+v, want %d", credits, params, tc.want)
			}
		})
	}
}

func TestModelQuoteUncertainParametersAreNotExact(t *testing.T) {
	p := NewCreditPricer(repository.NewMemoryBillingRepository())
	for _, payload := range []string{
		`{"model":"seedance-2.5","duration":-1,"resolution":"720p","content":[{"type":"video_url"}]}`,
		`{"model":"seedance-2.0","duration":-1,"resolution":"720p"}`,
	} {
		_, _, params, _ := p.QuoteForJob(model.JobTypeVideoGenerate, model.JSONB(payload))
		if params["pricing_source"] == "membership_price_sheet" {
			t.Fatal(params)
		}
	}
	_, _, params, _ := p.QuoteForJob(model.JobTypeImageGenerate, model.JSONB(`{"model":"gpt-image-2.5-flare","size":"auto","quality":"auto"}`))
	if params["pricing_source"] != "image_auto_fallback" || params["base_per_image"] != float64(50) {
		t.Fatal(params)
	}
}

func TestAutomaticImageReferencesUseFallbackAndKeepReservations(t *testing.T) {
	fx := newBillingFixture(t)
	for _, tc := range []struct {
		payload string
		want    int64
	}{
		{`{"model":"gpt-image-2.5-flare","size":"auto","quality":"auto","references":[{"field_name":"image"},{"field_name":"image"},{"field_name":"mask"}]}`, 90},
		{`{"model":"gpt-image-1.5","size":"2048x2048","quality":"auto","n":2,"references":[{"field_name":"image"},{"field_name":"image"}]}`, 240},
		{`{"model":"gpt-image-1.5","size":"auto","quality":"high","references":[{"field_name":"image"}]}`, 70},
		{`{"model":"gemini-3-pro-image","size":"auto","references":[{"field_name":"image"}]}`, 70},
		{`{"model":"gpt-image-1.5"}`, 50},
	} {
		credits, _, params, _ := fx.pricer.QuoteForJob(model.JobTypeImageEdit, model.JSONB(tc.payload))
		if credits != tc.want || params["pricing_source"] != "image_auto_fallback" {
			t.Fatalf("got %d %+v want %d", credits, params, tc.want)
		}
		if _, exists := params["range_min"]; exists {
			t.Fatal("auto charge must display the amount, not a catalog range")
		}
	}
	// Explicit unmatched models keep their existing policy pending an admin price.
	credits, _, params, _ := fx.pricer.QuoteForJob(model.JobTypeImageEdit, model.JSONB(`{"model":"unpriced","size":"1024x1024","quality":"low","references":[{"field_name":"image"}]}`))
	if credits != 50 || params["pricing_source"] != "legacy" {
		t.Fatal(credits, params)
	}
	const user = "auto-image-price-test"
	if _, err := fx.engine.Adjust(user, 1000, "admin", "test"); err != nil {
		t.Fatal(err)
	}
	payload := `{"model":"gpt-image-1.5","n":2,"references":[{"field_name":"image"},{"field_name":"mask"}]}`
	job := fx.enqueue(t, user, model.JobTypeImageEdit, payload)
	overview, _ := fx.engine.Overview(user)
	if overview.PermanentFrozen != 140 {
		t.Fatal(overview)
	}
	prices := DefaultModelCreditPrices()
	prices.ImageReference = 2.25
	raw, _ := json.Marshal(prices)
	if err := fx.billing.UpsertConfig(model.BillingConfigKeyModelPrices, raw, "admin", time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := fx.billing.UpsertConfig(model.BillingConfigKeyPricingRules, model.JSONB(`{"image":{"standard_1024":51}}`), "admin", time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := fx.billing.UpsertConfig(model.BillingConfigKeyActivity, model.JSONB(`{"enabled":true,"discount_bps":5000}`), "admin", time.Now()); err != nil {
		t.Fatal(err)
	}
	credits, _, _, _ = fx.pricer.QuoteForJob(model.JobTypeImageEdit, model.JSONB(payload))
	if credits != 54 {
		t.Fatalf("want ceil((51+2.25)*2*0.5)=54, got %d", credits)
	}
	if _, err := fx.jobRepo.SetResult(job.Job.ID, model.JSONB(`{}`)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := fx.reconciler.ReconcileOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	overview, _ = fx.engine.Overview(user)
	if overview.PermanentBalance != 860 || overview.PermanentFrozen != 0 {
		t.Fatalf("old auto reservation repriced: %+v", overview)
	}
}

func TestVideoReferenceSurchargeUsesGeneratedSeconds(t *testing.T) {
	p := NewCreditPricer(repository.NewMemoryBillingRepository())
	for _, tc := range []struct {
		name, payload string
		want          int64
	}{
		{"no reference", `{"model":"seedance-2.5","resolution":"720p","duration":10}`, 1950},
		{"images and audio unchanged", `{"model":"seedance-2.5","resolution":"720p","duration":10,"content":[{"type":"image_url"},{"type":"audio_url"}],"references":[{"type":"image"}]}`, 1950},
		{"video reference", `{"model":"company::sdvideo/seedance-2.5","resolution":"720p","duration":10,"content":[{"type":"video_url"}]}`, 3300},
		{"multiple refs and duplicated bridge metadata once", `{"model":"seedance-2.5","resolution":"720p","duration":10,"content":[{"type":"video_url","duration":99},{"type":"video_url","duration":3}],"references":[{"type":"video"}]}`, 3300},
		{"output duration changes total", `{"model":"seedance-2.5","resolution":"720p","duration":5,"content":[{"type":"video_url","duration":99}]}`, 1650},
		{"wan reference", `{"model":"sdvideo/wan3.0-video","resolution":"720p","duration":10,"references":[{"type":"video"}]}`, 800},
		{"H3 native video reference", `{"model":"minimax-h3","resolution":"480p","duration":5,"content":[{"type":"video_url"}]}`, 300},
		{"H3 actual multipart image input", `{"model":"zzdh-minimax-h3-限时优惠-多参考图生-480p","resolution_name":"480p","seconds":"5","files":[{"field_name":"input_reference[]","content_type":"image/jpeg"}]}`, 150},
		{"H3 effective resolution", `{"model":"zizi::zzdh-minimax-h3-限时优惠-多参考图生-480p","resolution":"720p","seconds":"10"}`, 300},
		{"H3 768p alias", `{"model":"zzdh-minimax-h3-限时优惠-多参考图生-768p","seconds":"5"}`, 200},
		{"multipart video reference", `{"model":"minimax-h3","resolution_name":"2k","seconds":"5","files":[{"content_type":"video/mp4"}]}`, 600},
	} {
		t.Run(tc.name, func(t *testing.T) {
			credits, _, params, _ := p.QuoteForJob(model.JobTypeVideoGenerate, model.JSONB(tc.payload))
			if credits != tc.want || params["pricing_source"] != "membership_price_sheet" {
				t.Fatalf("got %d %+v, want %d", credits, params, tc.want)
			}
			if params["per_second"].(float64)*float64(params["duration_sec"].(int64)) != float64(credits) {
				t.Fatalf("inconsistent rate/duration snapshot: %+v", params)
			}
		})
	}
}

func TestVideoReferenceQuoteReservationAndSettlement(t *testing.T) {
	fx := newBillingFixture(t)
	const user = "video-price-test"
	if _, err := fx.engine.Adjust(user, 10000, "admin", "test"); err != nil {
		t.Fatal(err)
	}
	payload := `{"model":"seedance-2.5","resolution":"720p","duration":10,"content":[{"type":"video_url"}]}`
	quoted, _, params, _ := fx.pricer.QuoteForJob(model.JobTypeVideoGenerate, model.JSONB(payload))
	if quoted != 3300 || params["base_per_second"] != float64(195) || params["reference_per_second"] != float64(135) || params["per_second"] != float64(330) {
		t.Fatal(quoted, params)
	}
	job := fx.enqueue(t, user, model.JobTypeVideoGenerate, payload)
	overview, _ := fx.engine.Overview(user)
	if overview.PermanentFrozen != quoted {
		t.Fatalf("frozen != quote: %+v", overview)
	}
	prices := DefaultModelCreditPrices()
	prices.Videos["seedance-2.5"]["720p"][2] = 1.25
	raw, _ := json.Marshal(prices)
	if err := fx.billing.UpsertConfig(model.BillingConfigKeyModelPrices, raw, "admin", time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.jobRepo.SetResult(job.Job.ID, model.JSONB(`{}`)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := fx.reconciler.ReconcileOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	overview, _ = fx.engine.Overview(user)
	if overview.PermanentBalance != 10000-quoted || overview.PermanentFrozen != 0 {
		t.Fatalf("reservation repriced: %+v", overview)
	}
	if err := fx.billing.UpsertConfig(model.BillingConfigKeyActivity, model.JSONB(`{"enabled":true,"discount_bps":5000}`), "admin", time.Now()); err != nil {
		t.Fatal(err)
	}
	credits, _, _, _ := fx.pricer.QuoteForJob(model.JobTypeVideoGenerate, model.JSONB(payload))
	if credits != 982 {
		t.Fatalf("want ceil((195+1.25)*10*0.5)=982, got %d", credits)
	}
}

func TestFractionalModelDiscountRoundsOnce(t *testing.T) {
	billing := repository.NewMemoryBillingRepository()
	if err := billing.UpsertConfig(model.BillingConfigKeyActivity, model.JSONB(`{"enabled":true,"discount_bps":5000}`), "test", time.Now()); err != nil {
		t.Fatal(err)
	}
	credits, _, _, _ := NewCreditPricer(billing).QuoteForJob(model.JobTypeImageGenerate, model.JSONB(`{"model":"gpt-image-1.5","quality":"low","size":"2048x2048","n":2}`))
	if credits != 23 {
		t.Fatalf("got %d, want ceil(22.5*2*0.5)=23", credits)
	}
}
