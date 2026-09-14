package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/queue"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/service"
	"github.com/ai-manju/api/internal/storage"
	"github.com/gin-gonic/gin"
)

func TestNativeVideoContentUsesSavedAssetAndEnforcesOwnership(t *testing.T) {
	assets := service.NewAssetService(repository.NewMemoryAssetRepository(), storage.NewLocalFSStorage(t.TempDir()))
	asset, err := assets.Upload(context.Background(), service.AssetUploadInput{ID: "asset_native", UserID: "owner", Scope: "personal", Type: "video", Name: "result", Extension: ".mp4", ContentType: "video/mp4", Reader: bytes.NewBufferString("video-content")})
	if err != nil {
		t.Fatal(err)
	}
	jobs := repository.NewMemoryJobRepository()
	_, err = jobs.Create(model.Job{ID: "job_native", UserID: "owner", WorkspaceID: service.WorkspaceIDForScope("personal", "owner"), Type: model.JobTypeVideoGenerate, Status: model.JobStatusSucceeded, Result: mustProviderJSONB(map[string]any{"outputs": []any{map[string]any{"asset_id": asset.ID}}})})
	if err != nil {
		t.Fatal(err)
	}
	h := NewAIHandler(nil, service.NewJobService(jobs, &queue.MemoryProducer{}, "celery", 3))
	h.SetGenerationAssetService(assets)
	for _, user := range []string{"owner", "someone-else"} {
		rec := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(rec)
		c.Request = httptest.NewRequest(http.MethodGet, "/content", nil)
		c.Params = gin.Params{{Key: "id", Value: "job_native"}}
		c.Set(auth.ContextUserKey, model.User{ID: user})
		if !h.serveGenerationVideoJob(c, true) {
			t.Fatal("job was routed to a supplier")
		}
		if user == "owner" && (rec.Code != http.StatusOK || rec.Body.String() != "video-content") {
			t.Fatalf("content unavailable: %d %s", rec.Code, rec.Body.String())
		}
		if user != "owner" && rec.Code != http.StatusNotFound {
			t.Fatal("another user read the content")
		}
	}
}

func TestAudioUsesRequestedModelAndRetriesAllSameModelSuppliers(t *testing.T) {
	for _, succeed := range []bool{true, false} {
		t.Run(map[bool]string{true: "success", false: "exhaustion"}[succeed], func(t *testing.T) {
			var calls []string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				id := r.Header.Get("X-Supplier")
				calls = append(calls, id)
				var body map[string]any
				_ = json.NewDecoder(r.Body).Decode(&body)
				if body["model"] != "shared-voice" || body["voice"] != "alloy" {
					t.Error("audio selection changed")
				}
				if succeed && id == "b" {
					w.Header().Set("Content-Type", "audio/mpeg")
					_, _ = w.Write([]byte("audio"))
					return
				}
				http.Error(w, "private supplier detail", http.StatusServiceUnavailable)
			}))
			defer server.Close()
			router, repo := newProviderTestRouter(t, "secret")
			for _, id := range []string{"a", "b", "different"} {
				config := generationTestConfig(id, "")
				config.AudioModel = "shared-voice"
				config.BaseURL = server.URL + "/v1"
				config.ExtraHeaders = mustProviderJSONB(map[string]string{"X-Supplier": id})
				if id == "different" {
					config.AudioModel = "other-voice"
				}
				_, _ = repo.UpsertModelProvider(config)
			}
			cookie := loginCookie(t, router, "member", "secret")
			rec := performJSON(router, http.MethodPost, "/api/ai/audio/speech", `{"model":"a::shared-voice","input":"test","voice":"alloy"}`, cookie)
			want := []string{"a", "a", "a", "b"}
			if !succeed {
				want = append(want, "b", "b")
			}
			if !reflect.DeepEqual(calls, want) {
				t.Fatalf("calls=%v", calls)
			}
			if succeed && (rec.Code != http.StatusOK || rec.Body.String() != "audio") {
				t.Fatal("audio result lost")
			}
			if !succeed && (rec.Code != http.StatusBadGateway || strings.Contains(rec.Body.String(), "private supplier")) {
				t.Fatal("final failure leaked provider details")
			}
		})
	}
}

func TestComicGenerationSharesCandidatesAndImageProtocols(t *testing.T) {
	calls := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Supplier")
		calls = append(calls, id)
		if id == "a" {
			http.Error(w, "private", http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"output_text":"comic text"}`))
	}))
	defer server.Close()
	repo := repository.NewMemoryModelProviderRepository()
	h := NewModelProviderHandler(repo, provider.NewSecretBox("secret"))
	for _, id := range []string{"a", "b"} {
		config := generationTestConfig(id, "gpt-image-2")
		config.TextModel = "shared-text"
		config.BaseURL = server.URL + "/v1"
		config.ExtraHeaders = mustProviderJSONB(map[string]string{"X-Supplier": id})
		if id == "b" {
			config.ModelProtocols = mustProviderJSONB(map[string]string{"gpt-image-2": model.ImageProtocolOpenAIResponses})
		}
		_, _ = repo.UpsertModelProvider(config)
	}
	result, err := h.GenerateBackgroundText(context.Background(), "a::shared-text", provider.TextGenerationRequest{Prompt: "comic"})
	if err != nil || result.Text != "comic text" || !reflect.DeepEqual(calls, []string{"a", "a", "a", "b"}) {
		t.Fatalf("comic failover: %v %v", calls, err)
	}
	image, err := h.ResolveBackgroundImageJob("removed::gpt-image-2", model.JobTypeImageEdit)
	if err != nil {
		t.Fatal(err)
	}
	candidates := image.TaskKwargs["provider_candidates"].([]map[string]any)
	if len(candidates) != 2 || candidates[1]["protocol"] != model.ImageProtocolOpenAIResponses || candidates[1]["endpoint"] != "responses" {
		t.Fatal("comic image protocol/failover missing")
	}
	if image.TaskKwargs["generation_soft_timeout_seconds"].(int) < 1200 {
		t.Fatal("comic budget too short")
	}
}

func TestNativeVideoQueuesPrivateCandidatesAndPollsStableJob(t *testing.T) {
	producer := &queue.MemoryProducer{}
	router, repo := newProviderTestRouterWithJobDependencies(t, "secret", producer, t.TempDir())
	for _, id := range []string{"a", "b"} {
		config := generationTestConfig(id, "")
		config.VideoModel = "wan3.0-video"
		if id == "b" {
			config.ProviderType = model.ModelProviderTypeAliyunYike
			config.EndpointOverrides = mustProviderJSONB(map[string]string{"video_create": "/api/v1/video-synthesis", "video_get": "/api/v1/tasks/{id}"})
		}
		_, _ = repo.UpsertModelProvider(config)
	}
	cookie := loginCookie(t, router, "member", "secret")
	rec := performJSON(router, http.MethodPost, "/api/ai/contents/generations/tasks", `{"model":"a::wan3.0-video","content":[{"type":"text","text":"test"}],"duration":5,"provider":{"api_key":"injected"}}`, cookie)
	var envelope struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &envelope)
	if rec.Code != http.StatusOK || !strings.HasPrefix(envelope.Data.ID, "job_") || len(producer.Messages) != 1 {
		t.Fatalf("not queued: %s", rec.Body.String())
	}
	candidates := producer.Messages[0].Kwargs["provider_candidates"].([]map[string]any)
	if len(candidates) != 2 || candidates[0]["video_protocol"] != "seedance" || candidates[1]["video_request_body"].(map[string]any)["model"] != "wan3.0-video" {
		t.Fatal("native adapters missing")
	}
	if strings.Contains(string(producer.Messages[0].Payload), "injected") {
		t.Fatal("client config was retained")
	}
	// Polling no longer re-resolves the originally selected supplier.
	polled := performJSON(router, http.MethodGet, "/api/ai/contents/generations/tasks/"+envelope.Data.ID+"?model=deleted::other", "", cookie)
	if polled.Code != http.StatusOK || !strings.Contains(polled.Body.String(), envelope.Data.ID) || strings.Contains(polled.Body.String(), "supplier.test") {
		t.Fatal("poll routing/privacy failed")
	}
	denied := performJSON(router, http.MethodGet, "/api/ai/contents/generations/tasks/"+envelope.Data.ID, "", nil)
	if denied.Code != http.StatusUnauthorized {
		t.Fatal("native jobs must remain authenticated")
	}
}
