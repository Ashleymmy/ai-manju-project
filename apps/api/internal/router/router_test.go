package router

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/config"
)

func TestHealthIncludesStorageDBAndRequestID(t *testing.T) {
	t.Setenv("STORAGE_DRIVER", "memory")
	t.Setenv("FRONTEND_URL", "http://localhost:3100")

	router := New()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	request.Header.Set("X-Request-Id", "health-test-id")

	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", recorder.Code, recorder.Body.String())
	}
	if got := recorder.Header().Get("X-Request-Id"); got != "health-test-id" {
		t.Fatalf("X-Request-Id = %q, want health-test-id", got)
	}

	var body struct {
		Success bool `json:"success"`
		Data    struct {
			Service            string `json:"service"`
			Storage            string `json:"storage"`
			DB                 string `json:"db"`
			AuthBootstrap      bool   `json:"auth_bootstrap"`
			PublicSignup       bool   `json:"public_signup"`
			PersistentRequired bool   `json:"persistent_required"`
			RequestID          string `json:"request_id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if !body.Success || body.Data.Service == "" || body.Data.Storage != "memory" || body.Data.DB != "disabled" || body.Data.RequestID != "health-test-id" {
		t.Fatalf("unexpected health body: %+v", body)
	}
	if !body.Data.AuthBootstrap || body.Data.PublicSignup || body.Data.PersistentRequired {
		t.Fatalf("unexpected health body: %+v", body)
	}
}

func TestProjectsCORSPreflightAllowsRequestID(t *testing.T) {
	t.Setenv("STORAGE_DRIVER", "memory")
	t.Setenv("FRONTEND_URLS", "http://localhost:3100,http://127.0.0.1:3100")

	router := New()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodOptions, "/api/projects", nil)
	request.Header.Set("Origin", "http://127.0.0.1:3100")
	request.Header.Set("Access-Control-Request-Method", "POST")
	request.Header.Set("Access-Control-Request-Headers", "content-type,x-request-id")

	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body = %s", recorder.Code, recorder.Body.String())
	}
	if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != "http://127.0.0.1:3100" {
		t.Fatalf("Access-Control-Allow-Origin = %q", got)
	}
	if !headerContains(recorder.Header().Get("Access-Control-Allow-Headers"), "X-Request-Id") {
		t.Fatalf("Access-Control-Allow-Headers = %q, want X-Request-Id", recorder.Header().Get("Access-Control-Allow-Headers"))
	}
	if !headerContains(recorder.Header().Get("Access-Control-Expose-Headers"), "X-Request-Id") {
		t.Fatalf("Access-Control-Expose-Headers = %q, want X-Request-Id", recorder.Header().Get("Access-Control-Expose-Headers"))
	}
}

func TestWebDAVCORSPreflightAllowsProxyHeaders(t *testing.T) {
	t.Setenv("STORAGE_DRIVER", "memory")
	t.Setenv("FRONTEND_URLS", "http://localhost:3100")

	router := New()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodOptions, "/webdav-proxy", nil)
	request.Header.Set("Origin", "http://localhost:3100")
	request.Header.Set("Access-Control-Request-Method", "POST")
	request.Header.Set("Access-Control-Request-Headers", "x-webdav-target,x-webdav-method,x-webdav-authorization,x-webdav-depth,x-webdav-destination,x-webdav-overwrite,x-webdav-content-type")

	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body = %s", recorder.Code, recorder.Body.String())
	}
	for _, header := range []string{
		"X-Webdav-Target",
		"X-Webdav-Method",
		"X-Webdav-Authorization",
		"X-Webdav-Depth",
		"X-Webdav-Destination",
		"X-Webdav-Overwrite",
		"X-Webdav-Content-Type",
	} {
		if !headerContains(recorder.Header().Get("Access-Control-Allow-Headers"), header) {
			t.Fatalf("Access-Control-Allow-Headers = %q, want %s", recorder.Header().Get("Access-Control-Allow-Headers"), header)
		}
	}
}

func TestProjectsRequireAuth(t *testing.T) {
	t.Setenv("STORAGE_DRIVER", "memory")

	router := New()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/projects", nil)

	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401; body = %s", recorder.Code, recorder.Body.String())
	}
}

func TestComicAssetProjectsRequireAuth(t *testing.T) {
	t.Setenv("STORAGE_DRIVER", "memory")

	router := New()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/comic-asset-projects", nil)

	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401; body = %s", recorder.Code, recorder.Body.String())
	}
}

func TestRequirePersistentStorageRejectsMemoryFallback(t *testing.T) {
	assertPanics(t, func() {
		NewWithConfig(config.Config{StorageDriver: "memory", RequirePersistentStorage: true})
	})
}

func TestRequirePersistentStorageRejectsMissingPostgresConfig(t *testing.T) {
	assertPanics(t, func() {
		NewWithConfig(config.Config{StorageDriver: "postgres", RequirePersistentStorage: true})
	})
}

func TestPostgresStorageRejectsMissingConfigWithoutMemoryFallback(t *testing.T) {
	assertPanics(t, func() {
		NewWithConfig(config.Config{StorageDriver: "postgres", RequirePersistentStorage: false})
	})
}

func TestRejectsUnsupportedStorageDriver(t *testing.T) {
	assertPanics(t, func() {
		NewWithConfig(config.Config{StorageDriver: "sqlite"})
	})
}

func headerContains(header string, value string) bool {
	for _, part := range strings.Split(header, ",") {
		if strings.EqualFold(strings.TrimSpace(part), value) {
			return true
		}
	}
	return false
}

func assertPanics(t *testing.T, fn func()) {
	t.Helper()
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic")
		}
	}()
	fn()
}
