package handler

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/middleware"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/queue"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/service"
	"github.com/ai-manju/api/internal/storage"
	"github.com/gin-gonic/gin"
)

func TestModelProviderGetDoesNotExposeAPIKey(t *testing.T) {
	router, _ := newProviderTestRouter(t, "secret")
	adminCookie := loginCookie(t, router, "admin", "secret")

	put := performJSON(router, http.MethodPut, "/api/admin/model-provider", `{"mode":"openai_compatible","base_url":"http://example.test/v1","auth_type":"bearer","api_key":"sk-secret","text_model":"gpt-test","timeout_ms":30000,"enabled":true}`, adminCookie)
	if put.Code != http.StatusOK {
		t.Fatalf("put status = %d, body = %s", put.Code, put.Body.String())
	}

	get := performJSON(router, http.MethodGet, "/api/admin/model-provider", "", adminCookie)
	if get.Code != http.StatusOK {
		t.Fatalf("get status = %d, body = %s", get.Code, get.Body.String())
	}
	if strings.Contains(get.Body.String(), "sk-secret") || strings.Contains(get.Body.String(), "api_key_encrypted") {
		t.Fatalf("provider response leaked api key: %s", get.Body.String())
	}
	if !strings.Contains(get.Body.String(), `"api_key_set":true`) {
		t.Fatalf("provider response missing api_key_set=true: %s", get.Body.String())
	}
}

func TestYikeVideoRequestConvertsCanvasPayload(t *testing.T) {
	dataURL := "data:image/png;base64,AAAA"
	payload, err := yikeVideoRequest(map[string]any{
		"model":      "wan3.0-video",
		"content":    []any{map[string]any{"type": "text", "text": "a cat runs"}, map[string]any{"type": "image_url", "image_url": map[string]any{"url": dataURL}, "role": "reference_image"}},
		"ratio":      "16:9",
		"resolution": "720p",
		"duration":   -1,
	}, "wan3.0-video")
	if err != nil {
		t.Fatal(err)
	}
	input, ok := payload["input"].(map[string]any)
	if !ok || input["prompt"] != "a cat runs" {
		t.Fatalf("input = %#v", payload["input"])
	}
	media, ok := input["media"].([]map[string]any)
	if !ok || len(media) != 1 || media[0]["type"] != "reference_image" || media[0]["url"] != dataURL {
		t.Fatalf("media = %#v", input["media"])
	}
	if _, exists := input["img_url"]; exists {
		t.Fatalf("Wan input must not contain img_url: %#v", input)
	}
	if _, exists := input["reference_urls"]; exists {
		t.Fatalf("Wan input must not contain reference_urls: %#v", input)
	}
	parameters, ok := payload["parameters"].(map[string]any)
	if !ok || parameters["resolution"] != "720P" || parameters["ratio"] != "16:9" || parameters["duration"] != 5 {
		t.Fatalf("parameters = %#v", payload["parameters"])
	}
}

func TestYikeVideoRequestConvertsWanFirstAndLastFramesToMedia(t *testing.T) {
	payload, err := yikeVideoRequest(map[string]any{
		"content": []any{
			map[string]any{"type": "text", "text": "camera moves"},
			map[string]any{"type": "image_url", "image_url": map[string]any{"url": "https://example.com/first.jpg"}, "role": "first_frame"},
			map[string]any{"type": "image_url", "image_url": map[string]any{"url": "https://example.com/last.jpg"}, "role": "last_frame"},
		},
	}, "wan3.0-video")
	if err != nil {
		t.Fatal(err)
	}
	input := payload["input"].(map[string]any)
	media := input["media"].([]map[string]any)
	want := []map[string]any{
		{"type": "first_frame", "url": "https://example.com/first.jpg"},
		{"type": "last_frame", "url": "https://example.com/last.jpg"},
	}
	if !reflect.DeepEqual(media, want) {
		t.Fatalf("media = %#v, want %#v", media, want)
	}
}

func TestYikeVideoRequestRejectsMixedWanReferenceModes(t *testing.T) {
	_, err := yikeVideoRequest(map[string]any{
		"content": []any{
			map[string]any{"type": "text", "text": "camera moves"},
			map[string]any{"type": "image_url", "image_url": map[string]any{"url": "https://example.com/first.jpg"}, "role": "first_frame"},
			map[string]any{"type": "image_url", "image_url": map[string]any{"url": "https://example.com/reference.jpg"}, "role": "reference_image"},
		},
	}, "wan3.0-video")
	if err == nil || !strings.Contains(err.Error(), "不能与首帧/尾帧模式混用") {
		t.Fatalf("error = %v", err)
	}
}

func TestYikeVideoRequestNormalizesOversizedWanDataURL(t *testing.T) {
	source := image.NewRGBA(image.Rect(0, 0, 8001, 100))
	for y := 0; y < 100; y++ {
		for x := 0; x < 8001; x++ {
			source.SetRGBA(x, y, color.RGBA{R: 200, G: 20, B: 40, A: 255})
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, source); err != nil {
		t.Fatal(err)
	}
	dataURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString(encoded.Bytes())
	payload, err := yikeVideoRequest(map[string]any{
		"content": []any{
			map[string]any{"type": "text", "text": "move"},
			map[string]any{"type": "image_url", "image_url": map[string]any{"url": dataURL}, "role": "reference_image"},
		},
	}, "wan3.0-video")
	if err != nil {
		t.Fatal(err)
	}
	input := payload["input"].(map[string]any)
	media := input["media"].([]map[string]any)
	normalized := media[0]["url"].(string)
	if normalized == dataURL || !strings.HasPrefix(normalized, "data:image/jpeg;base64,") {
		t.Fatalf("oversized Data URL was not normalized")
	}
	_, encodedPayload, ok := strings.Cut(normalized, ",")
	if !ok {
		t.Fatal("normalized Data URL is malformed")
	}
	imageBytes, err := base64.StdEncoding.DecodeString(encodedPayload)
	if err != nil {
		t.Fatal(err)
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(imageBytes))
	if err != nil {
		t.Fatal(err)
	}
	if config.Width > wanMaxImageDimension || config.Height > wanMaxImageDimension || config.Width < wanMinImageDimension || config.Height < wanMinImageDimension {
		t.Fatalf("normalized bounds = %dx%d", config.Width, config.Height)
	}
	if config.Width != 8000 || config.Height != 300 {
		t.Fatalf("normalized bounds = %dx%d, want 8000x300", config.Width, config.Height)
	}
}

func TestYikeVideoRequestKeepsLegacyFieldsForOtherYikeModels(t *testing.T) {
	payload, err := yikeVideoRequest(map[string]any{
		"content": []any{
			map[string]any{"type": "text", "text": "move"},
			map[string]any{"type": "image_url", "image_url": map[string]any{"url": "https://example.com/reference.jpg"}, "role": "reference_image"},
		},
	}, "happyhorse-1.1")
	if err != nil {
		t.Fatal(err)
	}
	input := payload["input"].(map[string]any)
	if input["img_url"] != "https://example.com/reference.jpg" {
		t.Fatalf("legacy input = %#v", input)
	}
}

func TestYikeTaskResponseNormalizesStatusAndVideoURL(t *testing.T) {
	result := yikeTaskResponse(json.RawMessage(`{"request_id":"req-1","output":{"task_id":"task-1","task_status":"SUCCEEDED","video_url":"https://example.com/video.mp4"}}`), "wan3.0-video")
	content, _ := result["content"].(map[string]any)
	if result["id"] != "task-1" || result["status"] != "succeeded" || content["video_url"] != "https://example.com/video.mp4" || result["request_id"] != "req-1" {
		t.Fatalf("result = %#v", result)
	}
}

func TestYikeTaskResponseExposesUpstreamFailureMessage(t *testing.T) {
	result := yikeTaskResponse(json.RawMessage(`{"error_message":"top-level failure","output":{"task_id":"task-1","task_status":"FAILED","code":"InvalidParameter","message":"output failure"}}`), "wan3.0-video")
	providerError, _ := result["error"].(map[string]any)
	if result["status"] != "failed" || providerError["code"] != "InvalidParameter" || providerError["message"] != "top-level failure" {
		t.Fatalf("result = %#v", result)
	}

	result = yikeTaskResponse(json.RawMessage(`{"output":{"task_id":"task-2","task_status":"FAILED","code":"BadImage","message":"resolution must be at most 8000x8000"}}`), "wan3.0-video")
	providerError, _ = result["error"].(map[string]any)
	if providerError["message"] != "resolution must be at most 8000x8000" {
		t.Fatalf("result = %#v", result)
	}
}

func TestVideoProviderPresetsIncludeNewModels(t *testing.T) {
	modelsByPreset := make(map[string][]string)
	for _, preset := range modelProviderPresets() {
		modelsByPreset[preset.ID] = preset.ModelsByCapability[model.ModelCapabilityVideo]
	}
	if !containsString(modelsByPreset["volcengine_seedance"], "doubao-seedance-2-5-260628") {
		t.Fatalf("Seedance preset models = %#v", modelsByPreset["volcengine_seedance"])
	}
	if !containsString(modelsByPreset["aliyun_yike_wan"], "wan3.0-video") {
		t.Fatalf("Yike preset models = %#v", modelsByPreset["aliyun_yike_wan"])
	}
}

func TestModelProviderSavesNormalizedModelAliases(t *testing.T) {
	router, _ := newProviderTestRouter(t, "secret")
	adminCookie := loginCookie(t, router, "admin", "secret")

	put := performJSON(router, http.MethodPut, "/api/admin/model-provider", `{"mode":"local_openai","base_url":"http://example.test/v1","auth_type":"none","text_model":"gpt-test","capabilities":["text"],"models_by_capability":{"text":["gpt-test"]},"model_aliases":{" gpt-test ":" \u5267\u672c\u5206\u6790\u6a21\u578b ","empty":" "," ":"ignored"},"timeout_ms":30000,"enabled":true}`, adminCookie)
	if put.Code != http.StatusOK {
		t.Fatalf("put status = %d, body = %s", put.Code, put.Body.String())
	}

	get := performJSON(router, http.MethodGet, "/api/admin/model-provider", "", adminCookie)
	if get.Code != http.StatusOK {
		t.Fatalf("get status = %d, body = %s", get.Code, get.Body.String())
	}
	var envelope struct {
		Data struct {
			ModelAliases map[string]string `json:"model_aliases"`
		} `json:"data"`
	}
	if err := json.Unmarshal(get.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode provider response: %v", err)
	}
	want := map[string]string{"gpt-test": "\u5267\u672c\u5206\u6790\u6a21\u578b"}
	if !reflect.DeepEqual(envelope.Data.ModelAliases, want) {
		t.Fatalf("model aliases = %#v, want %#v", envelope.Data.ModelAliases, want)
	}
}

func TestModelProviderBearerRequiresAppSecret(t *testing.T) {
	router, _ := newProviderTestRouter(t, "")
	adminCookie := loginCookie(t, router, "admin", "secret")

	put := performJSON(router, http.MethodPut, "/api/admin/model-provider", `{"mode":"openai_compatible","base_url":"http://example.test/v1","auth_type":"bearer","api_key":"sk-secret","text_model":"gpt-test","enabled":true}`, adminCookie)
	if put.Code != http.StatusBadRequest {
		t.Fatalf("put status = %d, want 400; body = %s", put.Code, put.Body.String())
	}
}

func TestModelProviderSavesExtendedTimeout(t *testing.T) {
	router, _ := newProviderTestRouter(t, "secret")
	adminCookie := loginCookie(t, router, "admin", "secret")

	put := performJSON(router, http.MethodPut, "/api/admin/model-provider", `{"mode":"local_openai","base_url":"http://example.test/v1","auth_type":"none","text_model":"gpt-test","image_model":"gpt-image-test","timeout_ms":300000,"enabled":true}`, adminCookie)
	if put.Code != http.StatusOK {
		t.Fatalf("put status = %d, body = %s", put.Code, put.Body.String())
	}
	if !strings.Contains(put.Body.String(), `"timeout_ms":300000`) {
		t.Fatalf("put response did not preserve extended timeout: %s", put.Body.String())
	}

	get := performJSON(router, http.MethodGet, "/api/admin/model-provider", "", adminCookie)
	if get.Code != http.StatusOK {
		t.Fatalf("get status = %d, body = %s", get.Code, get.Body.String())
	}
	if !strings.Contains(get.Body.String(), `"timeout_ms":300000`) {
		t.Fatalf("get response did not persist extended timeout: %s", get.Body.String())
	}

	max := performJSON(router, http.MethodPut, "/api/admin/model-provider", `{"mode":"local_openai","base_url":"http://example.test/v1","auth_type":"none","text_model":"gpt-test","image_model":"gpt-image-test","timeout_ms":600000,"enabled":true}`, adminCookie)
	if max.Code != http.StatusOK {
		t.Fatalf("max put status = %d, body = %s", max.Code, max.Body.String())
	}
	if !strings.Contains(max.Body.String(), `"timeout_ms":600000`) {
		t.Fatalf("max put response did not preserve timeout: %s", max.Body.String())
	}

	clamped := performJSON(router, http.MethodPut, "/api/admin/model-provider", `{"mode":"local_openai","base_url":"http://example.test/v1","auth_type":"none","text_model":"gpt-test","image_model":"gpt-image-test","timeout_ms":900000,"enabled":true}`, adminCookie)
	if clamped.Code != http.StatusOK {
		t.Fatalf("clamped put status = %d, body = %s", clamped.Code, clamped.Body.String())
	}
	if !strings.Contains(clamped.Body.String(), `"timeout_ms":600000`) {
		t.Fatalf("clamped put response did not clamp to max: %s", clamped.Body.String())
	}
}

func TestModelProviderDefaultsMissingTimeoutBeforeSave(t *testing.T) {
	router, _ := newProviderTestRouter(t, "secret")
	adminCookie := loginCookie(t, router, "admin", "secret")

	put := performJSON(router, http.MethodPut, "/api/admin/model-provider", `{"mode":"local_openai","base_url":"http://example.test/v1","auth_type":"none","text_model":"gpt-test","image_model":"gpt-image-test","enabled":true}`, adminCookie)
	if put.Code != http.StatusOK {
		t.Fatalf("put status = %d, body = %s", put.Code, put.Body.String())
	}
	if !strings.Contains(put.Body.String(), `"timeout_ms":300000`) {
		t.Fatalf("put response did not default timeout before save: %s", put.Body.String())
	}

	get := performJSON(router, http.MethodGet, "/api/admin/model-provider", "", adminCookie)
	if get.Code != http.StatusOK {
		t.Fatalf("get status = %d, body = %s", get.Code, get.Body.String())
	}
	if !strings.Contains(get.Body.String(), `"timeout_ms":300000`) {
		t.Fatalf("get response did not persist default timeout: %s", get.Body.String())
	}
}

func TestModelProviderPresetsAndMultiProviderAggregation(t *testing.T) {
	router, _ := newProviderTestRouter(t, "secret")
	adminCookie := loginCookie(t, router, "admin", "secret")
	memberCookie := loginCookie(t, router, "member", "secret")

	presets := performJSON(router, http.MethodGet, "/api/admin/model-provider-presets", "", adminCookie)
	if presets.Code != http.StatusOK {
		t.Fatalf("presets status = %d, body = %s", presets.Code, presets.Body.String())
	}
	if !strings.Contains(presets.Body.String(), "volcengine_seedance") || !strings.Contains(presets.Body.String(), "gemini_media") {
		t.Fatalf("presets response missing expected media presets: %s", presets.Body.String())
	}
	for _, expected := range []string{"material_base_url", "CreateRealValidateH5", "CreateAsset", "asset://{AssetID}"} {
		if !strings.Contains(presets.Body.String(), expected) {
			t.Fatalf("seedance preset response missing material config %s: %s", expected, presets.Body.String())
		}
	}

	imageProvider := performJSON(router, http.MethodPost, "/api/admin/model-providers", `{"id":"img","name":"Images","preset_id":"openai_image","provider_type":"openai_compatible","mode":"openai_compatible","base_url":"http://image.example/v1","auth_type":"none","image_model":"gpt-image-2","capabilities":["image"],"models_by_capability":{"image":["gpt-image-2"]},"default_for":["image"],"timeout_ms":30000,"enabled":true}`, adminCookie)
	if imageProvider.Code != http.StatusOK {
		t.Fatalf("image provider status = %d, body = %s", imageProvider.Code, imageProvider.Body.String())
	}
	videoProvider := performJSON(router, http.MethodPost, "/api/admin/model-providers", `{"id":"vid","name":"Videos","preset_id":"volcengine_seedance","provider_type":"volcengine_ark","mode":"openai_compatible","base_url":"http://video.example/api/v3","auth_type":"none","video_model":"seedance-1-0-pro","capabilities":["video"],"models_by_capability":{"video":["seedance-1-0-pro"]},"default_for":["video"],"timeout_ms":30000,"enabled":true}`, adminCookie)
	if videoProvider.Code != http.StatusOK {
		t.Fatalf("video provider status = %d, body = %s", videoProvider.Code, videoProvider.Body.String())
	}

	models := performJSON(router, http.MethodGet, "/api/ai/models", "", memberCookie)
	if models.Code != http.StatusOK {
		t.Fatalf("models status = %d, body = %s", models.Code, models.Body.String())
	}
	for _, expected := range []string{`"img::gpt-image-2"`, `"vid::seedance-1-0-pro"`, `"default_image_model":"img::gpt-image-2"`, `"default_video_model":"vid::seedance-1-0-pro"`} {
		if !strings.Contains(models.Body.String(), expected) {
			t.Fatalf("models response missing %s: %s", expected, models.Body.String())
		}
	}
}

func TestAIModelsDoNotFallbackVideoDefaultToImageModel(t *testing.T) {
	router, providerRepo := newProviderTestRouter(t, "secret")
	memberCookie := loginCookie(t, router, "member", "secret")

	if _, err := providerRepo.UpsertDefaultModelProvider(model.ModelProviderConfig{
		ID:                 model.ModelProviderIDDefault,
		Mode:               model.ModelProviderModeOpenAICompatible,
		BaseURL:            "http://example.test/v1",
		AuthType:           model.ModelProviderAuthTypeNone,
		TextModel:          "gpt-text",
		ImageModel:         "gpt-image",
		Capabilities:       mustProviderJSONB([]string{model.ModelCapabilityText, model.ModelCapabilityImage, model.ModelCapabilityVideo, model.ModelCapabilityAudio}),
		ModelsByCapability: mustProviderJSONB(map[string][]string{model.ModelCapabilityText: []string{"gpt-text"}, model.ModelCapabilityImage: []string{"gpt-image"}}),
		DefaultFor:         mustProviderJSONB([]string{model.ModelCapabilityText, model.ModelCapabilityImage, model.ModelCapabilityVideo, model.ModelCapabilityAudio}),
		TimeoutMS:          model.ModelProviderDefaultTimeoutMilli,
		Enabled:            true,
	}); err != nil {
		t.Fatal(err)
	}

	models := performJSON(router, http.MethodGet, "/api/ai/models", "", memberCookie)
	if models.Code != http.StatusOK {
		t.Fatalf("models status = %d, body = %s", models.Code, models.Body.String())
	}
	for _, unexpected := range []string{`"default_video_model":"default::gpt-image"`, `"default_audio_model":"default::gpt-text"`, `"video_models":["default::`} {
		if strings.Contains(models.Body.String(), unexpected) {
			t.Fatalf("models response included unexpected fallback %s: %s", unexpected, models.Body.String())
		}
	}
	if !strings.Contains(models.Body.String(), `"default_video_model":""`) {
		t.Fatalf("models response did not keep video default empty: %s", models.Body.String())
	}
}

func TestDetectedModelsSeparateTextMediaAndSpeechSynthesis(t *testing.T) {
	detected := mergeDetectedModels(map[string][]string{}, []string{
		"gpt-5.4",
		"gpt-4o-audio-preview",
		"gpt-4o-realtime-preview",
		"gpt-image-2",
		"doubao-seedance-2-0-mini",
		"gpt-4o-mini-tts",
	})
	for _, expected := range []string{"gpt-5.4", "gpt-4o-audio-preview", "gpt-4o-realtime-preview"} {
		if !containsString(detected[model.ModelCapabilityText], expected) {
			t.Fatalf("text models %#v missing %q", detected[model.ModelCapabilityText], expected)
		}
	}
	if containsString(detected[model.ModelCapabilityAudio], "gpt-4o-audio-preview") {
		t.Fatalf("audio preview must not be advertised as speech synthesis: %#v", detected[model.ModelCapabilityAudio])
	}
	if !containsString(detected[model.ModelCapabilityAudio], "gpt-4o-mini-tts") {
		t.Fatalf("speech models = %#v", detected[model.ModelCapabilityAudio])
	}
	if !containsString(detected[model.ModelCapabilityImage], "gpt-image-2") || !containsString(detected[model.ModelCapabilityVideo], "doubao-seedance-2-0-mini") {
		t.Fatalf("detected models = %#v", detected)
	}
}

func TestModelsResponseUsesFreshProviderListWithoutStaleConfiguredModels(t *testing.T) {
	config := model.ModelProviderConfig{
		ID:         "default",
		TextModel:  "gpt-5.4",
		ImageModel: "gpt-image-2",
		Capabilities: mustProviderJSONB([]string{
			model.ModelCapabilityText,
			model.ModelCapabilityImage,
		}),
		ModelsByCapability: mustProviderJSONB(map[string][]string{
			model.ModelCapabilityText:  {"stale-text-model"},
			model.ModelCapabilityImage: {"stale-image-model"},
		}),
	}

	result := modelsResponse(config, []string{"gpt-5.6", "gpt-image-2"}, nil)
	if !containsString(result["text_models"].([]string), "gpt-5.6") || !containsString(result["image_models"].([]string), "gpt-image-2") {
		t.Fatalf("fresh models were not classified: %#v", result)
	}
	if containsString(result["text_models"].([]string), "stale-text-model") || containsString(result["image_models"].([]string), "stale-image-model") {
		t.Fatalf("successful pull retained stale configured models: %#v", result)
	}
	if !reflect.DeepEqual(result["models"], []string{"gpt-5.6", "gpt-image-2"}) {
		t.Fatalf("raw models = %#v", result["models"])
	}
}

func TestStoredModelsResponsePreservesExplicitCapabilityAssignments(t *testing.T) {
	config := model.ModelProviderConfig{
		ID:           "offline",
		Capabilities: mustProviderJSONB([]string{model.ModelCapabilityText, model.ModelCapabilityImage}),
		ModelsByCapability: mustProviderJSONB(map[string][]string{
			model.ModelCapabilityText:  {"custom-chat"},
			model.ModelCapabilityImage: {"custom-renderer"},
		}),
	}

	result := storedModelsResponse(config, gin.H{"models_error": "offline"})
	if !containsString(result["text_models"].([]string), "custom-chat") || !containsString(result["image_models"].([]string), "custom-renderer") {
		t.Fatalf("stored capability assignments were lost: %#v", result)
	}
}

func TestModelsResponseDoesNotAddDefaultsForDisabledCapabilities(t *testing.T) {
	config := model.ModelProviderConfig{
		ID:           "video-only",
		TextModel:    "stale-text",
		ImageModel:   "stale-image",
		VideoModel:   "seedance-video",
		Capabilities: mustProviderJSONB([]string{model.ModelCapabilityVideo}),
	}

	result := modelsResponse(config, []string{"seedance-video"}, nil)
	if len(result["text_models"].([]string)) != 0 || len(result["image_models"].([]string)) != 0 {
		t.Fatalf("disabled capability defaults leaked into model pull: %#v", result)
	}
	if result["default_text_model"] != "" || result["default_image_model"] != "" {
		t.Fatalf("disabled capability default values leaked into model pull: %#v", result)
	}
}

func TestAggregateModelsInfersCapabilitiesFromLegacyStoredModelFields(t *testing.T) {
	result := aggregateModelProviders([]model.ModelProviderConfig{
		{
			ID:                 "default",
			TextModel:          "gpt-5.4",
			ImageModel:         "gpt-image-2",
			Capabilities:       mustProviderJSONB([]string{}),
			ModelsByCapability: mustProviderJSONB(map[string][]string{}),
			DefaultFor:         mustProviderJSONB([]string{}),
			Enabled:            true,
		},
	})

	textModels := result["text_models"].([]string)
	imageModels := result["image_models"].([]string)
	if !containsString(textModels, "default::gpt-5.4") || !containsString(imageModels, "default::gpt-image-2") {
		t.Fatalf("legacy stored model fields were not inferred: %#v", result)
	}
	if result["default_text_model"] != "default::gpt-5.4" || result["default_image_model"] != "default::gpt-image-2" {
		t.Fatalf("legacy defaults were not inferred: %#v", result)
	}
}

func TestAggregateModelsHonorsCapabilitiesAndIncludesConfiguredDefault(t *testing.T) {
	result := aggregateModelProviders([]model.ModelProviderConfig{
		{
			ID:           "default",
			TextModel:    "gpt-5.4",
			ImageModel:   "gpt-image-2",
			Capabilities: mustProviderJSONB([]string{model.ModelCapabilityText, model.ModelCapabilityImage}),
			ModelsByCapability: mustProviderJSONB(map[string][]string{
				model.ModelCapabilityText:  {"gpt-5.2"},
				model.ModelCapabilityImage: {"gpt-image-2"},
				model.ModelCapabilityAudio: {"gpt-4o-audio-preview"},
			}),
			DefaultFor: mustProviderJSONB([]string{model.ModelCapabilityText, model.ModelCapabilityImage}),
			Enabled:    true,
		},
		{
			ID:         "video",
			TextModel:  "seedance-wrong-text",
			ImageModel: "seedance-wrong-image",
			VideoModel: "seedance-video",
			Capabilities: mustProviderJSONB([]string{
				model.ModelCapabilityVideo,
			}),
			ModelsByCapability: mustProviderJSONB(map[string][]string{
				model.ModelCapabilityText:  {"seedance-wrong-text"},
				model.ModelCapabilityImage: {"seedance-wrong-image"},
				model.ModelCapabilityVideo: {"seedance-video"},
			}),
			DefaultFor: mustProviderJSONB([]string{model.ModelCapabilityVideo}),
			Enabled:    true,
		},
	})
	textModels := result["text_models"].([]string)
	imageModels := result["image_models"].([]string)
	videoModels := result["video_models"].([]string)
	if !containsString(textModels, "default::gpt-5.4") {
		t.Fatalf("text models = %#v, configured default missing", textModels)
	}
	if containsString(textModels, "video::seedance-wrong-text") || containsString(imageModels, "video::seedance-wrong-image") {
		t.Fatalf("video-only provider leaked into text/image: text=%#v image=%#v", textModels, imageModels)
	}
	if !containsString(videoModels, "video::seedance-video") {
		t.Fatalf("video models = %#v", videoModels)
	}
}

func TestAggregateModelsExcludesNativeGeminiFromAgentTools(t *testing.T) {
	result := aggregateModelProviders([]model.ModelProviderConfig{
		{
			ID:                 "openai",
			Name:               "OpenAI Compatible",
			BaseURL:            "https://example.com/v1",
			AuthType:           model.ModelProviderAuthTypeBearer,
			TextModel:          "tool-model",
			Capabilities:       mustProviderJSONB([]string{model.ModelCapabilityText}),
			ModelsByCapability: mustProviderJSONB(map[string][]string{model.ModelCapabilityText: {"tool-model"}}),
			Enabled:            true,
		},
		{
			ID:                 "gemini-native",
			Name:               "Gemini Native",
			BaseURL:            "https://generativelanguage.googleapis.com/v1beta",
			AuthType:           model.ModelProviderAuthTypeXGoogAPIKey,
			TextModel:          "gemini-2.5-pro",
			Capabilities:       mustProviderJSONB([]string{model.ModelCapabilityText}),
			ModelsByCapability: mustProviderJSONB(map[string][]string{model.ModelCapabilityText: {"gemini-2.5-pro"}}),
			Enabled:            true,
		},
		{
			ID:                 "gemini-openai",
			Name:               "Gemini OpenAI",
			BaseURL:            "https://generativelanguage.googleapis.com/v1beta/openai",
			AuthType:           model.ModelProviderAuthTypeBearer,
			TextModel:          "gemini-2.5-flash",
			Capabilities:       mustProviderJSONB([]string{model.ModelCapabilityText}),
			ModelsByCapability: mustProviderJSONB(map[string][]string{model.ModelCapabilityText: {"gemini-2.5-flash"}}),
			Enabled:            true,
		},
	})
	textModels := result["text_models"].([]string)
	agentModels := result["agent_text_models"].([]string)
	if !containsString(textModels, "gemini-native::gemini-2.5-pro") {
		t.Fatalf("native Gemini missing from normal text models: %#v", textModels)
	}
	if containsString(agentModels, "gemini-native::gemini-2.5-pro") {
		t.Fatalf("native Gemini leaked into Agent models: %#v", agentModels)
	}
	if !containsString(agentModels, "openai::tool-model") || !containsString(agentModels, "gemini-openai::gemini-2.5-flash") {
		t.Fatalf("tool-capable models missing: %#v", agentModels)
	}
}
func TestAggregateModelsKeepsAliasesProviderSpecific(t *testing.T) {
	result := aggregateModelProviders([]model.ModelProviderConfig{
		{
			ID:                 "provider-a",
			Name:               "\u4e3b\u7ebf Provider",
			ImageModel:         "shared-image-model",
			Capabilities:       mustProviderJSONB([]string{model.ModelCapabilityImage}),
			ModelsByCapability: mustProviderJSONB(map[string][]string{model.ModelCapabilityImage: {"shared-image-model"}}),
			ModelAliases:       mustProviderJSONB(map[string]string{"shared-image-model": "\u9ad8\u6e05\u5546\u54c1\u56fe"}),
			Enabled:            true,
		},
		{
			ID:                 "provider-b",
			Name:               "\u5907\u7528 Provider",
			ImageModel:         "shared-image-model",
			Capabilities:       mustProviderJSONB([]string{model.ModelCapabilityImage}),
			ModelsByCapability: mustProviderJSONB(map[string][]string{model.ModelCapabilityImage: {"shared-image-model"}}),
			ModelAliases:       mustProviderJSONB(map[string]string{"shared-image-model": "\u5feb\u901f\u8349\u56fe"}),
			Enabled:            true,
		},
		{
			ID:                 "legacy",
			Name:               "\u65e7 Provider",
			ImageModel:         "legacy-image-model",
			Capabilities:       mustProviderJSONB([]string{model.ModelCapabilityImage}),
			ModelsByCapability: mustProviderJSONB(map[string][]string{model.ModelCapabilityImage: {"legacy-image-model"}}),
			Enabled:            true,
		},
	})

	labels := result["model_labels"].(map[string]string)
	providerNames := result["model_provider_names"].(map[string]string)
	if labels["provider-a::shared-image-model"] != "\u9ad8\u6e05\u5546\u54c1\u56fe" || labels["provider-b::shared-image-model"] != "\u5feb\u901f\u8349\u56fe" {
		t.Fatalf("provider-specific labels = %#v", labels)
	}
	if _, exists := labels["legacy::legacy-image-model"]; exists {
		t.Fatalf("legacy provider unexpectedly received an alias: %#v", labels)
	}
	if providerNames["provider-a::shared-image-model"] != "\u4e3b\u7ebf Provider" || providerNames["provider-b::shared-image-model"] != "\u5907\u7528 Provider" || providerNames["legacy::legacy-image-model"] != "\u65e7 Provider" {
		t.Fatalf("provider names = %#v", providerNames)
	}
	imageModels := result["image_models"].([]string)
	if !containsString(imageModels, "provider-a::shared-image-model") || !containsString(imageModels, "provider-b::shared-image-model") {
		t.Fatalf("same model ID providers were collapsed: %#v", imageModels)
	}
}

func TestAIModelsAndTextUseProviderWithoutLeakingConfig(t *testing.T) {
	var authHeaders []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeaders = append(authHeaders, r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/models":
			_, _ = w.Write([]byte(`{"data":[{"id":"llama3.1"},{"id":"seedream-4-image"}]}`))
		case "/v1/responses":
			_, _ = w.Write([]byte(`{"model":"llama3.1","output_text":"pong"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	router, providerRepo := newProviderTestRouter(t, "secret")
	if _, err := providerRepo.UpsertDefaultModelProvider(model.ModelProviderConfig{
		ID:         model.ModelProviderIDDefault,
		Mode:       model.ModelProviderModeLocalOpenAI,
		BaseURL:    server.URL + "/v1",
		AuthType:   model.ModelProviderAuthTypeNone,
		TextModel:  "llama3.1",
		ImageModel: "flux-image",
		TimeoutMS:  model.ModelProviderDefaultTimeoutMilli,
		Enabled:    true,
	}); err != nil {
		t.Fatal(err)
	}
	memberCookie := loginCookie(t, router, "member", "secret")

	models := performJSON(router, http.MethodGet, "/api/ai/models", "", memberCookie)
	if models.Code != http.StatusOK {
		t.Fatalf("models status = %d, body = %s", models.Code, models.Body.String())
	}
	var modelsBody struct {
		Success bool `json:"success"`
		Data    struct {
			Models            []string `json:"models"`
			TextModels        []string `json:"text_models"`
			ImageModels       []string `json:"image_models"`
			DefaultTextModel  string   `json:"default_text_model"`
			DefaultImageModel string   `json:"default_image_model"`
		} `json:"data"`
	}
	if err := json.Unmarshal(models.Body.Bytes(), &modelsBody); err != nil {
		t.Fatalf("models json.Unmarshal() error = %v; body = %s", err, models.Body.String())
	}
	if len(modelsBody.Data.Models) != 2 || !containsString(modelsBody.Data.Models, "default::llama3.1") || !containsString(modelsBody.Data.Models, "default::flux-image") {
		t.Fatalf("models = %#v, want encoded default provider models", modelsBody.Data.Models)
	}
	if len(modelsBody.Data.TextModels) != 1 || modelsBody.Data.TextModels[0] != "default::llama3.1" {
		t.Fatalf("text_models = %#v, want encoded text model", modelsBody.Data.TextModels)
	}
	if modelsBody.Data.DefaultTextModel != "default::llama3.1" {
		t.Fatalf("default_text_model = %q, want default::llama3.1", modelsBody.Data.DefaultTextModel)
	}
	if len(modelsBody.Data.ImageModels) != 1 || modelsBody.Data.ImageModels[0] != "default::flux-image" {
		t.Fatalf("image_models = %#v, want encoded image model", modelsBody.Data.ImageModels)
	}
	if modelsBody.Data.DefaultImageModel != "default::flux-image" {
		t.Fatalf("default_image_model = %q, want default::flux-image", modelsBody.Data.DefaultImageModel)
	}
	if strings.Contains(models.Body.String(), server.URL) {
		t.Fatalf("models response leaked base_url: %s", models.Body.String())
	}
	if strings.Contains(strings.ToLower(models.Body.String()), "authorization") {
		t.Fatalf("models response leaked authorization data: %s", models.Body.String())
	}

	text := performJSON(router, http.MethodPost, "/api/ai/text", `{"prompt":"ping"}`, memberCookie)
	if text.Code != http.StatusOK {
		t.Fatalf("text status = %d, body = %s", text.Code, text.Body.String())
	}
	if !strings.Contains(text.Body.String(), `"text":"pong"`) {
		t.Fatalf("text response = %s", text.Body.String())
	}
	for _, header := range authHeaders {
		if header != "" {
			t.Fatalf("auth_type=none sent Authorization %q", header)
		}
	}
}

func TestAITextUsesDefaultTimeoutForLegacyZeroTimeoutConfig(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path != "/v1/responses" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(`{"model":"llama3.1","output_text":"pong"}`))
	}))
	defer server.Close()

	router, providerRepo := newProviderTestRouter(t, "secret")
	if _, err := providerRepo.UpsertDefaultModelProvider(model.ModelProviderConfig{
		ID:        model.ModelProviderIDDefault,
		Mode:      model.ModelProviderModeLocalOpenAI,
		BaseURL:   server.URL + "/v1",
		AuthType:  model.ModelProviderAuthTypeNone,
		TextModel: "llama3.1",
		TimeoutMS: 0,
		Enabled:   true,
	}); err != nil {
		t.Fatal(err)
	}
	memberCookie := loginCookie(t, router, "member", "secret")

	text := performJSON(router, http.MethodPost, "/api/ai/text", `{"prompt":"ping"}`, memberCookie)
	if text.Code != http.StatusOK {
		t.Fatalf("text status = %d, body = %s", text.Code, text.Body.String())
	}
	if !strings.Contains(text.Body.String(), `"text":"pong"`) {
		t.Fatalf("text response = %s", text.Body.String())
	}
}

func TestAITextForwardsStructuredMessagesToolsAndFullSelector(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["model"] != "gpt-agent" {
			t.Fatalf("provider model = %#v", body["model"])
		}
		input, _ := body["input"].([]any)
		tools, _ := body["tools"].([]any)
		if len(input) != 1 || len(tools) != 1 || body["parallel_tool_calls"] != false {
			t.Fatalf("structured provider body = %#v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"model":"gpt-agent","status":"completed","output":[{"type":"function_call","call_id":"call_canvas","name":"canvas_get_state","arguments":"{}"}]}`))
	}))
	defer server.Close()

	router, providerRepo := newProviderTestRouter(t, "secret")
	if _, err := providerRepo.UpsertDefaultModelProvider(model.ModelProviderConfig{
		ID: model.ModelProviderIDDefault, Mode: model.ModelProviderModeOpenAICompatible,
		BaseURL: server.URL, AuthType: model.ModelProviderAuthTypeNone, TextModel: "gpt-agent",
		Capabilities:       mustProviderJSONB([]string{model.ModelCapabilityText}),
		ModelsByCapability: mustProviderJSONB(map[string][]string{model.ModelCapabilityText: {"gpt-agent"}}),
		TimeoutMS:          model.ModelProviderDefaultTimeoutMilli, Enabled: true,
	}); err != nil {
		t.Fatal(err)
	}
	memberCookie := loginCookie(t, router, "member", "secret")
	text := performJSON(router, http.MethodPost, "/api/ai/text", `{
		"model":"default::gpt-agent",
		"messages":[{"role":"user","content":"read canvas"}],
		"tools":[{"type":"function","function":{"name":"canvas_get_state","parameters":{"type":"object"}}}],
		"tool_choice":"required",
		"parallel_tool_calls":false,
		"stream":false
	}`, memberCookie)
	if text.Code != http.StatusOK {
		t.Fatalf("text status = %d, body = %s", text.Code, text.Body.String())
	}
	if !strings.Contains(text.Body.String(), `"finish_reason":"tool_calls"`) || !strings.Contains(text.Body.String(), `"id":"call_canvas"`) {
		t.Fatalf("structured text response = %s", text.Body.String())
	}
}

func TestAITextSupportsRootBaseURLWithResponses(t *testing.T) {
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"model":"gpt-5.5","output_text":"pong"}`))
	}))
	defer server.Close()

	router, providerRepo := newProviderTestRouter(t, "secret")
	if _, err := providerRepo.UpsertDefaultModelProvider(model.ModelProviderConfig{
		ID:        model.ModelProviderIDDefault,
		Mode:      model.ModelProviderModeOpenAICompatible,
		BaseURL:   server.URL,
		AuthType:  model.ModelProviderAuthTypeNone,
		TextModel: "gpt-5.5",
		TimeoutMS: model.ModelProviderDefaultTimeoutMilli,
		Enabled:   true,
	}); err != nil {
		t.Fatal(err)
	}
	memberCookie := loginCookie(t, router, "member", "secret")

	text := performJSON(router, http.MethodPost, "/api/ai/text", `{"prompt":"ping"}`, memberCookie)
	if text.Code != http.StatusOK {
		t.Fatalf("text status = %d, body = %s", text.Code, text.Body.String())
	}
	if gotPath != "/v1/responses" {
		t.Fatalf("provider path = %q, want /v1/responses", gotPath)
	}
}

func TestAdminProviderTestReturnsStringModels(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/models":
			_, _ = w.Write([]byte(`{"data":[{"id":"llama3.1"},{"id":"qwen2.5"}]}`))
		case "/v1/responses":
			_, _ = w.Write([]byte(`{"model":"llama3.1","output_text":"pong"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	router, providerRepo := newProviderTestRouter(t, "secret")
	if _, err := providerRepo.UpsertDefaultModelProvider(model.ModelProviderConfig{
		ID:        model.ModelProviderIDDefault,
		Mode:      model.ModelProviderModeLocalOpenAI,
		BaseURL:   server.URL + "/v1",
		AuthType:  model.ModelProviderAuthTypeNone,
		TextModel: "llama3.1",
		TimeoutMS: model.ModelProviderDefaultTimeoutMilli,
		Enabled:   true,
	}); err != nil {
		t.Fatal(err)
	}
	adminCookie := loginCookie(t, router, "admin", "secret")

	recorder := performJSON(router, http.MethodPost, "/api/admin/model-provider/test", "", adminCookie)
	if recorder.Code != http.StatusOK {
		t.Fatalf("provider test status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var body struct {
		Success bool `json:"success"`
		Data    struct {
			Models   []string `json:"models"`
			ModelsOK bool     `json:"models_ok"`
			TextOK   bool     `json:"text_ok"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("provider test json.Unmarshal() error = %v; body = %s", err, recorder.Body.String())
	}
	if !body.Data.ModelsOK || !body.Data.TextOK {
		t.Fatalf("provider test flags = models_ok:%v text_ok:%v", body.Data.ModelsOK, body.Data.TextOK)
	}
	if len(body.Data.Models) != 2 || body.Data.Models[0] != "llama3.1" || body.Data.Models[1] != "qwen2.5" {
		t.Fatalf("models = %#v, want string model ids", body.Data.Models)
	}
	if strings.Contains(recorder.Body.String(), server.URL) || strings.Contains(strings.ToLower(recorder.Body.String()), "authorization") {
		t.Fatalf("provider test leaked sensitive data: %s", recorder.Body.String())
	}
}

func TestAdminProviderTestUsesRequestPayload(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/models":
			_, _ = w.Write([]byte(`{"data":[{"id":"payload-model"}]}`))
		case "/v1/responses":
			_, _ = w.Write([]byte(`{"model":"payload-model","output":[{"type":"message","content":[{"type":"output_text","text":"pong"}]}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	router, providerRepo := newProviderTestRouter(t, "secret")
	if _, err := providerRepo.UpsertDefaultModelProvider(model.ModelProviderConfig{
		ID:        model.ModelProviderIDDefault,
		Mode:      model.ModelProviderModeLocalOpenAI,
		BaseURL:   "http://old-provider.test/v1",
		AuthType:  model.ModelProviderAuthTypeNone,
		TextModel: "old-model",
		TimeoutMS: model.ModelProviderDefaultTimeoutMilli,
		Enabled:   true,
	}); err != nil {
		t.Fatal(err)
	}
	adminCookie := loginCookie(t, router, "admin", "secret")

	recorder := performJSON(router, http.MethodPost, "/api/admin/model-provider/test", `{"mode":"local_openai","base_url":"`+server.URL+`/v1","auth_type":"none","text_model":"payload-model","timeout_ms":30000,"enabled":true}`, adminCookie)
	if recorder.Code != http.StatusOK {
		t.Fatalf("provider test status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), `"model":"payload-model"`) {
		t.Fatalf("provider test did not use request payload: %s", recorder.Body.String())
	}
}

func TestAdminProviderModelsUsesRequestPayload(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path != "/v1/models" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(`{"data":[{"id":"payload-model"},{"id":"other-model"}]}`))
	}))
	defer server.Close()

	router, _ := newProviderTestRouter(t, "secret")
	adminCookie := loginCookie(t, router, "admin", "secret")

	recorder := performJSON(router, http.MethodPost, "/api/admin/model-provider/models", `{"mode":"local_openai","base_url":"`+server.URL+`/v1","auth_type":"none","text_model":"payload-model","timeout_ms":30000,"enabled":true}`, adminCookie)
	if recorder.Code != http.StatusOK {
		t.Fatalf("provider models status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var body struct {
		Data struct {
			Models []string `json:"models"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("provider models json.Unmarshal() error = %v; body = %s", err, recorder.Body.String())
	}
	if len(body.Data.Models) != 2 || body.Data.Models[0] != "payload-model" || body.Data.Models[1] != "other-model" {
		t.Fatalf("models = %#v", body.Data.Models)
	}
}

func TestAITextBearerSendsAuthorizationWhenKeyExists(t *testing.T) {
	testCases := []struct {
		name       string
		authType   string
		wantHeader string
		wantValue  string
	}{
		{
			name:       "bearer",
			authType:   model.ModelProviderAuthTypeBearer,
			wantHeader: "Authorization",
			wantValue:  "Bearer sk-test",
		},
		{
			name:       "x-api-key",
			authType:   model.ModelProviderAuthTypeXAPIKey,
			wantHeader: "x-api-key",
			wantValue:  "sk-test",
		},
		{
			name:       "x-goog-api-key",
			authType:   model.ModelProviderAuthTypeXGoogAPIKey,
			wantHeader: "x-goog-api-key",
			wantValue:  "sk-test",
		},
	}
	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			assertAITextSendsAuthHeader(t, tc.authType, tc.wantHeader, tc.wantValue)
		})
	}
}

func TestAIImageGenerationsProxyUsesProviderAuthAndReturnsImages(t *testing.T) {
	var providerCalled bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		providerCalled = true
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"b64_json":"sync-should-not-run"}]}`))
	}))
	defer server.Close()

	router, providerRepo := newProviderTestRouter(t, "secret")
	secretBox := provider.NewSecretBox("secret")
	encrypted, err := secretBox.Encrypt("sk-image")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := providerRepo.UpsertDefaultModelProvider(model.ModelProviderConfig{
		ID:              model.ModelProviderIDDefault,
		Mode:            model.ModelProviderModeOpenAICompatible,
		BaseURL:         server.URL + "/v1",
		AuthType:        model.ModelProviderAuthTypeAutoAPIKey,
		APIKeyEncrypted: encrypted,
		TextModel:       "gpt-5.4-mini",
		ImageModel:      "gpt-image-1",
		TimeoutMS:       model.ModelProviderDefaultTimeoutMilli,
		Enabled:         true,
	}); err != nil {
		t.Fatal(err)
	}

	memberCookie := loginCookie(t, router, "member", "secret")
	recorder := performJSON(router, http.MethodPost, "/api/ai/images/generations", `{"model":"gpt-image-1","prompt":"test prompt","size":"1024x1024","n":1,"background":"transparent"}`, memberCookie)
	jobID := assertAcceptedJobResponse(t, recorder)
	if providerCalled {
		t.Fatal("provider should not be called synchronously")
	}
	payload := fetchJobPayload(t, router, jobID, memberCookie)
	if payload["prompt"] != "test prompt" || payload["background"] != "transparent" || payload["model"] != "gpt-image-1" {
		t.Fatalf("job payload = %+v", payload)
	}
	if strings.Contains(recorder.Body.String(), server.URL) || strings.Contains(strings.ToLower(recorder.Body.String()), "authorization") || strings.Contains(recorder.Body.String(), "sk-image") {
		t.Fatalf("image response leaked provider details: %s", recorder.Body.String())
	}
}

func TestAIImageGenerationsNormalizesSharedQualityAndRatioBeforeQueueing(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("provider should not be called synchronously")
	}))
	defer server.Close()

	router, providerRepo := newProviderTestRouter(t, "secret")
	configureOpenAICompatibleProvider(t, providerRepo, server.URL+"/v1", "sk-image", "gpt-image-1")
	memberCookie := loginCookie(t, router, "member", "secret")
	recorder := performJSON(router, http.MethodPost, "/api/ai/images/generations", `{"model":"gpt-image-1","prompt":"ratio parity","size":"16:9","quality":"2k","output_format":"PNG","n":1}`, memberCookie)
	jobID := assertAcceptedJobResponse(t, recorder)
	payload := fetchJobPayload(t, router, jobID, memberCookie)
	if payload["size"] != "2720x1536" || payload["quality"] != "medium" || payload["output_format"] != "png" || payload["n"] != float64(1) {
		t.Fatalf("normalized payload = %+v", payload)
	}

	invalid := performJSON(router, http.MethodPost, "/api/ai/images/generations", `{"model":"gpt-image-1","prompt":"invalid","size":"1000x1000","quality":"auto"}`, memberCookie)
	if invalid.Code != http.StatusBadRequest || !strings.Contains(invalid.Body.String(), service.ErrImageGenerationSizeInvalid.Error()) {
		t.Fatalf("invalid status=%d body=%s", invalid.Code, invalid.Body.String())
	}
}

func TestAIImageGenerationsUsesResponsesForMainModel(t *testing.T) {
	var providerCalled bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		providerCalled = true
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"model":"gpt-5.5","output":[{"type":"image_generation_call","result":"abcd"}]}`))
	}))
	defer server.Close()

	router, providerRepo := newProviderTestRouter(t, "secret")
	if _, err := providerRepo.UpsertDefaultModelProvider(model.ModelProviderConfig{
		ID:         model.ModelProviderIDDefault,
		Mode:       model.ModelProviderModeOpenAICompatible,
		BaseURL:    server.URL,
		AuthType:   model.ModelProviderAuthTypeNone,
		TextModel:  "gpt-5.5",
		ImageModel: "gpt-5.5",
		TimeoutMS:  model.ModelProviderDefaultTimeoutMilli,
		Enabled:    true,
	}); err != nil {
		t.Fatal(err)
	}
	memberCookie := loginCookie(t, router, "member", "secret")

	recorder := performJSON(router, http.MethodPost, "/api/ai/images/generations", `{"model":"gpt-5.5","prompt":"paint","size":"1024x1024","quality":"low","n":1}`, memberCookie)
	jobID := assertAcceptedJobResponse(t, recorder)
	if providerCalled {
		t.Fatal("provider should not be called synchronously")
	}
	payload := fetchJobPayload(t, router, jobID, memberCookie)
	if payload["model"] != "gpt-5.5" || payload["prompt"] != "paint" || payload["quality"] != "low" {
		t.Fatalf("job payload = %+v", payload)
	}
}

func TestAIImageGenerationsAllowsImageOnlyProviderAndNormalizesFlexiblePayload(t *testing.T) {
	var providerCalled bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		providerCalled = true
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"b64_json":"sync-should-not-run"}]}`))
	}))
	defer server.Close()

	router, providerRepo := newProviderTestRouter(t, "secret")
	if _, err := providerRepo.UpsertDefaultModelProvider(model.ModelProviderConfig{
		ID:         model.ModelProviderIDDefault,
		Mode:       model.ModelProviderModeOpenAICompatible,
		BaseURL:    server.URL + "/v1",
		AuthType:   model.ModelProviderAuthTypeNone,
		ImageModel: "flux-image",
		TimeoutMS:  model.ModelProviderDefaultTimeoutMilli,
		Enabled:    true,
	}); err != nil {
		t.Fatal(err)
	}

	memberCookie := loginCookie(t, router, "member", "secret")
	recorder := performJSON(router, http.MethodPost, "/api/ai/images/generations", `{"prompt":"image only","n":1}`, memberCookie)
	jobID := assertAcceptedJobResponse(t, recorder)
	if providerCalled {
		t.Fatal("provider should not be called synchronously")
	}
	payload := fetchJobPayload(t, router, jobID, memberCookie)
	if payload["model"] != "flux-image" || payload["prompt"] != "image only" {
		t.Fatalf("job payload = %+v", payload)
	}
	if strings.Contains(recorder.Body.String(), server.URL) || strings.Contains(strings.ToLower(recorder.Body.String()), "authorization") {
		t.Fatalf("image response leaked provider details: %s", recorder.Body.String())
	}
}

func TestAIImageGenerationsUsesLongTimeoutForImages(t *testing.T) {
	var providerCalled bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		providerCalled = true
		time.Sleep(50 * time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"b64_json":"sync-should-not-run"}]}`))
	}))
	defer server.Close()

	router, providerRepo := newProviderTestRouter(t, "secret")
	if _, err := providerRepo.UpsertDefaultModelProvider(model.ModelProviderConfig{
		ID:         model.ModelProviderIDDefault,
		Mode:       model.ModelProviderModeOpenAICompatible,
		BaseURL:    server.URL + "/v1",
		AuthType:   model.ModelProviderAuthTypeNone,
		ImageModel: "gpt-image-2",
		TimeoutMS:  10,
		Enabled:    true,
	}); err != nil {
		t.Fatal(err)
	}

	memberCookie := loginCookie(t, router, "member", "secret")
	startedAt := time.Now()
	recorder := performJSON(router, http.MethodPost, "/api/ai/images/generations", `{"prompt":"slow image","n":1}`, memberCookie)
	assertAcceptedJobResponse(t, recorder)
	if providerCalled {
		t.Fatal("provider should not be called synchronously")
	}
	if elapsed := time.Since(startedAt); elapsed >= 50*time.Millisecond {
		t.Fatalf("async image submission took %s, expected no upstream wait", elapsed)
	}
}

func TestAIImageGenerationsUsesGeminiNativeEndpoint(t *testing.T) {
	var providerCalled bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		providerCalled = true
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"candidates":[]}`))
	}))
	defer server.Close()

	router, providerRepo := newProviderTestRouter(t, "secret")
	secretBox := provider.NewSecretBox("secret")
	encrypted, err := secretBox.Encrypt("gemini-key")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := providerRepo.UpsertDefaultModelProvider(model.ModelProviderConfig{
		ID:              model.ModelProviderIDDefault,
		Mode:            model.ModelProviderModeOpenAICompatible,
		BaseURL:         server.URL + "/v1beta",
		AuthType:        model.ModelProviderAuthTypeXGoogAPIKey,
		APIKeyEncrypted: encrypted,
		ImageModel:      "gemini-2.5-flash-image-preview",
		TimeoutMS:       model.ModelProviderDefaultTimeoutMilli,
		Enabled:         true,
	}); err != nil {
		t.Fatal(err)
	}

	memberCookie := loginCookie(t, router, "member", "secret")
	recorder := performJSON(router, http.MethodPost, "/api/ai/images/generations", `{"prompt":"gemini image","n":1}`, memberCookie)
	jobID := assertAcceptedJobResponse(t, recorder)
	if providerCalled {
		t.Fatal("provider should not be called synchronously")
	}
	payload := fetchJobPayload(t, router, jobID, memberCookie)
	if payload["model"] != "gemini-2.5-flash-image-preview" || payload["prompt"] != "gemini image" {
		t.Fatalf("job payload = %+v", payload)
	}
}

func TestAIImageGenerationsDoesNotSynchronouslyReturnProviderError(t *testing.T) {
	var providerCalled bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		providerCalled = true
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"message":"model does not support images"}}`))
	}))
	defer server.Close()

	router, providerRepo := newProviderTestRouter(t, "secret")
	if _, err := providerRepo.UpsertDefaultModelProvider(model.ModelProviderConfig{
		ID:         model.ModelProviderIDDefault,
		Mode:       model.ModelProviderModeOpenAICompatible,
		BaseURL:    server.URL + "/v1",
		AuthType:   model.ModelProviderAuthTypeNone,
		ImageModel: "text-only-model",
		TimeoutMS:  model.ModelProviderDefaultTimeoutMilli,
		Enabled:    true,
	}); err != nil {
		t.Fatal(err)
	}

	memberCookie := loginCookie(t, router, "member", "secret")
	req := httptest.NewRequest(http.MethodPost, "/api/ai/images/generations", strings.NewReader(`{"prompt":"bad image","n":1}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Request-Id", "image-failure-test")
	req.AddCookie(memberCookie)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)

	assertAcceptedJobResponse(t, recorder)
	if providerCalled {
		t.Fatal("provider should not be called synchronously")
	}
}

func TestDescribeProviderErrorDistinguishesCancellationTimeoutAndProviderStatus(t *testing.T) {
	cancelInfo := describeProviderError("", context.Canceled)
	if cancelInfo.HTTPStatus != clientClosedRequestStatus || cancelInfo.Message != "请求已被取消" {
		t.Fatalf("cancel info = %+v", cancelInfo)
	}

	timeoutInfo := describeProviderError("", context.DeadlineExceeded)
	if timeoutInfo.HTTPStatus != http.StatusGatewayTimeout || timeoutInfo.Message != "模型服务响应超时" {
		t.Fatalf("timeout info = %+v", timeoutInfo)
	}

	providerInfo := describeProviderError("", &provider.ProviderHTTPError{Method: http.MethodPost, URL: "https://example.test/v1/images", StatusCode: http.StatusTooManyRequests, Body: `{"error":{"message":"rate limited"}}`})
	if providerInfo.HTTPStatus != http.StatusBadGateway || providerInfo.ProviderStatus != http.StatusTooManyRequests {
		t.Fatalf("provider info = %+v", providerInfo)
	}
	if !strings.Contains(providerInfo.Reason, "rate limited") {
		t.Fatalf("provider reason missing body message: %+v", providerInfo)
	}
}

func TestAIImageEditsProxyForwardsMultipart(t *testing.T) {
	var providerCalled bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		providerCalled = true
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"created":456,"data":[{"b64_json":"abcd"}]}`))
	}))
	defer server.Close()

	router, providerRepo := newProviderTestRouter(t, "secret")
	configureOpenAICompatibleProvider(t, providerRepo, server.URL+"/v1", "sk-edit", "gpt-image-1")

	memberCookie := loginCookie(t, router, "member", "secret")
	body := &strings.Builder{}
	writer := multipart.NewWriter(body)
	_ = writer.WriteField("model", "gpt-image-1")
	_ = writer.WriteField("prompt", "edit prompt")
	_ = writer.WriteField("n", "2")
	_ = writer.WriteField("response_format", "b64_json")
	_ = writer.WriteField("output_format", "png")
	writeMultipartFilePart(t, writer, "image", "input.png", "application/octet-stream", []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"))
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/ai/images/edits", strings.NewReader(body.String()))
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.AddCookie(memberCookie)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)

	jobID := assertAcceptedJobResponse(t, recorder)
	if providerCalled {
		t.Fatal("provider should not be called synchronously")
	}
	payload := fetchJobPayload(t, router, jobID, memberCookie)
	if payload["model"] != "gpt-image-1" || payload["prompt"] != "edit prompt" {
		t.Fatalf("job payload base fields = %+v", payload)
	}
	if payload["n"] != float64(2) || payload["response_format"] != "b64_json" || payload["output_format"] != "png" {
		t.Fatalf("job payload options = %+v", payload)
	}
	files, ok := payload["files"].([]any)
	if !ok || len(files) != 1 {
		t.Fatalf("job payload files = %+v", payload["files"])
	}
	file := files[0].(map[string]any)
	if file["filename"] != "input.png" || file["content_type"] != "image/png" || file["storage_key"] == "" || file["sha256"] == "" {
		t.Fatalf("job payload file = %+v", file)
	}
	if _, exists := file["b64_json"]; exists {
		t.Fatalf("new job payload must not contain b64_json: %+v", file)
	}
}

func TestAIImageEditsEnqueueFailureCleansStagedInput(t *testing.T) {
	root := t.TempDir()
	producer := producerFunc(func(context.Context, queue.TaskMessage) error {
		return errors.New("broker unavailable")
	})
	router, providerRepo := newProviderTestRouterWithJobDependencies(t, "secret", producer, root)
	configureOpenAICompatibleProvider(t, providerRepo, "http://provider.invalid/v1", "sk-edit", "gpt-image-1")
	memberCookie := loginCookie(t, router, "member", "secret")

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	_ = writer.WriteField("model", "gpt-image-1")
	_ = writer.WriteField("prompt", "cleanup failed enqueue")
	writeMultipartFilePart(t, writer, "image", "input.png", "image/png", []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"))
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/ai/images/edits", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.AddCookie(memberCookie)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusBadGateway {
		t.Fatalf("enqueue failure status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if files := regularFilesUnder(t, root); len(files) != 0 {
		t.Fatalf("enqueue failure left staged files: %v", files)
	}
}

func TestAIImageEditsImplicitIdempotencyCleansDuplicateStagedInput(t *testing.T) {
	root := t.TempDir()
	producer := &queue.MemoryProducer{}
	router, providerRepo := newProviderTestRouterWithJobDependencies(t, "secret", producer, root)
	configureOpenAICompatibleProvider(t, providerRepo, "http://provider.invalid/v1", "sk-edit", "gpt-image-1")
	memberCookie := loginCookie(t, router, "member", "secret")

	perform := func() *httptest.ResponseRecorder {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		_ = writer.WriteField("model", "gpt-image-1")
		_ = writer.WriteField("prompt", "same implicit request")
		writeMultipartFilePart(t, writer, "image", "input.png", "image/png", []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"))
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(http.MethodPost, "/api/ai/images/edits", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		req.AddCookie(memberCookie)
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, req)
		return recorder
	}

	firstID := assertAcceptedJobResponse(t, perform())
	secondID := assertAcceptedJobResponse(t, perform())
	if firstID != secondID {
		t.Fatalf("implicit idempotency job IDs = %q, %q", firstID, secondID)
	}
	if len(producer.Messages) != 1 {
		t.Fatalf("published messages = %d, want 1", len(producer.Messages))
	}
	files := regularFilesUnder(t, root)
	if len(files) != 1 {
		t.Fatalf("duplicate request left %d staged files, want 1: %v", len(files), files)
	}
	payload := fetchJobPayload(t, router, firstID, memberCookie)
	items, ok := payload["files"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("job payload files = %+v", payload["files"])
	}
	storageKey := items[0].(map[string]any)["storage_key"].(string)
	wantPath := filepath.Clean(filepath.Join(root, filepath.FromSlash(storageKey)))
	if filepath.Clean(files[0]) != wantPath {
		t.Fatalf("remaining staged file = %q, want original job input %q", files[0], wantPath)
	}
}

func TestAIImageEditsProxyOmitsGPTImage2UnsupportedMultipartFields(t *testing.T) {
	var providerCalled bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		providerCalled = true
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"created":456,"data":[{"b64_json":"abcd"}]}`))
	}))
	defer server.Close()

	router, providerRepo := newProviderTestRouter(t, "secret")
	configureOpenAICompatibleProvider(t, providerRepo, server.URL+"/v1", "sk-edit", "gpt-image-2")

	memberCookie := loginCookie(t, router, "member", "secret")
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	_ = writer.WriteField("model", "gpt-image-2")
	_ = writer.WriteField("prompt", "edit prompt")
	_ = writer.WriteField("size", "1024x1024")
	_ = writer.WriteField("quality", "low")
	_ = writer.WriteField("n", "2")
	_ = writer.WriteField("response_format", "b64_json")
	_ = writer.WriteField("output_format", "png")
	writeMultipartFilePart(t, writer, "image", "input.png", "application/octet-stream", []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"))
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/ai/images/edits", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.AddCookie(memberCookie)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)

	jobID := assertAcceptedJobResponse(t, recorder)
	if providerCalled {
		t.Fatal("provider should not be called synchronously")
	}
	payload := fetchJobPayload(t, router, jobID, memberCookie)
	if payload["model"] != "gpt-image-2" || payload["prompt"] != "edit prompt" || payload["size"] != "1024x1024" || payload["quality"] != "low" {
		t.Fatalf("job payload base fields = %+v", payload)
	}
	if _, ok := payload["n"]; ok {
		t.Fatalf("gpt-image-2 unsupported n was queued: %+v", payload)
	}
	if _, ok := payload["response_format"]; ok {
		t.Fatalf("gpt-image-2 unsupported response_format was queued: %+v", payload)
	}
	if _, ok := payload["output_format"]; ok {
		t.Fatalf("gpt-image-2 unsupported output_format was queued: %+v", payload)
	}
}

func TestAIImageEditsProxyDetectsImageMultipartContentTypes(t *testing.T) {
	testCases := []struct {
		name        string
		fileName    string
		contentType string
		body        []byte
		want        string
	}{
		{
			name:        "png from octet stream",
			fileName:    "input.bin",
			contentType: "application/octet-stream",
			body:        []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"),
			want:        "image/png",
		},
		{
			name:        "jpeg from octet stream",
			fileName:    "input.bin",
			contentType: "application/octet-stream",
			body:        []byte{0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 'J', 'F', 'I', 'F', 0x00, 0x01},
			want:        "image/jpeg",
		},
		{
			name:        "webp from octet stream",
			fileName:    "input.bin",
			contentType: "application/octet-stream",
			body:        []byte("RIFF\x10\x00\x00\x00WEBPVP8 "),
			want:        "image/webp",
		},
		{
			name:        "gif from octet stream",
			fileName:    "input.bin",
			contentType: "application/octet-stream",
			body:        []byte("GIF89a\x01\x00\x01\x00\x80\x00\x00"),
			want:        "image/gif",
		},
		{
			name:        "keeps valid image header",
			fileName:    "input.png",
			contentType: "image/png",
			body:        []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"),
			want:        "image/png",
		},
		{
			name:        "filename hint when content is empty",
			fileName:    "input.gif",
			contentType: "application/octet-stream",
			body:        []byte{},
			want:        "image/gif",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			var providerCalled bool
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				providerCalled = true
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"created":456,"data":[{"b64_json":"abcd"}]}`))
			}))
			defer server.Close()

			router, providerRepo := newProviderTestRouter(t, "secret")
			configureOpenAICompatibleProvider(t, providerRepo, server.URL+"/v1", "sk-edit", "gpt-image-1")
			memberCookie := loginCookie(t, router, "member", "secret")
			body := &bytes.Buffer{}
			writer := multipart.NewWriter(body)
			_ = writer.WriteField("model", "gpt-image-1")
			_ = writer.WriteField("prompt", "edit prompt")
			writeMultipartFilePart(t, writer, "image", tc.fileName, tc.contentType, tc.body)
			if err := writer.Close(); err != nil {
				t.Fatal(err)
			}
			req := httptest.NewRequest(http.MethodPost, "/api/ai/images/edits", body)
			req.Header.Set("Content-Type", writer.FormDataContentType())
			req.AddCookie(memberCookie)
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, req)

			jobID := assertAcceptedJobResponse(t, recorder)
			if providerCalled {
				t.Fatal("provider should not be called synchronously")
			}
			payload := fetchJobPayload(t, router, jobID, memberCookie)
			files, ok := payload["files"].([]any)
			if !ok || len(files) != 1 {
				t.Fatalf("job payload files = %+v", payload["files"])
			}
			file := files[0].(map[string]any)
			if file["content_type"] != tc.want {
				t.Fatalf("queued image Content-Type = %q, want %q", file["content_type"], tc.want)
			}
		})
	}
}

func TestAIImageEditsProxyRejectsNonImageMultipartUpload(t *testing.T) {
	var providerCalled bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		providerCalled = true
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"created":456,"data":[{"b64_json":"abcd"}]}`))
	}))
	defer server.Close()

	router, providerRepo := newProviderTestRouter(t, "secret")
	configureOpenAICompatibleProvider(t, providerRepo, server.URL+"/v1", "sk-edit", "gpt-image-1")
	memberCookie := loginCookie(t, router, "member", "secret")
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	_ = writer.WriteField("model", "gpt-image-1")
	_ = writer.WriteField("prompt", "edit prompt")
	writeMultipartFilePart(t, writer, "image", "input.txt", "application/octet-stream", []byte("not an image"))
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/ai/images/edits", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.AddCookie(memberCookie)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("image edit status = %d, want %d; body = %s", recorder.Code, http.StatusBadRequest, recorder.Body.String())
	}
	if providerCalled {
		t.Fatal("provider should not be called for non-image uploads")
	}
	if !strings.Contains(recorder.Body.String(), provider.ErrUnsupportedImageUpload.Error()) {
		t.Fatalf("response body missing upload error: %s", recorder.Body.String())
	}
}

func TestAIImageEditsProxyRejectsFakeImageMultipartHeader(t *testing.T) {
	var providerCalled bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		providerCalled = true
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"created":456,"data":[{"b64_json":"abcd"}]}`))
	}))
	defer server.Close()

	router, providerRepo := newProviderTestRouter(t, "secret")
	configureOpenAICompatibleProvider(t, providerRepo, server.URL+"/v1", "sk-edit", "gpt-image-1")
	memberCookie := loginCookie(t, router, "member", "secret")
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	_ = writer.WriteField("model", "gpt-image-1")
	_ = writer.WriteField("prompt", "edit prompt")
	writeMultipartFilePart(t, writer, "image", "input.png", "image/png", []byte("not an image"))
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/ai/images/edits", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.AddCookie(memberCookie)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("image edit status = %d, want %d; body = %s", recorder.Code, http.StatusBadRequest, recorder.Body.String())
	}
	if providerCalled {
		t.Fatal("provider should not be called for fake image uploads")
	}
}

func TestAIImageEditsProxyRejectsConflictingImageMultipartMime(t *testing.T) {
	var providerCalled bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		providerCalled = true
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"created":456,"data":[{"b64_json":"abcd"}]}`))
	}))
	defer server.Close()

	router, providerRepo := newProviderTestRouter(t, "secret")
	configureOpenAICompatibleProvider(t, providerRepo, server.URL+"/v1", "sk-edit", "gpt-image-1")
	memberCookie := loginCookie(t, router, "member", "secret")
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	_ = writer.WriteField("model", "gpt-image-1")
	_ = writer.WriteField("prompt", "edit prompt")
	writeMultipartFilePart(t, writer, "image", "input.jpg", "image/jpeg", []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"))
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/ai/images/edits", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.AddCookie(memberCookie)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("image edit status = %d, want %d; body = %s", recorder.Code, http.StatusBadRequest, recorder.Body.String())
	}
	if providerCalled {
		t.Fatal("provider should not be called for conflicting image MIME uploads")
	}
}

func TestAIVideoMultipartProxyPreservesOriginalFileContentType(t *testing.T) {
	var providerCalled bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		providerCalled = true
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"video-task-1","status":"queued"}`))
	}))
	defer server.Close()

	router, providerRepo := newProviderTestRouter(t, "secret")
	configureOpenAICompatibleVideoProvider(t, providerRepo, server.URL+"/v1", "sk-video", "sora")
	memberCookie := loginCookie(t, router, "member", "secret")
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	_ = writer.WriteField("prompt", "multipart video")
	writeMultipartFilePart(t, writer, "reference", "clip.webm", "video/webm", []byte("webm-bytes"))
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/ai/videos", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.AddCookie(memberCookie)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)

	jobID := assertAcceptedJobResponse(t, recorder)
	if providerCalled {
		t.Fatal("provider should not be called synchronously")
	}
	jobRecorder := performJSON(router, http.MethodGet, "/api/jobs/"+url.PathEscape(jobID), "", memberCookie)
	if jobRecorder.Code != http.StatusOK || !strings.Contains(jobRecorder.Body.String(), `"type":"video.generate"`) {
		t.Fatalf("video job was not queued as generation: %d %s", jobRecorder.Code, jobRecorder.Body.String())
	}
	payload := fetchJobPayload(t, router, jobID, memberCookie)
	if payload["prompt"] != "multipart video" {
		t.Fatalf("job payload prompt = %+v", payload)
	}
	files, ok := payload["files"].([]any)
	if !ok || len(files) != 1 {
		t.Fatalf("job payload files = %+v", payload["files"])
	}
	file := files[0].(map[string]any)
	if file["filename"] != "clip.webm" || file["content_type"] != "video/webm" {
		t.Fatalf("job payload file = %+v", file)
	}
	if file["storage_key"] == "" || payload[service.InputStorageKeyPayloadField] != file["storage_key"] {
		t.Fatalf("video staged input reference = payload:%+v file:%+v", payload, file)
	}
}

func TestAIVideoProxyUsesProviderAuthAndStreamsContent(t *testing.T) {
	var createProviderCalled bool
	var gotContentAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/videos":
			createProviderCalled = true
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"video-task-1","status":"queued"}`))
		case "/v1/videos/video-task-1":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"video-task-1","status":"completed"}`))
		case "/v1/videos/video-task-1/content":
			gotContentAuth = r.Header.Get("Authorization")
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video-bytes"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	router, providerRepo := newProviderTestRouter(t, "secret")
	secretBox := provider.NewSecretBox("secret")
	encrypted, err := secretBox.Encrypt("sk-video")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := providerRepo.UpsertDefaultModelProvider(model.ModelProviderConfig{
		ID:              model.ModelProviderIDDefault,
		Mode:            model.ModelProviderModeOpenAICompatible,
		BaseURL:         server.URL + "/v1",
		AuthType:        model.ModelProviderAuthTypeBearer,
		APIKeyEncrypted: encrypted,
		VideoModel:      "sora",
		Capabilities:    mustProviderJSONB([]string{model.ModelCapabilityVideo}),
		ModelsByCapability: mustProviderJSONB(map[string][]string{
			model.ModelCapabilityVideo: {"sora"},
		}),
		DefaultFor: mustProviderJSONB([]string{model.ModelCapabilityVideo}),
		TimeoutMS:  model.ModelProviderDefaultTimeoutMilli,
		Enabled:    true,
	}); err != nil {
		t.Fatal(err)
	}

	memberCookie := loginCookie(t, router, "member", "secret")
	create := performJSON(router, http.MethodPost, "/api/ai/videos", `{"model":"sora","prompt":"move"}`, memberCookie)
	assertAcceptedJobResponse(t, create)
	if createProviderCalled {
		t.Fatal("video create provider should not be called synchronously")
	}
	get := performJSON(router, http.MethodGet, "/api/ai/videos/video-task-1", "", memberCookie)
	if get.Code != http.StatusOK || !strings.Contains(get.Body.String(), `"status":"completed"`) {
		t.Fatalf("video get = %d %s", get.Code, get.Body.String())
	}
	contentReq := httptest.NewRequest(http.MethodGet, "/api/ai/videos/video-task-1/content", nil)
	contentReq.AddCookie(memberCookie)
	content := httptest.NewRecorder()
	router.ServeHTTP(content, contentReq)
	if content.Code != http.StatusOK || content.Body.String() != "video-bytes" {
		t.Fatalf("video content = %d %q", content.Code, content.Body.String())
	}
	if gotContentAuth != "Bearer sk-video" {
		t.Fatalf("content auth = %q", gotContentAuth)
	}
}

func TestSeedanceProxyUsesVideoEndpointOverrides(t *testing.T) {
	var createPath string
	var getPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.Method + " " + r.URL.Path {
		case http.MethodPost + " /api/v3/contents/generations/tasks":
			createPath = r.URL.Path
			_, _ = w.Write([]byte(`{"id":"task-1","status":"queued"}`))
		case http.MethodGet + " /api/v3/contents/generations/tasks/task-1":
			getPath = r.URL.Path
			_, _ = w.Write([]byte(`{"id":"task-1","status":"completed"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	router, providerRepo := newProviderTestRouter(t, "secret")
	if _, err := providerRepo.UpsertDefaultModelProvider(model.ModelProviderConfig{
		ID:                 model.ModelProviderIDDefault,
		Mode:               model.ModelProviderModeOpenAICompatible,
		BaseURL:            server.URL,
		AuthType:           model.ModelProviderAuthTypeNone,
		VideoModel:         "doubao-seedance-test",
		Capabilities:       mustProviderJSONB([]string{model.ModelCapabilityVideo}),
		ModelsByCapability: mustProviderJSONB(map[string][]string{model.ModelCapabilityVideo: []string{"doubao-seedance-test"}}),
		DefaultFor:         mustProviderJSONB([]string{model.ModelCapabilityVideo}),
		EndpointOverrides: mustProviderJSONB(map[string]string{
			"video_create": "/api/v3/contents/generations/tasks",
			"video_get":    "/api/v3/contents/generations/tasks/{id}",
		}),
		TimeoutMS: model.ModelProviderDefaultTimeoutMilli,
		Enabled:   true,
	}); err != nil {
		t.Fatal(err)
	}

	memberCookie := loginCookie(t, router, "member", "secret")
	create := performJSON(router, http.MethodPost, "/api/ai/contents/generations/tasks", `{"model":"doubao-seedance-test","prompt":"move"}`, memberCookie)
	if create.Code != http.StatusOK || !strings.Contains(create.Body.String(), `"task-1"`) {
		t.Fatalf("seedance create = %d %s", create.Code, create.Body.String())
	}
	if createPath != "/api/v3/contents/generations/tasks" {
		t.Fatalf("create path = %q", createPath)
	}

	get := performJSON(router, http.MethodGet, "/api/ai/contents/generations/tasks/task-1", "", memberCookie)
	if get.Code != http.StatusOK || !strings.Contains(get.Body.String(), `"completed"`) {
		t.Fatalf("seedance get = %d %s", get.Code, get.Body.String())
	}
	if getPath != "/api/v3/contents/generations/tasks/task-1" {
		t.Fatalf("get path = %q", getPath)
	}
}

func TestSeedanceTaskContentDownloadsReturnedVideoURL(t *testing.T) {
	var getPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method + " " + r.URL.Path {
		case http.MethodGet + " /api/v3/contents/generations/tasks/task-1":
			getPath = r.URL.Path
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"task-1","status":"succeeded","content":{"video_url":"http://` + r.Host + `/files/video.mp4"}}`))
		case http.MethodGet + " /files/video.mp4":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("seedance-video-bytes"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	router, providerRepo := newProviderTestRouter(t, "secret")
	if _, err := providerRepo.UpsertDefaultModelProvider(model.ModelProviderConfig{
		ID:                 model.ModelProviderIDDefault,
		Mode:               model.ModelProviderModeOpenAICompatible,
		BaseURL:            server.URL,
		AuthType:           model.ModelProviderAuthTypeNone,
		VideoModel:         "doubao-seedance-test",
		Capabilities:       mustProviderJSONB([]string{model.ModelCapabilityVideo}),
		ModelsByCapability: mustProviderJSONB(map[string][]string{model.ModelCapabilityVideo: []string{"doubao-seedance-test"}}),
		DefaultFor:         mustProviderJSONB([]string{model.ModelCapabilityVideo}),
		EndpointOverrides: mustProviderJSONB(map[string]string{
			"video_get": "/api/v3/contents/generations/tasks/{id}",
		}),
		TimeoutMS: model.ModelProviderDefaultTimeoutMilli,
		Enabled:   true,
	}); err != nil {
		t.Fatal(err)
	}

	memberCookie := loginCookie(t, router, "member", "secret")
	content := performJSON(router, http.MethodGet, "/api/ai/contents/generations/tasks/task-1/content?model=doubao-seedance-test", "", memberCookie)
	if content.Code != http.StatusOK || content.Body.String() != "seedance-video-bytes" {
		t.Fatalf("seedance content = %d %q", content.Code, content.Body.String())
	}
	if content.Header().Get("Content-Type") != "video/mp4" {
		t.Fatalf("content type = %q", content.Header().Get("Content-Type"))
	}
	if getPath != "/api/v3/contents/generations/tasks/task-1" {
		t.Fatalf("get path = %q", getPath)
	}
}

func TestAIAudioSpeechProxyReturnsBlob(t *testing.T) {
	var gotAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/custom/speech" {
			http.NotFound(w, r)
			return
		}
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write([]byte("audio-bytes"))
	}))
	defer server.Close()

	router, providerRepo := newProviderTestRouter(t, "secret")
	secretBox := provider.NewSecretBox("secret")
	encrypted, err := secretBox.Encrypt("sk-audio")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := providerRepo.UpsertDefaultModelProvider(model.ModelProviderConfig{
		ID:              model.ModelProviderIDDefault,
		Mode:            model.ModelProviderModeOpenAICompatible,
		BaseURL:         server.URL + "/v1",
		AuthType:        model.ModelProviderAuthTypeBearer,
		APIKeyEncrypted: encrypted,
		AudioModel:      "tts-1",
		Capabilities:    mustProviderJSONB([]string{model.ModelCapabilityAudio}),
		ModelsByCapability: mustProviderJSONB(map[string][]string{
			model.ModelCapabilityAudio: {"tts-1"},
		}),
		DefaultFor: mustProviderJSONB([]string{model.ModelCapabilityAudio}),
		EndpointOverrides: mustProviderJSONB(map[string]string{
			provider.EndpointOverrideAudioSpeechKey: "/custom/speech",
		}),
		TimeoutMS: model.ModelProviderDefaultTimeoutMilli,
		Enabled:   true,
	}); err != nil {
		t.Fatal(err)
	}

	memberCookie := loginCookie(t, router, "member", "secret")
	req := httptest.NewRequest(http.MethodPost, "/api/ai/audio/speech", strings.NewReader(`{"model":"tts","input":"hello","voice":"alloy"}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(memberCookie)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusOK || recorder.Body.String() != "audio-bytes" {
		t.Fatalf("audio response = %d %q", recorder.Code, recorder.Body.String())
	}
	if gotAuth != "Bearer sk-audio" {
		t.Fatalf("audio auth = %q", gotAuth)
	}
}

func assertAITextSendsAuthHeader(t *testing.T, authType string, wantHeader string, wantValue string) {
	t.Helper()
	var gotHeader string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotHeader = r.Header.Get(wantHeader)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"model":"gpt-test","output_text":"ok"}`))
	}))
	defer server.Close()

	router, providerRepo := newProviderTestRouter(t, "secret")
	secretBox := provider.NewSecretBox("secret")
	encrypted, err := secretBox.Encrypt("sk-test")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := providerRepo.UpsertDefaultModelProvider(model.ModelProviderConfig{
		ID:              model.ModelProviderIDDefault,
		Mode:            model.ModelProviderModeOpenAICompatible,
		BaseURL:         server.URL,
		AuthType:        authType,
		APIKeyEncrypted: encrypted,
		TextModel:       "gpt-test",
		TimeoutMS:       model.ModelProviderDefaultTimeoutMilli,
		Enabled:         true,
	}); err != nil {
		t.Fatal(err)
	}

	memberCookie := loginCookie(t, router, "member", "secret")
	text := performJSON(router, http.MethodPost, "/api/ai/text", `{"prompt":"ping"}`, memberCookie)
	if text.Code != http.StatusOK {
		t.Fatalf("text status = %d, body = %s", text.Code, text.Body.String())
	}
	if gotHeader != wantValue {
		t.Fatalf("%s = %q, want %q", wantHeader, gotHeader, wantValue)
	}
}

func newProviderTestRouter(t *testing.T, appSecret string) (*gin.Engine, repository.ModelProviderRepository) {
	return newProviderTestRouterWithJobDependencies(t, appSecret, &queue.MemoryProducer{}, t.TempDir())
}

type producerFunc func(context.Context, queue.TaskMessage) error

func (f producerFunc) Publish(ctx context.Context, message queue.TaskMessage) error {
	return f(ctx, message)
}

func newProviderTestRouterWithJobDependencies(t *testing.T, appSecret string, producer queue.Producer, jobInputRoot string) (*gin.Engine, repository.ModelProviderRepository) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	userRepo := repository.NewMemoryUserRepository()
	providerRepo := repository.NewMemoryModelProviderRepository()
	authService := auth.NewService(userRepo, config.Config{AppSecret: appSecret})
	if err := authService.SeedSuperAdmin(config.Config{AdminUsername: "admin", AdminPassword: "secret"}); err != nil {
		t.Fatal(err)
	}
	hash, err := auth.HashPassword("secret")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := userRepo.CreateUser(model.User{
		ID:           "user_member",
		Username:     "member",
		PasswordHash: hash,
		DisplayName:  "Member",
		Role:         model.UserRoleMember,
		Status:       model.UserStatusActive,
	}); err != nil {
		t.Fatal(err)
	}

	authHandler := NewAuthHandler(authService, userRepo, config.Config{})
	providerHandler := NewModelProviderHandler(providerRepo, provider.NewSecretBox(appSecret))
	jobService := service.NewJobService(repository.NewMemoryJobRepository(), producer, "celery", 3)
	aiHandler := NewAIHandler(providerHandler, jobService)
	jobInputService := service.NewJobInputService(storage.NewLocalFSStorage(jobInputRoot), 128<<20)
	jobService.SetJobInputService(jobInputService)
	aiHandler.SetJobInputService(jobInputService)
	jobHandler := NewJobHandler(jobService)

	router := gin.New()
	router.Use(middleware.RequestID())
	api := router.Group("/api")
	api.POST("/auth/login", authHandler.Login)
	admin := api.Group("/admin", middleware.RequireSuperAdmin(authService))
	admin.GET("/model-provider", providerHandler.Get)
	admin.PUT("/model-provider", providerHandler.Put)
	admin.POST("/model-provider/test", providerHandler.Test)
	admin.POST("/model-provider/models", providerHandler.Models)
	admin.GET("/model-provider-presets", providerHandler.Presets)
	admin.GET("/model-providers", providerHandler.List)
	admin.POST("/model-providers", providerHandler.Create)
	admin.GET("/model-providers/:id", providerHandler.GetByID)
	admin.PUT("/model-providers/:id", providerHandler.PutByID)
	admin.DELETE("/model-providers/:id", providerHandler.Delete)
	admin.POST("/model-providers/:id/test", providerHandler.TestByID)
	admin.POST("/model-providers/:id/models", providerHandler.ModelsByID)
	ai := api.Group("/ai", middleware.RequireAuth(authService))
	ai.GET("/models", providerHandler.AggregatedModels)
	ai.POST("/text", aiHandler.Text)
	ai.POST("/images/generations", aiHandler.ImageGenerations)
	ai.POST("/image/generations", aiHandler.ImageGenerations)
	ai.POST("/images/edits", aiHandler.ImageEdits)
	ai.POST("/image/edits", aiHandler.ImageEdits)
	ai.POST("/videos", aiHandler.VideoTaskCreate)
	ai.GET("/videos/:id", aiHandler.VideoTaskGet)
	ai.GET("/videos/:id/content", aiHandler.VideoTaskContent)
	ai.POST("/contents/generations/tasks", aiHandler.SeedanceTaskCreate)
	ai.GET("/contents/generations/tasks/:id", aiHandler.SeedanceTaskGet)
	ai.GET("/contents/generations/tasks/:id/content", aiHandler.SeedanceTaskContent)
	ai.POST("/audio/speech", aiHandler.AudioSpeech)
	jobs := api.Group("/jobs", middleware.RequireAuth(authService))
	jobs.GET("/:id", jobHandler.Get)

	return router, providerRepo
}

func regularFilesUnder(t *testing.T, root string) []string {
	t.Helper()
	files := make([]string, 0)
	if err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.Mode().IsRegular() {
			files = append(files, path)
		}
		return nil
	}); err != nil {
		t.Fatalf("walk staged input root: %v", err)
	}
	return files
}

func assertAcceptedJobResponse(t *testing.T, recorder *httptest.ResponseRecorder) string {
	t.Helper()
	if recorder.Code != http.StatusAccepted {
		t.Fatalf("job create status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var body struct {
		Success bool `json:"success"`
		Data    struct {
			JobID  string `json:"job_id"`
			Status string `json:"status"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("job response json.Unmarshal() error = %v; body = %s", err, recorder.Body.String())
	}
	if !body.Success || body.Data.JobID == "" || body.Data.Status != model.JobStatusQueued {
		t.Fatalf("job response = %+v; body = %s", body, recorder.Body.String())
	}
	return body.Data.JobID
}

func fetchJobPayload(t *testing.T, router *gin.Engine, jobID string, cookie *http.Cookie) map[string]any {
	t.Helper()
	recorder := performJSON(router, http.MethodGet, "/api/jobs/"+url.PathEscape(jobID), "", cookie)
	if recorder.Code != http.StatusOK {
		t.Fatalf("job get status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var body struct {
		Data struct {
			Payload map[string]any `json:"payload"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("job get json.Unmarshal() error = %v; body = %s", err, recorder.Body.String())
	}
	return body.Data.Payload
}

func configureOpenAICompatibleProvider(t *testing.T, providerRepo repository.ModelProviderRepository, baseURL string, apiKey string, imageModel string) {
	t.Helper()
	secretBox := provider.NewSecretBox("secret")
	encrypted, err := secretBox.Encrypt(apiKey)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := providerRepo.UpsertDefaultModelProvider(model.ModelProviderConfig{
		ID:              model.ModelProviderIDDefault,
		Mode:            model.ModelProviderModeOpenAICompatible,
		BaseURL:         baseURL,
		AuthType:        model.ModelProviderAuthTypeBearer,
		APIKeyEncrypted: encrypted,
		TextModel:       "gpt-5.4-mini",
		ImageModel:      imageModel,
		TimeoutMS:       model.ModelProviderDefaultTimeoutMilli,
		Enabled:         true,
	}); err != nil {
		t.Fatal(err)
	}
}

func configureOpenAICompatibleVideoProvider(t *testing.T, providerRepo repository.ModelProviderRepository, baseURL string, apiKey string, videoModel string) {
	t.Helper()
	secretBox := provider.NewSecretBox("secret")
	encrypted, err := secretBox.Encrypt(apiKey)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := providerRepo.UpsertDefaultModelProvider(model.ModelProviderConfig{
		ID:              model.ModelProviderIDDefault,
		Mode:            model.ModelProviderModeOpenAICompatible,
		BaseURL:         baseURL,
		AuthType:        model.ModelProviderAuthTypeBearer,
		APIKeyEncrypted: encrypted,
		VideoModel:      videoModel,
		Capabilities:    mustProviderJSONB([]string{model.ModelCapabilityVideo}),
		ModelsByCapability: mustProviderJSONB(map[string][]string{
			model.ModelCapabilityVideo: {videoModel},
		}),
		DefaultFor: mustProviderJSONB([]string{model.ModelCapabilityVideo}),
		TimeoutMS:  model.ModelProviderDefaultTimeoutMilli,
		Enabled:    true,
	}); err != nil {
		t.Fatal(err)
	}
}

func writeMultipartFilePart(t *testing.T, writer *multipart.Writer, fieldName string, fileName string, contentType string, body []byte) {
	t.Helper()
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", `form-data; name="`+fieldName+`"; filename="`+fileName+`"`)
	header.Set("Content-Type", contentType)
	part, err := writer.CreatePart(header)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(body); err != nil {
		t.Fatal(err)
	}
}

func TestModelProviderSavesNormalizedModelProtocols(t *testing.T) {
	router, _ := newProviderTestRouter(t, "secret")
	adminCookie := loginCookie(t, router, "admin", "secret")
	put := performJSON(router, http.MethodPut, "/api/admin/model-provider", `{"mode":"local_openai","base_url":"http://example.test/v1","auth_type":"none","image_model":"gemini-image","capabilities":["image"],"models_by_capability":{"image":["gemini-image"]},"model_protocols":{" gemini-image ":" OPENAI_CHAT_COMPLETIONS ","auto-model":"auto"},"timeout_ms":30000,"enabled":true}`, adminCookie)
	if put.Code != http.StatusOK {
		t.Fatalf("put status = %d, body = %s", put.Code, put.Body.String())
	}
	get := performJSON(router, http.MethodGet, "/api/admin/model-provider", "", adminCookie)
	var envelope struct {
		Data struct {
			ModelProtocols map[string]string `json:"model_protocols"`
		} `json:"data"`
	}
	if err := json.Unmarshal(get.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode provider response: %v", err)
	}
	want := map[string]string{"gemini-image": model.ImageProtocolOpenAIChatCompletions}
	if !reflect.DeepEqual(envelope.Data.ModelProtocols, want) {
		t.Fatalf("model protocols = %#v, want %#v", envelope.Data.ModelProtocols, want)
	}
}

func TestResolveImageProtocolUsesExplicitMappingAndSafeInference(t *testing.T) {
	config := model.ModelProviderConfig{
		ProviderType: model.ModelProviderTypeOpenAICompatible,
		BaseURL:      "https://relay.example/v1",
		ModelProtocols: mustProviderJSONB(map[string]string{
			"custom-image": model.ImageProtocolDashScopeMultimodal,
		}),
	}
	cases := map[string]string{
		"custom-image":           model.ImageProtocolDashScopeMultimodal,
		"gemini-2.5-flash-image": model.ImageProtocolOpenAIChatCompletions,
		"nano-banana-pro":        model.ImageProtocolOpenAIChatCompletions,
		"gpt-5.5":                model.ImageProtocolOpenAIResponses,
		"gpt-image-2":            model.ImageProtocolOpenAIImages,
		"flux-1.1-pro":           model.ImageProtocolOpenAIImages,
	}
	for modelID, expected := range cases {
		if actual := resolveImageProtocol(config, modelID); actual != expected {
			t.Fatalf("resolveImageProtocol(%q) = %q, want %q", modelID, actual, expected)
		}
	}
}

func TestImageProviderJobKwargsCarriesResolvedProtocol(t *testing.T) {
	config := model.ModelProviderConfig{
		ID:           "relay",
		ProviderType: model.ModelProviderTypeOpenAICompatible,
		BaseURL:      "https://relay.example/v1",
	}
	kwargs := imageProviderJobKwargs(config, "secret", "gemini-2.5-flash-image", "edit", "gate-secret")
	providerConfig, ok := kwargs["provider"].(map[string]any)
	if !ok {
		t.Fatalf("provider kwargs = %#v", kwargs)
	}
	if providerConfig["protocol"] != model.ImageProtocolOpenAIChatCompletions || providerConfig["endpoint"] != "chat/completions" {
		t.Fatalf("provider config = %#v", providerConfig)
	}
}
