package providerpresetmigration

import (
	"encoding/json"
	"reflect"
	"sort"
	"strings"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/service"
)

// ProviderUpdate describes one provider row that needs a safe preset migration.
type ProviderUpdate struct {
	ID      string
	Before  model.ModelProviderConfig
	After   model.ModelProviderConfig
	Changes []string
}

// Result summarizes a dry-run or applied provider preset migration.
type Result struct {
	Scanned int
	Updated int
	Updates []ProviderUpdate
}

// Apply updates provider rows through the repository. It only writes rows whose
// migrated shape differs from the current shape, so a second run is a no-op.
func Apply(repo repository.ModelProviderRepository) (Result, error) {
	configs, err := repo.ListModelProviders()
	if err != nil {
		return Result{}, err
	}
	result := Plan(configs)
	for _, update := range result.Updates {
		if _, err := repo.UpsertModelProvider(update.After); err != nil {
			return result, err
		}
	}
	return result, nil
}

// Plan computes the idempotent updates required for the multi-provider preset
// schema without mutating the input slice.
func Plan(configs []model.ModelProviderConfig) Result {
	next := make([]model.ModelProviderConfig, len(configs))
	changes := make([][]string, len(configs))
	for index, config := range configs {
		next[index] = cloneProvider(config)
		changes[index] = normalizeProvider(&next[index])
	}
	assignMissingDefaults(next, changes)

	result := Result{Scanned: len(configs)}
	for index := range configs {
		if providerSemanticallyEqual(configs[index], next[index]) {
			continue
		}
		updateChanges := uniqueStrings(changes[index])
		sort.Strings(updateChanges)
		result.Updates = append(result.Updates, ProviderUpdate{
			ID:      next[index].ID,
			Before:  cloneProvider(configs[index]),
			After:   cloneProvider(next[index]),
			Changes: updateChanges,
		})
	}
	result.Updated = len(result.Updates)
	return result
}

func normalizeProvider(config *model.ModelProviderConfig) []string {
	changes := make([]string, 0)
	if strings.TrimSpace(config.ID) == "" {
		config.ID = model.ModelProviderIDDefault
		changes = append(changes, "id")
	}
	if strings.TrimSpace(config.Name) == "" {
		config.Name = defaultProviderName(config.ID)
		changes = append(changes, "name")
	}
	if strings.TrimSpace(config.PresetID) == "" {
		config.PresetID = inferPresetID(*config)
		changes = append(changes, "preset_id")
	}
	if strings.TrimSpace(config.ProviderType) == "" {
		config.ProviderType = inferProviderType(*config)
		changes = append(changes, "provider_type")
	}
	if strings.TrimSpace(config.Mode) == "" {
		config.Mode = model.ModelProviderModeOpenAICompatible
		changes = append(changes, "mode")
	}
	if strings.TrimSpace(config.AuthType) == "" {
		if strings.TrimSpace(config.APIKeyEncrypted) != "" {
			config.AuthType = model.ModelProviderAuthTypeBearer
		} else {
			config.AuthType = model.ModelProviderAuthTypeNone
		}
		changes = append(changes, "auth_type")
	}
	if config.TimeoutMS <= 0 {
		config.TimeoutMS = model.ModelProviderDefaultTimeoutMilli
		changes = append(changes, "timeout_ms")
	}
	if isEmptyJSON(config.Capabilities) {
		config.Capabilities = jsonb(inferCapabilities(*config))
		changes = append(changes, "capabilities")
	}
	if isEmptyJSON(config.ModelsByCapability) {
		config.ModelsByCapability = jsonb(inferModelsByCapability(*config))
		changes = append(changes, "models_by_capability")
	}
	if isEmptyJSON(config.SecretsEncrypted) {
		config.SecretsEncrypted = jsonb(map[string]string{})
		changes = append(changes, "secrets_encrypted")
	}
	endpointOverrides := stringMapFromJSONB(config.EndpointOverrides)
	if isSeedanceProvider(*config) {
		for key, value := range seedanceMigrationEndpointOverrides(*config) {
			if strings.TrimSpace(endpointOverrides[key]) != "" {
				continue
			}
			endpointOverrides[key] = value
			changes = append(changes, "endpoint_overrides."+key)
		}
		config.EndpointOverrides = jsonb(endpointOverrides)
	} else if isEmptyJSON(config.EndpointOverrides) {
		config.EndpointOverrides = jsonb(map[string]string{})
		changes = append(changes, "endpoint_overrides")
	}
	if isEmptyJSON(config.ExtraHeaders) {
		config.ExtraHeaders = jsonb(map[string]string{})
		changes = append(changes, "extra_headers")
	}
	return changes
}

func assignMissingDefaults(configs []model.ModelProviderConfig, changes [][]string) {
	hasDefault := make(map[string]bool)
	for _, config := range configs {
		for _, capability := range normalizeCapabilities(stringSliceFromJSONB(config.DefaultFor)) {
			hasDefault[capability] = true
		}
	}
	for _, capability := range []string{model.ModelCapabilityText, model.ModelCapabilityImage, model.ModelCapabilityVideo, model.ModelCapabilityAudio} {
		if hasDefault[capability] {
			continue
		}
		for index := range configs {
			if strings.TrimSpace(defaultModelForCapability(configs[index], capability)) == "" {
				continue
			}
			current := normalizeCapabilities(stringSliceFromJSONB(configs[index].DefaultFor))
			if containsString(current, capability) {
				hasDefault[capability] = true
				break
			}
			current = append(current, capability)
			configs[index].DefaultFor = jsonb(uniqueStrings(current))
			changes[index] = append(changes[index], "default_for."+capability)
			hasDefault[capability] = true
			break
		}
	}
	for index := range configs {
		if isEmptyJSON(configs[index].DefaultFor) {
			configs[index].DefaultFor = jsonb([]string{})
			changes[index] = append(changes[index], "default_for")
		}
	}
}

func inferPresetID(config model.ModelProviderConfig) string {
	value := providerFingerprint(config)
	switch {
	case strings.Contains(value, "seedance"):
		return "volcengine_seedance"
	case strings.Contains(value, "seedream"):
		return "volcengine_seedream"
	case strings.Contains(value, "kling"):
		return "kling_video"
	case strings.Contains(value, "hailuo") || strings.Contains(value, "minimax"):
		return "minimax_hailuo"
	case strings.Contains(value, "happyhorse") || strings.Contains(value, "happy-horse"):
		return "fal_happyhorse"
	case strings.Contains(value, "grok"):
		return "xai_grok"
	case strings.Contains(value, "midjourney") || strings.Contains(value, "mj"):
		return "mj_openai_proxy"
	case strings.Contains(value, "gemini") || strings.Contains(value, "veo") || strings.Contains(value, "banana"):
		return "gemini_media"
	case strings.Contains(value, "gpt-image") || strings.Contains(value, "dall-e") || strings.Contains(value, "dalle"):
		return "openai_image"
	default:
		return "openai_compatible_custom"
	}
}

func inferProviderType(config model.ModelProviderConfig) string {
	value := providerFingerprint(config)
	switch {
	case strings.Contains(value, "seedance") || strings.Contains(value, "seedream"):
		return model.ModelProviderTypeVolcengineArk
	case strings.Contains(value, "gemini") || strings.Contains(value, "veo") || strings.Contains(value, "banana"):
		return model.ModelProviderTypeGeminiMedia
	case strings.Contains(value, "kling"):
		return model.ModelProviderTypeKlingVideo
	case strings.Contains(value, "hailuo") || strings.Contains(value, "minimax"):
		return model.ModelProviderTypeMinimaxHailuo
	case strings.Contains(value, "happyhorse") || strings.Contains(value, "happy-horse"):
		return model.ModelProviderTypeFalHappyHorse
	case strings.Contains(value, "grok"):
		return model.ModelProviderTypeXAIImagine
	default:
		return model.ModelProviderTypeOpenAICompatible
	}
}

func isSeedanceProvider(config model.ModelProviderConfig) bool {
	return strings.TrimSpace(config.PresetID) == "volcengine_seedance" ||
		strings.TrimSpace(config.ProviderType) == model.ModelProviderTypeVolcengineArk && strings.Contains(providerFingerprint(config), "seedance") ||
		strings.Contains(strings.ToLower(strings.TrimSpace(config.VideoModel)), "seedance")
}

func seedanceMigrationEndpointOverrides(config model.ModelProviderConfig) map[string]string {
	overrides := map[string]string{
		"video_create":      "/contents/generations/tasks",
		"video_get":         "/contents/generations/tasks/{id}",
		"material_base_url": "https://api.tokenspace.net.cn/api/material",
		"material_create_visual_validate_session": "?Action=CreateVisualValidateSession",
		"material_get_visual_validate_result":     "?Action=GetVisualValidateResult",
		"material_create_real_validate_h5":        "?Action=CreateRealValidateH5",
		"material_create_asset_group":             "?Action=CreateAssetGroup",
		"material_get_asset_group":                "?Action=GetAssetGroup",
		"material_delete_asset_group":             "?Action=DeleteAssetGroup",
		"material_create_asset":                   "?Action=CreateAsset",
		"material_get_asset":                      "?Action=GetAsset",
		"material_delete_asset":                   "?Action=DeleteAsset",
	}
	for key, value := range service.DefaultSeedanceAssetEndpointOverrides(config) {
		overrides[key] = value
	}
	return overrides
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
	switch capability {
	case model.ModelCapabilityText:
		return config.TextModel
	case model.ModelCapabilityImage:
		return config.ImageModel
	case model.ModelCapabilityVideo:
		return config.VideoModel
	case model.ModelCapabilityAudio:
		return config.AudioModel
	default:
		return ""
	}
}

func defaultProviderName(id string) string {
	if strings.TrimSpace(id) == model.ModelProviderIDDefault {
		return "默认兼容 Provider"
	}
	return strings.TrimSpace(id)
}

func providerFingerprint(config model.ModelProviderConfig) string {
	parts := []string{
		config.Name,
		config.PresetID,
		config.ProviderType,
		config.BaseURL,
		config.TextModel,
		config.ImageModel,
		config.VideoModel,
		config.AudioModel,
	}
	return strings.ToLower(strings.Join(parts, " "))
}

func providerSemanticallyEqual(a, b model.ModelProviderConfig) bool {
	return strings.TrimSpace(a.ID) == strings.TrimSpace(b.ID) &&
		a.Name == b.Name &&
		a.PresetID == b.PresetID &&
		a.ProviderType == b.ProviderType &&
		a.Mode == b.Mode &&
		a.BaseURL == b.BaseURL &&
		a.AuthType == b.AuthType &&
		a.CustomAuthHeader == b.CustomAuthHeader &&
		a.AuthQueryParam == b.AuthQueryParam &&
		a.APIKeyEncrypted == b.APIKeyEncrypted &&
		a.TextModel == b.TextModel &&
		a.ImageModel == b.ImageModel &&
		a.VideoModel == b.VideoModel &&
		a.AudioModel == b.AudioModel &&
		jsonEqual(a.Capabilities, b.Capabilities) &&
		jsonEqual(a.ModelsByCapability, b.ModelsByCapability) &&
		jsonEqual(a.DefaultFor, b.DefaultFor) &&
		jsonEqual(a.SecretsEncrypted, b.SecretsEncrypted) &&
		jsonEqual(a.EndpointOverrides, b.EndpointOverrides) &&
		jsonEqual(a.ExtraHeaders, b.ExtraHeaders) &&
		a.TimeoutMS == b.TimeoutMS &&
		a.Enabled == b.Enabled
}

func jsonEqual(a, b model.JSONB) bool {
	var av any
	var bv any
	if err := json.Unmarshal(nonEmptyJSON(a), &av); err != nil {
		av = string(a)
	}
	if err := json.Unmarshal(nonEmptyJSON(b), &bv); err != nil {
		bv = string(b)
	}
	return reflect.DeepEqual(av, bv)
}

func isEmptyJSON(raw model.JSONB) bool {
	trimmed := strings.TrimSpace(string(raw))
	return trimmed == "" || trimmed == "null" || trimmed == "{}" || trimmed == "[]"
}

func nonEmptyJSON(raw model.JSONB) []byte {
	if isEmptyJSON(raw) {
		return []byte("{}")
	}
	return []byte(raw)
}

func jsonb(value any) model.JSONB {
	data, err := json.Marshal(value)
	if err != nil {
		return model.JSONB("{}")
	}
	return model.JSONB(data)
}

func stringMapFromJSONB(raw model.JSONB) map[string]string {
	result := make(map[string]string)
	if isEmptyJSON(raw) {
		return result
	}
	var values map[string]string
	if err := json.Unmarshal(raw, &values); err != nil {
		return result
	}
	for key, value := range values {
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if key != "" && value != "" {
			result[key] = value
		}
	}
	return result
}

func stringSliceFromJSONB(raw model.JSONB) []string {
	if isEmptyJSON(raw) {
		return []string{}
	}
	var values []string
	if err := json.Unmarshal(raw, &values); err != nil {
		return []string{}
	}
	return normalizeCapabilities(values)
}

func normalizeCapabilities(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		switch strings.ToLower(strings.TrimSpace(value)) {
		case model.ModelCapabilityText:
			result = append(result, model.ModelCapabilityText)
		case model.ModelCapabilityImage:
			result = append(result, model.ModelCapabilityImage)
		case model.ModelCapabilityVideo:
			result = append(result, model.ModelCapabilityVideo)
		case model.ModelCapabilityAudio:
			result = append(result, model.ModelCapabilityAudio)
		}
	}
	return uniqueStrings(result)
}

func cloneProvider(config model.ModelProviderConfig) model.ModelProviderConfig {
	config.Capabilities = append(model.JSONB(nil), config.Capabilities...)
	config.ModelsByCapability = append(model.JSONB(nil), config.ModelsByCapability...)
	config.DefaultFor = append(model.JSONB(nil), config.DefaultFor...)
	config.SecretsEncrypted = append(model.JSONB(nil), config.SecretsEncrypted...)
	config.EndpointOverrides = append(model.JSONB(nil), config.EndpointOverrides...)
	config.ExtraHeaders = append(model.JSONB(nil), config.ExtraHeaders...)
	return config
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

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
