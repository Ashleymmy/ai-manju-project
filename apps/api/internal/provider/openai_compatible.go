package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net"
	"net/http"
	"net/textproto"
	"net/url"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/model"
)

var ErrProviderNotConfigured = errors.New("model provider is not configured; please contact an administrator")
var ErrProviderDisabled = errors.New("model provider is disabled; please contact an administrator")
var ErrTextModelNotConfigured = errors.New("text model is not configured; please contact an administrator")
var ErrImageModelNotConfigured = errors.New("image model is not configured; please contact an administrator")
var ErrUnsupportedImageUpload = errors.New("uploaded image file must be png, jpeg, webp, or gif")

const maxProviderResponseBytes = 64 * 1024 * 1024
const maxProviderBinaryResponseBytes = 512 * 1024 * 1024
const minImageRequestTimeout = 120 * time.Second

const (
	// EndpointOverrideTextGenerationKey selects /responses or /chat/completions for text generation.
	EndpointOverrideTextGenerationKey = "text_generation"
	// EndpointOverrideAudioSpeechKey selects the OpenAI-compatible speech synthesis endpoint.
	EndpointOverrideAudioSpeechKey = "audio_speech"
)

var imageBase64Keys = []string{"b64_json", "base64", "image_base64", "imageBase64"}
var imageURLKeys = []string{"url", "image_url", "imageUrl", "output_url", "outputUrl", "result_url", "resultUrl", "download_url", "downloadUrl", "asset_url", "assetUrl"}
var imageContainerKeys = []string{"data", "images", "image", "output", "outputs", "result", "results", "items", "files", "candidates", "content", "parts"}

type OpenAICompatibleClient struct {
	httpClient *http.Client
	longClient *http.Client
	config     model.ModelProviderConfig
	apiKey     string
}

type ProviderHTTPError struct {
	Method     string
	URL        string
	StatusCode int
	Body       string
}

func (e *ProviderHTTPError) Error() string {
	return fmt.Sprintf("provider request failed with status %d: %s", e.StatusCode, e.BodySnippet(4000))
}

func (e *ProviderHTTPError) SafeURL() string {
	parsed, err := url.Parse(e.URL)
	if err != nil {
		return e.URL
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String()
}

func (e *ProviderHTTPError) BodySnippet(limit int) string {
	body := strings.TrimSpace(e.Body)
	if limit <= 0 || len(body) <= limit {
		return body
	}
	return body[:limit] + "...(truncated)"
}

type ModelListResponse struct {
	Models []string `json:"models"`
	Raw    any      `json:"raw,omitempty"`
}

type TextGenerationRequest struct {
	Prompt            string           `json:"prompt,omitempty"`
	Messages          []map[string]any `json:"messages,omitempty"`
	Tools             []map[string]any `json:"tools,omitempty"`
	ToolChoice        any              `json:"tool_choice,omitempty"`
	ParallelToolCalls *bool            `json:"parallel_tool_calls,omitempty"`
	Model             string           `json:"model,omitempty"`
	Stream            bool             `json:"stream"`
}

type TextToolFunction struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type TextToolCall struct {
	ID               string           `json:"id"`
	Type             string           `json:"type"`
	Function         TextToolFunction `json:"function"`
	ThoughtSignature string           `json:"thought_signature,omitempty"`
}

type TextResponse struct {
	Text         string         `json:"text"`
	Model        string         `json:"model"`
	ToolCalls    []TextToolCall `json:"tool_calls"`
	FinishReason string         `json:"finish_reason"`
}

type ImageGenerationRequest struct {
	Model          string         `json:"model,omitempty"`
	Prompt         string         `json:"prompt,omitempty"`
	Size           string         `json:"size,omitempty"`
	Quality        string         `json:"quality,omitempty"`
	Style          string         `json:"style,omitempty"`
	ResponseFormat string         `json:"response_format,omitempty"`
	N              int            `json:"n,omitempty"`
	Extra          map[string]any `json:"-"`
}

type ImageEditRequest struct {
	Model          string
	Prompt         string
	Size           string
	Quality        string
	Style          string
	ResponseFormat string
	N              int
	Extra          map[string]string
	Files          []ImageEditFile
}

type ImageEditFile struct {
	FieldName string
	FileName  string
	Header    textproto.MIMEHeader
	File      io.ReadCloser
}

type ProxyMultipartFile struct {
	FieldName string
	FileName  string
	Header    textproto.MIMEHeader
	File      io.ReadCloser
}

type ImageGenerationResponse struct {
	Created int64            `json:"created,omitempty"`
	Data    []GeneratedImage `json:"data"`
	Model   string           `json:"model,omitempty"`
}

type GeneratedImage struct {
	URL           string `json:"url,omitempty"`
	B64JSON       string `json:"b64_json,omitempty"`
	MimeType      string `json:"mime_type,omitempty"`
	RevisedPrompt string `json:"revised_prompt,omitempty"`
}

func AuthRequiresAPIKey(authType string) bool {
	return authType == model.ModelProviderAuthTypeBearer ||
		authType == model.ModelProviderAuthTypeXAPIKey ||
		authType == model.ModelProviderAuthTypeXGoogAPIKey ||
		authType == model.ModelProviderAuthTypeAutoAPIKey ||
		authType == model.ModelProviderAuthTypeCustomHeader ||
		authType == model.ModelProviderAuthTypeQueryParam
}

func AuthHeaderName(authType string) string {
	switch authType {
	case model.ModelProviderAuthTypeBearer:
		return "Authorization"
	case model.ModelProviderAuthTypeXAPIKey:
		return "x-api-key"
	case model.ModelProviderAuthTypeXGoogAPIKey:
		return "x-goog-api-key"
	case model.ModelProviderAuthTypeAutoAPIKey:
		return "Authorization + x-api-key + x-goog-api-key"
	case model.ModelProviderAuthTypeCustomHeader:
		return "custom header"
	case model.ModelProviderAuthTypeQueryParam:
		return "query parameter"
	default:
		return ""
	}
}

func NewOpenAICompatibleClient(config model.ModelProviderConfig, apiKey string) (*OpenAICompatibleClient, error) {
	if err := ValidateProviderConfig(config); err != nil {
		return nil, err
	}
	transport := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 60 * time.Second,
		MaxIdleConns:          100,
		MaxIdleConnsPerHost:   16,
		IdleConnTimeout:       90 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
	timeout := time.Duration(config.TimeoutMS) * time.Millisecond
	longTimeout := ImageRequestTimeout(config.TimeoutMS)

	return &OpenAICompatibleClient{
		httpClient: &http.Client{Timeout: timeout, Transport: transport},
		longClient: &http.Client{Timeout: longTimeout, Transport: transport},
		config:     config,
		apiKey:     apiKey,
	}, nil
}

func ImageRequestTimeout(timeoutMS int) time.Duration {
	timeout := time.Duration(timeoutMS) * time.Millisecond
	if timeout < minImageRequestTimeout {
		return minImageRequestTimeout
	}
	return timeout
}

func ValidateProviderConfig(config model.ModelProviderConfig) error {
	if config.ID == "" {
		config.ID = model.ModelProviderIDDefault
	}
	if strings.TrimSpace(config.BaseURL) == "" {
		return ErrProviderNotConfigured
	}
	mode := config.Mode
	if mode == "" {
		mode = model.ModelProviderModeOpenAICompatible
	}
	if mode != model.ModelProviderModeLocalOpenAI && mode != model.ModelProviderModeOpenAICompatible {
		return fmt.Errorf("unsupported provider mode %q", config.Mode)
	}
	providerType := strings.TrimSpace(config.ProviderType)
	if providerType == "" {
		providerType = model.ModelProviderTypeOpenAICompatible
	}
	if providerType != model.ModelProviderTypeOpenAICompatible &&
		providerType != model.ModelProviderTypeVolcengineArk &&
		providerType != model.ModelProviderTypeGeminiMedia &&
		providerType != model.ModelProviderTypeKlingVideo &&
		providerType != model.ModelProviderTypeMinimaxHailuo &&
		providerType != model.ModelProviderTypeFalHappyHorse &&
		providerType != model.ModelProviderTypeXAIImagine &&
		providerType != model.ModelProviderTypeAliyunYike {
		return fmt.Errorf("unsupported provider_type %q", config.ProviderType)
	}
	if config.AuthType != model.ModelProviderAuthTypeNone &&
		config.AuthType != model.ModelProviderAuthTypeBearer &&
		config.AuthType != model.ModelProviderAuthTypeXAPIKey &&
		config.AuthType != model.ModelProviderAuthTypeXGoogAPIKey &&
		config.AuthType != model.ModelProviderAuthTypeAutoAPIKey &&
		config.AuthType != model.ModelProviderAuthTypeCustomHeader &&
		config.AuthType != model.ModelProviderAuthTypeQueryParam {
		return fmt.Errorf("unsupported auth_type %q", config.AuthType)
	}
	if config.TimeoutMS <= 0 {
		return fmt.Errorf("timeout_ms is required")
	}

	return nil
}

func (c *OpenAICompatibleClient) ListModels(ctx context.Context) (ModelListResponse, error) {
	if c.usesGeminiNativeAPI() {
		var raw struct {
			Models []struct {
				Name string `json:"name"`
			} `json:"models"`
		}
		if err := c.doGeminiJSON(ctx, http.MethodGet, "/models", nil, &raw); err != nil {
			return ModelListResponse{}, err
		}

		models := make([]string, 0, len(raw.Models))
		for _, item := range raw.Models {
			id := strings.TrimPrefix(strings.TrimSpace(item.Name), "models/")
			if id != "" {
				models = append(models, id)
			}
		}
		return ModelListResponse{Models: models}, nil
	}

	var raw struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := c.doJSON(ctx, http.MethodGet, "/models", nil, &raw); err != nil {
		return ModelListResponse{}, err
	}

	models := make([]string, 0, len(raw.Data))
	for _, item := range raw.Data {
		if item.ID != "" {
			models = append(models, item.ID)
		}
	}

	return ModelListResponse{Models: models}, nil
}

func (c *OpenAICompatibleClient) GenerateText(ctx context.Context, prompt string, requestedModel string) (TextResponse, error) {
	return c.GenerateTextRequest(ctx, TextGenerationRequest{Prompt: prompt, Model: requestedModel})
}

func (c *OpenAICompatibleClient) GenerateTextRequest(ctx context.Context, request TextGenerationRequest) (TextResponse, error) {
	modelID := strings.TrimSpace(request.Model)
	if modelID == "" {
		modelID = strings.TrimSpace(c.config.TextModel)
	}
	if modelID == "" {
		return TextResponse{}, ErrTextModelNotConfigured
	}
	if c.usesGeminiNativeAPI() {
		return c.generateGeminiText(ctx, textRequestFallbackPrompt(request), modelID)
	}

	overridePath := providerEndpointOverride(c.config, EndpointOverrideTextGenerationKey)
	requestPath := overridePath
	if requestPath == "" {
		requestPath = "/responses"
	}
	if isChatCompletionsPath(requestPath) {
		return c.generateChatCompletionText(ctx, request, modelID, requestPath)
	}

	body := map[string]any{
		"model":               modelID,
		"stream":              false,
		"input":               responsesTextInput(request),
		"parallel_tool_calls": false,
	}
	if tools := responsesTextTools(request.Tools); len(tools) > 0 {
		body["tools"] = tools
	}
	if request.ToolChoice != nil {
		body["tool_choice"] = responsesToolChoice(request.ToolChoice)
	}
	var raw json.RawMessage
	if err := c.doJSON(ctx, http.MethodPost, requestPath, body, &raw); err != nil {
		if overridePath == "" && textEndpointSupportsSafeChatFallback(err) {
			return c.generateChatCompletionText(ctx, request, modelID, "/chat/completions")
		}
		return TextResponse{}, err
	}
	return normalizeStructuredTextResponse(raw, modelID)
}

func (c *OpenAICompatibleClient) generateChatCompletionText(ctx context.Context, request TextGenerationRequest, modelID string, requestPath string) (TextResponse, error) {
	body := map[string]any{
		"model":               modelID,
		"stream":              false,
		"messages":            chatTextMessages(request),
		"parallel_tool_calls": false,
	}
	if len(request.Tools) > 0 {
		body["tools"] = chatTextTools(request.Tools)
	}
	if request.ToolChoice != nil {
		body["tool_choice"] = chatToolChoice(request.ToolChoice)
	}
	var raw json.RawMessage
	if err := c.doJSON(ctx, http.MethodPost, requestPath, body, &raw); err != nil {
		return TextResponse{}, err
	}
	return normalizeStructuredTextResponse(raw, modelID)
}

func responsesTextInput(request TextGenerationRequest) []map[string]any {
	if len(request.Messages) == 0 {
		return []map[string]any{{"role": "user", "content": []map[string]any{{"type": "input_text", "text": strings.TrimSpace(request.Prompt)}}}}
	}
	items := make([]map[string]any, 0, len(request.Messages))
	for _, message := range request.Messages {
		if strings.EqualFold(stringField(message["type"]), "function_call") {
			items = append(items, map[string]any{
				"type":      "function_call",
				"call_id":   firstNonEmptyString(message, "call_id", "id"),
				"name":      stringField(message["name"]),
				"arguments": jsonStringValue(message["arguments"], "{}"),
			})
			continue
		}
		role := strings.ToLower(stringField(message["role"]))
		if role == "tool" {
			items = append(items, map[string]any{
				"type":    "function_call_output",
				"call_id": firstNonEmptyString(message, "tool_call_id", "call_id"),
				"output":  jsonStringValue(message["content"], ""),
			})
			continue
		}
		if role != "system" && role != "user" && role != "assistant" {
			continue
		}
		items = append(items, map[string]any{"role": role, "content": responsesMessageContent(message["content"])})
	}
	return items
}

func responsesMessageContent(content any) any {
	items, ok := content.([]any)
	if !ok {
		return jsonStringValue(content, "")
	}
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		record, ok := item.(map[string]any)
		if !ok {
			continue
		}
		switch strings.ToLower(stringField(record["type"])) {
		case "text", "input_text", "output_text":
			result = append(result, map[string]any{"type": "input_text", "text": stringField(record["text"])})
		case "image_url", "input_image":
			if imageURL := messageImageURL(record["image_url"]); imageURL != "" {
				result = append(result, map[string]any{"type": "input_image", "image_url": imageURL})
			}
		}
	}
	return result
}

func responsesTextTools(tools []map[string]any) []map[string]any {
	result := make([]map[string]any, 0, len(tools))
	for _, tool := range tools {
		function, _ := tool["function"].(map[string]any)
		name := stringField(tool["name"])
		if name == "" {
			name = stringField(function["name"])
		}
		if name == "" {
			continue
		}
		normalized := map[string]any{"type": "function", "name": name}
		for _, key := range []string{"description", "parameters", "strict"} {
			if value, ok := function[key]; ok {
				normalized[key] = value
			} else if value, ok := tool[key]; ok {
				normalized[key] = value
			}
		}
		result = append(result, normalized)
	}
	return result
}

func chatTextTools(tools []map[string]any) []map[string]any {
	result := make([]map[string]any, 0, len(tools))
	for _, tool := range tools {
		if function, ok := tool["function"].(map[string]any); ok && stringField(function["name"]) != "" {
			result = append(result, tool)
			continue
		}
		name := stringField(tool["name"])
		if name == "" {
			continue
		}
		function := map[string]any{"name": name}
		for _, key := range []string{"description", "parameters", "strict"} {
			if value, ok := tool[key]; ok {
				function[key] = value
			}
		}
		result = append(result, map[string]any{"type": "function", "function": function})
	}
	return result
}

func chatTextMessages(request TextGenerationRequest) []map[string]any {
	if len(request.Messages) == 0 {
		return []map[string]any{{"role": "user", "content": strings.TrimSpace(request.Prompt)}}
	}
	result := make([]map[string]any, 0, len(request.Messages))
	for _, message := range request.Messages {
		if strings.EqualFold(stringField(message["type"]), "function_call") {
			callID := firstNonEmptyString(message, "call_id", "id")
			result = append(result, map[string]any{
				"role": "assistant",
				"tool_calls": []map[string]any{{
					"id": callID, "type": "function",
					"function": map[string]any{"name": stringField(message["name"]), "arguments": jsonStringValue(message["arguments"], "{}")},
				}},
			})
			continue
		}
		role := strings.ToLower(stringField(message["role"]))
		if role != "system" && role != "user" && role != "assistant" && role != "tool" {
			continue
		}
		normalized := map[string]any{"role": role, "content": message["content"]}
		if role == "tool" {
			normalized["tool_call_id"] = firstNonEmptyString(message, "tool_call_id", "call_id")
		}
		result = append(result, normalized)
	}
	return result
}

func responsesToolChoice(choice any) any {
	record, ok := choice.(map[string]any)
	if !ok {
		return choice
	}
	if strings.EqualFold(stringField(record["type"]), "function") {
		if function, ok := record["function"].(map[string]any); ok {
			return map[string]any{"type": "function", "name": stringField(function["name"])}
		}
	}
	return choice
}

func chatToolChoice(choice any) any {
	record, ok := choice.(map[string]any)
	if !ok || !strings.EqualFold(stringField(record["type"]), "function") {
		return choice
	}
	if _, ok := record["function"].(map[string]any); ok {
		return choice
	}
	return map[string]any{"type": "function", "function": map[string]any{"name": stringField(record["name"])}}
}

func textRequestFallbackPrompt(request TextGenerationRequest) string {
	if prompt := strings.TrimSpace(request.Prompt); prompt != "" && len(request.Messages) == 0 {
		return prompt
	}
	parts := make([]string, 0, len(request.Messages))
	for _, message := range request.Messages {
		if role := stringField(message["role"]); role != "" && role != "tool" {
			if text := strings.TrimSpace(collectResponseText(message["content"], 0)); text != "" {
				parts = append(parts, role+": "+text)
			}
		}
	}
	return strings.Join(parts, "\n\n")
}

func firstNonEmptyString(record map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := stringField(record[key]); value != "" {
			return value
		}
	}
	return ""
}

func messageImageURL(value any) string {
	if text := stringField(value); text != "" {
		return text
	}
	if record, ok := value.(map[string]any); ok {
		return stringField(record["url"])
	}
	return ""
}

func jsonStringValue(value any, fallback string) string {
	if text, ok := value.(string); ok {
		return text
	}
	if value == nil {
		return fallback
	}
	payload, err := json.Marshal(value)
	if err != nil {
		return fallback
	}
	return string(payload)
}

func isChatCompletionsPath(value string) bool {
	return strings.Contains(strings.ToLower(strings.TrimSpace(value)), "chat/completions")
}

func textEndpointSupportsSafeChatFallback(err error) bool {
	var providerErr *ProviderHTTPError
	return errors.As(err, &providerErr) && (providerErr.StatusCode == http.StatusNotFound || providerErr.StatusCode == http.StatusMethodNotAllowed)
}

func providerEndpointOverride(config model.ModelProviderConfig, key string) string {
	var overrides map[string]string
	if len(config.EndpointOverrides) == 0 || json.Unmarshal(config.EndpointOverrides, &overrides) != nil {
		return ""
	}
	return strings.TrimSpace(overrides[key])
}

func (c *OpenAICompatibleClient) GenerateImages(ctx context.Context, imageRequest ImageGenerationRequest) (ImageGenerationResponse, error) {
	body := make(map[string]any)
	for key, value := range imageRequest.Extra {
		body[key] = value
	}
	modelID := strings.TrimSpace(imageRequest.Model)
	if modelID == "" {
		modelID = strings.TrimSpace(c.config.ImageModel)
	}
	if modelID == "" {
		return ImageGenerationResponse{}, ErrImageModelNotConfigured
	}
	if c.usesGeminiNativeAPI() {
		return c.generateGeminiImages(ctx, imageRequest, modelID)
	}
	if shouldUseResponsesImageGeneration(modelID) {
		return c.generateResponseImages(ctx, imageRequest, modelID)
	}

	body["model"] = modelID
	if strings.TrimSpace(imageRequest.Model) != "" {
		body["model"] = strings.TrimSpace(imageRequest.Model)
	}
	if strings.TrimSpace(imageRequest.Prompt) != "" {
		body["prompt"] = strings.TrimSpace(imageRequest.Prompt)
	}
	if strings.TrimSpace(imageRequest.Size) != "" {
		body["size"] = strings.TrimSpace(imageRequest.Size)
	}
	if strings.TrimSpace(imageRequest.Quality) != "" {
		body["quality"] = strings.TrimSpace(imageRequest.Quality)
	}
	if strings.TrimSpace(imageRequest.Style) != "" {
		body["style"] = strings.TrimSpace(imageRequest.Style)
	}
	if strings.TrimSpace(imageRequest.ResponseFormat) != "" {
		body["response_format"] = strings.TrimSpace(imageRequest.ResponseFormat)
	}
	if imageRequest.N > 0 {
		body["n"] = imageRequest.N
	}

	var raw json.RawMessage
	if err := c.doLongJSON(ctx, http.MethodPost, "/images/generations", body, &raw); err != nil {
		return ImageGenerationResponse{}, err
	}
	return normalizeImageGenerationResponse(raw, modelID)
}

func (c *OpenAICompatibleClient) generateGeminiText(ctx context.Context, prompt string, modelID string) (TextResponse, error) {
	body := geminiGenerateContentBody(prompt)

	var raw json.RawMessage
	if err := c.doGeminiJSON(ctx, http.MethodPost, geminiGenerateContentPath(modelID), body, &raw); err != nil {
		return TextResponse{}, err
	}

	text, err := extractGeminiText(raw)
	if err != nil {
		return TextResponse{}, err
	}
	return TextResponse{Text: text, Model: modelID}, nil
}

func normalizeResponseText(payload json.RawMessage, fallbackModel string) (string, string, error) {
	response, err := normalizeStructuredTextResponse(payload, fallbackModel)
	if err != nil {
		return "", "", err
	}
	if strings.TrimSpace(response.Text) == "" {
		return "", "", errors.New("provider text response did not include text")
	}
	return response.Text, response.Model, nil
}

func normalizeStructuredTextResponse(payload json.RawMessage, fallbackModel string) (TextResponse, error) {
	var value any
	if err := json.Unmarshal(payload, &value); err != nil {
		return TextResponse{}, err
	}
	if message := providerPayloadErrorMessage(value); message != "" {
		return TextResponse{}, errors.New(message)
	}

	modelID := fallbackModel
	if model := topLevelString(value, "model"); model != "" {
		modelID = model
	}
	if record, ok := value.(map[string]any); ok {
		if response, ok := record["response"].(map[string]any); ok {
			if model := stringField(response["model"]); model != "" {
				modelID = model
			}
		}
	}

	text := ""
	if record, ok := value.(map[string]any); ok {
		text = stringField(record["output_text"])
	}
	if text == "" {
		text = strings.TrimSpace(collectResponseText(value, 0))
	}
	toolCalls := extractTextToolCalls(value)
	if text == "" && len(toolCalls) == 0 {
		return TextResponse{}, errors.New("provider text response did not include text or tool calls")
	}
	finishReason := extractTextFinishReason(value)
	if len(toolCalls) > 0 && (finishReason == "" || finishReason == "stop" || finishReason == "completed") {
		finishReason = "tool_calls"
	} else if finishReason == "" {
		finishReason = "stop"
	}
	return TextResponse{Text: text, Model: modelID, ToolCalls: toolCalls, FinishReason: finishReason}, nil
}

func extractTextToolCalls(value any) []TextToolCall {
	calls := make([]TextToolCall, 0)
	seen := make(map[string]bool)
	var walk func(any, int)
	walk = func(current any, depth int) {
		if depth > 12 || current == nil {
			return
		}
		switch typed := current.(type) {
		case []any:
			for _, item := range typed {
				walk(item, depth+1)
			}
		case map[string]any:
			itemType := strings.ToLower(stringField(typed["type"]))
			function, hasFunction := typed["function"].(map[string]any)
			name := stringField(typed["name"])
			arguments := typed["arguments"]
			if hasFunction {
				if name == "" {
					name = stringField(function["name"])
				}
				if arguments == nil {
					arguments = function["arguments"]
				}
			}
			isCall := itemType == "function_call" || itemType == "tool_call" || (hasFunction && firstNonEmptyString(typed, "call_id", "id") != "")
			if isCall && name != "" {
				id := firstNonEmptyString(typed, "call_id", "id")
				if id == "" {
					id = fmt.Sprintf("call_%d", len(calls)+1)
				}
				args := jsonStringValue(arguments, "{}")
				key := id + "\x00" + name + "\x00" + args
				if !seen[key] {
					seen[key] = true
					calls = append(calls, TextToolCall{
						ID: id, Type: "function", Function: TextToolFunction{Name: name, Arguments: args},
						ThoughtSignature: firstNonEmptyString(typed, "thought_signature", "thoughtSignature"),
					})
				}
			}
			if legacy, ok := typed["function_call"].(map[string]any); ok {
				legacyCopy := make(map[string]any, len(legacy)+2)
				for key, item := range legacy {
					legacyCopy[key] = item
				}
				legacyCopy["type"] = "function_call"
				legacyCopy["call_id"] = firstNonEmptyString(typed, "call_id", "id")
				walk(legacyCopy, depth+1)
			}
			if gemini, ok := typed["functionCall"].(map[string]any); ok {
				walk(map[string]any{
					"type": "function_call", "call_id": firstNonEmptyString(gemini, "id"),
					"name": gemini["name"], "arguments": gemini["args"],
					"thoughtSignature": typed["thoughtSignature"],
				}, depth+1)
			}
			for _, key := range []string{"response", "output", "choices", "message", "delta", "tool_calls", "content", "parts", "candidates"} {
				walk(typed[key], depth+1)
			}
		}
	}
	walk(value, 0)
	return calls
}

func extractTextFinishReason(value any) string {
	var walk func(any, int) string
	walk = func(current any, depth int) string {
		if depth > 8 || current == nil {
			return ""
		}
		switch typed := current.(type) {
		case []any:
			for _, item := range typed {
				if result := walk(item, depth+1); result != "" {
					return result
				}
			}
		case map[string]any:
			if reason := firstNonEmptyString(typed, "finish_reason", "finishReason"); reason != "" {
				return reason
			}
			for _, key := range []string{"choices", "response", "candidates"} {
				if result := walk(typed[key], depth+1); result != "" {
					return result
				}
			}
			if status := stringField(typed["status"]); status == "completed" {
				return "stop"
			}
		}
		return ""
	}
	return walk(value, 0)
}

func collectResponseText(value any, depth int) string {
	if depth > 10 || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case []any:
		var builder strings.Builder
		for _, item := range typed {
			builder.WriteString(collectResponseText(item, depth+1))
		}
		return builder.String()
	case map[string]any:
		itemType := strings.ToLower(stringField(typed["type"]))
		if itemType == "output_text" || itemType == "text" {
			if text := stringField(typed["text"]); text != "" {
				return text
			}
		}
		for _, key := range []string{"output", "choices", "content", "message", "delta", "response", "item", "part"} {
			if text := collectResponseText(typed[key], depth+1); text != "" {
				return text
			}
		}
	}
	return ""
}

func (c *OpenAICompatibleClient) generateResponseImages(ctx context.Context, imageRequest ImageGenerationRequest, modelID string) (ImageGenerationResponse, error) {
	count := imageRequest.N
	if count <= 0 {
		count = 1
	}
	if count > 15 {
		count = 15
	}

	response := ImageGenerationResponse{
		Created: time.Now().Unix(),
		Data:    make([]GeneratedImage, 0, count),
		Model:   modelID,
	}
	for range count {
		body := map[string]any{
			"model": modelID,
			"input": strings.TrimSpace(imageRequest.Prompt),
			"tools": []map[string]any{
				responseImageGenerationTool(imageRequest),
			},
		}

		var raw json.RawMessage
		if err := c.doLongJSON(ctx, http.MethodPost, "/responses", body, &raw); err != nil {
			return ImageGenerationResponse{}, err
		}
		normalized, err := normalizeImageGenerationResponse(raw, modelID)
		if err != nil {
			return ImageGenerationResponse{}, err
		}
		response.Data = append(response.Data, normalized.Data...)
		if normalized.Created > 0 {
			response.Created = normalized.Created
		}
	}
	if len(response.Data) == 0 {
		return ImageGenerationResponse{}, errors.New("provider image response did not include image data")
	}
	return response, nil
}

func responseImageGenerationTool(imageRequest ImageGenerationRequest) map[string]any {
	tool := map[string]any{"type": "image_generation"}
	if strings.TrimSpace(imageRequest.Size) != "" {
		tool["size"] = strings.TrimSpace(imageRequest.Size)
	}
	if strings.TrimSpace(imageRequest.Quality) != "" {
		tool["quality"] = strings.TrimSpace(imageRequest.Quality)
	}
	for key, value := range imageRequest.Extra {
		key = strings.TrimSpace(key)
		if key == "" || strings.EqualFold(key, "response_format") {
			continue
		}
		tool[key] = value
	}
	return tool
}

func (c *OpenAICompatibleClient) generateGeminiImages(ctx context.Context, imageRequest ImageGenerationRequest, modelID string) (ImageGenerationResponse, error) {
	count := imageRequest.N
	if count <= 0 {
		count = 1
	}
	if count > 15 {
		count = 15
	}

	response := ImageGenerationResponse{
		Created: time.Now().Unix(),
		Data:    make([]GeneratedImage, 0, count),
		Model:   modelID,
	}
	for range count {
		body := geminiGenerateContentBody(strings.TrimSpace(imageRequest.Prompt))
		body["generationConfig"] = map[string]any{
			"responseModalities": []string{"TEXT", "IMAGE"},
		}

		var raw json.RawMessage
		if err := c.doLongGeminiJSON(ctx, http.MethodPost, geminiGenerateContentPath(modelID), body, &raw); err != nil {
			return ImageGenerationResponse{}, err
		}

		normalized, err := normalizeImageGenerationResponse(raw, modelID)
		if err != nil {
			return ImageGenerationResponse{}, err
		}
		response.Data = append(response.Data, normalized.Data...)
		if normalized.Created > 0 {
			response.Created = normalized.Created
		}
	}
	if len(response.Data) == 0 {
		return ImageGenerationResponse{}, errors.New("provider image response did not include image data")
	}
	return response, nil
}

func geminiGenerateContentBody(prompt string) map[string]any {
	return map[string]any{
		"contents": []map[string]any{
			{
				"role": "user",
				"parts": []map[string]string{
					{"text": prompt},
				},
			},
		},
	}
}

func geminiGenerateContentPath(modelID string) string {
	modelName := strings.TrimPrefix(strings.TrimSpace(modelID), "models/")
	return "/models/" + url.PathEscape(modelName) + ":generateContent"
}

func extractGeminiText(payload json.RawMessage) (string, error) {
	var value any
	if err := json.Unmarshal(payload, &value); err != nil {
		return "", err
	}
	if message := providerPayloadErrorMessage(value); message != "" {
		return "", errors.New(message)
	}

	text := strings.TrimSpace(collectGeminiText(value, 0))
	if text == "" {
		return "", errors.New("provider text response did not include text")
	}
	return text, nil
}

func collectGeminiText(value any, depth int) string {
	if depth > 8 || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case []any:
		var builder strings.Builder
		for _, item := range typed {
			builder.WriteString(collectGeminiText(item, depth+1))
		}
		return builder.String()
	case map[string]any:
		if text := stringField(typed["text"]); text != "" {
			return text
		}
		for _, key := range []string{"candidates", "content", "parts"} {
			if text := collectGeminiText(typed[key], depth+1); text != "" {
				return text
			}
		}
	}
	return ""
}

func (c *OpenAICompatibleClient) EditImages(ctx context.Context, imageRequest ImageEditRequest) (ImageGenerationResponse, error) {
	if len(imageRequest.Files) == 0 {
		return ImageGenerationResponse{}, errors.New("at least one image file is required")
	}

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	writeField := func(key, value string) error {
		value = strings.TrimSpace(value)
		if value == "" {
			return nil
		}
		return writer.WriteField(key, value)
	}

	modelID := strings.TrimSpace(imageRequest.Model)
	if modelID == "" {
		modelID = strings.TrimSpace(c.config.ImageModel)
	}
	if modelID == "" {
		return ImageGenerationResponse{}, ErrImageModelNotConfigured
	}
	strictGPTImage2Edit := isGPTImage2Model(modelID)
	if err := writeField("model", modelID); err != nil {
		return ImageGenerationResponse{}, err
	}
	if err := writeField("prompt", imageRequest.Prompt); err != nil {
		return ImageGenerationResponse{}, err
	}
	if err := writeField("size", imageRequest.Size); err != nil {
		return ImageGenerationResponse{}, err
	}
	if err := writeField("quality", imageRequest.Quality); err != nil {
		return ImageGenerationResponse{}, err
	}
	if err := writeField("style", imageRequest.Style); err != nil {
		return ImageGenerationResponse{}, err
	}
	if !strictGPTImage2Edit {
		if err := writeField("response_format", imageRequest.ResponseFormat); err != nil {
			return ImageGenerationResponse{}, err
		}
	}
	if imageRequest.N > 0 && !strictGPTImage2Edit {
		if err := writer.WriteField("n", strconv.Itoa(imageRequest.N)); err != nil {
			return ImageGenerationResponse{}, err
		}
	}
	for key, value := range imageRequest.Extra {
		if strictGPTImage2Edit && shouldOmitGPTImage2EditExtra(key) {
			continue
		}
		if err := writeField(key, value); err != nil {
			return ImageGenerationResponse{}, err
		}
	}

	for _, file := range imageRequest.Files {
		if file.File == nil {
			continue
		}
		fieldName := strings.TrimSpace(file.FieldName)
		if fieldName == "" {
			fieldName = "image"
		}
		fileName := strings.TrimSpace(file.FileName)
		if fileName == "" {
			fileName = "image.png"
		}
		contentType, prefix, err := imageContentTypeForUpload(file.Header, fileName, file.File)
		if err != nil {
			return ImageGenerationResponse{}, err
		}
		part, err := createMultipartFilePart(writer, fieldName, fileName, contentType)
		if err != nil {
			return ImageGenerationResponse{}, err
		}
		if len(prefix) > 0 {
			if _, err := part.Write(prefix); err != nil {
				return ImageGenerationResponse{}, err
			}
		}
		if _, err := io.Copy(part, file.File); err != nil {
			return ImageGenerationResponse{}, err
		}
	}

	if err := writer.Close(); err != nil {
		return ImageGenerationResponse{}, err
	}

	var raw json.RawMessage
	if err := c.doLongMultipart(ctx, "/images/edits", body, writer.FormDataContentType(), &raw); err != nil {
		return ImageGenerationResponse{}, err
	}
	return normalizeImageGenerationResponse(raw, modelID)
}

func isGPTImage2Model(modelID string) bool {
	return IsGPTImage2Model(modelID)
}

func IsGPTImage2Model(modelID string) bool {
	raw := strings.ToLower(strings.TrimSpace(modelID))
	normalized := normalizeModelToken(raw)
	compact := strings.ReplaceAll(normalized, "-", "")
	return normalized == "gpt-image-2" ||
		strings.HasPrefix(normalized, "gpt-image-2-") ||
		strings.HasSuffix(normalized, "-gpt-image-2") ||
		strings.Contains(normalized, "-gpt-image-2-") ||
		compact == "gptimage2" ||
		strings.HasPrefix(compact, "gptimage2") ||
		strings.HasSuffix(compact, "gptimage2")
}

func isDedicatedImageModel(modelID string) bool {
	normalized := normalizeModelToken(strings.ToLower(strings.TrimSpace(modelID)))
	return strings.HasPrefix(normalized, "gpt-image") ||
		strings.HasPrefix(normalized, "dall-e") ||
		strings.HasPrefix(normalized, "dalle") ||
		strings.Contains(normalized, "seedream") ||
		strings.Contains(normalized, "flux") ||
		strings.Contains(normalized, "sdxl") ||
		strings.Contains(normalized, "stable-diffusion") ||
		strings.Contains(normalized, "midjourney") ||
		strings.Contains(normalized, "imagen")
}

func shouldUseResponsesImageGeneration(modelID string) bool {
	normalized := normalizeModelToken(strings.ToLower(strings.TrimSpace(modelID)))
	if normalized == "" || isDedicatedImageModel(normalized) {
		return false
	}
	return strings.HasPrefix(normalized, "gpt-5") ||
		strings.HasPrefix(normalized, "gpt-4.1") ||
		strings.HasPrefix(normalized, "gpt-4-1") ||
		strings.HasPrefix(normalized, "gpt-4o") ||
		normalized == "o1" ||
		normalized == "o3" ||
		normalized == "o4" ||
		strings.HasPrefix(normalized, "o1-") ||
		strings.HasPrefix(normalized, "o3-") ||
		strings.HasPrefix(normalized, "o4-")
}

func normalizeModelToken(value string) string {
	var builder strings.Builder
	lastDash := false
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			builder.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash {
			builder.WriteByte('-')
			lastDash = true
		}
	}
	return strings.Trim(builder.String(), "-")
}

func shouldOmitGPTImage2EditExtra(key string) bool {
	return ShouldOmitGPTImage2EditExtra(key)
}

func ShouldOmitGPTImage2EditExtra(key string) bool {
	switch strings.ToLower(strings.TrimSpace(key)) {
	case "output_format", "response_format", "n":
		return true
	default:
		return false
	}
}

func (c *OpenAICompatibleClient) ProxyJSON(ctx context.Context, method string, path string, body any, longRequest bool) (json.RawMessage, error) {
	var raw json.RawMessage
	var err error
	if longRequest {
		err = c.doLongJSON(ctx, method, path, body, &raw)
	} else {
		err = c.doJSON(ctx, method, path, body, &raw)
	}
	return raw, err
}

func (c *OpenAICompatibleClient) ProxyMultipart(ctx context.Context, path string, fields map[string]string, files []ProxyMultipartFile, longRequest bool) (json.RawMessage, error) {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	for key, value := range fields {
		if strings.TrimSpace(key) == "" {
			continue
		}
		if err := writer.WriteField(key, value); err != nil {
			return nil, err
		}
	}
	for _, file := range files {
		if file.File == nil {
			continue
		}
		fieldName := strings.TrimSpace(file.FieldName)
		if fieldName == "" {
			fieldName = "file"
		}
		fileName := strings.TrimSpace(file.FileName)
		if fileName == "" {
			fileName = "upload.bin"
		}
		contentType := strings.TrimSpace(file.Header.Get("Content-Type"))
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		part, err := createMultipartFilePart(writer, fieldName, fileName, contentType)
		if err != nil {
			return nil, err
		}
		if _, err := io.Copy(part, file.File); err != nil {
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}

	var raw json.RawMessage
	var err error
	if longRequest {
		err = c.doLongMultipart(ctx, path, body, writer.FormDataContentType(), &raw)
	} else {
		err = c.doMultipart(ctx, path, body, writer.FormDataContentType(), &raw)
	}
	return raw, err
}

func ImageContentTypeForUpload(header textproto.MIMEHeader, fileName string, file io.Reader) (string, []byte, error) {
	return imageContentTypeForUpload(header, fileName, file)
}

func imageContentTypeForUpload(header textproto.MIMEHeader, fileName string, file io.Reader) (string, []byte, error) {
	prefix := make([]byte, 512)
	n, err := io.ReadFull(file, prefix)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		return "", nil, err
	}
	prefix = prefix[:n]
	headerContentType := normalizedImageContentType(header.Get("Content-Type"))
	detectedContentType := detectedImageContentType(prefix)
	if len(prefix) > 0 {
		if detectedContentType == "" {
			return "", prefix, ErrUnsupportedImageUpload
		}
		if headerContentType != "" && headerContentType != detectedContentType {
			return "", prefix, ErrUnsupportedImageUpload
		}
		return detectedContentType, prefix, nil
	}
	if headerContentType != "" {
		return headerContentType, prefix, nil
	}
	if contentType := imageContentTypeFromFilename(fileName); contentType != "" {
		return contentType, prefix, nil
	}
	return "", prefix, ErrUnsupportedImageUpload
}

func normalizedImageContentType(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	if value == "" || value == "application/octet-stream" {
		return ""
	}
	if semicolon := strings.Index(value, ";"); semicolon >= 0 {
		value = strings.TrimSpace(value[:semicolon])
	}
	switch value {
	case "image/png", "image/jpeg", "image/webp", "image/gif":
		return value
	case "image/jpg":
		return "image/jpeg"
	default:
		return ""
	}
}

func detectedImageContentType(prefix []byte) string {
	if contentType := normalizedImageContentType(http.DetectContentType(prefix)); contentType != "" {
		return contentType
	}
	if len(prefix) >= 12 && string(prefix[0:4]) == "RIFF" && string(prefix[8:12]) == "WEBP" {
		return "image/webp"
	}
	return ""
}

func imageContentTypeFromFilename(fileName string) string {
	extension := strings.ToLower(filepath.Ext(fileName))
	if contentType := normalizedImageContentType(mime.TypeByExtension(extension)); contentType != "" {
		return contentType
	}
	switch extension {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	default:
		return ""
	}
}

func createMultipartFilePart(writer *multipart.Writer, fieldName string, fileName string, contentType string) (io.Writer, error) {
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="%s"; filename="%s"`, escapeMultipartQuote(fieldName), escapeMultipartQuote(fileName)))
	header.Set("Content-Type", strings.TrimSpace(contentType))
	return writer.CreatePart(header)
}

func escapeMultipartQuote(value string) string {
	value = strings.ReplaceAll(value, "\\", "\\\\")
	value = strings.ReplaceAll(value, `"`, "\\\"")
	return value
}

func (c *OpenAICompatibleClient) ProxyBlob(ctx context.Context, method string, path string, body any, longRequest bool) ([]byte, string, error) {
	client := c.httpClient
	if longRequest {
		client = c.longRequestHTTPClient()
	}
	u, err := joinBaseURL(c.config.BaseURL, path)
	if err != nil {
		return nil, "", err
	}

	var reader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			return nil, "", err
		}
		reader = bytes.NewReader(payload)
	}

	req, err := http.NewRequestWithContext(ctx, method, u, reader)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Accept", "*/*")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.apiKey != "" {
		c.applyAuthHeaders(req)
	}

	res, err := client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer res.Body.Close()

	responseBody, err := io.ReadAll(io.LimitReader(res.Body, maxProviderBinaryResponseBytes))
	if err != nil {
		return nil, "", err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, "", &ProviderHTTPError{Method: method, URL: u, StatusCode: res.StatusCode, Body: string(responseBody)}
	}
	return responseBody, res.Header.Get("Content-Type"), nil
}

func normalizeImageGenerationResponse(payload json.RawMessage, fallbackModel string) (ImageGenerationResponse, error) {
	var value any
	if err := json.Unmarshal(payload, &value); err != nil {
		return ImageGenerationResponse{}, err
	}
	if message := providerPayloadErrorMessage(value); message != "" {
		return ImageGenerationResponse{}, errors.New(message)
	}

	images := make([]GeneratedImage, 0)
	seen := make(map[string]bool)
	collectGeneratedImages(value, 0, seen, &images)
	if len(images) == 0 {
		return ImageGenerationResponse{}, errors.New("provider image response did not include image data")
	}

	response := ImageGenerationResponse{
		Created: topLevelInt64(value, "created"),
		Data:    images,
		Model:   topLevelString(value, "model"),
	}
	if response.Model == "" {
		response.Model = fallbackModel
	}
	return response, nil
}

func providerPayloadErrorMessage(value any) string {
	record, ok := value.(map[string]any)
	if !ok {
		return ""
	}
	if msg := stringField(record["msg"]); msg != "" {
		return msg
	}
	if message := nestedMessage(record["error"]); message != "" {
		return message
	}
	if feedback, ok := record["promptFeedback"].(map[string]any); ok {
		if reason := stringField(feedback["blockReason"]); reason != "" {
			return "Gemini rejected the request: " + reason
		}
	}
	return ""
}

func nestedMessage(value any) string {
	if text := stringField(value); text != "" {
		return text
	}
	record, ok := value.(map[string]any)
	if !ok {
		return ""
	}
	if message := stringField(record["message"]); message != "" {
		return message
	}
	if status := stringField(record["status"]); status != "" {
		return status
	}
	return ""
}

func collectGeneratedImages(value any, depth int, seen map[string]bool, images *[]GeneratedImage) {
	if depth > 8 || value == nil {
		return
	}

	switch typed := value.(type) {
	case string:
		if looksLikeImageURL(typed) {
			addGeneratedImage(images, seen, GeneratedImage{URL: typed})
		}
	case []any:
		for _, item := range typed {
			collectGeneratedImages(item, depth+1, seen, images)
		}
	case map[string]any:
		revisedPrompt := stringField(typed["revised_prompt"])
		if strings.ToLower(stringField(typed["type"])) == "image_generation_call" {
			if result := stringField(typed["result"]); result != "" {
				addGeneratedImage(images, seen, imageFromBase64(result, imageMimeType(typed), revisedPrompt))
			}
		}
		collectInlineImageData(typed, revisedPrompt, seen, images)
		for _, key := range imageBase64Keys {
			if raw := stringField(typed[key]); raw != "" {
				addGeneratedImage(images, seen, imageFromBase64(raw, imageMimeType(typed), revisedPrompt))
			}
		}
		for _, key := range imageURLKeys {
			item := typed[key]
			if raw := stringField(item); raw != "" && looksLikeImageURL(raw) {
				addGeneratedImage(images, seen, GeneratedImage{URL: raw, RevisedPrompt: revisedPrompt})
				continue
			}
			collectGeneratedImages(item, depth+1, seen, images)
		}
		for _, key := range imageContainerKeys {
			collectGeneratedImages(typed[key], depth+1, seen, images)
		}
	}
}

func collectInlineImageData(record map[string]any, revisedPrompt string, seen map[string]bool, images *[]GeneratedImage) {
	for _, key := range []string{"inlineData", "inline_data"} {
		inline, ok := record[key].(map[string]any)
		if !ok {
			continue
		}
		data := stringField(inline["data"])
		if data == "" {
			continue
		}
		addGeneratedImage(images, seen, imageFromBase64(data, imageMimeType(inline), revisedPrompt))
	}
}

func addGeneratedImage(images *[]GeneratedImage, seen map[string]bool, image GeneratedImage) {
	key := image.URL
	if key == "" {
		key = image.B64JSON
	}
	if key == "" || seen[key] {
		return
	}
	seen[key] = true
	*images = append(*images, image)
}

func imageFromBase64(value string, mimeType string, revisedPrompt string) GeneratedImage {
	value = strings.TrimSpace(value)
	if looksLikeImageURL(value) {
		return GeneratedImage{URL: value, RevisedPrompt: revisedPrompt}
	}
	if comma := strings.Index(value, ","); strings.HasPrefix(strings.ToLower(value), "data:image/") && comma >= 0 {
		value = value[comma+1:]
	}
	return GeneratedImage{B64JSON: value, MimeType: mimeType, RevisedPrompt: revisedPrompt}
}

func imageMimeType(record map[string]any) string {
	if value := stringField(record["mime_type"]); value != "" {
		return value
	}
	if value := stringField(record["mimeType"]); value != "" {
		return value
	}
	return "image/png"
}

func looksLikeImageURL(value string) bool {
	text := strings.TrimSpace(value)
	if text == "" {
		return false
	}
	lower := strings.ToLower(text)
	return strings.HasPrefix(lower, "data:image/") ||
		strings.HasPrefix(lower, "http://") ||
		strings.HasPrefix(lower, "https://") ||
		strings.HasPrefix(text, "/output/") ||
		strings.HasPrefix(text, "/assets/")
}

func topLevelString(value any, key string) string {
	record, ok := value.(map[string]any)
	if !ok {
		return ""
	}
	return stringField(record[key])
}

func topLevelInt64(value any, key string) int64 {
	record, ok := value.(map[string]any)
	if !ok {
		return 0
	}
	switch typed := record[key].(type) {
	case float64:
		return int64(typed)
	case int64:
		return typed
	case int:
		return int64(typed)
	default:
		return 0
	}
}

func stringField(value any) string {
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text)
	}
	return ""
}

func (c *OpenAICompatibleClient) doJSON(ctx context.Context, method string, path string, body any, target any) error {
	u, err := joinBaseURL(c.config.BaseURL, path)
	if err != nil {
		return err
	}

	return c.doJSONURL(ctx, method, u, body, target)
}

func (c *OpenAICompatibleClient) doGeminiJSON(ctx context.Context, method string, path string, body any, target any) error {
	u, err := joinGeminiBaseURL(c.config.BaseURL, path)
	if err != nil {
		return err
	}

	return c.doJSONURL(ctx, method, u, body, target)
}

func (c *OpenAICompatibleClient) doLongJSON(ctx context.Context, method string, path string, body any, target any) error {
	u, err := joinBaseURL(c.config.BaseURL, path)
	if err != nil {
		return err
	}

	return c.doJSONURLWithClient(ctx, c.longRequestHTTPClient(), method, u, body, target)
}

func (c *OpenAICompatibleClient) doLongGeminiJSON(ctx context.Context, method string, path string, body any, target any) error {
	u, err := joinGeminiBaseURL(c.config.BaseURL, path)
	if err != nil {
		return err
	}

	return c.doJSONURLWithClient(ctx, c.longRequestHTTPClient(), method, u, body, target)
}

func (c *OpenAICompatibleClient) doJSONURL(ctx context.Context, method string, u string, body any, target any) error {
	return c.doJSONURLWithClient(ctx, c.httpClient, method, u, body, target)
}

func (c *OpenAICompatibleClient) doJSONURLWithClient(ctx context.Context, client *http.Client, method string, u string, body any, target any) error {
	u = c.applyAuthQueryParam(u)
	var reader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(payload)
	}

	req, err := http.NewRequestWithContext(ctx, method, u, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	c.applyExtraHeaders(req)
	if c.config.ProviderType == model.ModelProviderTypeAliyunYike && method == http.MethodPost && strings.Contains(strings.ToLower(u), "/video-generation/video-synthesis") {
		req.Header.Set("X-DashScope-Async", "enable")
	}
	if c.apiKey != "" {
		c.applyAuthHeaders(req)
	}

	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()

	responseBody, err := io.ReadAll(io.LimitReader(res.Body, maxProviderResponseBytes))
	if err != nil {
		return err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return &ProviderHTTPError{Method: method, URL: u, StatusCode: res.StatusCode, Body: string(responseBody)}
	}

	if target == nil || len(responseBody) == 0 {
		return nil
	}

	return decodeProviderJSONResponse(responseBody, res.Header.Get("Content-Type"), target)
}

func decodeProviderJSONResponse(responseBody []byte, contentType string, target any) error {
	payload := bytes.TrimSpace(responseBody)
	if isProviderSSEResponse(payload, contentType) {
		var err error
		payload, err = normalizeProviderSSEResponse(payload)
		if err != nil {
			return err
		}
	}
	return json.Unmarshal(payload, target)
}

func isProviderSSEResponse(payload []byte, contentType string) bool {
	mediaType, _, _ := mime.ParseMediaType(contentType)
	if strings.EqualFold(mediaType, "text/event-stream") {
		return true
	}
	trimmed := bytes.TrimSpace(bytes.TrimPrefix(payload, []byte("\xef\xbb\xbf")))
	return bytes.HasPrefix(trimmed, []byte("event:")) || bytes.HasPrefix(trimmed, []byte("data:"))
}

type providerSSEEvent struct {
	name string
	data json.RawMessage
}

type providerSSEToolCall struct {
	id        string
	name      string
	arguments strings.Builder
}

func normalizeProviderSSEResponse(payload []byte) ([]byte, error) {
	events, err := parseProviderSSEEvents(payload)
	if err != nil {
		return nil, err
	}
	if len(events) == 0 {
		return nil, errors.New("provider SSE response did not include a JSON event")
	}

	var deltaText strings.Builder
	doneText := ""
	modelID := ""
	finishReason := ""
	toolCalls := make(map[int]*providerSSEToolCall)
	var lastPayload json.RawMessage
	var terminalResponse json.RawMessage
	for _, event := range events {
		lastPayload = event.data
		var value any
		if err := json.Unmarshal(event.data, &value); err != nil {
			return nil, errors.New("provider SSE response included invalid JSON data")
		}
		record, _ := value.(map[string]any)
		eventType := strings.ToLower(strings.TrimSpace(event.name))
		if eventType == "" {
			eventType = strings.ToLower(stringField(record["type"]))
		}
		if message := providerPayloadErrorMessage(value); message != "" {
			return nil, errors.New(message)
		}
		if strings.Contains(eventType, "error") {
			message := stringField(record["message"])
			if message == "" {
				message = "provider returned an SSE error event"
			}
			return nil, errors.New(message)
		}

		if model := providerSSEModel(record); model != "" {
			modelID = model
		}
		collectProviderSSEToolCalls(record, eventType, toolCalls)
		if reason := providerSSEFinishReason(record); reason != "" {
			finishReason = reason
		}
		if response, ok := record["response"].(map[string]any); ok && strings.Contains(eventType, "completed") {
			payload, marshalErr := json.Marshal(response)
			if marshalErr != nil {
				return nil, marshalErr
			}
			// Some Responses gateways emit the generated text only through delta/item
			// events and leave response.completed.output empty. Do not discard text
			// already accumulated from those earlier events.
			if strings.TrimSpace(collectResponseText(response, 0)) != "" || len(extractTextToolCalls(response)) > 0 {
				return payload, nil
			}
			terminalResponse = payload
			continue
		}
		if strings.Contains(eventType, "output_text.done") {
			if text := stringField(record["text"]); text != "" {
				doneText = text
			}
			continue
		}
		if strings.Contains(eventType, "output_text.delta") {
			deltaText.WriteString(rawStringField(record["delta"]))
			continue
		}
		if strings.Contains(eventType, "output_item.done") {
			if text := strings.TrimSpace(collectResponseText(record["item"], 0)); text != "" {
				doneText = text
			}
			continue
		}
		if strings.Contains(eventType, "content_part.done") {
			if text := strings.TrimSpace(collectResponseText(record["part"], 0)); text != "" {
				doneText = text
			}
			continue
		}
		if text := collectChatCompletionDelta(record); text != "" {
			deltaText.WriteString(text)
		}
	}

	text := strings.TrimSpace(doneText)
	if text == "" {
		text = strings.TrimSpace(deltaText.String())
	}
	if text != "" || len(toolCalls) > 0 {
		result := map[string]any{}
		if text != "" {
			result["output_text"] = text
		}
		if modelID != "" {
			result["model"] = modelID
		}
		if finishReason != "" {
			result["finish_reason"] = finishReason
		}
		if output := providerSSEToolCallOutput(toolCalls); len(output) > 0 {
			result["output"] = output
		}
		return json.Marshal(result)
	}
	if len(terminalResponse) > 0 {
		return terminalResponse, nil
	}
	return lastPayload, nil
}

func collectProviderSSEToolCalls(record map[string]any, eventType string, calls map[int]*providerSSEToolCall) {
	choices, _ := record["choices"].([]any)
	for _, choice := range choices {
		choiceRecord, _ := choice.(map[string]any)
		delta, _ := choiceRecord["delta"].(map[string]any)
		rawCalls, _ := delta["tool_calls"].([]any)
		for fallbackIndex, rawCall := range rawCalls {
			callRecord, _ := rawCall.(map[string]any)
			index := intField(callRecord["index"], fallbackIndex)
			call := providerSSEToolCallAt(calls, index)
			if id := stringField(callRecord["id"]); id != "" {
				call.id = id
			}
			if function, ok := callRecord["function"].(map[string]any); ok {
				if name := stringField(function["name"]); name != "" {
					call.name = name
				}
				call.arguments.WriteString(rawStringField(function["arguments"]))
			}
		}
	}

	item, _ := record["item"].(map[string]any)
	if strings.EqualFold(stringField(item["type"]), "function_call") {
		index := intField(record["output_index"], len(calls))
		call := providerSSEToolCallAt(calls, index)
		if id := firstNonEmptyString(item, "call_id", "id"); id != "" {
			call.id = id
		}
		if name := stringField(item["name"]); name != "" {
			call.name = name
		}
		if arguments := rawStringField(item["arguments"]); arguments != "" {
			call.arguments.Reset()
			call.arguments.WriteString(arguments)
		}
	}
	if strings.Contains(eventType, "function_call_arguments.delta") {
		index := intField(record["output_index"], 0)
		providerSSEToolCallAt(calls, index).arguments.WriteString(rawStringField(record["delta"]))
	}
	if strings.Contains(eventType, "function_call_arguments.done") {
		index := intField(record["output_index"], 0)
		if arguments := rawStringField(record["arguments"]); arguments != "" {
			call := providerSSEToolCallAt(calls, index)
			call.arguments.Reset()
			call.arguments.WriteString(arguments)
		}
	}
}

func providerSSEToolCallAt(calls map[int]*providerSSEToolCall, index int) *providerSSEToolCall {
	if index < 0 {
		index = 0
	}
	if calls[index] == nil {
		calls[index] = &providerSSEToolCall{}
	}
	return calls[index]
}

func providerSSEToolCallOutput(calls map[int]*providerSSEToolCall) []map[string]any {
	if len(calls) == 0 {
		return nil
	}
	indexes := make([]int, 0, len(calls))
	for index := range calls {
		indexes = append(indexes, index)
	}
	sort.Ints(indexes)
	result := make([]map[string]any, 0, len(indexes))
	for _, index := range indexes {
		call := calls[index]
		if call == nil || strings.TrimSpace(call.name) == "" {
			continue
		}
		id := strings.TrimSpace(call.id)
		if id == "" {
			id = fmt.Sprintf("call_%d", index+1)
		}
		arguments := call.arguments.String()
		if strings.TrimSpace(arguments) == "" {
			arguments = "{}"
		}
		result = append(result, map[string]any{"type": "function_call", "call_id": id, "name": call.name, "arguments": arguments})
	}
	return result
}

func providerSSEFinishReason(record map[string]any) string {
	choices, _ := record["choices"].([]any)
	for _, choice := range choices {
		if choiceRecord, ok := choice.(map[string]any); ok {
			if reason := stringField(choiceRecord["finish_reason"]); reason != "" {
				return reason
			}
		}
	}
	return firstNonEmptyString(record, "finish_reason", "finishReason")
}

func intField(value any, fallback int) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case json.Number:
		if parsed, err := typed.Int64(); err == nil {
			return int(parsed)
		}
	}
	return fallback
}

func parseProviderSSEEvents(payload []byte) ([]providerSSEEvent, error) {
	normalized := strings.ReplaceAll(string(bytes.TrimPrefix(payload, []byte("\xef\xbb\xbf"))), "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")
	events := make([]providerSSEEvent, 0)
	eventName := ""
	dataLines := make([]string, 0, 1)
	flush := func() error {
		if len(dataLines) == 0 {
			eventName = ""
			return nil
		}
		data := strings.TrimSpace(strings.Join(dataLines, "\n"))
		dataLines = dataLines[:0]
		name := eventName
		eventName = ""
		if data == "" || data == "[DONE]" {
			return nil
		}
		if !json.Valid([]byte(data)) {
			return errors.New("provider SSE response included invalid JSON data")
		}
		events = append(events, providerSSEEvent{name: name, data: json.RawMessage(data)})
		return nil
	}

	for _, line := range strings.Split(normalized, "\n") {
		if line == "" {
			if err := flush(); err != nil {
				return nil, err
			}
			continue
		}
		if strings.HasPrefix(line, ":") {
			continue
		}
		field, value, found := strings.Cut(line, ":")
		if !found {
			continue
		}
		value = strings.TrimPrefix(value, " ")
		switch field {
		case "event":
			if len(dataLines) > 0 {
				if err := flush(); err != nil {
					return nil, err
				}
			}
			eventName = value
		case "data":
			dataLines = append(dataLines, value)
		}
	}
	if err := flush(); err != nil {
		return nil, err
	}
	return events, nil
}

func providerSSEModel(record map[string]any) string {
	if modelID := stringField(record["model"]); modelID != "" {
		return modelID
	}
	if response, ok := record["response"].(map[string]any); ok {
		return stringField(response["model"])
	}
	return ""
}

func collectChatCompletionDelta(record map[string]any) string {
	choices, _ := record["choices"].([]any)
	var text strings.Builder
	for _, choice := range choices {
		choiceRecord, _ := choice.(map[string]any)
		delta, _ := choiceRecord["delta"].(map[string]any)
		text.WriteString(rawStringField(delta["content"]))
	}
	return text.String()
}

func rawStringField(value any) string {
	text, _ := value.(string)
	return text
}

func (c *OpenAICompatibleClient) doMultipart(ctx context.Context, path string, body io.Reader, contentType string, target any) error {
	return c.doMultipartWithClient(ctx, c.httpClient, path, body, contentType, target)
}

func (c *OpenAICompatibleClient) doLongMultipart(ctx context.Context, path string, body io.Reader, contentType string, target any) error {
	return c.doMultipartWithClient(ctx, c.longRequestHTTPClient(), path, body, contentType, target)
}

func (c *OpenAICompatibleClient) doMultipartWithClient(ctx context.Context, client *http.Client, path string, body io.Reader, contentType string, target any) error {
	u, err := joinBaseURL(c.config.BaseURL, path)
	if err != nil {
		return err
	}
	u = c.applyAuthQueryParam(u)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, body)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", contentType)
	c.applyExtraHeaders(req)
	c.applyAuthHeaders(req)

	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()

	responseBody, err := io.ReadAll(io.LimitReader(res.Body, maxProviderResponseBytes))
	if err != nil {
		return err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return &ProviderHTTPError{Method: http.MethodPost, URL: u, StatusCode: res.StatusCode, Body: string(responseBody)}
	}

	if target == nil || len(responseBody) == 0 {
		return nil
	}

	return json.Unmarshal(responseBody, target)
}

func (c *OpenAICompatibleClient) longRequestHTTPClient() *http.Client {
	return c.longClient
}

func (c *OpenAICompatibleClient) applyAuthHeaders(req *http.Request) {
	if c.apiKey == "" {
		return
	}
	switch c.config.AuthType {
	case model.ModelProviderAuthTypeBearer:
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	case model.ModelProviderAuthTypeXAPIKey:
		req.Header.Set("x-api-key", c.apiKey)
	case model.ModelProviderAuthTypeXGoogAPIKey:
		req.Header.Set("x-goog-api-key", c.apiKey)
	case model.ModelProviderAuthTypeAutoAPIKey:
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
		req.Header.Set("x-api-key", c.apiKey)
		req.Header.Set("x-goog-api-key", c.apiKey)
	case model.ModelProviderAuthTypeCustomHeader:
		header := strings.TrimSpace(c.config.CustomAuthHeader)
		if header != "" {
			req.Header.Set(header, c.apiKey)
		}
	}
}

func (c *OpenAICompatibleClient) applyAuthQueryParam(rawURL string) string {
	if c.apiKey == "" || c.config.AuthType != model.ModelProviderAuthTypeQueryParam {
		return rawURL
	}
	name := strings.TrimSpace(c.config.AuthQueryParam)
	if name == "" {
		name = "key"
	}
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}
	query := parsed.Query()
	query.Set(name, c.apiKey)
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func (c *OpenAICompatibleClient) applyExtraHeaders(req *http.Request) {
	for key, value := range jsonStringMap(c.config.ExtraHeaders) {
		if key == "" || value == "" {
			continue
		}
		req.Header.Set(key, value)
	}
}

func jsonStringMap(raw model.JSONB) map[string]string {
	result := make(map[string]string)
	if len(raw) == 0 {
		return result
	}
	var values map[string]any
	if err := json.Unmarshal(raw, &values); err != nil {
		return result
	}
	for key, value := range values {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		if text, ok := value.(string); ok {
			result[key] = strings.TrimSpace(text)
		}
	}
	return result
}

func (c *OpenAICompatibleClient) usesGeminiNativeAPI() bool {
	parsed, err := url.Parse(strings.TrimSpace(c.config.BaseURL))
	if err != nil {
		return false
	}
	path := strings.ToLower(strings.TrimRight(parsed.Path, "/"))
	if strings.Contains(path, "/openai") {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	if strings.Contains(host, "generativelanguage.googleapis.com") {
		return true
	}

	return c.config.AuthType == model.ModelProviderAuthTypeXGoogAPIKey &&
		(strings.HasSuffix(path, "/v1") || strings.HasSuffix(path, "/v1beta"))
}

func joinBaseURL(baseURL string, path string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return "", err
	}
	if u.Scheme == "" || u.Host == "" {
		return "", errors.New("base_url must include scheme and host")
	}

	requestPath := "/" + strings.TrimLeft(strings.TrimSpace(path), "/")
	basePath := strings.TrimRight(u.Path, "/")
	if requestPathHasAPIVersion(requestPath) {
		u.Path = requestPath
	} else if !basePathHasAPIVersion(basePath) {
		basePath += "/v1"
		u.Path = strings.TrimRight(basePath, "/") + requestPath
	} else {
		u.Path = strings.TrimRight(basePath, "/") + requestPath
	}
	u.RawQuery = ""
	u.Fragment = ""
	return u.String(), nil
}

func requestPathHasAPIVersion(path string) bool {
	path = strings.ToLower(strings.TrimRight(path, "/"))
	return path == "/v1" ||
		path == "/v1beta" ||
		path == "/api/v3" ||
		path == "/api/v1" ||
		strings.HasPrefix(path, "/v1/") ||
		strings.HasPrefix(path, "/v1beta/") ||
		strings.HasPrefix(path, "/api/v3/") ||
		strings.HasPrefix(path, "/api/v1/") ||
		strings.HasPrefix(path, "/api/plan/v3/")
}

func basePathHasAPIVersion(basePath string) bool {
	basePath = strings.ToLower(strings.TrimRight(basePath, "/"))
	return basePath == "/v1" ||
		basePath == "/v1beta" ||
		basePath == "/api/v3" ||
		basePath == "/api/v1" ||
		strings.HasSuffix(basePath, "/v1") ||
		strings.HasSuffix(basePath, "/v1beta") ||
		strings.HasSuffix(basePath, "/api/v3") ||
		strings.HasSuffix(basePath, "/api/v1") ||
		strings.Contains(basePath, "/api/plan/v3")
}

func joinGeminiBaseURL(baseURL string, path string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return "", err
	}
	if u.Scheme == "" || u.Host == "" {
		return "", errors.New("base_url must include scheme and host")
	}

	basePath := strings.TrimRight(u.Path, "/")
	lowerPath := strings.ToLower(basePath)
	if !strings.HasSuffix(lowerPath, "/v1") && !strings.HasSuffix(lowerPath, "/v1beta") {
		basePath += "/v1beta"
	}
	u.Path = strings.TrimRight(basePath, "/") + path
	u.RawQuery = ""
	u.Fragment = ""
	return u.String(), nil
}

func DockerLocalhostHint(baseURL string) string {
	parsed, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return ""
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "localhost" || host == "127.0.0.1" {
		return "如果 API 运行在 Docker 内，localhost 指 API 容器自身；宿主机模型服务请尝试 host.docker.internal 或宿主机局域网 IP。"
	}

	return ""
}
