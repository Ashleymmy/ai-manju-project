package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"testing"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/queue"
)

func TestVideoModelCatalogUsesProviderProtocolForOpaqueEndpoint(t *testing.T) {
	router, repo := newProviderTestRouter(t, "secret")
	for _, item := range []struct{ id, providerType string }{
		{"official", model.ModelProviderTypeVolcengineArk},
		{"other", model.ModelProviderTypeOpenAICompatible},
	} {
		_, err := repo.UpsertModelProvider(model.ModelProviderConfig{
			ID: item.id, Name: item.id, ProviderType: item.providerType,
			Mode: model.ModelProviderModeOpenAICompatible, BaseURL: "https://example.invalid",
			AuthType: model.ModelProviderAuthTypeNone, Enabled: true,
			Capabilities:       mustProviderJSONB([]string{model.ModelCapabilityVideo}),
			ModelsByCapability: mustProviderJSONB(map[string][]string{"video": {"ep-test"}}),
			ModelAliases:       mustProviderJSONB(map[string]string{"ep-test": "Seedance 2.5"}),
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	out := performJSON(router, http.MethodGet, "/api/ai/models", "", loginCookie(t, router, "member", "secret"))
	if out.Code != http.StatusOK {
		t.Fatalf("catalog status=%d", out.Code)
	}
	var result struct {
		Data struct {
			Protocols map[string]string    `json:"video_model_protocols"`
			Labels    map[string]string    `json:"model_labels"`
			Durations map[string][]float64 `json:"video_model_durations"`
		} `json:"data"`
	}
	if err := json.Unmarshal(out.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Data.Protocols["official::ep-test"] != videoCatalogProtocolSeedance || result.Data.Protocols["other::ep-test"] != videoCatalogProtocolOpenAI {
		t.Fatalf("protocols=%v", result.Data.Protocols)
	}
	if result.Data.Labels["official::ep-test"] != "Seedance 2.5" {
		t.Fatalf("labels=%v", result.Data.Labels)
	}
	if len(result.Data.Durations) != 0 {
		t.Fatalf("opaque endpoints inherited durations from editable labels: %v", result.Data.Durations)
	}
}

func TestVideoDurationCatalogMatchesDocumentedModelLimits(t *testing.T) {
	for _, tc := range []struct {
		model     string
		min, max  float64
		automatic bool
	}{
		{"doubao-seedance-2-5-260628", 4, 30, true},
		{"seedance-2.0-fast", 4, 15, true},
		{"doubao-seedance-2-0-mini-260615", 4, 15, true},
		{"doubao-seedance-1-5-pro-251215", 4, 12, true},
		{"doubao-seedance-1-0-pro-fast-251015", 2, 12, false},
	} {
		t.Run(tc.model, func(t *testing.T) {
			catalog := aggregateModelProviders([]model.ModelProviderConfig{{
				ID: "provider", Name: "Provider", Enabled: true,
				Capabilities:       mustProviderJSONB([]string{model.ModelCapabilityVideo}),
				ModelsByCapability: mustProviderJSONB(map[string][]string{"video": {tc.model}}),
			}})
			durations := catalog["video_model_durations"].(map[string][]float64)["provider::"+tc.model]
			first := 0
			if tc.automatic {
				first = 1
			}
			if len(durations) < 2 || durations[first] != tc.min || durations[len(durations)-1] != tc.max || (durations[0] == -1) != tc.automatic {
				t.Fatalf("durations=%v", durations)
			}
			for _, value := range []any{tc.min, tc.max, fmt.Sprint(tc.max)} {
				if err := validateCatalogVideoDuration(tc.model, value); err != nil {
					t.Fatal(err)
				}
			}
			for _, value := range []any{tc.max + 1, 7.5, "NaN", "0"} {
				if err := validateCatalogVideoDuration(tc.model, value); err == nil {
					t.Fatalf("accepted unsupported duration %v", value)
				}
			}
			if (validateCatalogVideoDuration(tc.model, -1) == nil) != tc.automatic {
				t.Fatal("incorrect automatic duration support")
			}
		})
	}
	if catalogVideoDurations("ep-unknown") != nil || catalogVideoDurations("seedance-20-custom") != nil {
		t.Fatal("guessed capabilities")
	}
}

func TestRemoteVideoDurationsRetainDiscreteChoices(t *testing.T) {
	if got := remoteVideoDurations(json.RawMessage(`[25,5,10,5,0,-2]`)); !reflect.DeepEqual(got, []float64{5, 10, 25}) {
		t.Fatalf("choices=%v", got)
	}
	if got := remoteVideoDurations(json.RawMessage(`"4-30"`)); got != nil {
		t.Fatalf("malformed=%v", got)
	}
}

func TestVideoDurationRejectedBeforeEnqueue(t *testing.T) {
	producer := &queue.MemoryProducer{}
	router, repo := newProviderTestRouterWithJobDependencies(t, "secret", producer, t.TempDir())
	config := generationTestConfig("duration-provider", "")
	config.VideoModel = "doubao-seedance-2-0-260128"
	if _, err := repo.UpsertModelProvider(config); err != nil {
		t.Fatal(err)
	}
	cookie := loginCookie(t, router, "member", "secret")
	for _, path := range []string{"/api/ai/contents/generations/tasks", "/api/ai/videos"} {
		for _, seconds := range []string{"30", "7.5", "0"} {
			body := fmt.Sprintf(`{"model":"duration-provider::doubao-seedance-2-0-260128","prompt":"test","content":[{"type":"text","text":"test"}],"duration":%s,"seconds":"%s"}`, seconds, seconds)
			out := performJSON(router, http.MethodPost, path, body, cookie)
			if out.Code != http.StatusBadRequest || len(producer.Messages) != 0 {
				t.Fatalf("invalid duration queued: %s %s", path, out.Body.String())
			}
		}
	}
	body := `{"model":"duration-provider::doubao-seedance-2-0-260128","content":[{"type":"text","text":"test"}],"duration":15}`
	out := performJSON(router, http.MethodPost, "/api/ai/contents/generations/tasks", body, cookie)
	if out.Code != http.StatusOK || len(producer.Messages) != 1 {
		t.Fatalf("supported duration rejected: %s", out.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(producer.Messages[0].Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["duration"] != float64(15) {
		t.Fatalf("duration changed: %v", payload)
	}
}
