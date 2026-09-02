package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/repository"
)

const (
	SeedanceMaterialActionCreateVisualValidateSession = "material_create_visual_validate_session"
	SeedanceMaterialActionGetVisualValidateResult     = "material_get_visual_validate_result"
	SeedanceMaterialActionCreateRealValidateH5        = "material_create_real_validate_h5"
	SeedanceMaterialActionCreateAssetGroup            = "material_create_asset_group"
	SeedanceMaterialActionGetAssetGroup               = "material_get_asset_group"
	SeedanceMaterialActionDeleteAssetGroup            = "material_delete_asset_group"
	SeedanceMaterialActionCreateAsset                 = "material_create_asset"
	SeedanceMaterialActionGetAsset                    = "material_get_asset"
	SeedanceMaterialActionDeleteAsset                 = "material_delete_asset"

	SeedanceMaterialSecretKey = "tokenspace_api_key"
)

var (
	ErrSeedanceMaterialProviderNotConfigured = errors.New("Seedance material provider is not configured")
	ErrSeedanceMaterialAssetNotActive        = errors.New("Seedance material asset is not Active")
)

var materialURLPattern = regexp.MustCompile(`https?://[^\s"'<>]+`)

type SeedanceMaterialService struct {
	repo      repository.ModelProviderRepository
	secretBox provider.SecretBox
	client    *http.Client
}

type SeedanceMaterialRequest struct {
	Action  string
	Payload map[string]any
	Query   map[string]string
}

func NewSeedanceMaterialService(repo repository.ModelProviderRepository, secretBox provider.SecretBox) *SeedanceMaterialService {
	return &SeedanceMaterialService{
		repo:      repo,
		secretBox: secretBox,
		client:    &http.Client{Timeout: 60 * time.Second},
	}
}

func (s *SeedanceMaterialService) Call(ctx context.Context, input SeedanceMaterialRequest) (map[string]any, error) {
	config, apiKey, err := s.loadMaterialProvider()
	if err != nil {
		return nil, err
	}
	endpoint, err := materialEndpoint(config, input.Action, input.Query)
	if err != nil {
		return nil, err
	}
	payload := input.Payload
	if payload == nil {
		payload = map[string]any{}
	}
	raw, err := s.doMaterialJSON(ctx, endpoint, apiKey, payload)
	if err != nil {
		return nil, err
	}
	return sanitizeMaterialResponse(raw), materialBusinessError(raw)
}

func (s *SeedanceMaterialService) GetAsset(ctx context.Context, assetID string) (map[string]any, error) {
	assetID = strings.TrimSpace(assetID)
	if assetID == "" {
		return nil, errors.New("asset_id is required")
	}
	return s.Call(ctx, SeedanceMaterialRequest{
		Action:  SeedanceMaterialActionGetAsset,
		Payload: map[string]any{"Id": assetID},
	})
}

func (s *SeedanceMaterialService) EnsureAssetsActive(ctx context.Context, assetIDs []string) error {
	for _, assetID := range uniqueNonEmptyStrings(assetIDs) {
		raw, err := s.GetAsset(ctx, assetID)
		if err != nil {
			return err
		}
		status := strings.TrimSpace(strings.ToLower(seedanceMaterialString(raw, "Status", "status")))
		if status != "active" {
			if status == "" {
				status = "unknown"
			}
			return fmt.Errorf("%w: %s status=%s", ErrSeedanceMaterialAssetNotActive, assetID, status)
		}
	}
	return nil
}

func (s *SeedanceMaterialService) loadMaterialProvider() (model.ModelProviderConfig, string, error) {
	configs, err := s.repo.ListModelProviders()
	if err != nil {
		return model.ModelProviderConfig{}, "", err
	}
	config, err := selectSeedanceMaterialProvider(configs)
	if err != nil {
		return model.ModelProviderConfig{}, "", err
	}
	if !config.Enabled {
		return model.ModelProviderConfig{}, "", provider.ErrProviderDisabled
	}
	apiKey, err := s.materialAPIKey(config)
	if err != nil {
		return model.ModelProviderConfig{}, "", err
	}
	if strings.TrimSpace(apiKey) == "" && config.AuthType != model.ModelProviderAuthTypeNone {
		return model.ModelProviderConfig{}, "", provider.ErrProviderNotConfigured
	}
	return config, apiKey, nil
}

func (s *SeedanceMaterialService) materialAPIKey(config model.ModelProviderConfig) (string, error) {
	secrets := stringMapFromJSONB(config.SecretsEncrypted)
	for _, key := range []string{SeedanceMaterialSecretKey, "token_space_api_key", "material_api_key", "api_key"} {
		if encrypted := strings.TrimSpace(secrets[key]); encrypted != "" {
			return s.secretBox.Decrypt(encrypted)
		}
	}
	if strings.TrimSpace(config.APIKeyEncrypted) == "" {
		return "", nil
	}
	return s.secretBox.Decrypt(config.APIKeyEncrypted)
}

func (s *SeedanceMaterialService) doMaterialJSON(ctx context.Context, endpoint string, apiKey string, payload map[string]any) (map[string]any, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(apiKey) != "" {
		req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
	}
	res, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	rawBody, err := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	var raw map[string]any
	if len(bytes.TrimSpace(rawBody)) > 0 {
		if err := json.Unmarshal(rawBody, &raw); err != nil {
			return nil, fmt.Errorf("TokenSpace material returned invalid JSON: %w", err)
		}
	} else {
		raw = map[string]any{}
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return sanitizeMaterialResponse(raw), fmt.Errorf("TokenSpace material request failed with status %d: %s", res.StatusCode, sanitizeMaterialErrorText(materialErrorText(raw)))
	}
	return raw, nil
}

func selectSeedanceMaterialProvider(configs []model.ModelProviderConfig) (model.ModelProviderConfig, error) {
	var fallback *model.ModelProviderConfig
	for i := range configs {
		config := configs[i]
		if !hasMaterialEndpoint(config) {
			continue
		}
		if fallback == nil {
			current := config
			fallback = &current
		}
		if supportsDefaultVideo(config) {
			return config, nil
		}
	}
	if fallback != nil {
		return *fallback, nil
	}
	for _, config := range configs {
		if isSeedanceProvider(config) {
			return config, nil
		}
	}
	return model.ModelProviderConfig{}, ErrSeedanceMaterialProviderNotConfigured
}

func materialEndpoint(config model.ModelProviderConfig, action string, query map[string]string) (string, error) {
	action = strings.TrimSpace(action)
	overrides := stringMapFromJSONB(config.EndpointOverrides)
	baseURL := strings.TrimSpace(overrides["material_base_url"])
	if baseURL == "" {
		return "", ErrSeedanceMaterialProviderNotConfigured
	}
	actionPath := strings.TrimSpace(overrides[action])
	if actionPath == "" {
		return "", fmt.Errorf("Seedance material endpoint %s is not configured", action)
	}
	endpoint, err := joinMaterialURL(baseURL, actionPath)
	if err != nil {
		return "", err
	}
	if len(query) == 0 {
		return endpoint, nil
	}
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return "", err
	}
	values := parsed.Query()
	for key, value := range query {
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if key != "" && value != "" && values.Get(key) == "" {
			values.Set(key, value)
		}
	}
	parsed.RawQuery = values.Encode()
	return parsed.String(), nil
}

func joinMaterialURL(baseURL string, actionPath string) (string, error) {
	if strings.HasPrefix(actionPath, "http://") || strings.HasPrefix(actionPath, "https://") {
		return actionPath, nil
	}
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return "", err
	}
	if strings.HasPrefix(actionPath, "?") {
		parsed.RawQuery = strings.TrimPrefix(actionPath, "?")
		return parsed.String(), nil
	}
	base := strings.TrimRight(baseURL, "/")
	path := strings.TrimLeft(actionPath, "/")
	return base + "/" + path, nil
}

func hasMaterialEndpoint(config model.ModelProviderConfig) bool {
	overrides := stringMapFromJSONB(config.EndpointOverrides)
	return strings.TrimSpace(overrides["material_base_url"]) != "" && strings.TrimSpace(overrides[SeedanceMaterialActionGetAsset]) != ""
}

func supportsDefaultVideo(config model.ModelProviderConfig) bool {
	for _, capability := range stringSliceFromJSONB(config.DefaultFor) {
		if capability == model.ModelCapabilityVideo {
			return true
		}
	}
	return false
}

func isSeedanceProvider(config model.ModelProviderConfig) bool {
	preset := strings.ToLower(strings.TrimSpace(config.PresetID))
	providerType := strings.ToLower(strings.TrimSpace(config.ProviderType))
	return strings.Contains(preset, "seedance") ||
		strings.Contains(providerType, "seedance") ||
		hasSeedanceVideoModel(config)
}

func isVolcengineSeedanceProvider(config model.ModelProviderConfig) bool {
	preset := strings.ToLower(strings.TrimSpace(config.PresetID))
	providerType := strings.ToLower(strings.TrimSpace(config.ProviderType))
	return strings.Contains(providerType, "volcengine") && hasSeedanceVideoModel(config) ||
		strings.Contains(preset, "volcengine") && strings.Contains(preset, "seedance")
}

func hasSeedanceVideoModel(config model.ModelProviderConfig) bool {
	if strings.Contains(strings.ToLower(strings.TrimSpace(config.VideoModel)), "seedance") {
		return true
	}
	var models map[string][]string
	if err := json.Unmarshal(config.ModelsByCapability, &models); err != nil {
		return false
	}
	for _, modelID := range models[model.ModelCapabilityVideo] {
		if strings.Contains(strings.ToLower(strings.TrimSpace(modelID)), "seedance") {
			return true
		}
	}
	return false
}

func materialBusinessError(raw map[string]any) error {
	if message := materialErrorText(raw); message != "" {
		return errors.New(message)
	}
	return nil
}

func materialErrorText(raw map[string]any) string {
	if raw == nil {
		return ""
	}
	for _, container := range []map[string]any{raw, mapFromAny(raw["Result"]), mapFromAny(raw["result"])} {
		if container == nil {
			continue
		}
		if message := strings.TrimSpace(seedanceMaterialString(container, "Error", "error", "Message", "message", "Detail", "detail")); message != "" {
			return sanitizeMaterialErrorText(message)
		}
		for _, key := range []string{"Error", "error"} {
			if errorBody := mapFromAny(container[key]); errorBody != nil {
				if message := strings.TrimSpace(seedanceMaterialString(errorBody, "Message", "message", "Code", "code")); message != "" {
					return sanitizeMaterialErrorText(message)
				}
			}
		}
	}
	return ""
}

func sanitizeMaterialResponse(raw map[string]any) map[string]any {
	data := sanitizeMaterialValue(raw)
	if typed, ok := data.(map[string]any); ok {
		return typed
	}
	return map[string]any{}
}

func sanitizeMaterialValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		next := make(map[string]any, len(typed))
		for key, item := range typed {
			if isSensitiveMaterialKey(key) {
				next[key] = "***"
				continue
			}
			next[key] = sanitizeMaterialValue(item)
		}
		return next
	case []any:
		next := make([]any, 0, len(typed))
		for _, item := range typed {
			next = append(next, sanitizeMaterialValue(item))
		}
		return next
	case string:
		return sanitizeMaterialText(typed)
	default:
		return typed
	}
}

func sanitizeMaterialText(value string) string {
	value = strings.TrimSpace(value)
	if strings.Contains(strings.ToLower(value), "bearer ") {
		return "***"
	}
	return value
}

func sanitizeMaterialErrorText(value string) string {
	value = sanitizeMaterialText(value)
	return materialURLPattern.ReplaceAllString(value, "[url]")
}

func isSensitiveMaterialKey(key string) bool {
	normalized := strings.ToLower(strings.TrimSpace(key))
	canonical := strings.NewReplacer("_", "", "-", "").Replace(normalized)
	// BytedToken is a short-lived visual-validation session identifier required
	// by the authenticated client for GetVisualValidateResult. It is not the
	// Provider API credential; all generic token/secret fields remain redacted.
	if canonical == "bytedtoken" {
		return false
	}
	return strings.Contains(normalized, "token") ||
		strings.Contains(normalized, "secret") ||
		strings.Contains(normalized, "api_key") ||
		strings.Contains(normalized, "apikey") ||
		strings.Contains(normalized, "authorization")
}

func stringMapFromJSONB(raw model.JSONB) map[string]string {
	result := make(map[string]string)
	if len(raw) == 0 {
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
	var values []string
	if err := json.Unmarshal(raw, &values); err != nil {
		return nil
	}
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			result = append(result, value)
		}
	}
	return result
}

func seedanceMaterialString(raw map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := raw[key]; ok {
			if str, ok := value.(string); ok {
				return str
			}
		}
	}
	for _, childKey := range []string{"Result", "result", "Data", "data"} {
		if child := mapFromAny(raw[childKey]); child != nil {
			if value := seedanceMaterialString(child, keys...); value != "" {
				return value
			}
		}
	}
	return ""
}

func mapFromAny(value any) map[string]any {
	if typed, ok := value.(map[string]any); ok {
		return typed
	}
	return nil
}

func uniqueNonEmptyStrings(values []string) []string {
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
