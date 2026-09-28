package handler

import (
	"context"
	"errors"
	"strings"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/service"
)

// SetBackgroundUserRepository enables current-account checks for durable work.
func (h *ModelProviderHandler) SetBackgroundUserRepository(users repository.UserRepository) {
	h.users = users
}

func (h *ModelProviderHandler) backgroundUser(userID string) (model.User, error) {
	if h.users == nil || strings.TrimSpace(userID) == "" {
		return model.User{}, repository.ErrModelProviderAccessDenied
	}
	user, err := h.users.GetUser(userID)
	if err != nil || user.Status == model.UserStatusDisabled {
		return model.User{}, repository.ErrModelProviderAccessDenied
	}
	return user, nil
}

// GenerateBackgroundText retains public-only behavior for callers without an
// actor. Production comic workflows use GenerateBackgroundTextForUser instead.
func (h *ModelProviderHandler) GenerateBackgroundText(ctx context.Context, requestedModel string, request provider.TextGenerationRequest) (provider.TextResponse, error) {
	return h.generateBackgroundText(ctx, model.User{}, requestedModel, request)
}

func (h *ModelProviderHandler) GenerateBackgroundTextForUser(ctx context.Context, userID, requestedModel string, request provider.TextGenerationRequest) (provider.TextResponse, error) {
	user, err := h.backgroundUser(userID)
	if err != nil {
		return provider.TextResponse{}, err
	}
	return h.generateBackgroundText(ctx, user, requestedModel, request)
}

func (h *ModelProviderHandler) generateBackgroundText(ctx context.Context, user model.User, requestedModel string, request provider.TextGenerationRequest) (provider.TextResponse, error) {
	candidates, err := h.forUser(user).generationCandidates(model.ModelCapabilityText, requestedModel)
	if err != nil {
		return provider.TextResponse{}, err
	}
	request.Stream = false
	parallel := false
	request.ParallelToolCalls = &parallel
	result, _, err := generateTextWithCandidates(ctx, candidates, request)
	if errors.Is(err, errGenerationSubmissionUncertain) {
		return result, service.ErrComicTextSubmissionUncertain
	}
	if err != nil {
		// Comic handlers render service errors directly. Never expose the wrapped
		// upstream diagnostics retained for interactive request monitoring.
		return result, service.ErrComicTextProvider
	}
	return result, nil
}
