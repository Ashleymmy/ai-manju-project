package sdvideo

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/monitoring"
)

func TestVideoServiceObservesRealHTTPAndAsyncFailures(t *testing.T) {
	_, private, _ := ed25519.GenerateKey(rand.Reader)
	for _, status := range []int{422, 200} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("X-Request-Id", "sd-request")
				w.WriteHeader(status)
				if status == 422 {
					_, _ = w.Write([]byte(`{"success":false,"error":{"code":"audio_invalid","message":"real rejection"},"prompt":"PRIVATE"}`))
				} else {
					_, _ = w.Write([]byte(`{"success":true,"data":{"status":"failed","error":{"code":"audio_invalid","message":"real rejection"},"prompt":"PRIVATE"}}`))
				}
			}))
			defer server.Close()
			client := NewClient(config.Config{SDVideoBaseURL: server.URL, SDVideoMode: "active", SDVideoJWTPrivateKey: base64.RawStdEncoding.EncodeToString(private)})
			ctx, observation := monitoring.WithObservation(context.Background())
			_, err := client.GetTask(ctx, model.User{ID: "owner"}, "personal:owner", "task")
			if (err != nil) != (status == 422) {
				t.Fatal(err)
			}
			d, gotStatus := observation.Read()
			if gotStatus != status || d.ProviderRequestID != "sd-request" || d.ProviderCode != "audio_invalid" || !strings.Contains(d.ProviderBody, "real rejection") || strings.Contains(d.ProviderBody, "PRIVATE") {
				t.Fatal(gotStatus, d)
			}
		})
	}
}
