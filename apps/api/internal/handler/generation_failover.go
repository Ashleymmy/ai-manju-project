package handler

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/response"
	"github.com/gin-gonic/gin"
)

// Shared user-facing failure: upstream hostnames, bodies and switching stay private.
var errGenerationUnavailable = errors.New("当前模型暂时不可用，请稍后重试")

func generateTextWithCandidates(ctx context.Context, candidates []modelSelection, req provider.TextGenerationRequest) (provider.TextResponse, model.ModelProviderConfig, error) {
	var last model.ModelProviderConfig
	for _, candidate := range candidates {
		// Agent requests must retain tool support when changing suppliers.
		if len(req.Tools) > 0 && !supportsAgentToolCalls(candidate.Config) {
			continue
		}
		last = candidate.Config
		last.TimeoutMS = max(last.TimeoutMS, int(model.GenerationTextRequestTimeout.Milliseconds()))
		req.Model = candidate.Model
		for attempt := 0; attempt < model.GenerationAttemptsPerProvider; attempt++ {
			if err := ctx.Err(); err != nil {
				return provider.TextResponse{}, last, err
			}
			client, err := provider.NewOpenAICompatibleClient(last, candidate.APIKey)
			if err != nil {
				continue
			}
			result, err := client.GenerateTextRequest(ctx, req)
			if err == nil {
				return result, last, nil
			}
		}
	}
	return provider.TextResponse{}, last, errGenerationUnavailable
}

// LoadGenerationCandidates keeps the existing selection/auth semantics. Additional
// candidates must explicitly advertise the same model and capability; aliases do
// not identify interchangeable models. Secrets travel only in queue kwargs.
func (h *ModelProviderHandler) LoadGenerationCandidates(c *gin.Context, capability, requestedModel string) ([]modelSelection, bool) {
	candidates, err := h.generationCandidates(capability, requestedModel)
	if err != nil {
		response.Error(c, http.StatusBadRequest, errGenerationUnavailable.Error())
		return nil, false
	}
	return candidates, true
}

// Shared by HTTP handlers and background comic workflows.
func (h *ModelProviderHandler) generationCandidates(capability, requestedModel string) ([]modelSelection, error) {
	first, selectionErr := h.resolveProviderSelection(capability, requestedModel)
	configs, err := h.normalizedProviders()
	if err != nil {
		return nil, errGenerationUnavailable
	}
	_, modelID := decodeProviderModel(requestedModel)
	if selectionErr == nil {
		modelID = first.Model
	}
	// Stable order is shared by Memory and Gorm repositories; preserve the
	// selected supplier first, including older provider-qualified canvas values.
	sort.SliceStable(configs, func(i, j int) bool { return configs[i].ID < configs[j].ID })
	ordered := make([]modelSelection, 0, len(configs))
	if selectionErr == nil && first.Config.Enabled {
		ordered = append(ordered, first)
	}
	for _, config := range configs {
		if (selectionErr == nil && config.ID == first.Config.ID) || !config.Enabled || !supportsCapability(config, capability) ||
			modelID == "" || !containsString(modelsByCapabilityFromConfig(config)[capability], modelID) {
			continue
		}
		ordered = append(ordered, modelSelection{Config: config, Model: modelID})
	}
	result := make([]modelSelection, 0, len(ordered))
	for _, candidate := range ordered {
		key, err := h.secretBox.Decrypt(candidate.Config.APIKeyEncrypted)
		if err != nil {
			continue
		}
		candidate.APIKey = key
		result = append(result, candidate)
	}
	if len(result) == 0 {
		return nil, errGenerationUnavailable
	}
	return result, nil
}

func (h *AIHandler) generationJobKwargs(candidates []modelSelection, operation string) map[string]any {
	return h.providerHandler.generationJobKwargs(candidates, operation)
}

func (h *ModelProviderHandler) generationJobKwargs(candidates []modelSelection, operation string) map[string]any {
	providers := make([]map[string]any, 0, len(candidates))
	longest := model.GenerationMediaRequestTimeout
	for _, candidate := range candidates {
		var kwargs map[string]any
		if operation == "native_video" {
			kwargs = providerJobKwargs(candidate.Config, candidate.APIKey, candidate.Model, "/contents/generations/tasks", h.gateSecret)
		} else if operation == "video" {
			kwargs = providerJobKwargs(candidate.Config, candidate.APIKey, candidate.Model, "/videos", h.gateSecret)
		} else {
			kwargs = imageProviderJobKwargs(candidate.Config, candidate.APIKey, candidate.Model, operation, h.gateSecret)
		}
		config := kwargs["provider"].(map[string]any)
		if operation == "video" || operation == "native_video" {
			overrides := config["endpoint_overrides"].(map[string]string)
			prefix := "/videos/"
			if operation == "native_video" {
				prefix = "/contents/generations/tasks/"
			}
			if overrides["video_get"] == "" {
				overrides["video_get"] = providerJobEndpoint(candidate.Config.BaseURL, prefix+"{id}")
			}
			if overrides["video_content"] == "" {
				overrides["video_content"] = providerJobEndpoint(candidate.Config.BaseURL, prefix+"{id}/content")
			}
		}
		timeout := max(model.GenerationMediaRequestTimeout, time.Duration(candidate.Config.TimeoutMS)*time.Millisecond)
		config["timeout_ms"] = timeout.Milliseconds()
		longest = max(longest, timeout)
		providers = append(providers, config)
	}
	softLimit := longest + model.GenerationPersistenceTimeout
	if operation == "video" || operation == "native_video" {
		// Video submission, polling and downloading each need their own budget.
		softLimit += 2 * longest
	}
	return map[string]any{
		"provider":                        providers[0],
		"provider_candidates":             providers,
		"generation_soft_timeout_seconds": int(softLimit.Seconds()),
	}
}

func removeGenerationPrivateFields(payload map[string]any) {
	for key := range payload {
		if key == "provider" || strings.HasPrefix(key, "provider_candidates") || key == "generation_soft_timeout_seconds" {
			delete(payload, key)
		}
	}
}
