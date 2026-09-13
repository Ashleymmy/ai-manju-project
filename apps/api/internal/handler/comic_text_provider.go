package handler

import (
	"context"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
)

// GenerateBackgroundText shares same-model retries with interactive text requests.
func (h *ModelProviderHandler) GenerateBackgroundText(ctx context.Context, requestedModel string, request provider.TextGenerationRequest) (provider.TextResponse, error) {
	candidates, err := h.generationCandidates(model.ModelCapabilityText, requestedModel)
	if err != nil {
		return provider.TextResponse{}, err
	}
	request.Stream = false
	parallel := false
	request.ParallelToolCalls = &parallel
	result, _, err := generateTextWithCandidates(ctx, candidates, request)
	return result, err
}
