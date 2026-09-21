package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ai-manju/api/internal/model"
)

func TestProviderLargeCatalogKeepsMiniMaxVideoModels(t *testing.T) {
	videoIDs := []string{"minimax-h3", "MiniMax-H3-768p", "minimax_h3", "MiniMax-Hailuo-2.3", "MiniMax-Video-01"}
	textIDs := []string{"MiniMax-M1", "MiniMax-M2.5"}
	audioIDs := []string{"speech-02-hd", "minimax-speech-2.8-hd"}
	var upstreamModels []map[string]string
	for i := 0; i < 600; i++ {
		videoIDs = append(videoIDs, fmt.Sprintf("seedance-test-%03d", i))
	}
	for _, ids := range [][]string{videoIDs, textIDs, audioIDs} {
		for _, id := range ids {
			upstreamModels = append(upstreamModels, map[string]string{"id": id})
		}
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/v1/models" {
			http.Error(w, "only model discovery is allowed", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"data": upstreamModels})
	}))
	defer upstream.Close()
	router, _ := newProviderTestRouter(t, "secret")
	cookie := loginCookie(t, router, "admin", "secret")
	payload := map[string]any{
		"name": "Large catalog", "mode": "openai_compatible", "base_url": upstream.URL + "/v1",
		"auth_type": "none", "capabilities": []string{"video"}, "video_model": "minimax-h3", "enabled": true,
	}
	data, _ := json.Marshal(payload)
	response := performJSON(router, http.MethodPost, "/api/admin/model-provider/models", string(data), cookie)
	if response.Code != http.StatusOK {
		t.Fatalf("discovery status=%d: %s", response.Code, response.Body.String())
	}
	var body struct {
		Data struct {
			Models []string `json:"models"`
			Video  []string `json:"video_models"`
			Text   []string `json:"text_models"`
			Audio  []string `json:"audio_models"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Data.Models) != len(upstreamModels) || len(body.Data.Video) != len(videoIDs) {
		t.Fatalf("catalog incomplete: all=%d/%d video=%d/%d", len(body.Data.Models), len(upstreamModels), len(body.Data.Video), len(videoIDs))
	}
	for _, id := range videoIDs {
		if !containsString(body.Data.Video, id) || containsString(body.Data.Text, id) {
			t.Errorf("video model %q missing or classified as text", id)
		}
	}
	for _, id := range textIDs {
		if !containsString(body.Data.Text, id) || containsString(body.Data.Video, id) {
			t.Errorf("text model %q incorrectly classified", id)
		}
	}
	for _, id := range audioIDs {
		if !containsString(body.Data.Audio, id) || containsString(body.Data.Video, id) {
			t.Errorf("audio model %q incorrectly classified", id)
		}
	}

	// Explicit manual classification must survive saving even for unknown IDs.
	videoIDs = append(videoIDs, "custom-manual-model")
	payload["models_by_capability"] = map[string][]string{"video": videoIDs}
	data, _ = json.Marshal(payload)
	response = performJSON(router, http.MethodPost, "/api/admin/model-providers", string(data), cookie)
	if response.Code != http.StatusOK && response.Code != http.StatusCreated {
		t.Fatalf("save status=%d: %s", response.Code, response.Body.String())
	}
	var saved struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &saved); err != nil || saved.Data.ID == "" {
		t.Fatalf("missing saved provider id: %v", err)
	}
	response = performJSON(router, http.MethodGet, "/api/admin/model-providers", "", cookie)
	var listed struct {
		Data struct {
			Items []struct {
				ID     string              `json:"id"`
				Models map[string][]string `json:"models_by_capability"`
			} `json:"providers"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &listed); err != nil {
		t.Fatal(err)
	}
	for _, item := range listed.Data.Items {
		if item.ID == saved.Data.ID {
			ids := item.Models[model.ModelCapabilityVideo]
			if len(ids) != len(videoIDs) || !containsString(ids, "custom-manual-model") {
				t.Fatalf("saved models lost: got %d, want %d", len(ids), len(videoIDs))
			}
			return
		}
	}
	t.Fatal("saved provider not returned")
}
