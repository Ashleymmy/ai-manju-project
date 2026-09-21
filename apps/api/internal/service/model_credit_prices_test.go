package service

import (
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
		`{"model":"seedance-2.5","duration":5,"resolution":"720p","content":[{"type":"video_url"}]}`,
		`{"model":"seedance-2.0","duration":-1,"resolution":"720p"}`,
	} {
		_, _, params, _ := p.QuoteForJob(model.JobTypeVideoGenerate, model.JSONB(payload))
		if params["pricing_source"] == "membership_price_sheet" {
			t.Fatal(params)
		}
	}
	_, _, params, _ := p.QuoteForJob(model.JobTypeImageGenerate, model.JSONB(`{"model":"gpt-image-2.5-flare","size":"auto","quality":"auto"}`))
	if params["range_min"] != int64(5) || params["range_max"] != int64(1030) {
		t.Fatal(params)
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
