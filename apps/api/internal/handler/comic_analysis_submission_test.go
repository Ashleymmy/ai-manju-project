package handler

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

func TestComicAnalysisSubmissionLookupScopeAndEnvelope(t *testing.T) {
	r, ai := receiptTestRouter(t, func(c *gin.Context) {})
	comic := service.NewComicAssetService(repository.NewMemoryComicAssetRepository(), nil)
	comic.SetAnalysisReceiptService(ai.receipts)
	h := NewComicAssetHandler(comic)
	r.GET("/submissions/:key", h.GetAnalysisSubmission)
	_, err := ai.receipts.Reconcile(context.Background(), service.GenerationReceiptScope{UserID: "owner", WorkspaceID: service.WorkspaceIDForScope("team", "owner"), Kind: model.GenerationReceiptKindComicAnalysis, Key: "missing-key"})
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		user, path string
		code       int
	}{
		{"owner", "/submissions/missing-key?scope=team", http.StatusOK},
		{"other", "/submissions/missing-key?scope=team", http.StatusNotFound},
		{"owner", "/submissions/missing-key?scope=personal", http.StatusNotFound},
	} {
		got := receiptRequest(r, http.MethodGet, tc.path, "", "", tc.user)
		if got.Code != tc.code || got.Header().Get("Cache-Control") != "no-store" || !strings.Contains(got.Body.String(), `"success":`) {
			t.Fatalf("scope=%+v status=%d body=%s", tc, got.Code, got.Body.String())
		}
		if tc.code == http.StatusOK && !strings.Contains(got.Body.String(), `"status":"not_submitted"`) {
			t.Fatal("missing authoritative status")
		}
	}
}
