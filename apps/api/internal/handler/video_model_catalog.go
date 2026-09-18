package handler

import (
	"strings"

	"github.com/ai-manju/api/internal/model"
)

const (
	// Public protocol hints select the Studio request shape, never credentials.
	videoCatalogProtocolSeedance = "seedance"
	videoCatalogProtocolOpenAI   = "openai"
)

func catalogVideoProtocol(config model.ModelProviderConfig, modelID string) string {
	// Ark endpoint IDs are opaque: ep-* does not identify the underlying model.
	if config.ProviderType == model.ModelProviderTypeVolcengineArk {
		return videoCatalogProtocolSeedance
	}
	name := strings.ToLower(modelID)
	if strings.Contains(name, "seedance") || strings.Contains(name, "wan3") {
		return videoCatalogProtocolSeedance
	}
	return videoCatalogProtocolOpenAI
}
