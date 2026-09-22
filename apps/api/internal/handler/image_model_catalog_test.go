package handler

import (
	"testing"

	"github.com/ai-manju/api/internal/model"
)

func TestImageModelCatalogPreservesProviderSpecificProtocol(t *testing.T) {
	configs := []model.ModelProviderConfig{}
	for _, id := range []string{"auto", "override"} {
		config := model.ModelProviderConfig{
			ID: id, Name: id, Enabled: true, ProviderType: model.ModelProviderTypeOpenAICompatible,
			Capabilities:       mustProviderJSONB([]string{"image"}),
			ModelsByCapability: mustProviderJSONB(map[string][]string{"image": {"gemini-3-pro-image", "gpt-image-2"}}),
		}
		if id == "override" {
			config.ModelProtocols = mustProviderJSONB(map[string]string{"gemini-3-pro-image": model.ImageProtocolOpenAIImages})
		}
		configs = append(configs, config)
	}
	protocols := aggregateModelProviders(configs)["image_model_protocols"].(map[string]string)
	for selector, expected := range map[string]string{
		"auto::gemini-3-pro-image":     model.ImageProtocolOpenAIChatCompletions,
		"override::gemini-3-pro-image": model.ImageProtocolOpenAIImages,
		"auto::gpt-image-2":            model.ImageProtocolOpenAIImages,
	} {
		if protocols[selector] != expected {
			t.Fatalf("%s: got %s, want %s", selector, protocols[selector], expected)
		}
	}
}
