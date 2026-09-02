package handler

import (
	"context"
	"errors"
	"strings"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
)

// GenerateBackgroundText reuses the same provider selector and encrypted
// credentials as /api/ai/text without persisting plaintext provider secrets in
// comic analysis or prompt revision records.
func (h *ModelProviderHandler) GenerateBackgroundText(ctx context.Context, requestedModel string, request provider.TextGenerationRequest) (provider.TextResponse, error) {
	selection, err := h.resolveProviderSelection(model.ModelCapabilityText, requestedModel)
	if err != nil {
		return provider.TextResponse{}, err
	}
	if !selection.Config.Enabled {
		return provider.TextResponse{}, provider.ErrProviderDisabled
	}
	if !supportsCapability(selection.Config, model.ModelCapabilityText) {
		return provider.TextResponse{}, errors.New("model provider does not support text generation")
	}
	selection.Model = strings.TrimSpace(selection.Model)
	if selection.Model == "" {
		return provider.TextResponse{}, provider.ErrTextModelNotConfigured
	}
	if err := provider.ValidateProviderConfig(selection.Config); err != nil {
		return provider.TextResponse{}, err
	}
	apiKey, err := h.secretBox.Decrypt(selection.Config.APIKeyEncrypted)
	if err != nil {
		return provider.TextResponse{}, errors.New("model provider api key cannot be decrypted")
	}
	client, err := provider.NewOpenAICompatibleClient(selection.Config, apiKey)
	if err != nil {
		return provider.TextResponse{}, err
	}
	request.Model = selection.Model
	request.Stream = false
	parallel := false
	request.ParallelToolCalls = &parallel
	return client.GenerateTextRequest(ctx, request)
}
