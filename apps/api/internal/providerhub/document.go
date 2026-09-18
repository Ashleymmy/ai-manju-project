// Package providerhub validates portable configuration documents. It does not
// persist credentials or execute providers; hosts map documents to live config.
package providerhub

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"
)

const (
	// Version is the supported document schema; changes require explicit migration.
	Version = 1
	// MaxDocumentBytes bounds configuration parsing, independently of media sizes.
	MaxDocumentBytes = 64 * 1024
	maxDepth         = 12
)

type Document struct {
	SchemaVersion int             `json:"schema_version"`
	Adapter       string          `json:"adapter"`
	Config        json.RawMessage `json:"config"`
}

type studioConfig struct {
	Name               string              `json:"name"`
	PresetID           string              `json:"preset_id"`
	ProviderType       string              `json:"provider_type"`
	Mode               string              `json:"mode"`
	BaseURL            string              `json:"base_url"`
	AuthType           string              `json:"auth_type"`
	CustomAuthHeader   string              `json:"custom_auth_header"`
	AuthQueryParam     string              `json:"auth_query_param"`
	TextModel          string              `json:"text_model"`
	ImageModel         string              `json:"image_model"`
	VideoModel         string              `json:"video_model"`
	AudioModel         string              `json:"audio_model"`
	Capabilities       []string            `json:"capabilities"`
	ModelsByCapability map[string][]string `json:"models_by_capability"`
	ModelAliases       map[string]string   `json:"model_aliases"`
	ModelProtocols     map[string]string   `json:"model_protocols"`
	DefaultFor         []string            `json:"default_for"`
	EndpointOverrides  map[string]string   `json:"endpoint_overrides"`
	ExtraHeaders       map[string]string   `json:"extra_headers"`
	TimeoutMS          *int                `json:"timeout_ms"`
	MaxConcurrency     *int                `json:"max_concurrency"`
	Enabled            *bool               `json:"enabled"`
}

type ManagedModel struct {
	Key         string `json:"key"`
	Name        string `json:"name"`
	ModelID     string `json:"model_id"`
	Enabled     *bool  `json:"enabled"`
	Concurrency int    `json:"concurrency_limit"`
	Version     int    `json:"version"`
}
type managedConfig struct {
	Models []ManagedModel `json:"sdvideo_models"`
}

// Parse fails closed for unsupported fields, adapters, credentials and versions.
// Error messages never include document values or JSON decoder excerpts.
func Parse(raw []byte, expectedAdapter string) (Document, error) {
	var doc Document
	if len(raw) > MaxDocumentBytes {
		return doc, errors.New("config_document exceeds 64 KiB")
	}
	var tree any
	if json.Unmarshal(raw, &tree) != nil || validateTree(tree, 0) != nil {
		return doc, errors.New("invalid config_document object")
	}
	if err := strictDecode(raw, &doc); err != nil {
		return doc, err
	}
	if doc.SchemaVersion != Version {
		return doc, errors.New("unsupported config_document schema_version")
	}
	if doc.Adapter != expectedAdapter {
		return doc, errors.New("config_document adapter mismatch")
	}
	if len(doc.Config) == 0 || doc.Config[0] != '{' {
		return doc, errors.New("config_document.config must be an object")
	}
	if doc.Adapter == "studio" {
		var cfg studioConfig
		if err := strictDecode(doc.Config, &cfg); err != nil {
			return doc, err
		}
		if err := cfg.validate(); err != nil {
			return doc, err
		}
	} else if doc.Adapter == "sdvideo" {
		var cfg managedConfig
		if err := strictDecode(doc.Config, &cfg); err != nil {
			return doc, err
		}
		if len(cfg.Models) == 0 {
			return doc, errors.New("sdvideo_models must not be empty")
		}
		seen := map[string]bool{}
		for _, item := range cfg.Models {
			if strings.TrimSpace(item.Key) == "" || seen[item.Key] || strings.TrimSpace(item.Name) == "" || strings.TrimSpace(item.ModelID) == "" || item.Version < 1 || item.Enabled == nil || item.Concurrency < 1 || item.Concurrency > 16 {
				return doc, errors.New("invalid sdvideo model configuration")
			}
			seen[item.Key] = true
		}
	} else {
		return doc, errors.New("unsupported config_document adapter")
	}
	return doc, nil
}

func strictDecode(raw []byte, dest any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(dest) != nil {
		return errors.New("config_document has unsupported fields or invalid field types; use the credential form for secrets")
	}
	if decoder.Decode(new(any)) != io.EOF {
		return errors.New("config_document must contain exactly one JSON value")
	}
	return nil
}

func validateTree(value any, depth int) error {
	if depth > maxDepth || value == nil {
		return errors.New("invalid configuration nesting or null")
	}
	switch v := value.(type) {
	case map[string]any:
		for key, child := range v {
			if key == "__proto__" || key == "prototype" || key == "constructor" {
				return errors.New("forbidden object key")
			}
			if err := validateTree(child, depth+1); err != nil {
				return err
			}
		}
	case []any:
		for _, child := range v {
			if err := validateTree(child, depth+1); err != nil {
				return err
			}
		}
	}
	return nil
}

// SensitiveKey covers credential headers; credential field names belong in the
// encrypted host storage, never in portable documents.
func SensitiveKey(key string) bool {
	key = strings.ToLower(strings.NewReplacer("-", "", "_", "", " ", "").Replace(key))
	return contains(key, "authorization", "proxyauthorization", "cookie", "setcookie", "apikey", "xapikey", "xgoogapikey", "token", "accesstoken", "refreshtoken", "secret", "clientsecret", "password", "privatekey", "accesskey", "secretkey", "accesskeyid", "secretaccesskey")
}

func validateURL(value string) error {
	u, err := url.Parse(value)
	if err != nil || u.Host == "" || !contains(strings.ToLower(u.Scheme), "http", "https") || u.User != nil {
		return errors.New("base URL must be HTTP(S) without embedded credentials")
	}
	return validateQuery(u.RawQuery)
}
func validateQuery(query string) error {
	values, err := url.ParseQuery(query)
	if err != nil {
		return errors.New("invalid URL query")
	}
	for key := range values {
		if SensitiveKey(key) || key == "key" {
			return errors.New("URL credentials must use the credential form")
		}
	}
	return nil
}
func contains(value string, values ...string) bool {
	for _, candidate := range values {
		if value == candidate {
			return true
		}
	}
	return false
}
func (cfg studioConfig) validate() error {
	if strings.TrimSpace(cfg.Name) == "" {
		return errors.New("name is required")
	}
	if err := validateURL(cfg.BaseURL); err != nil {
		return err
	}
	for _, cap := range append(cfg.Capabilities, cfg.DefaultFor...) {
		if !contains(cap, "text", "image", "video", "audio") {
			return errors.New("unsupported capability")
		}
	}
	for cap := range cfg.ModelsByCapability {
		if !contains(cap, "text", "image", "video", "audio") {
			return errors.New("unsupported model capability")
		}
	}
	for field, valid := range map[string]bool{
		"mode":          contains(cfg.Mode, "", "openai_compatible", "local_openai"),
		"auth_type":     contains(cfg.AuthType, "", "none", "bearer", "x_api_key", "x_goog_api_key", "auto_api_key", "custom_header", "query_param"),
		"provider_type": contains(cfg.ProviderType, "", "openai_compatible", "volcengine_ark", "gemini_media", "kling_video", "minimax_hailuo", "fal_happyhorse", "xai_imagine", "aliyun_yike"),
	} {
		if !valid {
			return fmt.Errorf("unsupported %s", field)
		}
	}
	if cfg.TimeoutMS != nil && (*cfg.TimeoutMS < 30000 || *cfg.TimeoutMS > 600000) {
		return errors.New("timeout_ms must be between 30000 and 600000")
	}
	if cfg.MaxConcurrency != nil && (*cfg.MaxConcurrency < 1 || *cfg.MaxConcurrency > 8) {
		return errors.New("max_concurrency must be between 1 and 8")
	}
	for key := range cfg.ExtraHeaders {
		if SensitiveKey(key) {
			return errors.New("credential headers must use the credential form")
		}
	}
	for _, protocol := range cfg.ModelProtocols {
		if !contains(protocol, "auto", "openai_images", "openai_responses", "openai_chat_completions", "gemini_generate_content", "dashscope_multimodal", "stability_image") {
			return errors.New("unsupported image protocol")
		}
	}
	for key, endpoint := range cfg.EndpointOverrides {
		if SensitiveKey(key) {
			return errors.New("endpoint credentials must use the credential form")
		}
		if strings.HasPrefix(endpoint, "http://") || strings.HasPrefix(endpoint, "https://") {
			if err := validateURL(endpoint); err != nil {
				return err
			}
		} else if parts := strings.SplitN(endpoint, "?", 2); len(parts) == 2 {
			if err := validateQuery(parts[1]); err != nil {
				return err
			}
		}
	}
	return nil
}
