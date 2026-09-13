package router

import (
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/config"
)

func TestHealthChecksPrivateSupabaseBucket(t *testing.T) {
	var unavailable atomic.Bool
	storage := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/storage/v1/bucket/studio-test-assets" || r.Method != "GET" {
			t.Error("probe must only read dedicated bucket metadata")
		}
		if unavailable.Load() {
			w.WriteHeader(503)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"id": "studio-test-assets", "public": false})
	}))
	defer storage.Close()
	ca := filepath.Join(t.TempDir(), "ca.pem")
	if err := os.WriteFile(ca, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: storage.Certificate().Raw}), 0600); err != nil {
		t.Fatal(err)
	}
	claims, _ := json.Marshal(map[string]any{"role": "studio_storage_service", "sub": "service", "storage_buckets": []string{"studio-test-assets"}, "iat": time.Now().Unix(), "exp": time.Now().Unix() + 300})
	jwt := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"EdDSA"}`)) + "." + base64.RawURLEncoding.EncodeToString(claims) + ".test-signature"
	cfg := config.Load()
	cfg.StorageDriver, cfg.RequirePersistentStorage = "memory", false
	cfg.SupabaseStorageURL, cfg.SupabaseStorageBucket = storage.URL, "studio-test-assets"
	cfg.SupabaseStorageToken, cfg.SupabaseStorageCAFile, cfg.AssetStorageBackend = jwt, ca, "supabase"
	router := NewWithConfig(cfg)
	for _, code := range []int{200, 503, 200} {
		unavailable.Store(code == 503)
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest("GET", "/health", nil))
		if recorder.Code != code {
			t.Fatalf("got %d want %d: %s", recorder.Code, code, recorder.Body.String())
		}
	}
}
