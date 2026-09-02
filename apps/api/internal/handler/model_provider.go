package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/response"
	"github.com/gin-gonic/gin"
)

const providerModelSeparator = "::"

var errModelProviderCapabilityMismatch = errors.New("selected model provider does not support the requested capability")

type ModelProviderHandler struct {
	repo       repository.ModelProviderRepository
	secretBox  provider.SecretBox
	gateSecret string
}

type modelProviderRequest struct {
	ID                 *string             `json:"id"`
	Name               *string             `json:"name"`
	PresetID           *string             `json:"preset_id"`
	ProviderType       *string             `json:"provider_type"`
	Mode               *string             `json:"mode"`
	BaseURL            *string             `json:"base_url"`
	AuthType           *string             `json:"auth_type"`
	CustomAuthHeader   *string             `json:"custom_auth_header"`
	AuthQueryParam     *string             `json:"auth_query_param"`
	APIKey             *string             `json:"api_key"`
	TextModel          *string             `json:"text_model"`
	ImageModel         *string             `json:"image_model"`
	VideoModel         *string             `json:"video_model"`
	AudioModel         *string             `json:"audio_model"`
	Capabilities       []string            `json:"capabilities"`
	ModelsByCapability map[string][]string `json:"models_by_capability"`
	ModelAliases       map[string]string   `json:"model_aliases"`
	ModelProtocols     map[string]string   `json:"model_protocols"`
	DefaultFor         []string            `json:"default_for"`
	Secrets            map[string]string   `json:"secrets"`
	EndpointOverrides  map[string]string   `json:"endpoint_overrides"`
	ExtraHeaders       map[string]string   `json:"extra_headers"`
	TimeoutMS          *int                `json:"timeout_ms"`
	MaxConcurrency     *int                `json:"max_concurrency"`
	Enabled            *bool               `json:"enabled"`
}

type modelSelection struct {
	Config model.ModelProviderConfig
	APIKey string
	Model  string
}

// BackgroundImageJobResolution contains the transient provider credentials
// needed by the worker message. Callers must never persist TaskKwargs.
type BackgroundImageJobResolution struct {
	Selector   string
	Model      string
	TaskKwargs map[string]any
}

func NewModelProviderHandler(repo repository.ModelProviderRepository, secretBox provider.SecretBox, gateSecrets ...string) *ModelProviderHandler {
	gateSecret := ""
	if len(gateSecrets) > 0 {
		gateSecret = strings.TrimSpace(gateSecrets[0])
	}
	return &ModelProviderHandler{repo: repo, secretBox: secretBox, gateSecret: gateSecret}
}

// ResolveBackgroundImageJob performs provider selection without writing an
// HTTP response, allowing server-side schedulers to reuse the same encrypted
// provider configuration as interactive image generation.
func (h *ModelProviderHandler) ResolveBackgroundImageJob(requestedModel string, jobTypes ...string) (BackgroundImageJobResolution, error) {
	selection, err := h.resolveProviderSelection(model.ModelCapabilityImage, requestedModel)
	if err != nil {
		return BackgroundImageJobResolution{}, err
	}
	if !selection.Config.Enabled {
		return BackgroundImageJobResolution{}, provider.ErrProviderDisabled
	}
	if !supportsCapability(selection.Config, model.ModelCapabilityImage) {
		return BackgroundImageJobResolution{}, errors.New("model provider does not support image generation")
	}
	selection.Model = strings.TrimSpace(selection.Model)
	if selection.Model == "" {
		return BackgroundImageJobResolution{}, errors.New("image model is not configured")
	}
	if err := provider.ValidateProviderConfig(selection.Config); err != nil {
		return BackgroundImageJobResolution{}, err
	}
	apiKey, err := h.secretBox.Decrypt(selection.Config.APIKeyEncrypted)
	if err != nil {
		return BackgroundImageJobResolution{}, errors.New("model provider api key cannot be decrypted")
	}
	apiPath := "/images/generations"
	if len(jobTypes) > 0 && jobTypes[0] == model.JobTypeImageEdit {
		apiPath = "/images/edits"
	}
	return BackgroundImageJobResolution{
		Selector:   encodeProviderModel(selection.Config.ID, selection.Model),
		Model:      selection.Model,
		TaskKwargs: providerJobKwargs(selection.Config, apiKey, selection.Model, apiPath, h.gateSecret),
	}, nil
}

func (h *ModelProviderHandler) Presets(c *gin.Context) {
	response.OK(c, providerPresetsResponse())
}

func (h *ModelProviderHandler) List(c *gin.Context) {
	configs, err := h.normalizedProviders()
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	items := make([]gin.H, 0, len(configs))
	for _, config := range configs {
		items = append(items, modelProviderResponse(config))
	}
	response.OK(c, gin.H{"providers": items})
}

func (h *ModelProviderHandler) Create(c *gin.Context) {
	config := defaultModelProviderConfig()
	config.ID = "provider_" + randomHexString(8)
	var req modelProviderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if req.PresetID != nil {
		config = configFromPreset(strings.TrimSpace(*req.PresetID))
		if config.ID == model.ModelProviderIDDefault || strings.TrimSpace(config.ID) == "" {
			config.ID = "provider_" + randomHexString(8)
		}
	}
	if req.ID != nil && strings.TrimSpace(*req.ID) != "" {
		config.ID = sanitizeProviderID(*req.ID)
	}
	if err := h.applyRequestToConfig(&config, req, true); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if err := validateConfigForSave(&config); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	saved, err := h.repo.UpsertModelProvider(config)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if err := h.enforceDefaultProviderUniqueness(saved); err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, modelProviderResponse(saved))
}

func (h *ModelProviderHandler) GetByID(c *gin.Context) {
	config, err := h.repo.GetModelProvider(c.Param("id"))
	if err != nil {
		writeModelProviderRepoError(c, err)
		return
	}
	normalizeModelProviderDefaults(&config)
	response.OK(c, modelProviderResponse(config))
}

func (h *ModelProviderHandler) PutByID(c *gin.Context) {
	h.putProvider(c, c.Param("id"))
}

func (h *ModelProviderHandler) Delete(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		response.Error(c, http.StatusBadRequest, "provider id is required")
		return
	}
	if id == model.ModelProviderIDDefault {
		response.Error(c, http.StatusBadRequest, "default provider cannot be deleted")
		return
	}
	if err := h.repo.DeleteModelProvider(id); err != nil {
		writeModelProviderRepoError(c, err)
		return
	}
	response.OK(c, gin.H{"deleted": true, "id": id})
}

func (h *ModelProviderHandler) Get(c *gin.Context) {
	config, err := h.repo.GetDefaultModelProvider()
	if err != nil {
		if errors.Is(err, repository.ErrModelProviderNotFound) {
			response.OK(c, gin.H{"configured": false})
			return
		}
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	normalizeModelProviderDefaults(&config)
	response.OK(c, modelProviderResponse(config))
}

func (h *ModelProviderHandler) Put(c *gin.Context) {
	h.putProvider(c, model.ModelProviderIDDefault)
}

func (h *ModelProviderHandler) putProvider(c *gin.Context, id string) {
	current, err := h.repo.GetModelProvider(id)
	if err != nil && !errors.Is(err, repository.ErrModelProviderNotFound) {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if errors.Is(err, repository.ErrModelProviderNotFound) {
		current = defaultModelProviderConfig()
		current.ID = id
	}
	normalizeModelProviderDefaults(&current)

	var req modelProviderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if req.PresetID != nil && strings.TrimSpace(*req.PresetID) != "" {
		presetConfig := configFromPreset(strings.TrimSpace(*req.PresetID))
		presetConfig.ID = current.ID
		presetConfig.APIKeyEncrypted = current.APIKeyEncrypted
		presetConfig.SecretsEncrypted = current.SecretsEncrypted
		presetConfig.ModelAliases = current.ModelAliases
		presetConfig.ModelProtocols = current.ModelProtocols
		current = presetConfig
	}
	if err := h.applyRequestToConfig(&current, req, true); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if err := validateConfigForSave(&current); err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	saved, err := h.repo.UpsertModelProvider(current)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if err := h.enforceDefaultProviderUniqueness(saved); err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, modelProviderResponse(saved))
}

func (h *ModelProviderHandler) Test(c *gin.Context) {
	h.testProvider(c, "")
}

func (h *ModelProviderHandler) TestByID(c *gin.Context) {
	h.testProvider(c, c.Param("id"))
}

func (h *ModelProviderHandler) testProvider(c *gin.Context, id string) {
	config, apiKey, ok := h.loadConfigForRequest(c, id)
	if !ok {
		return
	}
	client, err := provider.NewOpenAICompatibleClient(config, apiKey)
	if err != nil {
		writeProviderError(c, config.BaseURL, err)
		return
	}

	models, modelsErr := client.ListModels(c.Request.Context())
	usingStoredModels := false
	if modelsErr != nil && hasStoredModels(config) {
		models = ModelListFromConfig(config)
		modelsErr = nil
		usingStoredModels = true
	}
	textOK := false
	var text provider.TextResponse
	var textErr error
	textTested := supportsCapability(config, model.ModelCapabilityText) && strings.TrimSpace(config.TextModel) != ""
	if textTested {
		text, textErr = client.GenerateText(c.Request.Context(), "ping", config.TextModel)
		textOK = textErr == nil
	}
	if modelsErr != nil || textErr != nil {
		result := gin.H{
			"ok":              false,
			"models_ok":       modelsErr == nil,
			"docker_hint":     provider.DockerLocalhostHint(config.BaseURL),
			"provider_config": sanitizedProviderSummary(config),
		}
		if textTested {
			result["text_ok"] = textOK
		}
		if modelsErr != nil {
			result["models_error"] = modelsErr.Error()
		}
		if textErr != nil {
			result["text_error"] = textErr.Error()
		}
		response.ErrorWithData(c, http.StatusBadGateway, "model provider test failed", result)
		return
	}

	extra := gin.H{
		"ok":              true,
		"models_ok":       true,
		"provider_config": sanitizedProviderSummary(config),
	}
	if textTested {
		extra["text_ok"] = textOK
		extra["text"] = text.Text
		extra["model"] = text.Model
	}
	if usingStoredModels {
		response.OK(c, storedModelsResponse(config, extra))
		return
	}
	response.OK(c, modelsResponse(config, models.Models, extra))
}

func (h *ModelProviderHandler) Models(c *gin.Context) {
	h.modelsForProvider(c, "")
}

func (h *ModelProviderHandler) ModelsByID(c *gin.Context) {
	h.modelsForProvider(c, c.Param("id"))
}

func (h *ModelProviderHandler) modelsForProvider(c *gin.Context, id string) {
	config, apiKey, ok := h.loadConfigForRequest(c, id)
	if !ok {
		return
	}
	if strings.TrimSpace(config.BaseURL) == "" && hasStoredModels(config) {
		response.OK(c, storedModelsResponse(config, nil))
		return
	}
	client, err := provider.NewOpenAICompatibleClient(config, apiKey)
	if err != nil {
		writeProviderError(c, config.BaseURL, err)
		return
	}
	models, err := client.ListModels(c.Request.Context())
	if err != nil {
		if hasStoredModels(config) {
			response.OK(c, storedModelsResponse(config, gin.H{"models_error": err.Error()}))
			return
		}
		writeProviderError(c, config.BaseURL, err)
		return
	}
	response.OK(c, modelsResponse(config, models.Models, nil))
}

func (h *ModelProviderHandler) LoadClient(c *gin.Context) (*provider.OpenAICompatibleClient, model.ModelProviderConfig, bool) {
	selection, ok := h.loadConfigForUse(c, model.ModelCapabilityText, "")
	if !ok {
		return nil, model.ModelProviderConfig{}, false
	}
	client, err := provider.NewOpenAICompatibleClient(selection.Config, selection.APIKey)
	if err != nil {
		writeProviderError(c, selection.Config.BaseURL, err)
		return nil, model.ModelProviderConfig{}, false
	}
	return client, selection.Config, true
}

func (h *ModelProviderHandler) LoadClientForModel(c *gin.Context, capability string, requestedModel string) (*provider.OpenAICompatibleClient, model.ModelProviderConfig, string, bool) {
	selection, ok := h.loadConfigForUse(c, capability, requestedModel)
	if !ok {
		return nil, model.ModelProviderConfig{}, "", false
	}
	client, err := provider.NewOpenAICompatibleClient(selection.Config, selection.APIKey)
	if err != nil {
		writeProviderError(c, selection.Config.BaseURL, err)
		return nil, model.ModelProviderConfig{}, "", false
	}
	return client, selection.Config, selection.Model, true
}

func (h *ModelProviderHandler) LoadConfigForModel(c *gin.Context, capability string, requestedModel string) (model.ModelProviderConfig, string, string, bool) {
	selection, ok := h.loadConfigForUse(c, capability, requestedModel)
	if !ok {
		return model.ModelProviderConfig{}, "", "", false
	}
	return selection.Config, selection.APIKey, selection.Model, true
}

func (h *ModelProviderHandler) loadConfigForUse(c *gin.Context, capability string, requestedModel string) (modelSelection, bool) {
	selection, err := h.resolveProviderSelection(capability, requestedModel)
	if err != nil {
		if errors.Is(err, repository.ErrModelProviderNotFound) {
			response.Error(c, http.StatusBadRequest, provider.ErrProviderNotConfigured.Error())
			return modelSelection{}, false
		}
		if errors.Is(err, errModelProviderCapabilityMismatch) {
			response.Error(c, http.StatusBadRequest, err.Error())
			return modelSelection{}, false
		}
		response.Error(c, http.StatusInternalServerError, err.Error())
		return modelSelection{}, false
	}
	if !selection.Config.Enabled {
		response.Error(c, http.StatusBadRequest, provider.ErrProviderDisabled.Error())
		return modelSelection{}, false
	}
	apiKey, err := h.secretBox.Decrypt(selection.Config.APIKeyEncrypted)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, "model provider api key cannot be decrypted")
		return modelSelection{}, false
	}
	selection.APIKey = apiKey
	return selection, true
}

func (h *ModelProviderHandler) loadConfigForRequest(c *gin.Context, id string) (model.ModelProviderConfig, string, bool) {
	config, err := h.configForRequestBase(id)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return model.ModelProviderConfig{}, "", false
	}
	req, hasBody, err := decodeOptionalModelProviderRequest(c)
	if err != nil {
		response.Error(c, http.StatusBadRequest, err.Error())
		return model.ModelProviderConfig{}, "", false
	}
	if hasBody {
		if req.PresetID != nil && strings.TrimSpace(*req.PresetID) != "" {
			presetConfig := configFromPreset(strings.TrimSpace(*req.PresetID))
			presetConfig.ID = config.ID
			presetConfig.APIKeyEncrypted = config.APIKeyEncrypted
			presetConfig.SecretsEncrypted = config.SecretsEncrypted
			presetConfig.ModelAliases = config.ModelAliases
			presetConfig.ModelProtocols = config.ModelProtocols
			config = presetConfig
		}
		if err := h.applyRequestToConfig(&config, req, false); err != nil {
			response.Error(c, http.StatusBadRequest, err.Error())
			return model.ModelProviderConfig{}, "", false
		}
	}
	if !config.Enabled {
		response.Error(c, http.StatusBadRequest, provider.ErrProviderDisabled.Error())
		return model.ModelProviderConfig{}, "", false
	}
	normalizeModelProviderDefaults(&config)
	if err := provider.ValidateProviderConfig(config); err != nil {
		writeProviderError(c, config.BaseURL, err)
		return model.ModelProviderConfig{}, "", false
	}
	apiKey, err := h.secretBox.Decrypt(config.APIKeyEncrypted)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, "model provider api key cannot be decrypted")
		return model.ModelProviderConfig{}, "", false
	}
	return config, apiKey, true
}

func (h *ModelProviderHandler) configForRequestBase(id string) (model.ModelProviderConfig, error) {
	if strings.TrimSpace(id) == "" {
		id = model.ModelProviderIDDefault
	}
	config, err := h.repo.GetModelProvider(id)
	if err != nil {
		if errors.Is(err, repository.ErrModelProviderNotFound) {
			config = defaultModelProviderConfig()
			config.ID = id
			return config, nil
		}
		return model.ModelProviderConfig{}, err
	}
	normalizeModelProviderDefaults(&config)
	return config, nil
}

func decodeOptionalModelProviderRequest(c *gin.Context) (modelProviderRequest, bool, error) {
	var req modelProviderRequest
	if c.Request.Body == nil || c.Request.ContentLength == 0 {
		return req, false, nil
	}
	if err := json.NewDecoder(c.Request.Body).Decode(&req); err != nil {
		if errors.Is(err, io.EOF) {
			return req, false, nil
		}
		return req, false, err
	}
	return req, true, nil
}

func defaultModelProviderConfig() model.ModelProviderConfig {
	config := model.ModelProviderConfig{
		ID:             model.ModelProviderIDDefault,
		Name:           "默认兼容 Provider",
		PresetID:       "openai_compatible_custom",
		ProviderType:   model.ModelProviderTypeOpenAICompatible,
		Mode:           model.ModelProviderModeLocalOpenAI,
		AuthType:       model.ModelProviderAuthTypeNone,
		TimeoutMS:      model.ModelProviderDefaultTimeoutMilli,
		MaxConcurrency: model.ModelProviderDefaultMaxConcurrency,
		Enabled:        true,
	}
	normalizeModelProviderDefaults(&config)
	return config
}

func configFromPreset(presetID string) model.ModelProviderConfig {
	for _, preset := range modelProviderPresets() {
		if preset.ID != presetID {
			continue
		}
		config := model.ModelProviderConfig{
			ID:                 model.ModelProviderIDDefault,
			Name:               preset.Name,
			PresetID:           preset.ID,
			ProviderType:       preset.ProviderType,
			Mode:               preset.Mode,
			BaseURL:            strings.TrimRight(strings.TrimSpace(preset.BaseURL), "/"),
			AuthType:           preset.AuthType,
			CustomAuthHeader:   preset.CustomAuthHeader,
			AuthQueryParam:     preset.AuthQueryParam,
			TextModel:          preset.Defaults[model.ModelCapabilityText],
			ImageModel:         preset.Defaults[model.ModelCapabilityImage],
			VideoModel:         preset.Defaults[model.ModelCapabilityVideo],
			AudioModel:         preset.Defaults[model.ModelCapabilityAudio],
			Capabilities:       mustProviderJSONB(preset.Capabilities),
			ModelsByCapability: mustProviderJSONB(preset.ModelsByCapability),
			DefaultFor:         mustProviderJSONB([]string{}),
			EndpointOverrides:  mustProviderJSONB(preset.EndpointOverrides),
			ExtraHeaders:       mustProviderJSONB(preset.ExtraHeaders),
			TimeoutMS:          model.ModelProviderDefaultTimeoutMilli,
			MaxConcurrency:     model.ModelProviderDefaultMaxConcurrency,
			Enabled:            true,
		}
		normalizeModelProviderDefaults(&config)
		return config
	}
	return defaultModelProviderConfig()
}

func (h *ModelProviderHandler) applyRequestToConfig(config *model.ModelProviderConfig, req modelProviderRequest, clearEmptyKey bool) error {
	if req.Name != nil {
		config.Name = strings.TrimSpace(*req.Name)
	}
	if req.PresetID != nil {
		config.PresetID = strings.TrimSpace(*req.PresetID)
	}
	if req.ProviderType != nil {
		config.ProviderType = strings.TrimSpace(*req.ProviderType)
	}
	if req.Mode != nil {
		config.Mode = strings.TrimSpace(*req.Mode)
	}
	if req.BaseURL != nil {
		config.BaseURL = strings.TrimRight(strings.TrimSpace(*req.BaseURL), "/")
	}
	if req.AuthType != nil {
		config.AuthType = strings.TrimSpace(*req.AuthType)
	}
	if req.CustomAuthHeader != nil {
		config.CustomAuthHeader = strings.TrimSpace(*req.CustomAuthHeader)
	}
	if req.AuthQueryParam != nil {
		config.AuthQueryParam = strings.TrimSpace(*req.AuthQueryParam)
	}
	if req.TextModel != nil {
		config.TextModel = strings.TrimSpace(*req.TextModel)
	}
	if req.ImageModel != nil {
		config.ImageModel = strings.TrimSpace(*req.ImageModel)
	}
	if req.VideoModel != nil {
		config.VideoModel = strings.TrimSpace(*req.VideoModel)
	}
	if req.AudioModel != nil {
		config.AudioModel = strings.TrimSpace(*req.AudioModel)
	}
	if req.Capabilities != nil {
		config.Capabilities = mustProviderJSONB(normalizeCapabilities(req.Capabilities))
	}
	if req.ModelsByCapability != nil {
		config.ModelsByCapability = mustProviderJSONB(normalizeModelsByCapability(req.ModelsByCapability))
	}
	if req.ModelAliases != nil {
		config.ModelAliases = mustProviderJSONB(normalizeStringMap(req.ModelAliases))
	}
	if req.ModelProtocols != nil {
		config.ModelProtocols = mustProviderJSONB(normalizeModelProtocols(req.ModelProtocols))
	}
	if req.DefaultFor != nil {
		config.DefaultFor = mustProviderJSONB(normalizeCapabilities(req.DefaultFor))
	}
	if req.EndpointOverrides != nil {
		config.EndpointOverrides = mustProviderJSONB(normalizeStringMap(req.EndpointOverrides))
	}
	if req.ExtraHeaders != nil {
		config.ExtraHeaders = mustProviderJSONB(normalizeStringMap(req.ExtraHeaders))
	}
	if req.TimeoutMS != nil {
		config.TimeoutMS = clampTimeout(*req.TimeoutMS)
	}
	if req.MaxConcurrency != nil {
		config.MaxConcurrency = clampProviderConcurrency(*req.MaxConcurrency)
	}
	if req.Enabled != nil {
		config.Enabled = *req.Enabled
	}
	if req.APIKey != nil {
		apiKey := strings.TrimSpace(*req.APIKey)
		if apiKey == "" {
			if clearEmptyKey {
				config.APIKeyEncrypted = ""
			}
		} else {
			encrypted, err := h.secretBox.Encrypt(apiKey)
			if err != nil {
				return err
			}
			config.APIKeyEncrypted = encrypted
		}
	}
	if req.Secrets != nil {
		current := jsonStringMapFromJSONB(config.SecretsEncrypted)
		for key, value := range req.Secrets {
			key = strings.TrimSpace(key)
			value = strings.TrimSpace(value)
			if key == "" {
				continue
			}
			if value == "" {
				if clearEmptyKey {
					delete(current, key)
				}
				continue
			}
			encrypted, err := h.secretBox.Encrypt(value)
			if err != nil {
				return err
			}
			current[key] = encrypted
		}
		config.SecretsEncrypted = mustProviderJSONB(current)
	}
	normalizeModelProviderDefaults(config)
	return nil
}

func modelProviderResponse(config model.ModelProviderConfig) gin.H {
	normalizeModelProviderDefaults(&config)
	return gin.H{
		"configured":           true,
		"id":                   config.ID,
		"name":                 config.Name,
		"preset_id":            config.PresetID,
		"provider_type":        config.ProviderType,
		"mode":                 config.Mode,
		"base_url":             config.BaseURL,
		"auth_type":            config.AuthType,
		"custom_auth_header":   config.CustomAuthHeader,
		"auth_query_param":     config.AuthQueryParam,
		"api_key_set":          config.APIKeyEncrypted != "",
		"api_key_configured":   config.APIKeyEncrypted != "",
		"secrets_set":          secretStatus(config.SecretsEncrypted),
		"text_model":           config.TextModel,
		"image_model":          config.ImageModel,
		"video_model":          config.VideoModel,
		"audio_model":          config.AudioModel,
		"capabilities":         capabilitiesFromConfig(config),
		"models_by_capability": modelsByCapabilityFromConfig(config),
		"model_aliases":        modelAliasesFromConfig(config),
		"model_protocols":      modelProtocolsFromConfig(config),
		"default_for":          defaultForFromConfig(config),
		"endpoint_overrides":   jsonStringMapFromJSONB(config.EndpointOverrides),
		"extra_headers":        jsonStringMapFromJSONB(config.ExtraHeaders),
		"timeout_ms":           config.TimeoutMS,
		"max_concurrency":      config.MaxConcurrency,
		"enabled":              config.Enabled,
		"created_at":           config.CreatedAt,
		"updated_at":           config.UpdatedAt,
	}
}

func sanitizedProviderSummary(config model.ModelProviderConfig) gin.H {
	normalizeModelProviderDefaults(&config)
	return gin.H{
		"id":            config.ID,
		"name":          config.Name,
		"preset_id":     config.PresetID,
		"provider_type": config.ProviderType,
		"mode":          config.Mode,
		"auth_type":     config.AuthType,
		"auth_header":   provider.AuthHeaderName(config.AuthType),
		"text_model":    config.TextModel,
		"image_model":   config.ImageModel,
		"video_model":   config.VideoModel,
		"audio_model":   config.AudioModel,
		"timeout_ms":    config.TimeoutMS,
		"enabled":       config.Enabled,
		"api_key_set":   config.APIKeyEncrypted != "",
		"secrets_set":   secretStatus(config.SecretsEncrypted),
	}
}

func modelsResponse(config model.ModelProviderConfig, models []string, extra gin.H) gin.H {
	normalizeModelProviderDefaults(&config)
	byCapability := mergeDetectedModels(map[string][]string{}, models)
	return modelsResponseWithCapabilities(config, uniqueStrings(models), byCapability, extra)
}

func storedModelsResponse(config model.ModelProviderConfig, extra gin.H) gin.H {
	normalizeModelProviderDefaults(&config)
	return modelsResponseWithCapabilities(config, ModelListFromConfig(config).Models, modelsByCapabilityFromConfig(config), extra)
}

func modelsResponseWithCapabilities(config model.ModelProviderConfig, models []string, byCapability map[string][]string, extra gin.H) gin.H {
	textModels := modelsWithSupportedDefault(config, model.ModelCapabilityText, byCapability[model.ModelCapabilityText])
	imageModels := modelsWithSupportedDefault(config, model.ModelCapabilityImage, byCapability[model.ModelCapabilityImage])
	videoModels := modelsWithSupportedDefault(config, model.ModelCapabilityVideo, byCapability[model.ModelCapabilityVideo])
	audioModels := modelsWithSupportedDefault(config, model.ModelCapabilityAudio, byCapability[model.ModelCapabilityAudio])
	result := gin.H{
		"models":              uniqueStrings(models),
		"text_models":         uniqueStrings(textModels),
		"image_models":        uniqueStrings(imageModels),
		"video_models":        uniqueStrings(videoModels),
		"audio_models":        uniqueStrings(audioModels),
		"default_text_model":  supportedDefaultModel(config, model.ModelCapabilityText),
		"default_image_model": supportedDefaultModel(config, model.ModelCapabilityImage),
		"default_video_model": supportedDefaultModel(config, model.ModelCapabilityVideo),
		"default_audio_model": supportedDefaultModel(config, model.ModelCapabilityAudio),
		"provider_config":     sanitizedProviderSummary(config),
	}
	for key, value := range extra {
		result[key] = value
	}
	return result
}

func modelsWithSupportedDefault(config model.ModelProviderConfig, capability string, models []string) []string {
	if !supportsCapability(config, capability) {
		return uniqueStrings(models)
	}
	return modelsWithDefault(models, defaultModelForCapability(config, capability))
}

func supportedDefaultModel(config model.ModelProviderConfig, capability string) string {
	if !supportsCapability(config, capability) {
		return ""
	}
	return defaultModelForCapability(config, capability)
}

func (h *ModelProviderHandler) AggregatedModels(c *gin.Context) {
	configs, err := h.normalizedProviders()
	if err != nil {
		response.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, aggregateModelProviders(configs))
}

func (h *ModelProviderHandler) normalizedProviders() ([]model.ModelProviderConfig, error) {
	configs, err := h.repo.ListModelProviders()
	if err != nil {
		return nil, err
	}
	if len(configs) == 0 {
		config, err := h.repo.GetDefaultModelProvider()
		if err != nil {
			if errors.Is(err, repository.ErrModelProviderNotFound) {
				return []model.ModelProviderConfig{}, nil
			}
			return nil, err
		}
		configs = append(configs, config)
	}
	for index := range configs {
		normalizeModelProviderDefaults(&configs[index])
	}
	return configs, nil
}

func aggregateModelProviders(configs []model.ModelProviderConfig) gin.H {
	all := make([]string, 0)
	byCapability := map[string][]string{
		model.ModelCapabilityText:  {},
		model.ModelCapabilityImage: {},
		model.ModelCapabilityVideo: {},
		model.ModelCapabilityAudio: {},
	}
	defaults := make(map[string]string)
	modelLabels := make(map[string]string)
	modelProviderNames := make(map[string]string)
	agentTextModels := make([]string, 0)
	for _, config := range configs {
		if !config.Enabled {
			continue
		}
		normalizeModelProviderDefaults(&config)
		modelsByCap := modelsByCapabilityFromConfig(config)
		modelAliases := modelAliasesFromConfig(config)
		for _, capability := range capabilitiesFromConfig(config) {
			models := modelsByCap[capability]
			for _, modelID := range models {
				encoded := encodeProviderModel(config.ID, modelID)
				all = append(all, encoded)
				byCapability[capability] = append(byCapability[capability], encoded)
				if capability == model.ModelCapabilityText && supportsAgentToolCalls(config) {
					agentTextModels = append(agentTextModels, encoded)
				}
				modelProviderNames[encoded] = config.Name
				if alias := modelAliases[modelID]; alias != "" {
					modelLabels[encoded] = alias
				}
			}
		}
		for _, capability := range defaultForFromConfig(config) {
			if defaults[capability] != "" {
				continue
			}
			if modelID := defaultModelForCapability(config, capability); modelID != "" {
				defaults[capability] = encodeProviderModel(config.ID, modelID)
			}
		}
	}
	return gin.H{
		"models":               uniqueStrings(all),
		"text_models":          uniqueStrings(byCapability[model.ModelCapabilityText]),
		"agent_text_models":    uniqueStrings(agentTextModels),
		"image_models":         uniqueStrings(byCapability[model.ModelCapabilityImage]),
		"video_models":         uniqueStrings(byCapability[model.ModelCapabilityVideo]),
		"audio_models":         uniqueStrings(byCapability[model.ModelCapabilityAudio]),
		"default_text_model":   defaults[model.ModelCapabilityText],
		"default_image_model":  defaults[model.ModelCapabilityImage],
		"default_video_model":  defaults[model.ModelCapabilityVideo],
		"default_audio_model":  defaults[model.ModelCapabilityAudio],
		"model_labels":         modelLabels,
		"model_provider_names": modelProviderNames,
	}
}

func supportsAgentToolCalls(config model.ModelProviderConfig) bool {
	parsed, err := url.Parse(strings.TrimSpace(config.BaseURL))
	if err != nil {
		return true
	}
	path := strings.ToLower(strings.TrimRight(parsed.Path, "/"))
	if strings.Contains(path, "/openai") {
		return true
	}
	host := strings.ToLower(parsed.Hostname())
	if strings.Contains(host, "generativelanguage.googleapis.com") {
		return false
	}
	return config.AuthType != model.ModelProviderAuthTypeXGoogAPIKey || (!strings.HasSuffix(path, "/v1") && !strings.HasSuffix(path, "/v1beta"))
}

func (h *ModelProviderHandler) resolveProviderSelection(capability string, requestedModel string) (modelSelection, error) {
	capability = normalizeCapability(capability)
	providerID, modelID := decodeProviderModel(requestedModel)
	if providerID != "" {
		config, err := h.repo.GetModelProvider(providerID)
		if err != nil {
			return modelSelection{}, err
		}
		normalizeModelProviderDefaults(&config)
		if !supportsCapability(config, capability) {
			return modelSelection{}, fmt.Errorf("%w: %s", errModelProviderCapabilityMismatch, capability)
		}
		if modelID == "" {
			modelID = defaultModelForCapability(config, capability)
		}
		return modelSelection{Config: config, Model: modelID}, nil
	}
	configs, err := h.normalizedProviders()
	if err != nil {
		return modelSelection{}, err
	}
	if len(configs) == 0 {
		return modelSelection{}, repository.ErrModelProviderNotFound
	}
	for _, config := range configs {
		if !config.Enabled || !supportsCapability(config, capability) {
			continue
		}
		if containsString(defaultForFromConfig(config), capability) {
			modelID = strings.TrimSpace(requestedModel)
			if modelID == "" {
				modelID = defaultModelForCapability(config, capability)
			}
			return modelSelection{Config: config, Model: modelID}, nil
		}
	}
	for _, config := range configs {
		if !config.Enabled || !supportsCapability(config, capability) {
			continue
		}
		modelID = strings.TrimSpace(requestedModel)
		if modelID == "" {
			modelID = defaultModelForCapability(config, capability)
		}
		return modelSelection{Config: config, Model: modelID}, nil
	}
	return modelSelection{}, repository.ErrModelProviderNotFound
}

func (h *ModelProviderHandler) enforceDefaultProviderUniqueness(saved model.ModelProviderConfig) error {
	defaultFor := defaultForFromConfig(saved)
	if len(defaultFor) == 0 {
		return nil
	}
	configs, err := h.repo.ListModelProviders()
	if err != nil {
		return err
	}
	changedCaps := make(map[string]bool)
	for _, capability := range defaultFor {
		changedCaps[capability] = true
	}
	for _, config := range configs {
		if config.ID == saved.ID {
			continue
		}
		current := defaultForFromConfig(config)
		next := make([]string, 0, len(current))
		changed := false
		for _, capability := range current {
			if changedCaps[capability] {
				changed = true
				continue
			}
			next = append(next, capability)
		}
		if !changed {
			continue
		}
		config.DefaultFor = mustProviderJSONB(next)
		if _, err := h.repo.UpsertModelProvider(config); err != nil {
			return err
		}
	}
	return nil
}

func validateConfigForSave(config *model.ModelProviderConfig) error {
	normalizeModelProviderDefaults(config)
	if provider.AuthRequiresAPIKey(config.AuthType) && config.APIKeyEncrypted == "" {
		return errors.New("api_key is required when auth_type requires a key")
	}
	if strings.TrimSpace(config.TextModel) == "" && strings.TrimSpace(config.ImageModel) == "" && strings.TrimSpace(config.VideoModel) == "" && strings.TrimSpace(config.AudioModel) == "" && !hasStoredModels(*config) {
		return errors.New("at least one model or models_by_capability entry is required")
	}
	for modelID, protocol := range modelProtocolsFromConfig(*config) {
		if !isSupportedImageProtocol(protocol) {
			return fmt.Errorf("unsupported image protocol %q for model %q", protocol, modelID)
		}
	}
	return provider.ValidateProviderConfig(*config)
}

func normalizeModelProviderDefaults(config *model.ModelProviderConfig) {
	if strings.TrimSpace(config.ID) == "" {
		config.ID = model.ModelProviderIDDefault
	}
	if strings.TrimSpace(config.Name) == "" {
		if config.ID == model.ModelProviderIDDefault {
			config.Name = "默认兼容 Provider"
		} else {
			config.Name = config.ID
		}
	}
	if strings.TrimSpace(config.ProviderType) == "" {
		config.ProviderType = model.ModelProviderTypeOpenAICompatible
	}
	if strings.TrimSpace(config.Mode) == "" {
		config.Mode = model.ModelProviderModeOpenAICompatible
	}
	if strings.TrimSpace(config.AuthType) == "" {
		config.AuthType = model.ModelProviderAuthTypeNone
	}
	if config.TimeoutMS <= 0 {
		config.TimeoutMS = model.ModelProviderDefaultTimeoutMilli
	}
	config.MaxConcurrency = clampProviderConcurrency(config.MaxConcurrency)
	if len(config.Capabilities) == 0 || string(config.Capabilities) == "{}" {
		config.Capabilities = mustProviderJSONB(inferCapabilities(*config))
	}
	if len(config.ModelsByCapability) == 0 || string(config.ModelsByCapability) == "{}" {
		config.ModelsByCapability = mustProviderJSONB(inferModelsByCapability(*config))
	}
	if len(config.ModelAliases) == 0 {
		config.ModelAliases = mustProviderJSONB(map[string]string{})
	} else {
		config.ModelAliases = mustProviderJSONB(modelAliasesFromConfig(*config))
	}
	if len(config.ModelProtocols) == 0 {
		config.ModelProtocols = mustProviderJSONB(map[string]string{})
	} else {
		config.ModelProtocols = mustProviderJSONB(normalizeModelProtocols(modelProtocolsFromConfig(*config)))
	}
	capabilities := capabilitiesFromConfig(*config)
	if len(capabilities) == 0 {
		capabilities = inferCapabilities(*config)
	}
	modelsByCapability := modelsByCapabilityFromConfig(*config)
	if len(modelsByCapability) == 0 {
		modelsByCapability = inferModelsByCapability(*config)
	}
	consistentModels := make(map[string][]string, len(capabilities))
	for _, capability := range capabilities {
		consistentModels[capability] = modelsWithDefault(modelsByCapability[capability], defaultModelForCapability(*config, capability))
	}
	config.Capabilities = mustProviderJSONB(capabilities)
	config.ModelsByCapability = mustProviderJSONB(consistentModels)
	defaultFor := defaultForFromConfig(*config)
	if len(defaultFor) == 0 {
		if config.ID == model.ModelProviderIDDefault {
			defaultFor = inferDefaultFor(*config)
		}
	}
	defaultFor = defaultForWithConfiguredModel(model.ModelProviderConfig{
		ID:                 config.ID,
		Name:               config.Name,
		ProviderType:       config.ProviderType,
		Mode:               config.Mode,
		AuthType:           config.AuthType,
		BaseURL:            config.BaseURL,
		TimeoutMS:          config.TimeoutMS,
		MaxConcurrency:     config.MaxConcurrency,
		Capabilities:       config.Capabilities,
		ModelsByCapability: config.ModelsByCapability,
		TextModel:          config.TextModel,
		ImageModel:         config.ImageModel,
		VideoModel:         config.VideoModel,
		AudioModel:         config.AudioModel,
		DefaultFor:         mustProviderJSONB(defaultFor),
		APIKeyEncrypted:    config.APIKeyEncrypted,
		SecretsEncrypted:   config.SecretsEncrypted,
		EndpointOverrides:  config.EndpointOverrides,
		ExtraHeaders:       config.ExtraHeaders,
		ModelAliases:       config.ModelAliases,
		ModelProtocols:     config.ModelProtocols,
		Enabled:            config.Enabled,
	})
	config.DefaultFor = mustProviderJSONB(defaultFor)
	if len(config.SecretsEncrypted) == 0 {
		config.SecretsEncrypted = mustProviderJSONB(map[string]string{})
	}
	if len(config.EndpointOverrides) == 0 {
		config.EndpointOverrides = mustProviderJSONB(map[string]string{})
	}
	if len(config.ExtraHeaders) == 0 {
		config.ExtraHeaders = mustProviderJSONB(map[string]string{})
	}
}

func clampTimeout(timeoutMS int) int {
	if timeoutMS < model.ModelProviderMinTimeoutMilli {
		return model.ModelProviderMinTimeoutMilli
	}
	if timeoutMS > model.ModelProviderMaxTimeoutMilli {
		return model.ModelProviderMaxTimeoutMilli
	}
	return timeoutMS
}

func clampProviderConcurrency(value int) int {
	if value == 0 {
		return model.ModelProviderDefaultMaxConcurrency
	}
	if value < model.ModelProviderMinConcurrency {
		return model.ModelProviderMinConcurrency
	}
	if value > model.ModelProviderMaxConcurrency {
		return model.ModelProviderMaxConcurrency
	}
	return value
}

func writeProviderError(c *gin.Context, baseURL string, err error) {
	errorInfo := describeProviderError(baseURL, err)
	status := errorInfo.HTTPStatus
	if errors.Is(err, provider.ErrProviderNotConfigured) || errors.Is(err, provider.ErrProviderDisabled) || errors.Is(err, provider.ErrUnsupportedImageUpload) {
		status = http.StatusBadRequest
	}
	var providerHTTPError *provider.ProviderHTTPError
	if errors.As(err, &providerHTTPError) {
		log.Printf(
			"request_id=%s operation=%s provider_method=%s provider_url=%s provider_status=%d provider_error=%q",
			response.RequestID(c),
			c.FullPath(),
			providerHTTPError.Method,
			providerHTTPError.SafeURL(),
			providerHTTPError.StatusCode,
			providerHTTPError.BodySnippet(2000),
		)
	} else {
		log.Printf("request_id=%s operation=%s provider_error=%v", response.RequestID(c), c.FullPath(), err)
	}

	data := gin.H{
		"reason":     errorInfo.Reason,
		"suggestion": errorInfo.Suggestion,
	}
	if errorInfo.ProviderStatus > 0 {
		data["provider_status"] = errorInfo.ProviderStatus
	}
	if errorInfo.RetryAfterSec > 0 {
		data["retry_after"] = errorInfo.RetryAfterSec
	}
	if hint := provider.DockerLocalhostHint(baseURL); hint != "" {
		data["docker_hint"] = hint
	}
	response.ErrorWithData(c, status, readableErrorMessage(errorInfo), data)
}

func readableErrorMessage(info providerErrorInfo) string {
	parts := make([]string, 0, 3)
	if strings.TrimSpace(info.Message) != "" {
		parts = append(parts, strings.TrimSpace(info.Message))
	}
	if strings.TrimSpace(info.Reason) != "" {
		parts = append(parts, strings.TrimSpace(info.Reason))
	}
	if strings.TrimSpace(info.Suggestion) != "" {
		parts = append(parts, strings.TrimSpace(info.Suggestion))
	}
	if len(parts) == 0 {
		return "模型服务暂不可用，请稍后重试"
	}
	return strings.Join(parts, "。")
}

func writeModelProviderRepoError(c *gin.Context, err error) {
	if errors.Is(err, repository.ErrModelProviderNotFound) {
		response.Error(c, http.StatusNotFound, err.Error())
		return
	}
	response.Error(c, http.StatusInternalServerError, err.Error())
}

func ModelListFromConfig(config model.ModelProviderConfig) provider.ModelListResponse {
	normalizeModelProviderDefaults(&config)
	models := make([]string, 0)
	for _, list := range modelsByCapabilityFromConfig(config) {
		models = append(models, list...)
	}
	return provider.ModelListResponse{Models: uniqueStrings(models)}
}

func mergeDetectedModels(byCapability map[string][]string, models []string) map[string][]string {
	next := make(map[string][]string)
	for key, value := range byCapability {
		next[key] = append([]string{}, value...)
	}
	for _, capability := range []string{model.ModelCapabilityText, model.ModelCapabilityImage, model.ModelCapabilityVideo, model.ModelCapabilityAudio} {
		for _, item := range filterModelsByCapability(models, capability) {
			next[capability] = append(next[capability], item)
		}
	}
	for key, value := range next {
		next[key] = uniqueStrings(value)
	}
	return next
}

func filterModelsByCapability(models []string, capability string) []string {
	filtered := make([]string, 0)
	for _, item := range models {
		name := strings.ToLower(strings.TrimSpace(item))
		if name == "" {
			continue
		}
		switch capability {
		case model.ModelCapabilityVideo:
			if isVideoModelName(name) {
				filtered = append(filtered, item)
			}
		case model.ModelCapabilityAudio:
			if isSpeechSynthesisModelName(name) {
				filtered = append(filtered, item)
			}
		case model.ModelCapabilityImage:
			if isImageModelName(name) {
				filtered = append(filtered, item)
			}
		case model.ModelCapabilityText:
			if !isVideoModelName(name) && !isImageModelName(name) && !isSpeechSynthesisModelName(name) {
				filtered = append(filtered, item)
			}
		}
	}
	return filtered
}

func isVideoModelName(name string) bool {
	return strings.Contains(name, "seedance") || strings.Contains(name, "video") || strings.Contains(name, "sora") || strings.Contains(name, "veo") || strings.Contains(name, "kling") || strings.Contains(name, "wan") || strings.Contains(name, "hailuo") || strings.Contains(name, "happyhorse") || strings.Contains(name, "happy-horse") || strings.Contains(name, "omni")
}

func isSpeechSynthesisModelName(name string) bool {
	return strings.Contains(name, "tts") || strings.Contains(name, "speech") || strings.Contains(name, "voice")
}

func isImageModelName(name string) bool {
	return !isVideoModelName(name) && !isSpeechSynthesisModelName(name) && (strings.Contains(name, "seedream") || strings.Contains(name, "gpt-image") || strings.Contains(name, "image") || strings.Contains(name, "dall-e") || strings.Contains(name, "dalle") || strings.Contains(name, "imagen") || strings.Contains(name, "flux") || strings.Contains(name, "sdxl") || strings.Contains(name, "stable-diffusion") || strings.Contains(name, "midjourney") || strings.Contains(name, "mj") || strings.Contains(name, "banana") || strings.Contains(name, "grok"))
}

func modelsWithDefault(models []string, defaultModel string) []string {
	defaultModel = strings.TrimSpace(defaultModel)
	if defaultModel == "" {
		return uniqueStrings(models)
	}
	result := []string{defaultModel}
	for _, modelID := range uniqueStrings(models) {
		if modelID != defaultModel {
			result = append(result, modelID)
		}
	}
	return result
}

func imageModelsWithDefault(models []string, defaultImageModel string) []string {
	return modelsWithDefault(filterModelsByCapability(models, model.ModelCapabilityImage), defaultImageModel)
}

func capabilitiesFromConfig(config model.ModelProviderConfig) []string {
	var value []string
	if err := json.Unmarshal(config.Capabilities, &value); err != nil {
		return inferCapabilities(config)
	}
	return normalizeCapabilities(value)
}

func modelsByCapabilityFromConfig(config model.ModelProviderConfig) map[string][]string {
	var value map[string][]string
	if err := json.Unmarshal(config.ModelsByCapability, &value); err != nil {
		return inferModelsByCapability(config)
	}
	return normalizeModelsByCapability(value)
}

func modelAliasesFromConfig(config model.ModelProviderConfig) map[string]string {
	return jsonStringMapFromJSONB(config.ModelAliases)
}

func modelProtocolsFromConfig(config model.ModelProviderConfig) map[string]string {
	return jsonStringMapFromJSONB(config.ModelProtocols)
}

func normalizeModelProtocols(value map[string]string) map[string]string {
	result := make(map[string]string)
	for modelID, protocol := range value {
		modelID = strings.TrimSpace(modelID)
		protocol = strings.ToLower(strings.TrimSpace(protocol))
		if modelID == "" || protocol == "" || protocol == model.ImageProtocolAuto {
			continue
		}
		result[modelID] = protocol
	}
	return result
}

func isSupportedImageProtocol(protocol string) bool {
	switch strings.ToLower(strings.TrimSpace(protocol)) {
	case model.ImageProtocolAuto,
		model.ImageProtocolOpenAIImages,
		model.ImageProtocolOpenAIResponses,
		model.ImageProtocolOpenAIChatCompletions,
		model.ImageProtocolGeminiGenerateContent,
		model.ImageProtocolDashScopeMultimodal,
		model.ImageProtocolStabilityImage:
		return true
	default:
		return false
	}
}

func resolveImageProtocol(config model.ModelProviderConfig, modelID string) string {
	if protocol := strings.ToLower(strings.TrimSpace(modelProtocolsFromConfig(config)[strings.TrimSpace(modelID)])); protocol != "" && protocol != model.ImageProtocolAuto {
		return protocol
	}
	providerType := strings.ToLower(strings.TrimSpace(config.ProviderType))
	baseURL := strings.ToLower(strings.TrimSpace(config.BaseURL))
	normalizedModel := strings.ToLower(strings.TrimSpace(modelID))
	overrides := jsonStringMapFromJSONB(config.EndpointOverrides)
	for _, endpoint := range []string{overrides["image_generation"], overrides["image_edit"]} {
		endpoint = strings.ToLower(strings.TrimSpace(endpoint))
		if strings.Contains(endpoint, "chat/completions") {
			return model.ImageProtocolOpenAIChatCompletions
		}
		if strings.Contains(endpoint, "/responses") || strings.Trim(endpoint, "/") == "responses" {
			return model.ImageProtocolOpenAIResponses
		}
	}
	if providerType == model.ModelProviderTypeGeminiMedia || strings.Contains(baseURL, "generativelanguage.googleapis.com") {
		return model.ImageProtocolGeminiGenerateContent
	}
	if strings.Contains(baseURL, "dashscope.aliyuncs.com") || strings.Contains(baseURL, "dashscope-intl.aliyuncs.com") {
		return model.ImageProtocolDashScopeMultimodal
	}
	if strings.Contains(baseURL, "api.stability.ai") {
		return model.ImageProtocolStabilityImage
	}
	if strings.Contains(normalizedModel, "gemini") || strings.Contains(normalizedModel, "banana") {
		return model.ImageProtocolOpenAIChatCompletions
	}
	if (strings.HasPrefix(normalizedModel, "gpt-4") || strings.HasPrefix(normalizedModel, "gpt-5") || strings.HasPrefix(normalizedModel, "o3") || strings.HasPrefix(normalizedModel, "o4")) && !strings.Contains(normalizedModel, "image") {
		return model.ImageProtocolOpenAIResponses
	}
	return model.ImageProtocolOpenAIImages
}
func defaultForFromConfig(config model.ModelProviderConfig) []string {
	var value []string
	if err := json.Unmarshal(config.DefaultFor, &value); err != nil {
		return []string{}
	}
	return normalizeCapabilities(value)
}

func inferCapabilities(config model.ModelProviderConfig) []string {
	capabilities := make([]string, 0, 4)
	if strings.TrimSpace(config.TextModel) != "" {
		capabilities = append(capabilities, model.ModelCapabilityText)
	}
	if strings.TrimSpace(config.ImageModel) != "" {
		capabilities = append(capabilities, model.ModelCapabilityImage)
	}
	if strings.TrimSpace(config.VideoModel) != "" {
		capabilities = append(capabilities, model.ModelCapabilityVideo)
	}
	if strings.TrimSpace(config.AudioModel) != "" {
		capabilities = append(capabilities, model.ModelCapabilityAudio)
	}
	return uniqueStrings(capabilities)
}

func inferDefaultFor(config model.ModelProviderConfig) []string {
	defaultFor := make([]string, 0, 4)
	for _, capability := range []string{model.ModelCapabilityText, model.ModelCapabilityImage, model.ModelCapabilityVideo, model.ModelCapabilityAudio} {
		if defaultModelForCapability(config, capability) != "" {
			defaultFor = append(defaultFor, capability)
		}
	}
	return defaultFor
}

func defaultForWithConfiguredModel(config model.ModelProviderConfig) []string {
	defaultFor := make([]string, 0, 4)
	for _, capability := range defaultForFromConfig(config) {
		if supportsCapability(config, capability) && defaultModelForCapability(config, capability) != "" {
			defaultFor = append(defaultFor, capability)
		}
	}
	return defaultFor
}

func inferModelsByCapability(config model.ModelProviderConfig) map[string][]string {
	result := make(map[string][]string)
	if modelID := strings.TrimSpace(config.TextModel); modelID != "" {
		result[model.ModelCapabilityText] = []string{modelID}
	}
	if modelID := strings.TrimSpace(config.ImageModel); modelID != "" {
		result[model.ModelCapabilityImage] = []string{modelID}
	}
	if modelID := strings.TrimSpace(config.VideoModel); modelID != "" {
		result[model.ModelCapabilityVideo] = []string{modelID}
	}
	if modelID := strings.TrimSpace(config.AudioModel); modelID != "" {
		result[model.ModelCapabilityAudio] = []string{modelID}
	}
	return result
}

func defaultModelForCapability(config model.ModelProviderConfig, capability string) string {
	switch normalizeCapability(capability) {
	case model.ModelCapabilityText:
		return strings.TrimSpace(config.TextModel)
	case model.ModelCapabilityImage:
		return strings.TrimSpace(config.ImageModel)
	case model.ModelCapabilityVideo:
		return strings.TrimSpace(config.VideoModel)
	case model.ModelCapabilityAudio:
		return strings.TrimSpace(config.AudioModel)
	default:
		return ""
	}
}

func supportsCapability(config model.ModelProviderConfig, capability string) bool {
	return containsString(capabilitiesFromConfig(config), normalizeCapability(capability))
}

func hasStoredModels(config model.ModelProviderConfig) bool {
	for _, models := range modelsByCapabilityFromConfig(config) {
		if len(models) > 0 {
			return true
		}
	}
	return false
}

func normalizeCapabilities(value []string) []string {
	result := make([]string, 0, len(value))
	for _, item := range value {
		capability := normalizeCapability(item)
		if capability != "" {
			result = append(result, capability)
		}
	}
	return uniqueStrings(result)
}

func normalizeCapability(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case model.ModelCapabilityText:
		return model.ModelCapabilityText
	case model.ModelCapabilityImage:
		return model.ModelCapabilityImage
	case model.ModelCapabilityVideo:
		return model.ModelCapabilityVideo
	case model.ModelCapabilityAudio:
		return model.ModelCapabilityAudio
	default:
		return ""
	}
}

func normalizeModelsByCapability(value map[string][]string) map[string][]string {
	result := make(map[string][]string)
	for key, models := range value {
		capability := normalizeCapability(key)
		if capability == "" {
			continue
		}
		result[capability] = uniqueStrings(models)
	}
	return result
}

func normalizeStringMap(value map[string]string) map[string]string {
	result := make(map[string]string)
	for key, item := range value {
		key = strings.TrimSpace(key)
		item = strings.TrimSpace(item)
		if key != "" && item != "" {
			result[key] = item
		}
	}
	return result
}

func jsonStringMapFromJSONB(raw model.JSONB) map[string]string {
	result := make(map[string]string)
	if len(raw) == 0 {
		return result
	}
	var values map[string]string
	if err := json.Unmarshal(raw, &values); err != nil {
		return result
	}
	return normalizeStringMap(values)
}

func secretStatus(raw model.JSONB) map[string]bool {
	status := make(map[string]bool)
	for key, value := range jsonStringMapFromJSONB(raw) {
		status[key] = strings.TrimSpace(value) != ""
	}
	return status
}

func mustProviderJSONB(value any) model.JSONB {
	data, err := json.Marshal(value)
	if err != nil {
		return model.JSONB("{}")
	}
	return model.JSONB(data)
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]bool)
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func containsString(values []string, expected string) bool {
	expected = strings.TrimSpace(expected)
	for _, value := range values {
		if strings.TrimSpace(value) == expected {
			return true
		}
	}
	return false
}

func encodeProviderModel(providerID string, modelID string) string {
	providerID = strings.TrimSpace(providerID)
	modelID = strings.TrimSpace(modelID)
	if providerID == "" || modelID == "" {
		return modelID
	}
	return providerID + providerModelSeparator + modelID
}

func decodeProviderModel(value string) (string, string) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", ""
	}
	index := strings.Index(value, providerModelSeparator)
	if index < 0 {
		return "", value
	}
	return strings.TrimSpace(value[:index]), strings.TrimSpace(value[index+len(providerModelSeparator):])
}

func sanitizeProviderID(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "provider_" + randomHexString(8)
	}
	replacer := strings.NewReplacer(" ", "-", "_", "-", "/", "-", "\\", "-", ":", "-")
	return strings.Trim(replacer.Replace(value), "-")
}
