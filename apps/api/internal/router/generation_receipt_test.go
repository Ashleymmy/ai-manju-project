package router

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGenerationReceiptRoutesRequireAuthentication(t *testing.T) {
	t.Setenv("STORAGE_DRIVER", "memory")
	r := New()
	for _, route := range []string{
		"/api/ai/receipts/text/test-key",
		"/api/ai/receipts/text/test-key/result",
		"/api/ai/receipts/audio/test-key/result?scope=team",
	} {
		response := httptest.NewRecorder()
		r.ServeHTTP(response, httptest.NewRequest(http.MethodGet, route, nil))
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("%s returned %d, want 401", route, response.Code)
		}
	}
}
