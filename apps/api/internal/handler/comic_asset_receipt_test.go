package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ai-manju/api/internal/service"
	"github.com/gin-gonic/gin"
)

func TestComicReceiptStoreOutageIsRetryable(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	writeComicAssetError(c, "analysis recovery", service.ErrGenerationReceiptUnavailable)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("receipt outage status = %d, want 503", w.Code)
	}
}
