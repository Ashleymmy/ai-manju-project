package handler

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/ai-manju/api/internal/model"
)

func TestVideoModelCatalogUsesProviderProtocolForOpaqueEndpoint(t *testing.T) {
	router, repo := newProviderTestRouter(t, "secret")
	for _, item := range []struct{ id, providerType string }{
		{"official", model.ModelProviderTypeVolcengineArk},
		{"other", model.ModelProviderTypeOpenAICompatible},
	} {
		_, err := repo.UpsertModelProvider(model.ModelProviderConfig{
			ID: item.id, Name: item.id, ProviderType: item.providerType,
			Mode: model.ModelProviderModeOpenAICompatible, BaseURL: "https://example.invalid",
			AuthType: model.ModelProviderAuthTypeNone, Enabled: true,
			Capabilities:       mustProviderJSONB([]string{model.ModelCapabilityVideo}),
			ModelsByCapability: mustProviderJSONB(map[string][]string{"video": {"ep-test"}}),
			ModelAliases:       mustProviderJSONB(map[string]string{"ep-test": "Seedance 2.5"}),
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	out := performJSON(router, http.MethodGet, "/api/ai/models", "", loginCookie(t, router, "member", "secret"))
	if out.Code != http.StatusOK {
		t.Fatalf("catalog status=%d", out.Code)
	}
	var result struct {
		Data struct {
			Protocols map[string]string `json:"video_model_protocols"`
			Labels    map[string]string `json:"model_labels"`
		} `json:"data"`
	}
	if err := json.Unmarshal(out.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Data.Protocols["official::ep-test"] != videoCatalogProtocolSeedance || result.Data.Protocols["other::ep-test"] != videoCatalogProtocolOpenAI {
		t.Fatalf("protocols=%v", result.Data.Protocols)
	}
	if result.Data.Labels["official::ep-test"] != "Seedance 2.5" {
		t.Fatalf("labels=%v", result.Data.Labels)
	}
}
