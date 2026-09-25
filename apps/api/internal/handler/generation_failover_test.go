package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/queue"
)

func generationTestConfig(id, modelID string) model.ModelProviderConfig {
	return model.ModelProviderConfig{ID: id, Name: "Private supplier " + id,
		Mode: model.ModelProviderModeOpenAICompatible, BaseURL: "http://supplier.test/v1",
		AuthType: model.ModelProviderAuthTypeNone, ImageModel: modelID,
		TimeoutMS: 30000, Enabled: true}
}

func TestImageGenerationQueuesSameModelCandidatesPrivately(t *testing.T) {
	producer := &queue.MemoryProducer{}
	router, repo := newProviderTestRouterWithJobDependencies(t, "secret", producer, t.TempDir())
	for _, id := range []string{"a", "b", "disabled", "different", "text-only"} {
		config := generationTestConfig(id, "gpt-image-2")
		config.APIKeyEncrypted, _ = provider.NewSecretBox("secret").Encrypt("private-key-" + id)
		if id == "disabled" {
			config.Enabled = false
		}
		if id == "different" {
			config.ImageModel = "gpt-image-1"
		}
		if id == "text-only" {
			config.ImageModel = ""
			config.TextModel = "gpt-image-2"
		}
		if _, err := repo.UpsertModelProvider(config); err != nil {
			t.Fatal(err)
		}
	}
	cookie := loginCookie(t, router, "member", "secret")
	rec := performJSON(router, http.MethodPost, "/api/ai/image/generations", `{"prompt":"test","model":"a::gpt-image-2","provider":{"api_key":"injected"},"provider_candidates":[{"api_key":"injected"}]}`, cookie)
	jobID := assertAcceptedJobResponse(t, rec)
	if len(producer.Messages) != 1 {
		t.Fatalf("messages=%d", len(producer.Messages))
	}
	message := producer.Messages[0]
	candidates := message.Kwargs["provider_candidates"].([]map[string]any)
	if len(candidates) != 2 || candidates[0]["id"] != "a" || candidates[1]["id"] != "b" {
		t.Fatalf("unexpected candidate selection")
	}
	for _, candidate := range candidates {
		if candidate["model"] != "gpt-image-2" || candidate["timeout_ms"].(int64) < int64((15*time.Minute).Milliseconds()) {
			t.Fatal("model/timeout contract not preserved")
		}
	}
	if message.Kwargs["generation_soft_timeout_seconds"].(int) <= 900 {
		t.Fatal("delivery ends before the request budget")
	}
	job := performJSON(router, http.MethodGet, "/api/jobs/"+jobID, "", cookie)
	for _, private := range []string{"private-key", "supplier.test", "provider_candidates", "injected"} {
		if strings.Contains(job.Body.String(), private) || strings.Contains(string(message.Payload), private) {
			t.Fatalf("public job leaked %s", private)
		}
	}
	if !strings.Contains(job.Body.String(), `"max_attempts":6`) {
		t.Fatal("job must allow three attempts per supplier")
	}
}

func TestImageGenerationRecoversRemovedCanvasSupplier(t *testing.T) {
	producer := &queue.MemoryProducer{}
	router, repo := newProviderTestRouterWithJobDependencies(t, "secret", producer, t.TempDir())
	_, _ = repo.UpsertModelProvider(generationTestConfig("remaining", "gpt-image-2"))
	cookie := loginCookie(t, router, "member", "secret")
	rec := performJSON(router, http.MethodPost, "/api/ai/image/generations", `{"prompt":"test","model":"removed::gpt-image-2"}`, cookie)
	assertAcceptedJobResponse(t, rec)
	if producer.Messages[0].Kwargs["provider"].(map[string]any)["id"] != "remaining" {
		t.Fatal("did not recover the same model")
	}
}

func TestTextGenerationRetriesEachSupplierAndStopsOnSuccess(t *testing.T) {
	for _, succeed := range []bool{true, false} {
		t.Run(map[bool]string{true: "success", false: "exhaustion"}[succeed], func(t *testing.T) {
			var calls []string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				id := r.Header.Get("X-Supplier")
				calls = append(calls, id)
				var body map[string]any
				_ = json.NewDecoder(r.Body).Decode(&body)
				if body["model"] != "shared-model" {
					t.Errorf("wrong model=%v", body["model"])
				}
				w.Header().Set("Content-Type", "application/json")
				if succeed && id == "b" {
					_, _ = w.Write([]byte(`{"output_text":"done","model":"shared-model"}`))
					return
				}
				w.WriteHeader(http.StatusTooManyRequests)
				_, _ = w.Write([]byte(`{"error":"private supplier failure"}`))
			}))
			defer server.Close()
			var candidates []modelSelection
			for _, id := range []string{"a", "b"} {
				config := generationTestConfig(id, "")
				config.BaseURL = server.URL + "/v1"
				config.TextModel = "shared-model"
				config.ExtraHeaders = model.JSONB(`{"X-Supplier":"` + id + `"}`)
				candidates = append(candidates, modelSelection{Config: config, Model: "shared-model"})
			}
			result, _, err := generateTextWithCandidates(context.Background(), candidates, provider.TextGenerationRequest{Prompt: "test"})
			want := []string{"a", "a", "a", "b"}
			if !succeed {
				want = append(want, "b", "b")
			}
			if !reflect.DeepEqual(calls, want) {
				t.Fatalf("calls=%v want=%v", calls, want)
			}
			if succeed && (err != nil || result.Text != "done") {
				t.Fatalf("result=%+v err=%v", result, err)
			}
			if !succeed && !errors.Is(err, errGenerationUnavailable) {
				t.Fatalf("err=%v", err)
			}
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			_, _, err = generateTextWithCandidates(ctx, candidates, provider.TextGenerationRequest{Prompt: "test"})
			if err != context.Canceled || !reflect.DeepEqual(calls, want) {
				t.Fatal("canceled request was retried")
			}
		})
	}
}

func TestPendingJobHidesSupplierRetry(t *testing.T) {
	started := time.Now()
	job := jobResponse(model.Job{Status: model.JobStatusQueued, QueuePhase: "provider_retry_backoff", StartedAt: &started, Error: model.JSONB(`{"message":"private upstream failure"}`)})
	if job["status"] != model.JobStatusRunning || job["queue_phase"] != "" || string(job["error"].(model.JSONB)) != "{}" {
		t.Fatal("retry leaked into public job")
	}
}

func TestAgentTextFailoverPreservesToolsAndSkipsIncompatibleSuppliers(t *testing.T) {
	var calls []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Supplier")
		calls = append(calls, id)
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["model"] != "shared-agent" || len(body["tools"].([]any)) != 1 || body["tool_choice"] != "required" {
			t.Error("supplier switch changed the selected model or tools")
		}
		w.Header().Set("Content-Type", "application/json")
		if id == "a" {
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		_, _ = w.Write([]byte(`{"model":"shared-agent","output":[{"type":"function_call","call_id":"call-1","name":"canvas_get_state","arguments":"{}"}]}`))
	}))
	defer server.Close()
	var candidates []modelSelection
	for _, id := range []string{"a", "incompatible", "b"} {
		config := generationTestConfig(id, "")
		config.BaseURL, config.TextModel = server.URL+"/v1", "shared-agent"
		config.ExtraHeaders = model.JSONB(`{"X-Supplier":"` + id + `"}`)
		if id == "incompatible" {
			config.AuthType = model.ModelProviderAuthTypeXGoogAPIKey
		}
		candidates = append(candidates, modelSelection{Config: config, Model: "shared-agent"})
	}
	result, selected, err := generateTextWithCandidates(context.Background(), candidates, provider.TextGenerationRequest{
		Prompt: "inspect the canvas", ToolChoice: "required",
		Tools: []map[string]any{{"type": "function", "function": map[string]any{"name": "canvas_get_state", "parameters": map[string]any{"type": "object"}}}},
	})
	if err != nil || len(result.ToolCalls) != 1 || result.ToolCalls[0].Function.Name != "canvas_get_state" {
		t.Fatalf("agent did not receive the actual tool call: result=%+v err=%v", result, err)
	}
	if !reflect.DeepEqual(calls, []string{"a", "a", "a", "b"}) {
		t.Fatalf("calls=%v", calls)
	}
	if selected.TimeoutMS < int(model.GenerationTextRequestTimeout.Milliseconds()) {
		t.Fatal("text generation timeout was shortened")
	}
}

func TestAgentTextFallsBackWhenSupplierRejectsRequiredToolChoice(t *testing.T) {
	var choices []any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		choices = append(choices, body["tool_choice"])
		w.Header().Set("Content-Type", "application/json")
		if len(choices) == 1 {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"tool_choice required is unsupported"}`))
			return
		}
		_, _ = w.Write([]byte(`{"model":"shared-agent","output_text":"已完成"}`))
	}))
	defer server.Close()
	config := generationTestConfig("supplier", "")
	config.BaseURL, config.TextModel = server.URL+"/v1", "shared-agent"
	result, _, err := generateTextWithCandidates(context.Background(), []modelSelection{{Config: config, Model: "shared-agent"}}, provider.TextGenerationRequest{
		Prompt: "inspect", ToolChoice: "required",
		Tools: []map[string]any{{"type": "function", "function": map[string]any{"name": "canvas_get_state", "parameters": map[string]any{"type": "object"}}}},
	})
	if err != nil || result.Text != "已完成" {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	if len(choices) != 2 || choices[0] != "required" || choices[1] != "auto" {
		t.Fatalf("tool choices=%v", choices)
	}
}
