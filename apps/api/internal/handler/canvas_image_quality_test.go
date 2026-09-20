package handler

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCanvasImagePixelsAndDetailSurviveQueueing(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("image generation must be queued, not called synchronously")
	}))
	defer server.Close()
	router, providerRepo := newProviderTestRouter(t, "secret")
	configureOpenAICompatibleProvider(t, providerRepo, server.URL+"/v1", "sk-test", "gpt-image-2.5-flare")
	cookie := loginCookie(t, router, "member", "secret")
	for _, size := range []string{"1360x768", "2720x1536", "3840x2160", "2880x2880", "3840x1280", "2160x3840"} {
		for _, quality := range []string{"low", "medium", "high"} {
			t.Run(size+"/"+quality, func(t *testing.T) {
				body := fmt.Sprintf(`{"model":"gpt-image-2.5-flare","prompt":"character","size":%q,"quality":%q,"output_format":"png","n":1,"asset_context":{"source_type":"canvas"}}`, size, quality)
				recorder := performJSON(router, http.MethodPost, "/api/ai/images/generations", body, cookie)
				payload := fetchJobPayload(t, router, assertAcceptedJobResponse(t, recorder), cookie)
				if payload["size"] != size || payload["quality"] != quality || payload["output_format"] != "png" {
					t.Fatalf("queued size=%v quality=%v format=%v", payload["size"], payload["quality"], payload["output_format"])
				}
			})
		}
	}
}
