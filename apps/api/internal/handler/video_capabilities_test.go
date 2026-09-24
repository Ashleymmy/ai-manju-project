package handler

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/service"
)

func TestVideoCapabilitiesRejectInvalidOptions(t *testing.T) {
	for _, tc := range []struct {
		name, model, payload string
		invalid              bool
	}{
		{"GJ mini 1080p", "seedance-2.0-mini", `{"ratio":"1:1","resolution":"1080p","duration":5}`, true},
		{"mini square 720p", "seedance-2.0-mini", `{"ratio":"1:1","resolution":"720p","duration":5}`, false},
		{"fast 1080p", "doubao-seedance-2-0-fast-260128", `{"resolution":"1080p"}`, true},
		{"2.5 1080p stays available", "doubao-seedance-2-5-260628", `{"resolution":"1080p","duration":30}`, false},
		{"2.0 duration", "doubao-seedance-2-0-260128", `{"duration":30}`, true},
		{"Wan ratio", "yike-wan3.0-video", `{"ratio":"21:9"}`, true},
		{"Wan mixed frame reference", "yike-wan3.0-video", `{"content":[{"type":"image_url","role":"first_frame"},{"type":"video_url"}]}`, true},
		{"Wan frames", "yike-wan3.0-video", `{"content":[{"type":"image_url","role":"first_frame"},{"type":"image_url","role":"last_frame"}]}`, false},
		{"H3 fixed resolution", "zzdh-minimax-h3-限时优惠-多参考图生-480p", `{"resolution_name":"720p","seconds":"5"}`, true},
		{"H3 no video references", "zzdh-minimax-h3-限时优惠-多参考图生-768p", `{"files":[{"content_type":"video/mp4"}]}`, true},
		{"H3 duration", "zzdh-minimax-h3-限时优惠-多参考图生-768p", `{"seconds":"16"}`, true},
		{"H3 audio", "zzdh-minimax-h3-限时优惠-多参考图生-768p", `{"generate_audio":true}`, true},
		{"unknown endpoint not inferred", "ep-unknown", `{"duration":99}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var body map[string]any
			if err := json.Unmarshal([]byte(tc.payload), &body); err != nil {
				t.Fatal(err)
			}
			if err := catalogVideoCapabilities(tc.model).validate(body); (err != nil) != tc.invalid {
				t.Fatalf("invalid=%v err=%v", tc.invalid, err)
			}
		})
	}
}

func TestVideoCapabilitiesUseExplicitEndpointFamilyAndPreserveH3Variant(t *testing.T) {
	billing := repository.NewMemoryBillingRepository()
	if err := billing.UpsertConfig(model.BillingConfigKeyModelAliases, model.JSONB(`{"ep-mini":"seedance-2.0-mini","ep-long":"seedance-2.5"}`), "test", time.Now()); err != nil {
		t.Fatal(err)
	}
	resolve := service.NewCreditPricer(billing).ResolveModelFamily
	config := model.ModelProviderConfig{ID: "mt", Enabled: true, ProviderType: model.ModelProviderTypeVolcengineArk,
		Capabilities: model.JSONB(`["video"]`), ModelsByCapability: model.JSONB(`{"video":["ep-mini","ep-long","zzdh-minimax-h3-限时优惠-多参考图生-480p"]}`),
		ModelAliases: model.JSONB(`{"ep-mini":"arbitrary renamed label"}`)}
	data := aggregateModelProviders([]model.ModelProviderConfig{config}, resolve)
	caps := data["video_model_capabilities"].(map[string]videoModelCapabilities)
	if err := caps["mt::ep-mini"].validate(map[string]any{"resolution": "1080p"}); err == nil {
		t.Fatal("mapped Mini accepts 1080p")
	}
	if err := caps["mt::ep-long"].validate(map[string]any{"duration": 31}); err == nil {
		t.Fatal("mapped 2.5 accepts 31 seconds")
	}
	if caps["mt::zzdh-minimax-h3-限时优惠-多参考图生-480p"].Resolutions[0] != "480p" {
		t.Fatal("H3 lost resolution-bound model identity")
	}
}
