package provider

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/monitoring"
)

func TestObservedProviderErrorsKeepActualHTTP200Envelope(t *testing.T) {
	for _, tc := range []struct{ name, contentType, body, detail string }{
		{"json", "application/json", `{"error":{"code":"bad_audio","message":"actual vendor rejection"},"prompt":"PRIVATE"}`, "actual vendor rejection"},
		{"sse", "text/event-stream", "event: response.output_text.delta\ndata: {\"delta\":\"PRIVATE\"}\n\nevent: error\ndata: {\"code\":\"bad_audio\",\"message\":\"actual SSE rejection\"}\n\n", "actual SSE rejection"},
		{"sse_type", "text/event-stream", "data: {\"type\":\"error\",\"code\":\"bad_audio\",\"message\":\"actual SSE rejection\"}\n\n", "actual SSE rejection"},
		{"html", "text/html", "upstream gateway unavailable", "upstream gateway unavailable"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				w.Header().Set("Content-Type", tc.contentType)
				w.Header().Set("X-Request-Id", "actual-request-id")
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()
			client := &OpenAICompatibleClient{config: model.ModelProviderConfig{BaseURL: server.URL, TextModel: "test"}, httpClient: server.Client()}
			ctx, observation := monitoring.WithObservation(context.Background())
			_, err := client.GenerateText(ctx, "PRIVATE", "test")
			if err == nil {
				t.Fatal("expected actual provider/parse failure")
			}
			var httpErr *ProviderHTTPError
			if errors.As(err, &httpErr) || calls != 1 {
				t.Fatal("diagnostics changed HTTP error classification or retried submission", err, calls)
			}
			d, status := observation.Read()
			if status != 200 || d.ProviderRequestID != "actual-request-id" || !strings.Contains(d.ProviderBody, tc.detail) || strings.Contains(string(d.JSON()), "PRIVATE") {
				t.Fatal(status, d)
			}
		})
	}
}

func TestObservedBinaryErrorAndSuccessDoNotStoreMedia(t *testing.T) {
	for _, body := range []string{`{"error":{"message":"speech rejected","code":"voice_invalid"}}`, "PRIVATE_AUDIO_BYTES"} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "audio/mpeg")
			w.Header().Set("X-Request-ID", "speech-id")
			_, _ = w.Write([]byte(body))
		}))
		client := &OpenAICompatibleClient{config: model.ModelProviderConfig{BaseURL: server.URL}, httpClient: server.Client()}
		ctx, observation := monitoring.WithObservation(context.Background())
		result, _, err := client.ProxyBlob(ctx, "POST", "/audio/speech", nil, false)
		d, status := observation.Read()
		server.Close()
		if strings.HasPrefix(body, "{") {
			if err == nil || status != 200 || d.ProviderRequestID != "speech-id" || !strings.Contains(d.ProviderBody, "speech rejected") {
				t.Fatal(err, status, d)
			}
		} else if err != nil || string(result) != body || strings.Contains(string(d.JSON()), "PRIVATE") {
			t.Fatal("media changed or retained", err, d)
		}
	}
}
