package router

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGenerationReceiptReconcileRequiresAuthentication(t *testing.T) {
	t.Setenv("STORAGE_DRIVER", "memory")
	router := New()
	for _, kind := range []string{"text", "audio", "comic_analysis", "comic_revision", "comic_prompt"} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/ai/receipts/"+kind+"/unsubmitted-key/reconcile", nil)
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("unauthenticated reconciliation: code=%d", rec.Code)
		}
	}
}
