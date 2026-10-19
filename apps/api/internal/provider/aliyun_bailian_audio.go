package provider

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha1"
	"crypto/tls"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/model"
)

const (
	AliyunBailianAudioPresetID       = "aliyun_bailian_audio"
	BailianWorkspaceIDSecret         = "bailian_workspace_id"
	DefaultAliyunBailianBaseURL      = "https://dashscope.aliyuncs.com"
	DefaultCosyVoiceWSURL            = "wss://dashscope.aliyuncs.com/api-ws/v1/inference"
	DefaultCosyVoiceCloneEndpoint    = "/api/v1/services/audio/tts/customization"
	DefaultMiniMaxBailianTTSEndpoint = "/api/v1/services/aigc/multimodal-generation/generation"
	DefaultFunMusicEndpoint          = "/api/v1/services/audio/music/generation"
	DefaultCosyVoiceModel            = "cosyvoice-v3.5-plus"
	DefaultMiniMaxSpeechModel        = "MiniMax/speech-2.8-hd"
	DefaultFunMusicModel             = "fun-music-v1"
)

var (
	voicePrefixCleanRegex = regexp.MustCompile(`[^a-zA-Z0-9]+`)
	miniMaxVoiceIDRegex   = regexp.MustCompile(`[^a-zA-Z0-9_-]+`)
)

func DefaultAliyunBailianAudioEndpointOverrides() map[string]string {
	return map[string]string{
		"cosyvoice_ws_url":     DefaultCosyVoiceWSURL,
		"voice_clone_endpoint": DefaultCosyVoiceCloneEndpoint,
		"minimax_tts_endpoint": DefaultMiniMaxBailianTTSEndpoint,
		"fun_music_endpoint":   DefaultFunMusicEndpoint,
	}
}

func IsCosyVoiceModel(modelID string) bool {
	lower := strings.ToLower(strings.TrimSpace(modelID))
	return strings.HasPrefix(lower, "cosyvoice") ||
		strings.HasPrefix(lower, "qwen-audio") ||
		strings.HasPrefix(lower, "qwen3-tts")
}

func IsBailianMiniMaxSpeechModel(config model.ModelProviderConfig, modelID string) bool {
	lower := strings.ToLower(strings.TrimSpace(modelID))
	if strings.HasPrefix(lower, "minimax/speech-") {
		return true
	}
	if strings.HasPrefix(lower, "speech-") {
		provType := strings.TrimSpace(config.ProviderType)
		baseLower := strings.ToLower(strings.TrimSpace(config.BaseURL))
		return provType == model.ModelProviderTypeAliyunBailian ||
			strings.Contains(baseLower, "aliyuncs.com")
	}
	return false
}

func IsNativeMiniMaxSpeechModel(config model.ModelProviderConfig, modelID string) bool {
	lower := strings.ToLower(strings.TrimSpace(modelID))
	if !strings.HasPrefix(lower, "speech-") {
		return false
	}
	provType := strings.TrimSpace(config.ProviderType)
	baseLower := strings.ToLower(strings.TrimSpace(config.BaseURL))
	return provType == model.ModelProviderTypeMinimaxHailuo ||
		strings.Contains(baseLower, "minimax.io") ||
		strings.Contains(baseLower, "minimaxi.com")
}

func IsFunMusicModel(modelID string) bool {
	lower := strings.ToLower(strings.TrimSpace(modelID))
	return strings.HasPrefix(lower, "fun-music")
}

func (c *OpenAICompatibleClient) HandlesSpecializedAudio(modelID string) bool {
	if IsNativeMiniMaxSpeechModel(c.config, modelID) {
		return true
	}
	// Only Bailian-hosted suppliers use the DashScope paths; any other supplier keeps
	// the standard /audio/speech proxy even if its model names look alike.
	if !isBailianAudioSupplier(c.config) {
		return false
	}
	return IsCosyVoiceModel(modelID) ||
		IsBailianMiniMaxSpeechModel(c.config, modelID) ||
		IsFunMusicModel(modelID)
}

func isBailianAudioSupplier(config model.ModelProviderConfig) bool {
	return strings.TrimSpace(config.ProviderType) == model.ModelProviderTypeAliyunBailian ||
		strings.Contains(strings.ToLower(config.BaseURL), "aliyuncs.com")
}

type BailianAudioSynthesisInput struct {
	Model          string
	Input          string
	Voice          string
	Format         string
	Speed          float64
	Instructions   string
	Emotion        string
	Lyrics         string
	Gender         string
	IsInstrumental *bool
}

func ParseBailianAudioSynthesisInput(body map[string]any, resolvedModel string) BailianAudioSynthesisInput {
	format := strings.ToLower(strings.TrimSpace(firstNonEmpty(
		stringValue(body["response_format"]),
		stringValue(body["format"]),
		"mp3",
	)))
	if format == "" {
		format = "mp3"
	}
	speed := 1.0
	switch v := body["speed"].(type) {
	case float64:
		if v > 0 {
			speed = v
		}
	case int:
		if v > 0 {
			speed = float64(v)
		}
	case string:
		if parsed, err := strconvParseFloat(v); err == nil && parsed > 0 {
			speed = parsed
		}
	}
	var isInstrumental *bool
	if rawInst, exists := body["is_instrumental"]; exists {
		if b, ok := rawInst.(bool); ok {
			isInstrumental = &b
		}
	}
	return BailianAudioSynthesisInput{
		Model:          strings.TrimSpace(resolvedModel),
		Input:          strings.TrimSpace(firstNonEmpty(stringValue(body["input"]), stringValue(body["prompt"]), stringValue(body["text"]))),
		Voice:          strings.TrimSpace(firstNonEmpty(stringValue(body["voice"]), stringValue(body["voice_id"]))),
		Format:         format,
		Speed:          speed,
		Instructions:   strings.TrimSpace(firstNonEmpty(stringValue(body["instructions"]), stringValue(body["instruction"]))),
		Emotion:        strings.TrimSpace(stringValue(body["emotion"])),
		Lyrics:         strings.TrimSpace(stringValue(body["lyrics"])),
		Gender:         strings.ToLower(strings.TrimSpace(stringValue(body["gender"]))),
		IsInstrumental: isInstrumental,
	}
}

func strconvParseFloat(s string) (float64, error) {
	var f float64
	_, err := fmt.Sscanf(strings.TrimSpace(s), "%f", &f)
	return f, err
}

func (c *OpenAICompatibleClient) SynthesizeSpecializedAudio(
	ctx context.Context,
	body map[string]any,
	resolvedModel string,
	secrets map[string]string,
) ([]byte, string, error) {
	input := ParseBailianAudioSynthesisInput(body, resolvedModel)
	switch {
	case IsFunMusicModel(input.Model):
		return c.SynthesizeFunMusic(ctx, input, secrets)
	case IsBailianMiniMaxSpeechModel(c.config, input.Model):
		return c.SynthesizeBailianMiniMaxSpeech(ctx, input)
	case IsNativeMiniMaxSpeechModel(c.config, input.Model):
		return c.SynthesizeNativeMiniMaxSpeech(ctx, input)
	case IsCosyVoiceModel(input.Model):
		return c.SynthesizeCosyVoiceWebSocket(ctx, input, secrets)
	default:
		return nil, "", fmt.Errorf("unsupported specialized audio model %q", input.Model)
	}
}

// SpecializedAudioUpstreamModel is the model SynthesizeSpecializedAudio actually calls.
// cosyvoice-v3.5 without a cloned/designed voice falls back to cosyvoice-v3-plus/flash.
func (c *OpenAICompatibleClient) SpecializedAudioUpstreamModel(body map[string]any, resolvedModel string) string {
	input := ParseBailianAudioSynthesisInput(body, resolvedModel)
	if IsFunMusicModel(input.Model) ||
		IsBailianMiniMaxSpeechModel(c.config, input.Model) ||
		IsNativeMiniMaxSpeechModel(c.config, input.Model) ||
		!IsCosyVoiceModel(input.Model) {
		return input.Model
	}
	upstream, _ := resolveCosyVoiceModelAndVoice(input.Model, input.Voice, input.Instructions != "")
	return upstream
}

func resolveBailianHostBaseURL(baseURL string, overrides map[string]string, secrets map[string]string, requireWorkspaceForMaas bool) string {
	workspaceID := firstNonEmpty(
		secrets[BailianWorkspaceIDSecret],
		secrets["workspace_id"],
		overrides["bailian_workspace_id"],
		overrides["workspace_id"],
	)
	trimmedBase := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if trimmedBase == "" {
		trimmedBase = DefaultAliyunBailianBaseURL
	}
	if requireWorkspaceForMaas && workspaceID != "" && strings.Contains(strings.ToLower(trimmedBase), "dashscope.aliyuncs.com") {
		return "https://" + workspaceID + ".cn-beijing.maas.aliyuncs.com"
	}
	return trimmedBase
}

// SynthesizeFunMusic calls Alibaba Cloud Bailian Fun-Music (/api/v1/services/audio/music/generation)
// and downloads the resulting audio file from output.audio.url.
func (c *OpenAICompatibleClient) SynthesizeFunMusic(
	ctx context.Context,
	input BailianAudioSynthesisInput,
	secrets map[string]string,
) ([]byte, string, error) {
	overrides := endpointOverridesFromConfig(c.config)
	endpoint := firstNonEmpty(overrides["fun_music_endpoint"], DefaultFunMusicEndpoint)
	hostBase := resolveBailianHostBaseURL(c.config.BaseURL, overrides, secrets, true)
	targetURL := resolveEndpointURL(hostBase, endpoint)

	modelID := input.Model
	if modelID == "" {
		modelID = DefaultFunMusicModel
	}
	format := input.Format
	if format != "wav" {
		format = "mp3"
	}

	inputObj := map[string]any{}
	isInstrumental := input.IsInstrumental != nil && *input.IsInstrumental
	if isInstrumental {
		inputObj["is_instrumental"] = true
		inputObj["prompt"] = input.Input
	} else {
		if input.Lyrics != "" {
			inputObj["lyrics"] = input.Lyrics
			if strings.EqualFold(modelID, "fun-music-preview") && input.Input != "" {
				inputObj["prompt"] = input.Input
			}
		} else {
			inputObj["prompt"] = input.Input
		}
		if !strings.EqualFold(modelID, "fun-music-preview") {
			gender := input.Gender
			if gender != "male" && gender != "female" {
				if strings.Contains(strings.ToLower(input.Voice), "male") && !strings.Contains(strings.ToLower(input.Voice), "female") {
					gender = "male"
				} else {
					gender = "female"
				}
			}
			inputObj["gender"] = gender
		}
	}

	reqBody := map[string]any{
		"model": modelID,
		"input": inputObj,
		"parameters": map[string]any{
			"format": format,
		},
	}

	raw, err := c.doCompatibleJSONRequest(ctx, http.MethodPost, targetURL, reqBody)
	if err != nil {
		return nil, "", err
	}
	var parsed struct {
		Code      string `json:"code"`
		Message   string `json:"message"`
		RequestID string `json:"request_id"`
		Output    struct {
			Audio struct {
				URL  string `json:"url"`
				Data string `json:"data"`
			} `json:"audio"`
		} `json:"output"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, "", fmt.Errorf("invalid Fun-Music response: %w", err)
	}
	if strings.TrimSpace(parsed.Code) != "" {
		return nil, "", &ProviderHTTPError{
			RequestID:  parsed.RequestID,
			Method:     http.MethodPost,
			URL:        targetURL,
			StatusCode: http.StatusBadGateway,
			Body:       string(raw),
		}
	}
	if audioData := strings.TrimSpace(parsed.Output.Audio.Data); audioData != "" {
		decoded, err := base64.StdEncoding.DecodeString(audioData)
		if err != nil {
			return nil, "", fmt.Errorf("invalid Fun-Music base64 audio data: %w", err)
		}
		return decoded, audioContentTypeForFormat(format), nil
	}
	audioURL := strings.TrimSpace(parsed.Output.Audio.URL)
	if audioURL == "" {
		return nil, "", errors.New("Fun-Music response did not include output.audio.url")
	}
	audioBytes, contentType, err := c.DownloadMediaBytes(ctx, audioURL)
	if err != nil {
		return nil, "", fmt.Errorf("failed to download Fun-Music audio: %w", err)
	}
	if !strings.HasPrefix(strings.ToLower(contentType), "audio/") {
		contentType = audioContentTypeForFormat(format)
	}
	return audioBytes, contentType, nil
}

// SynthesizeBailianMiniMaxSpeech calls Alibaba Cloud Bailian's hosted MiniMax TTS endpoint
// (POST https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation)
// and decodes the hex-encoded audio payload.
func (c *OpenAICompatibleClient) SynthesizeBailianMiniMaxSpeech(
	ctx context.Context,
	input BailianAudioSynthesisInput,
) ([]byte, string, error) {
	overrides := endpointOverridesFromConfig(c.config)
	endpoint := firstNonEmpty(overrides["minimax_tts_endpoint"], DefaultMiniMaxBailianTTSEndpoint)
	baseURL := strings.TrimRight(strings.TrimSpace(c.config.BaseURL), "/")
	if baseURL == "" || strings.Contains(strings.ToLower(baseURL), ".maas.aliyuncs.com") {
		baseURL = DefaultAliyunBailianBaseURL
	}
	targetURL := resolveEndpointURL(baseURL, endpoint)

	modelID := strings.TrimSpace(input.Model)
	if !strings.HasPrefix(strings.ToLower(modelID), "minimax/") {
		modelID = "MiniMax/" + modelID
	}
	voiceID := normalizeMiniMaxVoiceID(input.Voice)
	format := normalizeMiniMaxAudioFormat(input.Format)
	speed := input.Speed
	if speed < 0.5 {
		speed = 0.5
	} else if speed > 2.0 {
		speed = 2.0
	}

	voiceSetting := map[string]any{
		"voice_id": voiceID,
		"speed":    speed,
		"vol":      1.0,
		"pitch":    0,
	}
	if emotion := normalizeMiniMaxEmotion(input.Emotion, input.Instructions, modelID); emotion != "" {
		voiceSetting["emotion"] = emotion
	}

	reqBody := map[string]any{
		"model": modelID,
		"input": map[string]any{
			"text":          input.Input,
			"voice_setting": voiceSetting,
			"audio_setting": map[string]any{
				"sample_rate": 32000,
				"bitrate":     128000,
				"format":      format,
				"channel":     1,
			},
			"output_format": "hex",
		},
	}

	raw, err := c.doCompatibleJSONRequest(ctx, http.MethodPost, targetURL, reqBody)
	if err != nil {
		return nil, "", err
	}
	return decodeMiniMaxSpeechResponse(ctx, c, raw, targetURL, format)
}

// SynthesizeNativeMiniMaxSpeech calls MiniMax's first-party T2A v2 HTTP API (/v1/t2a_v2).
func (c *OpenAICompatibleClient) SynthesizeNativeMiniMaxSpeech(
	ctx context.Context,
	input BailianAudioSynthesisInput,
) ([]byte, string, error) {
	overrides := endpointOverridesFromConfig(c.config)
	endpoint := firstNonEmpty(overrides["audio_speech"], "/v1/t2a_v2")
	targetURL := resolveEndpointURL(c.config.BaseURL, endpoint)

	modelID := strings.TrimPrefix(strings.TrimSpace(input.Model), "MiniMax/")
	voiceID := normalizeMiniMaxVoiceID(input.Voice)
	format := normalizeMiniMaxAudioFormat(input.Format)
	speed := input.Speed
	if speed < 0.5 {
		speed = 0.5
	} else if speed > 2.0 {
		speed = 2.0
	}
	voiceSetting := map[string]any{
		"voice_id": voiceID,
		"speed":    speed,
		"vol":      1.0,
		"pitch":    0,
	}
	if emotion := normalizeMiniMaxEmotion(input.Emotion, input.Instructions, modelID); emotion != "" {
		voiceSetting["emotion"] = emotion
	}
	reqBody := map[string]any{
		"model":         modelID,
		"text":          input.Input,
		"stream":        false,
		"output_format": "hex",
		"voice_setting": voiceSetting,
		"audio_setting": map[string]any{
			"sample_rate": 32000,
			"bitrate":     128000,
			"format":      format,
			"channel":     1,
		},
	}
	raw, err := c.doCompatibleJSONRequest(ctx, http.MethodPost, targetURL, reqBody)
	if err != nil {
		return nil, "", err
	}
	return decodeMiniMaxSpeechResponse(ctx, c, raw, targetURL, format)
}

func decodeMiniMaxSpeechResponse(
	ctx context.Context,
	client *OpenAICompatibleClient,
	raw []byte,
	targetURL string,
	format string,
) ([]byte, string, error) {
	var parsed struct {
		Code      string `json:"code"`
		Message   string `json:"message"`
		RequestID string `json:"request_id"`
		BaseResp  struct {
			StatusCode int    `json:"status_code"`
			StatusMsg  string `json:"status_msg"`
		} `json:"base_resp"`
		Data struct {
			Audio string `json:"audio"`
			URL   string `json:"url"`
		} `json:"data"`
		Output struct {
			BaseResp struct {
				StatusCode int    `json:"status_code"`
				StatusMsg  string `json:"status_msg"`
			} `json:"base_resp"`
			Data struct {
				Audio string `json:"audio"`
				URL   string `json:"url"`
			} `json:"data"`
		} `json:"output"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, "", fmt.Errorf("invalid MiniMax speech response: %w", err)
	}
	statusCode := parsed.Output.BaseResp.StatusCode
	statusMsg := parsed.Output.BaseResp.StatusMsg
	if statusCode == 0 && parsed.BaseResp.StatusCode != 0 {
		statusCode = parsed.BaseResp.StatusCode
		statusMsg = parsed.BaseResp.StatusMsg
	}
	if strings.TrimSpace(parsed.Code) != "" || statusCode != 0 {
		return nil, "", &ProviderHTTPError{
			RequestID:  parsed.RequestID,
			Method:     http.MethodPost,
			URL:        targetURL,
			StatusCode: http.StatusBadGateway,
			Body:       firstNonEmpty(statusMsg, parsed.Message, string(raw)),
		}
	}
	audioHexOrURL := firstNonEmpty(parsed.Output.Data.Audio, parsed.Data.Audio, parsed.Output.Data.URL, parsed.Data.URL)
	if audioHexOrURL == "" {
		return nil, "", errors.New("MiniMax speech response did not include audio data")
	}
	if strings.HasPrefix(strings.ToLower(audioHexOrURL), "http://") || strings.HasPrefix(strings.ToLower(audioHexOrURL), "https://") {
		data, contentType, err := client.DownloadMediaBytes(ctx, audioHexOrURL)
		if err != nil {
			return nil, "", err
		}
		if !strings.HasPrefix(strings.ToLower(contentType), "audio/") {
			contentType = audioContentTypeForFormat(format)
		}
		return data, contentType, nil
	}
	decoded, err := hex.DecodeString(strings.TrimSpace(audioHexOrURL))
	if err != nil {
		return nil, "", fmt.Errorf("failed to hex-decode MiniMax audio: %w", err)
	}
	return decoded, audioContentTypeForFormat(format), nil
}

func normalizeMiniMaxVoiceID(voice string) string {
	trimmed := strings.TrimSpace(voice)
	lower := strings.ToLower(trimmed)
	if trimmed == "" || isOpenAIBuiltinVoice(lower) || strings.HasPrefix(lower, "long") || strings.HasPrefix(lower, "cosyvoice-") {
		switch lower {
		case "nova", "shimmer", "coral", "ballad", "fable", "marin":
			return "female-shaonv"
		case "onyx", "echo", "cedar", "ash":
			return "male-qn-jingying"
		default:
			return "male-qn-qingse"
		}
	}
	return trimmed
}

func normalizeMiniMaxAudioFormat(format string) string {
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "wav":
		return "wav"
	case "flac":
		return "flac"
	default:
		// PCM included: headerless samples cannot be played back in the browser.
		return "mp3"
	}
}

func normalizeMiniMaxEmotion(emotion string, instructions string, modelID string) string {
	candidate := strings.ToLower(strings.TrimSpace(emotion))
	if candidate == "" {
		lowerInst := strings.ToLower(instructions)
		switch {
		case strings.Contains(lowerInst, "高兴") || strings.Contains(lowerInst, "开心") || strings.Contains(lowerInst, "欢快") || strings.Contains(lowerInst, "happy"):
			candidate = "happy"
		case strings.Contains(lowerInst, "悲伤") || strings.Contains(lowerInst, "难过") || strings.Contains(lowerInst, "伤感") || strings.Contains(lowerInst, "sad"):
			candidate = "sad"
		case strings.Contains(lowerInst, "愤怒") || strings.Contains(lowerInst, "生气") || strings.Contains(lowerInst, "angry"):
			candidate = "angry"
		case strings.Contains(lowerInst, "害怕") || strings.Contains(lowerInst, "恐惧") || strings.Contains(lowerInst, "fear"):
			candidate = "fearful"
		case strings.Contains(lowerInst, "惊讶") || strings.Contains(lowerInst, "surprised"):
			candidate = "surprised"
		case strings.Contains(lowerInst, "平静") || strings.Contains(lowerInst, "沉稳") || strings.Contains(lowerInst, "calm"):
			candidate = "calm"
		}
	}
	switch candidate {
	case "happy", "sad", "angry", "fearful", "disgusted", "surprised", "calm":
		return candidate
	case "whisper":
		if strings.Contains(strings.ToLower(modelID), "2.8") {
			return "calm"
		}
		return "whisper"
	default:
		return ""
	}
}

func isOpenAIBuiltinVoice(lower string) bool {
	switch lower {
	case "alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar":
		return true
	default:
		return false
	}
}

// resolveCosyVoiceModelAndVoice ensures cosyvoice-v3.5-plus (which only supports cloned/designed voices)
// smoothly falls back to cosyvoice-v3-plus with a valid system voice (e.g. longanyang / longanhuan_v3)
// when the user has not yet selected a cloned voice ID.
func resolveCosyVoiceModelAndVoice(modelID string, voice string, hasInstruction bool) (string, string) {
	cleanModel := strings.TrimSpace(modelID)
	if cleanModel == "" {
		cleanModel = DefaultCosyVoiceModel
	}
	lowerModel := strings.ToLower(cleanModel)
	cleanVoice := strings.TrimSpace(voice)
	lowerVoice := strings.ToLower(cleanVoice)

	isClonedOrDesignedVoice := strings.HasPrefix(lowerVoice, "cosyvoice-") ||
		strings.HasPrefix(lowerVoice, "qwen-audio-")

	if strings.HasPrefix(lowerModel, "cosyvoice-v3.5") {
		if isClonedOrDesignedVoice {
			return cleanModel, cleanVoice
		}
		// User selected a system voice or default OpenAI voice without a v3.5 cloned voice ID:
		// use cosyvoice-v3-plus when it has that voice, otherwise cosyvoice-v3-flash.
		systemVoice := mapToCosyVoiceV3SystemVoice(cleanVoice, hasInstruction)
		if !hasInstruction && cosyVoiceV3PlusVoices[systemVoice] {
			return "cosyvoice-v3-plus", systemVoice
		}
		return "cosyvoice-v3-flash", systemVoice
	}
	if isClonedOrDesignedVoice {
		return cleanModel, cleanVoice
	}
	if strings.HasPrefix(lowerModel, "cosyvoice-v3-plus") {
		// cosyvoice-v3-plus only has a few system voices; the rest exist on cosyvoice-v3-flash.
		systemVoice := mapToCosyVoiceV3SystemVoice(cleanVoice, hasInstruction)
		if !cosyVoiceV3PlusVoices[systemVoice] {
			return "cosyvoice-v3-flash", systemVoice
		}
		return cleanModel, systemVoice
	}
	if strings.HasPrefix(lowerModel, "cosyvoice-v2") {
		if strings.HasSuffix(lowerVoice, "_v2") {
			return cleanModel, cleanVoice
		}
		return cleanModel, "longxiaochun_v2"
	}
	return cleanModel, mapToCosyVoiceV3SystemVoice(cleanVoice, hasInstruction)
}

// cosyVoiceV3PlusVoices are the system voices cosyvoice-v3-plus accepts (Bailian voice list);
// other v3 system voices only exist on cosyvoice-v3-flash.
var cosyVoiceV3PlusVoices = map[string]bool{"longanyang": true, "longanhuan": true}

// legacyCosyVoiceV3Voices maps voice IDs saved by older studio builds to their v3 names.
var legacyCosyVoiceV3Voices = map[string]string{
	"longxiaochun_v2": "longxiaochun_v3",
	"longwan":         "longwan_v3",
	"longcheng":       "longcheng_v3",
}

func mapToCosyVoiceV3SystemVoice(voice string, hasInstruction bool) string {
	trimmed := strings.TrimSpace(voice)
	lower := strings.ToLower(trimmed)
	if legacy, ok := legacyCosyVoiceV3Voices[lower]; ok {
		return legacy
	}
	if strings.HasPrefix(lower, "long") && !strings.HasSuffix(lower, "_v2") {
		return trimmed
	}
	if hasInstruction {
		return "longanhuan_v3"
	}
	switch lower {
	case "nova", "shimmer", "coral", "ballad", "fable", "marin":
		return "longanhuan_v3"
	default:
		return "longanyang"
	}
}

// cosyVoiceDialects are the dialects longanhuan_v3 accepts via "请用<方言>表达。".
var cosyVoiceDialects = []string{"普通话", "广东话", "东北话", "河南话", "湖南话", "陕西话", "山东话", "四川话", "安徽话"}

// cosyVoiceEmotions maps user wording to the emotion values longanyang / longanhuan accept.
var cosyVoiceEmotions = []struct {
	value string
	words []string
}{
	{"happy", []string{"happy", "开心", "高兴", "欢快", "快乐"}},
	{"sad", []string{"sad", "悲伤", "难过", "伤心", "伤感"}},
	{"angry", []string{"angry", "愤怒", "生气"}},
	{"fearful", []string{"fearful", "fear", "害怕", "恐惧"}},
	{"surprised", []string{"surprised", "惊讶", "吃惊"}},
	{"disgusted", []string{"disgusted", "厌恶", "嫌弃"}},
	{"neutral", []string{"neutral", "平静", "中性", "平稳"}},
}

// cosyVoiceInstruction rewrites a free-form instruction into the exact format the
// resolved voice accepts (Bailian voice list), or drops it when the voice has no
// Instruct support; an instruction the voice rejects fails the whole synthesis.
func cosyVoiceInstruction(voice string, instruction string) string {
	instruction = strings.TrimSpace(instruction)
	if instruction == "" {
		return ""
	}
	lowerVoice := strings.ToLower(strings.TrimSpace(voice))
	switch {
	case strings.HasPrefix(lowerVoice, "cosyvoice-") || strings.HasPrefix(lowerVoice, "qwen-audio-"):
		// Cloned / designed voices take natural-language instructions.
		return instruction
	case lowerVoice == "longanhuan_v3":
		for _, dialect := range cosyVoiceDialects {
			if strings.Contains(instruction, dialect) {
				return "请用" + dialect + "表达。"
			}
		}
		return ""
	case lowerVoice == "longanyang" || lowerVoice == "longanhuan":
		if strings.HasPrefix(instruction, "你") && strings.Contains(instruction, "你说话的情感是") {
			if !strings.HasSuffix(instruction, "。") {
				instruction += "。"
			}
			return instruction
		}
		lower := strings.ToLower(instruction)
		for _, emotion := range cosyVoiceEmotions {
			for _, word := range emotion.words {
				if strings.Contains(lower, word) {
					return "你说话的情感是" + emotion.value + "。"
				}
			}
		}
		return ""
	default:
		return ""
	}
}

// SynthesizeCosyVoiceWebSocket implements Alibaba Cloud Bailian's CosyVoice WebSocket duplex protocol
// (run-task -> task-started -> continue-task -> finish-task -> binary audio chunks -> task-finished).
func (c *OpenAICompatibleClient) SynthesizeCosyVoiceWebSocket(
	ctx context.Context,
	input BailianAudioSynthesisInput,
	secrets map[string]string,
) ([]byte, string, error) {
	overrides := endpointOverridesFromConfig(c.config)
	wsURL := strings.TrimSpace(overrides["cosyvoice_ws_url"])
	base := strings.TrimRight(strings.TrimSpace(c.config.BaseURL), "/")
	if wsURL == "" || wsURL == DefaultCosyVoiceWSURL {
		workspaceID := firstNonEmpty(
			secrets[BailianWorkspaceIDSecret],
			secrets["workspace_id"],
			overrides["bailian_workspace_id"],
			overrides["workspace_id"],
		)
		if strings.HasPrefix(base, "ws://") || strings.HasPrefix(base, "wss://") {
			wsURL = base
		} else if strings.Contains(strings.ToLower(base), ".maas.aliyuncs.com") {
			hostPart := strings.TrimPrefix(strings.TrimPrefix(base, "https://"), "http://")
			wsURL = "wss://" + hostPart + "/api-ws/v1/inference"
		} else if workspaceID != "" && (base == "" || strings.Contains(strings.ToLower(base), "dashscope.aliyuncs.com")) {
			wsURL = "wss://" + workspaceID + ".cn-beijing.maas.aliyuncs.com/api-ws/v1/inference"
		} else if strings.HasPrefix(base, "http://") && !strings.Contains(strings.ToLower(base), "aliyuncs.com") {
			wsURL = "ws://" + strings.TrimPrefix(base, "http://") + "/api-ws/v1/inference"
		} else if strings.HasPrefix(base, "https://") && !strings.Contains(strings.ToLower(base), "aliyuncs.com") {
			wsURL = "wss://" + strings.TrimPrefix(base, "https://") + "/api-ws/v1/inference"
		} else if wsURL == "" {
			wsURL = DefaultCosyVoiceWSURL
		}
	}

	resolvedModel, resolvedVoice := resolveCosyVoiceModelAndVoice(input.Model, input.Voice, input.Instructions != "")
	output := cosyVoiceOutputParams(input.Format)
	format := output["format"].(string)
	rate := input.Speed
	if rate < 0.5 {
		rate = 0.5
	} else if rate > 2.0 {
		rate = 2.0
	}

	conn, err := dialBailianWebSocket(ctx, wsURL, c.apiKey)
	if err != nil {
		return nil, "", err
	}
	defer conn.Close()

	taskID := randomPOPNonce()
	params := map[string]any{
		"text_type":   "PlainText",
		"voice":       resolvedVoice,
		"volume":      50,
		"rate":        rate,
		"pitch":       1,
		"enable_ssml": false,
	}
	for key, value := range output {
		params[key] = value
	}
	if instruction := cosyVoiceInstruction(resolvedVoice, input.Instructions); instruction != "" {
		params["instruction"] = instruction
	}

	runTaskMsg := map[string]any{
		"header": map[string]any{
			"action":    "run-task",
			"task_id":   taskID,
			"streaming": "duplex",
		},
		"payload": map[string]any{
			"task_group": "audio",
			"task":       "tts",
			"function":   "SpeechSynthesizer",
			"model":      resolvedModel,
			"parameters": params,
			"input":      map[string]any{},
		},
	}
	if err := conn.WriteJSON(runTaskMsg); err != nil {
		return nil, "", fmt.Errorf("cosyvoice send run-task failed: %w", err)
	}

	var audioBuf bytes.Buffer
	textSent := false
	for {
		opcode, payload, err := conn.ReadFrame(ctx)
		if err != nil {
			if errors.Is(err, io.EOF) && audioBuf.Len() > 0 {
				break
			}
			return nil, "", fmt.Errorf("cosyvoice read frame failed: %w", err)
		}
		if opcode == wsOpcodeBinary {
			_, _ = audioBuf.Write(payload)
			continue
		}
		if opcode != wsOpcodeText {
			continue
		}
		var eventMsg struct {
			Header struct {
				Event        string `json:"event"`
				ErrorCode    string `json:"error_code"`
				ErrorMessage string `json:"error_message"`
			} `json:"header"`
		}
		if err := json.Unmarshal(payload, &eventMsg); err != nil {
			continue
		}
		switch eventMsg.Header.Event {
		case "task-started":
			if !textSent {
				textSent = true
				continueCmd := map[string]any{
					"header": map[string]any{
						"action":    "continue-task",
						"task_id":   taskID,
						"streaming": "duplex",
					},
					"payload": map[string]any{
						"input": map[string]any{
							"text": input.Input,
						},
					},
				}
				if err := conn.WriteJSON(continueCmd); err != nil {
					return nil, "", fmt.Errorf("cosyvoice send continue-task failed: %w", err)
				}
				finishCmd := map[string]any{
					"header": map[string]any{
						"action":    "finish-task",
						"task_id":   taskID,
						"streaming": "duplex",
					},
					"payload": map[string]any{
						"input": map[string]any{},
					},
				}
				if err := conn.WriteJSON(finishCmd); err != nil {
					return nil, "", fmt.Errorf("cosyvoice send finish-task failed: %w", err)
				}
			}
		case "task-finished":
			if audioBuf.Len() == 0 {
				return nil, "", errors.New("cosyvoice task finished without audio bytes")
			}
			return audioBuf.Bytes(), audioContentTypeForFormat(format), nil
		case "task-failed":
			// The service explicitly rejected the task and returned no audio, so the
			// failure is definitive (not an uncertain, possibly-billed submission).
			return nil, "", &ProviderHTTPError{
				RequestID:  taskID,
				Method:     "WEBSOCKET",
				URL:        wsURL,
				StatusCode: http.StatusBadRequest,
				Body:       firstNonEmpty(eventMsg.Header.ErrorMessage, eventMsg.Header.ErrorCode, string(payload)),
			}
		}
	}
	return audioBuf.Bytes(), audioContentTypeForFormat(format), nil
}

// cosyVoiceOutputParams picks the CosyVoice container parameters for a requested format.
// PCM is headerless and unplayable in the browser, so it is served as MP3. Opus has no
// 22050 Hz mode and needs a bit rate (official SDK AudioFormat.OGG_OPUS_24KHZ_MONO_32KBPS).
func cosyVoiceOutputParams(requested string) map[string]any {
	switch strings.ToLower(strings.TrimSpace(requested)) {
	case "wav":
		return map[string]any{"format": "wav", "sample_rate": 22050}
	case "opus":
		return map[string]any{"format": "opus", "sample_rate": 24000, "bit_rate": 32}
	default:
		return map[string]any{"format": "mp3", "sample_rate": 22050}
	}
}

// VoiceCloneRequest describes a request to clone a speaker's voice in CosyVoice or MiniMax.
type VoiceCloneRequest struct {
	TargetModel   string   `json:"target_model"`
	Prefix        string   `json:"prefix,omitempty"`
	VoiceID       string   `json:"voice_id,omitempty"`
	AudioURL      string   `json:"audio_url,omitempty"`
	AssetID       string   `json:"asset_id,omitempty"`
	DataURL       string   `json:"data_url,omitempty"`
	Scope         string   `json:"scope,omitempty"`
	Text          string   `json:"text,omitempty"`
	LanguageHints []string `json:"language_hints,omitempty"`
}

type VoiceCloneRecord struct {
	VoiceID     string `json:"voice_id"`
	TargetModel string `json:"target_model,omitempty"`
	Status      string `json:"status,omitempty"`
	DemoAudio   string `json:"demo_audio,omitempty"`
	CreatedAt   string `json:"created_at,omitempty"`
	RequestID   string `json:"request_id,omitempty"`
}

func (c *OpenAICompatibleClient) CreateClonedVoice(
	ctx context.Context,
	req VoiceCloneRequest,
	secrets map[string]string,
) (VoiceCloneRecord, error) {
	audioURL := strings.TrimSpace(req.AudioURL)
	if audioURL == "" {
		return VoiceCloneRecord{}, errors.New("audio_url is required for voice cloning")
	}
	targetModel := strings.TrimSpace(req.TargetModel)
	if targetModel == "" {
		targetModel = strings.TrimSpace(c.config.AudioModel)
	}
	if targetModel == "" {
		targetModel = DefaultCosyVoiceModel
	}

	if IsBailianMiniMaxSpeechModel(c.config, targetModel) {
		return c.createBailianMiniMaxClonedVoice(ctx, targetModel, req, audioURL)
	}
	return c.createCosyVoiceClonedVoice(ctx, targetModel, req, audioURL, secrets)
}

func (c *OpenAICompatibleClient) createCosyVoiceClonedVoice(
	ctx context.Context,
	targetModel string,
	req VoiceCloneRequest,
	audioURL string,
	secrets map[string]string,
) (VoiceCloneRecord, error) {
	overrides := endpointOverridesFromConfig(c.config)
	endpoint := firstNonEmpty(overrides["voice_clone_endpoint"], DefaultCosyVoiceCloneEndpoint)
	hostBase := resolveBailianHostBaseURL(c.config.BaseURL, overrides, secrets, true)
	targetURL := resolveEndpointURL(hostBase, endpoint)

	prefix := voicePrefixCleanRegex.ReplaceAllString(strings.TrimSpace(req.Prefix), "")
	if prefix == "" {
		prefix = "role"
	}
	if len(prefix) > 10 {
		prefix = prefix[:10]
	}
	langHints := req.LanguageHints
	if len(langHints) == 0 {
		langHints = []string{"zh"}
	}

	body := map[string]any{
		"model": "voice-enrollment",
		"input": map[string]any{
			"action":                      "create_voice",
			"target_model":                targetModel,
			"prefix":                      prefix,
			"url":                         audioURL,
			"language_hints":              langHints,
			"enable_volume_normalization": "false",
		},
	}
	raw, err := c.doCompatibleJSONRequestWithHeaders(ctx, http.MethodPost, targetURL, body, dashScopeOSSResourceHeaders(audioURL))
	if err != nil {
		return VoiceCloneRecord{}, err
	}
	var parsed struct {
		Code      string `json:"code"`
		Message   string `json:"message"`
		RequestID string `json:"request_id"`
		Output    struct {
			VoiceID string `json:"voice_id"`
		} `json:"output"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return VoiceCloneRecord{}, fmt.Errorf("invalid create_voice response: %w", err)
	}
	if strings.TrimSpace(parsed.Code) != "" || strings.TrimSpace(parsed.Output.VoiceID) == "" {
		return VoiceCloneRecord{}, &ProviderHTTPError{
			RequestID:  parsed.RequestID,
			Method:     http.MethodPost,
			URL:        targetURL,
			StatusCode: http.StatusBadGateway,
			Body:       firstNonEmpty(parsed.Message, string(raw)),
		}
	}
	return VoiceCloneRecord{
		VoiceID:     strings.TrimSpace(parsed.Output.VoiceID),
		TargetModel: targetModel,
		Status:      "OK",
		RequestID:   strings.TrimSpace(parsed.RequestID),
	}, nil
}

func (c *OpenAICompatibleClient) createBailianMiniMaxClonedVoice(
	ctx context.Context,
	targetModel string,
	req VoiceCloneRequest,
	audioURL string,
) (VoiceCloneRecord, error) {
	overrides := endpointOverridesFromConfig(c.config)
	endpoint := firstNonEmpty(overrides["minimax_tts_endpoint"], DefaultMiniMaxBailianTTSEndpoint)
	baseURL := strings.TrimRight(strings.TrimSpace(c.config.BaseURL), "/")
	if baseURL == "" || strings.Contains(strings.ToLower(baseURL), ".maas.aliyuncs.com") {
		baseURL = DefaultAliyunBailianBaseURL
	}
	targetURL := resolveEndpointURL(baseURL, endpoint)

	if !strings.HasPrefix(strings.ToLower(targetModel), "minimax/") {
		targetModel = "MiniMax/" + targetModel
	}
	voiceID := miniMaxVoiceIDRegex.ReplaceAllString(strings.TrimSpace(firstNonEmpty(req.VoiceID, req.Prefix)), "")
	if len(voiceID) < 8 {
		voiceID = "BailianVoice" + randomPOPNonce()[:8]
	} else if !((voiceID[0] >= 'a' && voiceID[0] <= 'z') || (voiceID[0] >= 'A' && voiceID[0] <= 'Z')) {
		voiceID = "V" + voiceID
	}
	voiceID = strings.TrimRight(voiceID, "-_")
	sampleText := strings.TrimSpace(req.Text)
	if sampleText == "" {
		sampleText = "你好，这是角色声音复刻试听音频。"
	}

	body := map[string]any{
		"model": targetModel,
		"input": map[string]any{
			"action":    "voice_clone",
			"voice_id":  voiceID,
			"audio_url": audioURL,
			"text":      sampleText,
		},
	}
	raw, err := c.doCompatibleJSONRequestWithHeaders(ctx, http.MethodPost, targetURL, body, dashScopeOSSResourceHeaders(audioURL))
	if err != nil {
		return VoiceCloneRecord{}, err
	}
	var parsed struct {
		Code      string `json:"code"`
		Message   string `json:"message"`
		RequestID string `json:"request_id"`
		Output    struct {
			DemoAudio string `json:"demo_audio"`
			BaseResp  struct {
				StatusCode int    `json:"status_code"`
				StatusMsg  string `json:"status_msg"`
			} `json:"base_resp"`
		} `json:"output"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return VoiceCloneRecord{}, fmt.Errorf("invalid MiniMax voice_clone response: %w", err)
	}
	if strings.TrimSpace(parsed.Code) != "" || parsed.Output.BaseResp.StatusCode != 0 {
		return VoiceCloneRecord{}, &ProviderHTTPError{
			RequestID:  parsed.RequestID,
			Method:     http.MethodPost,
			URL:        targetURL,
			StatusCode: http.StatusBadGateway,
			Body:       firstNonEmpty(parsed.Output.BaseResp.StatusMsg, parsed.Message, string(raw)),
		}
	}
	return VoiceCloneRecord{
		VoiceID:     voiceID,
		TargetModel: targetModel,
		Status:      "OK",
		DemoAudio:   strings.TrimSpace(parsed.Output.DemoAudio),
		RequestID:   strings.TrimSpace(parsed.RequestID),
	}, nil
}

func (c *OpenAICompatibleClient) ListClonedVoices(
	ctx context.Context,
	prefix string,
	secrets map[string]string,
) ([]VoiceCloneRecord, error) {
	overrides := endpointOverridesFromConfig(c.config)
	endpoint := firstNonEmpty(overrides["voice_clone_endpoint"], DefaultCosyVoiceCloneEndpoint)
	hostBase := resolveBailianHostBaseURL(c.config.BaseURL, overrides, secrets, true)
	targetURL := resolveEndpointURL(hostBase, endpoint)

	inputMap := map[string]any{
		"action":     "list_voice",
		"page_index": 0,
		"page_size":  50,
	}
	if trimmed := strings.TrimSpace(prefix); trimmed != "" {
		inputMap["prefix"] = trimmed
	}
	body := map[string]any{
		"model": "voice-enrollment",
		"input": inputMap,
	}
	raw, err := c.doCompatibleJSONRequest(ctx, http.MethodPost, targetURL, body)
	if err != nil {
		return nil, err
	}
	var parsed struct {
		Output struct {
			VoiceList []struct {
				VoiceID   string `json:"voice_id"`
				Status    string `json:"status"`
				GmtCreate string `json:"gmt_create"`
			} `json:"voice_list"`
		} `json:"output"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, err
	}
	records := make([]VoiceCloneRecord, 0, len(parsed.Output.VoiceList))
	for _, item := range parsed.Output.VoiceList {
		if strings.TrimSpace(item.VoiceID) == "" {
			continue
		}
		records = append(records, VoiceCloneRecord{
			VoiceID:   strings.TrimSpace(item.VoiceID),
			Status:    strings.TrimSpace(item.Status),
			CreatedAt: strings.TrimSpace(item.GmtCreate),
		})
	}
	return records, nil
}

func audioContentTypeForFormat(format string) string {
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "wav":
		return "audio/wav"
	case "flac":
		return "audio/flac"
	case "opus":
		// CosyVoice wraps Opus in an Ogg container; browsers play audio/ogg.
		return "audio/ogg"
	case "aac":
		return "audio/aac"
	case "pcm":
		return "audio/pcm"
	default:
		return "audio/mpeg"
	}
}

// dashScopeOSSResourceHeaders lets DashScope resolve an oss:// temp file from UploadMediaToDashScopeTemp.
func dashScopeOSSResourceHeaders(resourceURL string) map[string]string {
	if !strings.HasPrefix(strings.TrimSpace(resourceURL), "oss://") {
		return nil
	}
	return map[string]string{"X-DashScope-OssResourceResolve": "enable"}
}

// UploadMediaToDashScopeTemp uploads a local media stream to Alibaba Cloud Bailian's temporary
// storage using only the DashScope Bearer API Key (GET /api/v1/uploads?action=getPolicy),
// returning an oss:// URL. The upload bucket is private, so its https URL is not downloadable
// (voice enrollment failed with "download audio failed:403"); requests that reference the
// oss:// URL must send X-DashScope-OssResourceResolve (see dashScopeOSSResourceHeaders).
func (c *OpenAICompatibleClient) UploadMediaToDashScopeTemp(
	ctx context.Context,
	reader io.Reader,
	ext string,
	modelID string,
) (string, error) {
	if strings.TrimSpace(c.apiKey) == "" {
		return "", errors.New("DashScope API key is required to upload local audio for voice cloning")
	}
	if strings.TrimSpace(modelID) == "" {
		modelID = "voice-enrollment"
	}
	baseURL := strings.TrimRight(strings.TrimSpace(c.config.BaseURL), "/")
	if baseURL == "" || strings.Contains(strings.ToLower(baseURL), ".maas.aliyuncs.com") {
		baseURL = DefaultAliyunBailianBaseURL
	}
	policyURL := baseURL + "/api/v1/uploads?action=getPolicy&model=" + url.QueryEscape(modelID)
	raw, err := c.doCompatibleJSONRequest(ctx, http.MethodGet, policyURL, nil)
	if err != nil {
		return "", err
	}
	var policy struct {
		Data struct {
			Policy              string `json:"policy"`
			Signature           string `json:"signature"`
			UploadDir           string `json:"upload_dir"`
			UploadHost          string `json:"upload_host"`
			OSSAccessKeyID      string `json:"oss_access_key_id"`
			XOSSObjectACL       string `json:"x_oss_object_acl"`
			XOSSForbidOverwrite string `json:"x_oss_forbid_overwrite"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &policy); err != nil || strings.TrimSpace(policy.Data.UploadHost) == "" {
		return "", errors.New("invalid DashScope upload policy response")
	}
	cleanExt := strings.TrimSpace(ext)
	if cleanExt == "" {
		cleanExt = ".wav"
	} else if !strings.HasPrefix(cleanExt, ".") {
		cleanExt = "." + cleanExt
	}
	fileName := "voice_" + randomPOPNonce()[:12] + cleanExt
	objectKey := strings.TrimRight(strings.TrimSpace(policy.Data.UploadDir), "/") + "/" + fileName

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	_ = writer.WriteField("OSSAccessKeyId", policy.Data.OSSAccessKeyID)
	_ = writer.WriteField("Signature", policy.Data.Signature)
	_ = writer.WriteField("policy", policy.Data.Policy)
	if policy.Data.XOSSObjectACL != "" {
		_ = writer.WriteField("x-oss-object-acl", policy.Data.XOSSObjectACL)
	}
	if policy.Data.XOSSForbidOverwrite != "" {
		_ = writer.WriteField("x-oss-forbid-overwrite", policy.Data.XOSSForbidOverwrite)
	}
	_ = writer.WriteField("key", objectKey)
	_ = writer.WriteField("success_action_status", "200")
	part, err := writer.CreateFormFile("file", fileName)
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(part, reader); err != nil {
		return "", err
	}
	if err := writer.Close(); err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimSpace(policy.Data.UploadHost), &body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp, err := c.longClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		respBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", fmt.Errorf("DashScope temp OSS upload failed (%d): %s", resp.StatusCode, string(respBytes))
	}
	return "oss://" + strings.TrimLeft(objectKey, "/"), nil
}

const (
	wsOpcodeContinuation = 0x0
	wsOpcodeText         = 0x1
	wsOpcodeBinary       = 0x2
	wsOpcodeClose        = 0x8
	wsOpcodePing         = 0x9
	wsOpcodePong         = 0xA
)

type bailianWSConn struct {
	conn   net.Conn
	reader *bufio.Reader
}

func dialBailianWebSocket(ctx context.Context, rawWSURL string, apiKey string) (*bailianWSConn, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawWSURL))
	if err != nil || parsed.Host == "" {
		return nil, fmt.Errorf("invalid websocket URL %q", rawWSURL)
	}
	scheme := strings.ToLower(parsed.Scheme)
	host := parsed.Host
	if !strings.Contains(host, ":") {
		if scheme == "wss" {
			host += ":443"
		} else {
			host += ":80"
		}
	}
	dialer := &net.Dialer{Timeout: 15 * time.Second}
	rawConn, err := dialer.DialContext(ctx, "tcp", host)
	if err != nil {
		return nil, err
	}
	netConn := rawConn
	if scheme == "wss" {
		tlsConn := tls.Client(rawConn, &tls.Config{
			ServerName: parsed.Hostname(),
			MinVersion: tls.VersionTLS12,
		})
		if err := tlsConn.HandshakeContext(ctx); err != nil {
			_ = rawConn.Close()
			return nil, err
		}
		netConn = tlsConn
	}

	var keyBytes [16]byte
	_, _ = rand.Read(keyBytes[:])
	secKey := base64.StdEncoding.EncodeToString(keyBytes[:])

	reqPath := parsed.RequestURI()
	if reqPath == "" {
		reqPath = "/"
	}
	var handshake strings.Builder
	handshake.WriteString(fmt.Sprintf("GET %s HTTP/1.1\r\n", reqPath))
	handshake.WriteString(fmt.Sprintf("Host: %s\r\n", parsed.Host))
	handshake.WriteString("Upgrade: websocket\r\n")
	handshake.WriteString("Connection: Upgrade\r\n")
	handshake.WriteString(fmt.Sprintf("Sec-WebSocket-Key: %s\r\n", secKey))
	handshake.WriteString("Sec-WebSocket-Version: 13\r\n")
	handshake.WriteString("X-DashScope-DataInspection: enable\r\n")
	if strings.TrimSpace(apiKey) != "" {
		handshake.WriteString(fmt.Sprintf("Authorization: bearer %s\r\n", strings.TrimSpace(apiKey)))
	}
	handshake.WriteString("\r\n")

	if _, err := netConn.Write([]byte(handshake.String())); err != nil {
		_ = netConn.Close()
		return nil, err
	}
	reader := bufio.NewReaderSize(netConn, 64*1024)
	statusLine, err := reader.ReadString('\n')
	if err != nil {
		_ = netConn.Close()
		return nil, err
	}
	if !strings.Contains(statusLine, " 101 ") {
		_ = netConn.Close()
		return nil, fmt.Errorf("websocket handshake failed: %s", strings.TrimSpace(statusLine))
	}
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			_ = netConn.Close()
			return nil, err
		}
		if line == "\r\n" || line == "\n" {
			break
		}
	}
	_ = sha1.New
	return &bailianWSConn{conn: netConn, reader: reader}, nil
}

func (w *bailianWSConn) Close() error {
	return w.conn.Close()
}

func (w *bailianWSConn) WriteJSON(v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return w.writeFrame(wsOpcodeText, data)
}

func (w *bailianWSConn) writeFrame(opcode byte, payload []byte) error {
	var header []byte
	header = append(header, 0x80|opcode)
	length := len(payload)
	switch {
	case length <= 125:
		header = append(header, 0x80|byte(length))
	case length <= 65535:
		header = append(header, 0x80|126, byte(length>>8), byte(length))
	default:
		header = append(header, 0x80|127)
		var lenBuf [8]byte
		binary.BigEndian.PutUint64(lenBuf[:], uint64(length))
		header = append(header, lenBuf[:]...)
	}
	var maskKey [4]byte
	_, _ = rand.Read(maskKey[:])
	header = append(header, maskKey[:]...)

	masked := make([]byte, length)
	for i := 0; i < length; i++ {
		masked[i] = payload[i] ^ maskKey[i%4]
	}
	if _, err := w.conn.Write(header); err != nil {
		return err
	}
	_, err := w.conn.Write(masked)
	return err
}

func (w *bailianWSConn) ReadFrame(ctx context.Context) (byte, []byte, error) {
	if deadline, ok := ctx.Deadline(); ok {
		_ = w.conn.SetReadDeadline(deadline)
	} else {
		_ = w.conn.SetReadDeadline(time.Now().Add(120 * time.Second))
	}
	var msgOpcode byte
	var messageBuf bytes.Buffer
	for {
		var head [2]byte
		if _, err := io.ReadFull(w.reader, head[:]); err != nil {
			return 0, nil, err
		}
		fin := (head[0] & 0x80) != 0
		opcode := head[0] & 0x0F
		masked := (head[1] & 0x80) != 0
		payloadLen := int64(head[1] & 0x7F)
		switch payloadLen {
		case 126:
			var ext [2]byte
			if _, err := io.ReadFull(w.reader, ext[:]); err != nil {
				return 0, nil, err
			}
			payloadLen = int64(binary.BigEndian.Uint16(ext[:]))
		case 127:
			var ext [8]byte
			if _, err := io.ReadFull(w.reader, ext[:]); err != nil {
				return 0, nil, err
			}
			payloadLen = int64(binary.BigEndian.Uint64(ext[:]))
		}
		var maskKey [4]byte
		if masked {
			if _, err := io.ReadFull(w.reader, maskKey[:]); err != nil {
				return 0, nil, err
			}
		}
		if payloadLen > maxProviderResponseBytes {
			return 0, nil, errors.New("websocket frame exceeds limit")
		}
		frameData := make([]byte, payloadLen)
		if _, err := io.ReadFull(w.reader, frameData); err != nil {
			return 0, nil, err
		}
		if masked {
			for i := range frameData {
				frameData[i] ^= maskKey[i%4]
			}
		}
		switch opcode {
		case wsOpcodePing:
			_ = w.writeFrame(wsOpcodePong, frameData)
			continue
		case wsOpcodePong:
			continue
		case wsOpcodeClose:
			return wsOpcodeClose, nil, io.EOF
		case wsOpcodeContinuation:
			_, _ = messageBuf.Write(frameData)
		default:
			msgOpcode = opcode
			messageBuf.Reset()
			_, _ = messageBuf.Write(frameData)
		}
		if fin {
			return msgOpcode, messageBuf.Bytes(), nil
		}
	}
}
